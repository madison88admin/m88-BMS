const { supabase } = require('./supabase');
const { sendEmail } = require('./email');

const createInAppNotification = async (userId, message) => {
  try {
    await supabase.from('notifications').insert({
      user_id: userId,
      message,
      is_read: false,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Notification insert failed:', err?.message || err);
  }
};

const notifyUser = async (userId, subject, message) => {
  if (!userId) return;
  await createInAppNotification(userId, message);
  const { data: user } = await supabase.from('users').select('email, name').eq('id', userId).maybeSingle();
  if (user?.email) {
    sendEmail(user.email, subject, message).catch((err) => console.error('Email failed:', err?.message));
  }
};

const notifyUsersByRole = async (roles, message, departmentId = null) => {
  let query = supabase.from('users').select('id, email, name, role, department_id').in('role', roles);
  if (departmentId) query = query.eq('department_id', departmentId);
  const { data: users } = await query;
  await Promise.all(
    (users || []).map(async (u) => {
      await createInAppNotification(u.id, message);
      if (u.email) {
        sendEmail(u.email, 'BMS Notification', message).catch(() => undefined);
      }
    })
  );
};

const notifyAccounting = async (message) => notifyUsersByRole(['accounting', 'admin'], message);
const notifyVp = async (message) => notifyUsersByRole(['vp', 'admin'], message);
const notifyPresident = async (message) => notifyUsersByRole(['president', 'admin'], message);

const notifyDepartmentSupervisor = async (departmentId, message) => {
  await notifyUsersByRole(['supervisor'], message, departmentId);
};

const notifyEmployee = async (employeeId, requestCode, subject, message) => {
  await notifyUser(employeeId, subject, message || `Update for request ${requestCode}.`);
};

const checkBudgetUtilizationWarning = async (categoryId) => {
  const { data: category } = await supabase
    .from('budget_categories')
    .select('id, category_name, budget_amount, used_amount, committed_amount, department_id')
    .eq('id', categoryId)
    .maybeSingle();

  if (!category) return;

  const budget = Number(category.budget_amount || 0);
  if (budget <= 0) return;

  const used = Number(category.used_amount || 0) + Number(category.committed_amount || 0);
  const utilization = (used / budget) * 100;

  if (utilization >= 80) {
    const remaining = Math.max(0, budget - used);
    await notifyDepartmentSupervisor(
      category.department_id,
      `Budget warning: "${category.category_name}" is at ${utilization.toFixed(1)}% utilization (₱${remaining.toFixed(2)} remaining).`
    );
  }
};

const isBudgetWorkflow = (requestType) =>
  requestType === 'budget_request' || requestType === 'budget_revision';

const notifyPreviousActor = async (request, message) => {
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
  await notifyEmployee(request.employee_id, request.request_code, 'Request Update', message);
};

const resolveRejectAuditAction = (requestType) => {
  if (requestType === 'budget_request' || requestType === 'budget_revision') return 'budget_rejected';
  if (requestType === 'cash_advance') return 'cash_advance_rejected';
  return 'reimbursement_rejected';
};

const resolveReturnAuditAction = () => 'budget_returned_for_revision';

module.exports = {
  notifyUser,
  notifyUsersByRole,
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
};
