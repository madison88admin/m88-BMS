import { supabase } from './supabase';

export const AUDIT_ACTIONS = {
  BUDGET_PROPOSED: 'budget_proposed',
  BUDGET_SUBMITTED: 'budget_submitted',
  BUDGET_APPROVED: 'budget_approved',
  BUDGET_REVISED: 'budget_revised',
  BUDGET_REJECTED: 'budget_rejected',
  BUDGET_RETURNED: 'budget_returned_for_revision',
  BUDGET_UNLOCKED: 'budget_unlocked',
  BUDGET_UPDATED: 'budget_updated',
  BUDGET_LOCKED: 'budget_locked',
  BUDGET_REVISION_REQUESTED: 'budget_revision_requested',
  CASH_ADVANCE_SUBMITTED: 'cash_advance_submitted',
  CASH_ADVANCE_APPROVED: 'cash_advance_approved',
  CASH_ADVANCE_REJECTED: 'cash_advance_rejected',
  CASH_ADVANCE_LIQUIDATED: 'cash_advance_liquidated',
  REIMBURSEMENT_SUBMITTED: 'reimbursement_submitted',
  REIMBURSEMENT_APPROVED: 'reimbursement_approved',
  REIMBURSEMENT_REJECTED: 'reimbursement_rejected',
  FAILED_APPROVAL_ATTEMPT: 'failed_approval_attempt',
} as const;

export type AuditActionType = typeof AUDIT_ACTIONS[keyof typeof AUDIT_ACTIONS];

export interface AuditLogInput {
  user: { id?: string; role?: string; department_id?: string | null; name?: string };
  actionType: AuditActionType | string;
  recordType?: string;
  recordId?: string | null;
  recordLabel?: string;
  oldValue?: unknown;
  newValue?: unknown;
  remarks?: string;
}

const resolveActorProfile = async (user: AuditLogInput['user']) => {
  if (!user?.id) {
    return { user_name: user?.name || 'System', user_role: user?.role || 'system', department_id: null, department_name: null };
  }

  const { data } = await supabase
    .from('users')
    .select('id, name, role, department_id, departments(name)')
    .eq('id', user.id)
    .maybeSingle();

  const departmentName = (data as any)?.departments?.name || null;
  return {
    user_name: data?.name || user.name || 'Unknown',
    user_role: data?.role || user.role || 'unknown',
    department_id: data?.department_id || user.department_id || null,
    department_name: departmentName,
  };
};

export const logAuditEvent = async (input: AuditLogInput) => {
  try {
    const profile = await resolveActorProfile(input.user);
    const payload = {
      user_id: input.user.id || null,
      user_name: profile.user_name,
      user_role: profile.user_role,
      department_id: profile.department_id,
      department_name: profile.department_name,
      action_type: input.actionType,
      record_type: input.recordType || null,
      record_id: input.recordId || null,
      record_label: input.recordLabel || null,
      old_value: input.oldValue !== undefined ? input.oldValue : null,
      new_value: input.newValue !== undefined ? input.newValue : null,
      remarks: input.remarks || null,
      created_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('audit_logs').insert(payload);
    if (error) {
      console.error('[audit_logs] insert failed:', error.message);
    }
  } catch (err: any) {
    console.error('[audit_logs] unexpected failure:', err?.message || err);
  }
};

export const logFailedApprovalAttempt = async (
  user: AuditLogInput['user'],
  recordId: string | undefined,
  recordLabel: string,
  reason: string
) => {
  await logAuditEvent({
    user,
    actionType: AUDIT_ACTIONS.FAILED_APPROVAL_ATTEMPT,
    recordType: 'request',
    recordId,
    recordLabel,
    remarks: reason,
  });
};
