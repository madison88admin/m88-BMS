const { supabase } = require('./supabase');
const { OFFICIAL_EXPENSE_LIST } = require('./expenseValidator');

const FOR_UPLOAD_FALLBACK_CODES = new Set([
  '6020.1', '6020.2', '6020.3', '6020.5', '6020.6',
  '6040', '6041', '6240', '6330', '6340', '6351', '6352',
  '6670.01', '6670.08', '6670.1', '6670.12', '6670.18', '6670.24',
  '6711', '6860.1', '6860.2', '6860.3', '6870.1', '6870.2', '6870.3', '6870.5',
]);

const mapSeedDepartmentToExpenseDept = (department) => {
  const normalized = String(department || '').trim().toLowerCase();
  if (normalized === 'all') return 'All Dept';
  if (normalized === 'hr') return 'HR Department';
  if (normalized === 'admin') return 'Admin Department';
  if (normalized === 'accounting') return 'Finance Department';
  if (normalized === 'it') return 'IT Department';
  return department;
};

const dbRowToExpenseItem = (row) => ({
  code: row.code,
  itemName: row.description,
  category: row.main_category_name,
  dept: mapSeedDepartmentToExpenseDept(row.department),
  canCA: Boolean(row.cash_advance_allowed),
  canRE: Boolean(row.reimbursement_allowed),
  mannerOfSubmission: row.manner_of_submission,
});

const applyFallbackSubmissionDefaults = (items) =>
  items.map((item) => ({
    ...item,
    mannerOfSubmission: FOR_UPLOAD_FALLBACK_CODES.has(item.code) ? 'for_upload' : 'for_submission',
  }));

const loadOfficialExpenseListFromDb = async () => {
  try {
    const { data, error } = await supabase.from('expense_categories').select('*').order('code');
    if (error || !data?.length) return null;
    return data.map(dbRowToExpenseItem);
  } catch {
    return null;
  }
};

const resolveOfficialExpenseList = async () => {
  const fromDb = await loadOfficialExpenseListFromDb();
  if (fromDb?.length) return fromDb;
  return applyFallbackSubmissionDefaults(OFFICIAL_EXPENSE_LIST);
};

const mergeBudgetCategoriesIntoOfficialList = (officialItems, budgetCategories, departmentName) => {
  const merged = [...officialItems];
  const topLevelWithOfficialItems = new Set(officialItems.map((item) => item.category));

  for (const cat of budgetCategories) {
    const categoryName = String(cat.category_name || '').trim();
    if (!categoryName) continue;

    const parentName = String(cat.parent_category_name || '').trim();
    const groupCategory = parentName || categoryName;
    const itemName = categoryName;
    const code = String(cat.category_code || categoryName).trim();

    const alreadyAdded = merged.some(
      (entry) => entry.category === groupCategory && entry.itemName === itemName && entry.code === code
    );
    if (alreadyAdded) continue;
    if (!parentName && topLevelWithOfficialItems.has(categoryName)) continue;

    merged.push({
      code,
      itemName,
      category: groupCategory,
      dept: departmentName || 'All Dept',
      canCA: true,
      canRE: true,
      mannerOfSubmission: 'for_submission',
    });
  }

  return merged;
};

const isStaffRole = (role) => ['employee', 'manager', 'supervisor'].includes(String(role || '').toLowerCase());
const isAccountingRole = (role) =>
  ['accounting', 'accounting_limited', 'admin', 'super_admin'].includes(String(role || '').toLowerCase());

const departmentMatchesExpenseItem = (departmentName, item) => {
  const userDept = departmentName.trim().toLowerCase();
  if (!userDept) return true;

  const allowedDepts = (Array.isArray(item.dept) ? item.dept : [item.dept]).map((d) => d.toLowerCase());
  if (allowedDepts.includes('all dept')) return true;

  return allowedDepts.some((allowed) => {
    const allowedCore = allowed.replace(/\s+department$/i, '').trim();
    const userCore = userDept.replace(/\s+department$/i, '').trim();
    return userDept.includes(allowed) || allowed.includes(userDept) || userCore === allowedCore;
  });
};

const filterOfficialExpenseList = (items, options = {}) => {
  const { requestType, departmentName, userRole } = options;
  const staff = isStaffRole(userRole);

  return items.filter((item) => {
    const submissionMode = item.mannerOfSubmission || 'for_submission';
    if (staff && submissionMode === 'for_upload') return false;
    if (!isAccountingRole(userRole) && !item.canCA && !item.canRE) return false;
    if (requestType === 'cash_advance' && !item.canCA) return false;
    if (requestType === 'reimbursement' && !item.canRE) return false;
    if (departmentName && !departmentMatchesExpenseItem(departmentName, item)) return false;
    return true;
  });
};

const buildOfficialListForDepartment = async (departmentId, fiscalYear, baseList) => {
  const [{ data: budgetCategories, error: budgetError }, { data: deptData }] = await Promise.all([
    supabase
      .from('budget_categories')
      .select('id, category_code, category_name, parent_category_id')
      .eq('department_id', departmentId)
      .eq('fiscal_year', fiscalYear),
    supabase.from('departments').select('name').eq('id', departmentId).maybeSingle(),
  ]);

  const departmentName = deptData?.name || 'All Dept';
  if (budgetError || !budgetCategories?.length) return baseList;

  const allowedCategories = budgetCategories.map((bc) => bc.category_name);
  const filteredList = baseList.filter((item) => allowedCategories.includes(item.category));

  const nameById = new Map((budgetCategories || []).map((bc) => [bc.id, bc.category_name]));
  const enrichedCategories = (budgetCategories || []).map((bc) => ({
    ...bc,
    parent_category_name: bc.parent_category_id ? nameById.get(bc.parent_category_id) || null : null,
  }));

  return mergeBudgetCategoriesIntoOfficialList(filteredList, enrichedCategories, departmentName);
};

module.exports = {
  resolveOfficialExpenseList,
  filterOfficialExpenseList,
  buildOfficialListForDepartment,
};
