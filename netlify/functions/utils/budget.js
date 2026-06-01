const { supabase } = require('./supabase');
const { getBudgetPresidentThreshold } = require('./approval');
const { syncDepartmentBudget } = require('./fiscal');

const toNumber = (value) => Number.parseFloat(value ?? 0) || 0;
const TICKET_USED_STATUSES = new Set(['approved', 'released']);
const TICKET_COMMITTED_STATUSES = new Set(['pending_supervisor', 'pending_accounting', 'pending_vp', 'pending_president', 'on_hold']);

const getBudgetProposalAmount = (request) => toNumber(request?.amount);

/** Budget proposals at or above threshold route to President; below routes to VP for final approval. */
const requiresPresidentBudgetApproval = (amount, currency = 'PHP') =>
  toNumber(amount) >= getBudgetPresidentThreshold(currency);

const resolveBudgetApprovalRoute = (amount, currency = 'PHP') =>
  requiresPresidentBudgetApproval(amount, currency) ? 'pending_president' : 'pending_vp';

const resolveMainCategory = async (categoryId) => {
  if (!categoryId) return null;

  const { data: category } = await supabase
    .from('budget_categories')
    .select('id, category_name, parent_category_id, budget_amount, department_id, fiscal_year, used_amount, committed_amount')
    .eq('id', categoryId)
    .maybeSingle();

  if (!category) return null;
  if (!category.parent_category_id) return category;

  const { data: parent } = await supabase
    .from('budget_categories')
    .select('id, category_name, parent_category_id, budget_amount, department_id, fiscal_year, used_amount, committed_amount')
    .eq('id', category.parent_category_id)
    .maybeSingle();

  return parent || category;
};

const assertMainCategoryProposal = async (categoryId) => {
  if (!categoryId) {
    return { ok: false, error: 'Budget proposals require a main category (category_id).' };
  }

  const { data: category, error } = await supabase
    .from('budget_categories')
    .select('id, category_name, parent_category_id')
    .eq('id', categoryId)
    .maybeSingle();

  if (error || !category) {
    return { ok: false, error: 'Budget category not found.' };
  }

  if (category.parent_category_id) {
    return {
      ok: false,
      error: 'Budget proposals must target a main category. Sub-categories inherit their parent main category budget.',
    };
  }

  return { ok: true, category };
};

/**
 * Find the budget category linked to a request
 */
const findRequestCategory = async (request) => {
  if (!request) return null;
  
  // Try matching by category_id first
  if (request.category_id) {
    const { data } = await supabase
      .from('budget_categories')
      .select('id, category_code, category_name, budget_amount, remaining_amount, used_amount, committed_amount')
      .eq('id', request.category_id)
      .maybeSingle();
    if (data) return data;
  }
  
  // Fallback to matching by category name/code
  if (request.category && request.department_id) {
    const cleanCode = String(request.category).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const { data } = await supabase
      .from('budget_categories')
      .select('id, category_code, category_name, budget_amount, remaining_amount, used_amount, committed_amount')
      .eq('department_id', request.department_id)
      .ilike('category_code', cleanCode)
      .maybeSingle();
    
    if (data) return data;
    
    // Try matching by category_name if code didn't match
    const { data: dataByName } = await supabase
      .from('budget_categories')
      .select('id, category_code, category_name, budget_amount, remaining_amount, used_amount, committed_amount')
      .eq('department_id', request.department_id)
      .ilike('category_name', request.category)
      .maybeSingle();
      
    if (dataByName) return dataByName;
  }
  
  return null;
};

/**
 * Adjust category committed_amount by delta
 */
const adjustCategoryCommitted = async (request, delta) => {
  try {
    const category = await findRequestCategory(request);
    if (!category) return { ok: false, reason: 'category_not_found' };
    
    const newCommitted = Math.max(0, toNumber(category.committed_amount) + toNumber(delta));
    const { error } = await supabase
      .from('budget_categories')
      .update({ committed_amount: newCommitted, updated_at: new Date() })
      .eq('id', category.id);
      
    if (error) return { ok: false, reason: error.message };
    return { ok: true, category, newCommitted };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
};

/**
 * On release - subtract from committed_amount and add to used_amount
 */
const adjustCategoryReleased = async (request) => {
  try {
    const category = await findRequestCategory(request);
    if (!category) return { ok: false, reason: 'category_not_found' };
    
    const amount = toNumber(request.amount);
    const newCommitted = Math.max(0, toNumber(category.committed_amount) - amount);
    const newUsed = toNumber(category.used_amount) + amount;
    const newRemaining = Math.max(0, toNumber(category.budget_amount) - newUsed);
    
    const { error } = await supabase
      .from('budget_categories')
      .update({ 
        committed_amount: newCommitted, 
        used_amount: newUsed,
        remaining_amount: newRemaining,
        updated_at: new Date() 
      })
      .eq('id', category.id);
      
    if (error) return { ok: false, reason: error.message };
    return { ok: true, category, newCommitted, newUsed };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
};

const lockBudgetCategory = async (categoryId) => {
  if (!categoryId) return;
  await supabase
    .from('budget_categories')
    .update({ is_locked: true, locked_at: new Date() })
    .eq('id', categoryId);
};

const lockDepartmentBudgetMatrix = async (departmentId, fiscalYear) => {
  if (!departmentId || !fiscalYear) return;
  await supabase
    .from('budget_categories')
    .update({ is_locked: true, locked_at: new Date() })
    .eq('department_id', departmentId)
    .eq('fiscal_year', fiscalYear);
};

const reconcileCategoryTicketUsage = async (categoryId, budgetAmount, reservedAmount = 0) => {
  const { data: category } = await supabase
    .from('budget_categories')
    .select('id, department_id, fiscal_year')
    .eq('id', categoryId)
    .maybeSingle();

  if (!category) return { used: 0, committed: 0 };

  const relevantStatuses = [...TICKET_USED_STATUSES, ...TICKET_COMMITTED_STATUSES];
  const { data: requests } = await supabase
    .from('expense_requests')
    .select('id, category_id, amount, status, request_type')
    .eq('department_id', category.department_id)
    .eq('fiscal_year', category.fiscal_year)
    .in('status', relevantStatuses)
    .not('request_type', 'in', '(budget_request,budget_revision)');

  const requestRows = requests || [];
  const requestIds = requestRows.map((request) => request.id);
  const { data: items } = requestIds.length
    ? await supabase
      .from('request_items')
      .select('request_id, category_id, amount')
      .in('request_id', requestIds)
    : { data: [] };

  const requestsById = new Map(requestRows.map((request) => [request.id, request]));
  const requestIdsWithItems = new Set((items || []).map((item) => item.request_id));
  let used = 0;
  let committed = 0;

  const addAmount = (status, amount) => {
    if (TICKET_USED_STATUSES.has(status)) used += amount;
    if (TICKET_COMMITTED_STATUSES.has(status)) committed += amount;
  };

  for (const item of items || []) {
    if (item.category_id !== categoryId) continue;
    const request = requestsById.get(item.request_id);
    if (!request) continue;
    addAmount(request.status, toNumber(item.amount));
  }

  for (const request of requestRows) {
    if (requestIdsWithItems.has(request.id)) continue;
    if (request.category_id !== categoryId) continue;
    addAmount(request.status, toNumber(request.amount));
  }

  const remainingAmount = Math.max(0, budgetAmount - reservedAmount - used - committed);
  await supabase
    .from('budget_categories')
    .update({
      used_amount: used,
      committed_amount: committed,
      remaining_amount: remainingAmount,
      updated_at: new Date(),
    })
    .eq('id', categoryId);

  return { used, committed };
};

const applyApprovedBudgetProposal = async (request) => {
  const category = await resolveMainCategory(request?.category_id);
  if (!category) return;

  const proposedAmount = getBudgetProposalAmount(request);
  const previousAmount = toNumber(category.budget_amount);
  const { data: children } = await supabase
    .from('budget_categories')
    .select('budget_amount')
    .eq('parent_category_id', category.id);
  const childTotal = (children || []).reduce((sum, child) => sum + toNumber(child.budget_amount), 0);
  const newRemaining = Math.max(0, proposedAmount - childTotal);

  await supabase
    .from('budget_categories')
    .update({
      budget_amount: proposedAmount,
      remaining_amount: newRemaining,
      is_locked: true,
      locked_at: new Date(),
      updated_at: new Date(),
    })
    .eq('id', category.id);

  await reconcileCategoryTicketUsage(category.id, proposedAmount, childTotal);

  await lockDepartmentBudgetMatrix(request.department_id, request.fiscal_year);
  await syncDepartmentBudget(request.department_id, request.fiscal_year);

  await supabase.from('budget_revision_history').insert({
    category_id: category.id,
    department_id: request.department_id,
    request_id: request.id,
    previous_amount: previousAmount,
    proposed_amount: proposedAmount,
    approved_amount: proposedAmount,
    fiscal_year: request.fiscal_year,
    revision_type: request.request_type === 'budget_revision' ? 'budget_revision' : 'budget_proposal',
    approved_at: new Date(),
  });
};

const isBudgetWorkflowType = (requestType) =>
  requestType === 'budget_request' || requestType === 'budget_revision';

const enrichRequestsWithMainCategory = async (rows) => {
  if (!rows?.length) return [];

  const categoryIds = new Set();
  for (const row of rows) {
    if (row.category_id) categoryIds.add(row.category_id);
    for (const item of row.metadata?.items || []) {
      if (item.category_id) categoryIds.add(item.category_id);
    }
  }

  const catById = new Map();
  if (categoryIds.size > 0) {
    const { data: categories } = await supabase
      .from('budget_categories')
      .select('id, category_name, parent_category_id')
      .in('id', Array.from(categoryIds));

    for (const cat of categories || []) {
      catById.set(cat.id, cat);
    }

    const missingParentIds = [...catById.values()]
      .map((c) => c.parent_category_id)
      .filter((id) => id && !catById.has(id));

    if (missingParentIds.length > 0) {
      const { data: parents } = await supabase
        .from('budget_categories')
        .select('id, category_name, parent_category_id')
        .in('id', missingParentIds);
      for (const parent of parents || []) {
        catById.set(parent.id, parent);
      }
    }
  }

  const resolveMainNameFromCategoryId = (categoryId) => {
    if (!categoryId) return null;
    const cat = catById.get(categoryId);
    if (!cat) return null;
    if (!cat.parent_category_id) return cat.category_name;
    const parent = catById.get(cat.parent_category_id);
    return parent?.category_name || cat.category_name;
  };

  return rows.map((row) => {
    const isBudget = isBudgetWorkflowType(row.request_type);
    let mainCategoryName = row.metadata?.main_category || null;

    if (!mainCategoryName && row.category_id) {
      mainCategoryName = resolveMainNameFromCategoryId(row.category_id);
    }
    if (!mainCategoryName && isBudget) {
      mainCategoryName = row.category || null;
    }
    if (!mainCategoryName && row.metadata?.items?.length) {
      const fromItems = row.metadata.items
        .map((item) => item.main_category || resolveMainNameFromCategoryId(item.category_id))
        .filter(Boolean);
      if (fromItems.length === 1) mainCategoryName = fromItems[0];
    }

    const enrichedItems = (row.metadata?.items || []).map((item) => ({
      ...item,
      main_category:
        item.main_category
        || resolveMainNameFromCategoryId(item.category_id)
        || mainCategoryName
        || null,
    }));

    return {
      ...row,
      main_category_name: mainCategoryName,
      department_name: row.departments?.name || row.department_name || null,
      requester_name: row.users?.name || row.requester_name || null,
      metadata: row.metadata
        ? { ...row.metadata, items: enrichedItems.length ? enrichedItems : row.metadata.items }
        : row.metadata,
    };
  });
};

const lockCashAdvanceCategory = async (request) => {
  const requestType = request.request_type || request.metadata?.request_type;
  if (requestType !== 'cash_advance') return;

  if (request.category) {
    const { data: mainCategory } = await supabase
      .from('budget_categories')
      .select('id')
      .eq('category_name', String(request.category).trim())
      .eq('department_id', request.department_id)
      .eq('fiscal_year', request.fiscal_year)
      .is('parent_category_id', null)
      .maybeSingle();
    if (mainCategory?.id) {
      await lockBudgetCategory(mainCategory.id);
      return;
    }
  }

  if (request.category_id) {
    await lockBudgetCategory(request.category_id);
  }
};

module.exports = {
  findRequestCategory,
  adjustCategoryCommitted,
  adjustCategoryReleased,
  lockBudgetCategory,
  lockDepartmentBudgetMatrix,
  applyApprovedBudgetProposal,
  lockCashAdvanceCategory,
  getBudgetProposalAmount,
  requiresPresidentBudgetApproval,
  resolveBudgetApprovalRoute,
  resolveMainCategory,
  assertMainCategoryProposal,
  enrichRequestsWithMainCategory,
  isBudgetWorkflowType,
  toNumber,
};
