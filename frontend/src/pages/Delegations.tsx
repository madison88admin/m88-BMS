import { useEffect, useMemo, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import PageSkeleton from '../components/Skeleton';
import { formatDateTime, getErrorMessage } from '../utils/format';

const Delegations = () => {
  const [user, setUser] = useState<any>(null);
  const [delegations, setDelegations] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [newDelegation, setNewDelegation] = useState({
    delegate_id: '',
    delegated_role: 'vp',
    starts_at: new Date().toISOString().slice(0, 10),
    ends_at: '',
    note: ''
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const allowedRoles = ['super_admin', 'admin', 'vp', 'president'];

  useEffect(() => {
    const load = async () => {
      await fetchUser();
      setLoading(false);
    };
    void load();
  }, []);

  useEffect(() => {
    if (!user) return;
    void fetchDelegations();
    void fetchCandidates();
  }, [user]);

  const fetchUser = async () => {
    try {
      const res = await api.get('/api/auth/me');
      setUser(res.data);
      if (res.data?.role === 'vp' || res.data?.role === 'president') {
        setNewDelegation((current) => ({ ...current, delegated_role: res.data.role }));
      }
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to load user account'));
    }
  };

  const fetchCandidates = async () => {
    try {
      const res = await api.get('/api/auth/delegation-candidates');
      setCandidates(res.data || []);
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to load delegation candidates'));
      setCandidates([]);
    }
  };

  const fetchDelegations = async () => {
    try {
      const res = await api.get('/api/auth/delegations');
      setDelegations(res.data || []);
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to load delegations'));
      setDelegations([]);
    }
  };

  const createDelegation = async () => {
    if (!newDelegation.delegate_id) {
      toast.error('Select a delegate.');
      return;
    }
    if (!newDelegation.starts_at) {
      toast.error('Start date is required.');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/api/auth/delegations', {
        approver_id: user.id,
        delegate_id: newDelegation.delegate_id,
        delegated_role: newDelegation.delegated_role,
        starts_at: newDelegation.starts_at,
        ends_at: newDelegation.ends_at || null,
        note: newDelegation.note.trim() || null
      });
      toast.success('Delegation created successfully.');
      setNewDelegation((current) => ({
        ...current,
        delegate_id: '',
        starts_at: new Date().toISOString().slice(0, 10),
        ends_at: '',
        note: ''
      }));
      await fetchDelegations();
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to create delegation'));
    } finally {
      setSubmitting(false);
    }
  };

  const revokeDelegation = async (delegationId: string) => {
    if (!window.confirm('Are you sure you want to revoke this delegation?')) return;
    try {
      await api.patch(`/api/auth/delegations/${delegationId}`, { active: false });
      toast.success('Delegation revoked.');
      await fetchDelegations();
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to revoke delegation'));
    }
  };

  const activeDelegations = useMemo(() => {
    const now = new Date().toISOString();
    return delegations.filter((delegation) => delegation.active && delegation.starts_at <= now && (!delegation.ends_at || delegation.ends_at >= now));
  }, [delegations]);

  if (loading) {
    return <PageSkeleton />;
  }

  if (!allowedRoles.includes(user?.role)) {
    return (
      <div className="panel text-center py-12">
        <p className="text-[var(--role-text)]/60">You do not have permission to access delegation setup.</p>
      </div>
    );
  }

  return (
    <div className="page-transition text-[var(--role-text)] space-y-6">
      <div className="panel">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Delegation Management</h1>
            <p className="text-sm text-[var(--role-text)]/60">Create and manage active VP/President approval delegations.</p>
          </div>
          <div className="text-sm text-[var(--role-text)]/70">
            Logged in as <span className="font-semibold">{user.name}</span> ({user.role})
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.9fr]">
        <div className="space-y-4">
          <div className="panel">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <p className="text-sm uppercase tracking-[0.18em] text-[var(--role-text)]/50">Active Delegations</p>
                <h2 className="text-lg font-semibold">{activeDelegations.length} active now</h2>
              </div>
              <button className="btn-secondary" onClick={fetchDelegations}>Refresh</button>
            </div>
            {activeDelegations.length === 0 ? (
              <p className="text-[var(--role-text)]/60">No active delegation is currently running.</p>
            ) : (
              <div className="space-y-3">
                {activeDelegations.map((delegation) => (
                  <div key={delegation.id} className="rounded-3xl border border-[var(--role-border)] bg-[var(--role-accent)] p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold">{delegation.delegated_role.toUpperCase()} delegated to {delegation.delegate_name || delegation.delegate_id}</p>
                        <p className="text-sm text-[var(--role-text)]/60">
                          From {formatDateTime(delegation.starts_at)}
                          {delegation.ends_at ? ` through ${formatDateTime(delegation.ends_at)}` : ' (no end date)'}
                        </p>
                      </div>
                      <button
                        className="btn-secondary whitespace-nowrap"
                        onClick={() => revokeDelegation(delegation.id)}
                      >
                        Revoke
                      </button>
                    </div>
                    {delegation.note && (
                      <p className="mt-3 rounded-2xl border border-[var(--role-border)] bg-white/70 p-3 text-sm text-[var(--role-text)]/90">
                        <span className="font-semibold">Note:</span> {delegation.note}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel overflow-x-auto">
            <h3 className="text-lg font-semibold mb-4">Delegation History</h3>
            {delegations.length === 0 ? (
              <p className="text-[var(--role-text)]/60">No delegations have been recorded yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--role-border)] text-[var(--role-text)]/60 uppercase tracking-[0.14em] text-xs">
                  <tr>
                    <th className="py-3 text-left">Approver</th>
                    <th className="py-3 text-left">Delegate</th>
                    <th className="py-3 text-left">Role</th>
                    <th className="py-3 text-left">Start</th>
                    <th className="py-3 text-left">End</th>
                    <th className="py-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--role-border)]">
                  {delegations.map((delegation) => (
                    <tr key={delegation.id}>
                      <td className="py-3">{delegation.approver_name || delegation.approver_id}</td>
                      <td className="py-3">{delegation.delegate_name || delegation.delegate_id}</td>
                      <td className="py-3 capitalize">{delegation.delegated_role}</td>
                      <td className="py-3">{formatDateTime(delegation.starts_at)}</td>
                      <td className="py-3">{delegation.ends_at ? formatDateTime(delegation.ends_at) : 'Open'}</td>
                      <td className="py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${delegation.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                          {delegation.active ? 'Active' : 'Closed'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="panel">
          <h3 className="text-lg font-semibold mb-4">Set Delegation</h3>
          <div className="space-y-4">
            <div>
              <label className="field-label">Delegate</label>
              <select
                className="field-input w-full"
                value={newDelegation.delegate_id}
                onChange={(e) => setNewDelegation((current) => ({ ...current, delegate_id: e.target.value }))}
              >
                <option value="">Select a delegate</option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name} — {candidate.role}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label">Delegated Role</label>
              <select
                className="field-input w-full"
                value={newDelegation.delegated_role}
                disabled={user.role === 'vp' || user.role === 'president'}
                onChange={(e) => setNewDelegation((current) => ({ ...current, delegated_role: e.target.value }))}
              >
                {['supervisor', 'vp', 'president'].map((roleOption) => (
                  <option key={roleOption} value={roleOption}> {roleOption}</option>
                ))}
              </select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label">Starts At</label>
                <input
                  type="date"
                  className="field-input w-full"
                  value={newDelegation.starts_at}
                  onChange={(e) => setNewDelegation((current) => ({ ...current, starts_at: e.target.value }))}
                />
              </div>
              <div>
                <label className="field-label">Ends At</label>
                <input
                  type="date"
                  className="field-input w-full"
                  value={newDelegation.ends_at}
                  onChange={(e) => setNewDelegation((current) => ({ ...current, ends_at: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <label className="field-label">Reason (optional)</label>
              <textarea
                className="field-input h-28"
                value={newDelegation.note}
                onChange={(e) => setNewDelegation((current) => ({ ...current, note: e.target.value }))}
                placeholder="Add a note for the delegate"
              />
            </div>

            <button
              className="btn-primary w-full"
              onClick={createDelegation}
              disabled={submitting}
            >
              {submitting ? 'Saving...' : 'Set Delegation'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Delegations;
