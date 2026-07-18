import express from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { supabase } from '../utils/supabase';
import { AUDIT_ACTIONS, logAuditEvent } from '../utils/auditLog';
import { notifyAccounting } from '../utils/workflowNotify';

const router = express.Router();

// POST /api/cost-allocations/tag - Tag request with cost center and budget category (Accounting only)
router.post('/tag', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { request_id, cost_center_id, budget_category_id, amount, notes } = req.body;
    
    if (!request_id || !cost_center_id || !budget_category_id || !amount) {
      return res.status(400).json({ error: 'request_id, cost_center_id, budget_category_id, and amount are required' });
    }

    // Verify request exists and is in pending_accounting status
    const { data: request, error: requestError } = await supabase
      .from('expense_requests')
      .select('*')
      .eq('id', request_id)
      .single();

    if (requestError || !request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    if (request.status !== 'pending_accounting') {
      return res.status(400).json({ error: 'Request must be in pending_accounting status to be tagged' });
    }

    // Verify cost center exists and is active
    const { data: costCenter, error: costCenterError } = await supabase
      .from('cost_centers')
      .select('*')
      .eq('id', cost_center_id)
      .eq('is_active', true)
      .single();

    if (costCenterError || !costCenter) {
      return res.status(404).json({ error: 'Cost center not found or inactive' });
    }

    // Verify budget category exists
    const { data: budgetCategory, error: categoryError } = await supabase
      .from('budget_categories')
      .select('*')
      .eq('id', budget_category_id)
      .single();

    if (categoryError || !budgetCategory) {
      return res.status(404).json({ error: 'Budget category not found' });
    }

    // Check if cost center has sufficient funds
    if (parseFloat(costCenter.remaining_amount) < parseFloat(amount)) {
      return res.status(400).json({ 
        error: 'Insufficient funds in cost center',
        available: costCenter.remaining_amount,
        requested: amount
      });
    }

    // Check if budget category has sufficient funds
    if (parseFloat(budgetCategory.remaining_amount) < parseFloat(amount)) {
      return res.status(400).json({ 
        error: 'Insufficient funds in budget category',
        available: budgetCategory.remaining_amount,
        requested: amount
      });
    }

    // Create cost allocation record
    const allocationData = {
      request_id,
      cost_center_id,
      budget_category_id,
      amount: parseFloat(amount),
      tagged_by: req.user.id,
      notes: notes || null
    };

    const { data: allocation, error: allocationError } = await supabase
      .from('request_cost_allocations')
      .insert(allocationData)
      .select()
      .single();

    if (allocationError) return res.status(400).json({ error: allocationError.message });

    // Log audit event
    await logAuditEvent({
      user: req.user,
      actionType: AUDIT_ACTIONS.COST_ALLOCATION_TAGGED,
      recordType: 'request_cost_allocation',
      recordId: allocation.id,
      recordLabel: request.request_code,
      remarks: `Tagged request ${request.request_code} with cost center ${costCenter.name} and budget category ${budgetCategory.category_name}`
    });

    res.json(allocation);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cost-allocations/confirm - Confirm allocation and perform dual deduction (Accounting only)
router.post('/confirm', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { allocation_id } = req.body;
    
    if (!allocation_id) {
      return res.status(400).json({ error: 'allocation_id is required' });
    }

    // Get allocation record
    const { data: allocation, error: allocationError } = await supabase
      .from('request_cost_allocations')
      .select('*, cost_centers(*), budget_categories(*), expense_requests(*)')
      .eq('id', allocation_id)
      .single();

    if (allocationError || !allocation) {
      return res.status(404).json({ error: 'Allocation not found' });
    }

    if (allocation.confirmed_at) {
      return res.status(400).json({ error: 'Allocation already confirmed' });
    }

    const amount = parseFloat(allocation.amount);
    const costCenter = allocation.cost_centers;
    const budgetCategory = allocation.budget_categories;
    const request = allocation.expense_requests;

    // Claim the confirmation first so concurrent/double-click requests cannot
    // perform the deduction more than once.
    const confirmationTime = new Date().toISOString();
    const { data: claimed, error: claimError } = await supabase
      .from('request_cost_allocations')
      .update({ confirmed_at: confirmationTime, confirmed_by: req.user.id })
      .eq('id', allocation_id)
      .is('confirmed_at', null)
      .select('id')
      .maybeSingle();

    if (claimError) return res.status(400).json({ error: 'Failed to claim allocation: ' + claimError.message });
    if (!claimed) return res.status(400).json({ error: 'Allocation already confirmed' });

    const releaseClaim = async () => {
      await supabase.from('request_cost_allocations')
        .update({ confirmed_at: null, confirmed_by: null })
        .eq('id', allocation_id)
        .eq('confirmed_at', confirmationTime);
    };

    // Deduct from cost center
    const { error: costCenterError } = await supabase
      .from('cost_centers')
      .update({
        used_amount: parseFloat(costCenter.used_amount) + amount,
        remaining_amount: parseFloat(costCenter.remaining_amount) - amount
      })
      .eq('id', costCenter.id);

    if (costCenterError) {
      await releaseClaim();
      return res.status(400).json({ error: 'Failed to deduct from cost center: ' + costCenterError.message });
    }

    // Deduct from budget category
    const { error: categoryError } = await supabase
      .from('budget_categories')
      .update({
        used_amount: parseFloat(budgetCategory.used_amount) + amount,
        remaining_amount: parseFloat(budgetCategory.remaining_amount) - amount
      })
      .eq('id', budgetCategory.id);

    if (categoryError) {
      // Rollback cost center deduction
      await supabase
        .from('cost_centers')
        .update({
          used_amount: parseFloat(costCenter.used_amount),
          remaining_amount: parseFloat(costCenter.remaining_amount)
        })
        .eq('id', costCenter.id);
      await releaseClaim();
      
      return res.status(400).json({ error: 'Failed to deduct from budget category: ' + categoryError.message });
    }

    // Log audit event
    await logAuditEvent({
      user: req.user,
      actionType: AUDIT_ACTIONS.COST_ALLOCATION_CONFIRMED,
      recordType: 'request_cost_allocation',
      recordId: allocation_id,
      recordLabel: request.request_code,
      remarks: `Confirmed dual deduction: ${amount} from cost center ${costCenter.name} and budget category ${budgetCategory.category_name}`
    });

    // Notify accounting team
    await notifyAccounting(`Cost allocation confirmed for request ${request.request_code}. Amount: ${amount}, Cost Center: ${costCenter.name}, Budget Category: ${budgetCategory.category_name}`);

    res.json({ 
      message: 'Allocation confirmed and dual deduction completed successfully',
      allocation_id,
      amount_deducted: amount,
      cost_center_remaining: parseFloat(costCenter.remaining_amount) - amount,
      budget_category_remaining: parseFloat(budgetCategory.remaining_amount) - amount
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cost-allocations/:request_id - Get allocation for a request
router.get('/:request_id', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { data, error } = await supabase
      .from('request_cost_allocations')
      .select('*, cost_centers(*), budget_categories(*), tagged_by_user:users!tagged_by(id, name, role)')
      .eq('request_id', req.params.request_id)
      .maybeSingle();

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
