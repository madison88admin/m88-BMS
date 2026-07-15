const PREFETCH_KEY_EXPENSE_CATEGORIES = 'prefetch_expense_categories';

const ALLOWED_MAIN_CODES = new Set([
  '6010','6020','6040','6041','6170','6240','6330','6340','6350',
  '6430','6490','6500','6650','6670','6710','6720','6840','6860','6870','6900','9900'
]);

const DEPT_NAME_MAP: Record<string,string> = {
  'HR Department': 'HR',
  'Admin Department': 'Admin',
  'Finance Department': 'Accounting',
  'IT Department': 'IT'
};

export function getCachedExpenseCategories(): Array<any> | null {
  try {
    const raw = localStorage.getItem(PREFETCH_KEY_EXPENSE_CATEGORIES);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.data) ? parsed.data : null;
  } catch (err) {
    return null;
  }
}

export function mapDepartmentNameToShort(name?: string): string | null {
  if (!name) return null;
  const mapped = DEPT_NAME_MAP[String(name).trim()];
  if (mapped) return mapped;
  return null;
}

export function filterCategoriesForUser(categories: any[], user: any, departmentName?: string): any[] {
  return Array.isArray(categories) ? categories : [];
}

export default { filterCategoriesForUser, getCachedExpenseCategories, mapDepartmentNameToShort };
