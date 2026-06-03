import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';
import PageSkeleton from '../components/Skeleton';
import { formatDateTime, formatActionLabel , getErrorMessage } from '../utils/format';

interface AuditLog {
  id: string;
  request_id?: string;
  request_code?: string;
  record_label?: string;
  item_name?: string;
  request_status?: string;
  action: string;
  action_type?: string;
  actor_name: string;
  user_name?: string;
  actor_role: string;
  user_role?: string;
  department_name?: string;
  stage?: string;
  note?: string;
  remarks?: string;
  entity_type?: string;
  record_type?: string;
  old_value?: string | Record<string, unknown>;
  new_value?: string | Record<string, unknown>;
  created_at: string;
  event_time?: string;
}

interface RequestInfo {
  id: string;
  request_code: string;
  item_name: string;
  status: string;
  employee_name: string;
  department_name: string;
}

const AUDIT_VIEW_ROLES = ['accounting', 'vp', 'president', 'admin', 'super_admin'];
const AUDIT_EXPORT_ROLES = ['accounting', 'vp', 'president', 'admin', 'super_admin'];

const AuditTrail = () => {
  const navigate = useNavigate();
  const { requestId } = useParams();
  
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [requestInfo, setRequestInfo] = useState<RequestInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [userRole, setUserRole] = useState('');
  const logsPerPage = 5;

  useEffect(() => {
    const token = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (!token) {
      navigate('/login');
      return;
    }

    const role = storedUser ? JSON.parse(storedUser).role : '';
    setUserRole(role);

    if (!requestId && role === 'supervisor') {
      toast.error('Audit trail access is restricted to Accounting, VP, and President.');
      navigate('/dashboard');
      return;
    }

    const loadAuditTrail = async () => {
      try {
        if (requestId) {
          const [requestRes, logsRes] = await Promise.all([
            api.get(`/api/requests/${requestId}`, { headers: { Authorization: `Bearer ${token}` } }),
            api.get(`/api/requests/${requestId}/timeline`, { headers: { Authorization: `Bearer ${token}` } })
          ]);
          
          const request = requestRes.data;
          setRequestInfo({
            id: request.id,
            request_code: request.request_code,
            item_name: request.item_name,
            status: request.status,
            employee_name: request.requester_name || request.users?.name || 'Unknown',
            department_name: request.department_name || request.departments?.name || 'Unknown'
          });
          
          setLogs(logsRes.data || []);
        } else {
          const res = await api.get('/api/audit-logs', {
            headers: { Authorization: `Bearer ${token}` }
          });
          setLogs(
            (res.data || []).map((log: any) => ({
              ...log,
              action: log.action_type || log.action,
              actor_name: log.user_name || log.actor_name,
              actor_role: log.user_role || log.actor_role,
              note: log.remarks || log.note,
              request_code: log.record_label,
              created_at: log.created_at || log.event_time,
            }))
          );
        }
      } catch (err: any) {
        if (err.response?.status === 403) {
          toast.error('You do not have permission to view the audit trail.');
          navigate('/dashboard');
          return;
        }
        toast.error(getErrorMessage(err, 'Failed to load audit trail'));
      } finally {
        setLoading(false);
      }
    };

    loadAuditTrail();
  }, [navigate, requestId]);

  const getActionIcon = (action: string) => {
    switch (action.toLowerCase()) {
      case 'submitted':
      case 'budget_proposed':
      case 'budget_submitted':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'approved':
      case 'budget_approved':
      case 'budget_revised':
      case 'co_approved':
      case 'force_approved':
      case 'liquidation_approved':
      case 'cash_advance_approved':
      case 'reimbursement_approved':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'rejected':
      case 'budget_rejected':
      case 'cash_advance_rejected':
      case 'reimbursement_rejected':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      case 'returned':
      case 'returned_for_revision':
      case 'budget_returned_for_revision':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
        );
      default:
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  const getActionColor = (action: string) => {
    const a = action.toLowerCase();
    if (a.includes('reject') || a.includes('failed')) return 'bg-red-500/20 text-red-400 border-red-500/30';
    if (a.includes('return')) return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    if (a.includes('approv') || a.includes('revised') || a.includes('liquidated')) return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    if (a.includes('lock') || a.includes('unlock') || a.includes('updated')) return 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30';
    return 'bg-[var(--role-accent)] text-[var(--role-text)]/70 border-[var(--role-border)]';
  };

  const filteredLogs = logs.filter(log => {
    const actionKey = (log.action_type || log.action || '').toLowerCase();
    const matchesAction = actionFilter === 'all' || actionKey === actionFilter || actionKey.includes(actionFilter);
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = 
      (log.request_code?.toLowerCase() || '').includes(searchLower) ||
      (log.record_label?.toLowerCase() || '').includes(searchLower) ||
      (log.item_name?.toLowerCase() || '').includes(searchLower) ||
      (log.actor_name?.toLowerCase() || '').includes(searchLower) ||
      (log.action?.toLowerCase() || '').includes(searchLower) ||
      (log.note?.toLowerCase() || '').includes(searchLower) ||
      (log.remarks?.toLowerCase() || '').includes(searchLower);
    
    return matchesAction && matchesSearch;
  });

  const totalPages = Math.ceil(filteredLogs.length / logsPerPage);
  const currentLogs = filteredLogs.slice(
    (currentPage - 1) * logsPerPage,
    currentPage * logsPerPage
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [actionFilter, searchQuery]);

  const canExport = AUDIT_EXPORT_ROLES.includes(userRole);

  const downloadExport = async (format: 'csv' | 'pdf') => {
    const token = localStorage.getItem('token');
    try {
      const res = await api.get(`/api/audit-logs/export.${format}`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit_logs.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success(`Audit trail exported as ${format.toUpperCase()}`);
    } catch (err: any) {
      toast.error(getErrorMessage(err, `Failed to export ${format.toUpperCase()}`));
    }
  };

  if (loading) {
    return <PageSkeleton />;
  }

  if (!requestId && !AUDIT_VIEW_ROLES.includes(userRole)) {
    return null;
  }

  return (
    <div className="text-[var(--role-text)] page-transition">
      <div className="page-header">
        <h1 className="page-title">Audit Trail</h1>
        <p className="page-subtitle">
          {requestInfo 
            ? `Complete history for ${requestInfo.request_code}` 
            : 'Immutable system audit log — Accounting, VP, and President only'}
        </p>
      </div>

      {requestInfo && (
        <div className="panel mb-6">
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex-1">
              <p className="text-sm text-[var(--role-text)]/60 mb-1">Request Code</p>
              <p className="text-xl font-bold">{requestInfo.request_code}</p>
            </div>
            <div className="flex-1">
              <p className="text-sm text-[var(--role-text)]/60 mb-1">Item</p>
              <p className="font-medium">{requestInfo.item_name}</p>
            </div>
            <div className="flex-1">
              <p className="text-sm text-[var(--role-text)]/60 mb-1">Employee</p>
              <p className="font-medium">{requestInfo.employee_name}</p>
            </div>
            <div className="flex-1">
              <p className="text-sm text-[var(--role-text)]/60 mb-1">Department</p>
              <p className="font-medium">{requestInfo.department_name}</p>
            </div>
            <div className="flex-1">
              <p className="text-sm text-[var(--role-text)]/60 mb-1">Status</p>
              <span className="inline-flex px-3 py-1 rounded-full text-sm font-medium bg-[var(--role-accent)] border border-[var(--role-border)]">
                {requestInfo.status.replace(/_/g, ' ')}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="panel mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-[var(--role-text)]/60 mb-1">Action Type</label>
            <select
              className="field-input"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
            >
              <option value="all">All Actions</option>
              <option value="budget">Budget Actions</option>
              <option value="cash_advance">Cash Advance</option>
              <option value="reimbursement">Reimbursement</option>
              <option value="failed_approval">Failed Approval</option>
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-[var(--role-text)]/60 mb-1">Search Logs</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search by code, actor, action..."
                className="field-input pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-[var(--role-text)]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
          <p className="text-sm text-[var(--role-text)]/60 self-center mt-6">
            Showing {filteredLogs.length} of {logs.length} entries
          </p>
        </div>
      </div>

      <div className="panel">
        <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
          <svg className="w-5 h-5 text-[var(--role-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Activity Timeline
        </h2>

        {currentLogs.length === 0 ? (
          <div className="text-center py-8 text-[var(--role-text)]/60">
            <p>No audit records found</p>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-[var(--role-border)]"></div>
            <div className="space-y-6">
              {currentLogs.map((log, index) => {
                const actionLabel = log.action_type || log.action;
                const actorName = log.user_name || log.actor_name;
                const actorRole = log.user_role || log.actor_role;
                const note = log.remarks || log.note;
                return (
                <div key={log.id || index} className="relative flex gap-4">
                  <div className={`relative z-10 w-12 h-12 rounded-full flex items-center justify-center border-2 ${getActionColor(actionLabel)}`}>
                    {getActionIcon(actionLabel)}
                  </div>
                  <div className="flex-1 pt-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      {(log.request_code || log.record_label) && (
                        <span className="font-bold text-[var(--role-primary)] text-sm">
                          {log.request_code || log.record_label}
                        </span>
                      )}
                      <span className="font-semibold">{formatActionLabel(actionLabel)}</span>
                      {log.department_name && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--role-accent)] text-[var(--role-text)]/70">
                          {log.department_name}
                        </span>
                      )}
                      <span className="text-sm text-[var(--role-text)]/60 ml-auto">
                        {formatDateTime(log.created_at || log.event_time)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-[var(--role-text)]/70 mb-2">
                      <span className="font-medium text-[var(--role-text)]">{actorName}</span>
                      <span>({actorRole})</span>
                    </div>
                    {(log.old_value || log.new_value) && (
                      <div className="mb-2 text-xs text-[var(--role-text)]/60 font-mono">
                        {typeof log.old_value === 'object' ? JSON.stringify(log.old_value) : log.old_value}
                        {' → '}
                        {typeof log.new_value === 'object' ? JSON.stringify(log.new_value) : log.new_value}
                      </div>
                    )}
                    {note && (
                      <div className="p-3 rounded-xl bg-[var(--role-accent)]/50 border border-[var(--role-border)] text-sm">
                        {note}
                      </div>
                    )}
                  </div>
                </div>
              );})}
            </div>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-4">
          <button onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} disabled={currentPage === 1} className="p-2 rounded-xl border border-[var(--role-border)] bg-[var(--role-accent)] disabled:opacity-30">←</button>
          <span className="text-sm">Page {currentPage} of {totalPages}</span>
          <button onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} disabled={currentPage === totalPages} className="p-2 rounded-xl border border-[var(--role-border)] bg-[var(--role-accent)] disabled:opacity-30">→</button>
        </div>
      )}

      {!requestId && canExport && (
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => void downloadExport('csv')} className="btn-secondary flex items-center gap-2">
            Export CSV
          </button>
          <button onClick={() => void downloadExport('pdf')} className="btn-secondary flex items-center gap-2">
            Export PDF
          </button>
        </div>
      )}
    </div>
  );
};

export default AuditTrail;
