import { supabase } from './supabase';
import { AUDIT_ACTIONS, logAuditEvent } from './auditLog';
import { buildDepartmentBudgetSummaryMap } from './budget';

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
    .ilike('name', 'M88 Manila')
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

  // Use the same source of truth as the Department Budget Breakdown table
  const { summaryByDepartmentId } = await buildDepartmentBudgetSummaryMap();
  const fiscalYearSummaries = Array.from(summaryByDepartmentId.values()).filter(
    (summary: any) => summary.fiscal_year === fiscalYear
  );

  const departmentsTotalBudget = fiscalYearSummaries.reduce((sum, summary) => sum + toNumber(summary.annual_budget), 0);
  const totalUsedAmount = fiscalYearSummaries.reduce((sum, summary) => sum + toNumber(summary.used_budget), 0);
  const totalPendingAmount = fiscalYearSummaries.reduce(
    (sum, summary) =>
      sum +
      toNumber(summary.pending_supervisor_total) +
      toNumber(summary.pending_accounting_total) +
      toNumber(summary.pending_vp_total) +
      toNumber(summary.pending_president_total),
    0
  );
  const totalPendingCount = fiscalYearSummaries.reduce(
    (sum, summary) =>
      sum +
      (toNumber(summary.pending_supervisor_total) > 0 ? 1 : 0) +
      (toNumber(summary.pending_accounting_total) > 0 ? 1 : 0) +
      (toNumber(summary.pending_vp_total) > 0 ? 1 : 0) +
      (toNumber(summary.pending_president_total) > 0 ? 1 : 0),
    0
  );

  console.log(`[updateM88ManilaCostCenterBudget] FY${fiscalYear}`, {
    totalBudget: departmentsTotalBudget,
    totalUsedAmount,
    totalPendingAmount,
    totalPendingCount,
    summaries: fiscalYearSummaries.map((s) => ({
      department: s.department_name,
      used: s.used_budget,
      pending_supervisor: s.pending_supervisor_total,
      pending_accounting: s.pending_accounting_total,
      pending_vp: s.pending_vp_total,
      pending_president: s.pending_president_total
    }))
  });

  const { data, error } = await supabase
    .from('cost_centers')
    .update({
      total_budget: departmentsTotalBudget,
      used_amount: totalUsedAmount,
      pending_amount: totalPendingAmount,
      pending_count: totalPendingCount,
      remaining_amount: Math.max(0, departmentsTotalBudget - totalUsedAmount - totalPendingAmount)
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
      remarks: `M88 Manila cost center updated: Total = ${departmentsTotalBudget}, Used = ${totalUsedAmount}, Pending = ${totalPendingAmount} (${totalPendingCount}), Available = ${Math.max(0, departmentsTotalBudget - totalUsedAmount - totalPendingAmount)}`
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
