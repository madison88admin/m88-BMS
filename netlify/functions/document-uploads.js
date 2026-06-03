const { supabase } = require('./utils/supabase');
const { authenticate, authorize } = require('./utils/auth');
const { notifyAccounting, notifyUser } = require('./utils/workflowNotify');
const { logAuditEvent } = require('./utils/auditLog');
const departmentNameMap = require('../../backend/src/constants/departmentNameMap.json');

const normalizeRole = (role) => String(role || '').trim().toLowerCase();
const toNumber = (value) => Number.parseFloat(value ?? 0) || 0;

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

const loadUploadWithAttachments = async (uploadId) => {
  const { data: upload, error } = await supabase
    .from('document_uploads')
    .select('*')
    .eq('id', uploadId)
    .maybeSingle();
  if (error) throw error;
  if (!upload) return null;

  const { data: attachments, error: attachmentError } = await supabase
    .from('document_upload_attachments')
    .select('*')
    .eq('document_upload_id', uploadId)
    .order('created_at', { ascending: true });
  if (attachmentError) throw attachmentError;

  return { ...upload, attachments: attachments || [] };
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
      if (nextStatus === 'returned' && !remarks) {
        return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Remarks are required when returning an upload' }) };
      }

      const current = await loadUploadWithAttachments(uploadId);
      if (!current) {
        return { statusCode: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Upload not found' }) };
      }

      const { data: updated, error: updateError } = await supabase
        .from('document_uploads')
        .update({
          status: nextStatus,
          accounting_remarks: remarks || null,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
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
        body: JSON.stringify(await loadUploadWithAttachments(uploadId)),
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
      if (qs.fiscal_year) {
        const year = Number.parseInt(String(qs.fiscal_year), 10);
        if (Number.isInteger(year) && year > 0) query = query.eq('fiscal_year', year);
      }

      if (['accounting', 'admin', 'super_admin', 'vp', 'president'].includes(role)) {
        if (qs.department_id) query = query.eq('department_id', String(qs.department_id));
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
      const uploadIds = (uploads || []).map((row) => row.id);
      if (!uploadIds.length) {
        return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify([]) };
      }

      const { data: attachments, error: attachmentError } = await supabase
        .from('document_upload_attachments')
        .select('*')
        .in('document_upload_id', uploadIds)
        .order('created_at', { ascending: true });
      if (attachmentError) throw attachmentError;

      const attachmentsByUploadId = new Map();
      (attachments || []).forEach((entry) => {
        const list = attachmentsByUploadId.get(entry.document_upload_id) || [];
        list.push(entry);
        attachmentsByUploadId.set(entry.document_upload_id, list);
      });

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(
          (uploads || []).map((row) => ({
            ...row,
            attachments: attachmentsByUploadId.get(row.id) || [],
          }))
        ),
      };
    }

    if (event.httpMethod === 'POST' && routeParts.length === 0) {
      const departmentId = String(user.department_id || '').trim();
      if (!user.id || !departmentId) {
        return { statusCode: 403, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Forbidden' }) };
      }

      const body = (() => {
        try { return event.body ? JSON.parse(event.body) : {}; } catch { return {}; }
      })();

      const categoryCode = String(body.category_code || '').trim();
      const description = String(body.description || '').trim();
      const attachments = Array.isArray(body.attachments) ? body.attachments : [];

      if (!categoryCode) {
        return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Sub-category is required' }) };
      }
      if (!description) {
        return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Description / remarks is required' }) };
      }
      if (!attachments.length) {
        return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'At least one attachment is required' }) };
      }

      const { data: categoryRow, error: categoryError } = await supabase
        .from('expense_categories')
        .select('code, description, main_category_code, main_category_name, department, manner_of_submission, cash_advance_allowed, reimbursement_allowed')
        .eq('code', categoryCode)
        .maybeSingle();
      if (categoryError) throw categoryError;

      if (!categoryRow || String(categoryRow.manner_of_submission) !== 'for_upload') {
        return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Selected sub-category is not eligible for document upload' }) };
      }

      const department = await loadUserDepartment(departmentId);
      if (!department?.name) {
        return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Unable to resolve user department' }) };
      }

      const canCA = Boolean(categoryRow.cash_advance_allowed);
      const canRE = Boolean(categoryRow.reimbursement_allowed);
      const requiresAmount = canCA || canRE;
      const amountValue = toNumber(body.amount);
      if (requiresAmount && amountValue <= 0) {
        return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Amount is required for this category' }) };
      }

      const targetFiscalYear = body.fiscal_year ? Number.parseInt(String(body.fiscal_year), 10) : 2026;
      if (requiresAmount && amountValue > 0) {
        const { data: budgetData, error: budgetError } = await supabase
          .from('budget_categories')
          .select('id, remaining_amount, category_name')
          .eq('department_id', departmentId)
          .eq('fiscal_year', targetFiscalYear)
          .eq('category_code', categoryCode)
          .maybeSingle();
        if (budgetError) throw budgetError;
        if (budgetData) {
          const remaining = Number(budgetData.remaining_amount);
          if (remaining < amountValue) {
            return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: `Insufficient budget in "${budgetData.category_name || categoryCode}". Available: ₱${remaining.toFixed(2)}, Requested: ₱${amountValue.toFixed(2)}` }) };
          }
        }
      }

      const resolvedExpenseDepartment = resolveExpenseCategoryDepartmentName(String(categoryRow.department || ''));
      const isFinanceOrAdminDept = department.name === 'Finance Department' || department.name === 'Admin Department';

      if (!canCA && !canRE) {
        if (!isFinanceOrAdminDept) {
          return { statusCode: 403, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Only Finance and Admin departments can upload documents for this category' }) };
        }
        if (resolvedExpenseDepartment && resolvedExpenseDepartment !== department.name) {
          return { statusCode: 403, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Category is not available for your department' }) };
        }
      } else if (!(canCA && canRE)) {
        if (resolvedExpenseDepartment && resolvedExpenseDepartment !== department.name) {
          return { statusCode: 403, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Category is not available for your department' }) };
        }
      }

      const role = normalizeRole(user.role);

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
          description,
          amount: requiresAmount ? amountValue : amountValue || null,
          fiscal_year: Number.isInteger(targetFiscalYear) && targetFiscalYear > 0 ? targetFiscalYear : null,
          status: 'submitted_to_accounting',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('*')
        .single();
      if (insertError) throw insertError;

      const attachmentPayload = attachments.map((file) => ({
        document_upload_id: inserted.id,
        file_name: String(file.file_name || '').trim(),
        file_url: String(file.file_url || '').trim(),
        file_type: assertAllowedFileType(String(file.file_type || file.attachment_type || '')),
        file_size: file.file_size !== undefined && file.file_size !== null ? Number(file.file_size) : null,
        created_at: new Date().toISOString(),
      }));

      if (attachmentPayload.some((entry) => !entry.file_name || !entry.file_url)) {
        return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Invalid attachment payload' }) };
      }

      const { error: attachmentInsertError } = await supabase
        .from('document_upload_attachments')
        .insert(attachmentPayload);
      if (attachmentInsertError) throw attachmentInsertError;

      await notifyAccounting(
        `New document upload submitted: ${inserted.category_code} ${inserted.category_name} (${department.name}).`
      );
      await logAuditEvent({
        user,
        actionType: 'document_uploaded',
        recordType: 'document_upload',
        recordId: inserted.id,
        recordLabel: `${inserted.category_code} ${inserted.category_name}`,
        newValue: {
          status: inserted.status,
          category_code: inserted.category_code,
          department_id: inserted.department_id,
          fiscal_year: inserted.fiscal_year,
        },
      });

      return {
        statusCode: 201,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(await loadUploadWithAttachments(inserted.id)),
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
