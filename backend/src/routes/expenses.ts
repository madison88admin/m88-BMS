import express from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { supabase } from '../utils/supabase';

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

// POST /api/expenses - supervisor logs direct expense
router.post('/', authenticate, authorize('supervisor'), async (req: any, res) => {
  const { item_name, category_id, category, amount, description, expense_date } = req.body;
  const { data: dept, error: deptError } = await supabase.from('departments').select('*').eq('id', req.user.department_id).single();
  if (deptError || !dept) return res.status(400).json({ error: deptError?.message || 'Department not found.' });

  const targetFiscalYear = Number(dept.fiscal_year) || new Date().getFullYear();
  let categoryFilter = supabase.from('budget_categories').select('id, category_name, parent_category_id, remaining_amount, used_amount').eq('department_id', req.user.department_id).eq('fiscal_year', targetFiscalYear);

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
    return res.status(400).json({ error: `Category not found for department in fiscal year ${targetFiscalYear}.` });
  }

  if (toNumber(categoryBudget.remaining_amount) < toNumber(amount)) {
    return res.status(400).json({ error: `Insufficient budget in category "${categoryBudget.category_name}". Remaining: ${toNumber(categoryBudget.remaining_amount).toFixed(2)}` });
  }

  const { data, error } = await supabase
    .from('direct_expenses')
    .insert({
      department_id: req.user.department_id,
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

  res.json(data);
});

export default router;