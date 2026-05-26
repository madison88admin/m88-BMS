import { fetchRequestAllocationsByRequestId, isBudgetCommittedStatus, isPendingBudgetStatus } from './budget';
import { toCanonicalDepartmentName } from './fiscal';

const toNumber = (value: unknown) => Number.parseFloat(String(value ?? 0)) || 0;

const slugCategoryCode = (name: string, index: number) => {
  const leading = String(name || '').match(/^(\d{4,5})\b/);
  if (leading) return leading[1];
  const compact = String(name || '')
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 8)
    .toUpperCase();
  return compact.length >= 3 ? compact : `REC${String(index + 1).padStart(3, '0')}`;
};

const assignUniqueCategoryCodes = (
  drafts: Array<{ category_name: string; category_code?: string; budget_amount?: number; used_amount?: number; committed_amount?: number; remaining_amount?: number; [key: string]: unknown }>,
  reservedCodes: Set<string>
) => {
  const usedCodes = new Set(reservedCodes);
  const leadCodeCounts = new Map<string, number>();

  drafts.forEach((draft) => {
    const leading = String(draft.category_name || '').match(/^(\d{4,5})\b/);
    if (leading) {
      leadCodeCounts.set(leading[1], (leadCodeCounts.get(leading[1]) || 0) + 1);
    }
  });

  return drafts.map((draft, index) => {
    const leading = String(draft.category_name || '').match(/^(\d{4,5})\b/);
    const leadCode = leading?.[1];
    let categoryCode =
      leadCode && leadCodeCounts.get(leadCode) === 1 && !usedCodes.has(leadCode)
        ? leadCode
        : slugCategoryCode(String(draft.category_name), index);

    while (usedCodes.has(categoryCode)) {
      categoryCode = `REC${String(index + 1).padStart(3, '0')}`;
    }

    usedCodes.add(categoryCode);
    return { ...draft, category_code: categoryCode };
  });
};

type CategoryRow = {
  id: string;
  department_id: string;
  fiscal_year: number;
  category_code: string;
  category_name: string;
  budget_amount: number;
  used_amount?: number;
  committed_amount?: number;
  remaining_amount?: number;
  parent_category_id?: string | null;
};

const fetchCategoriesForDepartments = async (
  supabase: any,
  departmentIds: string[],
  fiscalYear: number
) => {
  if (!departmentIds.length) return [] as CategoryRow[];

  const { data, error } = await supabase
    .from('budget_categories')
    .select(
      'id, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, department_id, parent_category_id, fiscal_year'
    )
    .in('department_id', departmentIds)
    .eq('fiscal_year', fiscalYear)
    .order('category_name');

  if (error) throw error;
  return (data || []) as CategoryRow[];
};

const findSourceCategories = async (
  supabase: any,
  canonicalName: string,
  targetDepartmentId: string,
  targetFiscalYear: number
) => {
  const { data: allDepartments, error: departmentsError } = await supabase
    .from('departments')
    .select('id, name, fiscal_year');

  if (departmentsError) throw departmentsError;

  const relatedDepartmentIds = (allDepartments || [])
    .filter((department: { name: string }) => toCanonicalDepartmentName(department.name) === canonicalName)
    .map((department: { id: string }) => department.id)
    .filter((id: string) => id !== targetDepartmentId);

  if (!relatedDepartmentIds.length) return [] as CategoryRow[];

  const { data: sourceCategories, error: categoriesError } = await supabase
    .from('budget_categories')
    .select('*')
    .in('department_id', relatedDepartmentIds)
    .order('fiscal_year', { ascending: false });

  if (categoriesError) throw categoriesError;
  if (!sourceCategories?.length) return [] as CategoryRow[];

  const latestSourceFiscalYear = Math.max(
    ...sourceCategories.map((category: CategoryRow) => Number(category.fiscal_year || 0))
  );

  const latestYearCategories = sourceCategories.filter(
    (category: CategoryRow) => Number(category.fiscal_year) === latestSourceFiscalYear
  );

  const dedupedByCode = new Map<string, CategoryRow>();
  latestYearCategories.forEach((category: CategoryRow) => {
    const code = String(category.category_code || '').trim().toUpperCase();
    if (!code || dedupedByCode.has(code)) return;
    dedupedByCode.set(code, category);
  });

  return Array.from(dedupedByCode.values());
};

const copyCategoriesToDepartment = async (
  supabase: any,
  sourceCategories: CategoryRow[],
  targetDepartmentId: string,
  targetFiscalYear: number
) => {
  const sourceById = new Map(sourceCategories.map((category) => [category.id, category]));
  const parents = sourceCategories.filter((category) => !category.parent_category_id);
  const children = sourceCategories.filter((category) => category.parent_category_id);
  const newIdByCode = new Map<string, string>();
  const now = new Date().toISOString();

  for (const source of parents) {
    const code = String(source.category_code || '').trim().toUpperCase();
    const budgetAmount = toNumber(source.budget_amount);
    const { data: inserted, error } = await supabase
      .from('budget_categories')
      .insert({
        department_id: targetDepartmentId,
        fiscal_year: targetFiscalYear,
        category_code: code,
        category_name: source.category_name,
        budget_amount: budgetAmount,
        used_amount: 0,
        committed_amount: 0,
        remaining_amount: budgetAmount,
        parent_category_id: null,
        updated_at: now
      })
      .select(
        'id, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, department_id, parent_category_id'
      )
      .single();

    if (error) throw error;
    if (inserted?.id) newIdByCode.set(code, inserted.id);
  }

  for (const source of children) {
    const code = String(source.category_code || '').trim().toUpperCase();
    const budgetAmount = toNumber(source.budget_amount);
    const parentSource = sourceById.get(String(source.parent_category_id || ''));
    const parentCode = parentSource ? String(parentSource.category_code || '').trim().toUpperCase() : '';
    const parentCategoryId = parentCode ? newIdByCode.get(parentCode) || null : null;

    const { data: inserted, error } = await supabase
      .from('budget_categories')
      .insert({
        department_id: targetDepartmentId,
        fiscal_year: targetFiscalYear,
        category_code: code,
        category_name: source.category_name,
        budget_amount: budgetAmount,
        used_amount: 0,
        committed_amount: 0,
        remaining_amount: budgetAmount,
        parent_category_id: parentCategoryId,
        updated_at: now
      })
      .select(
        'id, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, department_id, parent_category_id'
      )
      .single();

    if (error) throw error;
    if (inserted?.id) newIdByCode.set(code, inserted.id);
  }

  const restored = await fetchCategoriesForDepartments(supabase, [targetDepartmentId], targetFiscalYear);
  const categoryBudgetTotal = restored.reduce((sum, category) => sum + toNumber(category.budget_amount), 0);

  if (categoryBudgetTotal > 0) {
    const { data: department } = await supabase
      .from('departments')
      .select('name')
      .eq('id', targetDepartmentId)
      .single();

    if (department?.name) {
      await supabase
        .from('departments')
        .update({ annual_budget: categoryBudgetTotal, updated_at: new Date().toISOString() })
        .ilike('name', department.name)
        .eq('fiscal_year', targetFiscalYear);
    }
  }

  return restored;
};

const getRelatedDepartmentIdsForCanonical = async (supabase: any, canonicalName: string) => {
  const { data: allDepartments, error } = await supabase.from('departments').select('id, name');
  if (error) throw error;
  return (allDepartments || [])
    .filter((department: { name: string }) => toCanonicalDepartmentName(department.name) === canonicalName)
    .map((department: { id: string }) => department.id);
};

/** Rebuild categories from expense request / direct expense history when DB rows were cascade-deleted. */
export const recoverCategoriesFromExpenseHistory = async (
  supabase: any,
  targetDepartmentId: string,
  targetFiscalYear: number,
  canonicalName: string
) => {
  const relatedDepartmentIds = await getRelatedDepartmentIdsForCanonical(supabase, canonicalName);
  const currentYearIds = relatedDepartmentIds.length ? relatedDepartmentIds : [targetDepartmentId];

  const { data: requests, error: requestsError } = await supabase
    .from('expense_requests')
    .select('id, category, amount, status, department_id, fiscal_year')
    .eq('fiscal_year', targetFiscalYear);

  if (requestsError) throw requestsError;

  const requestIds = (requests || []).map((request: { id: string }) => request.id);
  const allocationsByRequestId = await fetchRequestAllocationsByRequestId(requestIds);

  const categoryTotals = new Map<
    string,
    { displayName: string; used: number; committed: number; observed: number }
  >();

  const addCategoryAmount = (rawName: string, amount: number, status?: string) => {
    const name = String(rawName || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    const stats = categoryTotals.get(key) || { displayName: name, used: 0, committed: 0, observed: 0 };
    const value = toNumber(amount);
    stats.observed += value;
    if (isBudgetCommittedStatus(status)) stats.used += value;
    else if (isPendingBudgetStatus(status)) stats.committed += value;
    categoryTotals.set(key, stats);
  };

  (requests || []).forEach((request: any) => {
    const allocations = allocationsByRequestId.get(request.id) || [];
    const impacts =
      allocations.length > 0
        ? allocations
            .filter((allocation) => currentYearIds.includes(allocation.department_id))
            .map((allocation) => ({ amount: toNumber(allocation.amount), status: request.status }))
        : currentYearIds.includes(request.department_id)
          ? [{ amount: toNumber(request.amount), status: request.status }]
          : [];

    impacts.forEach((impact) => addCategoryAmount(request.category, impact.amount, impact.status));
  });

  const { data: directExpenses, error: directExpensesError } = await supabase
    .from('direct_expenses')
    .select('category, amount')
    .in('department_id', currentYearIds);

  if (directExpensesError) throw directExpensesError;

  (directExpenses || []).forEach((expense: any) => {
    addCategoryAmount(expense.category, expense.amount, 'released');
  });

  if (!categoryTotals.size) return [] as CategoryRow[];

  const { data: department } = await supabase
    .from('departments')
    .select('annual_budget')
    .eq('id', targetDepartmentId)
    .single();

  const departmentBudget = toNumber(department?.annual_budget);
  const observedTotal = Array.from(categoryTotals.values()).reduce((sum, stats) => sum + stats.observed, 0);
  const budgetScale =
    departmentBudget > observedTotal && observedTotal > 0 ? departmentBudget / observedTotal : 1.15;

  const draftCategories = Array.from(categoryTotals.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, stats]) => {
      const displayName = stats.displayName;
      const budgetAmount = Math.max(
        Math.ceil(stats.observed * budgetScale),
        Math.ceil((stats.used + stats.committed) * 1.1),
        1000
      );

      return {
        category_name: displayName,
        budget_amount: budgetAmount,
        used_amount: stats.used,
        committed_amount: stats.committed,
        remaining_amount: Math.max(0, budgetAmount - stats.used - stats.committed)
      };
    });

  const { data: existingRows } = await supabase
    .from('budget_categories')
    .select(
      'id, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, department_id, parent_category_id'
    )
    .eq('department_id', targetDepartmentId)
    .eq('fiscal_year', targetFiscalYear);

  const existingNames = new Set(
    (existingRows || []).map((row: { category_name: string }) =>
      String(row.category_name || '').trim().toLowerCase()
    )
  );
  const reservedCodes = new Set(
    (existingRows || []).map((row: { category_code: string }) =>
      String(row.category_code || '').trim().toUpperCase()
    )
  );

  const draftsToInsert = assignUniqueCategoryCodes(
    draftCategories.filter(
      (draft) => !existingNames.has(String(draft.category_name).trim().toLowerCase())
    ),
    reservedCodes as Set<string>
  );

  const now = new Date().toISOString();
  const inserted: CategoryRow[] = [...((existingRows || []) as CategoryRow[])];

  for (const draft of draftsToInsert) {
    const { data: row, error } = await supabase
      .from('budget_categories')
      .insert({
        department_id: targetDepartmentId,
        fiscal_year: targetFiscalYear,
        category_code: draft.category_code,
        category_name: draft.category_name,
        budget_amount: (draft as any).budget_amount || 0,
        used_amount: (draft as any).used_amount || 0,
        committed_amount: (draft as any).committed_amount || 0,
        remaining_amount: (draft as any).remaining_amount || 0,
        parent_category_id: null,
        updated_at: now
      })
      .select(
        'id, category_code, category_name, budget_amount, used_amount, committed_amount, remaining_amount, department_id, parent_category_id'
      )
      .single();

    if (error) throw error;
    if (row) inserted.push(row as CategoryRow);
  }

  const categoryBudgetTotal = inserted.reduce((sum, category) => sum + toNumber(category.budget_amount), 0);
  if (categoryBudgetTotal > 0) {
    await supabase
      .from('departments')
      .update({ annual_budget: categoryBudgetTotal, updated_at: now })
      .ilike('name', canonicalName)
      .eq('fiscal_year', targetFiscalYear);
  }

  return inserted;
};

/** Copy categories from the latest prior fiscal year (or legacy dept) when the target FY row has none. */
export const restoreBudgetCategoriesIfEmpty = async (
  supabase: any,
  targetDepartmentId: string
): Promise<{ restored: boolean; source: 'existing' | 'copy' | 'history' | 'none'; categories: CategoryRow[] }> => {
  const { data: targetDepartment, error: targetError } = await supabase
    .from('departments')
    .select('id, name, fiscal_year')
    .eq('id', targetDepartmentId)
    .single();

  if (targetError || !targetDepartment) {
    return { restored: false, source: 'none', categories: [] as CategoryRow[] };
  }

  const targetFiscalYear = Number(targetDepartment.fiscal_year);
  const existing = await fetchCategoriesForDepartments(supabase, [targetDepartmentId], targetFiscalYear);
  if (existing.length) {
    return { restored: false, source: 'existing', categories: existing };
  }

  const canonicalName = toCanonicalDepartmentName(targetDepartment.name);
  if (!canonicalName) {
    return { restored: false, source: 'none', categories: [] as CategoryRow[] };
  }

  const sourceCategories = await findSourceCategories(
    supabase,
    canonicalName,
    targetDepartmentId,
    targetFiscalYear
  );

  if (sourceCategories.length) {
    const categories = await copyCategoriesToDepartment(
      supabase,
      sourceCategories,
      targetDepartmentId,
      targetFiscalYear
    );
    return { restored: true, source: 'copy', categories };
  }

  const historyCategories = await recoverCategoriesFromExpenseHistory(
    supabase,
    targetDepartmentId,
    targetFiscalYear,
    canonicalName
  );

  if (historyCategories.length) {
    return { restored: true, source: 'history', categories: historyCategories };
  }

  return { restored: false, source: 'none', categories: [] as CategoryRow[] };
};

/** Restore empty category sets for every department in a fiscal year. */
export const restoreAllBudgetCategoriesForFiscalYear = async (supabase: any, fiscalYear: number) => {
  const { data: yearDepartments, error } = await supabase
    .from('departments')
    .select('id, name, fiscal_year')
    .eq('fiscal_year', fiscalYear);

  if (error) throw error;

  const results: Array<{
    departmentId: string;
    name: string;
    restored: boolean;
    source: string;
    count: number;
  }> = [];

  for (const department of yearDepartments || []) {
    if (/^m88/i.test(String(department.name || ''))) continue;

    const { restored, source, categories } = await restoreBudgetCategoriesIfEmpty(supabase, department.id);
    results.push({
      departmentId: department.id,
      name: department.name,
      restored,
      source,
      count: categories.length
    });
  }

  return results;
};

export const loadBudgetCategoriesForBreakdown = async (
  supabase: any,
  departmentIds: string[],
  fiscalYear: number,
  primaryDepartmentId: string
) => {
  let categories = await fetchCategoriesForDepartments(supabase, departmentIds, fiscalYear);

  if (!categories.length) {
    const { restored, categories: restoredCategories } = await restoreBudgetCategoriesIfEmpty(
      supabase,
      primaryDepartmentId
    );
    if (restored) {
      categories = restoredCategories;
    }
  }

  return categories;
};
