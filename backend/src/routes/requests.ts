import express from 'express';
import { authenticate, authorize, hasFullAccountingAccess } from '../middleware/auth';
import { supabase } from '../utils/supabase';
import { sendEmail } from '../utils/email';
import {
  getAccessibleDepartmentIdsForUser,
  getLatestConfiguredFiscalYear,
  syncUserDepartmentToActiveYear
} from '../utils/fiscal';
import { migrateRequestItemsToSubCategories } from '../utils/migrateToSubCategories';
import {
  allocationTotalsMatchRequest,
  buildDepartmentBudgetSummaryMap,
  enrichRequests,
  enrichRequestsWithMainCategory,
  fetchRequestAllocationsByRequestId,
  normalizeAllocations
} from '../utils/budget';
import { validateExpense, OFFICIAL_EXPENSE_LIST, mergeBudgetCategoriesIntoOfficialList, ExpenseItem } from '../utils/expenseValidator';
import { updateM88ManilaCostCenterBudget } from '../utils/generalBudget';
import {
  filterOfficialExpenseList,
  resolveOfficialExpenseList,
  departmentMatchesExpenseItem,
} from '../utils/expenseCategories';
import { PRESIDENT_THRESHOLD, getPresidentThreshold, BUDGET_PRESIDENT_THRESHOLD } from '../constants/approval';
import { AUDIT_ACTIONS, logAuditEvent, logFailedApprovalAttempt } from '../utils/auditLog';
import {
  notifyAccounting,
  notifyDepartmentSupervisor,
  notifyPresident,
  notifyUser,
  notifyVp,
  checkBudgetUtilizationWarning,
} from '../utils/workflowNotify';
import { invalidateCache } from '../middleware/cache';
import { generateRequestCode } from '../utils/sequentialCodeGenerator';
import { findOrCreateM88ManilaCostCenter, isGeneralCategory, convertToPhp } from '../utils/generalBudget';

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

const toCents = (value: unknown) => Math.round((Number.parseFloat(String(value ?? 0)) || 0) * 100);
const fromCents = (cents: number) => cents / 100;
const toNumber = (value: unknown) => fromCents(toCents(value));
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
      attachment_scope: ['request', 'disbursement', 'liquidation', 'document_upload'].includes(toText(attachment.attachment_scope))
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
  const itemCategoryNameTotals = new Map<string, number>();
  let unassignedItemsTotal = 0;

  (items || []).forEach((item) => {
    const itemCategoryId = toText(item.category_id);
    const itemCategoryName = toText(item.category || item.main_category || '');
    const itemAmount = toNumber(item.amount);

    if (itemCategoryId) {
      itemCategoryTotals.set(itemCategoryId, (itemCategoryTotals.get(itemCategoryId) || 0) + itemAmount);
    } else if (itemCategoryName) {
      itemCategoryNameTotals.set(itemCategoryName, (itemCategoryNameTotals.get(itemCategoryName) || 0) + itemAmount);
    } else {
      unassignedItemsTotal += itemAmount;
    }
  });

  const normalizedCategoryId = toText(categoryId);
  const normalizedCategoryName = toText(categoryName);

  if (itemCategoryTotals.size > 0) {
    const categoryIds = Array.from(itemCategoryTotals.keys());
    const { data: categories, error } = await supabase
      .from('budget_categories')
      .select('id, category_name, department_id, fiscal_year, remaining_amount, parent_category_id')
      .in('id', categoryIds);

    if (error) return error.message;

    const categoriesById = new Map((categories || []).map((category: any) => [category.id, category]));
    for (const id of categoryIds) {
      const category = categoriesById.get(id);
      const requestedAmount = itemCategoryTotals.get(id) || 0;

      if (!category) {
        return `Requested category ID ${id} was not found. Please choose a valid budget category.`;
      }

      if (category.department_id !== targetDepartmentId || Number(category.fiscal_year) !== fiscalYear) {
        return `Category "${category.category_name || id}" does not belong to the selected department and fiscal year.`;
      }

      // Note: allow submission even when remaining budget is insufficient.
      // Supervisors/accounting will see the remaining_amount on the ticket to decide.
    }
  }

  if (itemCategoryNameTotals.size > 0) {
    for (const [name, requestedAmount] of itemCategoryNameTotals.entries()) {
      const { data: category, error } = await supabase
        .from('budget_categories')
        .select('id, category_name, department_id, fiscal_year, remaining_amount, parent_category_id')
        .eq('department_id', targetDepartmentId)
        .eq('fiscal_year', fiscalYear)
        .eq('category_name', name)
        .maybeSingle();

      if (error) return error.message;
      if (!category) {
        return `Requested category "${name}" was not found for the selected department and fiscal year.`;
      }

      // Note: allow submission even when remaining budget is insufficient.
      // Supervisors/accounting will see the remaining_amount on the ticket to decide.
    }
  }

  if (unassignedItemsTotal > 0) {
    if (!normalizedCategoryId && !normalizedCategoryName) {
      return 'Unable to validate budget for one or more items: missing category assignment.';
    }
    if (toNumber(unassignedItemsTotal) > 0) {
      const categoryError = await validateCategoryBudgetsForSubmission(
        targetDepartmentId,
        fiscalYear,
        unassignedItemsTotal,
        normalizedCategoryId,
        normalizedCategoryName,
        []
      );
      if (categoryError) return categoryError;
    }
  }

  if (itemCategoryTotals.size === 0 && itemCategoryNameTotals.size === 0 && unassignedItemsTotal === 0) {
    if (!normalizedCategoryId && !normalizedCategoryName) return 'Category assignment is required for this request.';
  }

  if (!normalizedCategoryId && !normalizedCategoryName) {
    return null;
  }

  let categoryQuery = supabase
    .from('budget_categories')
    .select('id, category_name, department_id, fiscal_year, remaining_amount, parent_category_id')
    .eq('department_id', targetDepartmentId)
    .eq('fiscal_year', fiscalYear);

  categoryQuery = normalizedCategoryId
    ? categoryQuery.eq('id', normalizedCategoryId)
    : categoryQuery.eq('category_name', normalizedCategoryName);

  const { data: category, error } = await categoryQuery.maybeSingle();
  if (error) return error.message;
  if (!category) {
    return `Category "${normalizedCategoryName || normalizedCategoryId}" was not found for the selected department and fiscal year.`;
  }

  // Allow submission even if remaining budget is insufficient; supervisors will review remaining_amount on the ticket.

  return null;
};

const enrichItemsWithCategoryInfo = async (rows: any[]) => {
  if (!rows.length) return rows;

  // Collect all unique category IDs from items in all requests
  const categoryIds = new Set<string>();
  rows.forEach((row) => {
    if (row.metadata?.items && Array.isArray(row.metadata.items)) {
      row.metadata.items.forEach((item: any) => {
        if (item.category_id) categoryIds.add(item.category_id);
      });
    }
  });

  if (categoryIds.size === 0) return rows;

  // Fetch all categories at once
  const { data: categories } = await supabase
    .from('budget_categories')
    .select('id, category_name, parent_category_id')
    .in('id', Array.from(categoryIds));

  const categoryById = new Map((categories || []).map((cat: any) => [cat.id, cat]));
  
  // Fetch parent categories
  const parentCategoryIds = new Set<string>();
  categories?.forEach((cat: any) => {
    if (cat.parent_category_id) parentCategoryIds.add(cat.parent_category_id);
  });

  let parentCategoryById = new Map<string, any>();
  if (parentCategoryIds.size > 0) {
    const { data: parentCategories } = await supabase
      .from('budget_categories')
      .select('id, category_name')
      .in('id', Array.from(parentCategoryIds));
    parentCategoryById = new Map((parentCategories || []).map((cat: any) => [cat.id, cat]));
  }

  // Enrich items with category info
  return rows.map((row) => {
    if (row.metadata?.items && Array.isArray(row.metadata.items)) {
      return {
        ...row,
        metadata: {
          ...row.metadata,
          items: row.metadata.items.map((item: any) => {
            if (!item.category_id) return item;

            const category = categoryById.get(item.category_id);
            if (!category) return item;

            const parentCategory = category.parent_category_id ? parentCategoryById.get(category.parent_category_id) : null;
            
            return {
              ...item,
              category: category.category_name,
              main_category: parentCategory?.category_name || category.category_name,
              category_type: category.parent_category_id ? 'sub-category' : 'main-category'
            };
          })
        }
      };
    }
    return row;
  });
};

const appendWorkflowData = async (rows: any[]) => {
  if (!rows.length) return rows;

  // First enrich items with category information
  const enrichedRows = await enrichItemsWithCategoryInfo(rows);

  const requestIds = enrichedRows.map((row) => row.id);
  const [attachmentsResult, liquidationResult] = await Promise.all([
    supabase
      .from('request_attachments')
      .select('id, request_id, liquidation_id, attachment_scope, attachment_type, file_name, file_url, mime_type, file_size_bytes, uploaded_at')
      .in('request_id', requestIds)
      .order('uploaded_at', { ascending: true }),
    supabase
      .from('request_liquidations')
      .select('id, request_id, liquidation_no, status, due_at, submitted_at, reviewed_at, actual_amount, reimbursable_amount, cash_return_amount, cash_return_status, cash_returned_at, cash_returned_confirmed_by, cash_advance_id, shortage_amount, remarks, created_at, updated_at')
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
      latestLiquidationByRequestId.set(liquidation.request_id, {
        ...liquidation,
        items: []
      });
    }
  });

  const liquidationIds = Array.from(
    new Set(
      (liquidationResult.data || [])
        .map((liquidation: any) => liquidation.id)
        .filter(Boolean)
    )
  );

  const liquidationItemsById = new Map<string, any[]>();
  if (liquidationIds.length) {
    const { data: liquidationItems, error: liquidationItemsError } = await supabase
      .from('liquidation_items')
      .select('*')
      .in('liquidation_id', liquidationIds)
      .order('expense_date', { ascending: true });

    if (liquidationItemsError) throw liquidationItemsError;
    (liquidationItems || []).forEach((item: any) => {
      const list = liquidationItemsById.get(item.liquidation_id) || [];
      list.push(item);
      liquidationItemsById.set(item.liquidation_id, list);
    });

    for (const liquidation of latestLiquidationByRequestId.values()) {
      if (liquidation.id) {
        liquidation.items = liquidationItemsById.get(liquidation.id) || [];
      }
    }
  }

  return enrichedRows.map((row) => ({
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

const TICKET_USED_STATUSES = new Set(['approved', 'released']);
const TICKET_COMMITTED_STATUSES = new Set(['pending_supervisor', 'pending_accounting', 'pending_vp', 'pending_president', 'on_hold']);

const reconcileCategoryTicketUsage = async (categoryId: string, budgetAmount: number, reservedAmount = 0) => {
  const { data: category } = await supabase
    .from('budget_categories')
    .select('id, department_id, fiscal_year')
    .eq('id', categoryId)
    .maybeSingle();

  if (!category) return { used: 0, committed: 0 };

  const relevantStatuses = [...TICKET_USED_STATUSES, ...TICKET_COMMITTED_STATUSES];
  const { data: requests } = await supabase
    .from('expense_requests')
    .select('id, category_id, amount, status, request_type')
    .eq('department_id', category.department_id)
    .eq('fiscal_year', category.fiscal_year)
    .in('status', relevantStatuses)
    .not('request_type', 'in', '(budget_request,budget_revision)');

  const requestRows = requests || [];
  const requestIds = requestRows.map((request: any) => request.id);
  const { data: items } = requestIds.length
    ? await supabase
      .from('request_items')
      .select('request_id, category_id, amount')
      .in('request_id', requestIds)
    : { data: [] as any[] };

  const requestsById = new Map(requestRows.map((request: any) => [request.id, request]));
  const requestIdsWithItems = new Set((items || []).map((item: any) => item.request_id));
  let used = 0;
  let committed = 0;

  const addAmount = (status: string, amount: number) => {
    if (TICKET_USED_STATUSES.has(status)) used += amount;
    if (TICKET_COMMITTED_STATUSES.has(status)) committed += amount;
  };

  for (const item of items || []) {
    if (item.category_id !== categoryId) continue;
    const request = requestsById.get(item.request_id);
    if (!request) continue;
    addAmount(request.status, toNumber(item.amount));
  }

  for (const request of requestRows) {
    if (requestIdsWithItems.has(request.id)) continue;
    if (request.category_id !== categoryId) continue;
    addAmount(request.status, toNumber(request.amount));
  }

  const remainingAmount = Math.max(0, budgetAmount - reservedAmount - used - committed);
  await supabase
    .from('budget_categories')
    .update({
      used_amount: used,
      committed_amount: committed,
      remaining_amount: remainingAmount,
      updated_at: new Date(),
    })
    .eq('id', categoryId);

  return { used, committed };
};

const resolveMainCategory = async (categoryId: string) => {
  const { data: category } = await supabase
    .from('budget_categories')
    .select('*')
    .eq('id', categoryId)
    .maybeSingle();

  if (!category) return null;
  if (!category.parent_category_id) return category;

  const { data: parent } = await supabase
    .from('budget_categories')
    .select('*')
    .eq('id', category.parent_category_id)
    .maybeSingle();

  return parent || category;
};

const applyApprovedBudgetProposal = async (request: any) => {
  if (!request.category_id) return;
  const proposedAmount = toNumber(request.amount);
  
  // Fetch the requested category (could be main or sub)
  const { data: requestedCategory } = await supabase
    .from('budget_categories')
    .select('*')
    .eq('id', request.category_id)
    .maybeSingle();

  if (!requestedCategory) return;

  // If this is a sub-category (has parent), update the sub-category directly
  if (requestedCategory.parent_category_id) {
    const previousAmount = toNumber(requestedCategory.budget_amount);
    
    // Update sub-category budget
    await supabase
      .from('budget_categories')
      .update({
        budget_amount: proposedAmount,
        remaining_amount: proposedAmount,
        is_locked: true,
        locked_at: new Date(),
        updated_at: new Date()
      })
      .eq('id', requestedCategory.id);

    // Reconcile sub-category usage
    await reconcileCategoryTicketUsage(requestedCategory.id, proposedAmount, 0);
  } else {
    // This is a main category (no parent) — update normally
    const previousAmount = toNumber(requestedCategory.budget_amount);
    const { data: children } = await supabase
      .from('budget_categories')
      .select('budget_amount')
      .eq('parent_category_id', requestedCategory.id);
    const childTotal = (children || []).reduce((sum: number, child: any) => sum + toNumber(child.budget_amount), 0);
    const newRemaining = Math.max(0, proposedAmount - childTotal);

    await supabase
      .from('budget_categories')
      .update({
        budget_amount: proposedAmount,
        remaining_amount: newRemaining,
        is_locked: true,
        locked_at: new Date(),
        updated_at: new Date()
      })
      .eq('id', requestedCategory.id);

    await reconcileCategoryTicketUsage(requestedCategory.id, proposedAmount, childTotal);
  }

  await lockDepartmentBudgetMatrix(request.department_id, request.fiscal_year);

  // Sync departments.annual_budget to reflect the newly approved category budget
  const { data: allCats } = await supabase
    .from('budget_categories')
    .select('budget_amount')
    .eq('department_id', request.department_id)
    .eq('fiscal_year', request.fiscal_year)
    .is('parent_category_id', null);
  const newAnnualTotal = (allCats || []).reduce((s: number, c: any) => s + toNumber(c.budget_amount), 0);

  const { data: dept } = await supabase.from('departments').select('name').eq('id', request.department_id).single();
  if (dept?.name) {
    await supabase.from('departments')
      .update({ annual_budget: newAnnualTotal, updated_at: new Date() })
      .ilike('name', dept.name)
      .eq('fiscal_year', request.fiscal_year);
  } else {
    await supabase.from('departments')
      .update({ annual_budget: newAnnualTotal, updated_at: new Date() })
      .eq('id', request.department_id);
  }

  // Update M88 Manila cost center budget (sum of all departments' annual budgets + pending)
  await updateM88ManilaCostCenterBudget(request.fiscal_year);

  const category = requestedCategory.parent_category_id ? requestedCategory : (await resolveMainCategory(request.category_id));
  await supabase.from('budget_revision_history').insert({
    category_id: requestedCategory.id,
    department_id: request.department_id,
    request_id: request.id,
    previous_amount: toNumber(requestedCategory.budget_amount),
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

  // Only check category budget (main or sub), not department annual budget
  // Department used_budget is intentionally not updated here.

  const categoryAuditEntries: any[] = [];

  // Store original category budget values for rollback if dual deduction fails
  const categoryRollbackData: Map<string, { used_amount: number; committed_amount: number; remaining_amount: number }> = new Map();

  // Check if request uses General Category for dual deduction
  let isGeneralCategoryRequest = false;
  let generalCategoryId: string | null = null;
  
  if (request.category_id) {
    isGeneralCategoryRequest = await isGeneralCategory(request.category_id);
    generalCategoryId = request.category_id;
  } else if (request.category) {
    // For requests without category_id, check by category name
    const { data: cat } = await supabase
      .from('budget_categories')
      .select('id, department_id')
      .eq('category_name', String(request.category).trim())
      .eq('department_id', request.department_id)
      .eq('fiscal_year', request.fiscal_year)
      .maybeSingle();
    if (cat && cat.department_id === 'All') {
      isGeneralCategoryRequest = true;
      generalCategoryId = cat.id;
    }
  }

  for (const allocation of normalizedAllocations) {
    if (releaseMethod === 'petty_cash') {
      const { data: department, error: departmentError } = await supabase
        .from('departments')
        .select('id, petty_cash_balance')
        .eq('id', allocation.department_id)
        .single();

      if (departmentError || !department) {
        throw new Error(departmentError?.message || 'Department not found.');
      }

      const updatePayload: any = {
        petty_cash_balance: toNumber(department.petty_cash_balance) - toNumber(allocation.amount),
        updated_at: new Date()
      };

      const { error: updateDepartmentError } = await supabase
        .from('departments')
        .update(updatePayload)
        .eq('id', allocation.department_id);

      if (updateDepartmentError) {
        throw updateDepartmentError;
      }
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
          .select('id, category_name, committed_amount, used_amount, budget_amount, remaining_amount')
          .eq('id', rItem.category_id)
          .maybeSingle();

        if (!catBudget) continue;

        // Store original values for potential rollback
        categoryRollbackData.set(catBudget.id, {
          used_amount: toNumber(catBudget.used_amount),
          committed_amount: toNumber(catBudget.committed_amount),
          remaining_amount: toNumber(catBudget.remaining_amount)
        });

        const newCommitted = Math.max(0, toNumber(catBudget.committed_amount) - itemAmountToDeduct);
        const newUsed = toNumber(catBudget.used_amount) + itemAmountToDeduct;
        const newRemaining = Math.max(0, toNumber(catBudget.budget_amount) - newUsed - newCommitted);

        const { error: updateCatErr } = await supabase
          .from('budget_categories')
          .update({ used_amount: newUsed, committed_amount: newCommitted, remaining_amount: newRemaining, updated_at: new Date() })
          .eq('id', catBudget.id);

        if (updateCatErr) {
          console.error('Failed to update category on release:', updateCatErr);
        } else {
          categoryAuditEntries.push({
            entity_type: 'request',
            action: 'category_budget_deducted',
            field_name: 'used_amount',
            old_value: String(catBudget.used_amount),
            new_value: String(newUsed.toFixed(2)),
            note: `Category budget deducted for ${catBudget.category_name || catBudget.id}`
          });
          await checkBudgetUtilizationWarning(catBudget.id);
        }
      }
    } else if (request.category_id || request.category) {
      const categoryId = request.category_id;
      let categoryBudgetQuery = supabase.from('budget_categories').select('id, category_name, committed_amount, used_amount, budget_amount, remaining_amount');

      if (categoryId) {
        categoryBudgetQuery = categoryBudgetQuery.eq('id', categoryId);
      } else {
        categoryBudgetQuery = categoryBudgetQuery
          .eq('category_name', String(request.category).trim())
          .eq('department_id', allocation.department_id)
          .eq('fiscal_year', request.fiscal_year);
      }

      const { data: categoryBudget, error: fetchCategoryError } = await categoryBudgetQuery.maybeSingle();

      if (!fetchCategoryError && categoryBudget) {
        // Store original values for potential rollback
        categoryRollbackData.set(categoryBudget.id, {
          used_amount: toNumber(categoryBudget.used_amount),
          committed_amount: toNumber(categoryBudget.committed_amount),
          remaining_amount: toNumber(categoryBudget.remaining_amount)
        });

        const amountToDeduct = toNumber(allocation.amount);
        const newCommitted = Math.max(0, toNumber(categoryBudget.committed_amount) - amountToDeduct);
        const newUsedAmount = toNumber(categoryBudget.used_amount) + amountToDeduct;
        const newRemainingAmount = Math.max(0, toNumber(categoryBudget.budget_amount) - newUsedAmount - newCommitted);

        const { error: updateCategoryError } = await supabase
          .from('budget_categories')
          .update({ used_amount: newUsedAmount, committed_amount: newCommitted, remaining_amount: newRemainingAmount, updated_at: new Date() })
          .eq('id', categoryBudget.id);

        if (updateCategoryError) {
          console.error('Failed to update category budget on release:', updateCategoryError);
        } else {
          categoryAuditEntries.push({
            entity_type: 'request',
            action: 'category_budget_deducted',
            field_name: 'used_amount',
            old_value: String(categoryBudget.used_amount),
            new_value: String(newUsedAmount.toFixed(2)),
            note: `Category budget deducted for ${categoryBudget.category_name || categoryBudget.id}`
          });
          await checkBudgetUtilizationWarning(categoryBudget.id);
        }
      }
    }
  }

  // Dual deduction for General Categories: also deduct from M88 Manila cost center
  if (isGeneralCategoryRequest) {
    try {
      const costCenter = await findOrCreateM88ManilaCostCenter(request.fiscal_year);
      const requestCurrency = request.metadata?.currency || 'PHP';
      const amountToDeduct = convertToPhp(toNumber(request.amount), requestCurrency);

      // Check if M88 Manila cost center has sufficient funds
      if (toNumber(costCenter.remaining_amount) < amountToDeduct) {
        throw new Error(`Insufficient funds in M88 Manila cost center. Available: ${toNumber(costCenter.remaining_amount).toFixed(2)}, Required: ${amountToDeduct.toFixed(2)}`);
      }

      // Deduct from M88 Manila cost center
      const { error: costCenterError } = await supabase
        .from('cost_centers')
        .update({
          used_amount: toNumber(costCenter.used_amount) + amountToDeduct,
          remaining_amount: toNumber(costCenter.remaining_amount) - amountToDeduct
        })
        .eq('id', costCenter.id);

      if (costCenterError) {
        throw new Error(`Failed to deduct from M88 Manila cost center: ${costCenterError.message}`);
      }

      // Log audit event for cost center deduction
      await logAuditEvent({
        user: { id: actorId },
        actionType: AUDIT_ACTIONS.COST_ALLOCATION_CONFIRMED,
        recordType: 'cost_center',
        recordId: costCenter.id,
        recordLabel: costCenter.name,
        remarks: `Dual deduction: ${amountToDeduct} deducted from M88 Manila cost center for General Category request ${request.request_code}`
      });
    } catch (dualDeductionError: any) {
      // Rollback category budget deductions if cost center deduction fails
      console.error('Dual deduction failed, rolling back category deductions:', dualDeductionError);

      // Perform actual rollback of category budgets
      const rollbackErrors: string[] = [];
      for (const [categoryId, originalValues] of categoryRollbackData.entries()) {
        try {
          const { error: rollbackError } = await supabase
            .from('budget_categories')
            .update({
              used_amount: originalValues.used_amount,
              committed_amount: originalValues.committed_amount,
              remaining_amount: originalValues.remaining_amount,
              updated_at: new Date()
            })
            .eq('id', categoryId);

          if (rollbackError) {
            rollbackErrors.push(`Category ${categoryId}: ${rollbackError.message}`);
          }
        } catch (err: any) {
          rollbackErrors.push(`Category ${categoryId}: ${err.message}`);
        }
      }

      // Log rollback audit event
      await logAuditEvent({
        user: { id: actorId },
        actionType: 'dual_deduction_rolled_back',
        recordType: 'request',
        recordId: request.id,
        recordLabel: request.request_code,
        remarks: `Dual deduction rollback for General Category request ${request.request_code}. Reason: ${dualDeductionError.message}. Rolled back ${categoryRollbackData.size} categories. Errors: ${rollbackErrors.join(', ') || 'None'}`
      });

      // TODO: Migrate to database transaction (Option B) for atomic dual deduction
      // Currently using manual rollback (Option A) which is less reliable
      // Future: Use Supabase RPC transaction to ensure both deductions succeed or fail together

      throw new Error(`Dual deduction failed: ${dualDeductionError.message}. Category budgets have been rolled back. ${rollbackErrors.length > 0 ? `Rollback errors: ${rollbackErrors.join(', ')}` : ''}`);
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

  // Record petty cash transactions for disbursements when release method is petty cash
  if (releaseMethod === 'petty_cash') {
    try {
      const txInserts = (normalizedAllocations || []).map((alloc: any) => ({
        department_id: alloc.department_id,
        managed_by: actorId,
        type: 'disbursement',
        amount: toNumber(alloc.amount),
        purpose: request.purpose || `Release for ${request.request_code}`,
        reference_request_id: request.id,
        transaction_date: new Date(),
        created_at: new Date(),
        updated_at: new Date()
      }));

      if (txInserts.length) {
        const { error: txError } = await supabase.from('petty_cash_transactions').insert(txInserts);
        if (txError) console.error('Failed to insert petty cash transactions on release:', txError);
      }
    } catch (txErr) {
      console.error('Error recording petty cash transactions on release:', txErr);
    }
  }

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
    },
    ...categoryAuditEntries
  ];

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
  const userRole = String(req.user.role || '').trim().toLowerCase();
  const requestType = req.query.request_type as 'cash_advance' | 'reimbursement' | undefined;
  const mannerOfSubmission = String(req.query.manner_of_submission || '').trim() as 'for_submission' | 'for_upload' | '';

  try {
    const baseList = await resolveOfficialExpenseList();
    if (mannerOfSubmission === 'for_upload') {
      // Budget Adjustment: return ALL categories/subcategories to ALL users
      return res.json(baseList);
    }
    let list = baseList;

    list = filterOfficialExpenseList(list, {
      requestType,
      userRole: req.user.role,
    });
    res.json(list);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/requests/debug/category/:categoryId - Debug budget usage for a category (accounting only)
router.get('/debug/category/:categoryId', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { categoryId } = req.params;
    
    const { data: category } = await supabase
      .from('budget_categories')
      .select('*')
      .eq('id', categoryId)
      .single();
      
    if (!category) return res.status(404).json({ error: 'Category not found' });
    
    // Get all requests using this category (both directly and via items)
    const { data: requestsUsingDirect } = await supabase
      .from('expense_requests')
      .select('id, request_code, item_name, amount, status, submitted_at, category_id')
      .eq('category_id', categoryId)
      .eq('department_id', category.department_id)
      .eq('fiscal_year', category.fiscal_year);
      
    const { data: itemsUsingCategory } = await supabase
      .from('request_items')
      .select('request_id, amount, category_id')
      .eq('category_id', categoryId);
      
    const requestIdsFromItems = new Set((itemsUsingCategory || []).map(i => i.request_id));
    
    let itemRequestTotal = 0;
    if (requestIdsFromItems.size > 0) {
      const { data: requestsFromItems } = await supabase
        .from('expense_requests')
        .select('id, request_code, status, submitted_at')
        .in('id', Array.from(requestIdsFromItems));
        
      for (const item of itemsUsingCategory || []) {
        itemRequestTotal += toNumber(item.amount);
      }
    }
    
    const directTotal = (requestsUsingDirect || []).reduce((sum, r) => sum + toNumber(r.amount), 0);
    
    res.json({
      category: {
        id: category.id,
        name: category.category_name,
        budget_amount: category.budget_amount,
        used_amount: category.used_amount,
        committed_amount: category.committed_amount,
        remaining_amount: category.remaining_amount
      },
      requests_using_directly: {
        count: requestsUsingDirect?.length || 0,
        total_amount: directTotal,
        requests: requestsUsingDirect || []
      },
      requests_using_via_items: {
        count: requestIdsFromItems.size,
        total_amount: itemRequestTotal,
        item_count: (itemsUsingCategory || []).length
      },
      summary: {
        total_requests: (requestsUsingDirect?.length || 0) + requestIdsFromItems.size,
        total_allocated: directTotal + itemRequestTotal,
        available: toNumber(category.remaining_amount)
      }
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/requests - list filtered by role/dept
router.get('/', authenticate, async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  // accounting/admin/super_admin see all years by default; others scoped to active FY unless ?all_years=true
  const allYears = req.query.all_years === 'true' || ['accounting', 'admin', 'super_admin'].includes(req.user.role);
  const requestedFiscalYear = req.query.fiscal_year ? Number(req.query.fiscal_year) : null;
  const requestedDepartmentId = req.query.department_id ? String(req.query.department_id) : null;
  let query = supabase.from('expense_requests').select('*');

  // Apply fiscal year filter. If not an all-years viewer, default to the active fiscal year.
  if (requestedFiscalYear) {
    query = query.eq('fiscal_year', requestedFiscalYear);
  } else if (!allYears) {
    query = query.eq('fiscal_year', activeFiscalYear);
  }

  if (req.user.role === 'employee' || req.user.role === 'manager') {
    query = query.eq('employee_id', req.user.id);
  } else if (req.user.role === 'supervisor') {
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
    if (requestedDepartmentId) {
      // Only allow viewing the requested department if the supervisor has access to it.
      if (accessibleDepartmentIds.includes(requestedDepartmentId)) {
        query = query.eq('department_id', requestedDepartmentId);
      } else if (accessibleDepartmentIds.length) {
        query = query.in('department_id', accessibleDepartmentIds);
      } else {
        query = query.eq('department_id', req.user.department_id);
      }
    } else {
      query = accessibleDepartmentIds.length
        ? query.in('department_id', accessibleDepartmentIds)
        : query.eq('department_id', req.user.department_id);
    }
  } else if (requestedDepartmentId && ['accounting', 'admin', 'super_admin'].includes(req.user.role)) {
    // Admin/accounting can filter by a specific department.
    query = query.eq('department_id', requestedDepartmentId);
  }

  // Apply status filter if provided (e.g. ?status=pending_vp)
  const requestedStatus = req.query.status ? String(req.query.status) : null;
  if (requestedStatus) {
    query = query.eq('status', requestedStatus);
  }

  const { data, error } = await query.order('request_code', { ascending: true });
  if (error) return res.status(400).json({ error });

  try {
    const rowsWithRelations = await appendRequestRelations(data || []);
    const { summaryByDepartmentId, allocationsByRequestId } = await buildDepartmentBudgetSummaryMap();
    const enrichedRows = await enrichRequests(rowsWithRelations, summaryByDepartmentId, allocationsByRequestId);
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
    const enrichedRows = await enrichRequests(rowsWithRelations, summaryByDepartmentId, allocationsByRequestId);
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
  
  // Use sequential auto-increment codes instead of random UUID (Section 2.1)
  const requestType = isBudgetRevision ? 'budget_revision' : isBudgetRequest ? 'budget_request' : request_type || 'reimbursement';
  const request_code = await generateRequestCode(supabase, requestType);
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

  let initialStatus;
  
  // Sequential approval flow: Supervisor → Accounting → VP → President
  // (no threshold-based skipping — every request goes through all stages)
  if (isBudgetFlow) {
    if (userRole === 'employee' || userRole === 'manager') {
      initialStatus = 'pending_supervisor';
    } else if (userRole === 'supervisor') {
      initialStatus = 'pending_accounting';
    } else if (userRole === 'accounting') {
      initialStatus = 'pending_vp';
    } else if (userRole === 'vp') {
      initialStatus = 'pending_president';
    } else {
      initialStatus = 'pending_accounting';
    }
  } else {
    if (userRole === 'employee' || userRole === 'manager') {
      initialStatus = 'pending_supervisor';
    } else if (userRole === 'supervisor') {
      initialStatus = 'pending_accounting';
    } else if (userRole === 'accounting') {
      initialStatus = 'pending_vp';
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
        const validation = validateExpense(item.item_name, departmentName, request_type, budgetOnlyItems, req.user.role, true);
        const rejected = rejectValidation(item.item_name, validation);
        if (rejected) return rejected;
      }
    } else {
      const validation = validateExpense(item_name, departmentName, request_type, budgetOnlyItems, req.user.role, true);
      const rejected = rejectValidation(item_name, validation);
      if (rejected) return rejected;
    }
  }

  // 2. Validate category remaining for all expense submissions except budget proposals.
  const totalAmount = toNumber(amount);

  if (!isBudgetFlow) {
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

  // Recalculate M88 Manila cost center pending/used amounts
  await updateM88ManilaCostCenterBudget(activeDepartment.fiscal_year);

  res.json(responseRows[0]);
});

// GET /api/requests/audit-logs — combined view (accounting+ only; supervisors blocked)
router.get('/audit-logs', authenticate, authorize('accounting', 'vp', 'president', 'admin', 'super_admin'), async (req: any, res) => {
  // Always fetch from all three log sources and merge them
  const [dedicatedResult, approvalLogsResult, allocationLogsResult, auditLogsResult] = await Promise.all([
    supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('approval_logs').select('*').order('timestamp', { ascending: false }).limit(150),
    supabase.from('allocation_logs').select('*').order('created_at', { ascending: false }).limit(150),
    supabase.from('request_audit_logs').select('*').order('created_at', { ascending: false }).limit(150)
  ]);

  if (approvalLogsResult.error) return res.status(400).json({ error: approvalLogsResult.error });
  if (allocationLogsResult.error) return res.status(400).json({ error: allocationLogsResult.error });
  if (auditLogsResult.error) return res.status(400).json({ error: auditLogsResult.error });

  // Map dedicated audit_logs entries
  const dedicatedLogs = (dedicatedResult.data || []).map((log: any) => ({
    ...log,
    log_type: 'audit',
    event_time: log.created_at,
    actor_name: log.user_name,
    actor_role: log.user_role,
    note: log.remarks,
    action: log.action_type,
  }));

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
  const requestAuditLogs = (auditLogsResult.data || []).map((log: any) => ({
    ...log,
    log_type: 'audit',
    event_time: log.created_at
  }));

  const combinedLogs = [...dedicatedLogs, ...approvalLogs, ...allocationLogs, ...requestAuditLogs]
    .sort((left: any, right: any) => new Date(right.event_time).getTime() - new Date(left.event_time).getTime())
    .slice(0, 200);

  const actorIds = Array.from(new Set(combinedLogs.map((log: any) => log.actor_id || log.user_id).filter(Boolean)));
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
    const enrichedRows = await enrichRequests(rowsWithRelations, summaryByDepartmentId, allocationsByRequestId);
    res.json((await appendWorkflowDataToRequests(enrichedRows))[0]);
  } catch (summaryError: any) {
    res.status(400).json({ error: summaryError?.message || summaryError });
  }
});

// GET /api/requests/:id/items - Fetch individual request items for multi-item editing
router.get('/:id/items', authenticate, async (req: any, res) => {
  try {
    const { data: request, error: requestError } = await supabase
      .from('expense_requests')
      .select('id, employee_id, department_id')
      .eq('id', req.params.id)
      .single();
    
    if (requestError || !request) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    // Authorization check
    if ((req.user.role === 'employee' || req.user.role === 'manager') && request.employee_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    // Fetch individual items
    const { data: items, error: itemsError } = await supabase
      .from('request_items')
      .select('id, item_name, amount')
      .eq('request_id', req.params.id)
      .order('created_at', { ascending: true });
    
    if (itemsError) {
      return res.status(400).json({ error: itemsError });
    }
    
    // Return items
    res.json((items || []).map(item => ({
      id: item.id,
      description: item.item_name,
      item_name: item.item_name,
      amount: item.amount
    })));
  } catch (err: any) {
    res.status(400).json({ error: err.message || err });
  }
});

const recomputeCashAdvanceBalance = async (cashAdvanceId: string) => {
  const { data: cashAdvance, error: cashAdvanceError } = await supabase
    .from('cash_advances')
    .select('id, amount_issued')
    .eq('id', cashAdvanceId)
    .single();

  if (cashAdvanceError || !cashAdvance) {
    return { error: cashAdvanceError || new Error('Cash advance not found') };
  }

  const { data: liquidationRows, error: liquidationSumError } = await supabase
    .from('request_liquidations')
    .select('amount_spent')
    .eq('cash_advance_id', cashAdvanceId)
    .in('status', ['submitted', 'verified']);

  if (liquidationSumError) return { error: liquidationSumError };

  const totalSpent = (liquidationRows || []).reduce((sum: number, row: any) => sum + toNumber(row.amount_spent), 0);
  const amountIssued = toNumber(cashAdvance.amount_issued);
  const newBalance = Math.max(amountIssued - totalSpent, 0);

  const newStatus = newBalance <= 0 ? 'fully_liquidated' : totalSpent > 0 ? 'partially_liquidated' : 'outstanding';

  const { error: updateError } = await supabase
    .from('cash_advances')
    .update({
      amount_liquidated: totalSpent,
      balance: newBalance,
      status: newStatus,
      fully_liquidated_at: newBalance <= 0 ? new Date() : null,
      updated_at: new Date()
    })
    .eq('id', cashAdvanceId);

  return { error: updateError || null };
};

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

    const { data: existingLiquidation } = await supabase
      .from('request_liquidations')
      .select('*')
      .eq('request_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const previousSpent = existingLiquidation?.status === 'submitted'
      && existingLiquidation?.cash_advance_id === cashAdvanceId
      ? toNumber(existingLiquidation.amount_spent)
      : 0;

    const effectiveBalance = toNumber(cashAdvance.balance) + previousSpent;
    if (amountSpent > effectiveBalance) {
      return res.status(400).json({ error: `Amount spent cannot exceed cash advance balance of ${effectiveBalance}.` });
    }

    let result;
    if (existingLiquidation?.id) {
      result = await supabase
        .from('request_liquidations')
        .update({
          status: 'submitted',
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
          status: 'submitted',
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

    const { error: recomputeError } = await recomputeCashAdvanceBalance(String(cashAdvanceId));
    if (recomputeError) console.error('Cash advance balance recompute error:', recomputeError);

    try {
      await insertAuditLogs(id, req.user.id, [
        {
          entity_type: 'liquidation',
          action: 'submitted',
          field_name: 'status',
          old_value: existingLiquidation?.status || 'pending_submission',
          new_value: 'submitted',
          note: remarks || 'Liquidation submitted'
        }
      ]);
      await logAuditEvent({
        user: req.user,
        actionType: AUDIT_ACTIONS.CASH_ADVANCE_LIQUIDATED,
        recordType: 'liquidation',
        recordId: result.data.id,
        recordLabel: cashAdvance.advance_code,
        newValue: { amount_spent: amountSpent, status: 'submitted' },
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
      
      if (catError) return res.status(400).json({ error: catError.message || 'Failed to verify category budget.' });
      if (!categoryBudget) {
        return res.status(400).json({ error: `Category "${categoryName}" not found for department ${allocation.department_id} in fiscal year ${request.fiscal_year}.` });
      }

      const remaining = toNumber(categoryBudget.remaining_amount);
      const allocationAmount = toNumber(allocation.amount);
      
      if (remaining < allocationAmount) {
        return res.status(400).json({
          error: `Insufficient budget in category "${categoryName}" for department. Available: ${remaining.toFixed(2)}, Required: ${allocationAmount.toFixed(2)}`
        });
      }
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

  // Sequential flow: Supervisor → Accounting (always)
  const nextStatus = 'pending_accounting';

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

  await logAuditEvent({
    user: req.user,
    actionType: request.request_type === 'cash_advance'
      ? AUDIT_ACTIONS.CASH_ADVANCE_APPROVED
      : isBudgetFlow
        ? AUDIT_ACTIONS.BUDGET_SUBMITTED
        : AUDIT_ACTIONS.REIMBURSEMENT_APPROVED,
    recordType: isBudgetFlow ? 'budget' : 'request',
    recordId: id,
    recordLabel: request.request_code,
    oldValue: { status: request.status },
    newValue: { status: nextStatus },
    remarks: isBudgetFlow ? 'Supervisor approved budget proposal' : 'Supervisor approved request'
  });

  // Notify accounting for all request types (sequential flow)
  await notifyAccounting(
    isBudgetFlow
      ? `Budget proposal ${request.request_code} approved by supervisor — pending accounting review.`
      : `Request ${request.request_code} approved by supervisor — pending accounting review.`
  );

  // Invalidate department cache so projected_remaining reflects the status change
  invalidateCache('/api/departments');

  // Recalculate M88 Manila cost center pending/used amounts
  await updateM88ManilaCostCenterBudget(request.fiscal_year);

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
  
  const userRole = req.user.role;

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
      note: `Co-approved by ${userRole.toUpperCase()}`
    }
  ]);

  // Recalculate M88 Manila cost center pending/used amounts
  await updateM88ManilaCostCenterBudget(request.fiscal_year);
  
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

  // Determine next status — sequential flow: Accounting → VP (always)
  const budgetFlow = isBudgetWorkflow(request.request_type);

  const nextStatus = 'pending_vp';

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
        ? 'Accounting approved budget proposal — forwarded to VP for review'
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
      remarks: req.body.note || 'Accounting approved request'
    });
  }

  // Notify VP (sequential flow: Accounting → VP always)
  await notifyVp(
    budgetFlow
      ? `Budget ${request.request_type === 'budget_revision' ? 'revision' : 'proposal'} ${request.request_code} requires VP review.`
      : `Request ${request.request_code} requires VP review.`
  );

  if (!budgetFlow) {
    await notifyEmployee(
      request.employee_id,
      request.request_code,
      'Request Update',
      `Your request ${request.request_code} has moved to VP review.`
    );
  }

  // Invalidate department cache so projected_remaining reflects the status change
  invalidateCache('/api/departments');

  // Recalculate M88 Manila cost center pending/used amounts
  await updateM88ManilaCostCenterBudget(request.fiscal_year);

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

  if (isBudgetWorkflow(request.request_type)) {
    await logFailedApprovalAttempt(req.user, id, request.request_code, 'Budget proposals require VP Mark as Viewed action');
    return res.status(400).json({
      error: 'Budget proposals must be marked as viewed using the Mark as Viewed action before President review.',
    });
  }

  // Sequential flow: VP → President (always)
  const nextStatus = 'pending_president';
  const updatePayload: Record<string, unknown> = { status: nextStatus, updated_at: new Date() };

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
      note: 'VP reviewed request — forwarded to President'
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
    remarks: 'VP reviewed — forwarded to President',
  });

  // Sequential flow: VP → President (always). Only notify President.
  // Do NOT send 'Approved' to employee/supervisor — President is the final approver.
  await notifyPresident(`Request ${request.request_code} requires President approval.`);

  await notifyEmployee(
    request.employee_id,
    request.request_code,
    'Request Update',
    `Your request ${request.request_code} has moved to President review.`
  );

  // Recalculate M88 Manila cost center pending/used amounts
  await updateM88ManilaCostCenterBudget(request.fiscal_year);

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
    // Invalidate all budget/department caches so every user sees the new budget immediately
    invalidateCache('/api/departments');
    invalidateCache('/api/budget/categories');
    invalidateCache('/api/budget/summary');
    invalidateCache('/api/budget/monitoring');
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

  // Recalculate M88 Manila cost center pending/used amounts
  await updateM88ManilaCostCenterBudget(request.fiscal_year);

  res.json(data);
});

// PATCH /api/requests/:id/hold - toggle on_hold status (Accounting/VP/President/Supervisor/Admin)
router.patch('/:id/hold', authenticate, authorize('accounting', 'vp', 'president', 'supervisor', 'admin'), async (req: any, res) => {
  const { id } = req.params;
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();
  
  if (fetchError || !request) {
    return res.status(404).json({ error: 'Request not found' });
  }
  
  const currentStatus = request.status;
  let newStatus: string;
  
  if (['pending_supervisor', 'pending_accounting', 'pending_vp', 'pending_president'].includes(currentStatus)) {
    newStatus = 'on_hold';
  } else if (currentStatus === 'on_hold') {
    // Restore to the original pending status based on who placed it on hold if possible.
    let restoreStatus = 'pending_accounting';
    if (request.on_hold_by) {
      const { data: holdUser, error: userError } = await supabase
        .from('users')
        .select('role')
        .eq('id', request.on_hold_by)
        .maybeSingle();
      if (!userError && holdUser?.role) {
        if (holdUser.role === 'supervisor') restoreStatus = 'pending_supervisor';
        else if (holdUser.role === 'accounting') restoreStatus = 'pending_accounting';
        else if (holdUser.role === 'vp') restoreStatus = 'pending_vp';
        else if (holdUser.role === 'president') restoreStatus = 'pending_president';
      }
    }
    newStatus = restoreStatus;
  } else {
    return res.status(400).json({ 
      error: `Cannot change hold status when request is ${currentStatus}. Only pending supervisor/accounting/VP/President or on_hold requests can be toggled.` 
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
    // Invalidate department/budget caches so used_budget reflects immediately for all users
    invalidateCache('/api/departments');
    invalidateCache('/api/budget/categories');
    
    // Update M88 Manila cost center to sync used_amount
    await updateM88ManilaCostCenterBudget(request.fiscal_year);

    await logAuditEvent({
      user: req.user,
      actionType: request.request_type === 'cash_advance'
        ? AUDIT_ACTIONS.CASH_ADVANCE_APPROVED
        : AUDIT_ACTIONS.REIMBURSEMENT_APPROVED,
      recordType: 'request',
      recordId: id,
      recordLabel: request.request_code,
      oldValue: { status: request.status },
      newValue: { status: 'released' },
      remarks: `Funds released via ${req.body?.release_method || 'bank_transfer'}`
    });
    
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
      co_approved_by: null,
      co_approved_at: null,
      co_approver_role: null,
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

  // Recalculate M88 Manila cost center pending/used amounts
  await updateM88ManilaCostCenterBudget(request.fiscal_year);

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
    attachments = [],
    items = []
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
  
  // Validate budget before resubmit (skip only for budget proposals/revisions)
  const targetDeptId = req.body?.department_id || request.department_id;
  const requestType = request.request_type || 'reimbursement';
  const shouldBypassBudget = requestType === 'budget_request' || requestType === 'budget_revision';

  if (targetDeptId && !shouldBypassBudget) {
    // Validate against category/sub-category remaining amounts instead of department annual budget
    const { data: requestItems, error: itemsError } = await supabase
      .from('request_items')
      .select('id, category_id, amount')
      .eq('request_id', id);

    const itemsForValidation = (requestItems || []).map((ri: any) => ({ category_id: ri.category_id, amount: ri.amount }));

    const categoryValidationError = await validateCategoryBudgetsForSubmission(
      targetDeptId,
      request.fiscal_year,
      newAmount,
      request.category_id,
      request.category,
      itemsForValidation
    );

    if (categoryValidationError) {
      return res.status(400).json({ error: categoryValidationError });
    }
  }

  // Supervisor/accounting submitters bypass supervisor stage on resubmit
  const resubmitStatus = (req.user.role === 'supervisor' || req.user.role === 'accounting') ? 'pending_accounting' : 'pending_supervisor';

  // Build updated metadata if items or category changed
  const existingMetadata = (typeof request.metadata === 'object' ? request.metadata : {}) || {};
  const updatedMetadata: Record<string, any> = {
    ...existingMetadata,
    items: Array.isArray(items) && items.length > 0
      ? items.map((item: any) => ({
          item_name: toText(item.description || item.item_name || ''),
          amount: toNumber(item.amount),
          category_id: item.category_id || item.categoryId || null,
          category: toText(item.category || '') || undefined
        }))
      : existingMetadata.items || [],
    main_category: normalizedCategory || existingMetadata.main_category || request.category
  };

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
      metadata: updatedMetadata,
      submitted_at: new Date(),
      returned_by: null,
      returned_at: null,
      return_reason: null,
      co_approved_by: null,
      co_approved_at: null,
      co_approver_role: null,
      revision_count: Number(request.revision_count || 0) + 1,
      updated_at: new Date()
    })
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(400).json({ error });

  // Update individual items if provided (multi-item revision)
  if (Array.isArray(items) && items.length > 0) {
    const { data: existingItems } = await supabase
      .from('request_items')
      .select('id, category_id, amount')
      .eq('request_id', id)
      .order('created_at', { ascending: true });
    
    const existingItemIds = (existingItems || []).map((item: any) => item.id);
    
    // Update each existing item with new amounts, category, and name
    for (let i = 0; i < items.length && i < existingItemIds.length; i++) {
      const item = items[i];
      const itemAmount = toNumber(item.amount);
      const itemName = toText(item.description || item.item_name || '');
      const itemCategoryId = item.category_id || item.categoryId || null;
      
      await supabase
        .from('request_items')
        .update({
          item_name: itemName,
          amount: itemAmount,
          category_id: itemCategoryId
        })
        .eq('id', existingItemIds[i])
        .then(({ error: updateErr }) => {
          if (updateErr) console.error(`[resubmit] Failed to update item ${existingItemIds[i]}:`, updateErr);
        });
    }
    
    // If more items provided than existing, insert new ones
    if (items.length > existingItemIds.length) {
      const newItems = items.slice(existingItemIds.length).map((item: any) => ({
        request_id: id,
        item_name: toText(item.description || item.item_name || ''),
        amount: toNumber(item.amount),
        category_id: item.category_id || item.categoryId || null
      }));
      
      await supabase.from('request_items').insert(newItems);
    }
    
    // If fewer items provided than existing, delete the extra ones
    if (items.length < existingItemIds.length) {
      const idsToDelete = existingItemIds.slice(items.length);
      await supabase
        .from('request_items')
        .delete()
        .in('id', idsToDelete);
    }
  }

  // Update allocation if amount or department changes
  const allocationAmount = normalizedAmount !== undefined && normalizedAmount !== null ? normalizedAmount : request.amount;
  const effectiveDepartmentId = req.body?.department_id || request.department_id;
  await supabase
    .from('request_allocations')
    .update({ 
      amount: allocationAmount,
      department_id: effectiveDepartmentId,
      updated_at: new Date() 
    })
    .eq('request_id', id);

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
  // First, release the OLD budget commitments, then apply new ones
  const { data: oldItems } = await supabase
    .from('request_items').select('id, category_id, amount').eq('request_id', id);

  // Release old commitments for multi-item requests
  if (oldItems && oldItems.length > 0) {
    for (const oldItem of oldItems) {
      if (!oldItem.category_id) continue;
      const oldItemAmt = toNumber(oldItem.amount);
      const { data: oldCatBudget } = await supabase.from('budget_categories').select('committed_amount, remaining_amount').eq('id', oldItem.category_id).single();
      if (oldCatBudget) {
        await supabase.from('budget_categories').update({
          committed_amount: Math.max(0, toNumber(oldCatBudget.committed_amount) - oldItemAmt),
          remaining_amount: toNumber(oldCatBudget.remaining_amount) + oldItemAmt,
          updated_at: new Date()
        }).eq('id', oldItem.category_id);
      }
    }
  } else {
    // Release old single-item commitment
    if (request.category_id) {
      const { data: oldCatBudget } = await supabase.from('budget_categories').select('committed_amount, remaining_amount').eq('id', request.category_id).single();
      if (oldCatBudget) {
        const oldAmt = toNumber(request.amount);
        await supabase.from('budget_categories').update({
          committed_amount: Math.max(0, toNumber(oldCatBudget.committed_amount) - oldAmt),
          remaining_amount: toNumber(oldCatBudget.remaining_amount) + oldAmt,
          updated_at: new Date()
        }).eq('id', request.category_id);
      }
    }
  }

  // Now apply NEW commitments based on updated items
  const { data: resubmitItems } = await supabase
    .from('request_items').select('id, category_id, amount').eq('request_id', id);

  if (resubmitItems && resubmitItems.length > 0) {
    // Multi-item: commit each item's category with the updated amount (no scaling needed)
    for (const rItem of resubmitItems) {
      if (!rItem.category_id) continue;
      const itemAmt = toNumber(rItem.amount);
      const { data: catBudget } = await supabase.from('budget_categories').select('committed_amount, remaining_amount').eq('id', rItem.category_id).single();
      if (catBudget) {
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
    const effectiveDeptId = req.body?.department_id || request.department_id;
    const effectiveCategoryId = (await supabase.from('budget_categories').select('id').eq('category_name', String(effectiveCategoryName).trim()).eq('department_id', effectiveDeptId).eq('fiscal_year', request.fiscal_year).maybeSingle()).data?.id;
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

  // Recalculate M88 Manila cost center pending/used amounts
  await updateM88ManilaCostCenterBudget(request.fiscal_year);

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

  // Recalculate M88 Manila cost center pending/used amounts
  await updateM88ManilaCostCenterBudget(request.fiscal_year);

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
  const finalStatus = status === 'verified' ? 'verified' : 'returned';

  const { data, error } = await supabase
    .from('request_liquidations')
    .update({
      status: finalStatus,
      reviewed_at: new Date(),
      reviewed_by: req.user.id,
      remarks: remarks || liquidation.remarks,
      cash_return_status: finalStatus === 'verified' && cashReturn > 0 ? 'pending_return' : null,
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
        `Liquidation verified. Please return ₱${cashReturn.toFixed(2)} in cash to Accounting for ${parentRequest.request_code}.`
      );
      await notifyAccounting(`Cash return pending for ${parentRequest.request_code}: ₱${cashReturn.toFixed(2)} needs to be returned by employee.`);
    }
  }

  // Also update the related cash_advances record if it exists
  const { data: cashAdvance } = await supabase
    .from('cash_advances')
    .select('id')
    .eq('request_id', id)
    .maybeSingle();

  if (cashAdvance) {
    const { error: recomputeError } = await recomputeCashAdvanceBalance(String(cashAdvance.id));
    if (recomputeError) console.error('Cash advance balance recompute error:', recomputeError);
  }

  res.json(data);
});

// PATCH /api/requests/:id/liquidation/confirm-return
router.patch('/:id/liquidation/confirm-return', authenticate, authorize('accounting', 'admin'), async (req: any, res) => {
  try {
    const { id } = req.params;

    const { data: liquidation, error: liquidationError } = await supabase
      .from('request_liquidations')
      .select('*')
      .eq('request_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (liquidationError || !liquidation) {
      return res.status(404).json({ error: 'Liquidation not found.' });
    }

    if (liquidation.cash_return_status !== 'pending_return') {
      return res.status(400).json({ error: 'Cash return is not pending confirmation.' });
    }

    const { data, error } = await supabase
      .from('request_liquidations')
      .update({
        cash_return_status: 'returned',
        cash_returned_at: new Date(),
        cash_returned_confirmed_by: req.user.id,
        updated_at: new Date()
      })
      .eq('id', liquidation.id)
      .select()
      .single();

    if (error) throw error;

    await insertAuditLogs(id, req.user.id, [
      {
        entity_type: 'liquidation',
        action: 'cash_return_confirmed',
        field_name: 'cash_return_status',
        old_value: liquidation.cash_return_status || 'pending_return',
        new_value: 'returned',
        note: 'Accounting confirmed the cash return.'
      }
    ]);

    const { data: parentRequest } = await supabase
      .from('expense_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (parentRequest) {
      await notifyEmployee(
        parentRequest.employee_id,
        parentRequest.request_code,
        'Cash Return Confirmed',
        `Your cash return of ₱${liquidation.cash_return_amount?.toFixed(2) ?? '0.00'} for ${parentRequest.request_code} has been confirmed by Accounting.`
      );
    }

    res.json(data);
  } catch (err: any) {
    console.error('Cash return confirmation error:', err);
    res.status(500).json({ error: err.message || 'Unable to confirm cash return.' });
  }
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

  const approvedRequests = [];
  const failedRequests = [];

  for (const request of requests) {
    try {
      const requestAmount = toNumber(request.amount);
      const nextStatus = requestAmount >= BUDGET_PRESIDENT_THRESHOLD ? 'pending_president' : 'pending_vp';

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

  // Invalidate caches so all dashboards reflect the forwarded proposals immediately
  invalidateCache('/api/departments');
  invalidateCache('/api/budget/categories');

  res.json({
    message: `Bulk approved ${approvedRequests.length} budget proposals`,
    approved: approvedRequests.length,
    failed: failedRequests.length,
    failed_requests: failedRequests
  });
});

const finalizeBudgetBulkApproval = async (
  request: any,
  user: any,
  note: string,
  approverRole: 'vp' | 'president'
) => {
  const { data: updatedRequest, error: updateError } = await supabase
    .from('expense_requests')
    .update({ status: 'approved', updated_at: new Date() })
    .eq('id', request.id)
    .select()
    .single();

  if (updateError) throw updateError;

  await applyApprovedBudgetProposal(request);

  const approverLabel = approverRole === 'vp' ? 'VP' : 'President';
  await supabase.from('approval_logs').insert({
    request_id: request.id,
    actor_id: user.id,
    action: 'approved',
    stage: approverRole,
    note: note || `Bulk approved by ${approverLabel}`,
  });

  await insertAuditLogs(request.id, user.id, [{
    entity_type: 'request',
    action: 'status_changed',
    field_name: 'status',
    old_value: request.status,
    new_value: 'approved',
    note: `${approverLabel} bulk approved budget proposal — matrix locked`,
  }]);

  const budgetAuditAction =
    request.request_type === 'budget_revision'
      ? AUDIT_ACTIONS.BUDGET_REVISED
      : AUDIT_ACTIONS.BUDGET_APPROVED;

  await logAuditEvent({
    user,
    actionType: budgetAuditAction,
    recordType: 'budget',
    recordId: request.category_id || request.id,
    recordLabel: request.request_code,
    oldValue: { status: request.status, amount: request.amount },
    newValue: { status: 'approved', final_approver: approverRole, amount: request.amount },
    remarks: note || `Bulk approved by ${approverLabel}`,
  });

  await logAuditEvent({
    user,
    actionType: AUDIT_ACTIONS.BUDGET_LOCKED,
    recordType: 'budget',
    recordId: request.department_id,
    recordLabel: request.request_code,
    newValue: { locked: true, final_approver: approverRole },
    remarks: `Auto-locked after ${approverLabel} bulk approval`,
  });

  await notifyDepartmentSupervisor(
    request.department_id,
    `Budget ${request.request_type === 'budget_revision' ? 'revision' : 'proposal'} ${request.request_code} has been approved by ${approverLabel}.`
  );
  await notifyAccounting(`Budget ${request.request_code} approved and matrix locked.`);
  await notifyUser(
    request.employee_id,
    'Budget Approved',
    `Your budget ${request.request_type === 'budget_revision' ? 'revision' : 'proposal'} ${request.request_code} has been approved by ${approverLabel}.`
  );

  return updatedRequest;
};

// POST /api/requests/bulk-approve-executive - Bulk review/approve budget proposals by department for VP/President
router.post('/bulk-approve-executive', authenticate, authorize('vp', 'president', 'admin'), async (req: any, res) => {
  const { department_id, note, stage } = req.body;

  if (!department_id) {
    return res.status(400).json({ error: 'Department ID is required' });
  }

  const role = req.user?.role;
  const targetStage = role === 'admin' && (stage === 'vp' || stage === 'president')
    ? stage
    : role === 'president'
      ? 'president'
      : 'vp';
  const targetStatus = targetStage === 'president' ? 'pending_president' : 'pending_vp';
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);

  const { data: requests, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('department_id', department_id)
    .eq('status', targetStatus)
    .in('request_type', ['budget_request', 'budget_revision'])
    .eq('fiscal_year', activeFiscalYear);

  if (fetchError) return res.status(400).json({ error: fetchError });
  if (!requests || requests.length === 0) {
    return res.status(404).json({ error: `No ${targetStatus.replace(/_/g, ' ')} budget proposals found for this department` });
  }

  const approvedRequests = [];
  const failedRequests = [];

  for (const request of requests) {
    try {
      const proposalAmount = toNumber(request.amount);

      if (targetStage === 'vp') {
        if (proposalAmount >= BUDGET_PRESIDENT_THRESHOLD) {
          const { data: updatedRequest, error: updateError } = await supabase
            .from('expense_requests')
            .update({ status: 'pending_president', updated_at: new Date() })
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
            action: 'viewed',
            stage: 'vp',
            note: note || 'Bulk forwarded to President by VP',
          });

          await logAuditEvent({
            user: req.user,
            actionType: AUDIT_ACTIONS.BUDGET_SUBMITTED,
            recordType: 'budget',
            recordId: request.id,
            recordLabel: request.request_code,
            oldValue: { status: request.status, amount: proposalAmount },
            newValue: { status: 'pending_president', final_approver: 'president', amount: proposalAmount },
            remarks: note || 'Bulk forwarded to President (amount at or above threshold)',
          });

          await notifyPresident(`Budget ${request.request_type === 'budget_revision' ? 'revision' : 'proposal'} ${request.request_code} (₱${proposalAmount.toFixed(2)}) is ready for President final approval.`);
          approvedRequests.push(updatedRequest);
        } else {
          const updatedRequest = await finalizeBudgetBulkApproval(request, req.user, note || 'Bulk approved by VP', 'vp');
          approvedRequests.push(updatedRequest);
        }
      } else {
        if (proposalAmount < BUDGET_PRESIDENT_THRESHOLD) {
          failedRequests.push({
            request_code: request.request_code,
            error: 'Budget amount is below threshold and requires VP final approval.',
          });
          continue;
        }

        const updatedRequest = await finalizeBudgetBulkApproval(request, req.user, note || 'Bulk approved by President', 'president');
        approvedRequests.push(updatedRequest);
      }
    } catch (error: any) {
      failedRequests.push({ request_code: request.request_code, error: error.message });
    }
  }

  invalidateCache('/api/departments');
  invalidateCache('/api/budget/categories');
  invalidateCache('/api/budget/summary');
  invalidateCache('/api/budget/monitoring');

  res.json({
    message: `${targetStage === 'vp' ? 'Processed' : 'Approved'} ${approvedRequests.length} budget proposal${approvedRequests.length === 1 ? '' : 's'}`,
    approved: approvedRequests.length,
    failed: failedRequests.length,
    failed_requests: failedRequests
  });
});

// PATCH /api/requests/:id/confirm-allocation - Confirm cost allocation and perform dual deduction
router.patch('/:id/confirm-allocation', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { cost_center_id, budget_category_id, notes } = req.body;
    const requestId = req.params.id;

    if (!cost_center_id || !budget_category_id) {
      return res.status(400).json({ error: 'cost_center_id and budget_category_id are required' });
    }

    // Get request details
    const { data: request, error: requestError } = await supabase
      .from('expense_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (requestError || !request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    if (request.status !== 'pending_accounting') {
      return res.status(400).json({ error: 'Request must be in pending_accounting status' });
    }

    // Verify cost center exists and has sufficient funds
    const { data: costCenter, error: costCenterError } = await supabase
      .from('cost_centers')
      .select('*')
      .eq('id', cost_center_id)
      .eq('is_active', true)
      .single();

    if (costCenterError || !costCenter) {
      return res.status(404).json({ error: 'Cost center not found or inactive' });
    }

    const amount = parseFloat(request.amount);

    if (parseFloat(costCenter.remaining_amount) < amount) {
      return res.status(400).json({ 
        error: 'Insufficient funds in cost center',
        available: costCenter.remaining_amount,
        requested: amount
      });
    }

    // Verify budget category exists and has sufficient funds
    const { data: budgetCategory, error: categoryError } = await supabase
      .from('budget_categories')
      .select('*')
      .eq('id', budget_category_id)
      .single();

    if (categoryError || !budgetCategory) {
      return res.status(404).json({ error: 'Budget category not found' });
    }

    if (parseFloat(budgetCategory.remaining_amount) < amount) {
      return res.status(400).json({ 
        error: 'Insufficient funds in budget category',
        available: budgetCategory.remaining_amount,
        requested: amount
      });
    }

    // Create cost allocation record
    const { data: allocation, error: allocationError } = await supabase
      .from('request_cost_allocations')
      .insert({
        request_id: requestId,
        cost_center_id,
        budget_category_id,
        amount,
        tagged_by: req.user.id,
        notes: notes || null
      })
      .select()
      .single();

    if (allocationError) return res.status(400).json({ error: allocationError.message });

    // Perform dual deduction
    // Deduct from cost center
    const { error: costCenterDeductError } = await supabase
      .from('cost_centers')
      .update({
        used_amount: parseFloat(costCenter.used_amount) + amount,
        remaining_amount: parseFloat(costCenter.remaining_amount) - amount
      })
      .eq('id', cost_center_id);

    if (costCenterDeductError) {
      return res.status(400).json({ error: 'Failed to deduct from cost center: ' + costCenterDeductError.message });
    }

    // Deduct from budget category
    const { error: categoryDeductError } = await supabase
      .from('budget_categories')
      .update({
        used_amount: parseFloat(budgetCategory.used_amount) + amount,
        remaining_amount: parseFloat(budgetCategory.remaining_amount) - amount
      })
      .eq('id', budget_category_id);

    if (categoryDeductError) {
      // Rollback cost center deduction
      await supabase
        .from('cost_centers')
        .update({
          used_amount: parseFloat(costCenter.used_amount),
          remaining_amount: parseFloat(costCenter.remaining_amount)
        })
        .eq('id', cost_center_id);
      
      return res.status(400).json({ error: 'Failed to deduct from budget category: ' + categoryDeductError.message });
    }

    // Mark allocation as confirmed
    const { error: confirmError } = await supabase
      .from('request_cost_allocations')
      .update({
        confirmed_at: new Date().toISOString(),
        confirmed_by: req.user.id
      })
      .eq('id', allocation.id);

    if (confirmError) {
      // Rollback cost center deduction
      await supabase.from('cost_centers').update({
        used_amount: parseFloat(costCenter.used_amount),
        remaining_amount: parseFloat(costCenter.remaining_amount)
      }).eq('id', cost_center_id);
      
      // Rollback budget category deduction
      await supabase.from('budget_categories').update({
        used_amount: parseFloat(budgetCategory.used_amount),
        remaining_amount: parseFloat(budgetCategory.remaining_amount)
      }).eq('id', budget_category_id);
      
      // Delete orphaned allocation record
      await supabase.from('request_cost_allocations')
        .delete()
        .eq('id', allocation.id);
      
      return res.status(400).json({ error: 'Failed to confirm allocation: ' + confirmError.message });
    }

    // Log audit event
    await logAuditEvent({
      user: req.user,
      actionType: AUDIT_ACTIONS.COST_ALLOCATION_CONFIRMED,
      recordType: 'request_cost_allocation',
      recordId: allocation.id,
      recordLabel: request.request_code,
      remarks: `Confirmed dual deduction: ${amount} from cost center ${costCenter.name} and budget category ${budgetCategory.category_name}`
    });

    // Notify accounting team
    await notifyAccounting(`Cost allocation confirmed for request ${request.request_code}. Amount: ${amount}, Cost Center: ${costCenter.name}, Budget Category: ${budgetCategory.category_name}`);

    res.json({ 
      message: 'Allocation confirmed and dual deduction completed successfully',
      allocation_id: allocation.id,
      amount_deducted: amount,
      cost_center_remaining: parseFloat(costCenter.remaining_amount) - amount,
      budget_category_remaining: parseFloat(budgetCategory.remaining_amount) - amount
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Migration endpoint to update existing request items to use sub-categories
router.post('/migrate-to-subcategories', authenticate, authorize('admin', 'accounting'), async (req, res) => {
  try {
    const result = await migrateRequestItemsToSubCategories();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
