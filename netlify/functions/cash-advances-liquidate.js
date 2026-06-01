const { supabase } = require('./utils/supabase');
const { authenticate, authorize } = require('./utils/auth');
const { validateExpense } = require('./utils/expenseValidator');
const { AUDIT_ACTIONS, logAuditEvent } = require('./utils/auditLog');
const { notifyAccounting } = require('./utils/workflowNotify');

const toNumber = (value) => Number.parseFloat(value ?? 0) || 0;
const toText = (value) => String(value ?? '').trim();
const createLiquidationNumber = (requestCode) => `LIQ-${requestCode}-${Date.now()}`;

const validateUUID = (uuid) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

const sanitizeText = (text) => toText(text).replace(/[<>]/g, '').substring(0, 500);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST' && event.httpMethod !== 'PATCH') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const token = event.headers.authorization;
    const user = authenticate(token);
    authorize(['employee', 'manager', 'supervisor', 'accounting'])(user);

    const body = JSON.parse(event.body || '{}');
    const advanceId = body.advance_id || body.cash_advance_id;
    const { items, fiscal_year, remarks, attachments } = body;
    const targetFiscalYear = fiscal_year ? parseInt(fiscal_year, 10) : new Date().getFullYear();

    if (!validateUUID(advanceId)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid cash advance ID' }),
      };
    }

    const { data: cashAdvance, error: advanceError } = await supabase
      .from('cash_advances')
      .select('*, department:departments(id, name)')
      .eq('id', advanceId)
      .eq('fiscal_year', targetFiscalYear)
      .single();

    if (advanceError || !cashAdvance) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Cash advance not found' }),
      };
    }

    if (user.role === 'employee' || user.role === 'manager') {
      if (cashAdvance.employee_id !== user.id) {
        return {
          statusCode: 403,
          body: JSON.stringify({ error: 'You can only liquidate your own cash advances' }),
        };
      }
    }

    if (cashAdvance.status === 'fully_liquidated') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'This cash advance is already fully liquidated.' }),
      };
    }

    if (!cashAdvance.request_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Cash advance is not linked to an expense request.' }),
      };
    }

    const requestId = cashAdvance.request_id;
    const departmentName = cashAdvance.department?.name || 'Unknown';
    let totalLiquidation = toNumber(body.amount_spent);
    const validatedItems = [];

    if (Array.isArray(items) && items.length > 0) {
      totalLiquidation = 0;
      for (const item of items) {
        const { expense_date, category_id, description, amount, receipt_attached } = item;

        if (!expense_date || !description || !amount) {
          return {
            statusCode: 400,
            body: JSON.stringify({ error: 'All liquidation items must have expense_date, description, and amount' }),
          };
        }

        const itemAmount = toNumber(amount);
        if (itemAmount <= 0 || itemAmount > 999999.99) {
          return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Invalid amount in liquidation item' }),
          };
        }

        const expenseDate = new Date(expense_date);
        if (Number.isNaN(expenseDate.getTime()) || expenseDate > new Date()) {
          return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Invalid expense date' }),
          };
        }

        const validation = validateExpense(description, departmentName, 'reimbursement');
        if (!validation.allowed) {
          return {
            statusCode: 400,
            body: JSON.stringify({
              error: `Item "${description}" is not allowed: ${validation.reason}`,
              details: validation,
            }),
          };
        }

        totalLiquidation += itemAmount;
        validatedItems.push({
          cash_advance_id: advanceId,
          expense_date: expenseDate.toISOString(),
          category_id: category_id || null,
          description: sanitizeText(description),
          amount: itemAmount,
          receipt_attached: Boolean(receipt_attached),
          created_at: new Date().toISOString(),
        });
      }
    }

    if (totalLiquidation <= 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Amount spent must be greater than zero.' }),
      };
    }

    const previousSpent = existingLiquidation?.status === 'submitted'
      && existingLiquidation?.cash_advance_id === advanceId
      ? toNumber(existingLiquidation.amount_spent)
      : 0;

    const currentBalance = toNumber(cashAdvance.balance) + previousSpent;
    if (totalLiquidation > currentBalance) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: `Liquidation amount (${totalLiquidation.toFixed(2)}) exceeds cash advance balance (${currentBalance.toFixed(2)})`,
        }),
      };
    }

    const { data: existingLiquidation } = await supabase
      .from('request_liquidations')
      .select('*')
      .eq('request_id', requestId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const receiptCount = Array.isArray(attachments)
      ? attachments.length
      : validatedItems.filter((item) => item.receipt_attached).length;

    const liquidationPayload = {
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      cash_advance_id: advanceId,
      amount_spent: totalLiquidation,
      actual_amount: totalLiquidation,
      reimbursable_amount: Math.max(totalLiquidation - toNumber(cashAdvance.amount_issued), 0),
      cash_return_amount: Math.max(toNumber(cashAdvance.amount_issued) - totalLiquidation, 0),
      receipt_count: receiptCount,
      remarks: sanitizeText(remarks),
      updated_at: new Date().toISOString(),
    };

    let liquidationResult;
    if (existingLiquidation?.id) {
      liquidationResult = await supabase
        .from('request_liquidations')
        .update(liquidationPayload)
        .eq('id', existingLiquidation.id)
        .select()
        .single();
    } else {
      liquidationResult = await supabase
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

    if (liquidationResult.error) throw liquidationResult.error;

    const liquidation = liquidationResult.data;
    let insertedItems = [];

    if (validatedItems.length > 0) {
      const itemsToInsert = validatedItems.map((item) => ({
        ...item,
        liquidation_id: liquidation.id,
      }));

      const { data: liquidationItems, error: itemsError } = await supabase
        .from('liquidation_items')
        .insert(itemsToInsert)
        .select();

      if (itemsError) {
        console.error('liquidation_items insert failed:', itemsError.message);
      } else {
        insertedItems = liquidationItems || [];
      }
    }

    if (Array.isArray(attachments) && attachments.length > 0) {
      const { error: attachErr } = await supabase.from('request_attachments').insert(
        attachments.map((att) => ({
          request_id: requestId,
          liquidation_id: liquidation.id,
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

    await supabase.from('approval_logs').insert({
      request_id: requestId,
      actor_id: user.id,
      action: 'liquidation_submitted',
      stage: 'liquidation',
      note: `Liquidation submitted: ${validatedItems.length || 1} item(s) totaling ₱${totalLiquidation.toFixed(2)}`,
    });

    await logAuditEvent({
      user,
      actionType: AUDIT_ACTIONS.CASH_ADVANCE_LIQUIDATED,
      recordType: 'liquidation',
      recordId: liquidation.id,
      recordLabel: cashAdvance.advance_code,
      newValue: { amount_spent: totalLiquidation, status: 'submitted' },
      remarks: sanitizeText(remarks),
    });

    await notifyAccounting(`Cash advance liquidation submitted for ${cashAdvance.advance_code} — pending review.`);

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        liquidation,
        liquidation_items: insertedItems,
        total_liquidated: totalLiquidation,
        cash_advance_id: advanceId,
        request_id: requestId,
      }),
    };
  } catch (error) {
    console.error('Cash advance liquidation error:', error);
    return {
      statusCode: error.message.includes('Forbidden') ? 403
        : error.message.includes('Access denied') ? 401
          : 500,
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};
