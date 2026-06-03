const { supabase } = require('./utils/supabase');
const { authenticate, authorize } = require('./utils/auth');
const { getPresidentThreshold } = require('./utils/approval');
const { AUDIT_ACTIONS, logAuditEvent, logFailedApprovalAttempt } = require('./utils/auditLog');
const {
  notifyAccounting,
  notifyVp,
  notifyPresident,
  notifyDepartmentSupervisor,
  notifyEmployee,
  checkBudgetUtilizationWarning,
  isBudgetWorkflow,
  notifyPreviousActor,
  resolveRejectAuditAction,
  resolveReturnAuditAction,
} = require('./utils/workflowNotify');
const {
  adjustCategoryReleased,
  applyApprovedBudgetProposal,
  lockCashAdvanceCategory,
  getBudgetProposalAmount,
  requiresPresidentBudgetApproval,
  resolveBudgetApprovalRoute,
  toNumber,
} = require('./utils/budget');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'PATCH, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const json = (statusCode, body) => ({
  statusCode,
  headers: corsHeaders,
  body: JSON.stringify(body),
});

const parseBody = (event) => {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch {
    return {};
  }
};

const parseRoute = (event) => {
  const path = event.path || '';
  const parts = path.split('/').filter(Boolean);
  const action = parts[parts.length - 1];
  const requestId = parts[parts.length - 2];
  return { requestId, action };
};

const insertApprovalLog = async (requestId, actorId, action, stage, note = '') => {
  await supabase.from('approval_logs').insert({
    request_id: requestId,
    actor_id: actorId,
    action,
    stage,
    note,
  });
};

const fetchRequest = async (requestId) => {
  const { data, error } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', requestId)
    .single();
  if (error || !data) throw new Error('Request not found');
  return data;
};

const budgetWorkflowLabel = (requestType) =>
  requestType === 'budget_revision' ? 'revision' : 'proposal';

const handleBudgetFinalApproval = async (request, user, body, approverRole) => {
  const { data, error } = await supabase
    .from('expense_requests')
    .update({ status: 'approved', updated_at: new Date() })
    .eq('id', request.id)
    .select()
    .single();
  if (error) throw error;

  await applyApprovedBudgetProposal(request);

  const approverLabel = approverRole === 'vp' ? 'VP' : 'President';
  await insertApprovalLog(
    request.id,
    user.id,
    'approved',
    approverRole,
    body.note || `${approverLabel} final budget approval`
  );

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
    oldValue: { status: request.status, amount: getBudgetProposalAmount(request) },
    newValue: { status: 'approved', final_approver: approverRole, amount: getBudgetProposalAmount(request) },
    remarks: body.note || `${approverLabel} final approval`,
  });

  await logAuditEvent({
    user,
    actionType: AUDIT_ACTIONS.BUDGET_LOCKED,
    recordType: 'budget',
    recordId: request.department_id,
    recordLabel: request.request_code,
    newValue: { locked: true, final_approver: approverRole },
    remarks: `Auto-locked after ${approverLabel} approval`,
  });

  await notifyDepartmentSupervisor(
    request.department_id,
    `Budget ${budgetWorkflowLabel(request.request_type)} ${request.request_code} has been approved by ${approverLabel}.`
  );
  await notifyAccounting(`Budget ${request.request_code} approved and matrix locked.`);
  await notifyEmployee(
    request.employee_id,
    request.request_code,
    'Budget Approved',
    `Your budget ${budgetWorkflowLabel(request.request_type)} ${request.request_code} has been approved by ${approverLabel}.`
  );

  return data;
};

const handleSupervisorApprove = async (request, user, body) => {
  authorize(['supervisor', 'admin'])(user);

  if (user.role === 'supervisor' && request.department_id !== user.department_id) {
    throw new Error('Forbidden');
  }
  if (request.status !== 'pending_supervisor') {
    throw new Error('Only requests waiting for supervisor approval can be approved here');
  }
  if (request.employee_id === user.id) {
    throw new Error('You cannot approve your own request');
  }

  const { data, error } = await supabase
    .from('expense_requests')
    .update({ status: 'pending_accounting', updated_at: new Date() })
    .eq('id', request.id)
    .select()
    .single();
  if (error) throw error;

  await insertApprovalLog(request.id, user.id, 'approved', 'supervisor', body.note || '');
  await notifyAccounting(`Request ${request.request_code} approved by supervisor — pending accounting review.`);

  return data;
};

const handleAccountingReview = async (request, user, body) => {
  authorize(['accounting', 'admin'])(user);

  if (request.status !== 'pending_accounting') {
    throw new Error('Only requests waiting for accounting approval can be approved here');
  }
  if (request.co_approved_by) {
    throw new Error('Request already cleared for fund release. Use the release action instead.');
  }

  const budgetFlow = isBudgetWorkflow(request.request_type);
  const currency = request.metadata?.currency || 'PHP';
  const proposalAmount = getBudgetProposalAmount(request);
  const nextStatus = budgetFlow
    ? resolveBudgetApprovalRoute(proposalAmount, currency)
    : 'pending_vp';

  const { data, error } = await supabase
    .from('expense_requests')
    .update({ status: nextStatus, updated_at: new Date() })
    .eq('id', request.id)
    .select()
    .single();
  if (error) throw error;

  await insertApprovalLog(request.id, user.id, 'approved', 'accounting', body.note || '');

  if (budgetFlow) {
    const finalApprover = nextStatus === 'pending_president' ? 'president' : 'vp';
    await logAuditEvent({
      user,
      actionType: AUDIT_ACTIONS.BUDGET_SUBMITTED,
      recordType: 'budget',
      recordId: request.id,
      recordLabel: request.request_code,
      oldValue: { status: request.status, amount: proposalAmount },
      newValue: { status: nextStatus, final_approver: finalApprover, amount: proposalAmount },
      remarks: body.note
        || `Accounting approved — routed to ${finalApprover === 'president' ? 'President' : 'VP'} for final approval (₱${proposalAmount.toFixed(2)} per main category)`,
    });

    if (nextStatus === 'pending_president') {
      await notifyPresident(
        `Budget ${budgetWorkflowLabel(request.request_type)} ${request.request_code} (₱${proposalAmount.toFixed(2)}) requires President final approval.`
      );
    } else {
      await notifyVp(
        `Budget ${budgetWorkflowLabel(request.request_type)} ${request.request_code} (₱${proposalAmount.toFixed(2)}) requires VP final approval.`
      );
    }
  } else {
    await notifyVp(`Request ${request.request_code} requires VP review.`);
    await notifyEmployee(
      request.employee_id,
      request.request_code,
      'Request Approved',
      `Your request ${request.request_code} has moved to VP review.`
    );
  }

  return data;
};

const handleVpApprove = async (request, user, body) => {
  authorize(['vp', 'admin'])(user);

  if (request.status !== 'pending_vp') {
    throw new Error('Only requests waiting for VP review can be approved here');
  }

  if (isBudgetWorkflow(request.request_type)) {
    const proposalAmount = getBudgetProposalAmount(request);
    const currency = request.metadata?.currency || 'PHP';

    if (requiresPresidentBudgetApproval(proposalAmount, currency)) {
      await logFailedApprovalAttempt(
        user,
        request.id,
        request.request_code,
        'Budget amount requires President final approval after Accounting review'
      );
      throw new Error(
        'This budget requires President final approval. It should already be pending with the President after Accounting review.'
      );
    }

    return handleBudgetFinalApproval(request, user, body, 'vp');
  }

  const amount = toNumber(request.amount);
  const currency = request.metadata?.currency || 'PHP';
  const presidentThreshold = getPresidentThreshold(currency);

  let nextStatus = 'pending_president';
  let updatePayload = { status: nextStatus, updated_at: new Date() };

  if (amount <= presidentThreshold) {
    nextStatus = 'pending_accounting';
    updatePayload = {
      status: nextStatus,
      co_approved_by: user.id,
      co_approved_at: new Date(),
      co_approver_role: 'vp',
      updated_at: new Date(),
    };
  }

  const { data, error } = await supabase
    .from('expense_requests')
    .update(updatePayload)
    .eq('id', request.id)
    .select()
    .single();
  if (error) throw error;

  await insertApprovalLog(request.id, user.id, 'approved', 'vp', body.note || 'VP approved request');

  await logAuditEvent({
    user,
    actionType: request.request_type === 'cash_advance'
      ? AUDIT_ACTIONS.CASH_ADVANCE_APPROVED
      : AUDIT_ACTIONS.REIMBURSEMENT_APPROVED,
    recordType: 'request',
    recordId: request.id,
    recordLabel: request.request_code,
    oldValue: { status: request.status },
    newValue: { status: nextStatus },
    remarks: amount <= presidentThreshold ? 'VP final approval' : 'Forwarded to President',
  });

  if (amount > presidentThreshold) {
    await notifyPresident(`Request ${request.request_code} requires President approval (amount above threshold).`);
  } else if (request.request_type === 'cash_advance') {
    await notifyEmployee(
      request.employee_id,
      request.request_code,
      'Cash Advance Approved',
      `Your request ${request.request_code} has VP approval and is awaiting fund release.`
    );
    await notifyDepartmentSupervisor(
      request.department_id,
      `Cash advance ${request.request_code} has been approved by VP.`
    );
  } else if (request.request_type === 'reimbursement') {
    await notifyEmployee(
      request.employee_id,
      request.request_code,
      'Reimbursement Approved',
      `Your request ${request.request_code} has VP approval and is awaiting fund release.`
    );
  } else {
    await notifyEmployee(
      request.employee_id,
      request.request_code,
      'Request Approved',
      `Your request ${request.request_code} has VP approval and is awaiting fund release.`
    );
  }

  return data;
};

const handleMarkViewed = async (request, user, body) => {
  authorize(['vp', 'admin'])(user);

  if (!isBudgetWorkflow(request.request_type)) {
    await logFailedApprovalAttempt(user, request.id, request.request_code, 'Mark as Viewed only applies to budget workflows');
    throw new Error('Mark as Viewed applies only to budget proposals and revisions.');
  }
  if (request.status !== 'pending_vp') {
    await logFailedApprovalAttempt(user, request.id, request.request_code, `Invalid status ${request.status} for mark-viewed`);
    throw new Error('Only requests waiting for VP review can be marked as viewed.');
  }

  const proposalAmount = getBudgetProposalAmount(request);
  const currency = request.metadata?.currency || 'PHP';

  if (!requiresPresidentBudgetApproval(proposalAmount, currency)) {
    return handleBudgetFinalApproval(request, user, body, 'vp');
  }

  const { data, error } = await supabase
    .from('expense_requests')
    .update({ status: 'pending_president', updated_at: new Date() })
    .eq('id', request.id)
    .select()
    .single();
  if (error) throw error;

  await insertApprovalLog(request.id, user.id, 'viewed', 'vp', body.note || 'VP marked budget proposal as viewed');

  await logAuditEvent({
    user,
    actionType: AUDIT_ACTIONS.BUDGET_SUBMITTED,
    recordType: 'budget',
    recordId: request.id,
    recordLabel: request.request_code,
    oldValue: { status: 'pending_vp', amount: proposalAmount },
    newValue: { status: 'pending_president', final_approver: 'president', amount: proposalAmount },
    remarks: body.note || 'VP marked as viewed — forwarded to President for final approval',
  });

  await notifyPresident(
    `Budget ${budgetWorkflowLabel(request.request_type)} ${request.request_code} (₱${proposalAmount.toFixed(2)}) is ready for President final approval.`
  );
  await notifyEmployee(
    request.employee_id,
    request.request_code,
    'Budget Update',
    `Your ${budgetWorkflowLabel(request.request_type)} ${request.request_code} has been reviewed by VP and sent to President.`
  );

  return data;
};

const handlePresidentApprove = async (request, user, body) => {
  authorize(['president', 'admin'])(user);

  if (request.status !== 'pending_president') {
    throw new Error('Only requests waiting for President approval can be approved here');
  }

  const isBudgetProposalFlow = isBudgetWorkflow(request.request_type);

  if (isBudgetProposalFlow) {
    const proposalAmount = getBudgetProposalAmount(request);
    const currency = request.metadata?.currency || 'PHP';
    if (!requiresPresidentBudgetApproval(proposalAmount, currency)) {
      throw new Error('This budget requires VP final approval (below threshold).');
    }
    return handleBudgetFinalApproval(request, user, body, 'president');
  }

  const nextStatus = 'pending_accounting';
  const updatePayload = {
    status: nextStatus,
    updated_at: new Date(),
    co_approved_by: user.id,
    co_approved_at: new Date(),
    co_approver_role: 'president',
  };

  const { data, error } = await supabase
    .from('expense_requests')
    .update(updatePayload)
    .eq('id', request.id)
    .select()
    .single();
  if (error) throw error;

  await insertApprovalLog(request.id, user.id, 'approved', 'president', body.note || '');

  await logAuditEvent({
    user,
    actionType: request.request_type === 'cash_advance'
      ? AUDIT_ACTIONS.CASH_ADVANCE_APPROVED
      : AUDIT_ACTIONS.REIMBURSEMENT_APPROVED,
    recordType: 'request',
    recordId: request.id,
    recordLabel: request.request_code,
    oldValue: { status: request.status },
    newValue: { status: nextStatus },
  });

  const notifyMessage = `Your request ${request.request_code} has President approval and is awaiting fund release.`;
  if (request.request_type === 'cash_advance') {
    await notifyEmployee(request.employee_id, request.request_code, 'Cash Advance Approved', notifyMessage);
    await notifyDepartmentSupervisor(
      request.department_id,
      `Cash advance ${request.request_code} approved by President.`
    );
  } else if (request.request_type === 'reimbursement') {
    await notifyEmployee(request.employee_id, request.request_code, 'Reimbursement Approved', notifyMessage);
  } else {
    await notifyEmployee(request.employee_id, request.request_code, 'Request Approved', notifyMessage);
  }
  await notifyAccounting(`Request ${request.request_code} approved by President — ready for fund release.`);

  return data;
};

const handleCoApprove = async (request, user) => {
  authorize(['vp', 'president', 'admin'])(user);

  const amount = toNumber(request.amount);
  const currency = request.metadata?.currency || 'PHP';
  const vpThreshold = getPresidentThreshold(currency);

  if (user.role === 'vp' && amount > vpThreshold) {
    throw new Error(`VP can only approve requests up to ${currency}${vpThreshold.toLocaleString()}. President approval required.`);
  }
  if (request.status !== 'pending_accounting') {
    throw new Error(`Cannot co-approve request with status '${request.status}'. Only 'pending_accounting' requests can be co-approved.`);
  }
  if (request.co_approved_by) {
    throw new Error('Request already co-approved');
  }

  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      co_approved_by: user.id,
      co_approved_at: new Date(),
      co_approver_role: user.role,
      updated_at: new Date(),
    })
    .eq('id', request.id)
    .select()
    .single();
  if (error) throw error;

  return data;
};

const handleRelease = async (request, user, body) => {
  authorize(['accounting', 'admin'])(user);

  if (request.status === 'on_hold') {
    throw new Error('Cannot release request that is On Hold. Remove from hold first.');
  }
  if (request.status !== 'pending_accounting') {
    throw new Error('Only requests waiting for accounting approval can be released here');
  }
  if (!request.co_approved_by) {
    throw new Error('All requests require VP or President co-approval before accounting can release.');
  }
  if (isBudgetWorkflow(request.request_type)) {
    throw new Error('Budget proposals cannot be released as expenses.');
  }

  const { data: dept, error: deptError } = await supabase
    .from('departments')
    .select('*')
    .eq('id', request.department_id)
    .single();
  if (deptError || !dept) throw new Error('Department not found');

  // Department annual budget is not used for release validation; category budgets are enforced separately.
  const releaseMethod = ['cash', 'bank_transfer', 'check', 'petty_cash', 'other'].includes(String(body.release_method || ''))
    ? String(body.release_method)
    : 'other';

  if (releaseMethod === 'petty_cash' && toNumber(dept.petty_cash_balance) < toNumber(request.amount)) {
    throw new Error(`Insufficient petty cash. Balance: ${toNumber(dept.petty_cash_balance).toFixed(2)}`);
  }

  const deptUpdate = {
    used_budget: toNumber(dept.used_budget) + toNumber(request.amount),
    updated_at: new Date(),
  };
  if (releaseMethod === 'petty_cash') {
    deptUpdate.petty_cash_balance = toNumber(dept.petty_cash_balance) - toNumber(request.amount);
  }

  await supabase.from('departments').update(deptUpdate).eq('id', dept.id);

  const categoryResult = await adjustCategoryReleased(request);
  if (categoryResult?.category?.id) {
    await checkBudgetUtilizationWarning(categoryResult.category.id);
  }

  await lockCashAdvanceCategory(request);

  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      status: 'released',
      disbursement_status: 'released',
      release_method: releaseMethod,
      release_reference_no: body.release_reference_no || null,
      release_note: body.release_note || null,
      released_by: user.id,
      released_at: new Date(),
      updated_at: new Date(),
    })
    .eq('id', request.id)
    .select()
    .single();
  if (error) throw error;

  if (request.request_type === 'cash_advance') {
    const { data: existingCashAdvance } = await supabase
      .from('cash_advances')
      .select('id')
      .eq('request_id', request.id)
      .maybeSingle();

    if (!existingCashAdvance) {
      await supabase.from('cash_advances').insert({
        advance_code: `CA-${Date.now()}`,
        request_id: request.id,
        employee_id: request.employee_id,
        department_id: request.department_id,
        amount_issued: toNumber(request.amount),
        balance: toNumber(request.amount),
        amount_liquidated: 0,
        status: 'outstanding',
        purpose: request.purpose || '',
        liquidation_due_at: body.liquidation_due_at ? new Date(body.liquidation_due_at) : null,
        issued_by: user.id,
        issued_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
  }

  await insertApprovalLog(request.id, user.id, 'released', 'finance', body.release_note || `Released via ${releaseMethod}`);
  await notifyEmployee(request.employee_id, request.request_code, 'Request Released', `Your request ${request.request_code} has been released.`);

  return data;
};

const handleReject = async (request, user, body) => {
  authorize(['supervisor', 'accounting', 'vp', 'president', 'admin'])(user);

  if (user.role === 'supervisor' && request.department_id !== user.department_id) {
    throw new Error('Forbidden');
  }

  const reason = body.reason;
  if (!reason) throw new Error('A rejection reason is required');

  const stage = ['vp', 'president'].includes(user.role)
    ? user.role
    : user.role === 'supervisor'
      ? 'supervisor'
      : 'accounting';

  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      status: 'rejected',
      rejection_reason: reason,
      rejection_stage: stage,
      archived: true,
      updated_at: new Date(),
    })
    .eq('id', request.id)
    .select()
    .single();
  if (error) throw error;

  await insertApprovalLog(request.id, user.id, 'rejected', stage, reason);

  await logAuditEvent({
    user,
    actionType: resolveRejectAuditAction(request.request_type),
    recordType: isBudgetWorkflow(request.request_type) ? 'budget' : 'request',
    recordId: request.id,
    recordLabel: request.request_code,
    oldValue: { status: request.status },
    newValue: { status: 'rejected' },
    remarks: reason,
  });

  await notifyPreviousActor(request, `Request ${request.request_code} has been rejected: ${reason}`);

  return data;
};

const handleReturn = async (request, user, body) => {
  authorize(['supervisor', 'accounting', 'vp', 'president', 'admin'])(user);

  if (user.role === 'supervisor' && request.department_id !== user.department_id) {
    throw new Error('Forbidden');
  }
  if (!['pending_supervisor', 'pending_accounting', 'pending_vp', 'pending_president'].includes(request.status)) {
    throw new Error('Only pending requests can be returned for revision.');
  }

  const reason = body.reason;
  if (!reason) throw new Error('A return reason is required');

  const stage = ['vp', 'president'].includes(user.role)
    ? user.role
    : user.role === 'supervisor'
      ? 'supervisor'
      : 'accounting';

  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      status: 'returned_for_revision',
      returned_by: user.id,
      returned_at: new Date(),
      return_reason: reason,
      updated_at: new Date(),
    })
    .eq('id', request.id)
    .select()
    .single();
  if (error) throw error;

  await insertApprovalLog(request.id, user.id, 'returned', stage, reason);

  await logAuditEvent({
    user,
    actionType: resolveReturnAuditAction(request.request_type),
    recordType: isBudgetWorkflow(request.request_type) ? 'budget' : 'request',
    recordId: request.id,
    recordLabel: request.request_code,
    oldValue: { status: request.status },
    newValue: { status: 'returned_for_revision' },
    remarks: reason,
  });

  await notifyPreviousActor(request, `Request ${request.request_code} was returned for revision: ${reason}`);

  return data;
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (!['PATCH', 'POST'].includes(event.httpMethod)) {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const token = event.headers.authorization;
    const user = authenticate(token);
    const { requestId, action } = parseRoute(event);
    const body = parseBody(event);

    if (!requestId || !action) {
      return json(404, { error: 'Invalid route' });
    }

    const request = await fetchRequest(requestId);
    let data;

    switch (action) {
      case 'approve':
        data = await handleSupervisorApprove(request, user, body);
        break;
      case 'approve-accounting':
        data = await handleAccountingReview(request, user, body);
        break;
      case 'approve-vp':
        data = await handleVpApprove(request, user, body);
        break;
      case 'mark-viewed':
        data = await handleMarkViewed(request, user, body);
        break;
      case 'approve-president':
        data = await handlePresidentApprove(request, user, body);
        break;
      case 'co-approve':
        data = await handleCoApprove(request, user);
        break;
      case 'release':
        data = await handleRelease(request, user, body);
        break;
      case 'reject':
        data = await handleReject(request, user, body);
        break;
      case 'return':
        data = await handleReturn(request, user, body);
        break;
      default:
        return json(404, { error: 'Action not found' });
    }

    return json(200, data);
  } catch (error) {
    const message = error.message || 'Internal server error';
    const statusCode = message === 'Forbidden'
      ? 403
      : message === 'Access denied' || message === 'Invalid token'
        ? 401
        : message === 'Request not found'
          ? 404
          : 400;
    return json(statusCode, { error: message });
  }
};
