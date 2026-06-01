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
  const normalizedDepartmentId = String(departmentId || '').trim();
  if (!normalizedDepartmentId) return;

  const { data: department, error: departmentError } = await supabase
    .from('departments')
    .select('id, name')
    .eq('id', normalizedDepartmentId)
    .maybeSingle();
  if (departmentError) throw departmentError;
  if (!department?.id) return;

  const departmentName = String(department.name || '').trim();
  const departmentKey = normalizeCostCenterDepartmentKey(departmentName);
  const desiredCode = COST_CENTER_CODE_BY_DEPARTMENT_KEY[departmentKey];
  if (!desiredCode) return;

  const { data: existingRows, error } = await supabase
    .from('cost_centers')
    .select('*')
    .eq('department_id', normalizedDepartmentId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const rows = Array.isArray(existingRows) ? existingRows : [];
  const payload = {
    cost_center_code: desiredCode.toUpperCase(),
    cost_center_name: departmentName,
    description: `Primary cost center for ${departmentName}`,
    updated_at: new Date().toISOString(),
  };

  if (!rows.length) {
    const { error: insertError } = await supabase
      .from('cost_centers')
      .insert({
        department_id: normalizedDepartmentId,
        ...payload,
        is_active: true,
        created_at: new Date().toISOString(),
      });
    if (insertError) throw insertError;
    return;
  }

  if (rows.length === 1 && shouldUpdateLegacyDefaultCostCenter(rows[0])) {
    const { error: updateError } = await supabase
      .from('cost_centers')
      .update(payload)
      .eq('id', rows[0].id);
    if (updateError) throw updateError;
  }
};

