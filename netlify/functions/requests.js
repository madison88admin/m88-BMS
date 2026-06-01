const { supabase } = require('./utils/supabase');
const { authenticate, authorize } = require('./utils/auth');
const { sendEmail } = require('./utils/email');
const { 
  getLatestConfiguredFiscalYear,
  getAccessibleDepartmentIdsForUser,
  validateFiscalYear 
} = require('./utils/fiscal');
const { 
  validateUUID, 
  validateAmount, 
  sanitizeText,
  createErrorResponse 
} = require('./utils/enhancedAuth');
const { getPresidentThreshold } = require('./utils/approval');
const { toNumber } = require('./utils/budget');
const { AUDIT_ACTIONS, logAuditEvent } = require('./utils/auditLog');
const { notifyAccounting } = require('./utils/workflowNotify');
const {
  resolveOfficialExpenseList,
  filterOfficialExpenseList,
  buildOfficialListForDepartment,
} = require('./utils/expenseCategories');

const pathEndsWith = (event, segment) => (event.path || '').replace(/\/+$/, '').endsWith(`/${segment}`);

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  try {
    const token = event.headers.authorization;
    const user = authenticate(token);

    if (event.httpMethod === 'GET') {
      const activeFiscalYear = await getLatestConfiguredFiscalYear();

      if (pathEndsWith(event, 'official-list')) {
        const requestType = event.queryStringParameters?.request_type;
        const baseList = await resolveOfficialExpenseList();
        let list = baseList;

        if (user.department_id) {
          const { data: deptData } = await supabase
            .from('departments')
            .select('name')
            .eq('id', user.department_id)
            .maybeSingle();
          list = await buildOfficialListForDepartment(user.department_id, activeFiscalYear, baseList);
          list = filterOfficialExpenseList(list.length ? list : baseList, {
            requestType,
            departmentName: deptData?.name || '',
            userRole: user.role,
          });
        } else {
          list = filterOfficialExpenseList(baseList, { requestType, userRole: user.role });
        }

        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify(list),
        };
      }

      if (pathEndsWith(event, 'audit-logs')) {
        authorize(['accounting', 'vp', 'president', 'admin', 'super_admin'])(user);

        const { data: dedicatedLogs, error: dedicatedError } = await supabase
          .from('audit_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(500);

        if (!dedicatedError && dedicatedLogs?.length) {
          return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify(
              dedicatedLogs.map((log) => ({
                ...log,
                log_type: 'audit',
                event_time: log.created_at,
                actor_name: log.user_name,
                actor_role: log.user_role,
                note: log.remarks,
                action: log.action_type,
              }))
            ),
          };
        }

        const [approvalLogsResult, allocationLogsResult, auditLogsResult] = await Promise.all([
          supabase.from('approval_logs').select('*').order('timestamp', { ascending: false }).limit(150),
          supabase.from('allocation_logs').select('*').order('created_at', { ascending: false }).limit(150),
          supabase.from('request_audit_logs').select('*').order('created_at', { ascending: false }).limit(150),
        ]);

        if (approvalLogsResult.error) throw approvalLogsResult.error;
        if (allocationLogsResult.error) throw allocationLogsResult.error;
        if (auditLogsResult.error) throw auditLogsResult.error;

        const combined = [
          ...(approvalLogsResult.data || []).map((log) => ({ ...log, log_type: 'approval', event_time: log.timestamp })),
          ...(allocationLogsResult.data || []).map((log) => ({ ...log, log_type: 'allocation', event_time: log.created_at })),
          ...(auditLogsResult.data || []).map((log) => ({ ...log, log_type: 'audit', event_time: log.created_at })),
        ].sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime());

        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify(combined),
        };
      }

      const { fiscal_year, status, category } = event.queryStringParameters || {};
      const targetFiscalYear = fiscal_year ? validateFiscalYear(fiscal_year) : activeFiscalYear;

      let query = supabase
        .from('expense_requests')
        .select(`
          *,
          users(name),
          departments(name, fiscal_year)
        `)
        .eq('fiscal_year', targetFiscalYear);

      // Apply role-based filtering
      if (user.role === 'employee') {
        query = query.eq('employee_id', user.id);
      } else if (user.role === 'supervisor' || user.role === 'manager') {
        const accessibleDeptIds = await getAccessibleDepartmentIdsForUser(supabase, user, targetFiscalYear);
        query = query.in('department_id', accessibleDeptIds);
      }

      // Apply additional filters
      if (status) query = query.eq('status', status);
      if (category) query = query.eq('category', sanitizeText(category));

      const { data, error } = await query.order('submitted_at', { ascending: false });
      if (error) throw error;

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data || []),
      };
    }

    if (event.httpMethod === 'POST') {
      authorize(['employee', 'manager', 'supervisor', 'accounting'])(user);

      const { 
        item_name, 
        category, 
        category_id, 
        amount, 
        purpose, 
        priority,
        fiscal_year,
        request_type,
        department_id,
        metadata = {},
      } = JSON.parse(event.body);

      const isBudgetRequest = request_type === 'budget_request';
      const isBudgetRevision = request_type === 'budget_revision';
      const isBudgetFlow = isBudgetRequest || isBudgetRevision;

      if (isBudgetFlow && user.role !== 'supervisor' && user.role !== 'admin') {
        return {
          statusCode: 403,
          body: JSON.stringify(createErrorResponse('Only supervisors can submit budget proposals or revisions.', 403)),
        };
      }

      // Validate inputs
      const cleanItemName = sanitizeText(item_name);
      const cleanCategory = sanitizeText(category);
      const cleanPurpose = sanitizeText(purpose);
      const targetFiscalYear = fiscal_year ? validateFiscalYear(fiscal_year) : 
                              await getLatestConfiguredFiscalYear();
      const normalizedAmount = validateAmount(amount);
      const targetDepartmentId = (user.role === 'admin' || user.role === 'accounting') && department_id
        ? department_id
        : user.department_id;

      if (!cleanItemName || !cleanPurpose) {
        return { 
          statusCode: 400, 
          body: JSON.stringify(createErrorResponse('Item name and purpose are required', 400)) 
        };
      }

      if ((isBudgetRequest || isBudgetRevision) && !category_id) {
        return {
          statusCode: 400,
          body: JSON.stringify(createErrorResponse('Budget proposals require a main category (category_id).', 400)),
        };
      }

      // Validate priority
      const validPriorities = ['normal', 'urgent', 'low'];
      const cleanPriority = priority && validPriorities.includes(priority) ? priority : 'normal';

      // Validate category_id if provided
      let cleanCategoryId = null;
      if (category_id) {
        validateUUID(category_id);
        cleanCategoryId = category_id;
      }

      // Validate category budget (skip for budget proposals and cash advances)
      let categoryBudget = null;
      const requestType = request_type || 'reimbursement';
      
      if (!isBudgetFlow && requestType !== 'cash_advance') {
        const categoryQuery = cleanCategoryId 
          ? { id: cleanCategoryId }
          : { category_name: cleanCategory, department_id: targetDepartmentId };

        const { data: budgetData, error: categoryError } = await supabase
          .from('budget_categories')
          .select('id, remaining_amount, category_name, fiscal_year')
          .eq('fiscal_year', targetFiscalYear)
          .match(categoryQuery)
          .maybeSingle();
        
        if (categoryError) throw categoryError;
        if (!budgetData) {
          return { 
            statusCode: 400, 
            body: JSON.stringify(createErrorResponse(`Category "${cleanCategory}" not found for fiscal year ${targetFiscalYear}`, 400)) 
          };
        }
        
        categoryBudget = budgetData;
        const remaining = Number(categoryBudget.remaining_amount);
        if (remaining < normalizedAmount) {
          return { 
            statusCode: 400, 
            body: JSON.stringify(createErrorResponse(
              `Insufficient budget in "${cleanCategory}". Available: ₱${remaining.toFixed(2)}, Requested: ₱${normalizedAmount.toFixed(2)}`, 
              400
            )) 
          };
        }
      }

      if (!isBudgetFlow) {
        const { data: deptSummary, error: summaryError } = await supabase
          .from('departments')
          .select('annual_budget, used_budget')
          .eq('id', targetDepartmentId)
          .single();

        if (summaryError || !deptSummary) {
          return {
            statusCode: 400,
            body: JSON.stringify(createErrorResponse('Department budget not found', 400)),
          };
        }

        const projectedRemaining = toNumber(deptSummary.annual_budget) - toNumber(deptSummary.used_budget);
        if (projectedRemaining < normalizedAmount) {
          return {
            statusCode: 400,
            body: JSON.stringify(createErrorResponse(
              `Insufficient department budget. Remaining: ${projectedRemaining.toFixed(2)}, Requested: ${normalizedAmount.toFixed(2)}`,
              400
            )),
          };
        }
      }

      const request_code = isBudgetRevision
        ? `REV-${Date.now()}`
        : isBudgetRequest
          ? `BUD-${Date.now()}`
          : requestType === 'cash_advance'
            ? `CA-${Date.now()}`
            : `REQ-${Date.now()}`;

      const presidentThreshold = getPresidentThreshold(metadata?.currency || 'PHP');
      let initialStatus = 'pending_supervisor';

      if (isBudgetFlow) {
        if (user.role === 'supervisor') initialStatus = 'pending_accounting';
        else if (user.role === 'accounting') initialStatus = 'pending_vp';
        else if (user.role === 'vp') initialStatus = 'pending_president';
        else initialStatus = 'pending_accounting';
      } else if (user.role === 'employee' || user.role === 'manager') {
        initialStatus = 'pending_supervisor';
      } else if (user.role === 'supervisor') {
        initialStatus = 'pending_accounting';
      } else if (user.role === 'accounting') {
        initialStatus = normalizedAmount >= presidentThreshold ? 'pending_president' : 'pending_vp';
      } else if (user.role === 'vp') {
        initialStatus = 'pending_president';
      } else {
        initialStatus = 'pending_accounting';
      }

      const { data, error } = await supabase
        .from('expense_requests')
        .insert({
          request_code,
          employee_id: user.id,
          department_id: targetDepartmentId,
          fiscal_year: targetFiscalYear,
          item_name: cleanItemName,
          category: cleanCategory,
          category_id: cleanCategoryId || categoryBudget?.id,
          amount: normalizedAmount,
          purpose: cleanPurpose,
          priority: cleanPriority,
          status: initialStatus,
          request_type: requestType,
          metadata: { ...metadata, request_type: requestType },
          submitted_at: new Date()
        })
        .select()
        .single();

      if (error) throw error;

      if (isBudgetRevision && cleanCategoryId) {
        const { data: existingCategory } = await supabase
          .from('budget_categories')
          .select('budget_amount')
          .eq('id', cleanCategoryId)
          .maybeSingle();
        await supabase.from('budget_revision_history').insert({
          category_id: cleanCategoryId,
          department_id: targetDepartmentId,
          request_id: data.id,
          previous_amount: toNumber(existingCategory?.budget_amount),
          proposed_amount: normalizedAmount,
          approved_amount: null,
          fiscal_year: targetFiscalYear,
          revision_type: 'budget_revision',
        });
      }

      await supabase.from('approval_logs').insert({
        request_id: data.id,
        actor_id: user.id,
        action: 'submitted',
        stage: (user.role === 'employee' || user.role === 'manager') ? 'supervisor' : 'accounting',
        note: isBudgetFlow ? 'Budget workflow submitted' : 'Request submitted',
      });

      const submitAuditAction = isBudgetRevision
        ? AUDIT_ACTIONS.BUDGET_REVISION_REQUESTED
        : isBudgetRequest
          ? AUDIT_ACTIONS.BUDGET_PROPOSED
          : requestType === 'cash_advance'
            ? AUDIT_ACTIONS.CASH_ADVANCE_SUBMITTED
            : AUDIT_ACTIONS.REIMBURSEMENT_SUBMITTED;

      await logAuditEvent({
        user,
        actionType: submitAuditAction,
        recordType: isBudgetFlow ? 'budget' : 'request',
        recordId: data.id,
        recordLabel: request_code,
        newValue: { amount: normalizedAmount, request_type: requestType, status: initialStatus },
        remarks: cleanPurpose,
      });

      if (isBudgetFlow) {
        await notifyAccounting(
          `Supervisor submitted budget ${isBudgetRevision ? 'revision' : 'proposal'} ${request_code} for review.`
        );
      } else if (requestType === 'cash_advance') {
        await notifyAccounting(`New cash advance ${request_code} submitted for review.`);
      } else {
        await notifyAccounting(`New reimbursement ${request_code} submitted for review.`);
      }

      // Notify supervisor for employee/manager submissions
      if (user.role === 'employee' || user.role === 'manager') {
        const { data: supervisor } = await supabase.from('users')
          .select('email')
          .eq('department_id', user.department_id)
          .eq('role', 'supervisor')
          .maybeSingle();
        if (supervisor?.email) {
          sendEmail(supervisor.email, 'New Expense Request', `New request ${request_code} submitted.`);
        }
      }

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data),
      };
    }

    return { 
      statusCode: 405, 
      body: JSON.stringify(createErrorResponse('Method not allowed', 405)) 
    };
  } catch (error) {
    console.error('Requests error:', error);
    return {
      statusCode: error.message.includes('Forbidden') ? 403 : 
                 error.message.includes('Access denied') ? 401 : 500,
      body: JSON.stringify(createErrorResponse(error.message || 'Internal server error', 500)),
    };
  }
};
