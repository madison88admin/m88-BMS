import express from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { supabase } from '../utils/supabase';
import { updateM88ManilaCostCenterBudget } from '../utils/generalBudget';
import { logAuditEvent, AUDIT_ACTIONS } from '../utils/auditLog';

const toNumber = (value: any) => Number.parseFloat(value ?? 0) || 0;
const formatMoney = (value: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value);

const router = express.Router();

// GET /api/expenses - direct expenses
router.get('/', authenticate, async (req: any, res) => {
  let query = supabase.from('direct_expenses').select('*');
  
  // Filter expenses based on role
  if (req.user.role === 'supervisor') {
    query = query.eq('logged_by', req.user.id);
  } else if (req.user.role === 'employee') {
    // Employees can see expenses logged by their supervisor
    query = query.eq('department_id', req.user.department_id);
  } else if (req.user.role === 'accounting' || req.user.role === 'admin' || req.user.role === 'super_admin') {
    // Accounting and admins can see all expenses
    query = query;
  } else {
    // Other roles (management, vp, president) can see all expenses
    query = query;
  }
  
  const { data, error } = await query;
  if (error) return res.status(400).json({ error });
  res.json(data);
});

// POST /api/expenses - log direct expense or Budget Expense Adjustment
router.post('/', authenticate, authorize('supervisor', 'accounting', 'admin', 'super_admin'), async (req: any, res) => {
  const { item_name, category_id, category, amount, description, expense_date, department_id } = req.body;

  // For accounting/admin, allow specifying the target department; otherwise use the user's department
  const targetDepartmentId = (req.user.role === 'accounting' || req.user.role === 'admin' || req.user.role === 'super_admin') && department_id
    ? department_id
    : req.user.department_id;

  const { data: dept, error: deptError } = await supabase.from('departments').select('*').eq('id', targetDepartmentId).single();
  if (deptError || !dept) return res.status(400).json({ error: deptError?.message || 'Department not found.' });

  const targetFiscalYear = Number(dept.fiscal_year) || new Date().getFullYear();
  let categoryFilter = supabase.from('budget_categories').select('id, category_name, department_id, remaining_amount, used_amount').eq('fiscal_year', targetFiscalYear);

  if (category_id) {
    categoryFilter = categoryFilter.eq('id', category_id);
  } else if (category) {
    categoryFilter = categoryFilter.eq('category_name', String(category).trim());
  } else {
    return res.status(400).json({ error: 'Category ID or category name is required.' });
  }

  const { data: categoryBudget, error: categoryError } = await categoryFilter.maybeSingle();
  if (categoryError) return res.status(400).json({ error: categoryError.message });
  if (!categoryBudget) {
    return res.status(400).json({ error: `Category not found in fiscal year ${targetFiscalYear}.` });
  }

  // Allow logging expenses even if the remaining budget is insufficient.
  // The supervisor/accounting can review the updated remaining_amount on the category.

  const { data, error } = await supabase
    .from('direct_expenses')
    .insert({
      department_id: targetDepartmentId,
      category_id: categoryBudget.id,
      fiscal_year: targetFiscalYear,
      logged_by: req.user.id,
      item_name,
      category: categoryBudget.category_name,
      amount,
      description,
      expense_date
    })
    .select()
    .single();
  if (error) return res.status(400).json({ error });

  await supabase
    .from('budget_categories')
    .update({
      used_amount: toNumber(categoryBudget.used_amount) + toNumber(amount),
      remaining_amount: toNumber(categoryBudget.remaining_amount) - toNumber(amount)
    })
    .eq('id', categoryBudget.id);

  // Recalculate M88 Manila cost center to keep dashboard in sync.
  // This now includes General Category direct expenses in its used amount.
  await updateM88ManilaCostCenterBudget(targetFiscalYear);

  await logAuditEvent({
    user: req.user,
    actionType: AUDIT_ACTIONS.DIRECT_EXPENSE_UPLOADED,
    recordType: 'direct_expense',
    recordId: data.id,
    recordLabel: data.item_name,
    newValue: {
      category_id: categoryBudget.id,
      category_name: categoryBudget.category_name,
      amount: toNumber(amount),
      department_id: targetDepartmentId,
      fiscal_year: targetFiscalYear,
      expense_date: data.expense_date
    },
    remarks: `Direct expense uploaded: ${categoryBudget.category_name} - ${formatMoney(toNumber(amount))}`
  });

  res.json(data);
});

// POST /api/expenses/batch - batch recurring expense adjustments
router.post('/batch', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  const { expenses, department_id } = req.body;
  if (!Array.isArray(expenses) || expenses.length === 0) {
    return res.status(400).json({ error: 'expenses array is required' });
  }

  const targetDepartmentId = department_id || req.user.department_id;
  const { data: dept, error: deptError } = await supabase.from('departments').select('*').eq('id', targetDepartmentId).single();
  if (deptError || !dept) return res.status(400).json({ error: deptError?.message || 'Department not found.' });

  const targetFiscalYear = Number(dept.fiscal_year) || new Date().getFullYear();
  const results = [];

  for (const item of expenses) {
    const { category_id, amount, description, expense_date, item_name } = item;
    if (!category_id || toNumber(amount) <= 0) continue;

    const { data: categoryBudget, error: categoryError } = await supabase
      .from('budget_categories')
      .select('id, category_name, department_id, remaining_amount, used_amount')
      .eq('id', category_id)
      .eq('fiscal_year', targetFiscalYear)
      .maybeSingle();

    if (categoryError || !categoryBudget) continue;

    const { data, error } = await supabase
      .from('direct_expenses')
      .insert({
        department_id: targetDepartmentId,
        category_id: categoryBudget.id,
        fiscal_year: targetFiscalYear,
        logged_by: req.user.id,
        item_name: item_name || categoryBudget.category_name,
        category: categoryBudget.category_name,
        amount,
        description,
        expense_date: expense_date || new Date().toISOString().split('T')[0]
      })
      .select()
      .single();

    if (error) continue;

    await supabase
      .from('budget_categories')
      .update({
        used_amount: toNumber(categoryBudget.used_amount) + toNumber(amount),
        remaining_amount: toNumber(categoryBudget.remaining_amount) - toNumber(amount)
      })
      .eq('id', categoryBudget.id);

    results.push(data);
  }

  await updateM88ManilaCostCenterBudget(targetFiscalYear);

  const batchTotal = results.reduce((sum, r) => sum + toNumber(r.amount), 0);
  if (results.length > 0) {
    await logAuditEvent({
      user: req.user,
      actionType: AUDIT_ACTIONS.DIRECT_EXPENSE_BATCH_UPLOADED,
      recordType: 'direct_expense',
      recordId: null,
      recordLabel: `Batch upload for ${dept.name}`,
      newValue: {
        count: results.length,
        total: batchTotal,
        department_id: targetDepartmentId,
        fiscal_year: targetFiscalYear,
        expenses: results.map((r) => ({ id: r.id, category: r.category, amount: toNumber(r.amount) }))
      },
      remarks: `Batch direct expenses uploaded: ${results.length} item(s), total ${formatMoney(batchTotal)} for ${dept.name}`
    });
  }

  res.json({ count: results.length, data: results });
});

export default router;