import { supabase } from './supabase';

export type ApprovalDelegation = {
  id: string;
  approver_id: string;
  delegate_id: string;
  delegated_role: string;
  starts_at: string;
  ends_at: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

const isMissingTableError = (error: any) => {
  const message = String(error?.message || '');
  return message.includes('relation "approval_delegations" does not exist') || message.includes('approval_delegations') && message.includes('does not exist');
};

export const getActiveDelegationsForUser = async (delegateId: string): Promise<ApprovalDelegation[]> => {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('approval_delegations')
    .select('*')
    .eq('delegate_id', delegateId)
    .eq('active', true)
    .lte('starts_at', now)
    .or(`ends_at.is.null,ends_at.gte.${now}`)
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) {
      return [];
    }
    throw error;
  }

  return data || [];
};

export const getDelegations = async (userId: string, userRole: string): Promise<ApprovalDelegation[]> => {
  const base = supabase.from('approval_delegations').select('*');

  if (userRole === 'super_admin' || userRole === 'admin') {
    const { data, error } = await base.order('created_at', { ascending: false });
    if (error) {
      if (isMissingTableError(error)) {
        return [];
      }
      throw error;
    }
    const ids = Array.from(new Set((data || []).flatMap((row: any) => [row.approver_id, row.delegate_id])));
    const users = ids.length > 0
      ? await supabase.from('users').select('id, name').in('id', ids)
      : { data: [] as any[], error: null };
    const userMap = new Map((users.data || []).map((user: any) => [user.id, user.name]));
    return (data || []).map((delegation: any) => ({
      ...delegation,
      approver_name: userMap.get(delegation.approver_id) || delegation.approver_id,
      delegate_name: userMap.get(delegation.delegate_id) || delegation.delegate_id
    }));
  }

  const { data, error } = await base
    .or(`approver_id.eq.${userId},delegate_id.eq.${userId}`)
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) {
      return [];
    }
    throw error;
  }

  const ids = Array.from(new Set((data || []).flatMap((row: any) => [row.approver_id, row.delegate_id])));
  const users = ids.length > 0
    ? await supabase.from('users').select('id, name').in('id', ids)
    : { data: [] as any[], error: null };
  const userMap = new Map((users.data || []).map((user: any) => [user.id, user.name]));
  return (data || []).map((delegation: any) => ({
    ...delegation,
    approver_name: userMap.get(delegation.approver_id) || delegation.approver_id,
    delegate_name: userMap.get(delegation.delegate_id) || delegation.delegate_id
  }));
};

export const hasActiveDelegationForRoles = async (userId: string, roles: string[]): Promise<boolean> => {
  const delegations = await getActiveDelegationsForUser(userId);
  return delegations.some((delegation) => roles.includes(delegation.delegated_role));
};

export const getActiveDelegationForRoles = async (userId: string, roles: string[]) => {
  const delegations = await getActiveDelegationsForUser(userId);
  return delegations.find((delegation) => roles.includes(delegation.delegated_role)) || null;
};
