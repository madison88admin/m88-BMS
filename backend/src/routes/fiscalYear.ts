import express from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { supabase } from '../utils/supabase';
import { ensureDepartmentsForFiscalYear, getLatestConfiguredFiscalYear } from '../utils/fiscal';
import { notifyAccounting } from '../utils/workflowNotify';

const router = express.Router();

// POST /api/fiscal-year/rollover
router.post('/rollover', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const targetYear = Number(req.body.target_year);
    if (!Number.isInteger(targetYear) || targetYear <= 0) return res.status(400).json({ error: 'Invalid target_year' });

    const activeYear = await getLatestConfiguredFiscalYear(supabase);
    if (targetYear <= activeYear) return res.status(400).json({ error: 'Target year must be greater than current fiscal year' });

    // Ensure departments exist for the new fiscal year
    await ensureDepartmentsForFiscalYear(supabase, targetYear, { seedName: req.body.seedName, seedAnnualBudget: req.body.seedAnnualBudget });

    // Copy budget categories structure to new year with zeroed budgets
    const { data: categories } = await supabase.from('budget_categories').select('*').eq('fiscal_year', activeYear);
    const inserts = (categories || []).map((c: any) => ({
      department_id: c.department_id,
      fiscal_year: targetYear,
      category_code: c.category_code,
      category_name: c.category_name,
      parent_category_id: c.parent_category_id || null,
      budget_amount: 0,
      remaining_amount: 0,
      used_amount: 0,
      committed_amount: 0,
      is_locked: false,
      created_at: new Date(),
      updated_at: new Date()
    }));

    if (inserts.length) {
      const { error: upsertErr } = await supabase.from('budget_categories').upsert(inserts, { onConflict: 'department_id,fiscal_year,category_code' });
      if (upsertErr) console.error('Budget category rollover upsert error:', upsertErr);
    }

    // Record rollover event
    await supabase.from('fiscal_rollovers').insert({ actor_id: req.user.id, from_year: activeYear, to_year: targetYear, note: req.body.note || null });

    // Notify accounting and admin
    await notifyAccounting(`Fiscal year rollover performed to ${targetYear} by ${req.user.name || req.user.id}`);

    res.json({ message: `Rollover to ${targetYear} completed`, created_categories: inserts.length });
  } catch (err: any) {
    console.error('Fiscal rollover failed:', err);
    res.status(500).json({ error: err.message || 'Failed to perform fiscal rollover' });
  }
});

// GET /api/fiscal-year/history
router.get('/history', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { data, error } = await supabase.from('fiscal_rollovers').select('*').order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error });
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
