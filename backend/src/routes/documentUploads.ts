import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { supabase } from '../utils/supabase';
import { resolveExpenseCategoryDepartmentName } from '../constants/departmentMapping';
import { logAuditEvent } from '../utils/auditLog';
import { notifyAccounting, notifyUser } from '../utils/workflowNotify';

const router = Router();
const toNumber = (value: any) => Number.parseFloat(value ?? 0) || 0;
const normalizeRole = (role?: string) => String(role || '').trim().toLowerCase();

const adjustBudgetForDocumentUpload = async (upload: any, deduct: boolean) => {
  const amount = toNumber(upload.amount);
  if (amount <= 0 || !upload.department_id || !upload.fiscal_year || !upload.category_code) {
    return;
  }

  // Try to match by category_code first, then by category_name
  let categoryBudget = null;
  let categoryError = null;

  // First try: match by category_code
  const { data: categoryByCode, error: codeError } = await supabase
    .from('budget_categories')
    .select('id, used_amount, remaining_amount')
    .eq('department_id', upload.department_id)
    .eq('fiscal_year', upload.fiscal_year)
    .eq('category_code', upload.category_code)
    .maybeSingle();

  if (!codeError && categoryByCode) {
    categoryBudget = categoryByCode;
  } else {
    // Second try: match by category_name (for sub-categories)
    if (upload.category_name) {
      const { data: categoryByName, error: nameError } = await supabase
        .from('budget_categories')
        .select('id, used_amount, remaining_amount')
        .eq('department_id', upload.department_id)
        .eq('fiscal_year', upload.fiscal_year)
        .eq('category_name', upload.category_name)
        .maybeSingle();
      
      if (!nameError && categoryByName) {
        categoryBudget = categoryByName;
      }
    }
  }

  if (!categoryBudget) {
    // Create new budget category if it doesn't exist
    if (!upload.category_name) {
      return;
    }

    const { data: insertedBudget, error: insertBudgetError } = await supabase
      .from('budget_categories')
      .insert({
        department_id: upload.department_id,
        fiscal_year: upload.fiscal_year,
        category_code: upload.category_code,
        category_name: upload.category_name,
        budget_amount: amount,
        used_amount: deduct ? amount : 0,
        remaining_amount: deduct ? 0 : amount,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    if (insertBudgetError) {
      throw insertBudgetError;
    }
    return;
  }

  const nextUsed = deduct
    ? toNumber(categoryBudget.used_amount) + amount
    : Math.max(0, toNumber(categoryBudget.used_amount) - amount);
  const nextRemaining = deduct
    ? Math.max(0, toNumber(categoryBudget.remaining_amount) - amount)
    : toNumber(categoryBudget.remaining_amount) + amount;

  await supabase
    .from('budget_categories')
    .update({
      used_amount: nextUsed,
      remaining_amount: nextRemaining,
      updated_at: new Date().toISOString(),
    })
    .eq('id', categoryBudget.id);
};

const normalizeFileType = (input: string) => {
  const value = String(input || '').trim().toLowerCase();
  if (!value) return '';
  if (value.includes('/')) {
    if (value.includes('pdf')) return 'pdf';
    if (value.includes('png')) return 'png';
    if (value.includes('jpeg') || value.includes('jpg')) return 'jpg';
  }
  const normalized = value.replace(/^\./, '');
  if (normalized === 'jpeg') return 'jpg';
  return normalized;
};

const assertAllowedFileType = (fileType: string) => {
  const normalized = normalizeFileType(fileType);
  if (!['pdf', 'jpg', 'png'].includes(normalized)) {
    throw new Error('Only PDF, JPG, and PNG files are allowed');
  }
  return normalized;
};

const loadUserDepartment = async (departmentId: string) => {
  const { data, error } = await supabase
    .from('departments')
    .select('id, name')
    .eq('id', departmentId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

const loadUploadWithAttachments = async (uploadId: string) => {
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

const loadUploadBudgetInfo = async (uploads: any[]) => {
  const departmentIds = Array.from(new Set(uploads.map((upload) => String(upload.department_id || '').trim()).filter(Boolean)));
  const fiscalYears = Array.from(new Set(uploads.map((upload) => Number.parseInt(String(upload.fiscal_year || ''), 10)).filter((year) => Number.isInteger(year))));
  const categoryCodes = Array.from(new Set(uploads.map((upload) => String(upload.category_code || '').trim()).filter(Boolean)));

  if (!departmentIds.length || !fiscalYears.length || !categoryCodes.length) {
    return new Map<string, any>();
  }

  const { data: budgets, error } = await supabase
    .from('budget_categories')
    .select('department_id, fiscal_year, category_code, remaining_amount, used_amount, budget_amount')
    .in('department_id', departmentIds)
    .in('fiscal_year', fiscalYears)
    .in('category_code', categoryCodes);
  if (error) throw error;

  const map = new Map<string, any>();
  (budgets || []).forEach((row: any) => {
    const key = `${String(row.department_id)}|${String(row.fiscal_year)}|${String(row.category_code)}`;
    map.set(key, row);
  });

  return map;
};

router.post('/', authenticate, async (req: any, res) => {
  try {
    const user = req.user;
    const departmentId = String(user?.department_id || '').trim();
    if (!user?.id || !departmentId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const {
      category_code,
      description,
      amount,
      fiscal_year,
      attachments,
    } = req.body || {};

    const normalizedCode = String(category_code || '').trim();
    if (!normalizedCode) {
      return res.status(400).json({ error: 'Sub-category is required' });
    }

    const normalizedDescription = String(description || '').trim();
    if (!normalizedDescription) {
      return res.status(400).json({ error: 'Description / remarks is required' });
    }

    const uploadAttachments = Array.isArray(attachments) ? attachments : [];
    if (!uploadAttachments.length) {
      return res.status(400).json({ error: 'At least one attachment is required' });
    }

    const { data: categoryRow, error: categoryError } = await supabase
      .from('expense_categories')
      .select('code, description, main_category_code, main_category_name, department, manner_of_submission, cash_advance_allowed, reimbursement_allowed')
      .eq('code', normalizedCode)
      .maybeSingle();
    if (categoryError) throw categoryError;

    if (!categoryRow || String(categoryRow.manner_of_submission) !== 'for_upload') {
      return res.status(400).json({ error: 'Selected sub-category is not eligible for document upload' });
    }

    const userDepartment = await loadUserDepartment(departmentId);
    if (!userDepartment?.name) {
      return res.status(400).json({ error: 'Unable to resolve user department' });
    }

    const canCA = Boolean(categoryRow.cash_advance_allowed);
    const canRE = Boolean(categoryRow.reimbursement_allowed);
    const requiresAmount = canCA || canRE;
    const amountValue = toNumber(amount);
    if (requiresAmount && amountValue <= 0) {
      return res.status(400).json({ error: 'Amount is required for this category' });
    }

    const resolvedExpenseDepartment = resolveExpenseCategoryDepartmentName(String(categoryRow.department || ''));
    const role = normalizeRole(user.role);
    const isFinanceOrAdminDept =
      userDepartment.name === 'Finance Department'
      || userDepartment.name === 'Admin Department';

    if (!canCA && !canRE) {
      if (!isFinanceOrAdminDept) {
        return res.status(403).json({ error: 'Only Finance and Admin departments can upload documents for this category' });
      }
      if (resolvedExpenseDepartment && resolvedExpenseDepartment !== userDepartment.name) {
        return res.status(403).json({ error: 'Category is not available for your department' });
      }
    } else if (!(canCA && canRE)) {
      if (resolvedExpenseDepartment && resolvedExpenseDepartment !== userDepartment.name) {
        return res.status(403).json({ error: 'Category is not available for your department' });
      }
    }

    const targetFiscalYear = fiscal_year ? Number.parseInt(String(fiscal_year), 10) : 2026;

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
        description: normalizedDescription,
        amount: requiresAmount ? amountValue : amountValue || null,
        fiscal_year: Number.isInteger(targetFiscalYear) && targetFiscalYear > 0 ? targetFiscalYear : null,
        status: 'submitted_to_accounting',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    if (insertError) throw insertError;

    const attachmentPayload = uploadAttachments.map((file: any) => ({
      document_upload_id: inserted.id,
      file_name: String(file.file_name || '').trim(),
      file_url: String(file.file_url || '').trim(),
      file_type: assertAllowedFileType(String(file.file_type || file.attachment_type || '')),
      file_size: file.file_size !== undefined && file.file_size !== null ? Number(file.file_size) : null,
      created_at: new Date().toISOString(),
    }));

    if (attachmentPayload.some((entry: any) => !entry.file_name || !entry.file_url)) {
      return res.status(400).json({ error: 'Invalid attachment payload' });
    }

    const { error: attachmentInsertError } = await supabase
      .from('document_upload_attachments')
      .insert(attachmentPayload);
    if (attachmentInsertError) throw attachmentInsertError;

    await notifyAccounting(
      `New document upload submitted: ${inserted.category_code} ${inserted.category_name} (${userDepartment.name}).`
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

    res.status(201).json(await loadUploadWithAttachments(inserted.id));
  } catch (err: any) {
    res.status(400).json({ error: err.message || err });
  }
});

router.get('/', authenticate, async (req: any, res) => {
  try {
    const user = req.user;
    const role = normalizeRole(user?.role);
    const {
      category_code,
      department_id,
      status,
      fiscal_year,
    } = req.query || {};

    let query = supabase
      .from('document_uploads')
      .select('*')
      .order('created_at', { ascending: false });

    if (category_code) {
      query = query.eq('category_code', String(category_code));
    }
    if (status) {
      query = query.eq('status', String(status));
    }
    if (fiscal_year) {
      const year = Number.parseInt(String(fiscal_year), 10);
      if (Number.isInteger(year) && year > 0) {
        query = query.eq('fiscal_year', year);
      }
    }

    if (role === 'accounting' || role === 'admin' || role === 'super_admin' || role === 'vp' || role === 'president') {
      if (department_id) {
        query = query.eq('department_id', String(department_id));
      }
    } else if (role === 'supervisor') {
      if (!user?.department_id) return res.status(403).json({ error: 'Forbidden' });
      query = query.eq('department_id', String(user.department_id));
    } else {
      if (!user?.id) return res.status(403).json({ error: 'Forbidden' });
      query = query.eq('uploaded_by', String(user.id));
    }

    const { data: uploads, error } = await query;
    if (error) throw error;

    const uploadIds = (uploads || []).map((row: any) => row.id);
    if (!uploadIds.length) return res.json([]);

    const { data: attachments, error: attachmentError } = await supabase
      .from('document_upload_attachments')
      .select('*')
      .in('document_upload_id', uploadIds)
      .order('created_at', { ascending: true });
    if (attachmentError) throw attachmentError;

    const attachmentsByUploadId = new Map<string, any[]>();
    (attachments || []).forEach((entry: any) => {
      const list = attachmentsByUploadId.get(entry.document_upload_id) || [];
      list.push(entry);
      attachmentsByUploadId.set(entry.document_upload_id, list);
    });

    const budgetInfo = await loadUploadBudgetInfo(uploads || []);

    res.json(
      (uploads || []).map((row: any) => {
        const budgetKey = `${String(row.department_id)}|${String(row.fiscal_year)}|${String(row.category_code)}`;
        const budgetRow = budgetInfo.get(budgetKey);
        return {
          ...row,
          attachments: attachmentsByUploadId.get(row.id) || [],
          budget_amount: budgetRow?.budget_amount ?? null,
          current_used_amount: budgetRow?.used_amount ?? null,
          current_remaining_amount: budgetRow?.remaining_amount ?? null,
        };
      })
    );
  } catch (err: any) {
    res.status(400).json({ error: err.message || err });
  }
});

router.patch('/:id/review', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const user = req.user;
    const uploadId = String(req.params.id || '').trim();
    if (!uploadId) {
      return res.status(400).json({ error: 'Invalid upload id' });
    }

    const { status, remarks, target_department_id } = req.body || {};
    const nextStatus = String(status || '').trim();
    if (!['acknowledged', 'returned'].includes(nextStatus)) {
      return res.status(400).json({ error: 'Invalid review status' });
    }

    const normalizedRemarks = String(remarks || '').trim();
    if (nextStatus === 'returned' && !normalizedRemarks) {
      return res.status(400).json({ error: 'Remarks are required when returning an upload' });
    }

    const current = await loadUploadWithAttachments(uploadId);
    if (!current) return res.status(404).json({ error: 'Upload not found' });

    // Use target_department_id if provided (Accounting override), otherwise use upload's department_id
    const effectiveDepartmentId = target_department_id || current.department_id;

    if (nextStatus === 'acknowledged' && current.status !== 'acknowledged') {
      await adjustBudgetForDocumentUpload({ ...current, department_id: effectiveDepartmentId }, true);
      await logAuditEvent({
        user,
        actionType: 'budget_updated',
        recordType: 'document_upload',
        recordId: uploadId,
        recordLabel: `${current.category_code} ${current.category_name}`,
        oldValue: { status: current.status },
        newValue: {
          status: nextStatus,
          amount: current.amount,
          fiscal_year: current.fiscal_year,
          department_id: effectiveDepartmentId,
          category_code: current.category_code,
        },
      });
    }
    if (nextStatus === 'returned' && current.status === 'acknowledged') {
      await adjustBudgetForDocumentUpload({ ...current, department_id: effectiveDepartmentId }, false);
      await logAuditEvent({
        user,
        actionType: 'budget_updated',
        recordType: 'document_upload',
        recordId: uploadId,
        recordLabel: `${current.category_code} ${current.category_name}`,
        oldValue: { status: current.status },
        newValue: {
          status: nextStatus,
          amount: current.amount,
          fiscal_year: current.fiscal_year,
          department_id: effectiveDepartmentId,
          category_code: current.category_code,
        },
        remarks: 'Reverted budget adjustment after return',
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from('document_uploads')
      .update({
        status: nextStatus,
        accounting_remarks: normalizedRemarks || null,
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
      `Your document upload (${updated.category_code} ${updated.category_name}) was ${nextStatus}.${normalizedRemarks ? ` Remarks: ${normalizedRemarks}` : ''}`
    );
    await logAuditEvent({
      user,
      actionType: 'document_upload_reviewed',
      recordType: 'document_upload',
      recordId: uploadId,
      recordLabel: `${updated.category_code} ${updated.category_name}`,
      oldValue: { status: current.status, accounting_remarks: current.accounting_remarks || null },
      newValue: { status: nextStatus, accounting_remarks: normalizedRemarks || null },
    });

    res.json(await loadUploadWithAttachments(uploadId));
  } catch (err: any) {
    res.status(400).json({ error: err.message || err });
  }
});

export default router;
