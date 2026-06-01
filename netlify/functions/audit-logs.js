const { supabase } = require('./utils/supabase');
const { authenticate, authorize } = require('./utils/auth');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const json = (statusCode, body) => ({
  statusCode,
  headers: corsHeaders,
  body: JSON.stringify(body),
});

const VIEW_ROLES = ['accounting', 'vp', 'president', 'admin', 'super_admin'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const token = event.headers.authorization;
    const user = authenticate(token);
    authorize(VIEW_ROLES)(user);

    const path = event.path || '';
    const isExportCsv = path.includes('export.csv');
    const isExportPdf = path.includes('export.pdf');
    const limit = parseInt(event.queryStringParameters?.limit || '500', 10);

    let query = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(limit);

    const { action, start_date, end_date, search } = event.queryStringParameters || {};
    if (action && action !== 'all') query = query.eq('action_type', action);
    if (start_date) query = query.gte('created_at', start_date);
    if (end_date) query = query.lte('created_at', end_date);

    const { data, error } = await query;
    if (error) throw error;

    let rows = data || [];
    if (search) {
      const q = String(search).toLowerCase();
      rows = rows.filter((row) =>
        [row.user_name, row.action_type, row.record_label, row.remarks, row.department_name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    }

    if (isExportCsv) {
      const headers = ['Timestamp', 'User', 'Role', 'Department', 'Action', 'Record', 'Old Value', 'New Value', 'Remarks'];
      const lines = [headers.join(',')];
      rows.forEach((row) => {
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

      return {
        statusCode: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="audit_logs.csv"',
        },
        body: lines.join('\n'),
      };
    }

    if (isExportPdf) {
      const textLines = ['BMS Audit Trail Export', ''];
      rows.forEach((row) => {
        textLines.push(`${row.created_at} | ${row.user_name} (${row.user_role})`);
        textLines.push(`Action: ${row.action_type} | Record: ${row.record_label || row.record_id || '—'}`);
        if (row.remarks) textLines.push(`Remarks: ${row.remarks}`);
        textLines.push('');
      });

      return {
        statusCode: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/plain',
          'Content-Disposition': 'attachment; filename="audit_logs.txt"',
        },
        body: textLines.join('\n'),
      };
    }

    return json(200, rows);
  } catch (error) {
    const message = error.message || 'Internal server error';
    const statusCode =
      message === 'Forbidden' ? 403 : message === 'Access denied' || message === 'Invalid token' ? 401 : 400;
    return json(statusCode, { error: message });
  }
};
