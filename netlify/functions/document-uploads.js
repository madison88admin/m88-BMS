const { supabase } = require('./utils/supabase');
const { authenticate, authorize } = require('./utils/auth');
const { notifyAccounting, notifyUser } = require('./utils/workflowNotify');
const { logAuditEvent } = require('./utils/auditLog');
const departmentNameMap = require('../../backend/src/constants/departmentNameMap.json');

const normalizeRole = (role) => String(role || '').trim().toLowerCase();
const toNumber = (value) => Number.parseFloat(value ?? 0) || 0;
const formatMoney = (value) => {
  const num = toNumber(value);
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(num);
};

const resolveExpenseCategoryDepartmentName = (value) => {
  const key = String(value || '').trim();
  if (!key) return null;
  const mapped = departmentNameMap[key];
  if (mapped !== undefined) return mapped;
  return key;
};

const normalizeFileType = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.includes('/')) {
    if (raw.includes('pdf')) return 'pdf';
    if (raw.includes('png')) return 'png';
    if (raw.includes('jpeg') || raw.includes('jpg')) return 'jpg';
  }
  const normalized = raw.replace(/^\./, '');
  if (normalized === 'jpeg') return 'jpg';
  return normalized;
};

const assertAllowedFileType = (value) => {
  const normalized = normalizeFileType(value);
  if (!['pdf', 'jpg', 'png'].includes(normalized)) {
    throw new Error('Only PDF, JPG, and PNG files are allowed');
  }
  return normalized;
};

const extractRouteParts = (event) => {
  const parts = (event.path || '').split('/').filter(Boolean);
  const anchor = parts.lastIndexOf('document-uploads');
  if (anchor === -1) return [];
  return parts.slice(anchor + 1);
};

const loadUserDepartment = async (departmentId) => {
  const { data, error } = await supabase
    .from('departments')
    .select('id, name')
    .eq('id', departmentId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

const loadUpload = async (uploadId) => {
  const { data: upload, error } = await supabase
    .from('document_uploads')
    .select('*')
    .eq('id', uploadId)
    .maybeSingle();
  if (error) throw error;
  return upload;
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  try {
    const token = event.headers.authorization;
    const user = authenticate(token);
    const routeParts = extractRouteParts(event);

    if (event.httpMethod === 'PATCH' && routeParts.length === 2 && routeParts[1] === 'review') {
      authorize(['accounting', 'admin', 'super_admin'])(user);
      const uploadId = String(routeParts[0] || '').trim();
      if (!uploadId) {
        return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Invalid upload id' }) };
      }

      const body = (() => {
        try { return event.body ? JSON.parse(event.body) : {}; } catch { return {}; }
      })();
      const nextStatus = String(body.status || '').trim();
      if (!['acknowledged', 'returned'].includes(nextStatus)) {
        return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Invalid review status' }) };
      }

      const remarks = String(body.remarks || '').trim();
      const targetDepartmentId = String(body.target_department_id || '').trim();
      if (nextStatus === 'returned' && !remarks) {
        return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Remarks are required when returning an upload' }) };
      }

      const current = await loadUpload(uploadId);
      if (!current) {
        return { statusCode: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Upload not found' }) };
      }

      const updateData = {
        status: nextStatus,
        accounting_remarks: remarks || null,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (targetDepartmentId && nextStatus === 'acknowledged') {
        updateData.target_department_id = targetDepartmentId;
      }

      const { data: updated, error: updateError } = await supabase
        .from('document_uploads')
        .update(updateData)
        .eq('id', uploadId)
        .select('*')
        .single();
      if (updateError) throw updateError;

      await notifyUser(
        String(updated.uploaded_by),
        'Document Upload Update',
        `Your document upload (${updated.category_code} ${updated.category_name}) was ${nextStatus}.${remarks ? ` Remarks: ${remarks}` : ''}`
      );
      await logAuditEvent({
        user,
        actionType: 'document_upload_reviewed',
        recordType: 'document_upload',
        recordId: uploadId,
        recordLabel: `${updated.category_code} ${updated.category_name}`,
        oldValue: { status: current.status, accounting_remarks: current.accounting_remarks || null },
        newValue: { status: nextStatus, accounting_remarks: remarks || null },
      });

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(await loadUpload(uploadId)),
      };
    }

    if (event.httpMethod === 'GET' && routeParts.length === 0) {
      const qs = event.queryStringParameters || {};
      const role = normalizeRole(user.role);

      let query = supabase
        .from('document_uploads')
        .select('*')
        .order('created_at', { ascending: false });

      if (qs.category_code) query = query.eq('category_code', String(qs.category_code));
      if (qs.status) query = query.eq('status', String(qs.status));
      if (qs.department_id) query = query.eq('department_id', String(qs.department_id));
      if (qs.fiscal_year) {
        const year = Number.parseInt(String(qs.fiscal_year), 10);
        if (Number.isInteger(year) && year > 0) query = query.eq('fiscal_year', year);
      }
      if (qs.start_date) query = query.gte('created_at', String(qs.start_date));
      if (qs.end_date) query = query.lte('created_at', String(qs.end_date));

      if (['accounting', 'admin', 'super_admin', 'vp', 'president'].includes(role)) {
        // Accounting and admins can see all, or filter by department if specified
        if (!qs.department_id && role === 'supervisor') {
          if (!user.department_id) {
            return { statusCode: 403, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Forbidden' }) };
          }
          query = query.eq('department_id', String(user.department_id));
        }
      } else if (role === 'supervisor') {
        if (!user.department_id) {
          return { statusCode: 403, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Forbidden' }) };
        }
        query = query.eq('department_id', String(user.department_id));
      } else {
        query = query.eq('uploaded_by', String(user.id));
      }

      const { data: uploads, error } = await query;
      if (error) throw error;

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(uploads || []),
      };
    }

    if (event.httpMethod === 'POST' && routeParts.length === 0) {
      const body = (() => {
        try { return event.body ? JSON.parse(event.body) : {}; } catch { return {}; }
      })();

      const departmentId = String(body.department_id || '').trim();
      const categoryCode = String(body.category_code || '').trim();
      const description = String(body.description || '').trim();
      const amount = toNumber(body.amount);
      const adjustmentType = String(body.adjustment_type || 'increase').trim();
      const fiscalYear = body.fiscal_year ? Number.parseInt(String(body.fiscal_year), 10) : 2026;

      if (!departmentId) {
        return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Department is required' }) };
      }
      if (!categoryCode) {
        return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Sub-category is required' }) };
      }
      if (!amount || amount <= 0) {
        return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'New budget amount is required' }) };
      }

      const { data: categoryRow, error: categoryError } = await supabase
        .from('expense_categories')
        .select('code, description, main_category_code, main_category_name, department, manner_of_submission, cash_advance_allowed, reimbursement_allowed')
        .eq('code', categoryCode)
        .maybeSingle();
      if (categoryError) throw categoryError;

      if (!categoryRow || String(categoryRow.manner_of_submission) !== 'for_upload') {
        return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Selected sub-category is not eligible for budget allocation' }) };
      }

      const { data: department, error: deptError } = await supabase
        .from('departments')
        .select('id, name')
        .eq('id', departmentId)
        .maybeSingle();
      if (deptError || !department) {
        return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Department not found' }) };
      }

      const role = normalizeRole(user.role);
      const isFinanceRole = role === 'accounting' || role === 'admin' || role === 'super_admin';
      const nowIso = new Date().toISOString();

      const { data: inserted, error: insertError } = await supabase
        .from('document_uploads')
        .insert({
          category_code: categoryRow.code,
          category_name: categoryRow.description,
          main_category_code: categoryRow.main_category_code,
          main_category_name: categoryRow.main_category_name,
          department_id: departmentId,
          uploaded_by: user.id,
          uploaded_by_role: role,
          description: description || 'Budget override',
          amount,
          adjustment_type: adjustmentType,
          fiscal_year: Number.isInteger(fiscalYear) && fiscalYear > 0 ? fiscalYear : null,
          status: isFinanceRole ? 'acknowledged' : 'submitted_to_accounting',
          reviewed_by: isFinanceRole ? user.id : null,
          reviewed_at: isFinanceRole ? nowIso : null,
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select('*')
        .single();
      if (insertError) throw insertError;

      if (!isFinanceRole) {
        await notifyAccounting(
          `New budget allocation submitted: ${inserted.category_code} ${inserted.category_name} (${formatMoney(amount)}).`
        );
      }
      await logAuditEvent({
        user,
        actionType: isFinanceRole ? 'budget_override_logged' : 'budget_allocation_created',
        recordType: 'document_upload',
        recordId: inserted.id,
        recordLabel: `${inserted.category_code} ${inserted.category_name}`,
        newValue: {
          status: inserted.status,
          category_code: inserted.category_code,
          department_id: inserted.department_id,
          fiscal_year: inserted.fiscal_year,
          amount: inserted.amount,
          adjustment_type: inserted.adjustment_type,
        },
      });

      return {
        statusCode: 201,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(inserted),
      };
    }

    return {
      statusCode: 404,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Route not found' }),
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message || String(error) }),
    };
  }
};
