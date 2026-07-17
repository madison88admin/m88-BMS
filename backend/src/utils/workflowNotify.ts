import { supabase } from './supabase';
import { sendEmail } from './email';

export const createInAppNotification = async (userId: string, message: string, link?: string) => {
  try {
    await supabase.from('notifications').insert({
      user_id: userId,
      message,
      link: link || null,
      is_read: false,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Notification insert failed:', err);
  }
};

export const notifyUser = async (userId: string, subject: string, message: string, link?: string) => {
  if (!userId) return;
  await createInAppNotification(userId, message, link);
  const { data: user } = await supabase.from('users').select('email, name').eq('id', userId).maybeSingle();
  if (user?.email) {
    sendEmail(user.email, subject, message).catch((err) => console.error('Email failed:', err?.message));
  }
};

export const notifyUsersByRole = async (roles: string[], message: string, departmentId?: string | null, link?: string) => {
  let query = supabase.from('users').select('id, email, name, role, department_id').in('role', roles);
  if (departmentId) {
    query = query.eq('department_id', departmentId);
  }
  const { data: users } = await query;
  await Promise.all(
    (users || []).map(async (u) => {
      await createInAppNotification(u.id, message, link);
      if (u.email) {
        sendEmail(u.email, 'BMS Notification', message).catch(() => undefined);
      }
    })
  );
};

export const notifyAccounting = async (message: string, link?: string) => notifyUsersByRole(['accounting', 'admin'], message, undefined, link);
export const notifyVp = async (message: string, link?: string) => notifyUsersByRole(['vp', 'admin'], message, undefined, link);
export const notifyPresident = async (message: string, link?: string) => notifyUsersByRole(['president', 'admin'], message, undefined, link);

export const notifyDepartmentSupervisor = async (departmentId: string, message: string, link?: string) => {
  await notifyUsersByRole(['supervisor'], message, departmentId, link);
};

export const checkBudgetUtilizationWarning = async (categoryId: string) => {
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
