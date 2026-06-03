const { supabase } = require('./utils/supabase');
const { authenticate, authorize } = require('./utils/auth');
const { toNumber, resolveMainCategory, requiresPresidentBudgetApproval } = require('./utils/budget');
const { AUDIT_ACTIONS, logAuditEvent } = require('./utils/auditLog');
const { notifyDepartmentSupervisor, checkBudgetUtilizationWarning } = require('./utils/workflowNotify');
const { isMainCategoryCode } = require('./utils/budgetCategoryHierarchy');
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

const sumChildBudgets = async (parentCategoryId, excludeCategoryId) => {
  let query = supabase
    .from('budget_categories')
    .select('id, budget_amount')
    .eq('parent_category_id', parentCategoryId);

  if (excludeCategoryId) {
    query = query.neq('id', excludeCategoryId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).reduce((sum, category) => sum + toNumber(category.budget_amount), 0);
};

const syncMainCategoryRemaining = async (categoryId) => {
  if (!categoryId) return;

  const { data: category, error } = await supabase
    .from('budget_categories')
    .select('id, parent_category_id, budget_amount')
    .eq('id', categoryId)
    .maybeSingle();

  if (error) throw error;
  if (!category || category.parent_category_id) return;

  const childTotal = await sumChildBudgets(category.id);
  await supabase
    .from('budget_categories')
    .update({
      remaining_amount: Math.max(0, toNumber(category.budget_amount) - childTotal),
      updated_at: new Date(),
    })
    .eq('id', category.id);
};

const assertChildAllocationFitsParent = async (parentCategoryId, requestedBudget, excludeCategoryId) => {
  const { data: parentCategory, error: parentError } = await supabase
    .from('budget_categories')
    .select('id, department_id, fiscal_year, parent_category_id, budget_amount, category_name')
    .eq('id', parentCategoryId)
    .maybeSingle();

  if (parentError || !parentCategory) {
    throw new Error('Parent category not found');
  }
  if (parentCategory.parent_category_id) {
    throw new Error('Parent category cannot itself be a subcategory');
  }

  const existingChildTotal = await sumChildBudgets(parentCategoryId, excludeCategoryId);
  const parentBudget = toNumber(parentCategory.budget_amount);

  if (existingChildTotal + requestedBudget > parentBudget) {
    throw new Error(`Sub-category allocations exceed "${parentCategory.category_name}" budget. Available: ${(parentBudget - existingChildTotal).toFixed(2)}, Requested: ${requestedBudget.toFixed(2)}`);
  }

  return parentCategory;
};

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

    if (event.httpMethod === 'PATCH' && lastSegment === 'lock') {
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
        .update({ is_locked: true, locked_at: new Date(), updated_at: new Date() })
        .eq('id', secondLast)
        .select()
        .single();

      if (error) throw error;

      const lockBody = (() => {
        try { return event.body ? JSON.parse(event.body) : {}; } catch { return {}; }
      })();

      await logAuditEvent({
        user,
        actionType: AUDIT_ACTIONS.BUDGET_LOCKED,
        recordType: 'budget',
        recordId: secondLast,
        recordLabel: current.category_name,
        oldValue: { is_locked: false },
        newValue: { is_locked: true },
        remarks: lockBody.reason || 'Locked by accounting',
      });
      await notifyDepartmentSupervisor(
        current.department_id,
        `Budget category "${current.category_name}" was locked by accounting. No further edits are allowed until unlocked.`
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

      // Role-and-department display filter (server-side only, no DB changes)
      // Filter applies only to non-accounting viewers (Supervisor, Employee, Manager, VP, President).
      const role = String((user && user.role) || '').toLowerCase();
      const filteredRoles = new Set(['employee', 'supervisor', 'manager', 'vp', 'president']);

      const allowedMainCodes = new Set([
        '6010','6020','6040','6041','6170','6240',
        '6330','6340','6350','6430','6490','6500','6650','6670','6710',
        '6720','6840','6860','6870','6900','9900'
      ]);

      let allowedCodesFromExpense = null; // null => no extra restriction (accounting/admin)

      if (filteredRoles.has(role)) {
        // Determine user's department short name via departments table
        const deptMap = {
          'HR Department': 'HR',
          'Admin Department': 'Admin',
          'Finance Department': 'Accounting',
          'IT Department': 'IT'
        };

        let deptShort = null;
        if (user && user.department_id) {
          try {
            const { data: deptData } = await supabase.from('departments').select('name').eq('id', user.department_id).maybeSingle();
            if (deptData && deptData.name && deptMap[deptData.name]) {
              deptShort = deptMap[deptData.name];
            }
          } catch (err) {
            // ignore and fallback to only 'All'
            console.warn('Dept lookup failed for display filter:', err?.message || err);
          }
        }

        // Query expense_categories to determine which main_category_codes are relevant
        try {
          const ecQuery = supabase.from('expense_categories').select('main_category_code');
          // restrict to our allowed main codes to limit result set
          ecQuery.in('main_category_code', Array.from(allowedMainCodes));
          if (deptShort) {
            ecQuery.in('department', ['All', deptShort]);
          } else {
            ecQuery.eq('department', 'All');
          }

          const { data: ecData, error: ecError } = await ecQuery;
          if (ecError) throw ecError;
          allowedCodesFromExpense = new Set((ecData || []).map(e => String(e.main_category_code)));
        } catch (err) {
          console.warn('Expense categories lookup failed for display filter:', err?.message || err);
          // If lookup fails, fall back to allowing only 'All' via empty set (no categories)
          allowedCodesFromExpense = new Set();
        }
      }

      const enriched = (data || []).map((row) => ({
        ...row,
        is_main_category: !row.parent_category_id,
        requires_president_approval: !row.parent_category_id
          && requiresPresidentBudgetApproval(toNumber(row.budget_amount)),
      }))
      // apply display filter if applicable
      .filter((row) => {
        if (!filteredRoles.has(role)) return true; // accounting/admin/super_admin see all
        // show only main categories (no sub-categories)
        if (row.parent_category_id) return false;
        // category_code must be one of the allowed main codes
        if (!allowedMainCodes.has(String(row.category_code))) return false;
        // must be present in expense_categories for user's department (or 'All')
        if (allowedCodesFromExpense && !allowedCodesFromExpense.has(String(row.category_code))) return false;
        return true;
      });

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

      if (!parent_category_id && !isMainCategoryCode(cleanCategoryCode)) {
        return {
          statusCode: 400,
          body: JSON.stringify(createErrorResponse('Sub-categories must be assigned under a main category.', 400)),
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

      if (parent_category_id) {
        validateUUID(parent_category_id);
        const parentCategory = await assertChildAllocationFitsParent(parent_category_id, requestedBudget);
        if (parentCategory.department_id !== department_id || Number(parentCategory.fiscal_year) !== Number(targetFiscalYear)) {
          return {
            statusCode: 400,
            body: JSON.stringify(createErrorResponse('Parent category must belong to the same department and fiscal year', 400)),
          };
        }
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
      await syncMainCategoryRemaining(parent_category_id || data.id);

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
      const { budget_amount, category_name, parent_category_id } = JSON.parse(event.body);

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

      let nextParentCategoryId = current.parent_category_id || null;
      const updatePayload = {
        budget_amount: requestedBudget,
        category_name: cleanCategoryName || current.category_name,
        remaining_amount: Math.max(0, requestedBudget - toNumber(current.used_amount) - toNumber(current.committed_amount)),
        updated_at: new Date()
      };

      if (parent_category_id !== undefined) {
        if (parent_category_id === null || parent_category_id === '') {
          if (!isMainCategoryCode(current.category_code)) {
            return {
              statusCode: 400,
              body: JSON.stringify(createErrorResponse('Only main category codes can be moved to the top level.', 400)),
            };
          }
          updatePayload.parent_category_id = null;
          nextParentCategoryId = null;
        } else if (parent_category_id === id) {
          return {
            statusCode: 400,
            body: JSON.stringify(createErrorResponse('Category cannot be its own parent', 400)),
          };
        } else {
          validateUUID(parent_category_id);
          const parentCategory = await assertChildAllocationFitsParent(parent_category_id, requestedBudget, id);
          if (parentCategory.department_id !== current.department_id || Number(parentCategory.fiscal_year) !== Number(current.fiscal_year)) {
            return {
              statusCode: 400,
              body: JSON.stringify(createErrorResponse('Parent category must belong to the same department and fiscal year', 400)),
            };
          }
          updatePayload.parent_category_id = parent_category_id;
          nextParentCategoryId = parent_category_id;
        }
      }

      if (nextParentCategoryId) {
        await assertChildAllocationFitsParent(nextParentCategoryId, requestedBudget, id);
      }

      if (!nextParentCategoryId) {
        const childTotal = await sumChildBudgets(id);
        if (requestedBudget < childTotal) {
          return {
            statusCode: 400,
            body: JSON.stringify(createErrorResponse(`Main category budget cannot be below its sub-category allocations. Allocated: ${childTotal.toFixed(2)}`, 400)),
          };
        }
        updatePayload.remaining_amount = Math.max(0, requestedBudget - childTotal);
      }

      const { data, error } = await supabase
        .from('budget_categories')
        .update(updatePayload)
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
      await syncMainCategoryRemaining(current.parent_category_id);
      await syncMainCategoryRemaining(nextParentCategoryId || id);

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
        .select('department_id, fiscal_year, is_locked, used_amount, committed_amount, category_name, parent_category_id')
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
      await syncMainCategoryRemaining(category.parent_category_id);

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
