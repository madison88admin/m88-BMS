const { supabase } = require('./utils/supabase');
const { authenticate, authorize } = require('./utils/auth');
const { AUDIT_ACTIONS, logAuditEvent } = require('./utils/auditLog');
const {
  notifyAccounting,
  notifyEmployee,
  notifyDepartmentSupervisor,
} = require('./utils/workflowNotify');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const toNumber = (value) => Number.parseFloat(value ?? 0) || 0;
const toText = (value) => String(value ?? '').trim();
const createLiquidationNumber = (requestCode) => `LIQ-${requestCode}-${Date.now()}`;

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
  const requestId = parts[2];
  const segment = parts[3];
  const subAction = parts[4];
  return { requestId, segment, subAction };
};

const insertAuditLogs = async (requestId, actorId, entries) => {
  if (!entries.length) return;
  await supabase.from('request_audit_logs').insert(
    entries.map((entry) => ({
      request_id: requestId,
      actor_id: actorId,
      entity_type: entry.entity_type,
      action: entry.action,
      field_name: entry.field_name || null,
      old_value: entry.old_value || null,
      new_value: entry.new_value || null,
      note: entry.note || null,
      metadata: entry.metadata || {},
    }))
  );
};

const handleSubmitLiquidation = async (requestId, user, body) => {
  authorize(['employee', 'manager', 'supervisor', 'accounting'])(user);

  const cashAdvanceId = body?.cash_advance_id;
  const amountSpent = toNumber(body?.amount_spent);
  const remarks = toText(body?.remarks);
  const attachments = Array.isArray(body?.attachments) ? body.attachments : [];

  if (!cashAdvanceId) {
    throw Object.assign(new Error('Cash advance selection is required for liquidation.'), { statusCode: 400 });
  }
  if (amountSpent <= 0) {
    throw Object.assign(new Error('Amount spent must be greater than zero.'), { statusCode: 400 });
  }

  const { data: cashAdvance, error: cashAdvanceError } = await supabase
    .from('cash_advances')
    .select('*')
    .eq('id', cashAdvanceId)
    .single();

  if (cashAdvanceError || !cashAdvance) {
    throw Object.assign(new Error('Cash advance not found.'), { statusCode: 400 });
  }

  if (
    cashAdvance.employee_id !== user.id
    && user.role !== 'supervisor'
    && user.role !== 'accounting'
  ) {
    throw Object.assign(new Error('Forbidden: You do not own this cash advance.'), { statusCode: 403 });
  }

  if (cashAdvance.status === 'fully_liquidated') {
    throw Object.assign(new Error('This cash advance is already fully liquidated.'), { statusCode: 400 });
  }

  if (amountSpent > toNumber(cashAdvance.balance)) {
    throw Object.assign(
      new Error(`Amount spent cannot exceed cash advance balance of ${cashAdvance.balance}.`),
      { statusCode: 400 }
    );
  }

  const { data: existingLiquidation } = await supabase
    .from('request_liquidations')
    .select('*')
    .eq('request_id', requestId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const liquidationPayload = {
    status: 'pending_liquidation_review',
    submitted_at: new Date().toISOString(),
    cash_advance_id: cashAdvanceId,
    amount_spent: amountSpent,
    actual_amount: amountSpent,
    reimbursable_amount: Math.max(amountSpent - toNumber(cashAdvance.amount_issued), 0),
    cash_return_amount: Math.max(toNumber(cashAdvance.amount_issued) - amountSpent, 0),
    receipt_count: attachments.length,
    remarks,
    updated_at: new Date().toISOString(),
  };

  let result;
  if (existingLiquidation?.id) {
    result = await supabase
      .from('request_liquidations')
      .update(liquidationPayload)
      .eq('id', existingLiquidation.id)
      .select()
      .single();
  } else {
    result = await supabase
      .from('request_liquidations')
      .insert({
        request_id: requestId,
        liquidation_no: createLiquidationNumber(cashAdvance.advance_code),
        created_by: user.id,
        created_at: new Date().toISOString(),
        ...liquidationPayload,
      })
      .select()
      .single();
  }

  if (result.error) {
    throw Object.assign(new Error(result.error.message || 'Failed to save liquidation.'), { statusCode: 400 });
  }

  if (attachments.length > 0) {
    const { error: attachErr } = await supabase.from('request_attachments').insert(
      attachments.map((att) => ({
        request_id: requestId,
        liquidation_id: result.data.id,
        attachment_scope: 'liquidation',
        attachment_type: 'receipt',
        file_name: att.file_name || `liquidation-receipt-${Date.now()}.png`,
        file_url: att.file_url,
        uploaded_by: user.id,
        uploaded_at: new Date().toISOString(),
      }))
    );
    if (attachErr) console.error('Attachments save error:', attachErr.message);
  }

  try {
    await insertAuditLogs(requestId, user.id, [{
      entity_type: 'liquidation',
      action: 'submitted',
      field_name: 'status',
      old_value: existingLiquidation?.status || 'pending_submission',
      new_value: 'pending_liquidation_review',
      note: remarks || 'Liquidation submitted',
    }]);
    await logAuditEvent({
      user,
      actionType: AUDIT_ACTIONS.CASH_ADVANCE_LIQUIDATED,
      recordType: 'liquidation',
      recordId: result.data.id,
      recordLabel: cashAdvance.advance_code,
      newValue: { amount_spent: amountSpent, status: 'pending_liquidation_review' },
      remarks,
    });
    await notifyAccounting(`Cash advance liquidation submitted for ${cashAdvance.advance_code} — pending review.`);
  } catch (auditErr) {
    console.error('Audit log error during liquidation:', auditErr?.message || auditErr);
  }

  return result.data;
};

const handleReviewLiquidation = async (requestId, user, body) => {
  authorize(['accounting', 'admin'])(user);

  const status = toText(body?.status);
  const remarks = toText(body?.remarks);

  if (!['verified', 'returned'].includes(status)) {
    throw Object.assign(new Error('Liquidation review status must be verified or returned.'), { statusCode: 400 });
  }

  const { data: liquidation, error: liquidationError } = await supabase
    .from('request_liquidations')
    .select('*')
    .eq('request_id', requestId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (liquidationError || !liquidation) {
    throw Object.assign(new Error('Liquidation not found.'), { statusCode: 400 });
  }

  const cashReturn = toNumber(liquidation.cash_return_amount);
  const reimbursable = toNumber(liquidation.reimbursable_amount);
  const finalStatus = status === 'verified' ? 'liquidated' : 'returned';

  const { data, error } = await supabase
    .from('request_liquidations')
    .update({
      status: finalStatus,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
      remarks: remarks || liquidation.remarks,
      updated_at: new Date().toISOString(),
    })
    .eq('id', liquidation.id)
    .select()
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || 'Failed to update liquidation.'), { statusCode: 400 });
  }

  await insertAuditLogs(requestId, user.id, [{
    entity_type: 'liquidation',
    action: status === 'verified' ? 'verified' : 'returned',
    field_name: 'status',
    old_value: liquidation.status,
    new_value: finalStatus,
    note: remarks || undefined,
  }]);

  const { data: parentRequest } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();

  if (status === 'verified') {
    await logAuditEvent({
      user,
      actionType: AUDIT_ACTIONS.CASH_ADVANCE_LIQUIDATED,
      recordType: 'liquidation',
      recordId: liquidation.id,
      recordLabel: parentRequest?.request_code || requestId,
      oldValue: { status: liquidation.status, cash_return: cashReturn, reimbursable },
      newValue: { status: finalStatus },
      remarks: remarks
        || (cashReturn > 0
          ? `Refund due: ₱${cashReturn.toFixed(2)}`
          : reimbursable > 0
            ? `Excess reimbursement: ₱${reimbursable.toFixed(2)}`
            : 'Liquidation verified'),
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
        submitted_at: new Date().toISOString(),
        request_type: 'reimbursement',
        metadata: {
          source: 'liquidation_excess',
          parent_request_id: requestId,
          liquidation_id: liquidation.id,
        },
      });
    }

    if (parentRequest) {
      await supabase
        .from('expense_requests')
        .update({ status: 'closed', updated_at: new Date().toISOString() })
        .eq('id', requestId);

      const requestCode = parentRequest.request_code;
      let completionMessage = `Liquidation for ${requestCode} has been verified and closed.`;

      if (cashReturn > 0) {
        completionMessage = `Liquidation verified for ${requestCode}. Refund of ₱${cashReturn.toFixed(2)} will be processed.`;
      } else if (reimbursable > 0) {
        completionMessage = `Liquidation verified for ${requestCode}. Excess spending generated a reimbursement for ₱${reimbursable.toFixed(2)}.`;
      }

      await notifyEmployee(
        parentRequest.employee_id,
        requestCode,
        'Liquidation Complete',
        completionMessage
      );
      await notifyDepartmentSupervisor(
        parentRequest.department_id,
        completionMessage
      );
    }
  }

  const cashAdvanceQuery = liquidation.cash_advance_id
    ? supabase.from('cash_advances').select('id, balance').eq('id', liquidation.cash_advance_id).maybeSingle()
    : supabase.from('cash_advances').select('id, balance').eq('request_id', requestId).maybeSingle();

  const { data: cashAdvance } = await cashAdvanceQuery;

  if (cashAdvance) {
    let newCAStatus;
    if (status === 'verified') {
      newCAStatus = toNumber(cashAdvance.balance) <= 0 ? 'fully_liquidated' : 'partially_liquidated';
    } else {
      newCAStatus = 'outstanding';
    }
    await supabase
      .from('cash_advances')
      .update({ status: newCAStatus, updated_at: new Date().toISOString() })
      .eq('id', cashAdvance.id);
  }

  return data;
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'PATCH') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const token = event.headers.authorization;
    const user = authenticate(token);
    const { requestId, segment, subAction } = parseRoute(event);
    const body = parseBody(event);

    if (!requestId || segment !== 'liquidation') {
      return json(404, { error: 'Invalid route' });
    }

    let data;
    if (subAction === 'review') {
      data = await handleReviewLiquidation(requestId, user, body);
    } else if (!subAction) {
      data = await handleSubmitLiquidation(requestId, user, body);
    } else {
      return json(404, { error: 'Action not found' });
    }

    return json(200, data);
  } catch (error) {
    const message = error.message || 'Internal server error';
    const statusCode = error.statusCode
      || (message === 'Forbidden' ? 403
        : message.includes('Access denied') || message.includes('Unauthorized') ? 401
          : 500);
    console.error('Liquidation handler error:', error);
    return json(statusCode, { error: message });
  }
};
