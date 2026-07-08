import { supabase } from './supabase';
import { ExpenseItem, OFFICIAL_EXPENSE_LIST } from './expenseValidator';
import { resolveExpenseCategoryDepartmentName } from '../constants/departmentMapping';

export type ExpenseCategoryRow = {
  code: string;
  description: string;
  main_category_code: string;
  main_category_name: string;
  department: string;
  manner_of_submission: 'for_submission' | 'for_upload';
  cash_advance_allowed: boolean;
  reimbursement_allowed: boolean;
};

/** Map seed department labels to department names used in the app. */
export const mapSeedDepartmentToExpenseDept = (department: string): string => {
  const resolved = resolveExpenseCategoryDepartmentName(department);
  return resolved === null ? 'All Dept' : resolved;
};

export const dbRowToExpenseItem = (row: ExpenseCategoryRow): ExpenseItem => ({
  code: row.code,
  itemName: row.description,
  category: row.main_category_name,
  dept: mapSeedDepartmentToExpenseDept(row.department),
  canCA: Boolean(row.cash_advance_allowed),
  canRE: Boolean(row.reimbursement_allowed),
  mannerOfSubmission: row.manner_of_submission,
});

export const loadOfficialExpenseListFromDb = async (): Promise<ExpenseItem[] | null> => {
  try {
    const { data, error } = await supabase
      .from('expense_categories')
      .select('*')
      .order('code');

    if (error) {
      console.warn('[expense_categories] load failed:', error.message);
      return null;
    }
    if (!data?.length) return null;
    return data.map((row) => dbRowToExpenseItem(row as ExpenseCategoryRow));
  } catch (err: any) {
    console.warn('[expense_categories] unexpected load failure:', err?.message || err);
    return null;
  }
};

const FOR_UPLOAD_FALLBACK_CODES = new Set([
  '6020.1', '6020.2', '6020.3', '6020.5', '6020.6',
  '6040', '6041', '6240', '6330', '6340', '6351', '6352',
  '6670.01', '6670.08', '6670.1', '6670.12', '6670.18', '6670.24',
  '6711', '6860.1', '6860.2', '6860.3', '6870.1', '6870.2', '6870.3', '6870.5',
  '1700', '1701', '1702', '1703', '1704',
]);

const applyFallbackSubmissionDefaults = (items: ExpenseItem[]): ExpenseItem[] =>
  items.map((item) => ({
    ...item,
    mannerOfSubmission: FOR_UPLOAD_FALLBACK_CODES.has(item.code) ? 'for_upload' : 'for_submission',
  }));

export const resolveOfficialExpenseList = async (): Promise<ExpenseItem[]> => {
  const fromDb = await loadOfficialExpenseListFromDb();
  const fallback = applyFallbackSubmissionDefaults(OFFICIAL_EXPENSE_LIST);
  const dbItems = fromDb || [];

  // Merge: DB items take precedence for overlapping codes, but fallback ensures
  // Cost of Services / Payroll codes are always present even if the DB table
  // only contains the Expenses section.
  const mergedByCode = new Map<string, ExpenseItem>();
  fallback.forEach((item) => mergedByCode.set(item.code, item));
  dbItems.forEach((item) => mergedByCode.set(item.code, item));

  return Array.from(mergedByCode.values()).sort((a, b) => a.code.localeCompare(b.code));
};

const isStaffRole = (role?: string) =>
  ['employee', 'manager', 'supervisor'].includes(String(role || '').toLowerCase());

const isAccountingRole = (role?: string) =>
  ['accounting', 'accounting_limited', 'admin', 'super_admin'].includes(String(role || '').toLowerCase());

export const departmentMatchesExpenseItem = (departmentName: string, item: ExpenseItem): boolean => {
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

export const filterOfficialExpenseList = (
  items: ExpenseItem[],
  options: {
    requestType?: 'cash_advance' | 'reimbursement' | 'liquidation';
    departmentName?: string;
    userRole?: string;
    mannerOfSubmission?: 'for_submission' | 'for_upload';
  } = {}
): ExpenseItem[] => {
  const { requestType, departmentName, userRole, mannerOfSubmission } = options;

  return items.filter((item) => {
    const submissionMode = item.mannerOfSubmission || 'for_submission';

    if (mannerOfSubmission) {
      if (submissionMode !== mannerOfSubmission) return false;
    } else {
      if (submissionMode === 'for_upload') return false;
    }

    if (!isAccountingRole(userRole) && !item.canCA && !item.canRE) return false;

    if (requestType === 'cash_advance' && !item.canCA) return false;
    if (requestType === 'reimbursement' && !item.canRE) return false;

    if (departmentName && !departmentMatchesExpenseItem(departmentName, item)) return false;

    return true;
  });
};
