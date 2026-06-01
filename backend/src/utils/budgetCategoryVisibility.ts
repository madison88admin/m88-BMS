import { expenseCategoryAllowsDepartment } from '../constants/departmentMapping';

const normalizeRole = (role?: string) => String(role || '').trim().toLowerCase();

const shouldApplyVisibilityFilter = (role?: string) => {
  const normalized = normalizeRole(role);
  return normalized === 'employee' || normalized === 'manager' || normalized === 'supervisor';
};

const normalizeCategoryCode = (value: unknown) => String(value || '').trim().toUpperCase();

const loadDepartmentNameById = async (supabase: any, departmentIds: string[]) => {
  const ids = Array.from(new Set(departmentIds.map((id) => String(id || '').trim()).filter(Boolean)));
  if (!ids.length) return new Map<string, string>();

  const { data, error } = await supabase.from('departments').select('id, name').in('id', ids);
  if (error) throw error;
  return new Map((data || []).map((row: any) => [String(row.id), String(row.name || '').trim()]));
};

export const filterBudgetCategoriesForUser = async (
  supabase: any,
  categories: any[],
  options: { userRole?: string; departmentNameById?: Map<string, string> } = {}
) => {
  if (!categories?.length) return categories || [];
  if (!shouldApplyVisibilityFilter(options.userRole)) return categories;

  const departmentNameById =
    options.departmentNameById
    || (await loadDepartmentNameById(
      supabase,
      categories.map((category) => String(category.department_id || '').trim())
    ));

  const mainCodes = Array.from(
    new Set(categories.map((category) => normalizeCategoryCode(category.category_code)).filter(Boolean))
  );

  if (!mainCodes.length) return categories;

  const { data: expenseCategories, error } = await supabase
    .from('expense_categories')
    .select('main_category_code, department')
    .in('main_category_code', mainCodes);

  if (error) throw error;

  const allowedDepartmentsByCode = new Map<string, Set<string>>();
  (expenseCategories || []).forEach((row: any) => {
    const code = normalizeCategoryCode(row.main_category_code);
    if (!code) return;
    const existing = allowedDepartmentsByCode.get(code) || new Set<string>();
    existing.add(String(row.department || '').trim());
    allowedDepartmentsByCode.set(code, existing);
  });

  return categories.filter((category) => {
    const code = normalizeCategoryCode(category.category_code);
    if (!code) return true;
    const allowed = allowedDepartmentsByCode.get(code);
    if (!allowed || allowed.size === 0) return true;

    const departmentName = String(departmentNameById.get(String(category.department_id)) || '').trim();
    if (!departmentName) return true;

    return Array.from(allowed.values()).some((dept) => expenseCategoryAllowsDepartment(dept, departmentName));
  });
};

