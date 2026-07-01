import { supabase } from './supabase';
import { AUDIT_ACTIONS, logAuditEvent } from './auditLog';

const toNumber = (value: any) => Number.parseFloat(value ?? 0) || 0;

// Exchange rates relative to PHP (base = PHP). Matches /api/config/auth-thresholds.
const EXCHANGE_RATES: Record<string, number> = {
  PHP: 1,
  USD: 0.018, // 1 PHP = 0.018 USD
  IDR: 291    // 1 PHP = 291 IDR
};

export const convertToPhp = (amount: number, currency: string) => {
  const rate = EXCHANGE_RATES[currency?.toUpperCase()] ?? EXCHANGE_RATES.PHP;
  return amount / rate;
};

/**
 * Find or create M88 Manila cost center for a given fiscal year
 */
export const findOrCreateM88ManilaCostCenter = async (fiscalYear: number) => {
  const { data: existing, error } = await supabase
    .from('cost_centers')
    .select('*')
    .eq('name', 'M88 Manila')
    .eq('fiscal_year', fiscalYear)
    .maybeSingle();

  if (error) throw error;
  if (existing) return existing;

  // Create M88 Manila cost center if it doesn't exist
  const { data: created, error: createError } = await supabase
    .from('cost_centers')
    .insert({
      name: 'M88 Manila',
      total_budget: 0,
      used_amount: 0,
      pending_amount: 0,
      pending_count: 0,
      remaining_amount: 0,
      fiscal_year: fiscalYear,
      is_active: true
    })
    .select()
    .single();

  if (createError) throw createError;
  return created;
};

/**
 * Update M88 Manila cost center budget
 * M88 Manila total_budget = sum of all departments' annual budgets for the fiscal year
 */
export const updateM88ManilaCostCenterBudget = async (
  fiscalYear: number,
  user?: any
) => {
  const costCenter = await findOrCreateM88ManilaCostCenter(fiscalYear);

  // Calculate total annual budget from all departments for this fiscal year
  const { data: departments, error: deptError } = await supabase
    .from('departments')
    .select('annual_budget')
    .eq('fiscal_year', fiscalYear);

  if (deptError) throw deptError;

  const departmentsTotalBudget = departments.reduce((sum, dept) => sum + toNumber(dept.annual_budget), 0);

  // Calculate total released amount from General Category expense requests
  const { data: releasedRequests, error: releasedError } = await supabase
    .from('expense_requests')
    .select('amount, category_id, metadata')
    .eq('fiscal_year', fiscalYear)
    .eq('status', 'released');

  if (releasedError) throw releasedError;

  // Calculate total pending amount from ALL pending expense requests (excluding budget proposals)
  const { data: pendingRequests, error: pendingError } = await supabase
    .from('expense_requests')
    .select('id, request_code, amount, request_type, category_id, status, metadata')
    .eq('fiscal_year', fiscalYear)
    .not('request_type', 'in', '(budget_request,budget_revision)')
    .in('status', ['pending_supervisor', 'pending_accounting', 'pending_vp', 'pending_president']);

  if (pendingError) throw pendingError;

  // Filter for General Category requests and convert to PHP base
  const filterGeneralAmount = async (reqs: any[]) => {
    const results = await Promise.all(
      reqs.map(async (req) => {
        const isGeneral = await isGeneralCategory(req.category_id);
        if (!isGeneral) return 0;
        const currency = (req.metadata as any)?.currency || 'PHP';
        return convertToPhp(toNumber(req.amount), currency);
      })
    );
    return results;
  };

  const totalReleasedAmount = (await filterGeneralAmount(releasedRequests || [])).reduce((sum, amount) => sum + amount, 0);

  // Pending reflects all pending expense requests (any category), converted to PHP base
  const totalPendingAmount = (pendingRequests || []).reduce((sum, req) => {
    const currency = (req.metadata as any)?.currency || 'PHP';
    return sum + convertToPhp(toNumber(req.amount), currency);
  }, 0);
  const totalPendingCount = (pendingRequests || []).length;

  console.log(`[updateM88ManilaCostCenterBudget] FY${fiscalYear}`, {
    totalBudget: departmentsTotalBudget,
    releasedCount: releasedRequests?.length || 0,
    totalReleasedAmount,
    pendingCount: pendingRequests?.length || 0,
    totalPendingAmount,
    totalPendingCount,
    pendingRequests: pendingRequests?.map((r: any) => ({ id: r.id, request_code: r.request_code, amount: r.amount, category_id: r.category_id, status: r.status, metadata: r.metadata }))
  });

  const { data, error } = await supabase
    .from('cost_centers')
    .update({
      total_budget: departmentsTotalBudget,
      used_amount: totalReleasedAmount,
      pending_amount: totalPendingAmount,
      pending_count: totalPendingCount,
      remaining_amount: Math.max(0, departmentsTotalBudget - totalReleasedAmount - totalPendingAmount)
    })
    .eq('id', costCenter.id)
    .select()
    .single();

  if (error) throw error;

  // Log audit event when user is provided
  if (user) {
    await logAuditEvent({
      user,
      actionType: 'general_budget_stored_to_cost_center',
      recordType: 'cost_center',
      recordId: costCenter.id,
      recordLabel: costCenter.name,
      oldValue: { total_budget: costCenter.total_budget },
      newValue: { total_budget: data.total_budget },
      remarks: `M88 Manila cost center updated: Total = ${departmentsTotalBudget}, Used = ${totalReleasedAmount}, Pending = ${totalPendingAmount} (${totalPendingCount}), Available = ${Math.max(0, departmentsTotalBudget - totalReleasedAmount - totalPendingAmount)}`
    });
  }

  return data;
};

/**
 * Check if a budget category is a General Category (department = 'All')
 */
export const isGeneralCategory = async (categoryId: string) => {
  if (!categoryId) return false;
  const { data, error } = await supabase
    .from('budget_categories')
    .select('department_id')
    .eq('id', categoryId)
    .maybeSingle();

  if (error) {
    console.error('[isGeneralCategory] Error checking category', categoryId, error);
    return false;
  }
  return data?.department_id === 'All';
};
