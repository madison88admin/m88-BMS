import { supabase } from './supabase';

// Use integer arithmetic to avoid floating-point precision errors
// Multiply by 100 for cents, divide by 100 for final display
const toCents = (value: unknown) => Math.round((Number.parseFloat(String(value ?? 0)) || 0) * 100);
const fromCents = (cents: number) => cents / 100;
const toNumber = (value: unknown) => fromCents(toCents(value));
const normalizeDepartmentName = (value: string) => String(value || '').trim();
const getDepartmentGroupKey = (department: { name?: string; fiscal_year?: number }) =>
  `${normalizeDepartmentName(department.name || '').toLowerCase()}::${department.fiscal_year ?? ''}`;

const normalizeCategoryName = (value: unknown) => String(value || '').trim().toLowerCase();
const getCategoryMapKey = (departmentId: string, fiscalYear: number, categoryName: string) =>
  `${departmentId}::${fiscalYear}::${normalizeCategoryName(categoryName)}`;

export const isBudgetCommittedStatus = (status?: string) => status === 'released' || status === 'approved';
export const isBudgetWorkflow = (requestType?: string) => requestType === 'budget_request' || requestType === 'budget_revision';
export const isActualExpenseCommittedStatus = (status?: string, requestType?: string) => isBudgetCommittedStatus(status) && !isBudgetWorkflow(requestType);
export const isPendingBudgetStatus = (status?: string) => status === 'pending_supervisor' || status === 'pending_accounting' || status === 'pending_vp' || status === 'pending_president' || status === 'on_hold';
export const isOnHoldStatus = (status?: string) => status === 'on_hold';

export interface RequestAllocationRow {
  id?: string;
  request_id: string;
  department_id: string;
  amount: number | string;
  departments?: {
    name?: string;
    fiscal_year?: number;
  } | null;
}

interface RequestCategoryAllocation {
  request_id: string;
  department_id: string;
  fiscal_year: number;
  category_id?: string;
  category_name?: string;
  amount: number;
}

interface ExpenseRequestRow {
  id: string;
  department_id: string;
  amount: number | string;
  status?: string;
  request_type?: string;
}

interface DepartmentBudgetSummary {
  department_name: string;
  fiscal_year: number | null;
  annual_budget: number;
  used_budget: number;
  petty_cash_balance: number;
  direct_expenses_total: number;
  pending_supervisor_total: number;
  pending_accounting_total: number;
  pending_vp_total: number;
  pending_president_total: number;
  on_hold_total: number;
  projected_committed_total: number;
  remaining_budget: number;
  projected_remaining_budget: number;
}

export const fetchRequestAllocationsByRequestId = async (requestIds: string[]) => {
  if (!requestIds.length) {
    return new Map<string, RequestAllocationRow[]>();
  }

  const { data, error } = await supabase
    .from('request_allocations')
    .select('id, request_id, department_id, amount, departments(name, fiscal_year)')
    .in('request_id', requestIds);

  if (error) {
    throw error;
  }

  const allocationMap = new Map<string, RequestAllocationRow[]>();
  (data || []).forEach((allocation: any) => {
    const existing = allocationMap.get(allocation.request_id) || [];
    existing.push(allocation);
    allocationMap.set(allocation.request_id, existing);
  });

  return allocationMap;
};

const extractRequestCategoryAllocations = (request: any): RequestCategoryAllocation[] => {
  const allocationsMap = new Map<string, RequestCategoryAllocation>();
  const addAllocation = (categoryId: string | undefined, categoryName: string | undefined, amount: number) => {
    if (!categoryId && !categoryName) return;
    const key = categoryId ? `id:${categoryId}` : `name:${getCategoryMapKey(request.department_id, Number(request.fiscal_year || 0), categoryName || '')}`;
    const existing = allocationsMap.get(key);
    if (existing) {
      existing.amount += amount;
      allocationsMap.set(key, existing);
    } else {
      allocationsMap.set(key, {
        request_id: request.id,
        department_id: request.department_id,
        fiscal_year: Number(request.fiscal_year || 0),
        category_id: categoryId,
        category_name: categoryName,
        amount
      });
    }
  };

  if (Array.isArray(request.metadata?.items) && request.metadata.items.length > 0) {
    request.metadata.items.forEach((item: any) => {
      const itemAmount = toNumber(item.amount);
      if (itemAmount <= 0) return;
      const categoryId = item.category_id ? String(item.category_id).trim() : undefined;
      const categoryName = item.category ? String(item.category).trim() : item.main_category ? String(item.main_category).trim() : undefined;
      addAllocation(categoryId, categoryName, itemAmount);
    });
  }

  if (allocationsMap.size === 0) {
    const categoryId = request.category_id ? String(request.category_id).trim() : undefined;
    const categoryName = request.category ? String(request.category).trim() : request.main_category_name ? String(request.main_category_name).trim() : undefined;
    addAllocation(categoryId, categoryName, toNumber(request.amount));
  }

  return Array.from(allocationsMap.values());
};

const getRequestBudgetImpacts = (
  request: ExpenseRequestRow,
  allocationsByRequestId: Map<string, RequestAllocationRow[]>
) => {
  const allocations = allocationsByRequestId.get(request.id) || [];
  if (request.status === 'pending_supervisor') {
    return [{ department_id: request.department_id, amount: toNumber(request.amount) }];
  }

  if (allocations.length > 0) {
    return allocations.map((allocation) => ({
      department_id: allocation.department_id,
      amount: toNumber(allocation.amount)
    }));
  }

  return [{ department_id: request.department_id, amount: toNumber(request.amount) }];
};

export const buildDepartmentBudgetSummaryMap = async () => {
  const [departmentsResult, requestsResult, directExpensesResult] = await Promise.all([
    supabase
      .from('departments')
      .select('id, name, fiscal_year, annual_budget, used_budget, petty_cash_balance, updated_at, created_at'),
    supabase.from('expense_requests').select('id, department_id, amount, status, request_type'),
    supabase.from('direct_expenses').select('department_id, amount')
  ]);

  if (departmentsResult.error) throw departmentsResult.error;
  if (requestsResult.error) throw requestsResult.error;
  if (directExpensesResult.error) throw directExpensesResult.error;

  const departments = departmentsResult.data || [];
  const requests = (requestsResult.data || []) as ExpenseRequestRow[];
  const directExpenses = directExpensesResult.data || [];
  const allocationsByRequestId = await fetchRequestAllocationsByRequestId(requests.map((request) => request.id));

  const groupedDepartmentIds = new Map<string, string[]>();
  departments.forEach((department) => {
    const key = getDepartmentGroupKey(department);
    const existing = groupedDepartmentIds.get(key) || [];
    existing.push(department.id);
    groupedDepartmentIds.set(key, existing);
  });

  const totalsByDepartmentId = new Map<
    string,
    {
      released: number;
      pendingSupervisor: number;
      pendingAccounting: number;
      pendingVp: number;
      pendingPresident: number;
      onHold: number;
    }
  >();

  requests.forEach((request) => {
    const impacts = getRequestBudgetImpacts(request, allocationsByRequestId);
    impacts.forEach((impact) => {
      const current = totalsByDepartmentId.get(impact.department_id) || {
        released: 0,
        pendingSupervisor: 0,
        pendingAccounting: 0,
        pendingVp: 0,
        pendingPresident: 0,
        onHold: 0
      };

      if (request.status === 'pending_supervisor') {
        current.pendingSupervisor += impact.amount;
      } else if (request.status === 'pending_accounting') {
        current.pendingAccounting += impact.amount;
      } else if (request.status === 'pending_vp') {
        current.pendingVp += impact.amount;
      } else if (request.status === 'pending_president') {
        current.pendingPresident += impact.amount;
      } else if (request.status === 'on_hold') {
        current.onHold += impact.amount;
      } else if (isActualExpenseCommittedStatus(request.status, request.request_type)) {
        current.released += impact.amount;
      }

      totalsByDepartmentId.set(impact.department_id, current);
    });
  });

  const summariesByGroup = new Map<string, DepartmentBudgetSummary>();
  groupedDepartmentIds.forEach((ids, key) => {
    const groupedDepartments = departments.filter((department) => ids.includes(department.id));
    const annualBudget = Math.max(...groupedDepartments.map((entry) => toNumber(entry.annual_budget)), 0);
    const pettyCashBalance = Math.max(...groupedDepartments.map((entry) => toNumber(entry.petty_cash_balance)), 0);
    const directExpensesTotal = directExpenses
      .filter((expense: any) => ids.includes(expense.department_id))
      .reduce((sum: number, expense: any) => sum + toNumber(expense.amount), 0);
    const releasedRequestsTotal = ids.reduce((sum, id) => sum + (totalsByDepartmentId.get(id)?.released || 0), 0);
    const pendingSupervisorTotal = ids.reduce((sum, id) => sum + (totalsByDepartmentId.get(id)?.pendingSupervisor || 0), 0);
    const pendingAccountingTotal = ids.reduce((sum, id) => sum + (totalsByDepartmentId.get(id)?.pendingAccounting || 0), 0);
    const pendingVpTotal = ids.reduce((sum, id) => sum + (totalsByDepartmentId.get(id)?.pendingVp || 0), 0);
    const pendingPresidentTotal = ids.reduce((sum, id) => sum + (totalsByDepartmentId.get(id)?.pendingPresident || 0), 0);
    const onHoldTotal = ids.reduce((sum, id) => sum + (totalsByDepartmentId.get(id)?.onHold || 0), 0);
    const usedBudget = releasedRequestsTotal + directExpensesTotal;
    const projectedCommittedTotal = usedBudget + pendingSupervisorTotal + pendingAccountingTotal + pendingVpTotal + pendingPresidentTotal;
    const currentDepartment =
      groupedDepartments.sort((left, right) => {
        const leftUpdatedAt = new Date(String(left.updated_at || left.created_at || 0)).getTime();
        const rightUpdatedAt = new Date(String(right.updated_at || right.created_at || 0)).getTime();
        return rightUpdatedAt - leftUpdatedAt;
      })[0] || null;

    summariesByGroup.set(key, {
      department_name: currentDepartment?.name || 'Unknown department',
      fiscal_year: currentDepartment?.fiscal_year ?? null,
      annual_budget: annualBudget,
      used_budget: usedBudget,
      petty_cash_balance: pettyCashBalance,
      direct_expenses_total: directExpensesTotal,
      pending_supervisor_total: pendingSupervisorTotal,
      pending_accounting_total: pendingAccountingTotal,
      pending_vp_total: pendingVpTotal,
      pending_president_total: pendingPresidentTotal,
      on_hold_total: onHoldTotal,
      projected_committed_total: projectedCommittedTotal,
      remaining_budget: annualBudget - usedBudget,
      projected_remaining_budget: annualBudget - projectedCommittedTotal
    });
  });

  const summaryByDepartmentId = new Map<string, DepartmentBudgetSummary>();
  departments.forEach((department) => {
    summaryByDepartmentId.set(department.id, summariesByGroup.get(getDepartmentGroupKey(department)) as DepartmentBudgetSummary);
  });

  return {
    summaryByDepartmentId,
    allocationsByRequestId
  };
};

export const enrichRequests = async (
  rows: any[],
  budgetSummaryMap: Map<string, DepartmentBudgetSummary>,
  allocationsByRequestId: Map<string, RequestAllocationRow[]>
) => {
  const requestCategoryAllocationsByRequestId = new Map<string, RequestCategoryAllocation[]>();
  const categoryIds = new Set<string>();
  const categoryNameLookup = new Set<string>();
  const categoryNameValues = new Set<string>();
  const departmentIds = new Set<string>();
  const fiscalYears = new Set<number>();

  rows.forEach((row) => {
    const allocations = extractRequestCategoryAllocations(row);
    requestCategoryAllocationsByRequestId.set(row.id, allocations);

    allocations.forEach((allocation) => {
      if (allocation.category_id) {
        categoryIds.add(allocation.category_id);
      } else if (allocation.category_name) {
        categoryNameLookup.add(getCategoryMapKey(allocation.department_id, allocation.fiscal_year, allocation.category_name));
        categoryNameValues.add(allocation.category_name);
        departmentIds.add(allocation.department_id);
        fiscalYears.add(allocation.fiscal_year);
      }
    });
  });

  const categoriesById = new Map<string, any>();
  const categoriesByNameKey = new Map<string, any>();

  if (categoryIds.size > 0) {
    const { data: categories } = await supabase
      .from('budget_categories')
      .select('id, category_name, department_id, fiscal_year, remaining_amount')
      .in('id', Array.from(categoryIds));

    (categories || []).forEach((category: any) => {
      categoriesById.set(String(category.id), category);
      categoriesByNameKey.set(
        getCategoryMapKey(String(category.department_id), Number(category.fiscal_year), String(category.category_name)),
        category
      );
    });
  }

  if (categoryNameValues.size > 0 && departmentIds.size > 0 && fiscalYears.size > 0) {
    const query = supabase
      .from('budget_categories')
      .select('id, category_name, department_id, fiscal_year, remaining_amount')
      .in('category_name', Array.from(categoryNameValues))
      .in('department_id', Array.from(departmentIds))
      .in('fiscal_year', Array.from(fiscalYears));

    const { data: categories } = await query;
    (categories || []).forEach((category: any) => {
      categoriesByNameKey.set(
        getCategoryMapKey(String(category.department_id), Number(category.fiscal_year), String(category.category_name)),
        category
      );
    });
  }

  return rows.map((row) => {
    const amount = toNumber(row.amount);
    const requestFallbackSummary = budgetSummaryMap.get(row.department_id) || null;
    const sourceAllocations = allocationsByRequestId.get(row.id) || [];
    const fallbackAllocation = sourceAllocations.length
      ? sourceAllocations
      : [{ request_id: row.id, department_id: row.department_id, amount }];

    const allocations = fallbackAllocation.map((allocation) => {
      const departmentSummary = budgetSummaryMap.get(allocation.department_id) || requestFallbackSummary;
      const allocationAmount = toNumber(allocation.amount);

      return {
        ...allocation,
        amount: allocationAmount,
        department_name: departmentSummary?.department_name || 'Unknown department',
        annual_budget: departmentSummary?.annual_budget ?? 0,
        used_budget: departmentSummary?.used_budget ?? 0,
        remaining_budget: departmentSummary?.remaining_budget ?? 0,
        projected_remaining_budget: departmentSummary?.projected_remaining_budget ?? 0,
        projected_remaining_after_approval: departmentSummary
          ? departmentSummary.remaining_budget - allocationAmount
          : 0
      };
    });

    const totalProjectedAfterApproval = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
    const categoryAllocations = requestCategoryAllocationsByRequestId.get(row.id) || [];
    const withinBudget = categoryAllocations.length > 0
      ? categoryAllocations.every((allocation) => {
          const category = allocation.category_id
            ? categoriesById.get(String(allocation.category_id))
            : categoriesByNameKey.get(getCategoryMapKey(allocation.department_id, allocation.fiscal_year, allocation.category_name || ''));
          return category ? toNumber(allocation.amount) <= toNumber(category.remaining_amount) : false;
        })
      : requestFallbackSummary
        ? toNumber(row.amount) <= requestFallbackSummary.remaining_budget
        : true;

    return {
      ...row,
      within_budget: withinBudget,
      requester_name: row.users?.name || 'Unknown requester',
      department_name: requestFallbackSummary?.department_name || row.departments?.name || 'Unknown department',
      allocations,
      budget_summary: requestFallbackSummary
        ? {
            ...requestFallbackSummary,
            request_amount: amount,
            projected_used_after_approval: requestFallbackSummary.used_budget + totalProjectedAfterApproval,
            projected_remaining_after_approval: requestFallbackSummary.remaining_budget - totalProjectedAfterApproval
          }
        : null
    };
  });
};

export const enrichRequestsWithMainCategory = async (rows: any[]) => {
  if (!rows?.length) return [];

  const categoryIds = new Set<string>();
  for (const row of rows) {
    if (row.category_id) categoryIds.add(row.category_id);
    for (const item of row.metadata?.items || []) {
      if (item.category_id) categoryIds.add(item.category_id);
    }
  }

  const catById = new Map<string, any>();
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
      .filter((id: string | null) => id && !catById.has(id));

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

  const resolveMainNameFromCategoryId = (categoryId?: string | null) => {
    if (!categoryId) return null;
    const cat = catById.get(categoryId);
    if (!cat) return null;
    if (!cat.parent_category_id) return cat.category_name;
    const parent = catById.get(cat.parent_category_id);
    return parent?.category_name || cat.category_name;
  };

  return rows.map((row) => {
    const isBudget = row.request_type === 'budget_request' || row.request_type === 'budget_revision';
    let mainCategoryName: string | null = row.metadata?.main_category || null;

    if (!mainCategoryName && row.category_id) {
      mainCategoryName = resolveMainNameFromCategoryId(row.category_id);
    }
    if (!mainCategoryName && isBudget) {
      mainCategoryName = row.category || null;
    }
    if (!mainCategoryName && row.metadata?.items?.length) {
      const fromItems = row.metadata.items
        .map((item: any) => item.main_category || resolveMainNameFromCategoryId(item.category_id))
        .filter(Boolean);
      if (fromItems.length === 1) mainCategoryName = fromItems[0];
    }

    const enrichedItems = (row.metadata?.items || []).map((item: any) => ({
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
      metadata: row.metadata
        ? { ...row.metadata, items: enrichedItems.length ? enrichedItems : row.metadata.items }
        : row.metadata,
    };
  });
};

export const normalizeAllocations = (request: { department_id: string; amount: number | string }, allocations: any[]) => {
  const source = allocations.length
    ? allocations
    : [{ department_id: request.department_id, amount: request.amount }];

  const merged = new Map<string, number>();
  source.forEach((allocation) => {
    const departmentId = String(allocation.department_id || '').trim();
    const amount = toNumber(allocation.amount);
    if (!departmentId || amount <= 0) return;
    merged.set(departmentId, (merged.get(departmentId) || 0) + amount);
  });

  return Array.from(merged.entries()).map(([department_id, amount]) => ({ department_id, amount }));
};

export const allocationTotalsMatchRequest = (requestAmount: number | string, allocations: { amount: number }[]) => {
  const total = allocations.reduce((sum, allocation) => sum + toNumber(allocation.amount), 0);
  return total.toFixed(2) === toNumber(requestAmount).toFixed(2);
};
