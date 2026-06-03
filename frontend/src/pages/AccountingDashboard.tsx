import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import PageSkeleton from '../components/Skeleton';
import { formatMoney, formatDateTime, toNumber, formatActionLabel , getErrorMessage } from '../utils/format';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface PettyCashAlert {
  department_id: string;
  department_name: string;
  current_balance: number;
  threshold: number;
  alert_type: 'low' | 'critical';
}

interface ReconciliationItem {
  id: string;
  request_code: string;
  amount: number;
  status: string;
  released_at: string;
  release_method: string;
  release_reference_no: string;
  reconciled: boolean;
  discrepancy_note?: string;
}

interface AuditLog {
  id: string;
  action: string;
  actor_name: string;
  actor_role: string;
  created_at: string;
  details?: string;
  request_code?: string;
}


const AccountingDashboard = () => {
  const [user, setUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'petty_cash' | 'releases' | 'reconciliation' | 'audit' | 'document_uploads'>('overview');
  
  // Overview data
  const [departments, setDepartments] = useState<any[]>([]);
  const [allRequests, setAllRequests] = useState<any[]>([]);
  const [pendingReleases, setPendingReleases] = useState<any[]>([]);
  const [stats, setStats] = useState({
    total_pending: 0,
    total_released_today: 0,
    total_released_this_month: 0,
    petty_cash_alerts: 0,
    on_hold_count: 0,
    pending_document_uploads: 0
  });

  const [documentUploads, setDocumentUploads] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);

  // Petty Cash data
  const [pettyCashAlerts, setPettyCashAlerts] = useState<PettyCashAlert[]>([]);
  const [pettyCashThreshold, setPettyCashThreshold] = useState(5000);
  const [selectedDeptForPetty, setSelectedDeptForPetty] = useState('');
  const [pettyCashHistory, setPettyCashHistory] = useState<any[]>([]);

  // Release Tracking
  const [selectedRequests, setSelectedRequests] = useState<Set<string>>(new Set());
  const [releaseFilter, setReleaseFilter] = useState({
    status: 'all',
    date_from: '',
    date_to: ''
  });

  // Reconciliation
  const [reconciliationItems, setReconciliationItems] = useState<ReconciliationItem[]>([]);
  const [reconciliationFilter, setReconciliationFilter] = useState('all');

  // Audit Trail
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditFilter, setAuditFilter] = useState({
    action: 'all',
    date_from: '',
    date_to: ''
  });

  // Loading states
  const [loading, setLoading] = useState(true);
  const [isBatchReleasing, setIsBatchReleasing] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const fetchUser = async () => {
      try {
        const res = await api.get('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setUser(res.data);
      } catch {
        toast.error('Failed to load user data');
      }
    };

    fetchUser();
    loadAllData();

    // Supabase Realtime — refresh when budget_categories or departments change
    let channel: any;
    if (supabase) {
      channel = supabase
        .channel('accounting-dashboard-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_categories' }, () => {
          void loadAllData();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, () => {
          void loadAllData();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_requests' }, () => {
          void loadAllData();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'document_uploads' }, () => {
          void loadAllData();
        })
        .subscribe();
    }

    return () => {
      if (channel && supabase) void supabase.removeChannel(channel);
    };
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [depts, pending, allReqs, , , uploads] = await Promise.all([
        fetchDepartments(),
        fetchPendingReleases(),
        fetchAllRequests(),
        fetchReconciliationItems(),
        fetchAuditLogs(),
        fetchDocumentUploads(),
      ]);
      computeStats(pending, depts, uploads, allReqs);
      computeNotifications(uploads || [], allReqs || []);
    } catch (err) {
      toast.error('Failed to load accounting data');
    } finally {
      setLoading(false);
    }
  };

  const computeNotifications = (uploads: any[], allReqs: any[]) => {
    // Document uploads awaiting accounting
    const newDocUploads = (uploads || []).filter(u => ['submitted', 'pending_review', 'submitted_to_accounting'].includes(u.status));

    // Reimbursements and cash advances pending accounting
    const reimbursements = (allReqs || []).filter((r: any) => String(r.request_type) === 'reimbursement' && r.status === 'pending_accounting');
    const cashAdvances = (allReqs || []).filter((r: any) => String(r.request_type) === 'cash_advance' && r.status === 'pending_accounting');

    // Liquidations: check latest_liquidation or nested liquidations
    const liquidations = (allReqs || []).filter((r: any) => {
      const latest = r.latest_liquidation || null;
      if (latest && latest.status === 'submitted') return true;
      const anySubmitted = Array.isArray(r.liquidations) && r.liquidations.some((l: any) => l.status === 'submitted');
      return Boolean(anySubmitted);
    });

    const toItems = (rows: any[], type: string) => rows.slice(0, 5).map((r: any) => ({ id: r.id || r.upload_id || r.request_code, title: r.category_name || r.request_code || r.category_code || r.title || (r.description && String(r.description).slice(0, 40)), amount: r.amount || r.amount_issued || r.actual_amount || null, type }));

    setNotifications([
      { key: 'document_uploads', label: 'Document Uploads', count: newDocUploads.length, items: toItems(newDocUploads, 'document_upload') },
      { key: 'reimbursements', label: 'Reimbursements', count: reimbursements.length, items: toItems(reimbursements, 'reimbursement') },
      { key: 'cash_advances', label: 'Cash Advances', count: cashAdvances.length, items: toItems(cashAdvances, 'cash_advance') },
      { key: 'liquidations', label: 'Liquidations', count: liquidations.length, items: toItems(liquidations, 'liquidation') },
    ]);
  };

  const fetchAllRequests = async () => {
    const token = localStorage.getItem('token');
    const res = await api.get('/api/requests', { headers: { Authorization: `Bearer ${token}` } });
    const data = res.data || [];
    setAllRequests(data);
    return data;
  };

  const fetchDepartments = async () => {
    const token = localStorage.getItem('token');
    const res = await api.get('/api/departments', { headers: { Authorization: `Bearer ${token}` } });
    const data = res.data || [];
    setDepartments(data);
    return data;
  };

  const fetchPendingReleases = async () => {
    const token = localStorage.getItem('token');
    const res = await api.get('/api/requests', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = res.data || [];
    setPendingReleases(data);
    return data.filter((r: any) => r.status === 'pending_accounting' || r.status === 'on_hold');
  };

  const fetchDocumentUploads = async () => {
    const token = localStorage.getItem('token');
    const res = await api.get('/api/document-uploads', { headers: { Authorization: `Bearer ${token}` } });
    const data = res.data || [];
    setDocumentUploads(data);
    return data;
  };

  const computeStats = (pending: any[], depts: any[], uploads: any[] = [], allReqs: any[] = []) => {
    const today = new Date().toISOString().slice(0, 10);
    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const alerts = depts.filter(d => toNumber(d.petty_cash_balance) < pettyCashThreshold * 0.5).length;
    setStats({
      total_pending: pending.length,
      total_released_today: allReqs.filter(r => r.status === 'released' && r.released_at?.startsWith(today)).length,
      total_released_this_month: allReqs.filter(r => r.status === 'released' && r.released_at >= firstDayOfMonth).length,
      petty_cash_alerts: alerts,
      on_hold_count: pending.filter(r => r.status === 'on_hold').length,
      pending_document_uploads: uploads.filter((row) => row.status === 'submitted' || row.status === 'pending_review').length,
    });
  };

  const checkPettyCashAlerts = async () => {
    const alerts: PettyCashAlert[] = [];
    departments.forEach(dept => {
      const balance = toNumber(dept.petty_cash_balance);
      if (balance < pettyCashThreshold * 0.2) {
        alerts.push({
          department_id: dept.id,
          department_name: dept.name,
          current_balance: balance,
          threshold: pettyCashThreshold,
          alert_type: 'critical'
        });
      } else if (balance < pettyCashThreshold * 0.5) {
        alerts.push({
          department_id: dept.id,
          department_name: dept.name,
          current_balance: balance,
          threshold: pettyCashThreshold,
          alert_type: 'low'
        });
      }
    });
    setPettyCashAlerts(alerts);
  };

  const fetchPettyCashHistory = async (deptId: string) => {
    if (!deptId) return;
    const token = localStorage.getItem('token');
    try {
      const res = await api.get(`/api/petty-cash/${deptId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setPettyCashHistory(res.data || []);
    } catch {
      toast.error('Failed to load petty cash history');
    }
  };

  const fetchReconciliationItems = async () => {
    const token = localStorage.getItem('token');
    const res = await api.get('/api/requests', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const items: ReconciliationItem[] = (res.data || [])
      .filter((req: any) => req.status === 'released')
      .map((req: any) => ({
        id: req.id,
        request_code: req.request_code,
        amount: toNumber(req.amount),
        status: req.status,
        released_at: req.released_at,
        release_method: req.release_method,
        release_reference_no: req.release_reference_no,
        reconciled: req.reconciled || false,
        discrepancy_note: req.discrepancy_note
      }));
    
    setReconciliationItems(items);
  };

  const fetchAuditLogs = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await api.get('/api/requests/audit-logs', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAuditLogs(res.data || []);
    } catch {
      // Audit logs endpoint might not exist yet
      setAuditLogs([]);
    }
  };

  const handleBatchRelease = async () => {
    if (selectedRequests.size === 0) {
      toast.error('Select at least one request to release');
      return;
    }

    // Filter out on-hold requests and requests without VP/President co-approval
    const selectedArray = Array.from(selectedRequests);
    const onHoldCount = selectedArray.filter(id => pendingReleases.find(r => r.id === id)?.status === 'on_hold').length;
    const noApprovalCount = selectedArray.filter(id => !pendingReleases.find(r => r.id === id)?.co_approved_by).length;
    const eligibleRequests = selectedArray.filter(id => {
      const req = pendingReleases.find(r => r.id === id);
      return req?.status !== 'on_hold' && req?.co_approved_by;
    });
    
    if (eligibleRequests.length === 0) {
      if (onHoldCount > 0 && noApprovalCount > 0) {
        toast.error('Selected requests are either On Hold or lack VP/President approval');
      } else if (onHoldCount > 0) {
        toast.error('Selected requests are On Hold and cannot be released');
      } else {
        toast.error('Selected requests require VP/President approval before release');
      }
      return;
    }
    
    if (onHoldCount > 0) {
      toast(`${onHoldCount} on-hold request(s) will be skipped`);
    }
    if (noApprovalCount > 0) {
      toast(`${noApprovalCount} request(s) without VP/President approval will be skipped`);
    }

    setIsBatchReleasing(true);
    const token = localStorage.getItem('token');
    const requestsToRelease = eligibleRequests;
    
    try {
      for (const requestId of requestsToRelease) {
        await api.patch(
          `/api/requests/${requestId}/release`,
          { release_method: 'bank_transfer', release_reference_no: `BATCH-${Date.now()}` },
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }
      
      toast.success(`Released ${requestsToRelease.length} requests successfully!`);
      setSelectedRequests(new Set());
      loadAllData();
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to batch release'));
    } finally {
      setIsBatchReleasing(false);
    }
  };

  const toggleOnHold = async (requestId: string) => {
    const token = localStorage.getItem('token');
    try {
      const res = await api.patch(`/api/requests/${requestId}/hold`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const newStatus = res.data.status;
      toast.success(newStatus === 'on_hold' ? 'Request placed On Hold' : 'Request removed from On Hold');
      loadAllData(); // Refresh all data
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to toggle hold status'));
    }
  };

  const toggleRequestSelection = (id: string) => {
    setSelectedRequests(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const markReconciled = async (requestId: string, reconciled: boolean, note?: string) => {
    const token = localStorage.getItem('token');
    try {
      await api.patch(
        `/api/requests/${requestId}/reconcile`,
        { reconciled, discrepancy_note: note },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.success(reconciled ? 'Marked as reconciled' : 'Reconciliation removed');
      fetchReconciliationItems();
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to update reconciliation'));
    }
  };

  const exportAuditLog = () => {
    const filtered = auditLogs.filter(log => {
      if (auditFilter.action !== 'all' && log.action !== auditFilter.action) return false;
      if (auditFilter.date_from && log.created_at < auditFilter.date_from) return false;
      if (auditFilter.date_to && log.created_at > auditFilter.date_to) return false;
      return true;
    });

    const doc = new jsPDF();
    doc.text('Audit Trail Report', 14, 20);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 30);
    
    autoTable(doc, {
      startY: 40,
      head: [['Date', 'Action', 'User', 'Role', 'Details']],
      body: filtered.map(log => [
        formatDateTime(log.created_at),
        log.action,
        log.actor_name,
        log.actor_role,
        log.details || '-'
      ]),
      headStyles: { fillColor: [49, 72, 122] }
    });
    
    doc.save(`Audit_Trail_${new Date().toISOString().slice(0,10)}.pdf`);
    toast.success('Audit log exported!');
  };

  const filteredReleases = useMemo(() => {
    const accountingStatuses = ['pending_accounting', 'on_hold', 'released'];
    return pendingReleases.filter(req => {
      // Only show requests relevant to accounting
      if (!accountingStatuses.includes(req.status)) return false;

      if (releaseFilter.status !== 'all' && req.status !== releaseFilter.status) return false;

      // Use released_at for released requests, submitted_at otherwise
      const dateRef = req.status === 'released' ? req.released_at : req.submitted_at;
      if (releaseFilter.date_from && dateRef < releaseFilter.date_from) return false;
      if (releaseFilter.date_to && dateRef > releaseFilter.date_to) return false;
      return true;
    });
  }, [pendingReleases, releaseFilter]);

  const filteredReconciliation = useMemo(() => {
    if (reconciliationFilter === 'all') return reconciliationItems;
    if (reconciliationFilter === 'reconciled') return reconciliationItems.filter(r => r.reconciled);
    if (reconciliationFilter === 'unreconciled') return reconciliationItems.filter(r => !r.reconciled);
    return reconciliationItems;
  }, [reconciliationItems, reconciliationFilter]);

  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter(log => {
      if (auditFilter.action !== 'all' && log.action !== auditFilter.action) return false;
      if (auditFilter.date_from && log.created_at < auditFilter.date_from) return false;
      if (auditFilter.date_to && log.created_at > auditFilter.date_to) return false;
      return true;
    });
  }, [auditLogs, auditFilter]);

  if (user?.role !== 'accounting' && user?.role !== 'admin') {
    return (
      <div className="panel text-center py-12">
        <p className="text-[var(--role-text)]/60">This page is only accessible to Accounting and Admin users.</p>
      </div>
    );
  }

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="text-[var(--role-text)] page-transition">
      {/* Tab Navigation */}
      <div className="mb-6 flex flex-wrap gap-2">
        {[
          { key: 'overview', label: 'Overview', icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
          )},
          { key: 'petty_cash', label: 'Petty Cash', icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          )},
          { key: 'audit', label: 'Audit Trail', icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
          )},
          { key: 'document_uploads', label: `Document Uploads${stats.pending_document_uploads > 0 ? ` (${stats.pending_document_uploads})` : ''}`, icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
          )}
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`btn-secondary flex items-center ${activeTab === tab.key ? 'bg-[var(--role-accent)] border-[var(--role-secondary)]' : ''}`}
          >
            <span className="mr-2">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (() => {
        const currentFY = new Date().getFullYear();
        const fyDepts = departments.filter(d => Number(d.fiscal_year) === currentFY && !/^m88/i.test(d.name || ''));
        return (
        <div className="space-y-6 animate-fade-in-up">
          {/* Summary Stats */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <div className="panel !p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--role-text)]/50">Active Tickets</p>
              <p className="mt-2 text-3xl font-bold text-[var(--role-text)]">{allRequests.filter(r => !['released', 'rejected'].includes(r.status)).length}</p>
              <p className="mt-1 text-xs text-[var(--role-text)]/50">In pipeline right now</p>
            </div>
            <div className="panel !p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--role-text)]/50">For Disbursement</p>
              <p className={`mt-2 text-3xl font-bold ${stats.total_pending > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{stats.total_pending}</p>
              <p className="mt-1 text-xs text-[var(--role-text)]/50">Awaiting your release</p>
            </div>
            <div className="panel !p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--role-text)]/50">Released This Month</p>
              <p className="mt-2 text-3xl font-bold text-[var(--role-primary)]">{stats.total_released_this_month}</p>
              <p className="mt-1 text-xs text-[var(--role-text)]/50">Processed disbursements</p>
            </div>
            <div className="panel !p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--role-text)]/50">Document Uploads</p>
              <p className={`mt-2 text-3xl font-bold ${stats.pending_document_uploads > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{stats.pending_document_uploads}</p>
              <p className="mt-1 text-xs text-[var(--role-text)]/50">
                <button type="button" onClick={() => setActiveTab('document_uploads')} className="text-[var(--role-primary)] hover:underline">
                  Pending review
                </button>
              </p>
            </div>
            <div className="panel !p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--role-text)]/50">On Hold</p>
              <p className={`mt-2 text-3xl font-bold ${stats.on_hold_count > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{stats.on_hold_count}</p>
              <p className="mt-1 text-xs text-[var(--role-text)]/50">Temporarily held</p>
            </div>
          </div>

          {/* Notifications Panel */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {notifications.map((n) => {
              const to = n.key === 'document_uploads' ? '/document-uploads' : n.key === 'liquidations' ? '/approvals?view=liquidations' : `/requests?type=${n.key === 'reimbursements' ? 'reimbursement' : 'cash_advance'}`;
              return (
                <div key={n.key} className="panel">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/60">{n.label}</p>
                      <p className="mt-2 text-2xl font-bold text-[var(--role-text)]">{n.count}</p>
                    </div>
                    <Link to={to} className="text-sm text-[var(--role-primary)] hover:underline">View All</Link>
                  </div>

                  <div className="mt-3 space-y-2">
                    {n.items.length === 0 ? (
                      <p className="text-sm text-[var(--role-text)]/60">No new items</p>
                    ) : (
                      n.items.map((it: any) => (
                        <div key={it.id} className="rounded-lg border border-[var(--role-border)] p-2 bg-[var(--role-accent)] text-sm">
                          <Link to={to} className="flex items-center justify-between">
                            <span className="truncate mr-2">{String(it.title || it.id).slice(0, 48)}</span>
                            <span className="font-semibold">{it.amount != null ? formatMoney(toNumber(it.amount)) : ''}</span>
                          </Link>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>


          {/* Department Budget Remaining */}
          <div className="panel">
            <h3 className="text-lg font-bold text-[var(--role-text)] mb-4">Department Budget Remaining — FY {currentFY}</h3>
            {fyDepts.length === 0 ? (
              <p className="text-center py-6 text-sm text-[var(--role-text)]/50">No departments found for FY {currentFY}.</p>
            ) : (
              <div className="space-y-3">
                {fyDepts.map(dept => {
                  const annual = toNumber(dept.annual_budget);
                  const used = toNumber(dept.used_budget);
                  const remaining = Math.max(0, annual - used);
                  const pct = annual > 0 ? Math.min(100, (used / annual) * 100) : 0;
                  const isCritical = pct >= 90;
                  const isHigh = pct >= 70;
                  return (
                    <div key={dept.id} className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)] p-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-semibold text-sm text-[var(--role-text)]">{dept.name}</p>
                        <div className="flex items-center gap-3">
                          <span className={`text-xs font-semibold ${isCritical ? 'text-red-600' : isHigh ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {pct.toFixed(1)}% used
                          </span>
                          <span className="text-sm font-bold text-[var(--role-text)]">{formatMoney(remaining)} left</span>
                        </div>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[var(--role-border)]">
                        <div
                          className={`h-full rounded-full transition-all ${isCritical ? 'bg-red-500' : isHigh ? 'bg-amber-500' : 'bg-emerald-500'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="mt-1.5 flex justify-between text-xs text-[var(--role-text)]/50">
                        <span>Used: {formatMoney(used)}</span>
                        <span>Total: {formatMoney(annual)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        );
      })()}

      {/* PETTY CASH TAB */}
      {activeTab === 'petty_cash' && (
        <div className="space-y-6 animate-fade-in-up">
          {/* Alerts Section */}
          {pettyCashAlerts.length > 0 && (
            <div className="rounded-[24px] border border-amber-300/30 bg-amber-500/10 p-4">
              <h3 className="text-lg font-semibold text-amber-800 mb-3">⚠️ Petty Cash Alerts</h3>
              <div className="space-y-2">
                {pettyCashAlerts.map(alert => (
                  <div key={alert.department_id} className="flex items-center justify-between p-3 rounded-xl bg-white/50">
                    <div>
                      <p className="font-medium">{alert.department_name}</p>
                      <p className="text-sm text-amber-700">
                        Balance: {formatMoney(alert.current_balance)} (Below {alert.alert_type === 'critical' ? '20%' : '50%'} of threshold)
                      </p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      alert.alert_type === 'critical' 
                        ? 'bg-red-100 text-red-700' 
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      {alert.alert_type === 'critical' ? 'CRITICAL' : 'LOW'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Petty Cash Management */}
          <div className="panel">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
              <div>
                <h3 className="text-lg font-semibold">Petty Cash History</h3>
                <p className="text-sm text-[var(--role-text)]/60">View transactions by department</p>
              </div>
              <div className="flex gap-3">
                <select 
                  className="field-input w-auto"
                  value={selectedDeptForPetty}
                  onChange={(e) => {
                    setSelectedDeptForPetty(e.target.value);
                    fetchPettyCashHistory(e.target.value);
                  }}
                >
                  <option value="">Select Department</option>
                  {departments
                    .filter(dept => Number(dept.fiscal_year) === new Date().getFullYear())
                    .map(dept => (
                      <option key={dept.id} value={dept.id}>{dept.name}</option>
                    ))}
                </select>
                <button 
                  onClick={() => selectedDeptForPetty && fetchPettyCashHistory(selectedDeptForPetty)}
                  className="btn-secondary"
                >
                  Refresh
                </button>
              </div>
            </div>

            {selectedDeptForPetty ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--role-accent)]">
                  <p className="font-medium">Current Balance</p>
                  <p className="text-2xl font-bold">
                    {formatMoney(toNumber(departments.find(d => d.id === selectedDeptForPetty)?.petty_cash_balance))}
                  </p>
                </div>

                {pettyCashHistory.length === 0 ? (
                  <p className="text-[var(--role-text)]/60 text-center py-8">No petty cash transactions found.</p>
                ) : (
                  <div className="space-y-2">
                    {pettyCashHistory.map((tx: any) => (
                      <div key={tx.id} className="flex items-center justify-between p-3 rounded-xl border border-[var(--role-border)]">
                        <div className="flex items-center gap-3">
                          <span className={`w-2 h-2 rounded-full ${tx.type === 'replenishment' ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                          <div>
                            <p className="font-medium capitalize">{tx.type}</p>
                            <p className="text-sm text-[var(--role-text)]/60">{tx.purpose}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-semibold ${tx.type === 'replenishment' ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {tx.type === 'replenishment' ? '+' : '-'}{formatMoney(toNumber(tx.amount))}
                          </p>
                          <p className="text-xs text-[var(--role-text)]/60">{formatDateTime(tx.transaction_date)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[var(--role-text)]/60 text-center py-8">Select a department to view petty cash history.</p>
            )}
          </div>

          {/* Petty Cash Settings */}
          <div className="panel">
            <h3 className="text-lg font-semibold mb-4">Alert Settings</h3>
            <div className="flex items-center gap-4">
              <label className="field-label mb-0">Low Balance Threshold:</label>
              <input
                type="number"
                className="field-input w-40"
                value={pettyCashThreshold}
                onChange={(e) => setPettyCashThreshold(Number(e.target.value))}
              />
              <button onClick={checkPettyCashAlerts} className="btn-secondary">
                Update Alerts
              </button>
            </div>
            <p className="text-sm text-[var(--role-text)]/60 mt-2">
              Alerts trigger when balance falls below 50% (warning) or 20% (critical) of this threshold.
            </p>
          </div>
        </div>
      )}

      {/* RELEASES TAB */}
      {activeTab === 'releases' && (
        <div className="space-y-6 animate-fade-in-up">
          {/* Batch Actions */}
          {selectedRequests.size > 0 && (
            <div className="rounded-[24px] border border-[var(--role-primary)]/30 bg-[var(--role-primary)]/10 p-4 flex items-center justify-between">
              <div>
                <p className="font-medium">{selectedRequests.size} requests selected</p>
                <p className="text-sm text-[var(--role-text)]/60">
                  {Array.from(selectedRequests).filter(id => filteredReleases.find(r => r.id === id)?.status !== 'on_hold').length} eligible for release
                  {Array.from(selectedRequests).filter(id => filteredReleases.find(r => r.id === id)?.status === 'on_hold').length > 0 && 
                    ` • ${Array.from(selectedRequests).filter(id => filteredReleases.find(r => r.id === id)?.status === 'on_hold').length} on hold`
                  }
                </p>
              </div>
              <button 
                onClick={handleBatchRelease}
                disabled={isBatchReleasing}
                className="btn-primary"
              >
                {isBatchReleasing ? 'Releasing...' : 'Batch Release Selected'}
              </button>
            </div>
          )}
          
          {/* Select All Toggle */}
          {filteredReleases.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const allIds = filteredReleases.map(r => r.id);
                  const allSelected = allIds.every(id => selectedRequests.has(id));
                  if (allSelected) {
                    // Deselect all
                    setSelectedRequests(prev => {
                      const next = new Set(prev);
                      allIds.forEach(id => next.delete(id));
                      return next;
                    });
                  } else {
                    // Select all
                    setSelectedRequests(prev => {
                      const next = new Set(prev);
                      allIds.forEach(id => next.add(id));
                      return next;
                    });
                  }
                }}
                className="btn-secondary !text-sm"
              >
                {filteredReleases.every(r => selectedRequests.has(r.id)) ? 'Deselect All' : 'Select All'}
              </button>
              <span className="text-sm text-[var(--role-text)]/60">
                {filteredReleases.length} requests visible
              </span>
            </div>
          )}

          {/* Filters */}
          <div className="panel">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="field-label">Status</label>
                <select 
                  className="field-input"
                  value={releaseFilter.status}
                  onChange={(e) => setReleaseFilter(prev => ({ ...prev, status: e.target.value }))}
                >
                  <option value="all">All Status</option>
                  <option value="pending_accounting">Pending Accounting</option>
                  <option value="released">Released</option>
                  <option value="on_hold">On Hold</option>
                </select>
              </div>
              <div>
                <label className="field-label">From Date</label>
                <input 
                  type="date" 
                  className="field-input"
                  value={releaseFilter.date_from}
                  onChange={(e) => setReleaseFilter(prev => ({ ...prev, date_from: e.target.value }))}
                />
              </div>
              <div>
                <label className="field-label">To Date</label>
                <input 
                  type="date" 
                  className="field-input"
                  value={releaseFilter.date_to}
                  onChange={(e) => setReleaseFilter(prev => ({ ...prev, date_to: e.target.value }))}
                />
              </div>
              <button 
                onClick={() => setReleaseFilter({ status: 'all', date_from: '', date_to: '' })}
                className="btn-secondary"
              >
                Reset Filters
              </button>
            </div>
          </div>

          {/* Releases List */}
          <div className="panel">
            <h3 className="text-lg font-semibold mb-4">
              {filteredReleases.length} Requests Found
            </h3>
            {filteredReleases.length === 0 ? (
              <p className="text-[var(--role-text)]/60 text-center py-8">No requests match the current filters.</p>
            ) : (
              <div className="space-y-3">
                {filteredReleases.map(req => (
                  <div key={req.id} className={`flex items-center gap-4 p-4 rounded-xl border ${!req.co_approved_by && req.status === 'pending_accounting' ? 'border-amber-300 bg-amber-50/50' : 'border-[var(--role-border)] bg-[var(--role-accent)]'}`}>
                    <input
                      type="checkbox"
                      checked={selectedRequests.has(req.id)}
                      onChange={() => toggleRequestSelection(req.id)}
                      disabled={req.status === 'on_hold' || !req.co_approved_by}
                      className={`w-5 h-5 rounded border-[var(--role-border)] ${(req.status === 'on_hold' || !req.co_approved_by) ? 'opacity-50 cursor-not-allowed' : ''}`}
                      title={(!req.co_approved_by && req.status === 'pending_accounting') ? 'Requires VP/President approval' : (req.status === 'on_hold' ? 'Request is On Hold' : '')}
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-3 flex-wrap">
                        <p className="font-medium">{req.request_code}</p>
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          req.status === 'on_hold'
                            ? 'bg-amber-100 text-amber-700 border border-amber-300'
                            : req.status === 'pending_accounting' 
                              ? 'bg-amber-50 text-amber-600' 
                              : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {req.status === 'on_hold' ? 'On Hold' : req.status.replace('_', ' ')}
                        </span>
                        {req.status === 'pending_accounting' && (
                          req.co_approved_by ? (
                            <span className="px-2 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-300">
                              VP/President Approved
                            </span>
                          ) : (
                            <span className="px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-300">
                              Awaiting VP/President Approval
                            </span>
                          )
                        )}
                      </div>
                      <p className="text-sm text-[var(--role-text)]/60">{req.item_name}</p>
                    </div>
                    <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="font-semibold">{formatMoney(toNumber(req.amount))}</p>
                      <p className="text-xs text-[var(--role-text)]/60">
                        {req.status === 'on_hold'
                          ? `On Hold since: ${formatDateTime(req.on_hold_at || req.updated_at)}`
                          : req.status === 'pending_accounting' 
                            ? `Submitted: ${formatDateTime(req.submitted_at)}`
                            : `Released: ${formatDateTime(req.released_at)}`
                        }
                      </p>
                    </div>
                    {(req.status === 'pending_accounting' || req.status === 'on_hold') && (
                      <button
                        onClick={() => toggleOnHold(req.id)}
                        className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          req.status === 'on_hold'
                            ? 'bg-amber-100 text-amber-700 border border-amber-300'
                            : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-amber-50'
                        }`}
                        title={req.status === 'on_hold' ? 'Remove from On Hold' : 'Place On Hold'}
                      >
                        {req.status === 'on_hold' ? 'On Hold' : 'Hold'}
                      </button>
                    )}
                  </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* RECONCILIATION TAB */}
      {activeTab === 'reconciliation' && (
        <div className="space-y-6 animate-fade-in-up">
          {/* Filter */}
          <div className="panel">
            <div className="flex items-center gap-4">
              <label className="field-label mb-0">Show:</label>
              <select 
                className="field-input w-auto"
                value={reconciliationFilter}
                onChange={(e) => setReconciliationFilter(e.target.value)}
              >
                <option value="all">All Released</option>
                <option value="reconciled">Reconciled Only</option>
                <option value="unreconciled">Unreconciled Only</option>
              </select>
            </div>
          </div>

          {/* Reconciliation Table */}
          <div className="panel overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-[var(--role-border)]">
                <tr className="text-left text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/60">
                  <th className="pb-3">Request</th>
                  <th className="pb-3">Amount</th>
                  <th className="pb-3">Release Method</th>
                  <th className="pb-3">Reference</th>
                  <th className="pb-3">Released Date</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--role-border)]">
                {filteredReconciliation.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-[var(--role-text)]/60">
                      No released requests found.
                    </td>
                  </tr>
                ) : (
                  filteredReconciliation.map(item => (
                    <tr key={item.id} className="text-sm">
                      <td className="py-3">
                        <p className="font-medium">{item.request_code}</p>
                      </td>
                      <td className="py-3">{formatMoney(item.amount)}</td>
                      <td className="py-3 capitalize">{item.release_method?.replace('_', ' ') || 'N/A'}</td>
                      <td className="py-3">{item.release_reference_no || 'N/A'}</td>
                      <td className="py-3">{formatDateTime(item.released_at)}</td>
                      <td className="py-3">
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          item.reconciled 
                            ? 'bg-emerald-100 text-emerald-700' 
                            : 'bg-amber-100 text-amber-700'
                        }`}>
                          {item.reconciled ? 'Reconciled' : 'Pending'}
                        </span>
                      </td>
                      <td className="py-3">
                        <div className="flex gap-2">
                          {!item.reconciled ? (
                            <button 
                              onClick={() => markReconciled(item.id, true)}
                              className="text-xs btn-success !px-2 !py-1"
                            >
                              Mark Reconciled
                            </button>
                          ) : (
                            <button 
                              onClick={() => markReconciled(item.id, false)}
                              className="text-xs btn-secondary !px-2 !py-1"
                            >
                              Unmark
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* DOCUMENT UPLOADS TAB */}
      {activeTab === 'document_uploads' && (
        <div className="space-y-6 animate-fade-in-up">
          <div className="panel flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-bold text-[var(--role-text)]">Employee Document Uploads</h3>
              <p className="text-sm text-[var(--role-text)]/60">
                Upload-only expense items submitted by employees appear here for accounting review.
              </p>
            </div>
            <Link to="/document-uploads" className="btn-primary whitespace-nowrap">
              Open Full Review Page
            </Link>
          </div>

          <div className="panel overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-[var(--role-border)]">
                <tr className="text-left text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/60">
                  <th className="pb-3 pr-4">Submitted</th>
                  <th className="pb-3 pr-4">Main Category</th>
                  <th className="pb-3 pr-4">Sub-category</th>
                  <th className="pb-3 pr-4">Description</th>
                  <th className="pb-3 pr-4">Amount</th>
                  <th className="pb-3 pr-4">Remaining</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3">Files</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--role-border)]">
                {documentUploads.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-[var(--role-text)]/60">
                      No document uploads yet.
                    </td>
                  </tr>
                ) : (
                  documentUploads.map((upload) => (
                    <tr key={upload.id} className="text-sm">
                      <td className="py-3 pr-4 whitespace-nowrap">{formatDateTime(upload.created_at)}</td>
                      <td className="py-3 pr-4">{upload.main_category_name || '—'}</td>
                      <td className="py-3 pr-4">{upload.category_name || upload.category_code || '—'}</td>
                      <td className="py-3 pr-4 max-w-xs truncate" title={upload.description}>{upload.description}</td>
                      <td className="py-3 pr-4 whitespace-nowrap">{upload.amount != null ? formatMoney(toNumber(upload.amount)) : '—'}</td>
                      <td className="py-3 pr-4 whitespace-nowrap">
                        {upload.current_remaining_amount != null ? (
                          <div className="space-y-1">
                            <div>{formatMoney(toNumber(upload.current_remaining_amount))}</div>
                            <div className="text-[var(--role-text)]/60 text-xs">
                              {toNumber(upload.current_remaining_amount) >= toNumber(upload.amount)
                                ? 'Sufficient'
                                : toNumber(upload.current_remaining_amount) > 0
                                  ? 'Insufficient'
                                  : 'No budget left'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[var(--role-text)]/60">No category budget</span>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          upload.status === 'submitted' || upload.status === 'pending_review'
                            ? 'bg-amber-100 text-amber-700'
                            : upload.status === 'acknowledged'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-gray-100 text-gray-600'
                        }`}>
                          {String(upload.status || 'submitted').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-3">{upload.attachments?.length || 0}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* AUDIT TRAIL TAB */}
      {activeTab === 'audit' && (
        <div className="space-y-6 animate-fade-in-up">
          {/* Filters */}
          <div className="panel">
            <div className="flex flex-wrap gap-4 items-end justify-between">
              <div className="flex flex-wrap gap-4 items-end">
                <div>
                  <label className="field-label">Action Type</label>
                  <select 
                    className="field-input"
                    value={auditFilter.action}
                    onChange={(e) => setAuditFilter(prev => ({ ...prev, action: e.target.value }))}
                  >
                    <option value="all">All Actions</option>
                    <option value="submitted">Submitted</option>
                    <option value="approved">Approved</option>
                    <option value="co_approved">Co-Approved</option>
                    <option value="released">Released</option>
                    <option value="rejected">Rejected</option>
                    <option value="returned">Returned</option>
                    <option value="liquidation_approved">Liquidation Approved</option>
                    <option value="liquidation_rejected">Liquidation Rejected</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">From Date</label>
                  <input 
                    type="date" 
                    className="field-input"
                    value={auditFilter.date_from}
                    onChange={(e) => setAuditFilter(prev => ({ ...prev, date_from: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="field-label">To Date</label>
                  <input 
                    type="date" 
                    className="field-input"
                    value={auditFilter.date_to}
                    onChange={(e) => setAuditFilter(prev => ({ ...prev, date_to: e.target.value }))}
                  />
                </div>
              </div>
              <button onClick={exportAuditLog} className="btn-primary">
                Export to PDF
              </button>
            </div>
          </div>

          {/* Audit Log List */}
          <div className="panel">
            <h3 className="text-lg font-semibold mb-4">Activity Log ({filteredAuditLogs.length} entries)</h3>
            {filteredAuditLogs.length === 0 ? (
              <p className="text-[var(--role-text)]/60 text-center py-8">
                No audit logs available. The audit system may need to be initialized.
              </p>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {filteredAuditLogs.map((log, index) => (
                  <div 
                    key={log.id || index} 
                    className="p-4 rounded-xl border border-[var(--role-border)] bg-[var(--role-accent)] animate-fade-in-up"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-1 rounded bg-[var(--role-primary)]/10 text-[var(--role-primary)] text-xs font-semibold">
                            {formatActionLabel(log.action)}
                          </span>
                          {log.request_code && (
                            <span className="text-sm text-[var(--role-text)]/60">{log.request_code}</span>
                          )}
                        </div>
                        <p className="mt-2 text-sm">{log.details || `${log.action} by ${log.actor_name}`}</p>
                      </div>
                      <div className="text-right text-sm text-[var(--role-text)]/60">
                        <p>{log.actor_name}</p>
                        <p className="text-xs">{log.actor_role}</p>
                        <p className="text-xs mt-1">{formatDateTime(log.created_at)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountingDashboard;
