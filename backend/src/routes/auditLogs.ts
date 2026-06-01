import { Router, Response } from 'express';
import PDFDocument from 'pdfkit';
import { supabase } from '../utils/supabase';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

const VIEW_ROLES = ['accounting', 'vp', 'president', 'admin', 'super_admin'];
const EXPORT_ROLES = ['accounting', 'vp', 'president', 'admin', 'super_admin'];

const buildAuditQuery = (filters: {
  action?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  limit?: number;
}) => {
  let query = supabase.from('audit_logs').select('*').order('created_at', { ascending: false });
  if (filters.action && filters.action !== 'all') {
    query = query.eq('action_type', filters.action);
  }
  if (filters.startDate) query = query.gte('created_at', filters.startDate);
  if (filters.endDate) query = query.lte('created_at', filters.endDate);
  if (filters.limit) query = query.limit(filters.limit);
  return query;
};

// GET /api/audit-logs
router.get('/', authenticate, authorize(...VIEW_ROLES), async (req: any, res) => {
  try {
    const { action, start_date, end_date, search, limit } = req.query;
    const { data, error } = await buildAuditQuery({
      action: action as string,
      startDate: start_date as string,
      endDate: end_date as string,
      limit: limit ? parseInt(String(limit), 10) : 500,
    });

    if (error) throw error;

    let rows = data || [];
    if (search) {
      const q = String(search).toLowerCase();
      rows = rows.filter((row: any) =>
        [row.user_name, row.action_type, row.record_label, row.remarks, row.department_name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    }

    res.json(rows);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/audit-logs/export.csv
router.get('/export.csv', authenticate, authorize(...EXPORT_ROLES), async (req: any, res) => {
  try {
    const { data, error } = await buildAuditQuery({ limit: 5000 });
    if (error) throw error;

    const headers = ['Timestamp', 'User', 'Role', 'Department', 'Action', 'Record', 'Old Value', 'New Value', 'Remarks'];
    const lines = [headers.join(',')];
    (data || []).forEach((row: any) => {
      lines.push([
        row.created_at,
        `"${String(row.user_name || '').replace(/"/g, '""')}"`,
        row.user_role,
        `"${String(row.department_name || '').replace(/"/g, '""')}"`,
        row.action_type,
        `"${String(row.record_label || row.record_id || '').replace(/"/g, '""')}"`,
        `"${JSON.stringify(row.old_value ?? '').replace(/"/g, '""')}"`,
        `"${JSON.stringify(row.new_value ?? '').replace(/"/g, '""')}"`,
        `"${String(row.remarks || '').replace(/"/g, '""')}"`,
      ].join(','));
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit_logs.csv"');
    res.send(lines.join('\n'));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/audit-logs/export.pdf
router.get('/export.pdf', authenticate, authorize(...EXPORT_ROLES), async (req: any, res: Response) => {
  try {
    const { data, error } = await buildAuditQuery({ limit: 500 });
    if (error) throw error;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="audit_logs.pdf"');

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.pipe(res);
    doc.fontSize(16).text('BMS Audit Trail Export', { underline: true });
    doc.moveDown();
    doc.fontSize(9);

    (data || []).forEach((row: any, index: number) => {
      if (index > 0) doc.moveDown(0.5);
      doc.text(`${row.created_at} | ${row.user_name} (${row.user_role})`);
      doc.text(`Action: ${row.action_type} | Record: ${row.record_label || row.record_id || '—'}`);
      if (row.remarks) doc.text(`Remarks: ${row.remarks}`);
      if (row.old_value || row.new_value) {
        doc.text(`Change: ${JSON.stringify(row.old_value)} → ${JSON.stringify(row.new_value)}`);
      }
    });

    doc.end();
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/audit-logs/budget-revisions/:categoryId
router.get('/budget-revisions/:categoryId', authenticate, authorize('accounting', 'vp', 'president', 'admin', 'super_admin', 'supervisor'), async (req: any, res) => {
  try {
    const { categoryId } = req.params;
    const { data, error } = await supabase
      .from('budget_revision_history')
      .select('*')
      .eq('category_id', categoryId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
