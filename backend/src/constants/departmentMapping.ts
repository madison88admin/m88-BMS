import rawDepartmentNameMap from './departmentNameMap.json';

export const DEPARTMENT_NAME_MAP = rawDepartmentNameMap as Record<string, string | null>;

export const resolveExpenseCategoryDepartmentName = (value: string): string | null => {
  const key = String(value || '').trim();
  if (!key) return null;
  const mapped = (DEPARTMENT_NAME_MAP as Record<string, string | null>)[key];
  if (mapped !== undefined) return mapped;
  return key;
};

export const expenseCategoryAllowsDepartment = (expenseCategoryDepartment: string, departmentName: string): boolean => {
  const resolved = resolveExpenseCategoryDepartmentName(expenseCategoryDepartment);
  if (resolved === null) return true;
  return String(departmentName || '').trim() === resolved;
};

