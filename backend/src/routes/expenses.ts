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
  const { item_name, category, amount, description, expense_date } = req.body;
  const { data: dept } = await supabase.from('departments').select('*').eq('id', req.user.department_id).single();
  
  // Check category budget instead of department annual budget
  const { data: categoryBudget, error: categoryError } = await supabase
    .from('budget_categories')
    .select('remaining_amount, used_amount')
    .eq('category_name', category)
    .eq('department_id', req.user.department_id)
    .eq('fiscal_year', new Date().getFullYear())
    .maybeSingle();
  
  if (categoryError) return res.status(400).json({ error: categoryError.message });
  
  if (!categoryBudget) {
    return res.status(400).json({ error: 'Category not found in budget' });
  }
  
  if (categoryBudget.remaining_amount < amount) {
    return res.status(400).json({ error: `Insufficient budget in category "${category}". Remaining: ${categoryBudget.remaining_amount.toFixed(2)}` });
  }
  
  const { data, error } = await supabase
    .from('direct_expenses')
    .insert({
      department_id: req.user.department_id,
      logged_by: req.user.id,
      item_name,
      category,
      amount,
      description,
      expense_date
    })
    .select()
    .single();
  if (error) return res.status(400).json({ error });
  
  // Deduct from category budget instead of department budget
  await supabase
    .from('budget_categories')
    .update({ 
      used_amount: categoryBudget.used_amount + amount,
      remaining_amount: categoryBudget.remaining_amount - amount
    })
    .eq('category_name', category)
    .eq('department_id', req.user.department_id)
    .eq('fiscal_year', new Date().getFullYear());
  
  res.json(data);
});

export default router;