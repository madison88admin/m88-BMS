import { supabase } from './supabase';
import { AUDIT_ACTIONS, logAuditEvent } from './auditLog';

const toNumber = (value: any) => Number.parseFloat(value ?? 0) || 0;

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
 * Update M88 Manila cost center budget when General Category budget is saved/updated
 */
export const updateM88ManilaCostCenterBudget = async (
  fiscalYear: number,
  budgetAmount: number,
  previousBudgetAmount: number = 0,
  user: any
) => {
  const costCenter = await findOrCreateM88ManilaCostCenter(fiscalYear);
  const difference = budgetAmount - previousBudgetAmount;

  const { data, error } = await supabase
    .from('cost_centers')
    .update({
      total_budget: toNumber(costCenter.total_budget) + difference,
      remaining_amount: toNumber(costCenter.remaining_amount) + difference
    })
    .eq('id', costCenter.id)
    .select()
    .single();

  if (error) throw error;

  // Log audit event
  await logAuditEvent({
    user,
    actionType: 'general_budget_stored_to_cost_center',
    recordType: 'cost_center',
    recordId: costCenter.id,
    recordLabel: costCenter.name,
    oldValue: { total_budget: costCenter.total_budget },
    newValue: { total_budget: data.total_budget },
    remarks: `General category budget updated: ${difference >= 0 ? '+' : ''}${difference} to M88 Manila cost center`
  });

  return data;
};

/**
 * Check if a budget category is a General Category (department = 'All')
 */
export const isGeneralCategory = async (categoryId: string) => {
  const { data, error } = await supabase
    .from('budget_categories')
    .select('department_id')
    .eq('id', categoryId)
    .single();

  if (error) throw error;
  return data?.department_id === 'All';
};
