export const normalizeCostCenterDepartmentKey = (value: string) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/\bdepartment\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const COST_CENTER_CODE_BY_DEPARTMENT_KEY: Record<string, string> = {
  executive: 'M88_001',
  accounting: 'M88_002',
  finance: 'M88_002',
  hr: 'M88_003',
  humanresources: 'M88_003',
  logistics: 'M88_004',
  planning: 'M88_005',
  purchasing: 'M88_006',
  costing: 'M88_007',
  it: 'M88_008',
  informationtechnology: 'M88_008',
  supplychain: 'M88_009',
  admin: 'M88_010',
  ojt: 'M88_011',
};

const shouldUpdateLegacyDefaultCostCenter = (row: any) => {
  const code = String(row?.cost_center_code || '').trim().toUpperCase();
  const name = String(row?.cost_center_name || '').trim().toLowerCase();
  if (!code) return true;
  if (code.startsWith('M88_')) return false;
  if (code.endsWith('_001')) return true;
  if (code.includes('DEPARTMENT_')) return true;
  if (name.endsWith(' - main')) return true;
  return false;
};

export const ensureDepartmentCostCenterCode = async (supabase: any, departmentId: string) => {
  // Cost centers are central fund sources (e.g., M88 Manila), not department-specific
  // This function is no longer needed as cost_centers don't have department_id
  return;
};

