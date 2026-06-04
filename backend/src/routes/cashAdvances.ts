import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { supabase } from '../utils/supabase';
import { authenticate, authorize } from '../middleware/auth';
import { getLatestConfiguredFiscalYear } from '../utils/fiscal';
import { getCashAdvanceAgingConfig } from '../utils/config';
import { notifyUser } from '../utils/workflowNotify';
import { validateExpense } from '../utils/expenseValidator';

const router = Router();

const computeAgingBucket = (daysOverdue: number, thresholds: any) => {
  if (daysOverdue <= 0) return 'Current';
  if (daysOverdue <= thresholds.bucket_1_days) return `1-${thresholds.bucket_1_days} Days`;
  if (daysOverdue <= thresholds.bucket_2_days) return `${thresholds.bucket_1_days + 1}-${thresholds.bucket_2_days} Days`;
  if (daysOverdue <= thresholds.bucket_3_days) return `${thresholds.bucket_2_days + 1}-${thresholds.bucket_3_days} Days`;
  return `${thresholds.bucket_3_days}+ Days`;
};

const markOverdueCashAdvances = async () => {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('cash_advances')
    .select('id, status, liquidation_due_at, employee_id, advance_code')
    .in('status', ['outstanding', 'partially_liquidated'])
    .lt('liquidation_due_at', now);

  if (error) {
    console.error('Unable to refresh overdue cash advances:', error);
    return [];
  }

  const overdueUpdates = (data || []).map((advance: any) => advance.id);
  if (overdueUpdates.length > 0) {
    await supabase
      .from('cash_advances')
      .update({ status: 'overdue', updated_at: new Date().toISOString() })
      .in('id', overdueUpdates);
  }

  return data || [];
};

// GET /api/cash-advances - List cash advances
router.get('/', authenticate, async (req: any, res) => {
  try {
    const { status, employee_id, overdue_only, status_in } = req.query;

    let query = supabase
      .from('cash_advances')
      .select(`
        *,
        employee:users!cash_advances_employee_id_fkey(id, name, email),
        department:departments(id, name),
        issuer:users!cash_advances_issued_by_fkey(id, name)
      `)
      .order('issued_at', { ascending: false });

    // Filter by status
    if (status) {
      query = query.eq('status', status);
    } else if (req.query.status_in) {
      const statuses = (req.query.status_in as string).split(',');
      query = query.in('status', statuses);
    }

    // Filter by employee (for non-finance users, only show own)
    if (req.user.role === 'employee' || req.user.role === 'manager') {
      query = query.eq('employee_id', req.user.id);
    } else if (employee_id) {
      query = query.eq('employee_id', employee_id);
    }

    // Overdue only
    if (overdue_only === 'true') {
      query = query.eq('status', 'overdue');
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json(data || []);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/cash-advances/aging - Cash advance aging report
router.get('/aging', authenticate, authorize('accounting', 'admin', 'super_admin', 'management'), async (req: any, res) => {
  try {
    await markOverdueCashAdvances();
    const thresholds = await getCashAdvanceAgingConfig();
    const { data: cashAdvances, error } = await supabase
      .from('cash_advances')
      .select(`
        *,
        employee:users!cash_advances_employee_id_fkey(id, name, email, department_id),
        department:departments(id, name)
      `)
      .in('status', ['outstanding', 'partially_liquidated', 'overdue'])
      .order('liquidation_due_at', { ascending: true });

    if (error) throw error;

    // Calculate aging buckets
    const now = new Date();
    const agingReport = (cashAdvances || []).map((ca: any) => {
      const dueDate = ca.liquidation_due_at ? new Date(ca.liquidation_due_at) : null;
      const daysOpen = dueDate 
        ? Math.floor((now.getTime() - new Date(ca.issued_at).getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      const daysOverdue = dueDate && now > dueDate
        ? Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      const agingBucket = computeAgingBucket(daysOverdue, thresholds);

      return {
        id: ca.id,
        advance_code: ca.advance_code,
        employee_name: ca.employee?.name || 'Unknown',
        department_name: ca.department?.name || 'Unknown',
        amount_issued: Number(ca.amount_issued),
        amount_liquidated: Number(ca.amount_liquidated),
        balance: Number(ca.balance),
        issued_at: ca.issued_at,
        liquidation_due_at: ca.liquidation_due_at,
        days_open: daysOpen,
        days_overdue: daysOverdue,
        aging_bucket: agingBucket,
        status: ca.status,
        purpose: ca.purpose
      };
    });

    // Group by aging bucket
    const summary = {
      Current: agingReport.filter((r: any) => r.aging_bucket === 'Current'),
      [`1-${thresholds.bucket_1_days} Days`]: agingReport.filter((r: any) => r.aging_bucket === `1-${thresholds.bucket_1_days} Days`),
      [`${thresholds.bucket_1_days + 1}-${thresholds.bucket_2_days} Days`]: agingReport.filter((r: any) => r.aging_bucket === `${thresholds.bucket_1_days + 1}-${thresholds.bucket_2_days} Days`),
      [`${thresholds.bucket_2_days + 1}-${thresholds.bucket_3_days} Days`]: agingReport.filter((r: any) => r.aging_bucket === `${thresholds.bucket_2_days + 1}-${thresholds.bucket_3_days} Days`),
      [`${thresholds.bucket_3_days}+ Days`]: agingReport.filter((r: any) => r.aging_bucket === `${thresholds.bucket_3_days}+ Days`)
    };

    const format = String(req.query.format || '').trim().toLowerCase();
    if (format === 'pdf') {
      const PDFDocument = (await import('pdfkit')).default;
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=cash_advance_aging_${new Date().toISOString().slice(0,10)}.pdf`);
      doc.pipe(res);
      doc.fontSize(16).text('Cash Advance Aging Report', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Generated: ${new Date().toLocaleString()}`);
      doc.moveDown();

      // Table header
      doc.fontSize(10).text('Employee', 40, doc.y, { width: 140 });
      doc.text('Advance Code', 190, doc.y, { width: 90 });
      doc.text('Department', 290, doc.y, { width: 90 });
      doc.text('Balance', 390, doc.y, { width: 70, align: 'right' });
      doc.text('Days Open', 470, doc.y, { width: 60, align: 'right' });
      doc.text('Aging Bucket', 540, doc.y, { width: 60, align: 'right' });
      doc.moveDown(0.6);

      for (const row of agingReport) {
        if (doc.y > 720) doc.addPage();
        doc.fontSize(9).text(row.employee_name, 40, doc.y, { width: 140 });
        doc.text(row.advance_code, 190, doc.y, { width: 90 });
        doc.text(row.department_name, 290, doc.y, { width: 90 });
        doc.text(Number(row.balance).toFixed(2), 390, doc.y, { width: 70, align: 'right' });
        doc.text(String(row.days_open), 470, doc.y, { width: 60, align: 'right' });
        doc.text(row.aging_bucket, 540, doc.y, { width: 60, align: 'right' });
        doc.moveDown(0.4);
      }
      doc.end();
    } else {
      res.json({
        total_outstanding: agingReport.reduce((sum: number, r: any) => sum + r.balance, 0),
        total_count: agingReport.length,
        overdue_count: agingReport.filter((r: any) => r.days_overdue > 0).length,
        summary,
        details: agingReport
      });
    }
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/cash-advances/aging/notify-overdue - mark overdue advances and notify employees
router.post('/aging/notify-overdue', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const thresholds = await getCashAdvanceAgingConfig();
    const now = new Date().toISOString();
    const { data: cashAdvances, error } = await supabase
      .from('cash_advances')
      .select('id, employee_id, advance_code, liquidation_due_at, status')
      .in('status', ['outstanding', 'partially_liquidated'])
      .lt('liquidation_due_at', now);

    if (error) throw error;

    const updates = (cashAdvances || []).map((advance: any) => advance.id);
    if (updates.length > 0) {
      await supabase
        .from('cash_advances')
        .update({ status: 'overdue', updated_at: new Date().toISOString() })
        .in('id', updates);

      await Promise.all(
        (cashAdvances || []).map(async (advance: any) => {
          await notifyUser(
            advance.employee_id,
            'Cash Advance Overdue',
            `Cash advance ${advance.advance_code} is now overdue. Please provide your liquidation documents as soon as possible.`
          );
        })
      );
    }

    res.json({
      updated: updates.length,
      overdue_threshold_days: thresholds.overdue_notification_days,
      details: cashAdvances || []
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/cash-advances/:id - Get cash advance details with liquidation items
router.get('/:id', authenticate, async (req: any, res) => {
  try {
    const { id } = req.params;

    const { data: cashAdvance, error: caError } = await supabase
      .from('cash_advances')
      .select(`
        *,
        employee:users!cash_advances_employee_id_fkey(id, name, email),
        department:departments(id, name),
        issuer:users!cash_advances_issued_by_fkey(id, name),
        original_request:expense_requests!cash_advances_request_id_fkey(id, request_code, status)
      `)
      .eq('id', id)
      .single();

    if (caError) throw caError;
    if (!cashAdvance) {
      return res.status(404).json({ error: 'Cash advance not found' });
    }

    // Get liquidations separately since there's no direct FK relationship
    const { data: liquidations } = await supabase
      .from('request_liquidations')
      .select('*')
      .eq('request_id', cashAdvance.request_id)
      .order('created_at', { ascending: false });

    // Check permission
    if ((req.user.role === 'employee' || req.user.role === 'manager') && cashAdvance.employee_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Get liquidation items
    const { data: items, error: itemsError } = await supabase
      .from('liquidation_items')
      .select(`
        *,
        category:budget_categories(id, category_code, category_name)
      `)
      .eq('cash_advance_id', id)
      .order('expense_date', { ascending: true });

    if (itemsError) throw itemsError;

    res.json({
      ...cashAdvance,
      liquidation_items: items || [],
      liquidations: liquidations || []
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/cash-advances - Create cash advance (when request is approved)
router.post('/', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { request_id, amount_issued, expected_liquidation_date, purpose, liquidation_due_at } = req.body;

    // Get request details
    const { data: request, error: reqError } = await supabase
      .from('expense_requests')
      .select('*, users(id, name, email, department_id)')
      .eq('id', request_id)
      .single();

    if (reqError || !request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    // Prevent duplicate cash advances for the same request
    const { data: existingCA } = await supabase
      .from('cash_advances')
      .select('id, advance_code')
      .eq('request_id', request_id)
      .maybeSingle();

    if (existingCA) {
      return res.status(409).json({ error: `A cash advance (${existingCA.advance_code}) already exists for this request.` });
    }

    const advanceCode = `CA-${Date.now().toString().slice(-6)}`;

    const { data, error } = await supabase
      .from('cash_advances')
      .insert({
        request_id,
        employee_id: request.employee_id,
        department_id: request.department_id,
        advance_code: advanceCode,
        amount_issued,
        amount_liquidated: 0,
        balance: amount_issued,
        expected_liquidation_date,
        liquidation_due_at: liquidation_due_at || expected_liquidation_date,
        purpose: purpose || request.purpose,
        status: 'outstanding',
        issued_at: new Date(),
        issued_by: req.user.id
      })
      .select()
      .single();

    if (error) throw error;

    // Update request to link to cash advance
    await supabase
      .from('expense_requests')
      .update({ 
        status: 'released',
        released_at: new Date(),
        released_by: req.user.id,
        disbursement_status: 'released'
      })
      .eq('id', request_id);

    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/cash-advances/:id/liquidate - Add liquidation items
router.post('/:id/liquidate', authenticate, authorize('employee', 'manager', 'accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { id } = req.params;
    const { items, liquidation_request_id } = req.body;
    // items: [{ expense_date, category_id, description, amount, receipt_attached }]

    // Get cash advance
    const { data: cashAdvance, error: caError } = await supabase
      .from('cash_advances')
      .select('*')
      .eq('id', id)
      .single();

    if (caError || !cashAdvance) {
      return res.status(404).json({ error: 'Cash advance not found' });
    }

    // Check permission
    if ((req.user.role === 'employee' || req.user.role === 'manager') && cashAdvance.employee_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Get department name for validation
    const { data: deptData } = await supabase.from('departments').select('name').eq('id', cashAdvance.department_id).single();
    const departmentName = deptData?.name || 'Unknown';

    // Validate all items against the official list (allow freehand descriptions)
    for (const item of items) {
      const validation = validateExpense(item.description, departmentName, 'reimbursement', [], req.user.role, true);
      if (!validation.allowed) {
        return res.status(400).json({ 
          error: `Item "${item.description}" is not allowed: ${validation.reason}`,
          details: validation
        });
      }
    }

    // Insert liquidation items
    const itemsToInsert = items.map((item: any) => ({
      cash_advance_id: id,
      liquidation_id: liquidation_request_id,
      expense_date: item.expense_date,
      category_id: item.category_id,
      description: item.description,
      amount: item.amount,
      receipt_attached: item.receipt_attached || false,
      created_at: new Date()
    }));

    const { data: insertedItems, error: insertError } = await supabase
      .from('liquidation_items')
      .insert(itemsToInsert)
      .select();

    if (insertError) throw insertError;

    // Update cash advance status will be handled by trigger
    res.json({
      message: 'Liquidation items added',
      items: insertedItems,
      cash_advance_id: id
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/cash-advances/employee/:employee_id - Get employee's cash advances
router.get('/employee/:employee_id', authenticate, async (req: any, res) => {
  try {
    const { employee_id } = req.params;

    // Check permission
    if ((req.user.role === 'employee' || req.user.role === 'manager') && req.user.id !== employee_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { data, error } = await supabase
      .from('cash_advances')
      .select(`
        *,
        department:departments(id, name)
      `)
      .eq('employee_id', employee_id)
      .order('issued_at', { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/cash-advances/for-liquidation/:employee_id - Get outstanding advances available for liquidation
router.get('/for-liquidation/:employee_id', authenticate, async (req: any, res) => {
  try {
    const { employee_id } = req.params;

    // Check permission
    if ((req.user.role === 'employee' || req.user.role === 'manager') && req.user.id !== employee_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { data, error } = await supabase
      .from('cash_advances')
      .select(`
        *,
        department:departments(id, name)
      `)
      .eq('employee_id', employee_id)
      .in('status', ['outstanding', 'partially_liquidated', 'overdue'])
      .gt('balance', 0)
      .order('issued_at', { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/cash-advances/:id/submit-liquidation - Mark for accounting review
router.post('/:id/submit-liquidation', authenticate, authorize('employee', 'manager', 'supervisor', 'accounting'), async (req: any, res) => {
  try {
    const { id } = req.params;

    // Get current CA to validate ownership and balance
    const { data: ca, error: caFetchError } = await supabase
      .from('cash_advances')
      .select('id, employee_id, balance')
      .eq('id', id)
      .single();

    if (caFetchError || !ca) return res.status(404).json({ error: 'Cash advance not found' });

    // Employee/manager can only submit their own; supervisor/accounting can submit for anyone
    const trustedRoles = ['supervisor', 'accounting', 'admin', 'super_admin'];
    if (!trustedRoles.includes(req.user.role) && ca.employee_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden: you do not own this cash advance' });
    }

    const newStatus = (Number(ca.balance) <= 0) ? 'fully_liquidated' : 'partially_liquidated';

    const { data, error } = await supabase
      .from('cash_advances')
      .update({ 
        status: newStatus,
        updated_at: new Date()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
