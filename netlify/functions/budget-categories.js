const { supabase } = require('./utils/supabase');
const { authenticate, authorize } = require('./utils/auth');
const { toNumber, resolveMainCategory, requiresPresidentBudgetApproval } = require('./utils/budget');
const { AUDIT_ACTIONS, logAuditEvent } = require('./utils/auditLog');
const { notifyDepartmentSupervisor, checkBudgetUtilizationWarning } = require('./utils/workflowNotify');
const {
  getLatestConfiguredFiscalYear,
  syncDepartmentBudget,
  validateFiscalYear
} = require('./utils/fiscal');
const { 
  validateUUID, 
  validateAmount, 
  sanitizeText,
  createErrorResponse 
} = require('./utils/enhancedAuth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  try {
    const token = event.headers.authorization;
    const user = authenticate(token);
    const pathParts = (event.path || '').split('/').filter(Boolean);
    const lastSegment = pathParts[pathParts.length - 1];
    const secondLast = pathParts[pathParts.length - 2];

    if (event.httpMethod === 'PATCH' && lastSegment === 'unlock') {
      authorize(['accounting', 'admin'])(user);
      validateUUID(secondLast);

      const { data: current, error: fetchError } = await supabase
        .from('budget_categories')
        .select('*')
        .eq('id', secondLast)
        .single();

      if (fetchError || !current) {
        return {
          statusCode: 404,
          body: JSON.stringify(createErrorResponse('Category not found', 404)),
        };
      }

      const { data, error } = await supabase
        .from('budget_categories')
        .update({ is_locked: false, locked_at: null, unlocked_at: new Date(), updated_at: new Date() })
        .eq('id', secondLast)
        .select()
        .single();

      if (error) throw error;

      const unlockBody = (() => {
        try { return event.body ? JSON.parse(event.body) : {}; } catch { return {}; }
      })();

      await logAuditEvent({
        user,
        actionType: AUDIT_ACTIONS.BUDGET_UNLOCKED,
        recordType: 'budget',
        recordId: secondLast,
        recordLabel: current.category_name,
        oldValue: { is_locked: true },
        newValue: { is_locked: false },
        remarks: unlockBody.reason || 'Unlocked by accounting',
      });
      await notifyDepartmentSupervisor(
        current.department_id,
        `Budget category "${current.category_name}" was unlocked by accounting. You may submit revisions if needed.`
      );

      await syncDepartmentBudget(current.department_id, current.fiscal_year);

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data),
      };
    }

    if (event.httpMethod === 'GET') {
      const { department_id, fiscal_year, all_years } = event.queryStringParameters || {};
      let query = supabase.from('budget_categories').select('*');
      
      // Get active fiscal year if not specified
      const targetFiscalYear = fiscal_year ? validateFiscalYear(fiscal_year) : 
                              await getLatestConfiguredFiscalYear();
      
      if (!all_years || all_years !== 'true') {
        query = query.eq('fiscal_year', targetFiscalYear);
      }
      
      if (department_id) {
        validateUUID(department_id);
        query = query.eq('department_id', department_id);
      }
      
      const { data, error } = await query.order('category_name');
      if (error) throw error;

      const enriched = (data || []).map((row) => ({
        ...row,
        is_main_category: !row.parent_category_id,
        requires_president_approval: !row.parent_category_id
          && requiresPresidentBudgetApproval(toNumber(row.budget_amount)),
      }));

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(enriched),
      };
    }

    if (event.httpMethod === 'POST') {
      authorize(['accounting', 'admin'])(user);
      
      const { 
        department_id, 
        category_code, 
        category_name, 
        budget_amount, 
        fiscal_year,
        parent_category_id,
      } = JSON.parse(event.body);
      
      // Validate inputs
      validateUUID(department_id);
      const targetFiscalYear = fiscal_year ? validateFiscalYear(fiscal_year) : 
                              await getLatestConfiguredFiscalYear();
      
      const requestedBudget = validateAmount(budget_amount);
      const cleanCategoryCode = sanitizeText(category_code).toUpperCase();
      const cleanCategoryName = sanitizeText(category_name);
      
      if (!cleanCategoryCode || !cleanCategoryName) {
        return { 
          statusCode: 400, 
          body: JSON.stringify(createErrorResponse('Category code and name are required', 400)) 
        };
      }
      
      // Check for duplicate category code in same department/fiscal year
      const { data: existing, error: checkError } = await supabase
        .from('budget_categories')
        .select('id')
        .eq('department_id', department_id)
        .eq('fiscal_year', targetFiscalYear)
        .eq('category_code', cleanCategoryCode)
        .maybeSingle();

      if (checkError) throw checkError;
      if (existing) {
        return { 
          statusCode: 409, 
          body: JSON.stringify(createErrorResponse('Category code already exists in this department', 409)) 
        };
      }
      
      const { data, error } = await supabase
        .from('budget_categories')
        .insert({
          department_id,
          fiscal_year: targetFiscalYear,
          category_code: cleanCategoryCode,
          category_name: cleanCategoryName,
          budget_amount: requestedBudget,
          remaining_amount: requestedBudget,
          parent_category_id: parent_category_id || null,
          updated_at: new Date()
        })
        .select()
        .single();

      if (error) throw error;

      await logAuditEvent({
        user,
        actionType: AUDIT_ACTIONS.BUDGET_UPDATED,
        recordType: 'budget',
        recordId: data.id,
        recordLabel: data.category_name,
        newValue: {
          budget_amount: requestedBudget,
          is_main_category: !parent_category_id,
        },
        remarks: parent_category_id
          ? 'Sub-category created under main category; supervisor proposals apply to main category budgets only.'
          : 'Main category created; supervisor budget proposals apply at this level.',
      });

      // Sync department budget after adding category
      await syncDepartmentBudget(department_id, targetFiscalYear);

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data),
      };
    }

    if (event.httpMethod === 'PUT') {
      authorize(['accounting', 'admin'])(user);
      const pathParts = event.path.split('/');
      const id = pathParts[pathParts.length - 1];
      const { budget_amount, category_name } = JSON.parse(event.body);

      validateUUID(id);
      const requestedBudget = validateAmount(budget_amount);
      const cleanCategoryName = category_name ? sanitizeText(category_name) : null;

      const { data: current, error: fetchError } = await supabase
        .from('budget_categories')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError || !current) {
        return { 
          statusCode: 404, 
          body: JSON.stringify(createErrorResponse('Category not found', 404)) 
        };
      }

      if (current.is_locked) {
        return {
          statusCode: 403,
          body: JSON.stringify(createErrorResponse('This budget category is locked. Only accounting can unlock it before editing.', 403)),
        };
      }

      const newRemaining = requestedBudget - toNumber(current.used_amount) - toNumber(current.committed_amount);

      const { data, error } = await supabase
        .from('budget_categories')
        .update({
          budget_amount: requestedBudget,
          category_name: cleanCategoryName || current.category_name,
          remaining_amount: Math.max(0, newRemaining),
          updated_at: new Date()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      const mainCategory = await resolveMainCategory(id);
      await logAuditEvent({
        user,
        actionType: AUDIT_ACTIONS.BUDGET_UPDATED,
        recordType: 'budget',
        recordId: mainCategory?.id || id,
        recordLabel: mainCategory?.category_name || current.category_name,
        oldValue: { budget_amount: current.budget_amount, category_name: current.category_name },
        newValue: {
          budget_amount: requestedBudget,
          category_name: cleanCategoryName || current.category_name,
          is_main_category: !current.parent_category_id,
        },
        remarks: current.parent_category_id
          ? `Sub-category updated; main category "${mainCategory?.category_name || 'unknown'}" owns the proposal budget.`
          : undefined,
      });
      await checkBudgetUtilizationWarning(id);

      await syncDepartmentBudget(current.department_id, current.fiscal_year);

      return { 
        statusCode: 200, 
        headers: { 'Access-Control-Allow-Origin': '*' }, 
        body: JSON.stringify(data) 
      };
    }

    if (event.httpMethod === 'DELETE') {
      authorize(['accounting', 'admin'])(user);
      const pathParts = event.path.split('/');
      const id = pathParts[pathParts.length - 1];

      validateUUID(id);

      const { data: category, error: fetchError } = await supabase
        .from('budget_categories')
        .select('department_id, fiscal_year, is_locked, used_amount, committed_amount, category_name')
        .eq('id', id)
        .single();

      if (fetchError || !category) {
        return { 
          statusCode: 404, 
          body: JSON.stringify(createErrorResponse('Category not found', 404)) 
        };
      }

      if (category.is_locked) {
        return {
          statusCode: 403,
          body: JSON.stringify(createErrorResponse('This budget category is locked. Only accounting can unlock it before deleting.', 403)),
        };
      }

      if (toNumber(category.used_amount) > 0 || toNumber(category.committed_amount) > 0) {
        return {
          statusCode: 400,
          body: JSON.stringify(createErrorResponse(`Cannot delete category "${category.category_name}" — it has existing used or committed budget amounts.`, 400)),
        };
      }

      const { error } = await supabase.from('budget_categories').delete().eq('id', id);
      if (error) throw error;

      // Sync department budget after deleting category
      await syncDepartmentBudget(category.department_id, category.fiscal_year);

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'Deleted' }),
      };
    }

    return { 
      statusCode: 405, 
      body: JSON.stringify(createErrorResponse('Method not allowed', 405)) 
    };
  } catch (error) {
    console.error('Budget categories error:', error);
    return {
      statusCode: error.message.includes('Forbidden') ? 403 : 
                 error.message.includes('Access denied') ? 401 : 500,
      body: JSON.stringify(createErrorResponse(error.message || 'Internal server error', 500)),
    };
  }
};
