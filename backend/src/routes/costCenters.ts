import express from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { supabase } from '../utils/supabase';
import { AUDIT_ACTIONS, logAuditEvent } from '../utils/auditLog';
import { getLatestConfiguredFiscalYear } from '../utils/fiscal';

const router = express.Router();

// GET /api/cost-centers - List active cost centers (Accounting only)
router.get('/', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const fiscalYear = req.query.fiscal_year ? parseInt(req.query.fiscal_year as string) : new Date().getFullYear();
    
    const { data, error } = await supabase
      .from('cost_centers')
      .select('*')
      .eq('fiscal_year', fiscalYear)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cost-centers - Create new cost center (Accounting/Admin only)
router.post('/', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { name, total_budget, fiscal_year, is_active } = req.body;
    
    if (!name || total_budget === undefined || total_budget === null) {
      return res.status(400).json({ error: 'Name and total_budget are required' });
    }

    const costCenterData = {
      name: name.trim(),
      total_budget: parseFloat(total_budget),
      used_amount: 0,
      remaining_amount: parseFloat(total_budget),
      fiscal_year: fiscal_year || new Date().getFullYear(),
      is_active: is_active !== undefined ? is_active : true
    };

    const { data, error } = await supabase
      .from('cost_centers')
      .insert(costCenterData)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Log audit event
    await logAuditEvent({
      user: req.user,
      actionType: AUDIT_ACTIONS.COST_CENTER_CREATED,
      recordType: 'cost_center',
      recordId: data.id,
      recordLabel: name,
      remarks: `Created cost center with total budget ${total_budget}`
    });

    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/cost-centers/:id - Update cost center (Accounting/Admin only)
router.patch('/:id', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { name, total_budget, is_active } = req.body;
    const updateData: any = {};

    if (name !== undefined) updateData.name = name.trim();
    if (total_budget !== undefined) {
      updateData.total_budget = parseFloat(total_budget);
      // Recalculate remaining if budget changes
      const { data: existing } = await supabase.from('cost_centers').select('used_amount').eq('id', req.params.id).single();
      if (existing) {
        updateData.remaining_amount = parseFloat(total_budget) - parseFloat(existing.used_amount);
      }
    }
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data, error } = await supabase
      .from('cost_centers')
      .update(updateData)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Log audit event
    await logAuditEvent({
      user: req.user,
      actionType: AUDIT_ACTIONS.COST_CENTER_UPDATED,
      recordType: 'cost_center',
      recordId: req.params.id,
      recordLabel: name || data.name,
      remarks: 'Updated cost center'
    });

    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cost-centers/:id - Deactivate cost center (Accounting/Admin only)
router.delete('/:id', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { data, error } = await supabase
      .from('cost_centers')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Log audit event
    await logAuditEvent({
      user: req.user,
      actionType: AUDIT_ACTIONS.COST_CENTER_DELETED,
      recordType: 'cost_center',
      recordId: req.params.id,
      recordLabel: data.name,
      remarks: 'Deactivated cost center'
    });

    res.json({ message: 'Cost center deactivated successfully', data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
