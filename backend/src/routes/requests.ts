import express from 'express';
import { authenticate, authorize, hasFullAccountingAccess } from '../middleware/auth';
import { supabase } from '../utils/supabase';
import { sendEmail } from '../utils/email';
import {
  getAccessibleDepartmentIdsForUser,
  getLatestConfiguredFiscalYear,
  syncUserDepartmentToActiveYear
} from '../utils/fiscal';
import {
  allocationTotalsMatchRequest,
  buildDepartmentBudgetSummaryMap,
  enrichRequests,
  enrichRequestsWithMainCategory,
  fetchRequestAllocationsByRequestId,
  normalizeAllocations
} from '../utils/budget';
import { validateExpense, OFFICIAL_EXPENSE_LIST, mergeBudgetCategoriesIntoOfficialList, ExpenseItem } from '../utils/expenseValidator';
import {
  filterOfficialExpenseList,
  resolveOfficialExpenseList,
} from '../utils/expenseCategories';
import { PRESIDENT_THRESHOLD, getPresidentThreshold } from '../constants/approval';
import { AUDIT_ACTIONS, logAuditEvent, logFailedApprovalAttempt } from '../utils/auditLog';
import {
  notifyAccounting,
  notifyDepartmentSupervisor,
  notifyPresident,
  notifyUser,
  notifyVp,
  checkBudgetUtilizationWarning,
} from '../utils/workflowNotify';

const router = express.Router();

const getEmailLogoUrl = () => {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  if (base) {
    return `${base}/storage/v1/object/public/public-assets/madison88-logo.png`;
  }
  return 'https://via.placeholder.com/180x60?text=Madison88';
};

const buildRequestStatusEmail = (name: string, requestCode: string, subject: string, message: string) => {
  const greetingName = name || 'there';

  return {
    text: `Hello ${greetingName},\n\n${message}`,
    html: `
      <div style="margin:0;padding:32px 16px;background:#eef3fb;font-family:Segoe UI,Arial,sans-serif;color:#13213d;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #d9e1f1;">
          <div style="padding:32px;background:linear-gradient(135deg,#1e2b4a 0%,#2d416d 100%);text-align:center;">
            <img src="${getEmailLogoUrl()}" alt="Madison88" style="max-width:180px;height:auto;background:#f8fbff;padding:12px 18px;border-radius:18px;" />
            <h1 style="margin:24px 0 0;font-size:28px;line-height:1.2;color:#ffffff;">${subject}</h1>
          </div>
          <div style="padding:32px;">
            <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">Hello ${greetingName},</p>
            <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">${message}</p>
            <div style="margin:0 0 24px;padding:16px 18px;background:#f6f8fc;border:1px solid #d9e1f1;border-radius:16px;">
              <p style="margin:0 0 8px;font-size:14px;color:#4b5b7c;">Request Code</p>
              <p style="margin:0;font-size:18px;font-weight:600;color:#1e2b4a;">${requestCode}</p>
            </div>
          </div>
        </div>
      </div>
    `
  };
};

const toNumber = (value: unknown) => Number.parseFloat(String(value ?? 0)) || 0;
const toText = (value: unknown) => String(value ?? '').trim();

const appendRequestRelations = async (rows: any[]) => {
  if (!rows.length) return rows;

  const employeeIds = Array.from(new Set(rows.map((row) => row.employee_id).filter(Boolean)));
  const departmentIds = Array.from(new Set(rows.map((row) => row.department_id).filter(Boolean)));

  const [usersResult, departmentsResult] = await Promise.all([
    employeeIds.length
      ? supabase.from('users').select('id, name').in('id', employeeIds)
      : { data: [] as any[], error: null },
    departmentIds.length
      ? supabase.from('departments').select('id, name, fiscal_year').in('id', departmentIds)
      : { data: [] as any[], error: null }
  ]);

  if (usersResult.error) throw usersResult.error;
  if (departmentsResult.error) throw departmentsResult.error;

  const usersById = new Map((usersResult.data || []).map((user: any) => [user.id, { name: user.name }]));
  const departmentsById = new Map(
    (departmentsResult.data || []).map((department: any) => [
      department.id,
      { name: department.name, fiscal_year: department.fiscal_year }
    ])
  );

  return rows.map((row) => ({
    ...row,
    users: usersById.get(row.employee_id) || null,
    departments: departmentsById.get(row.department_id) || null
  }));
};

type AttachmentInput = {
  file_name?: string;
  file_url?: string;
  attachment_type?: string;
  attachment_scope?: string;
};

const normalizeAttachments = (attachments: AttachmentInput[] = []) =>
  attachments
    .map((attachment) => ({
      file_name: toText(attachment.file_name),
      file_url: toText(attachment.file_url),
      attachment_type: toText(attachment.attachment_type),
      attachment_scope: ['request', 'disbursement', 'liquidation'].includes(toText(attachment.attachment_scope))
        ? toText(attachment.attachment_scope)
        : 'request'
    }))
    .filter((attachment) => attachment.file_name && attachment.file_url);

const validateCategoryBudgetsForSubmission = async (
  targetDepartmentId: string,
  fiscalYear: number,
  totalAmount: number,
  categoryId?: string,
  categoryName?: string,
  items: any[] = []
) => {
  const itemCategoryTotals = new Map<string, number>();
  (items || []).forEach((item) => {
    const itemCategoryId = toText(item.category_id);
    if (!itemCategoryId) return;
    itemCategoryTotals.set(itemCategoryId, (itemCategoryTotals.get(itemCategoryId) || 0) + toNumber(item.amount));
  });

  if (itemCategoryTotals.size > 0) {
    const categoryIds = Array.from(itemCategoryTotals.keys());
    const { data: categories, error } = await supabase
      .from('budget_categories')
      .select('id, category_name, department_id, fiscal_year, remaining_amount')
      .in('id', categoryIds);

    if (error) return error.message;

    const categoriesById = new Map((categories || []).map((category: any) => [category.id, category]));
    for (const id of categoryIds) {
      const category = categoriesById.get(id);
      const requestedAmount = itemCategoryTotals.get(id) || 0;

      if (!category) {
        // If category doesn't exist, skip validation - allow request to proceed
        continue;
      }

      if (category.department_id !== targetDepartmentId || Number(category.fiscal_year) !== fiscalYear) {
        return `Category "${category.category_name || id}" does not belong to the selected department and fiscal year.`;
      }

      if (toNumber(category.remaining_amount) < requestedAmount) {
        return `Insufficient budget in category "${category.category_name}". Remaining: ${toNumber(category.remaining_amount).toFixed(2)}, Requested: ${requestedAmount.toFixed(2)}`;
      }
    }

    return null;
  }

  const normalizedCategoryId = toText(categoryId);
  const normalizedCategoryName = toText(categoryName);
  if (!normalizedCategoryId && !normalizedCategoryName) return null;

  let categoryQuery = supabase
    .from('budget_categories')
    .select('id, category_name, department_id, fiscal_year, remaining_amount')
    .eq('department_id', targetDepartmentId)
    .eq('fiscal_year', fiscalYear);

  categoryQuery = normalizedCategoryId
    ? categoryQuery.eq('id', normalizedCategoryId)
    : categoryQuery.eq('category_name', normalizedCategoryName);

  const { data: category, error } = await categoryQuery.maybeSingle();
  if (error) return error.message;
  if (!category) {
    // If category doesn't exist, skip validation - allow request to proceed
    return null;
  }

  if (toNumber(category.remaining_amount) < totalAmount) {
    return `Insufficient budget in category "${category.category_name}". Remaining: ${toNumber(category.remaining_amount).toFixed(2)}, Requested: ${totalAmount.toFixed(2)}`;
  }

  return null;
};

const appendWorkflowData = async (rows: any[]) => {
  if (!rows.length) return rows;

  const requestIds = rows.map((row) => row.id);
  const [attachmentsResult, liquidationResult] = await Promise.all([
    supabase
      .from('request_attachments')
      .select('id, request_id, liquidation_id, attachment_scope, attachment_type, file_name, file_url, mime_type, file_size_bytes, uploaded_at')
      .in('request_id', requestIds)
      .order('uploaded_at', { ascending: true }),
    supabase
      .from('request_liquidations')
      .select('id, request_id, liquidation_no, status, due_at, submitted_at, reviewed_at, actual_amount, reimbursable_amount, cash_return_amount, shortage_amount, remarks, created_at, updated_at')
      .in('request_id', requestIds)
      .order('created_at', { ascending: false })
  ]);

  if (attachmentsResult.error) throw attachmentsResult.error;
  if (liquidationResult.error) throw liquidationResult.error;

  const attachmentsByRequestId = new Map<string, any[]>();
  (attachmentsResult.data || []).forEach((attachment: any) => {
    const current = attachmentsByRequestId.get(attachment.request_id) || [];
    current.push(attachment);
    attachmentsByRequestId.set(attachment.request_id, current);
  });

  const latestLiquidationByRequestId = new Map<string, any>();
  (liquidationResult.data || []).forEach((liquidation: any) => {
    if (!latestLiquidationByRequestId.has(liquidation.request_id)) {
      latestLiquidationByRequestId.set(liquidation.request_id, liquidation);
    }
  });

  return rows.map((row) => ({
    ...row,
    attachments: attachmentsByRequestId.get(row.id) || [],
    attachment_count: (attachmentsByRequestId.get(row.id) || []).length,
    latest_liquidation: latestLiquidationByRequestId.get(row.id) || null
  }));
};

const appendWorkflowDataToRequests = async (rows: any[]) => appendWorkflowData(rows);

const insertAuditLogs = async (
  requestId: string,
  actorId: string,
  entries: Array<{
    entity_type: 'request' | 'allocation' | 'attachment' | 'liquidation' | 'release';
    action: string;
    field_name?: string;
    old_value?: string;
    new_value?: string;
    note?: string;
    metadata?: Record<string, unknown>;
  }>
) => {
  if (!entries.length) return;

  const { error } = await supabase.from('request_audit_logs').insert(
    entries.map((entry) => ({
      request_id: requestId,
      actor_id: actorId,
      entity_type: entry.entity_type,
      action: entry.action,
      field_name: entry.field_name || null,
      old_value: entry.old_value || null,
      new_value: entry.new_value || null,
      note: entry.note || null,
      metadata: entry.metadata || {}
    }))
  );

  if (error) throw error;
};

const lockBudgetCategory = async (categoryId: string) => {
  await supabase
    .from('budget_categories')
    .update({ is_locked: true, locked_at: new Date() })
    .eq('id', categoryId);
};

const lockDepartmentBudgetMatrix = async (departmentId: string, fiscalYear: number) => {
  await supabase
    .from('budget_categories')
    .update({ is_locked: true, locked_at: new Date() })
    .eq('department_id', departmentId)
    .eq('fiscal_year', fiscalYear);
};

const applyApprovedBudgetProposal = async (request: any) => {
  if (!request.category_id) return;
  const proposedAmount = toNumber(request.amount);
  const { data: category } = await supabase
    .from('budget_categories')
    .select('*')
    .eq('id', request.category_id)
    .single();

  if (!category) return;

  const previousAmount = toNumber(category.budget_amount);
  const usedAmount = toNumber(category.used_amount);
  const committedAmount = toNumber(category.committed_amount);
  const newRemaining = Math.max(0, proposedAmount - usedAmount - committedAmount);

  await supabase
    .from('budget_categories')
    .update({
      budget_amount: proposedAmount,
      remaining_amount: newRemaining,
      is_locked: true,
      locked_at: new Date(),
      updated_at: new Date()
    })
    .eq('id', request.category_id);

  await lockDepartmentBudgetMatrix(request.department_id, request.fiscal_year);

  await supabase.from('budget_revision_history').insert({
    category_id: request.category_id,
    department_id: request.department_id,
    request_id: request.id,
    previous_amount: previousAmount,
    proposed_amount: proposedAmount,
    approved_amount: proposedAmount,
    fiscal_year: request.fiscal_year,
    revision_type: request.request_type === 'budget_revision' ? 'budget_revision' : 'budget_proposal',
    approved_at: new Date(),
  });
};

const notifyPreviousActor = async (request: any, message: string) => {
  const status = request.status;
  if (isBudgetWorkflow(request.request_type)) {
    if (status === 'pending_accounting') {
      await notifyDepartmentSupervisor(request.department_id, message);
    } else if (status === 'pending_vp') {
      await notifyAccounting(message);
    } else if (status === 'pending_president') {
      await notifyVp(message);
    }
    return;
  }
  if (status === 'pending_accounting') {
    await notifyDepartmentSupervisor(request.department_id, message);
    return;
  }
  if (status === 'pending_vp') {
    await notifyAccounting(message);
    return;
  }
  if (status === 'pending_president') {
    await notifyVp(message);
    return;
  }
  await notifyEmployee(
    request.employee_id,
    request.request_code,
    'Request Update',
    message
  );
};

const resolveRejectAuditAction = (requestType?: string) => {
  if (requestType === 'budget_request' || requestType === 'budget_revision') return AUDIT_ACTIONS.BUDGET_REJECTED;
  if (requestType === 'cash_advance') return AUDIT_ACTIONS.CASH_ADVANCE_REJECTED;
  return AUDIT_ACTIONS.REIMBURSEMENT_REJECTED;
};

const resolveReturnAuditAction = (requestType?: string) => {
  if (requestType === 'budget_request' || requestType === 'budget_revision') return AUDIT_ACTIONS.BUDGET_RETURNED;
  return AUDIT_ACTIONS.BUDGET_RETURNED;
};

const isBudgetWorkflow = (requestType?: string) =>
  requestType === 'budget_request' || requestType === 'budget_revision';

const createLiquidationNumber = (requestCode: string) => `LIQ-${requestCode}-${Date.now()}`;

const releaseRequest = async (
  request: any,
  actorId: string,
  payload: {
    release_method?: string;
    release_reference_no?: string;
    release_note?: string;
    liquidation_due_at?: string;
  }
) => {
  const allocationsByRequestId = await fetchRequestAllocationsByRequestId([request.id]);
  const normalizedAllocations = normalizeAllocations(request, allocationsByRequestId.get(request.id) || []);
  if (!allocationTotalsMatchRequest(request.amount, normalizedAllocations)) {
    throw new Error('Finalize the department allocations before release. The allocated total must match the request amount.');
  }

  const { summaryByDepartmentId } = await buildDepartmentBudgetSummaryMap();
  
  // Check Petty Cash specifically if that is the method
  const releaseMethod = ['cash', 'bank_transfer', 'check', 'petty_cash', 'other'].includes(toText(payload.release_method))
    ? toText(payload.release_method)
    : 'other';

  if (releaseMethod === 'petty_cash') {
    const { data: dept, error: deptErr } = await supabase
      .from('departments')
      .select('name, petty_cash_balance')
      .eq('id', request.department_id)
      .single();
    
    if (deptErr) throw new Error('Could not verify petty cash balance.');
    if (toNumber(dept.petty_cash_balance) < toNumber(request.amount)) {
      throw new Error(`Insufficient petty cash in ${dept.name}. Balance: ${toNumber(dept.petty_cash_balance).toFixed(2)}`);
    }
  }

  const insufficientDepartment = normalizedAllocations.find((allocation) => {
    const summary = summaryByDepartmentId.get(allocation.department_id);
    return !summary || summary.projected_remaining_budget < 0;
  });

  if (insufficientDepartment) {
    const summary = summaryByDepartmentId.get(insufficientDepartment.department_id);
    throw new Error(`Insufficient projected budget for ${summary?.department_name || 'the selected department'}.`);
  }

  for (const allocation of normalizedAllocations) {
    const { data: department, error: departmentError } = await supabase
      .from('departments')
      .select('id, used_budget, petty_cash_balance')
      .eq('id', allocation.department_id)
      .single();

    if (departmentError || !department) {
      throw new Error(departmentError?.message || 'Department not found.');
    }

    const updatePayload: any = {
      used_budget: toNumber(department.used_budget) + toNumber(allocation.amount),
      updated_at: new Date()
    };

    if (releaseMethod === 'petty_cash') {
      updatePayload.petty_cash_balance = toNumber(department.petty_cash_balance) - toNumber(allocation.amount);
    }

    const { error: updateDepartmentError } = await supabase
      .from('departments')
      .update(updatePayload)
      .eq('id', allocation.department_id);

    if (updateDepartmentError) {
      throw updateDepartmentError;
    }

    // Deduct from category budgets for this allocation's department
    // For multi-item requests: fetch request_items and deduct per item's category
    const { data: requestItems } = await supabase
      .from('request_items')
      .select('category_id, amount')
      .eq('request_id', request.id);

    if (requestItems && requestItems.length > 0) {
      // Multi-item: deduct each item's category proportionally
      // If this allocation is a split, scale item amounts by (allocation.amount / request.amount)
      const scaleFactor = toNumber(request.amount) > 0 ? toNumber(allocation.amount) / toNumber(request.amount) : 1;

      for (const rItem of requestItems) {
        if (!rItem.category_id) continue;
        const itemAmountToDeduct = toNumber(rItem.amount) * scaleFactor;

        const { data: catBudget } = await supabase
          .from('budget_categories')
          .select('id, committed_amount, used_amount, budget_amount, remaining_amount')
          .eq('id', rItem.category_id)
          .eq('department_id', allocation.department_id)
          .maybeSingle();

        if (!catBudget) continue;

        const newCommitted = Math.max(0, toNumber(catBudget.committed_amount) - itemAmountToDeduct);
        const newUsed = toNumber(catBudget.used_amount) + itemAmountToDeduct;
        const newRemaining = Math.max(0, toNumber(catBudget.budget_amount) - newUsed - newCommitted);

        const { error: updateCatErr } = await supabase
          .from('budget_categories')
          .update({ used_amount: newUsed, committed_amount: newCommitted, remaining_amount: newRemaining, updated_at: new Date() })
          .eq('id', catBudget.id);

        if (updateCatErr) console.error('Failed to update category on release:', updateCatErr);
        else await checkBudgetUtilizationWarning(catBudget.id);
      }
    } else if (request.category) {
      // Single-item fallback: use request.category name
      const categoryName = String(request.category).trim();
      const { data: categoryBudget, error: fetchCategoryError } = await supabase
        .from('budget_categories')
        .select('*')
        .eq('category_name', categoryName)
        .eq('department_id', allocation.department_id)
        .eq('fiscal_year', request.fiscal_year)
        .single();

      if (!fetchCategoryError && categoryBudget) {
        const amountToDeduct = toNumber(allocation.amount);
        const newCommitted = Math.max(0, toNumber(categoryBudget.committed_amount) - amountToDeduct);
        const newUsedAmount = toNumber(categoryBudget.used_amount) + amountToDeduct;
        const newRemainingAmount = Math.max(0, toNumber(categoryBudget.budget_amount) - newUsedAmount - newCommitted);

        const { error: updateCategoryError } = await supabase
          .from('budget_categories')
          .update({ used_amount: newUsedAmount, committed_amount: newCommitted, remaining_amount: newRemainingAmount, updated_at: new Date() })
          .eq('id', categoryBudget.id);

        if (updateCategoryError) console.error('Failed to update category budget on release:', updateCategoryError);
        else await checkBudgetUtilizationWarning(categoryBudget.id);
      }
    }
  }

  const releaseReferenceNo = toText(payload.release_reference_no);
  const releaseNote = toText(payload.release_note);
  const releasedAt = new Date().toISOString();
  const liquidationDueAt = toText(payload.liquidation_due_at);

  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      status: 'released',
      disbursement_status: 'released',
      release_method: releaseMethod,
      release_reference_no: releaseReferenceNo || null,
      release_note: releaseNote || null,
      released_by: actorId,
      released_at: releasedAt,
      updated_at: new Date()
    })
    .eq('id', request.id)
    .select()
    .single();

  if (error) throw error;

  if (liquidationDueAt) {
    const { data: existingLiquidation } = await supabase
      .from('request_liquidations')
      .select('id')
      .eq('request_id', request.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingLiquidation?.id) {
      const { error: updateLiquidationError } = await supabase
        .from('request_liquidations')
        .update({
          due_at: liquidationDueAt,
          updated_at: new Date()
        })
        .eq('id', existingLiquidation.id);

      if (updateLiquidationError) throw updateLiquidationError;
    } else {
      const { error: insertLiquidationError } = await supabase.from('request_liquidations').insert({
        request_id: request.id,
        liquidation_no: createLiquidationNumber(request.request_code),
        due_at: liquidationDueAt,
        created_by: actorId,
        created_at: new Date(),
        updated_at: new Date()
      });

      if (insertLiquidationError) throw insertLiquidationError;
    }
  }

  // Create cash_advances record for cash advance type requests
  if (request.request_type === 'cash_advance') {
    const { data: existingCashAdvance } = await supabase
      .from('cash_advances')
      .select('id')
      .eq('request_id', request.id)
      .maybeSingle();

    if (!existingCashAdvance) {
      const advanceCode = `CA-${Date.now()}`;
      const { error: insertCashAdvanceError } = await supabase.from('cash_advances').insert({
        advance_code: advanceCode,
        request_id: request.id,
        employee_id: request.employee_id,
        department_id: request.department_id,
        amount_issued: toNumber(request.amount),
        balance: toNumber(request.amount),
        amount_liquidated: 0,
        status: 'outstanding',
        purpose: request.purpose || '',
        liquidation_due_at: liquidationDueAt ? new Date(liquidationDueAt) : null,
        issued_by: actorId,
        issued_at: new Date(),
        created_at: new Date(),
        updated_at: new Date()
      });

      if (insertCashAdvanceError) {
        console.error('Failed to create cash_advances record:', insertCashAdvanceError);
        // Don't throw error to allow request release to proceed
      }
    }

    // Lock the charged main category after cash advance approval
    if (request.category) {
      const { data: mainCategory } = await supabase
        .from('budget_categories')
        .select('id')
        .eq('category_name', String(request.category).trim())
        .eq('department_id', request.department_id)
        .eq('fiscal_year', request.fiscal_year)
        .is('parent_category_id', null)
        .maybeSingle();
      if (mainCategory?.id) {
        await lockBudgetCategory(mainCategory.id);
      }
    } else if (request.category_id) {
      await lockBudgetCategory(request.category_id);
    }
  }

  await supabase.from('approval_logs').insert({
    request_id: request.id,
    actor_id: actorId,
    action: 'released',
    stage: 'finance',
    note: releaseNote || `Released via ${releaseMethod}`
  });

  await supabase.from('allocation_logs').insert({
    request_id: request.id,
    actor_id: actorId,
    action: 'released',
    note: `Released via ${releaseMethod}${releaseReferenceNo ? ` (Ref ${releaseReferenceNo})` : ''}`
  });

  // Build audit log entries for all budget deductions
  const auditEntries: any[] = [
    {
      entity_type: 'request',
      action: 'status_changed',
      field_name: 'status',
      old_value: request.status,
      new_value: 'released',
      note: releaseNote || 'Released by accounting'
    },
    {
      entity_type: 'release',
      action: 'released',
      field_name: 'release_method',
      old_value: request.release_method || '',
      new_value: releaseMethod,
      note: releaseReferenceNo || undefined,
      metadata: {
        release_reference_no: releaseReferenceNo,
        liquidation_due_at: liquidationDueAt || null
      }
    }
  ];

  // Add audit logs for department budget deductions
  for (const allocation of normalizedAllocations) {
    const { data: dept } = await supabase
      .from('departments')
      .select('name')
      .eq('id', allocation.department_id)
      .single();
    
    auditEntries.push({
      entity_type: 'request',
      action: 'department_budget_deducted',
      field_name: 'used_budget',
      old_value: '',
      new_value: String(allocation.amount),
      note: `Department budget deducted for ${dept?.name || allocation.department_id}`
    });

    // Add audit log for category budget if applicable
    if (request.category) {
      const categoryName = String(request.category).trim();
      const { data: categoryBudget } = await supabase
        .from('budget_categories')
        .select('category_name, used_amount')
        .eq('category_name', categoryName)
        .eq('department_id', allocation.department_id)
        .eq('fiscal_year', request.fiscal_year)
        .single();

      if (categoryBudget) {
        auditEntries.push({
          entity_type: 'request',
          action: 'category_budget_deducted',
          field_name: 'used_amount',
          old_value: String(categoryBudget.used_amount),
          new_value: String((parseFloat(categoryBudget.used_amount?.toString() || '0') + toNumber(allocation.amount)).toFixed(2)),
          note: `Category budget deducted for ${categoryName}`
        });
      }
    }
  }

  await insertAuditLogs(request.id, actorId, auditEntries);

  return data;
};

const createInAppNotification = async (userId: string, message: string) => {
  try {
    await supabase.from('notifications').insert({
      user_id: userId,
      message: message,
      is_read: false,
      created_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error creating in-app notification:', err);
  }
};

const notifyEmployee = async (employeeId: string, requestCode: string, subject: string, message: string) => {
  try {
    // Create in-app notification
    await createInAppNotification(employeeId, message);
    
    // Send email
    const { data: employee } = await supabase.from('users').select('email, name').eq('id', employeeId).maybeSingle();
    if (employee?.email) {
      const emailContent = buildRequestStatusEmail(employee.name || 'there', requestCode, subject, message);
      // Don't await sendEmail to avoid blocking the main flow
      sendEmail(employee.email, subject, emailContent.text, emailContent.html).catch(err => {
        console.error(`Failed to send email to ${employee.email}:`, err.message);
      });
    }
  } catch (err) {
    console.error('Error in notifyEmployee:', err);
  }
};

const buildOfficialListForDepartment = async (
  departmentId: string,
  fiscalYear: number,
  baseList: ExpenseItem[] = OFFICIAL_EXPENSE_LIST
): Promise<ExpenseItem[]> => {
  const [{ data: budgetCategories, error: budgetError }, { data: deptData }] = await Promise.all([
    supabase
      .from('budget_categories')
      .select('id, category_code, category_name, parent_category_id')
      .eq('department_id', departmentId)
      .eq('fiscal_year', fiscalYear),
    supabase.from('departments').select('name').eq('id', departmentId).maybeSingle(),
  ]);

  const departmentName = deptData?.name || 'All Dept';

  if (budgetError || !budgetCategories?.length) {
    return baseList;
  }

  const allowedCategories = budgetCategories.map((bc) => bc.category_name);
  const filteredList = baseList.filter((item) => allowedCategories.includes(item.category));

  const nameById = new Map((budgetCategories || []).map((bc: any) => [bc.id, bc.category_name]));
  const enrichedCategories = (budgetCategories || []).map((bc: any) => ({
    ...bc,
    parent_category_name: bc.parent_category_id ? nameById.get(bc.parent_category_id) || null : null,
  }));

  return mergeBudgetCategoriesIntoOfficialList(filteredList, enrichedCategories, departmentName);
};

// GET /api/requests/official-list - filtered expense catalog for request forms
router.get('/official-list', authenticate, async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  const departmentId = req.user.department_id;
  const requestType = req.query.request_type as 'cash_advance' | 'reimbursement' | undefined;

  try {
    const baseList = await resolveOfficialExpenseList();
    let list = baseList;

    if (departmentId) {
      const { data: deptData } = await supabase.from('departments').select('name').eq('id', departmentId).maybeSingle();
      const departmentName = deptData?.name || '';
      list = await buildOfficialListForDepartment(departmentId, activeFiscalYear, baseList);
      list = filterOfficialExpenseList(list.length ? list : baseList, {
        requestType,
        departmentName,
        userRole: req.user.role,
      });
      return res.json(list);
    }

    list = filterOfficialExpenseList(baseList, {
      requestType,
      userRole: req.user.role,
    });
    res.json(list);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/requests - list filtered by role/dept
router.get('/', authenticate, async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  // accounting/admin/super_admin see all years by default; others scoped to active FY unless ?all_years=true
  const allYears = req.query.all_years === 'true' || ['accounting', 'admin', 'super_admin'].includes(req.user.role);
  let query = supabase.from('expense_requests').select('*');
  if (!allYears) {
    query = query.eq('fiscal_year', activeFiscalYear);
  }
  if (req.user.role === 'employee' || req.user.role === 'manager') {
    query = query.eq('employee_id', req.user.id);
  } else if (req.user.role === 'supervisor') {
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
    query = accessibleDepartmentIds.length
      ? query.in('department_id', accessibleDepartmentIds)
      : query.eq('department_id', req.user.department_id);
  }

  const { data, error } = await query.order('submitted_at', { ascending: false });
  if (error) return res.status(400).json({ error });

  try {
    const rowsWithRelations = await appendRequestRelations(data || []);
    const { summaryByDepartmentId, allocationsByRequestId } = await buildDepartmentBudgetSummaryMap();
    const enrichedRows = enrichRequests(rowsWithRelations, summaryByDepartmentId, allocationsByRequestId);
    const withMainCategory = await enrichRequestsWithMainCategory(enrichedRows);
    res.json(await appendWorkflowDataToRequests(withMainCategory));
  } catch (summaryError: any) {
    res.status(400).json({ error: summaryError?.message || summaryError });
  }
});

// GET /api/requests/my - get current user's requests (alias for employees)
router.get('/my', authenticate, async (req: any, res) => {
  const { data, error } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('employee_id', req.user.id)
    .order('submitted_at', { ascending: false });

  if (error) return res.status(400).json({ error });

  try {
    const rowsWithRelations = await appendRequestRelations(data || []);
    const { summaryByDepartmentId, allocationsByRequestId } = await buildDepartmentBudgetSummaryMap();
    const enrichedRows = enrichRequests(rowsWithRelations, summaryByDepartmentId, allocationsByRequestId);
    const withMainCategory = await enrichRequestsWithMainCategory(enrichedRows);
    res.json(await appendWorkflowDataToRequests(withMainCategory));
  } catch (summaryError: any) {
    res.status(400).json({ error: summaryError?.message || summaryError });
  }
});

// POST /api/requests - submit new (employee, supervisor, or accounting)
router.post('/', authenticate, authorize('employee', 'manager', 'supervisor', 'accounting'), async (req: any, res) => {
  const { item_name, category, category_id, amount, purpose, priority, department_id, request_type = 'reimbursement', attachments = [], metadata = {}, items = [] } = req.body;
  const userRole = req.user.role;

  // Separate budget approval from expense approval
  const isBudgetRequest = request_type === 'budget_request';
  const isBudgetRevision = request_type === 'budget_revision';
  const isBudgetFlow = isBudgetRequest || isBudgetRevision;

  if (isBudgetFlow && userRole !== 'supervisor' && userRole !== 'admin') {
    return res.status(403).json({ error: 'Only supervisors can submit budget proposals or revisions.' });
  }
  
  // Use UUID to prevent collision instead of timestamp
  const request_code = isBudgetRevision
    ? `REV-${crypto.randomUUID().split('-')[0].toUpperCase()}`
    : isBudgetRequest
      ? `BUD-${crypto.randomUUID().split('-')[0].toUpperCase()}`
      : `REQ-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  
  // Use provided department_id if user is admin/accounting, otherwise use user's own department
  const targetDepartmentId = (userRole === 'admin' || userRole === 'accounting') && department_id 
    ? department_id 
    : req.user.department_id;

  const activeDepartment = { id: targetDepartmentId, fiscal_year: activeFiscalYear };
  const normalizedAttachments = normalizeAttachments(attachments);
  
  // Budget approval workflow based on amount thresholds
  // Calculate total amount for approval routing
  const requestAmount = toNumber(amount);
  const PRESIDENT_THRESHOLD = 500; // $500 threshold for President approval

  let initialStatus;
  
  // Budget requests have a different approval workflow than expense requests
  if (isBudgetFlow) {
    // Budget approval workflow: Supervisor > Accounting > (VP or President based on amount)
    if (userRole === 'employee' || userRole === 'manager') {
      initialStatus = 'pending_supervisor';
    } else if (userRole === 'supervisor') {
      initialStatus = 'pending_accounting';
    } else if (userRole === 'accounting') {
      // Accounting routes budget proposals based on amount: $500+ goes to President, <$500 goes to VP
      initialStatus = requestAmount >= PRESIDENT_THRESHOLD ? 'pending_president' : 'pending_vp';
    } else if (userRole === 'vp') {
      initialStatus = 'pending_president';
    } else {
      initialStatus = 'pending_accounting';
    }
  } else {
    // Expense approval workflow based on amount thresholds
    if (userRole === 'employee' || userRole === 'manager') {
      initialStatus = 'pending_supervisor';
    } else if (userRole === 'supervisor') {
      const currency = metadata?.currency || 'PHP';
      const presidentThreshold = getPresidentThreshold(currency);
      initialStatus = requestAmount >= presidentThreshold ? 'pending_president' : 'pending_vp';
    } else if (userRole === 'accounting') {
      // Accounting routes based on amount: $500+ goes to President, <$500 goes to VP
      initialStatus = requestAmount >= PRESIDENT_THRESHOLD ? 'pending_president' : 'pending_vp';
    } else if (userRole === 'vp') {
      initialStatus = 'pending_president';
    } else {
      initialStatus = 'pending_accounting';
    }
  }
  
  // 1. Validate against Official Expense List (skip for liquidations and budget requests)
  if (request_type !== 'liquidation' && !isBudgetFlow) {
    const { data: deptData } = await supabase.from('departments').select('name').eq('id', targetDepartmentId).single();
    const departmentName = deptData?.name || 'Unknown';
    const baseOfficialList = await resolveOfficialExpenseList();
    const officialListForDept = targetDepartmentId
      ? await buildOfficialListForDepartment(targetDepartmentId, activeFiscalYear, baseOfficialList)
      : baseOfficialList;
    const budgetOnlyItems = officialListForDept.filter(
      (entry) => !baseOfficialList.some(
        (official) => official.code === entry.code && official.itemName === entry.itemName && official.category === entry.category
      )
    );

    const rejectValidation = (label: string, validation: ReturnType<typeof validateExpense>) => {
      if (!validation.allowed) {
        return res.status(400).json({
          error: `Invalid item "${label}": ${validation.reason}`,
          details: {
            code: validation.code,
            category: validation.category,
            required_department: validation.department,
            can_ca: validation.canCA,
            can_re: validation.canRE,
          },
        });
      }
      return null;
    };

    if (items && items.length > 0) {
      for (const item of items) {
        const validation = validateExpense(item.item_name, departmentName, request_type, budgetOnlyItems, req.user.role);
        const rejected = rejectValidation(item.item_name, validation);
        if (rejected) return rejected;

        // For subcategory requests, check main category budget (skip for reimbursements and cash advances)
        const itemEntry = budgetOnlyItems.find((e: any) => e.itemName === item.item_name);
        if (itemEntry && itemEntry.category && request_type !== 'reimbursement' && request_type !== 'cash_advance') {
          const { data: mainCategory } = await supabase
            .from('budget_categories')
            .select('*')
            .eq('category_name', itemEntry.category)
            .eq('department_id', targetDepartmentId)
            .eq('fiscal_year', activeFiscalYear)
            .single();

          if (mainCategory) {
            const mainCategoryRemaining = toNumber(mainCategory.remaining_amount);
            const itemAmount = toNumber(item.amount);
            if (itemAmount > mainCategoryRemaining) {
              return res.status(400).json({ 
                error: `Insufficient budget in main category "${itemEntry.category}". Remaining: ${mainCategoryRemaining.toFixed(2)}, Requested: ${itemAmount.toFixed(2)}` 
              });
            }
          }
        }
      }
    } else {
      const validation = validateExpense(item_name, departmentName, request_type, budgetOnlyItems, req.user.role);
      const rejected = rejectValidation(item_name, validation);
      if (rejected) return rejected;

      // For subcategory requests, check main category budget (skip for reimbursements and cash advances)
      const itemEntry = budgetOnlyItems.find((e: any) => e.itemName === item_name);
      if (itemEntry && itemEntry.category && request_type !== 'reimbursement' && request_type !== 'cash_advance') {
        const { data: mainCategory } = await supabase
          .from('budget_categories')
          .select('*')
          .eq('category_name', itemEntry.category)
          .eq('department_id', targetDepartmentId)
          .eq('fiscal_year', activeFiscalYear)
          .single();

        if (mainCategory) {
          const mainCategoryRemaining = toNumber(mainCategory.remaining_amount);
          const itemAmount = requestAmount;
          if (itemAmount > mainCategoryRemaining) {
            return res.status(400).json({ 
              error: `Insufficient budget in main category "${itemEntry.category}". Remaining: ${mainCategoryRemaining.toFixed(2)}, Requested: ${itemAmount.toFixed(2)}` 
            });
          }
        }
      }
    }
  }

  // 2. Validate both department projected remaining AND category remaining (skip for budget proposals, reimbursements and cash advances)
  const totalAmount = toNumber(amount);

  if (!isBudgetFlow && request_type !== 'reimbursement' && request_type !== 'cash_advance') {
    // Check department projected remaining
    const { data: deptSummary, error: summaryError } = await supabase
      .from('departments')
      .select('annual_budget, used_budget')
      .eq('id', targetDepartmentId)
      .single();

    if (summaryError || !deptSummary) {
      return res.status(400).json({ error: 'Department budget not found' });
    }

    const annualBudget = toNumber(deptSummary.annual_budget);
    const usedBudget = toNumber(deptSummary.used_budget);
    const projectedRemaining = annualBudget - usedBudget;

    if (projectedRemaining < totalAmount) {
      return res.status(400).json({
        error: `Insufficient department budget. Remaining: ${projectedRemaining.toFixed(2)}, Requested: ${totalAmount.toFixed(2)}`
      });
    }

    const categoryBudgetError = await validateCategoryBudgetsForSubmission(
      targetDepartmentId,
      activeFiscalYear,
      totalAmount,
      category_id,
      category,
      items
    );

    if (categoryBudgetError) {
      return res.status(400).json({ error: categoryBudgetError });
    }
  } else if (isBudgetFlow && !category_id) {
    return res.status(400).json({ error: 'Budget proposals require a main category (category_id).' });
  }

  const uniqueMainCategories = [
    ...new Set((items || []).map((item: any) => item.main_category).filter(Boolean)),
  ];
  const requestMainCategory =
    metadata.main_category
    || category
    || (uniqueMainCategories.length === 1 ? uniqueMainCategories[0] : uniqueMainCategories.join(' / ') || null);

  const { data, error } = await supabase
    .from('expense_requests')
    .insert({
      request_code: request_code,
      employee_id: req.user.id,
      department_id: activeDepartment.id,
      fiscal_year: activeDepartment.fiscal_year,
      item_name: items && items.length > 0 ? `${items.length} items: ${items.map((i: any) => i.item_name?.split('|')[0]?.trim() || i.item_name).join(', ')}` : item_name,
      category: category || (items && items.length > 0 ? items[0]?.category : null),
      category_id: category_id || null,
      amount: totalAmount,
      purpose,
      priority,
      status: initialStatus,
      submitted_at: new Date(),
      metadata: { ...metadata, items, main_category: requestMainCategory },
      request_type: request_type
    })
    .select()
    .single();
  if (error || !data) return res.status(400).json({ error: error || 'Failed to create request' });

  // Insert individual items into request_items table if multiple items provided
  if (items && items.length > 0) {
    const requestItems = items.map((item: any) => ({
      request_id: data.id,
      item_name: item.item_name,
      category_id: item.category_id || null,
      amount: toNumber(item.amount)
    }));
    
    const { error: itemsError } = await supabase.from('request_items').insert(requestItems);
    if (itemsError) {
      console.error('Failed to insert request items:', itemsError);
      return res.status(400).json({ error: 'Failed to save request items: ' + itemsError.message });
    }
    
    // Store first item's category_id on request if not already set
    if (!category_id && items[0]?.category_id) {
      await supabase.from('expense_requests').update({ category_id: items[0].category_id }).eq('id', data.id);
    }
  } else if (category_id) {
    // Single item: set category_id on request
    await supabase.from('expense_requests').update({ category_id: category_id }).eq('id', data.id);
  }

  if (normalizedAttachments.length) {
    const { error: attachmentError } = await supabase.from('request_attachments').insert(
      normalizedAttachments.map((attachment: AttachmentInput) => ({
        request_id: data.id,
        attachment_scope: attachment.attachment_scope,
        attachment_type: attachment.attachment_type || null,
        file_name: attachment.file_name,
        file_url: attachment.file_url,
        uploaded_by: req.user.id
      }))
    );

    if (attachmentError) return res.status(400).json({ error: attachmentError });
  }

  await supabase.from('approval_logs').insert({
    request_id: data.id,
    actor_id: req.user.id,
    action: 'submitted',
    stage: (userRole === 'employee' || userRole === 'manager') ? 'supervisor' : 'accounting',
    note: (userRole === 'employee' || userRole === 'manager') ? 'Request submitted' : `Request submitted by ${userRole} (routed directly to accounting)`
  });

  // Notify based on role
  if (userRole === 'employee' || userRole === 'manager') {
    // Notify supervisor
    try {
      const { data: supervisor } = await supabase
        .from('users')
        .select('email')
        .eq('department_id', req.user.department_id)
        .eq('role', 'supervisor')
        .maybeSingle();

      if (supervisor?.email) {
        sendEmail(supervisor.email, 'New Expense Request', `New request ${request_code} submitted.`).catch(err => {
          console.error('Failed to notify supervisor:', err.message);
        });
      }
    } catch (err) {
      console.error('Error finding supervisor for notification:', err);
    }
  } else {
    // Notify accounting staff
    const { data: accountingStaff } = await supabase.from('users').select('email').eq('role', 'accounting');
    if (accountingStaff) {
      for (const accountant of accountingStaff) {
        if (accountant.email) {
          sendEmail(accountant.email, 'New Direct Request', `New direct request from ${userRole} ${req.user.name || req.user.email}: ${request_code} requires accounting review.`).catch(err => {
            console.error('Failed to notify accountant:', err.message);
          });
        }
      }
    }
  }

  if (isBudgetRevision && category_id) {
    const { data: existingCategory } = await supabase
      .from('budget_categories')
      .select('budget_amount')
      .eq('id', category_id)
      .maybeSingle();
    await supabase.from('budget_revision_history').insert({
      category_id,
      department_id: activeDepartment.id,
      request_id: data.id,
      previous_amount: toNumber(existingCategory?.budget_amount),
      proposed_amount: totalAmount,
      approved_amount: null,
      fiscal_year: activeDepartment.fiscal_year,
      revision_type: 'budget_revision',
    });
  }

  const responseRows = await appendWorkflowDataToRequests([{ ...data, attachments: normalizedAttachments }]);

  const submitAuditAction = isBudgetRevision
    ? AUDIT_ACTIONS.BUDGET_REVISION_REQUESTED
    : isBudgetRequest
      ? AUDIT_ACTIONS.BUDGET_PROPOSED
      : request_type === 'cash_advance'
        ? AUDIT_ACTIONS.CASH_ADVANCE_SUBMITTED
        : AUDIT_ACTIONS.REIMBURSEMENT_SUBMITTED;

  await logAuditEvent({
    user: req.user,
    actionType: submitAuditAction,
    recordType: isBudgetFlow ? 'budget' : 'request',
    recordId: data.id,
    recordLabel: request_code,
    newValue: { amount: totalAmount, request_type, status: initialStatus },
    remarks: purpose,
  });

  if (isBudgetFlow) {
    await notifyAccounting(`Supervisor submitted budget ${isBudgetRevision ? 'revision' : 'proposal'} ${request_code} for review.`);
  } else if (request_type === 'cash_advance') {
    await notifyAccounting(`New cash advance ${request_code} submitted for review.`);
  } else {
    await notifyAccounting(`New reimbursement ${request_code} submitted for review.`);
  }

  res.json(responseRows[0]);
});

// GET /api/requests/audit-logs — legacy combined view (accounting+ only; supervisors blocked)
router.get('/audit-logs', authenticate, authorize('accounting', 'vp', 'president', 'admin', 'super_admin'), async (req: any, res) => {
  const { data: dedicatedLogs, error: dedicatedError } = await supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);

  if (!dedicatedError && dedicatedLogs?.length) {
    return res.json(
      dedicatedLogs.map((log: any) => ({
        ...log,
        log_type: 'audit',
        event_time: log.created_at,
        actor_name: log.user_name,
        actor_role: log.user_role,
        note: log.remarks,
        action: log.action_type,
      }))
    );
  }

  const [approvalLogsResult, allocationLogsResult, auditLogsResult] = await Promise.all([
    supabase.from('approval_logs').select('*').order('timestamp', { ascending: false }).limit(150),
    supabase.from('allocation_logs').select('*').order('created_at', { ascending: false }).limit(150),
    supabase.from('request_audit_logs').select('*').order('created_at', { ascending: false }).limit(150)
  ]);

  if (approvalLogsResult.error) return res.status(400).json({ error: approvalLogsResult.error });
  if (allocationLogsResult.error) return res.status(400).json({ error: allocationLogsResult.error });
  if (auditLogsResult.error) return res.status(400).json({ error: auditLogsResult.error });

  const approvalLogs = (approvalLogsResult.data || []).map((log: any) => ({
    ...log,
    log_type: 'approval',
    event_time: log.timestamp
  }));
  const allocationLogs = (allocationLogsResult.data || []).map((log: any) => ({
    ...log,
    log_type: 'allocation',
    event_time: log.created_at
  }));
  const auditLogs = (auditLogsResult.data || []).map((log: any) => ({
    ...log,
    log_type: 'audit',
    event_time: log.created_at
  }));

  const combinedLogs = [...approvalLogs, ...allocationLogs, ...auditLogs]
    .sort((left: any, right: any) => new Date(right.event_time).getTime() - new Date(left.event_time).getTime())
    .slice(0, 200);

  const actorIds = Array.from(new Set(combinedLogs.map((log: any) => log.actor_id).filter(Boolean)));
  const requestIds = Array.from(new Set(combinedLogs.map((log: any) => log.request_id).filter(Boolean)));

  const [{ data: actors }, { data: requests }] = await Promise.all([
    actorIds.length ? supabase.from('users').select('id, name, role').in('id', actorIds) : { data: [] as any[] },
    requestIds.length ? supabase.from('expense_requests').select('id, request_code, item_name, status').in('id', requestIds) : { data: [] as any[] }
  ]);

  const actorMap = new Map((actors || []).map((actor: any) => [actor.id, actor]));
  const requestMap = new Map((requests || []).map((request: any) => [request.id, request]));

  res.json(
    combinedLogs.map((log: any) => ({
      ...log,
      actor_name: actorMap.get(log.actor_id)?.name || 'System',
      actor_role: actorMap.get(log.actor_id)?.role || '',
      request_code: requestMap.get(log.request_id)?.request_code || '',
      item_name: requestMap.get(log.request_id)?.item_name || '',
      request_status: requestMap.get(log.request_id)?.status || ''
    }))
  );
});

// GET /api/requests/:id/audit-logs - Specific logs for a single request
router.get('/:id/audit-logs', authenticate, async (req: any, res) => {
  const { id } = req.params;
  
  // Verify access (same logic as GET /:id)
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('employee_id, department_id')
    .eq('id', id)
    .single();
    
  if (fetchError || !request) return res.status(404).json({ error: 'Request not found' });
  
  if (req.user.role === 'employee' && request.employee_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Fetch all types of logs
  const [approvalLogsResult, allocationLogsResult, auditLogsResult] = await Promise.all([
    supabase.from('approval_logs').select('*').eq('request_id', id).order('timestamp', { ascending: false }),
    supabase.from('allocation_logs').select('*').eq('request_id', id).order('created_at', { ascending: false }),
    supabase.from('request_audit_logs').select('*').eq('request_id', id).order('created_at', { ascending: false })
  ]);

  const approvalLogs = (approvalLogsResult.data || []).map((log: any) => ({
    ...log,
    action: log.action || 'approved',
    created_at: log.timestamp,
    log_type: 'approval'
  }));
  const allocationLogs = (allocationLogsResult.data || []).map((log: any) => ({
    ...log,
    action: log.action || 'allocated',
    created_at: log.created_at,
    log_type: 'allocation'
  }));
  const auditLogs = (auditLogsResult.data || []).map((log: any) => ({
    ...log,
    log_type: 'audit'
  }));

  const combinedLogs = [...approvalLogs, ...allocationLogs, ...auditLogs]
    .sort((left: any, right: any) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());

  const actorIds = Array.from(new Set(combinedLogs.map((log: any) => log.actor_id).filter(Boolean)));
  const { data: actors } = actorIds.length
    ? await supabase.from('users').select('id, name, role').in('id', actorIds)
    : { data: [] as any[] };
  
  const actorMap = new Map((actors || []).map((actor: any) => [actor.id, actor]));

  res.json(
    combinedLogs.map((log: any) => ({
      ...log,
      user: actorMap.get(log.actor_id) || { name: 'System', role: 'system' }
    }))
  );
});

// GET /api/requests/:id
router.get('/:id', authenticate, async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  const { data, error } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(400).json({ error });
  if ((req.user.role === 'employee' || req.user.role === 'manager') && data.employee_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (req.user.role === 'supervisor') {
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
    if (!accessibleDepartmentIds.includes(data.department_id)) return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const rowsWithRelations = await appendRequestRelations([data]);
    const { summaryByDepartmentId, allocationsByRequestId } = await buildDepartmentBudgetSummaryMap();
    const enrichedRows = enrichRequests(rowsWithRelations, summaryByDepartmentId, allocationsByRequestId);
    res.json((await appendWorkflowDataToRequests(enrichedRows))[0]);
  } catch (summaryError: any) {
    res.status(400).json({ error: summaryError?.message || summaryError });
  }
});

// PATCH /api/requests/:id/liquidation
router.patch('/:id/liquidation', authenticate, authorize('employee', 'manager', 'supervisor', 'accounting'), async (req: any, res) => {
  try {
    const { id } = req.params;
    const cashAdvanceId = req.body?.cash_advance_id;
    const amountSpent = toNumber(req.body?.amount_spent);
    const remarks = toText(req.body?.remarks);
    const attachments = req.body?.attachments || []; // Support multiple attachments

    // Validate cash advance selection
    if (!cashAdvanceId) {
      return res.status(400).json({ error: 'Cash advance selection is required for liquidation.' });
    }

    if (amountSpent <= 0) {
      return res.status(400).json({ error: 'Amount spent must be greater than zero.' });
    }

    // Get cash advance details
    const { data: cashAdvance, error: cashAdvanceError } = await supabase
      .from('cash_advances')
      .select('*')
      .eq('id', cashAdvanceId)
      .single();

    if (cashAdvanceError || !cashAdvance) {
      return res.status(400).json({ error: 'Cash advance not found.' });
    }

    // Verify user owns the cash advance or is authorized
    if (cashAdvance.employee_id !== req.user.id && req.user.role !== 'supervisor' && req.user.role !== 'accounting') {
      return res.status(403).json({ error: 'Forbidden: You do not own this cash advance.' });
    }

    // Verify cash advance is in liquidatable state
    if (cashAdvance.status === 'fully_liquidated') {
      return res.status(400).json({ error: 'This cash advance is already fully liquidated.' });
    }

    // Verify amount spent does not exceed cash advance balance
    if (amountSpent > Number(cashAdvance.balance)) {
      return res.status(400).json({ error: `Amount spent cannot exceed cash advance balance of ${cashAdvance.balance}.` });
    }

    const { data: existingLiquidation } = await supabase
      .from('request_liquidations')
      .select('*')
      .eq('request_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let result;
    if (existingLiquidation?.id) {
      result = await supabase
        .from('request_liquidations')
        .update({
          status: 'pending_liquidation_review',
          submitted_at: new Date(),
          cash_advance_id: cashAdvanceId,
          amount_spent: amountSpent,
          actual_amount: amountSpent, // Keep for backward compatibility
          reimbursable_amount: Math.max(amountSpent - Number(cashAdvance.amount_issued), 0),
          cash_return_amount: Math.max(Number(cashAdvance.amount_issued) - amountSpent, 0),
          receipt_count: attachments.length,
          remarks,
          updated_at: new Date()
        })
        .eq('id', existingLiquidation.id)
        .select()
        .single();
    } else {
      result = await supabase
        .from('request_liquidations')
        .insert({
          request_id: id,
          liquidation_no: createLiquidationNumber(cashAdvance.advance_code),
          status: 'pending_liquidation_review',
          submitted_at: new Date(),
          cash_advance_id: cashAdvanceId,
          amount_spent: amountSpent,
          actual_amount: amountSpent, // Keep for backward compatibility
          reimbursable_amount: Math.max(amountSpent - Number(cashAdvance.amount_issued), 0),
          cash_return_amount: Math.max(Number(cashAdvance.amount_issued) - amountSpent, 0),
          receipt_count: attachments.length,
          remarks,
          created_by: req.user.id,
          created_at: new Date(),
          updated_at: new Date()
        })
        .select()
        .single();
    }

    if (result.error) {
      console.error('Liquidation save error:', result.error);
      return res.status(400).json({ error: result.error.message });
    }

    // Handle multiple attachments if provided
    if (attachments.length > 0) {
      const { error: attachErr } = await supabase.from('request_attachments').insert(
        attachments.map((att: any) => ({
          request_id: id,
          liquidation_id: result.data.id,
          attachment_scope: 'liquidation',
          attachment_type: 'receipt',
          file_name: att.file_name || `liquidation-receipt-${Date.now()}.png`,
          file_url: att.file_url,
          uploaded_by: req.user.id,
          uploaded_at: new Date()
        }))
      );
      if (attachErr) console.error('Attachments save error:', attachErr);
    }

    try {
      await insertAuditLogs(id, req.user.id, [
        {
          entity_type: 'liquidation',
          action: 'submitted',
          field_name: 'status',
          old_value: existingLiquidation?.status || 'pending_submission',
          new_value: 'pending_liquidation_review',
          note: remarks || 'Liquidation submitted'
        }
      ]);
      await logAuditEvent({
        user: req.user,
        actionType: AUDIT_ACTIONS.CASH_ADVANCE_LIQUIDATED,
        recordType: 'liquidation',
        recordId: result.data.id,
        recordLabel: cashAdvance.advance_code,
        newValue: { amount_spent: amountSpent, status: 'pending_liquidation_review' },
        remarks,
      });
      await notifyAccounting(`Cash advance liquidation submitted for ${cashAdvance.advance_code} — pending review.`);
    } catch (auditErr) {
      console.error('Audit log error during liquidation:', auditErr);
    }

    return res.json(result.data);
  } catch (err: any) {
    console.error('Unexpected liquidation error:', err);
    return res.status(500).json({ error: err.message || 'An unexpected error occurred during liquidation.' });
  }
});

// PATCH /api/requests/:id/allocations
router.patch('/:id/allocations', authenticate, authorize('accounting', 'admin'), async (req: any, res) => {
  const { id } = req.params;
  const { allocations } = req.body as { allocations?: Array<{ department_id?: string; amount?: number | string }> };
  const { data: request, error: requestError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (requestError || !request) {
    return res.status(404).json({ error: requestError?.message || 'Request not found.' });
  }

  if (request.status !== 'pending_accounting') {
    return res.status(400).json({ error: 'Allocations can only be updated while waiting for accounting approval.' });
  }

  const normalizedAllocations = normalizeAllocations(request, allocations || []);
  if (!normalizedAllocations.length) {
    return res.status(400).json({ error: 'Add at least one department allocation.' });
  }

  if (!allocationTotalsMatchRequest(request.amount, normalizedAllocations)) {
    return res.status(400).json({ error: 'The total of all department allocations must exactly match the request amount.' });
  }

  // Validate category budget for all allocated departments (if category is specified)
  if (request.category) {
    const categoryName = String(request.category).trim();
    for (const allocation of normalizedAllocations) {
      const { data: categoryBudget, error: catError } = await supabase
        .from('budget_categories')
        .select('id, category_name, budget_amount, used_amount, committed_amount, remaining_amount')
        .eq('category_name', categoryName)
        .eq('department_id', allocation.department_id)
        .eq('fiscal_year', request.fiscal_year)
        .single();
      
      if (!catError && categoryBudget) {
        const remaining = toNumber(categoryBudget.remaining_amount);
        const allocationAmount = toNumber(allocation.amount);
        
        if (remaining < allocationAmount) {
          return res.status(400).json({
            error: `Insufficient budget in category "${categoryName}" for department. Available: ${remaining.toFixed(2)}, Required: ${allocationAmount.toFixed(2)}`
          });
        }
      }
      // If category doesn't exist in this department, that's ok - will deduct from department budget only
    }
  }

  const departmentIds = normalizedAllocations.map((allocation) => allocation.department_id);
  const { data: validDepartments, error: departmentError } = await supabase
    .from('departments')
    .select('id')
    .in('id', departmentIds);

  if (departmentError) return res.status(400).json({ error: departmentError });
  if ((validDepartments || []).length !== departmentIds.length) {
    return res.status(400).json({ error: 'One or more selected departments could not be found.' });
  }

  const { data: existingAllocations, error: existingAllocationsError } = await supabase
    .from('request_allocations')
    .select('id, department_id, amount, departments(name)')
    .eq('request_id', id);
  if (existingAllocationsError) return res.status(400).json({ error: existingAllocationsError });

  const { error: deleteError } = await supabase.from('request_allocations').delete().eq('request_id', id);
  if (deleteError) return res.status(400).json({ error: deleteError });

  const { data: savedAllocations, error: insertError } = await supabase
    .from('request_allocations')
    .insert(
      normalizedAllocations.map((allocation) => ({
        request_id: id,
        department_id: allocation.department_id,
        amount: allocation.amount,
        created_by: req.user.id,
        updated_at: new Date()
      }))
    )
    .select('id, request_id, department_id, amount, departments(name)');

  if (insertError) return res.status(400).json({ error: insertError });

  const oldSummary = (existingAllocations || []).map((a: any) => `${a.departments?.name || a.department_id}:${toNumber(a.amount).toFixed(2)}`).sort().join(', ') || 'none';
  const newSummary = (savedAllocations || []).map((a: any) => `${a.departments?.name || a.department_id}:${toNumber(a.amount).toFixed(2)}`).sort().join(', ');

  if (oldSummary !== newSummary) {
    await supabase.from('allocation_logs').insert({
      request_id: id,
      actor_id: req.user.id,
      action: existingAllocations?.length ? 'reallocated' : 'allocated',
      note: `Allocation updated from [${oldSummary}] to [${newSummary}]`
    });

    await insertAuditLogs(id, req.user.id, [
      {
        entity_type: 'allocation',
        action: existingAllocations?.length ? 'reallocated' : 'allocated',
        old_value: oldSummary,
        new_value: newSummary,
        note: 'Department allocation updated'
      }
    ]);
  }

  // Sync committed_amount in budget_categories for ALL allocated departments
  {
    // Build old/new dept amount maps
    const oldAmountsMap = new Map<string, number>();
    if ((existingAllocations || []).length > 0) {
      (existingAllocations || []).forEach((a: any) => oldAmountsMap.set(a.department_id, toNumber(a.amount)));
    } else {
      oldAmountsMap.set(request.department_id, toNumber(request.amount));
    }
    const newAmountsMap = new Map<string, number>();
    normalizedAllocations.forEach((a) => newAmountsMap.set(a.department_id, toNumber(a.amount)));

    const allDeptIds = new Set([...oldAmountsMap.keys(), ...newAmountsMap.keys()]);
    const requestTotal = toNumber(request.amount);

    // Fetch request_items to check if multi-item
    const { data: allocationItems } = await supabase
      .from('request_items').select('category_id, amount').eq('request_id', id);

    for (const deptId of allDeptIds) {
      const oldAmt = oldAmountsMap.get(deptId) || 0;
      const newAmt = newAmountsMap.get(deptId) || 0;
      const diff = newAmt - oldAmt;
      if (diff === 0) continue;

      if (allocationItems && allocationItems.length > 0) {
        // Multi-item: apply diff proportionally to each item's category in this dept
        for (const rItem of allocationItems) {
          if (!rItem.category_id) continue;
          const itemFraction = requestTotal > 0 ? toNumber(rItem.amount) / requestTotal : 0;
          const itemDiff = diff * itemFraction;
          if (Math.abs(itemDiff) < 0.001) continue;

          const { data: cat } = await supabase
            .from('budget_categories')
            .select('id, committed_amount, remaining_amount')
            .eq('id', rItem.category_id)
            .eq('department_id', deptId)
            .maybeSingle();
          if (!cat) continue;

          await supabase.from('budget_categories').update({
            committed_amount: Math.max(0, toNumber(cat.committed_amount) + itemDiff),
            remaining_amount: Math.max(0, toNumber(cat.remaining_amount) - itemDiff),
            updated_at: new Date()
          }).eq('id', cat.id);
        }
      } else if (request.category || request.category_id) {
        // Single-item fallback: use request.category
        const categoryName = request.category ? String(request.category).trim() : null;
        let catQuery = supabase
          .from('budget_categories')
          .select('id, committed_amount, remaining_amount')
          .eq('department_id', deptId)
          .eq('fiscal_year', request.fiscal_year);

        if (request.category_id && deptId === request.department_id) {
          catQuery = catQuery.eq('id', request.category_id);
        } else if (categoryName) {
          catQuery = catQuery.eq('category_name', categoryName);
        } else {
          continue;
        }

        const { data: cat } = await catQuery.maybeSingle();
        if (!cat) continue;

        await supabase.from('budget_categories').update({
          committed_amount: Math.max(0, toNumber(cat.committed_amount) + diff),
          remaining_amount: Math.max(0, toNumber(cat.remaining_amount) - diff),
          updated_at: new Date()
        }).eq('id', cat.id);
      }
    }
  }

  res.json(savedAllocations || []);
});

// PATCH /api/requests/:id/priority
router.patch('/:id/priority', authenticate, authorize('supervisor', 'admin'), async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  const { id } = req.params;
  const normalizedPriority = toText(req.body?.priority).toLowerCase();

  if (!['low', 'normal', 'urgent'].includes(normalizedPriority)) {
    return res.status(400).json({ error: 'Priority must be low, normal, or urgent.' });
  }

  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !request) return res.status(404).json({ error: fetchError?.message || 'Request not found.' });

  if (req.user.role === 'supervisor') {
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
    if (!accessibleDepartmentIds.includes(request.department_id)) return res.status(403).json({ error: 'Forbidden' });
  }

  if (request.status !== 'pending_supervisor') {
    return res.status(400).json({ error: 'Urgency can only be updated while waiting for supervisor approval.' });
  }

  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      priority: normalizedPriority,
      updated_at: new Date()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(400).json({ error });

  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: 'priority_updated',
      field_name: 'priority',
      old_value: toText(request.priority),
      new_value: normalizedPriority,
      note: 'Urgency updated during supervisor review'
    }
  ]);

  res.json(data);
});

// PATCH /api/requests/:id/approve - Supervisor/admin only; VP/President uses /co-approve
router.patch('/:id/approve', authenticate, authorize('supervisor', 'admin'), async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  const { id } = req.params;
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchError) return res.status(400).json({ error: fetchError });
  if (req.user.role === 'supervisor') {
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
    if (!accessibleDepartmentIds.includes(request.department_id)) return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.user.role !== 'supervisor' && req.user.role !== 'admin') {
    return res.status(400).json({ error: 'Only supervisors and admin can approve requests.' });
  }

  if (request.status !== 'pending_supervisor') {
    return res.status(400).json({ error: 'Only requests waiting for supervisor approval can be approved here' });
  }

  // Prevent self-approval
  if (request.employee_id === req.user.id) {
    return res.status(403).json({ error: 'You cannot approve your own request' });
  }

  const isBudgetFlow = request.request_type === 'budget_request' || request.request_type === 'budget_revision';
  const requestAmount = toNumber(request.amount);
  const currency = request.metadata?.currency || 'PHP';
  const presidentThreshold = getPresidentThreshold(currency);

  let nextStatus = 'pending_accounting';
  if (!isBudgetFlow) {
    nextStatus = requestAmount >= presidentThreshold ? 'pending_president' : 'pending_vp';
  }

  const { data, error } = await supabase
    .from('expense_requests')
    .update({ status: nextStatus, updated_at: new Date() })
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(400).json({ error });

  await supabase.from('approval_logs').insert({
    request_id: id,
    actor_id: req.user.id,
    action: 'approved',
    stage: 'supervisor',
    note: req.body.note || ''
  });

  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: 'status_changed',
      field_name: 'status',
      old_value: request.status,
      new_value: nextStatus,
      note: 'Supervisor approved request'
    }
  ]);

  if (!isBudgetFlow) {
    if (nextStatus === 'pending_president') {
      await notifyPresident(`Request ${request.request_code} approved by supervisor — requires President review.`);
    } else {
      await notifyVp(`Request ${request.request_code} approved by supervisor — requires VP review.`);
    }
  } else {
    await notifyAccounting(`Budget proposal ${request.request_code} approved by supervisor — pending accounting review.`);
  }

  res.json(data);
});

// POST /api/requests/:id/co-approve - VP/President dual authorization
router.post('/:id/co-approve', authenticate, authorize('vp', 'president', 'admin'), async (req: any, res) => {
  const { id } = req.params;
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();
  
  if (fetchError || !request) {
    return res.status(404).json({ error: 'Request not found' });
  }
  
  const amount = toNumber(request.amount);
  const userRole = req.user.role;
  const currency = request.metadata?.currency || 'PHP';
  const vpThreshold = getPresidentThreshold(currency);

  // VP can only co-approve up to threshold (legacy parallel path)
  if (userRole === 'vp' && amount > vpThreshold) {
    return res.status(403).json({
      error: `VP can only approve requests up to ${currency}${vpThreshold.toLocaleString()}. President approval required.`
    });
  }
  // Check if request is in pending_accounting status
  if (request.status !== 'pending_accounting') {
    return res.status(400).json({ 
      error: `Cannot co-approve request with status '${request.status}'. Only 'pending_accounting' requests can be co-approved.` 
    });
  }

  // Check if already co-approved
  if (request.co_approved_by) {
    return res.status(400).json({ error: 'Request already co-approved' });
  }
  
  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      co_approved_by: req.user.id,
      co_approved_at: new Date(),
      co_approver_role: userRole,
      updated_at: new Date()
    })
    .eq('id', id)
    .select()
    .single();
  
  if (error) return res.status(400).json({ error });
  
  // Log the co-approval
  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: 'co_approved',
      field_name: 'co_approved_by',
      old_value: '',
      new_value: req.user.id,
      note: `Co-approved by ${userRole.toUpperCase()} (${currency})`
    }
  ]);
  
  res.json(data);
});

// PATCH /api/requests/:id/approve-accounting - Accounting review (expense + budget proposals)
router.patch('/:id/approve-accounting', authenticate, authorize('accounting', 'admin'), async (req: any, res) => {
  const { id } = req.params;
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchError) return res.status(400).json({ error: fetchError });

  if (request.status !== 'pending_accounting') {
    return res.status(400).json({ error: 'Only requests waiting for accounting approval can be approved here' });
  }

  if (request.co_approved_by) {
    return res.status(400).json({ error: 'Request already cleared for fund release. Use the release action instead.' });
  }

  // Determine next status based on request type and amount
  const budgetFlow = isBudgetWorkflow(request.request_type);
  const requestAmount = toNumber(request.amount);
  const PRESIDENT_THRESHOLD = 500;
  
  const nextStatus = budgetFlow 
    ? (requestAmount >= PRESIDENT_THRESHOLD ? 'pending_president' : 'pending_vp')
    : 'pending_vp';

  const { data, error } = await supabase
    .from('expense_requests')
    .update({ status: nextStatus, updated_at: new Date() })
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(400).json({ error });

  await supabase.from('approval_logs').insert({
    request_id: id,
    actor_id: req.user.id,
    action: 'approved',
    stage: 'accounting',
    note: req.body.note || ''
  });

  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: 'status_changed',
      field_name: 'status',
      old_value: request.status,
      new_value: nextStatus,
      note: budgetFlow
        ? requestAmount >= PRESIDENT_THRESHOLD
          ? 'Accounting approved budget proposal — forwarded to President for final approval'
          : 'Accounting approved budget proposal — forwarded to VP for final approval'
        : 'Accounting approved request — forwarded to VP review'
    }
  ]);

  if (budgetFlow) {
    await logAuditEvent({
      user: req.user,
      actionType: AUDIT_ACTIONS.BUDGET_SUBMITTED,
      recordType: 'budget',
      recordId: id,
      recordLabel: request.request_code,
      oldValue: { status: request.status },
      newValue: { status: nextStatus },
      remarks: req.body.note || undefined,
    });
  }

  await notifyVp(
    budgetFlow
      ? `Budget ${request.request_type === 'budget_revision' ? 'revision' : 'proposal'} ${request.request_code} requires VP review.`
      : `Request ${request.request_code} requires VP review.`
  );

  if (!budgetFlow) {
    await notifyEmployee(
      request.employee_id,
      request.request_code,
      'Request Approved',
      `Your request ${request.request_code} has moved to VP review.`
    );
  }
  res.json(data);
});

// PATCH /api/requests/:id/approve-vp - VP viewing / approval routing
router.patch('/:id/approve-vp', authenticate, authorize('vp', 'admin'), async (req: any, res) => {
  const { id } = req.params;
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchError) return res.status(400).json({ error: fetchError });

  if (request.status !== 'pending_vp') {
    return res.status(400).json({ error: 'Only requests waiting for VP review can be approved here' });
  }

  const amount = toNumber(request.amount);
  const currency = request.metadata?.currency || 'PHP';
  const presidentThreshold = getPresidentThreshold(currency);

  if (isBudgetWorkflow(request.request_type)) {
    await logFailedApprovalAttempt(req.user, id, request.request_code, 'Budget proposals require VP Mark as Viewed action');
    return res.status(400).json({
      error: 'Budget proposals must be marked as viewed using the Mark as Viewed action before President review.',
    });
  }

  let nextStatus = 'pending_president';
  let updatePayload: Record<string, unknown> = { status: nextStatus, updated_at: new Date() };

  if (amount <= presidentThreshold) {
    nextStatus = 'pending_accounting';
    updatePayload = {
      status: nextStatus,
      co_approved_by: req.user.id,
      co_approved_at: new Date(),
      co_approver_role: 'vp',
      updated_at: new Date()
    };
  }

  const { data, error } = await supabase
    .from('expense_requests')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(400).json({ error });

  await supabase.from('approval_logs').insert({
    request_id: id,
    actor_id: req.user.id,
    action: 'approved',
    stage: 'vp',
    note: req.body.note || 'VP approved request'
  });

  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: 'status_changed',
      field_name: 'status',
      old_value: request.status,
      new_value: nextStatus,
      note: amount <= presidentThreshold
        ? 'VP approved request — returned to accounting for fund release'
        : 'VP reviewed request — forwarded to President'
    }
  ]);

  await logAuditEvent({
    user: req.user,
    actionType: request.request_type === 'cash_advance'
      ? AUDIT_ACTIONS.CASH_ADVANCE_APPROVED
      : AUDIT_ACTIONS.REIMBURSEMENT_APPROVED,
    recordType: 'request',
    recordId: id,
    recordLabel: request.request_code,
    oldValue: { status: request.status },
    newValue: { status: nextStatus },
    remarks: amount <= presidentThreshold ? 'VP final approval' : 'Forwarded to President',
  });

  const notifyMessage = amount > presidentThreshold
    ? `Your request ${request.request_code} has moved to President review.`
    : `Your request ${request.request_code} has VP approval and is awaiting fund release.`;

  if (amount > presidentThreshold) {
    await notifyPresident(`Request ${request.request_code} requires President approval (amount above threshold).`);
  } else if (request.request_type === 'cash_advance') {
    await notifyEmployee(request.employee_id, request.request_code, 'Cash Advance Approved', notifyMessage);
    await notifyDepartmentSupervisor(request.department_id, `Cash advance ${request.request_code} has been approved by VP.`);
  } else if (request.request_type === 'reimbursement') {
    await notifyEmployee(request.employee_id, request.request_code, 'Reimbursement Approved', notifyMessage);
  } else {
    await notifyEmployee(request.employee_id, request.request_code, 'Request Approved', notifyMessage);
  }
  res.json(data);
});

// PATCH /api/requests/:id/mark-viewed - VP explicit viewing for budget proposals/revisions
router.patch('/:id/mark-viewed', authenticate, authorize('vp', 'admin'), async (req: any, res) => {
  const { id } = req.params;
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchError || !request) return res.status(404).json({ error: 'Request not found' });

  if (!isBudgetWorkflow(request.request_type)) {
    await logFailedApprovalAttempt(req.user, id, request.request_code, 'Mark as Viewed only applies to budget workflows');
    return res.status(400).json({ error: 'Mark as Viewed applies only to budget proposals and revisions.' });
  }

  if (request.status !== 'pending_vp') {
    await logFailedApprovalAttempt(req.user, id, request.request_code, `Invalid status ${request.status} for mark-viewed`);
    return res.status(400).json({ error: 'Only requests waiting for VP review can be marked as viewed.' });
  }

  const { data, error } = await supabase
    .from('expense_requests')
    .update({ status: 'pending_president', updated_at: new Date() })
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(400).json({ error });

  await supabase.from('approval_logs').insert({
    request_id: id,
    actor_id: req.user.id,
    action: 'viewed',
    stage: 'vp',
    note: req.body.note || 'VP marked budget proposal as viewed',
  });

  await logAuditEvent({
    user: req.user,
    actionType: AUDIT_ACTIONS.BUDGET_SUBMITTED,
    recordType: 'budget',
    recordId: request.id,
    recordLabel: request.request_code,
    oldValue: { status: 'pending_vp' },
    newValue: { status: 'pending_president' },
    remarks: req.body.note || 'VP marked as viewed',
  });

  await notifyPresident(`Budget ${request.request_type === 'budget_revision' ? 'revision' : 'proposal'} ${request.request_code} is ready for final approval.`);
  await notifyEmployee(request.employee_id, request.request_code, 'Budget Update', `Your ${request.request_type === 'budget_revision' ? 'revision' : 'proposal'} ${request.request_code} has been reviewed by VP and sent to President.`);

  res.json(data);
});

// PATCH /api/requests/:id/approve-president - President final approval
router.patch('/:id/approve-president', authenticate, authorize('president', 'admin'), async (req: any, res) => {
  const { id } = req.params;
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchError) return res.status(400).json({ error: fetchError });

  if (request.status !== 'pending_president') {
    return res.status(400).json({ error: 'Only requests waiting for President approval can be approved here' });
  }

  const isBudgetProposalFlow = isBudgetWorkflow(request.request_type);
  const isBudgetRequestOnly = request.request_type === 'budget_request';
  const nextStatus = isBudgetProposalFlow ? 'approved' : 'pending_accounting';
  const updatePayload: Record<string, unknown> = {
    status: nextStatus,
    updated_at: new Date()
  };

  if (!isBudgetProposalFlow) {
    updatePayload.co_approved_by = req.user.id;
    updatePayload.co_approved_at = new Date();
    updatePayload.co_approver_role = 'president';
  }

  const { data, error } = await supabase
    .from('expense_requests')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(400).json({ error });

  if (isBudgetProposalFlow) {
    await applyApprovedBudgetProposal(request);
  }

  await supabase.from('approval_logs').insert({
    request_id: id,
    actor_id: req.user.id,
    action: 'approved',
    stage: 'president',
    note: req.body.note || ''
  });

  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: 'status_changed',
      field_name: 'status',
      old_value: request.status,
      new_value: nextStatus,
      note: isBudgetProposalFlow
        ? 'President approved budget — matrix locked'
        : 'President approved request — returned to accounting for fund release'
    }
  ]);

  const budgetAuditAction = request.request_type === 'budget_revision'
    ? AUDIT_ACTIONS.BUDGET_REVISED
    : AUDIT_ACTIONS.BUDGET_APPROVED;

  if (isBudgetProposalFlow) {
    await logAuditEvent({
      user: req.user,
      actionType: budgetAuditAction,
      recordType: 'budget',
      recordId: request.category_id || id,
      recordLabel: request.request_code,
      oldValue: { status: request.status },
      newValue: { status: nextStatus, amount: request.amount },
      remarks: req.body.note || undefined,
    });
    await logAuditEvent({
      user: req.user,
      actionType: AUDIT_ACTIONS.BUDGET_LOCKED,
      recordType: 'budget',
      recordId: request.department_id,
      recordLabel: request.request_code,
      newValue: { locked: true },
      remarks: 'Auto-locked after President approval',
    });
    await notifyDepartmentSupervisor(
      request.department_id,
      `Budget ${request.request_type === 'budget_revision' ? 'revision' : 'proposal'} ${request.request_code} has been approved by the President.`
    );
    await notifyAccounting(`Budget ${request.request_code} approved and matrix locked.`);
    await notifyEmployee(
      request.employee_id,
      request.request_code,
      'Budget Approved',
      `Your budget ${request.request_type === 'budget_revision' ? 'revision' : 'proposal'} ${request.request_code} has been approved.`
    );
  } else {
    await logAuditEvent({
      user: req.user,
      actionType: request.request_type === 'cash_advance'
        ? AUDIT_ACTIONS.CASH_ADVANCE_APPROVED
        : AUDIT_ACTIONS.REIMBURSEMENT_APPROVED,
      recordType: 'request',
      recordId: id,
      recordLabel: request.request_code,
      oldValue: { status: request.status },
      newValue: { status: nextStatus },
    });
    const notifyMessage = `Your request ${request.request_code} has President approval and is awaiting fund release.`;
    if (request.request_type === 'cash_advance') {
      await notifyEmployee(request.employee_id, request.request_code, 'Cash Advance Approved', notifyMessage);
      await notifyDepartmentSupervisor(request.department_id, `Cash advance ${request.request_code} approved by President.`);
    } else if (request.request_type === 'reimbursement') {
      await notifyEmployee(request.employee_id, request.request_code, 'Reimbursement Approved', notifyMessage);
    } else {
      await notifyEmployee(request.employee_id, request.request_code, 'Request Approved', notifyMessage);
    }
    await notifyAccounting(`Request ${request.request_code} approved by President — ready for fund release.`);
  }

  res.json(data);
});

// PATCH /api/requests/:id/hold - toggle on_hold status (VP/President only)
router.patch('/:id/hold', authenticate, authorize('accounting', 'vp', 'president', 'admin'), async (req: any, res) => {
  const { id } = req.params;
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();
  
  if (fetchError || !request) {
    return res.status(404).json({ error: 'Request not found' });
  }
  
  // Only allow putting on_hold if currently pending_accounting
  // or removing on_hold if currently on_hold
  const currentStatus = request.status;
  let newStatus: string;
  
  if (currentStatus === 'pending_accounting') {
    newStatus = 'on_hold';
  } else if (currentStatus === 'on_hold') {
    newStatus = 'pending_accounting';
  } else {
    return res.status(400).json({ 
      error: `Cannot change hold status when request is ${currentStatus}. Only pending_accounting or on_hold requests can be toggled.` 
    });
  }
  
  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      status: newStatus,
      updated_at: new Date(),
      on_hold_at: newStatus === 'on_hold' ? new Date() : null,
      on_hold_by: newStatus === 'on_hold' ? req.user.id : null
    })
    .eq('id', id)
    .select()
    .single();
  
  if (error) return res.status(400).json({ error });
  
  // Log the action
  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: 'status_changed',
      field_name: 'status',
      old_value: currentStatus,
      new_value: newStatus,
      note: newStatus === 'on_hold' 
        ? `Request placed on hold by ${req.user.role}`
        : `Request removed from hold by ${req.user.role}`
    }
  ]);
  
  res.json(data);
});

// PATCH /api/requests/:id/release
router.patch('/:id/release', authenticate, authorize('accounting', 'accounting_limited', 'admin'), async (req: any, res) => {
  // accounting_limited users cannot release funds
  if (!hasFullAccountingAccess(req.user.role)) {
    return res.status(403).json({ error: 'Limited accounting users cannot release funds.' });
  }

  const { id } = req.params;
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchError || !request) return res.status(400).json({ error: fetchError || 'Request not found.' });

  if (request.status === 'on_hold') {
    return res.status(400).json({ error: 'Cannot release request that is On Hold. Remove from hold first.' });
  }
  if (request.status !== 'pending_accounting') {
    return res.status(400).json({ error: 'Only requests waiting for accounting approval can be released here.' });
  }

  // All requests require VP/President co-approval before accounting can release.
  // VP handles amounts up to the threshold; President handles amounts above it.
  if (!request.co_approved_by) {
    return res.status(403).json({
      error: 'All requests require VP or President co-approval before accounting can release.'
    });
  }

  try {
    const released = await releaseRequest(request, req.user.id, req.body || {});
    await notifyEmployee(request.employee_id, request.request_code, 'Request Released', `Your request ${request.request_code} has been released.`);
    res.json(released);
  } catch (releaseError: any) {
    res.status(400).json({ error: releaseError?.message || releaseError });
  }
});

// PATCH /api/requests/:id/return
router.patch('/:id/return', authenticate, authorize('supervisor', 'accounting', 'vp', 'president', 'admin'), async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  const { id } = req.params;
  const reason = toText(req.body?.reason);
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !request) return res.status(400).json({ error: fetchError || 'Request not found.' });
  if (req.user.role === 'supervisor') {
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
    if (!accessibleDepartmentIds.includes(request.department_id)) return res.status(403).json({ error: 'Forbidden' });
  }
  if (!['pending_supervisor', 'pending_accounting', 'pending_vp', 'pending_president'].includes(request.status)) {
    return res.status(400).json({ error: 'Only pending requests can be returned for revision.' });
  }
  if (!reason) {
    return res.status(400).json({ error: 'A return reason is required.' });
  }

  const stage = ['vp', 'president'].includes(req.user.role)
    ? req.user.role
    : req.user.role === 'supervisor'
      ? 'supervisor'
      : 'accounting';
  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      status: 'returned_for_revision',
      returned_by: req.user.id,
      returned_at: new Date(),
      return_reason: reason,
      updated_at: new Date()
    })
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(400).json({ error });

  await supabase.from('approval_logs').insert({
    request_id: id,
    actor_id: req.user.id,
    action: 'returned',
    stage,
    note: reason
  });

  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: 'returned_for_revision',
      field_name: 'status',
      old_value: request.status,
      new_value: 'returned_for_revision',
      note: reason
    }
  ]);

  await logAuditEvent({
    user: req.user,
    actionType: resolveReturnAuditAction(request.request_type),
    recordType: isBudgetWorkflow(request.request_type) ? 'budget' : 'request',
    recordId: id,
    recordLabel: request.request_code,
    oldValue: { status: request.status },
    newValue: { status: 'returned_for_revision' },
    remarks: reason,
  });

  await notifyPreviousActor(
    request,
    `Request ${request.request_code} was returned for revision: ${reason}`
  );

  // Reverse committed_amount for ALL items' categories on return_for_revision
  const { data: returnItemsForRollback } = await supabase
    .from('request_items').select('category_id, amount').eq('request_id', id);

  if (returnItemsForRollback && returnItemsForRollback.length > 0) {
    for (const rItem of returnItemsForRollback) {
      if (!rItem.category_id) continue;
      const { data: catBudget } = await supabase.from('budget_categories').select('committed_amount, remaining_amount').eq('id', rItem.category_id).single();
      if (catBudget) {
        await supabase.from('budget_categories').update({
          committed_amount: Math.max(0, toNumber(catBudget.committed_amount) - toNumber(rItem.amount)),
          remaining_amount: toNumber(catBudget.remaining_amount) + toNumber(rItem.amount),
          updated_at: new Date()
        }).eq('id', rItem.category_id);
      }
    }
  } else if (request.category_id || request.category) {
    const effectiveCategoryId = request.category_id || (await supabase.from('budget_categories').select('id').eq('category_name', String(request.category).trim()).eq('department_id', request.department_id).eq('fiscal_year', request.fiscal_year).maybeSingle()).data?.id;
    if (effectiveCategoryId) {
      const { data: categoryBudget } = await supabase.from('budget_categories').select('committed_amount, remaining_amount').eq('id', effectiveCategoryId).single();
      if (categoryBudget) {
        const requestAmount = toNumber(request.amount);
        await supabase.from('budget_categories').update({
          committed_amount: Math.max(0, toNumber(categoryBudget.committed_amount) - requestAmount),
          remaining_amount: toNumber(categoryBudget.remaining_amount) + requestAmount,
          updated_at: new Date()
        }).eq('id', effectiveCategoryId);
      }
    }
  }

  res.json(data);
});

// PATCH /api/requests/:id/resubmit
router.patch('/:id/resubmit', authenticate, authorize('employee', 'manager', 'supervisor', 'accounting'), async (req: any, res) => {
  const { id } = req.params;
  const { 
    item_name, 
    amount, 
    category, 
    priority, 
    purpose, 
    attachments = [] 
  } = req.body || {};

  const normalizedItemName = toText(item_name);
  const normalizedAmount = toNumber(amount);
  const normalizedCategory = toText(category);
  const normalizedPriority = toText(priority).toLowerCase() || 'normal';
  const normalizedPurpose = toText(purpose);
  const normalizedAttachments = normalizeAttachments(attachments);

  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !request) return res.status(400).json({ error: fetchError || 'Request not found.' });
  // Only employee/manager must own the request; supervisor/accounting can resubmit for any employee
  const isTrustedResubmitter = req.user.role === 'supervisor' || req.user.role === 'accounting';
  if (!isTrustedResubmitter && request.employee_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (request.status !== 'returned_for_revision') {
    return res.status(400).json({ error: 'Only returned requests can be resubmitted.' });
  }

  const newAmount = normalizedAmount || request.amount;
  
  // Validate budget before resubmit (skip for reimbursement and cash_advance)
  const targetDeptId = req.body?.department_id || request.department_id;
  const requestType = request.request_type || 'reimbursement';
  const shouldBypassBudget = requestType === 'reimbursement' || requestType === 'cash_advance';

  if (targetDeptId && !shouldBypassBudget) {
    const { data: deptSummary, error: summaryError } = await supabase
      .from('departments')
      .select('annual_budget, used_budget')
      .eq('id', targetDeptId)
      .single();
    
    if (!summaryError && deptSummary) {
      const annualBudget = toNumber(deptSummary.annual_budget);
      const usedBudget = toNumber(deptSummary.used_budget);
      const projectedRemaining = annualBudget - usedBudget;

      if (projectedRemaining < newAmount) {
        return res.status(400).json({ 
          error: `Insufficient budget. Annual Budget: ${annualBudget.toFixed(2)}, Remaining: ${projectedRemaining.toFixed(2)}, Requested: ${newAmount.toFixed(2)}` 
        });
      }
    }
  }

  // Supervisor/accounting submitters bypass supervisor stage on resubmit
  const resubmitStatus = (req.user.role === 'supervisor' || req.user.role === 'accounting') ? 'pending_accounting' : 'pending_supervisor';

  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      status: resubmitStatus,
      item_name: normalizedItemName || request.item_name,
      department_id: req.body?.department_id || request.department_id,
      amount: newAmount,
      category: normalizedCategory || request.category,
      priority: normalizedPriority || request.priority,
      purpose: normalizedPurpose || request.purpose,
      submitted_at: new Date(),
      returned_by: null,
      returned_at: null,
      return_reason: null,
      revision_count: Number(request.revision_count || 0) + 1,
      updated_at: new Date()
    })
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(400).json({ error });

  // Update allocation if amount or department changes (assuming single item requests for now)
  // For simplicity, we update the primary allocation to match the new request amount
  const allocationAmount = normalizedAmount !== undefined && normalizedAmount !== null ? normalizedAmount : request.amount;
  await supabase
    .from('request_allocations')
    .update({ 
      amount: allocationAmount,
      updated_at: new Date() 
    })
    .eq('request_id', id)
    .eq('department_id', request.department_id);

  if (normalizedAttachments.length) {
    const { error: attachmentError } = await supabase.from('request_attachments').insert(
      normalizedAttachments.map((attachment) => ({
        request_id: id,
        attachment_scope: attachment.attachment_scope,
        attachment_type: attachment.attachment_type || null,
        file_name: attachment.file_name,
        file_url: attachment.file_url,
        uploaded_by: req.user.id
      }))
    );
    if (attachmentError) return res.status(400).json({ error: attachmentError });
  }

  await supabase.from('approval_logs').insert({
    request_id: id,
    actor_id: req.user.id,
    action: 'submitted',
    stage: resubmitStatus === 'pending_accounting' ? 'accounting' : 'supervisor',
    note: 'Request resubmitted after revision'
  });

  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: 'resubmitted',
      field_name: 'status',
      old_value: request.status,
      new_value: resubmitStatus,
      note: 'Request resubmitted after revision'
    },
    ...normalizedAttachments.map((attachment) => ({
      entity_type: 'attachment' as const,
      action: 'attached',
      field_name: attachment.attachment_type || 'supporting_document',
      new_value: attachment.file_name,
      note: attachment.file_url
    }))
  ]);

  // Re-commit budget categories on resubmit (per item if multi-item, else single category)
  const { data: resubmitItems } = await supabase
    .from('request_items').select('category_id, amount').eq('request_id', id);

  if (resubmitItems && resubmitItems.length > 0) {
    // Multi-item: re-commit each item's category
    // If amount changed, scale proportionally
    const originalAmount = toNumber(request.amount);
    const scaleFactor = originalAmount > 0 && toNumber(newAmount) !== originalAmount ? toNumber(newAmount) / originalAmount : 1;
    for (const rItem of resubmitItems) {
      if (!rItem.category_id) continue;
      const { data: catBudget } = await supabase.from('budget_categories').select('committed_amount, remaining_amount').eq('id', rItem.category_id).single();
      if (catBudget) {
        const itemAmt = toNumber(rItem.amount) * scaleFactor;
        await supabase.from('budget_categories').update({
          committed_amount: toNumber(catBudget.committed_amount) + itemAmt,
          remaining_amount: Math.max(0, toNumber(catBudget.remaining_amount) - itemAmt),
          updated_at: new Date()
        }).eq('id', rItem.category_id);
      }
    }
  } else {
    // Single-item fallback
    const effectiveCategoryName = normalizedCategory || request.category;
    const effectiveCategoryId = (await supabase.from('budget_categories').select('id').eq('category_name', String(effectiveCategoryName).trim()).eq('department_id', request.department_id).eq('fiscal_year', request.fiscal_year).maybeSingle()).data?.id;
    if (effectiveCategoryId) {
      const { data: categoryBudget } = await supabase.from('budget_categories').select('committed_amount, remaining_amount').eq('id', effectiveCategoryId).single();
      if (categoryBudget) {
        const resubmitAmount = toNumber(newAmount);
        await supabase.from('budget_categories').update({
          committed_amount: toNumber(categoryBudget.committed_amount) + resubmitAmount,
          remaining_amount: Math.max(0, toNumber(categoryBudget.remaining_amount) - resubmitAmount),
          updated_at: new Date()
        }).eq('id', effectiveCategoryId);
        await supabase.from('expense_requests').update({ category_id: effectiveCategoryId }).eq('id', id);
      }
    }
  }

  res.json((await appendWorkflowDataToRequests([data]))[0]);
});

// PATCH /api/requests/:id/reject
router.patch('/:id/reject', authenticate, authorize('supervisor', 'accounting', 'vp', 'president', 'admin'), async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  const { id } = req.params;
  const reason = toText(req.body?.reason);
  const { data: request, error: fetchRejectError } = await supabase.from('expense_requests').select('*').eq('id', id).single();
  if (fetchRejectError || !request) return res.status(404).json({ error: 'Request not found.' });
  if (req.user.role === 'supervisor') {
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
    if (!accessibleDepartmentIds.includes(request.department_id)) return res.status(403).json({ error: 'Forbidden' });
  }
  const stage = ['vp', 'president'].includes(req.user.role)
    ? req.user.role
    : req.user.role === 'supervisor'
      ? 'supervisor'
      : 'accounting';
  const requestType = request.request_type || request.metadata?.request_type || 'request';
  const typeLabel = requestType.replace(/_/g, ' ').toUpperCase();

  const { data, error } = await supabase
    .from('expense_requests')
    .update({ 
      status: 'rejected', 
      rejection_reason: reason, 
      rejection_stage: stage, 
      archived: true, 
      updated_at: new Date() 
    })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(400).json({ error });

  await supabase.from('approval_logs').insert({
    request_id: id,
    actor_id: req.user.id,
    action: 'rejected',
    stage,
    note: `[${typeLabel}] ${reason}`
  });

  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: 'rejected',
      field_name: 'status',
      old_value: request.status,
      new_value: 'rejected',
      note: `[${typeLabel}] ${reason}`
    },
    {
      entity_type: 'request',
      action: 'archived',
      field_name: 'archived',
      old_value: request.archived ? 'true' : 'false',
      new_value: 'true',
      note: 'Automatically archived after rejection'
    }
  ]);

  await logAuditEvent({
    user: req.user,
    actionType: resolveRejectAuditAction(request.request_type),
    recordType: isBudgetWorkflow(request.request_type) ? 'budget' : 'request',
    recordId: id,
    recordLabel: request.request_code,
    oldValue: { status: request.status },
    newValue: { status: 'rejected' },
    remarks: reason,
  });

  await notifyPreviousActor(
    request,
    `Request ${request.request_code} has been rejected: ${reason}`
  );

  // Reverse committed_amount for ALL items' categories on rejection
  const { data: requestItemsForRollback } = await supabase
    .from('request_items')
    .select('category_id, amount')
    .eq('request_id', id);

  if (requestItemsForRollback && requestItemsForRollback.length > 0) {
    // Multi-item: reverse each item's category committed_amount
    for (const rItem of requestItemsForRollback) {
      if (!rItem.category_id) continue;
      const { data: catBudget } = await supabase.from('budget_categories').select('committed_amount, remaining_amount').eq('id', rItem.category_id).single();
      if (catBudget) {
        const itemAmt = toNumber(rItem.amount);
        await supabase.from('budget_categories').update({
          committed_amount: Math.max(0, toNumber(catBudget.committed_amount) - itemAmt),
          remaining_amount: toNumber(catBudget.remaining_amount) + itemAmt,
          updated_at: new Date()
        }).eq('id', rItem.category_id);
      }
    }
  } else if (request.category_id || request.category) {
    // Single-item fallback
    const effectiveCategoryId = request.category_id || (await supabase.from('budget_categories').select('id').eq('category_name', String(request.category).trim()).eq('department_id', request.department_id).eq('fiscal_year', request.fiscal_year).maybeSingle()).data?.id;
    if (effectiveCategoryId) {
      const { data: categoryBudget } = await supabase.from('budget_categories').select('committed_amount, remaining_amount').eq('id', effectiveCategoryId).single();
      if (categoryBudget) {
        const requestAmount = toNumber(request.amount);
        await supabase.from('budget_categories').update({
          committed_amount: Math.max(0, toNumber(categoryBudget.committed_amount) - requestAmount),
          remaining_amount: toNumber(categoryBudget.remaining_amount) + requestAmount,
          updated_at: new Date()
        }).eq('id', effectiveCategoryId);
      }
    }
  }
  res.json(data);
});


// PATCH /api/requests/:id/liquidation/review
router.patch('/:id/liquidation/review', authenticate, authorize('accounting', 'admin'), async (req: any, res) => {
  const { id } = req.params;
  const status = toText(req.body?.status);
  const remarks = toText(req.body?.remarks);
  if (!['verified', 'returned'].includes(status)) {
    return res.status(400).json({ error: 'Liquidation review status must be verified or returned.' });
  }

  const { data: liquidation, error: liquidationError } = await supabase
    .from('request_liquidations')
    .select('*')
    .eq('request_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (liquidationError || !liquidation) return res.status(400).json({ error: liquidationError || 'Liquidation not found.' });

  const cashReturn = toNumber(liquidation.cash_return_amount);
  const reimbursable = toNumber(liquidation.reimbursable_amount);
  const finalStatus = status === 'verified' ? 'liquidated' : 'returned';

  const { data, error } = await supabase
    .from('request_liquidations')
    .update({
      status: finalStatus,
      reviewed_at: new Date(),
      reviewed_by: req.user.id,
      remarks: remarks || liquidation.remarks,
      updated_at: new Date()
    })
    .eq('id', liquidation.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error });

  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'liquidation',
      action: status === 'verified' ? 'verified' : 'returned',
      field_name: 'status',
      old_value: liquidation.status,
      new_value: finalStatus,
      note: remarks || undefined
    }
  ]);

  const { data: parentRequest } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (status === 'verified') {
    await logAuditEvent({
      user: req.user,
      actionType: AUDIT_ACTIONS.CASH_ADVANCE_LIQUIDATED,
      recordType: 'liquidation',
      recordId: liquidation.id,
      recordLabel: parentRequest?.request_code || id,
      oldValue: { status: liquidation.status, cash_return: cashReturn, reimbursable },
      newValue: { status: finalStatus },
      remarks: remarks || (cashReturn > 0 ? `Refund due: ₱${cashReturn.toFixed(2)}` : reimbursable > 0 ? `Excess reimbursement: ₱${reimbursable.toFixed(2)}` : 'Liquidation verified'),
    });

    if (reimbursable > 0 && parentRequest) {
      const reCode = `RE-LIQ-${Date.now()}`;
      await supabase.from('expense_requests').insert({
        request_code: reCode,
        employee_id: parentRequest.employee_id,
        department_id: parentRequest.department_id,
        fiscal_year: parentRequest.fiscal_year,
        item_name: `Liquidation excess — ${parentRequest.request_code}`,
        category: parentRequest.category,
        category_id: parentRequest.category_id,
        amount: reimbursable,
        purpose: `Auto-filed reimbursement for liquidation excess on ${parentRequest.request_code}`,
        priority: 'normal',
        status: 'pending_supervisor',
        submitted_at: new Date(),
        request_type: 'reimbursement',
        metadata: { source: 'liquidation_excess', parent_request_id: id, liquidation_id: liquidation.id },
      });
      await notifyEmployee(
        parentRequest.employee_id,
        reCode,
        'Reimbursement Auto-Filed',
        `Excess spending on ${parentRequest.request_code} generated reimbursement ${reCode} for ₱${reimbursable.toFixed(2)}.`
      );
    }

    if (cashReturn > 0 && parentRequest) {
      await notifyEmployee(
        parentRequest.employee_id,
        parentRequest.request_code,
        'Liquidation Refund',
        `Liquidation verified. Refund of ₱${cashReturn.toFixed(2)} will be processed for ${parentRequest.request_code}.`
      );
    }
  }

  // Also update the related cash_advances record if it exists
  const { data: cashAdvance } = await supabase
    .from('cash_advances')
    .select('id')
    .eq('request_id', id)
    .maybeSingle();

  if (cashAdvance) {
    let newCAStatus: string;
    if (status === 'verified') {
      // Determine partial vs full liquidation based on remaining balance
      const { data: caRecord } = await supabase
        .from('cash_advances')
        .select('balance')
        .eq('id', cashAdvance.id)
        .single();
      newCAStatus = (caRecord && toNumber(caRecord.balance) <= 0) ? 'fully_liquidated' : 'partially_liquidated';
    } else {
      newCAStatus = 'outstanding';
    }
    await supabase
      .from('cash_advances')
      .update({ 
        status: newCAStatus,
        updated_at: new Date()
      })
      .eq('id', cashAdvance.id);
  }

  res.json(data);
});

// GET /api/requests/:id/timeline
router.get('/:id/timeline', authenticate, async (req: any, res) => {
  const [approvalLogsResult, allocationLogsResult, auditLogsResult, departmentsResult] = await Promise.all([
    supabase.from('approval_logs').select('*').eq('request_id', req.params.id),
    supabase.from('allocation_logs').select('*').eq('request_id', req.params.id),
    supabase.from('request_audit_logs').select('*').eq('request_id', req.params.id),
    supabase.from('departments').select('id, name')
  ]);

  if (approvalLogsResult.error) return res.status(400).json({ error: approvalLogsResult.error });
  if (allocationLogsResult.error) return res.status(400).json({ error: allocationLogsResult.error });
  if (auditLogsResult.error) return res.status(400).json({ error: auditLogsResult.error });

  const departmentMap = new Map((departmentsResult.data || []).map((d: any) => [String(d.id).toLowerCase(), d.name]));
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

    const resolveNames = (text: any) => {
      if (!text) return text;
      const stringText = String(text);
      return stringText.replace(uuidRegex, (match) => departmentMap.get(match.toLowerCase()) || match);
    };

  const approvalLogs = (approvalLogsResult.data || []).map((log: any) => ({
    ...log,
    note: resolveNames(log.note),
    event_time: log.timestamp,
    approval_side: log.stage === 'supervisor' ? 'supervisor' : ['accounting', 'finance'].includes(log.stage) ? 'accounting' : 'general'
  }));
  const allocationLogs = (allocationLogsResult.data || []).map((log: any) => ({
    ...log,
    note: resolveNames(log.note),
    stage: 'allocation',
    event_time: log.created_at,
    approval_side: 'accounting'
  }));
  const auditLogs = (auditLogsResult.data || []).map((log: any) => ({
    ...log,
    note: resolveNames(log.note),
    old_value: resolveNames(log.old_value),
    new_value: resolveNames(log.new_value),
    stage: log.entity_type,
    event_time: log.created_at,
    approval_side: log.entity_type === 'request' ? 'general' : log.entity_type === 'liquidation' ? 'accounting' : 'general'
  }));

  const combinedLogs = [...approvalLogs, ...allocationLogs, ...auditLogs].sort(
    (left: any, right: any) => new Date(left.event_time).getTime() - new Date(right.event_time).getTime()
  );

  const actorIds = Array.from(new Set(combinedLogs.map((log: any) => log.actor_id).filter(Boolean)));
  const { data: actors } = actorIds.length
    ? await supabase.from('users').select('id, name, role').in('id', actorIds)
    : { data: [] as any[] };
  const actorMap = new Map((actors || []).map((actor: any) => [actor.id, actor]));

  res.json(
    combinedLogs.map((log: any) => ({
      ...log,
      timestamp: log.event_time,
      actor_name: actorMap.get(log.actor_id)?.name || 'System',
      actor_role: actorMap.get(log.actor_id)?.role || ''
    }))
  );
});

// PATCH /api/requests/:id/archive
router.patch('/:id/archive', authenticate, authorize('supervisor', 'accounting', 'admin'), async (req: any, res) => {
  const { id } = req.params;
  const { archived } = req.body;

  if (typeof archived !== 'boolean') {
    return res.status(400).json({ error: 'Archived must be a boolean value.' });
  }

  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError) return res.status(400).json({ error: fetchError });
  if (!request) return res.status(404).json({ error: 'Request not found.' });

  if (req.user.role === 'supervisor') {
    const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
    if (!accessibleDepartmentIds.includes(request.department_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  // Allow archiving released or rejected requests
  if (!['released', 'rejected'].includes(request.status)) {
    return res.status(400).json({ error: 'Only released or rejected requests can be archived.' });
  }

  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      archived,
      updated_at: new Date()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(400).json({ error });

  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: archived ? 'archived' : 'unarchived',
      field_name: 'archived',
      old_value: request.archived ? 'true' : 'false',
      new_value: archived ? 'true' : 'false',
      note: `Request ${archived ? 'archived' : 'unarchived'} by ${req.user.role}`
    }
  ]);

  res.json(data);
});

// PATCH /api/requests/:id/reconcile - mark request as reconciled
router.patch('/:id/reconcile', authenticate, authorize('accounting', 'admin'), async (req: any, res) => {
  const { id } = req.params;
  const { reconciled, discrepancy_note } = req.body;
  
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();
  
  if (fetchError || !request) {
    return res.status(404).json({ error: 'Request not found' });
  }
  
  if (request.status !== 'released') {
    return res.status(400).json({ error: 'Only released requests can be reconciled' });
  }
  
  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      reconciled: Boolean(reconciled),
      discrepancy_note: discrepancy_note || null,
      reconciled_at: reconciled ? new Date() : null,
      reconciled_by: reconciled ? req.user.id : null,
      updated_at: new Date()
    })
    .eq('id', id)
    .select()
    .single();
  
  if (error) return res.status(400).json({ error });
  
  // Log the reconciliation action
  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: reconciled ? 'reconciled' : 'unreconciled',
      field_name: 'reconciled',
      old_value: String(!reconciled),
      new_value: String(Boolean(reconciled)),
      note: reconciled
        ? `Request marked as reconciled${discrepancy_note ? ` with note: ${discrepancy_note}` : ''}`
        : 'Reconciliation removed'
    }
  ]);
  
  res.json(data);
});

// POST /api/requests/bulk-approve-accounting - Bulk approve budget proposals per department
router.post('/bulk-approve-accounting', authenticate, authorize('accounting', 'admin'), async (req: any, res) => {
  const { department_id, note } = req.body;

  if (!department_id) {
    return res.status(400).json({ error: 'Department ID is required' });
  }

  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);

  // Fetch all pending_accounting budget proposals for the department
  const { data: requests, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('department_id', department_id)
    .eq('status', 'pending_accounting')
    .in('request_type', ['budget_request', 'budget_revision'])
    .eq('fiscal_year', activeFiscalYear);

  if (fetchError) return res.status(400).json({ error: fetchError });
  if (!requests || requests.length === 0) {
    return res.status(404).json({ error: 'No pending budget proposals found for this department' });
  }

  const PRESIDENT_THRESHOLD = 500;
  const approvedRequests = [];
  const failedRequests = [];

  for (const request of requests) {
    try {
      const requestAmount = toNumber(request.amount);
      const nextStatus = requestAmount >= PRESIDENT_THRESHOLD ? 'pending_president' : 'pending_vp';

      const { data: updatedRequest, error: updateError } = await supabase
        .from('expense_requests')
        .update({ status: nextStatus, updated_at: new Date() })
        .eq('id', request.id)
        .select()
        .single();

      if (updateError) {
        failedRequests.push({ request_code: request.request_code, error: updateError.message });
        continue;
      }

      await supabase.from('approval_logs').insert({
        request_id: request.id,
        actor_id: req.user.id,
        action: 'approved',
        stage: 'accounting',
        note: note || 'Bulk approved by accounting'
      });

      await insertAuditLogs(request.id, req.user.id, [
        {
          entity_type: 'request',
          action: 'status_changed',
          field_name: 'status',
          old_value: request.status,
          new_value: nextStatus,
          note: `Accounting bulk approved budget proposal — forwarded to ${nextStatus === 'pending_president' ? 'President' : 'VP'} for final approval`
        }
      ]);

      await logAuditEvent({
        user: req.user,
        actionType: AUDIT_ACTIONS.BUDGET_SUBMITTED,
        recordType: 'budget',
        recordId: request.id,
        recordLabel: request.request_code,
        oldValue: { status: request.status },
        newValue: { status: nextStatus },
        remarks: note || 'Bulk approved by accounting',
      });

      if (nextStatus === 'pending_president') {
        await notifyPresident(`Budget ${request.request_type === 'budget_revision' ? 'revision' : 'proposal'} ${request.request_code} requires President review.`);
      } else {
        await notifyVp(`Budget ${request.request_type === 'budget_revision' ? 'revision' : 'proposal'} ${request.request_code} requires VP review.`);
      }

      approvedRequests.push(updatedRequest);
    } catch (error: any) {
      failedRequests.push({ request_code: request.request_code, error: error.message });
    }
  }

  res.json({
    message: `Bulk approved ${approvedRequests.length} budget proposals`,
    approved: approvedRequests.length,
    failed: failedRequests.length,
    failed_requests: failedRequests
  });
});

export default router;
