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
  if (!Array.isArray(categories)) return [];
  const role = String((user && user.role) || '').toLowerCase();
  const filteredRoles = new Set(['employee','supervisor','manager','vp','president']);
  if (!filteredRoles.has(role)) return categories; // accounting/admin/super_admin view all

  const expenseCats = getCachedExpenseCategories();
  if (!expenseCats) return categories; // if we don't have expense mapping cached, avoid blocking UI — fall back to server filtering

  const deptShort = mapDepartmentNameToShort(departmentName || '');

  // Build set of allowed codes from expense_categories cache
  const allowed = new Set<string>();
  expenseCats.forEach((ec: any) => {
    const code = String(ec.main_category_code || '').trim();
    const dept = String(ec.department || '').trim();
    if (!code) return;
    if (!ALLOWED_MAIN_CODES.has(code)) return;
    if (dept === 'All') { allowed.add(code); return; }
    if (deptShort && dept === deptShort) { allowed.add(code); return; }
  });

  // Filter categories: only main categories, allowed codes present
  return categories.filter(cat => {
    if (cat.parent_category_id) return false; // only main categories
    const code = String(cat.category_code || '').trim();
    if (!ALLOWED_MAIN_CODES.has(code)) return false;
    if (allowed.size === 0) return false;
    return allowed.has(code);
  });
}

export default { filterCategoriesForUser, getCachedExpenseCategories, mapDepartmentNameToShort };
