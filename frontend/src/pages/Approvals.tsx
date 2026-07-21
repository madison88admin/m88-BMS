import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import api from '../api';

import toast from 'react-hot-toast';
import PageSkeleton from '../components/Skeleton';

import Modal from '../components/Modal';

import { supabase } from '../lib/supabase';

import FilePreviewer from '../components/FilePreviewer';

import { formatMoney, toNumber, getStatusLabel, getRequesterName, formatDateTime } from '../utils/format';
import { useExchangeRates } from '../hooks/useExchangeRates';



const DEPT_NAME_MAP: Record<string, string> = {
  'HR Department': 'HR',
  'Admin Department': 'Admin',
  'Finance Department': 'Accounting',
  'IT Department': 'IT'
};

const mapDepartmentNameToShort = (name?: string): string | null => {
  if (!name) return null;
  return DEPT_NAME_MAP[String(name).trim()] || null;
};

const Approvals = () => {

  const [requests, setRequests] = useState<any[]>([]);

  const [user, setUser] = useState<any>(null);

  const [view, setView] = useState<'pending' | 'vp_approval' | 'approved' | 'liquidations' | 'cash_returns' | 'released'>('vp_approval');

  const [departments, setDepartments] = useState<any[]>([]);

  const [budgetCategories, setBudgetCategories] = useState<any[]>([]);

  const [costCenters, setCostCenters] = useState<any[]>([]);

  const [allocationDrafts, setAllocationDrafts] = useState<Record<string, Array<{ department_id: string; amount: string }>>>({});

  const [priorityDrafts, setPriorityDrafts] = useState<Record<string, string>>({});

  const [disbursementDrafts, setDisbursementDrafts] = useState<Record<string, { disbursement_method: string; disbursement_reference_no: string; disbursement_note: string; liquidation_due_at: string }>>({});

  const [costAllocationDrafts, setCostAllocationDrafts] = useState<Record<string, { cost_center_id: string; budget_category_id: string; notes: string }>>({});

  const [expandedRequests, setExpandedRequests] = useState<Record<string, boolean>>({});

  const [expandedSplits, setExpandedSplits] = useState<Record<string, boolean>>({});

  const [savingRequestId, setSavingRequestId] = useState('');

  const [previewFile, setPreviewFile] = useState<{ url: string; name: string } | null>(null);

  const [searchQuery, setSearchQuery] = useState('');

  const [startDate, setStartDate] = useState('');

  const [endDate, setEndDate] = useState('');

  const [statusFilter, setStatusFilter] = useState<string>('all');

  const [departmentFilter, setDepartmentFilter] = useState<string>('all');

  const [requestTypeFilter, setRequestTypeFilter] = useState<string>('all');

  const [priorityFilter, setPriorityFilter] = useState<string>('all');

  const [selectedRequests, setSelectedRequests] = useState<Set<string>>(new Set());

  const [thresholds, setThresholds] = useState<Record<string, { vp: number; president: number }>>({
    PHP: { vp: 30000, president: 500000 },
    USD: { vp: 500, president: 10000 },
    IDR: { vp: 500, president: 10000 }
  });
  const [currentCurrency, setCurrentCurrency] = useState<'PHP' | 'USD' | 'IDR'>('PHP');
  const { rates: fxRates } = useExchangeRates();

  const getSupportedCurrency = (currency?: string): 'PHP' | 'USD' | 'IDR' => {
    if (currency === 'USD' || currency === 'IDR') return currency;
    return 'PHP';
  };

  const convertCurrency = (
    amount: number,
    fromCurrency: 'PHP' | 'USD' | 'IDR',
    toCurrency: 'PHP' | 'USD' | 'IDR'
  ) => {
    if (fromCurrency === toCurrency) return amount;
    const fromRate = fxRates[fromCurrency] ?? 1;
    const toRate = fxRates[toCurrency] ?? 1;
    const phpValue = fromCurrency === 'PHP' ? amount : amount / fromRate;
    return toCurrency === 'PHP' ? phpValue : phpValue * toRate;
  };

  const displayMoney = (amount: number, fromCurrency?: string) => {
    return formatMoney(
      convertCurrency(amount, getSupportedCurrency(fromCurrency), currentCurrency),
      currentCurrency
    );
  };




  // Pagination state

  const [currentPage, setCurrentPage] = useState(1);

  const pageSize = 10;

  const location = useLocation();



  // Action Modal state (Return/Reject/Hold)

  const [modalConfig, setModalConfig] = useState<{

    isOpen: boolean;

    requestId: string;

    type: 'return' | 'reject' | 'on_hold' | 'confirm_allocation';

    title: string;

    message: string;

    placeholder: string;

    confirmLabel: string;

  }>({

    isOpen: false,

    requestId: '',

    type: 'return',

    title: '',

    message: '',

    placeholder: '',

    confirmLabel: ''

  });



  // SLA threshold in hours

  const SLA_HOURS = 24;



  useEffect(() => {
    api.get('/api/config/auth-thresholds')

      .then((res) => {

        if (res.data?.thresholds) {
          setThresholds(res.data.thresholds);
        }

      })

      .catch(() => {

        // keep default

      });



    api.get('/api/auth/me')

      .then((res) => {

        setUser(res.data);

        // Read query string view override if present
        const requestedView = new URLSearchParams(location.search).get('view');
        let initialView: string = view;

        if (requestedView && ['pending', 'vp_approval', 'approved', 'liquidations', 'cash_returns', 'released'].includes(requestedView)) {
          initialView = requestedView;
          setView(requestedView as any);
        } else if (res.data.role === 'accounting' || res.data.role === 'admin' || res.data.role === 'supervisor') {
          initialView = 'pending';
          setView('pending');
        } else if (res.data.role === 'vp' || res.data.role === 'president') {
          initialView = 'vp_approval';
          setView('vp_approval');
        }

        fetchRequests(res.data.role, initialView);

        if (res.data.role === 'accounting' || res.data.role === 'admin' || res.data.role === 'vp' || res.data.role === 'president') {

          fetchDepartments();

        }

      })

      .catch(() => toast.error('Failed to load approval data'));

  }, []);



  useEffect(() => {

    if (!user?.role) return;

    

    fetchRequests(user.role);

    // Fetch cost centers for accounting users
    if (['accounting', 'admin', 'super_admin'].includes(user.role)) {
      api.get('/api/budget/cost-centers')
        .then((res) => setCostCenters(res.data || []))
        .catch((err) => console.error('Failed to fetch cost centers:', err));
    }



    // Supabase Realtime Subscription

    let channel: any;

    if (supabase) {

      channel = supabase

        .channel('approvals-changes')

        .on(

          'postgres_changes',

          { event: '*', schema: 'public', table: 'expense_requests' },

          () => {

            void fetchRequests(user.role);

          }

        )

        .on(

          'postgres_changes',

          { event: '*', schema: 'public', table: 'approval_logs' },

          () => {

            void fetchRequests(user.role);

          }

        )

        .on(

          'postgres_changes',

          { event: '*', schema: 'public', table: 'departments' },

          () => {

            // Refresh departments when budget changes

            if (['accounting', 'admin', 'vp', 'president'].includes(user.role)) {

              void fetchDepartments();
              void fetchRequests(user.role);

            }

          }

        )
        .on(

          'postgres_changes',

          { event: '*', schema: 'public', table: 'budget_categories' },

          () => {

            // Budget category changes also impact VP/President ticket projections

            if (['accounting', 'admin', 'vp', 'president'].includes(user.role)) {

              void fetchDepartments();
              void fetchRequests(user.role);

            }

          }

        )

        .subscribe();

    }



    return () => {

      if (channel && supabase) {

        void supabase.removeChannel(channel);

      }

    };

  }, [user?.role, view]);



  const fetchDepartments = async () => {
    try {

      const [deptRes, catRes] = await Promise.all([
        api.get('/api/departments'),
        api.get('/api/budget/categories?all_years=true')
      ]);

      setDepartments(deptRes.data);
      try {
        const expenseCacheRaw = localStorage.getItem('prefetch_expense_categories');
        const expenseCache = expenseCacheRaw ? JSON.parse(expenseCacheRaw).data : null;
        if (expenseCache && user) {
          const { filterCategoriesForUser } = await import('../utils/budgetVisibility');
          // try to find user's department name
          const deptName = deptRes.data?.find((d: any) => d.id === user.department_id)?.name || '';
          setBudgetCategories(filterCategoriesForUser(catRes.data || [], user, deptName));
        } else {
          setBudgetCategories(catRes.data || []);
        }
      } catch (err) {
        setBudgetCategories(catRes.data || []);
      }

    } catch {

      toast.error('Failed to fetch departments');

    }

  };



  // SLA Tracking - calculate hours in current status

  const calculateSLA = (request: any) => {

    const now = new Date();

    let startTime: Date;

    let stage = '';

    

    if (request.status === 'pending_supervisor' && request.submitted_at) {

      startTime = new Date(request.submitted_at);

      stage = 'Supervisor';

    } else if (request.status === 'pending_accounting' && request.supervisor_approved_at) {

      startTime = new Date(request.supervisor_approved_at);

      stage = 'Accounting';

    } else if (request.status === 'on_hold' && request.on_hold_at) {

      startTime = new Date(request.on_hold_at);

      stage = 'On Hold';

    } else {

      return { hours: 0, stage: '', breached: false };

    }

    

    const hours = Math.floor((now.getTime() - startTime.getTime()) / (1000 * 60 * 60));

    const breached = hours > SLA_HOURS;

    

    return { hours, stage, breached };

  };



  const formatSLA = (hours: number) => {

    if (hours < 1) return `${Math.floor(hours * 60)}m`;

    if (hours < 24) return `${hours}h`;

    return `${Math.floor(hours / 24)}d ${hours % 24}h`;

  };



  // Execute actions directly without signature

  const executeApprove = async (request: any, note?: string) => {
    const requestId = request.id;
    const requestStatus = request.status;
    const requestType = request.request_type;

    if (!request) return;

    if (view === 'liquidations') {

      await handleLiquidationReview(requestId, 'verified');

      return;

    }

    try {
      const isBudgetFlow = requestType === 'budget_request' || requestType === 'budget_revision';

      const role = user?.role;
      const amount = toNumber(request.amount);
      const vpThreshold = thresholds[currentCurrency]?.vp || 500;

      if (role === 'accounting' || role === 'admin' || role === 'super_admin') {
        if (requestStatus === 'pending_accounting' && !request.co_approved_by) {
          await api.patch(
            `/api/requests/${requestId}/approve-accounting`,
            { note }
          );
          if (isBudgetFlow) {
            toast.success('Budget proposal forwarded to VP for review.');
          } else {
            toast.success('Request forwarded to VP approval.');
          }
        } else if (requestStatus === 'pending_accounting' && request.co_approved_by) {
          const draft = disbursementDrafts[requestId] || {};
          await api.patch(
            `/api/requests/${requestId}/release`,
            {
              release_method: draft.disbursement_method || 'bank_transfer',
              release_reference_no: draft.disbursement_reference_no || '',
              release_note: draft.disbursement_note || '',
              liquidation_due_at: draft.liquidation_due_at || ''
            }
          );
          toast.success('Request released successfully!');
        } else {
          throw new Error('This request is not ready for accounting action.');
        }
      } else if (role === 'vp' && requestStatus === 'pending_vp') {
        const isBudgetFlow = requestType === 'budget_request' || requestType === 'budget_revision';
        if (isBudgetFlow) {
          // Budget: VP marks viewed, always forwards to President
          await api.patch(
            `/api/requests/${requestId}/mark-viewed`,
            { note }
          );
          toast.success('Budget marked as viewed — forwarded to President.');
        } else {
          await api.patch(
            `/api/requests/${requestId}/approve-vp`,
            { note }
          );
          if (amount >= vpThreshold) {
            toast.success('VP approved — forwarded to President for final approval.');
          } else {
            toast.success('VP approved — returned to accounting for fund release.');
          }
        }
      } else if (role === 'president' && requestStatus === 'pending_president') {
        await api.patch(
          `/api/requests/${requestId}/approve-president`,
          { note }
        );
        toast.success(
          requestType === 'budget_request' || requestType === 'budget_revision'
            ? 'Budget approved and matrix locked.'
            : 'Request approved — returned to accounting for fund release.'
        );
      } else if (role === 'supervisor' && requestStatus === 'pending_supervisor') {
        await api.patch(
          `/api/requests/${requestId}/approve`,
          { note }
        );
        toast.success('Request approved successfully!');
      } else {
        throw new Error('You cannot approve this request at its current stage.');
      }

      fetchRequests();

    } catch (err: any) {
      const errorMsg = typeof err.response?.data?.error === 'string' 
        ? err.response.data.error 
        : (err.response?.data?.error?.message || err.message || 'Approval failed');
      toast.error(errorMsg);
    }

  };



  const executeReject = async (requestId: string, reason: string) => {
    try {

      await api.patch(

        `/api/requests/${requestId}/reject`,

        { reason }

      );

      toast.success('Request rejected successfully!');

      fetchRequests();

    } catch (err: any) {
      const errorMsg = typeof err.response?.data?.error === 'string' 
        ? err.response.data.error 
        : (err.response?.data?.error?.message || err.message || 'Rejection failed');
      toast.error(String(errorMsg));
    }

  };



  const fetchRequests = async (role = user?.role, viewOverride?: string) => {
    const effectiveView = viewOverride ?? view;

    try {

      let filtered: any[] = [];



      if ((effectiveView === 'liquidations' || effectiveView === 'cash_returns') && (role === 'supervisor' || role === 'accounting' || role === 'vp' || role === 'president' || role === 'admin')) {
        // Fetch expense requests with pending liquidation or cash return workflow
        const res = await api.get('/api/requests');
        
        if (effectiveView === 'liquidations') {
          const roleStageMap: Record<string, string[]> = {
            supervisor: ['pending_supervisor'],
            accounting: ['pending_accounting'],
            vp: ['pending_vp'],
            president: ['pending_president'],
            admin: ['pending_supervisor', 'pending_accounting', 'pending_vp', 'pending_president']
          };
          const allowedStages = roleStageMap[role] || [];
          
          filtered = (res.data || []).filter((request: any) => {
            const liq = request.latest_liquidation || request.liquidations?.find((l: any) => l.status === 'submitted');
            return liq && liq.status === 'submitted' && allowedStages.includes(liq.liquidation_status || 'pending_supervisor');
          }).map((request: any) => {
            const liquidation = request.latest_liquidation || request.liquidations?.find((l: any) => l.status === 'submitted');
            return {
              ...request,
              status: 'pending_liquidation_review',
              latest_liquidation: liquidation
            };
          });
        } else {
          // Cash returns — only accounting/admin
          if (role !== 'accounting' && role !== 'admin') {
            filtered = [];
          } else {
            filtered = (res.data || []).filter((request: any) => {
              const latest = request.latest_liquidation || request.liquidations?.find((l: any) => l.cash_return_status === 'pending_return');
              return latest?.cash_return_status === 'pending_return';
            }).map((request: any) => {
              const liquidation = request.latest_liquidation || request.liquidations?.find((l: any) => l.cash_return_status === 'pending_return');
              return {
                ...request,
                status: 'pending_cash_return',
                latest_liquidation: liquidation
              };
            });
          }
        }
      } else {

        const res = await api.get('/api/requests');

        filtered = (res.data || []).filter((request: any) => {
          if (role === 'supervisor') {
            return request.status === 'pending_supervisor';
          }

          if (effectiveView === 'pending') {
            if (!(role === 'accounting' || role === 'admin')) return false;
            if (request.status !== 'pending_accounting') return false;
            return true;
          }

          if (effectiveView === 'vp_approval') {
            if (role === 'vp') return request.status === 'pending_vp';
            if (role === 'president') return request.status === 'pending_president';
            if (role === 'admin') return request.status === 'pending_vp' || request.status === 'pending_president';
            return false;
          }

          if (effectiveView === 'approved') {
            return request.status === 'pending_accounting' && !!request.co_approved_by;
          }

          if (effectiveView === 'released') {
            return request.status === 'released';
          }

          if (effectiveView === 'liquidations') {
            const roleStageMap: Record<string, string[]> = {
              supervisor: ['pending_supervisor'],
              accounting: ['pending_accounting'],
              vp: ['pending_vp'],
              president: ['pending_president'],
              admin: ['pending_supervisor', 'pending_accounting', 'pending_vp', 'pending_president']
            };
            const allowedStages = roleStageMap[user?.role] || [];
            const liq = request.latest_liquidation || request.liquidations?.find((l: any) => l.status === 'submitted');
            return liq && liq.status === 'submitted' && allowedStages.includes(liq.liquidation_status || 'pending_supervisor');
          }

          if (effectiveView === 'cash_returns') {
            const latest = request.latest_liquidation || request.liquidations?.find((l: any) => l.cash_return_status === 'pending_return');
            return latest?.cash_return_status === 'pending_return';
          }

          return false;

        });

      }



      setRequests(filtered);

      setAllocationDrafts((current) => {

        const next = { ...current };

        filtered.forEach((request: any) => {

          if (!next[request.id]) {

            next[request.id] = (request.allocations || []).map((allocation: any) => ({

              department_id: allocation.department_id,

              amount: String(toNumber(allocation.amount))

            }));

          }

        });

        return next;

      });

      setPriorityDrafts((current) => {

        const next = { ...current };

        filtered.forEach((request: any) => {

          if (!next[request.id]) {

            next[request.id] = request.priority || 'normal';

          }

        });

        return next;

      });

      setDisbursementDrafts((current) => {

        const next = { ...current };

        filtered.forEach((request: any) => {

          if (!next[request.id]) {

            next[request.id] = {

              disbursement_method: request.disbursement_method || 'bank_transfer',

              disbursement_reference_no: request.disbursement_reference_no || '',

              disbursement_note: request.disbursement_note || '',

              liquidation_due_at: request.latest_liquidation?.due_at ? String(request.latest_liquidation.due_at).slice(0, 10) : ''

            };

          }

        });

        return next;

      });

    } catch {

      toast.error('Failed to fetch requests');

    }

  };



  const filteredRequests = useMemo(() => {

    let result = requests;

    

    // Text search

    const query = searchQuery.toLowerCase().trim();

    if (query) {

      result = result.filter(req => {

        return (

          String(req.item_name || '').toLowerCase().includes(query) ||

          String(req.request_code || '').toLowerCase().includes(query) ||

          String(getRequesterName(req)).toLowerCase().includes(query)

        );

      });

    }

    

    // Status filter

    if (statusFilter !== 'all') {

      result = result.filter(req => req.status === statusFilter);

    }

    

    // Date range filter

    if (startDate) {

      const start = new Date(startDate);

      start.setHours(0, 0, 0, 0);

      result = result.filter(req => {

        const dateStr = req.submitted_at || req.created_at || req.updated_at;

        if (!dateStr) return false;

        const reqDate = new Date(dateStr);

        return reqDate >= start;

      });

    }

    if (endDate) {

      const end = new Date(endDate);

      end.setHours(23, 59, 59, 999);

      result = result.filter(req => {

        const dateStr = req.submitted_at || req.created_at || req.updated_at;

        if (!dateStr) return false;

        const reqDate = new Date(dateStr);

        return reqDate <= end;

      });

    }

    

    // Department filter

    if (departmentFilter !== 'all') {

      result = result.filter(req => req.department_id === departmentFilter);

    }

    

    // Request type filter

    if (requestTypeFilter !== 'all') {

      result = result.filter(req => req.request_type === requestTypeFilter);

    }

    

    // Priority filter

    if (priorityFilter !== 'all') {

      result = result.filter(req => (req.priority || 'normal') === priorityFilter);

    }

    

    // Sort by submitted_at ascending (oldest first)
    result = [...result].sort((a, b) => {
      const dateA = new Date(a.submitted_at || a.created_at || a.updated_at || 0).getTime();
      const dateB = new Date(b.submitted_at || b.created_at || b.updated_at || 0).getTime();
      return dateA - dateB;
    });

    return result;

  }, [requests, searchQuery, statusFilter, departmentFilter, requestTypeFilter, priorityFilter, startDate, endDate]);



  const handleLiquidationReview = async (requestId: string, status: 'verified' | 'returned', remarks?: string) => {
    try {

      await api.patch(

        `/api/requests/${requestId}/liquidation/review`,

        { action: status === 'verified' ? 'approve' : 'reject', remarks: remarks || '' }

      );

      toast.success(`Liquidation ${status === 'verified' ? 'approved' : 'rejected'}!`);

      await fetchRequests();

    } catch (err: any) {

      const errorMsg = typeof err.response?.data?.error === 'string' 
        ? err.response.data.error 
        : (err.response?.data?.error?.message || err.message || 'Review failed');
      toast.error(errorMsg);

    }

  };

  const handleConfirmCashReturn = async (requestId: string) => {
    try {
      await api.patch(
        `/api/requests/${requestId}/liquidation/confirm-return`,
        {}
      );

      toast.success('Cash return confirmed.');
      await fetchRequests();
    } catch (err: any) {
      const errorMsg = typeof err.response?.data?.error === 'string'
        ? err.response.data.error
        : (err.response?.data?.error?.message || err.message || 'Failed to confirm cash return');
      toast.error(errorMsg);
    }
  };


  const handleApprove = async (request: any) => {

    await executeApprove(request);

  };



  const handleReject = async (id: string, reason: string) => {

    await executeReject(id, reason);

  };



  const handleReturn = async (requestId: string, reason: string) => {

    if (view === 'liquidations') {

      await handleLiquidationReview(requestId, 'returned', reason);

      return;

    }

    // Skip digital signature for return - just use reason
    try {

      await api.patch(

        `/api/requests/${requestId}/return`,

        { reason }

      );

      toast.success('Request returned for revision!');

      fetchRequests();

    } catch (err: any) {

      const errorMsg = typeof err.response?.data?.error === 'string' 
        ? err.response.data.error 
        : (err.response?.data?.error?.message || err.message || 'Failed to return request');
      toast.error(errorMsg);

    }

  };



  const handleConfirmAllocation = async (requestId: string) => {
    try {
      const draft = costAllocationDrafts[requestId];
      if (!draft?.cost_center_id || !draft?.budget_category_id) {
        toast.error('Please select both cost center and budget category');
        return;
      }

      await api.patch(
        `/api/requests/${requestId}/confirm-allocation`,
        {
          cost_center_id: draft.cost_center_id,
          budget_category_id: draft.budget_category_id,
          notes: draft.notes || ''
        }
      );

      toast.success('Cost allocation confirmed successfully!');
      
      // Clear the draft
      setCostAllocationDrafts((current) => {
        const next = { ...current };
        delete next[requestId];
        return next;
      });

      // Refresh requests
      fetchRequests();
    } catch (err: any) {
      const errorMsg = typeof err.response?.data?.error === 'string' 
        ? err.response.data.error 
        : (err.response?.data?.error?.message || err.message || 'Failed to confirm allocation');
      toast.error(errorMsg);
    }
  };



  const handleBulkApproveExecutiveDepartment = async (departmentId: string) => {
    const stage = user?.role === 'president' ? 'president' : 'vp';
    try {
      const res = await api.post('/api/requests/bulk-approve-executive',
        { department_id: departmentId, note: `Bulk ${stage === 'president' ? 'approved' : 'processed'} by ${user?.role}`, stage: user?.role === 'admin' ? stage : undefined }
      );
      toast.success(res.data.message || `Processed ${res.data.approved} budget proposals`);
      setSelectedRequests(new Set());
      await fetchRequests();
      await fetchDepartments();
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.message || 'Bulk approve failed';
      toast.error(errorMsg);
    }
  };

  const handleBulkApproveDepartment = async (departmentId: string) => {
    try {
      const res = await api.post('/api/requests/bulk-approve-accounting', 
        { department_id: departmentId, note: 'Bulk approved by accounting' }
      );
      toast.success(res.data.message || `Bulk approved ${res.data.approved} budget proposals`);
      await fetchRequests();
      await fetchDepartments();
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.message || 'Bulk approve failed';
      toast.error(errorMsg);
    }
  };

  const handleCoApprove = async (request: any) => {
    try {

      await api.post(`/api/requests/${request.id}/co-approve`, {});

      toast.success('Co-approved! Request can now be released.');

      await fetchRequests();
      await fetchDepartments();

    } catch (err: any) {

      const errorMsg = typeof err.response?.data?.error === 'string' 
        ? err.response.data.error 
        : (err.response?.data?.error?.message || err.message || 'Co-approval failed');
      toast.error(errorMsg);

    }

  };



  // Export filtered requests to CSV (Excel-compatible)

  const exportToExcel = () => {

    if (filteredRequests.length === 0) {

      toast.error('No data to export');

      return;

    }

    

    const headers = ['Request Code', 'Requester', 'Department', 'Amount', 'Status', 'Submitted Date', 'Priority'];

    const rows = filteredRequests.map(req => [

      req.request_code,

      getRequesterName(req),

      req.department_name || req.departments?.name || '',

      req.amount,

      req.status,

      new Date(req.submitted_at || req.created_at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' }),

      req.priority

    ]);

    

    const csvContent = [

      headers.join(','),

      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))

    ].join('\n');

    

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

    const link = document.createElement('a');

    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);

    link.setAttribute('download', `requests_export_${new Date().toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' }).replace(/\//g, '-')}.csv`);

    document.body.appendChild(link);

    link.click();

    document.body.removeChild(link);

    toast.success(`Exported ${filteredRequests.length} requests to Excel`);

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



  const handleOnHold = async (requestId: string, reason: string) => {
    try {

      const res = await api.patch(`/api/requests/${requestId}/hold`, { reason });

      const newStatus = res.data.status;

      toast.success(newStatus === 'on_hold' ? 'Request placed On Hold' : 'Request removed from On Hold');

      fetchRequests();

    } catch (err: any) {

      const errorMsg = typeof err.response?.data?.error === 'string' 
        ? err.response.data.error 
        : (err.response?.data?.error?.message || err.message || 'Failed to toggle hold status');
      toast.error(errorMsg);

    }

  };



  const updateDisbursementDraft = (requestId: string, field: 'disbursement_method' | 'disbursement_reference_no' | 'disbursement_note' | 'liquidation_due_at', value: string) => {

    setDisbursementDrafts((current) => ({

      ...current,

      [requestId]: {

        disbursement_method: current[requestId]?.disbursement_method || 'bank_transfer',

        disbursement_reference_no: current[requestId]?.disbursement_reference_no || '',

        disbursement_note: current[requestId]?.disbursement_note || '',

        liquidation_due_at: current[requestId]?.liquidation_due_at || '',

        [field]: value

      }

    }));

  };



  const updateAllocationRow = (requestId: string, index: number, field: 'department_id' | 'amount', value: string) => {

    setAllocationDrafts((current) => ({

      ...current,

      [requestId]: (current[requestId] || []).map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row))

    }));

  };



  const addAllocationRow = (requestId: string, fallbackDepartmentId: string) => {

    setAllocationDrafts((current) => ({

      ...current,

      [requestId]: [...(current[requestId] || []), { department_id: fallbackDepartmentId, amount: '0' }]

    }));

  };



  const removeAllocationRow = (requestId: string, index: number) => {

    setAllocationDrafts((current) => ({

      ...current,

      [requestId]: (current[requestId] || []).filter((_, rowIndex) => rowIndex !== index)

    }));

  };



  const getDraftTotal = (requestId: string) =>

    (allocationDrafts[requestId] || []).reduce((sum, row) => sum + toNumber(row.amount), 0);



  const toggleSplitPanel = (requestId: string) => {

    setExpandedSplits((current) => ({

      ...current,

      [requestId]: !current[requestId]

    }));

  };



  const toggleRequestPanel = (requestId: string) => {

    setExpandedRequests((current) => {

      const isOpening = !current[requestId];

      return isOpening ? { [requestId]: true } : {};

    });

  };



  const savePriority = async (requestId: string) => {
    const priority = priorityDrafts[requestId] || 'normal';



    try {

      const res = await api.patch(

        `/api/requests/${requestId}/priority`,

        { priority }

      );



      setPriorityDrafts((current) => ({

        ...current,

        [requestId]: res.data?.priority || priority

      }));

      toast.success('Urgency updated.');

      await fetchRequests();

    } catch (err: any) {

      const errorMsg = typeof err.response?.data?.error === 'string' 
        ? err.response.data.error 
        : (err.response?.data?.error?.message || err.message || 'Failed to update urgency');
      toast.error(errorMsg);

    }

  };



  const saveAllocations = async (requestId: string, silent = false) => {
    const draft = allocationDrafts[requestId] || [];

    setSavingRequestId(requestId);

    try {

      const res = await api.patch(

        `/api/requests/${requestId}/allocations`,

        {

          allocations: draft.map((row) => ({

            department_id: row.department_id,

            amount: toNumber(row.amount)

          }))

        }

      );



      setAllocationDrafts((current) => ({

        ...current,

        [requestId]: (res.data || []).map((allocation: any) => ({

          department_id: allocation.department_id,

          amount: String(toNumber(allocation.amount))

        }))

      }));



      if (!silent) {

        toast.success('Department split saved.');

      }

      await fetchRequests();

      await fetchDepartments();

    } finally {

      setSavingRequestId('');

    }

  };



  const getRequestCategoryName = (request: any): string => {
    return String(request?.category || request?.main_category_name || request?.metadata?.main_category || '').trim();
  };

  const getRequestSubCategoryName = (request: any): string => {
    return String(request?.sub_category_name || request?.metadata?.sub_category || '').trim();
  };

  const getRequestCategoryDisplay = (request: any): string => {
    const main = getRequestCategoryName(request);
    const sub = getRequestSubCategoryName(request);
    if (main && sub) return `${main} → ${sub}`;
    return main || sub || '';
  };

  const getRequestDepartmentShort = (request: any) => {
    const requestDeptId = request?.department_id;
    if (!requestDeptId) return null;
    const requestDept = departments.find((d: any) => d.id === requestDeptId);
    if (!requestDept?.name) return null;
    return mapDepartmentNameToShort(requestDept.name);
  };

  const getRequestExpenseCategoryScope = (request: any) => {
    try {
      const raw = localStorage.getItem('prefetch_expense_categories');
      if (!raw) return null;
      const expenseCache = JSON.parse(raw)?.data;
      if (!Array.isArray(expenseCache)) return null;

      const categoryName = getRequestCategoryName(request).trim().toLowerCase();
      if (!categoryName) return null;

      const requestCode = String(request?.category_code || request?.main_category_code || request?.metadata?.main_category_code || '').trim().toLowerCase();
      const requestDeptShort = getRequestDepartmentShort(request);

      const matches = expenseCache.filter((ec: any) => {
        const ecName = String(ec.main_category_name || ec.category_name || '').trim().toLowerCase();
        const ecCode = String(ec.main_category_code || ec.category_code || '').trim().toLowerCase();
        if (requestCode && ecCode && ecCode === requestCode) return true;
        if (ecName && ecName === categoryName) return true;
        return false;
      });
      if (!matches.length) return null;

      if (requestDeptShort) {
        const scopedMatch = matches.find((ec: any) => String(ec.department || '').trim().toLowerCase() === requestDeptShort.toLowerCase());
        if (scopedMatch) return String(scopedMatch.department || '').trim();
      }

      const explicitDeptMatch = matches.find((ec: any) => String(ec.department || '').trim().toLowerCase() !== 'all');
      if (explicitDeptMatch) return String(explicitDeptMatch.department || '').trim();

      return String(matches[0].department || '').trim();
    } catch {
      return null;
    }
  };

  const resolveCategoryBudgetForDepartment = (request: any, dept: any) => {
    const categoryName = getRequestCategoryName(request);
    if (!categoryName) return null;
    const reqFiscalYear = request?.fiscal_year ?? null;
    const matchedCategory = budgetCategories.find((cat: any) =>
      cat.department_id === dept.id &&
      String(cat.category_name || '').trim().toLowerCase() === categoryName.toLowerCase() &&
      (reqFiscalYear === null || cat.fiscal_year === reqFiscalYear)
    );
    if (!matchedCategory) return null;
    return {
      remaining: toNumber(matchedCategory.remaining_amount ?? matchedCategory.remaining_budget ?? 0),
      projected: toNumber(matchedCategory.projected_remaining_budget ?? matchedCategory.projected_remaining_amount ?? matchedCategory.remaining_amount ?? 0),
      total: toNumber(matchedCategory.budget_amount ?? matchedCategory.annual_budget ?? 0),
      categoryName: matchedCategory.category_name || categoryName,
    };
  };

  const shouldShowDepartmentForRequestCategory = (req: any, dept: any) => {
    const scope = getRequestExpenseCategoryScope(req);
    if (!scope || scope.toLowerCase() === 'all') return true;
    const deptShort = mapDepartmentNameToShort(dept.name);
    return deptShort?.trim().toLowerCase() === scope.toLowerCase();
  };

  const getDepartmentOptionsForRequest = (req: any) => {
    const categoryName = getRequestCategoryName(req).toLowerCase();
    const reqFiscalYear = req.fiscal_year ?? null;
    return departments
      .filter((dept) => {
        if (!categoryName) return true;
        if (!shouldShowDepartmentForRequestCategory(req, dept)) return false;
        return budgetCategories.some(
          (cat) =>
            cat.department_id === dept.id &&
            String(cat.category_name || '').trim().toLowerCase() === categoryName &&
            (reqFiscalYear === null || cat.fiscal_year === reqFiscalYear)
        );
      })
      .map((dept) => {
        const categoryBudget = resolveCategoryBudgetForDepartment(req, dept);
        const optionLabel = categoryBudget
          ? `${dept.name} • Remaining ${displayMoney(categoryBudget.remaining, 'PHP')} • Projected ${displayMoney(categoryBudget.projected, 'PHP')}`
          : `${dept.name} • Remaining ${displayMoney(toNumber(dept.remaining_budget), 'PHP')} • Projected ${displayMoney(toNumber(dept.projected_remaining_budget), 'PHP')}`;
        return {
          id: dept.id,
          label: optionLabel,
        };
      });
  };



  if (!user) return <PageSkeleton />;



  return (

    <div className="text-[var(--role-text)]">

      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">{user?.role === 'supervisor' ? 'Team Approvals' : user?.role === 'vp' || user?.role === 'president' ? 'Approval Authority' : 'Approval'}</h1>
            <p className="page-subtitle">
              {user?.role === 'supervisor'
                ? 'Review and approve requests from your department.'
                : user?.role === 'vp' || user?.role === 'president'
                ? `Review and approve high-value requests (${currentCurrency} 500K+). VP: ≤500K, President: >500K`
                : 'Review and approve requests, verify liquidation documents, and process releases.'}
            </p>
          </div>
          
          {/* Currency Selector for VP/President */}
          {(user?.role === 'vp' || user?.role === 'president' || user?.role === 'admin') && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--role-text)]/60 uppercase tracking-wider">Currency:</span>
                <select
                  value={currentCurrency}
                  onChange={(e) => setCurrentCurrency(e.target.value as 'PHP' | 'USD' | 'IDR')}
                  className="field-input !w-32 !py-2"
                >
                  <option value="PHP">PHP (₱)</option>
                  <option value="USD">USD ($)</option>
                  <option value="IDR">IDR (Rp)</option>
                </select>
              </div>
              <p className="text-[11px] text-[var(--role-text)]/50">Converting values in real time using live FX rates.</p>
            </div>
          )}
        </div>
      </div>



      {(user?.role === 'accounting' || user?.role === 'admin' || user?.role === 'vp' || user?.role === 'president') && (
        <div className="mb-6 space-y-4">
          {/* View Toggle + Search */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-4 flex-wrap">
              {/* VP/President see approval tabs */}
              {(user?.role === 'vp' || user?.role === 'president' || user?.role === 'admin') && (
                <>
                  <button 
                    onClick={() => setView('vp_approval')} 
                    className={`btn-secondary !rounded-full !px-6 ${view === 'vp_approval' ? 'bg-[var(--role-accent)] border-[var(--role-border)]' : 'opacity-50'}`}
                  >
                    VP/President Approval
                  </button>
                  <button 
                    onClick={() => setView('approved')} 
                    className={`btn-secondary !rounded-full !px-6 ${view === 'approved' ? 'bg-[var(--role-accent)] border-[var(--role-border)]' : 'opacity-50'}`}
                  >
                    Approved for Release
                  </button>
                </>
              )}
              
              {/* Accounting sees disbursement + liquidation tabs */}
              {(user?.role === 'accounting' || user?.role === 'admin') && (
                <>
                  <button 
                    onClick={() => { setView('pending'); setSelectedRequests(new Set()); }}
                    className={`btn-secondary !rounded-full !px-6 ${view === 'pending' ? 'bg-[var(--role-accent)] border-[var(--role-border)]' : 'opacity-50'}`}
                  >
                    Pending Disbursements
                  </button>
                  <button
                    onClick={() => { setView('released'); setSelectedRequests(new Set()); }}
                    className={`btn-secondary !rounded-full !px-6 ${view === 'released' ? 'bg-[var(--role-accent)] border-[var(--role-border)]' : 'opacity-50'}`}
                  >
                    Disbursement Records
                  </button>
                </>
              )}
              {/* All approvers see Liquidations tab */}
              {(user?.role === 'supervisor' || user?.role === 'accounting' || user?.role === 'vp' || user?.role === 'president' || user?.role === 'admin') && (
                <button
                  onClick={() => { setView('liquidations'); setSelectedRequests(new Set()); }}
                  className={`btn-secondary !rounded-full !px-6 ${view === 'liquidations' ? 'bg-[var(--role-accent)] border-[var(--role-border)]' : 'opacity-50'}`}
                >
                  Liquidations
                </button>
              )}
              {(user?.role === 'accounting' || user?.role === 'admin') && (
                <button
                  onClick={() => { setView('cash_returns'); setSelectedRequests(new Set()); }}
                  className={`btn-secondary !rounded-full !px-6 ${view === 'cash_returns' ? 'bg-[var(--role-accent)] border-[var(--role-border)]' : 'opacity-50'}`}
                >
                  Cash Returns
                </button>
              )}
            </div>

            <div className="relative w-full sm:w-80">

              <input

                type="text"

                placeholder="Search by code, item..."

                className="field-input !pl-10"

                value={searchQuery}

                onChange={(e) => setSearchQuery(e.target.value)}

              />

              <svg className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--role-text)]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">

                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />

              </svg>

            </div>

          </div>

          
          {/* Filters Row */}
          <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)]/50 p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--role-text)]/50">Filters:</span>

              {/* Status Filter */}
              <select
                className="field-input !py-1.5 !text-xs"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All Status</option>
                <option value="pending_supervisor">Pending Supervisor</option>
                <option value="pending_accounting">Pending Accounting</option>
                <option value="released">Disbursed</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="returned_for_revision">Returned</option>
              </select>

              {/* Request Type Filter — accounting/admin only */}
              {(user?.role === 'accounting' || user?.role === 'admin') && (
                <select
                  className="field-input !py-1.5 !text-xs"
                  value={requestTypeFilter}
                  onChange={(e) => setRequestTypeFilter(e.target.value)}
                >
                  <option value="all">All Types</option>
                  <option value="reimbursement">Reimbursement</option>
                  <option value="cash_advance">Cash Advance</option>
                  <option value="liquidation">Liquidation</option>
                  <option value="budget_request">Budget Proposal</option>
                  <option value="budget_revision">Budget Revision</option>
                </select>
              )}

              {/* Department Filter — accounting/admin/vp/president */}
              {(user?.role === 'accounting' || user?.role === 'admin' || user?.role === 'vp' || user?.role === 'president') && departments.length > 0 && (
                <select
                  className="field-input !py-1.5 !text-xs"
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                >
                  <option value="all">All Departments</option>
                  {[...new Map(departments.map(d => [d.id, d])).values()].map((dept: any) => (
                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                  ))}
                </select>
              )}

              {/* Priority Filter */}
              <select
                className="field-input !py-1.5 !text-xs"
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
              >
                <option value="all">All Priorities</option>
                <option value="urgent">Urgent</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>

              {/* Date Range */}
              <input
                type="date"
                className="field-input !py-1.5 !text-xs"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                placeholder="From"
              />
              <span className="text-[var(--role-text)]/40">-</span>
              <input
                type="date"
                className="field-input !py-1.5 !text-xs"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                placeholder="To"
              />

              {/* Clear Filters */}
              {(startDate || endDate || statusFilter !== 'all' || searchQuery || departmentFilter !== 'all' || requestTypeFilter !== 'all' || priorityFilter !== 'all') && (
                <button
                  onClick={() => {
                    setStartDate('');
                    setEndDate('');
                    setStatusFilter('all');
                    setSearchQuery('');
                    setDepartmentFilter('all');
                    setRequestTypeFilter('all');
                    setPriorityFilter('all');
                  }}
                  className="text-xs text-[var(--role-primary)] hover:underline"
                >
                  Clear all
                </button>
              )}

              <div className="ml-auto flex items-center gap-2">
                {/* Bulk approve selected — accounting/admin on pending view */}
                {(user?.role === 'accounting' || user?.role === 'admin') && view === 'pending' && selectedRequests.size > 0 && (
                  <button
                    onClick={async () => {
                      let successCount = 0;
                      let failCount = 0;
                      const budgetIds = Array.from(selectedRequests).filter(id => {
                        const req = filteredRequests.find(r => r.id === id);
                        return req?.request_type === 'budget_request' || req?.request_type === 'budget_revision';
                      });
                      await Promise.all(budgetIds.map(async (requestId) => {
                        try {
                          await api.patch(`/api/requests/${requestId}/approve-accounting`, { note: 'Bulk approved by accounting' });
                          successCount++;
                        } catch { failCount++; }
                      }));
                      if (successCount > 0) toast.success(`Approved ${successCount} budget proposal${successCount !== 1 ? 's' : ''}`);
                      if (failCount > 0) toast.error(`Failed to approve ${failCount} request${failCount !== 1 ? 's' : ''}`);
                      setSelectedRequests(new Set());
                      await fetchRequests();
                    }}
                    className="btn-success !py-1.5 !px-3 !text-xs flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Approve Selected ({selectedRequests.size})
                  </button>
                )}
                <span className="text-xs text-[var(--role-text)]/60">
                  {filteredRequests.length} result{filteredRequests.length !== 1 ? 's' : ''}
                </span>
                <button
                  onClick={exportToExcel}
                  className="btn-secondary !py-1.5 !px-3 !text-xs flex items-center gap-1"
                  title="Export to Excel"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Export
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Supervisor search + filters — shown before the grouped table */}
      {user?.role === 'supervisor' && (
        <div className="mb-6 space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:w-80">
              <input
                type="text"
                placeholder="Search by code, item..."
                className="field-input !pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <svg className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--role-text)]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)]/50 p-3">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--role-text)]/50">Filters:</span>
            <select className="field-input !py-1.5 !text-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All Status</option>
              <option value="pending_supervisor">Pending My Review</option>
              <option value="pending_accounting">Pending Accounting</option>
              <option value="released">Disbursed</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="returned_for_revision">Returned</option>
            </select>
            <select className="field-input !py-1.5 !text-xs" value={requestTypeFilter} onChange={(e) => setRequestTypeFilter(e.target.value)}>
              <option value="all">All Types</option>
              <option value="reimbursement">Reimbursement</option>
              <option value="cash_advance">Cash Advance</option>
              <option value="budget_request">Budget Proposal</option>
              <option value="budget_revision">Budget Revision</option>
            </select>
            <select className="field-input !py-1.5 !text-xs" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
              <option value="all">All Priorities</option>
              <option value="urgent">Urgent</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
            <input type="date" className="field-input !py-1.5 !text-xs" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <span className="text-[var(--role-text)]/40">-</span>
            <input type="date" className="field-input !py-1.5 !text-xs" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            {(startDate || endDate || statusFilter !== 'all' || searchQuery || requestTypeFilter !== 'all' || priorityFilter !== 'all') && (
              <button onClick={() => { setStartDate(''); setEndDate(''); setStatusFilter('all'); setSearchQuery(''); setRequestTypeFilter('all'); setPriorityFilter('all'); }} className="text-xs text-[var(--role-primary)] hover:underline">
                Clear all
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-[var(--role-text)]/60">{filteredRequests.length} result{filteredRequests.length !== 1 ? 's' : ''}</span>
              <button onClick={exportToExcel} className="btn-secondary !py-1.5 !px-3 !text-xs flex items-center gap-1" title="Export to Excel">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Budget Proposals Grouped Table — accounting/admin (pending), supervisor, VP/President (vp_approval) */}
      {((user?.role === 'accounting' || user?.role === 'admin') && view === 'pending') || user?.role === 'supervisor' || ((user?.role === 'vp' || user?.role === 'president' || user?.role === 'admin') && view === 'vp_approval') ? (() => {
        const isSupervisor = user?.role === 'supervisor';
        const isExecutive = user?.role === 'vp' || user?.role === 'president';
        const isExecutiveView = isExecutive || (user?.role === 'admin' && view === 'vp_approval');
        const budgetProposals = filteredRequests.filter(r => {
          if (r.request_type !== 'budget_request' && r.request_type !== 'budget_revision') return false;
          if (isSupervisor) return r.status === 'pending_supervisor';
          if (isExecutiveView) {
            if (user?.role === 'president') return r.status === 'pending_president';
            if (user?.role === 'vp') return r.status === 'pending_vp';
            return r.status === 'pending_vp' || r.status === 'pending_president';
          }
          return r.status === 'pending_accounting';
        });

        if (budgetProposals.length === 0 && isSupervisor) return null;
        if (budgetProposals.length === 0 && !isSupervisor) return null;

        // Group by department
        const grouped: Record<string, { deptId: string; deptName: string; supervisorName: string; requests: any[] }> = budgetProposals.reduce((acc: Record<string, { deptId: string; deptName: string; supervisorName: string; requests: any[] }>, req: any) => {
          const key = req.department_id || 'unknown';
          if (!acc[key]) {
            acc[key] = {
              deptId: key,
              deptName: req.department_name || req.departments?.name || 'Unknown Department',
              supervisorName: req.supervisor_name || req.submitted_by_name || '',
              requests: [] as any[]
            };
          }
          acc[key].requests.push(req);
          return acc;
        }, {} as Record<string, { deptId: string; deptName: string; supervisorName: string; requests: any[] }>);

        const groups: { deptId: string; deptName: string; supervisorName: string; requests: any[] }[] = Object.values(grouped);

        return (
          <div className="mb-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[var(--role-text)]">
                Budget Proposals
                <span className="ml-2 rounded-full bg-[var(--role-accent)] border border-[var(--role-border)] px-2.5 py-0.5 text-sm font-semibold">
                  {budgetProposals.length}
                </span>
              </h3>
              {/* Global select all + bulk approve */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    const allIds = budgetProposals.map(r => r.id);
                    const allSelected = allIds.every(id => selectedRequests.has(id));
                    setSelectedRequests(prev => {
                      const next = new Set(prev);
                      if (allSelected) { allIds.forEach(id => next.delete(id)); }
                      else { allIds.forEach(id => next.add(id)); }
                      return next;
                    });
                  }}
                  className="flex items-center gap-2 text-xs font-medium text-[var(--role-text)] hover:text-[var(--role-primary)]"
                >
                  <input
                    type="checkbox"
                    checked={budgetProposals.length > 0 && budgetProposals.every(r => selectedRequests.has(r.id))}
                    onChange={() => {}}
                    className="h-4 w-4 rounded border-[var(--role-border)] text-emerald-500"
                  />
                  Select All
                </button>
                {selectedRequests.size > 0 && (
                  <button
                    onClick={async () => {
                      let ok = 0; let fail = 0;
                      const ids = Array.from(selectedRequests).filter(id => budgetProposals.some(r => r.id === id));
                      if (isExecutiveView) {
                        const byDept = ids.reduce<Record<string, string[]>>((acc, id) => {
                          const req = budgetProposals.find(r => r.id === id);
                          const deptId = req?.department_id || 'unknown';
                          acc[deptId] = acc[deptId] || [];
                          acc[deptId].push(id);
                          return acc;
                        }, {});
                        const stage = user?.role === 'president' ? 'president' : 'vp';
                        for (const deptId of Object.keys(byDept)) {
                          if (deptId === 'unknown') continue;
                          try {
                            const res = await api.post('/api/requests/bulk-approve-executive',
                              { department_id: deptId, note: `Bulk ${stage === 'president' ? 'approved' : 'processed'} by ${user?.role}`, stage: user?.role === 'admin' ? stage : undefined }
                            );
                            ok += res.data.approved || 0;
                            fail += res.data.failed || 0;
                          } catch {
                            fail += byDept[deptId].length;
                          }
                        }
                      } else {
                        await Promise.all(ids.map(async id => {
                          try {
                            if (isSupervisor) {
                              await api.patch(`/api/requests/${id}/approve`, { note: 'Bulk approved' });
                            } else {
                              await api.patch(`/api/requests/${id}/approve-accounting`, { note: 'Bulk approved by accounting' });
                            }
                            ok++;
                          } catch { fail++; }
                        }));
                      }
                      if (ok > 0) toast.success(`${isExecutiveView ? 'Processed' : 'Approved'} ${ok} budget proposal${ok !== 1 ? 's' : ''}`);
                      if (fail > 0) toast.error(`Failed: ${fail}`);
                      setSelectedRequests(new Set());
                      await fetchRequests();
                    }}
                    className="btn-success !py-1.5 !px-4 !text-xs flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {isExecutiveView
                      ? `${user?.role === 'president' ? 'Approve' : 'Process'} Selected (${selectedRequests.size})`
                      : `Approve Selected (${selectedRequests.size})`}
                  </button>
                )}
              </div>
            </div>

            {groups.map(group => {
              const groupIds = group.requests.map(r => r.id);
              const allGroupSelected = groupIds.every(id => selectedRequests.has(id));
              const someGroupSelected = groupIds.some(id => selectedRequests.has(id));
              const groupTotal = group.requests.reduce(
                (sum, r) => sum + convertCurrency(toNumber(r.amount), getSupportedCurrency(r.metadata?.currency || r.currency), currentCurrency),
                0
              );

              return (
                <div key={group.deptId} className="panel overflow-hidden !p-0">
                  {/* Department header */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-[var(--role-accent)]/60 border-b border-[var(--role-border)] px-5 py-4">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={allGroupSelected}
                        ref={el => { if (el) el.indeterminate = someGroupSelected && !allGroupSelected; }}
                        onChange={() => {
                          setSelectedRequests(prev => {
                            const next = new Set(prev);
                            if (allGroupSelected) { groupIds.forEach(id => next.delete(id)); }
                            else { groupIds.forEach(id => next.add(id)); }
                            return next;
                          });
                        }}
                        className="h-4 w-4 rounded border-[var(--role-border)] text-emerald-500"
                      />
                      <div>
                        <h4 className="font-bold text-[var(--role-text)]">{group.deptName}</h4>
                        {group.supervisorName && (
                          <p className="text-xs text-[var(--role-text)]/55">Supervisor: {group.supervisorName}</p>
                        )}
                      </div>
                      <span className="rounded-full bg-[var(--role-border)]/20 border border-[var(--role-border)] px-2.5 py-0.5 text-xs font-semibold text-[var(--role-text)]/70">
                        {group.requests.length} proposal{group.requests.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-xs text-[var(--role-text)]/50 uppercase tracking-wider">Total Amount</p>
                        <p className="font-bold text-[var(--role-text)]">{formatMoney(groupTotal, currentCurrency)}</p>
                      </div>
                      {!isSupervisor && !isExecutiveView && (
                        <button
                          onClick={() => handleBulkApproveDepartment(group.deptId)}
                          className="btn-success !py-2 !px-4 !text-sm flex items-center gap-2 whitespace-nowrap"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Approve All ({group.requests.length})
                        </button>
                      )}
                      {isExecutiveView && (
                        <button
                          onClick={() => handleBulkApproveExecutiveDepartment(group.deptId)}
                          className="btn-success !py-2 !px-4 !text-sm flex items-center gap-2 whitespace-nowrap"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          {user?.role === 'president' ? 'Approve All' : 'Process All'} ({group.requests.length})
                        </button>
                      )}
                      {isSupervisor && (
                        <button
                          onClick={async () => {
                            let ok = 0; let fail = 0;
                            await Promise.all(groupIds.map(async id => {
                              try {
                                await api.patch(`/api/requests/${id}/approve`, { note: 'Bulk approved by supervisor' });
                                ok++;
                              } catch { fail++; }
                            }));
                            if (ok > 0) toast.success(`Approved ${ok} proposal${ok !== 1 ? 's' : ''} for ${group.deptName}`);
                            if (fail > 0) toast.error(`Failed: ${fail}`);
                            setSelectedRequests(new Set());
                            await fetchRequests();
                          }}
                          className="btn-success !py-2 !px-4 !text-sm flex items-center gap-2 whitespace-nowrap"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Approve All ({group.requests.length})
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-[var(--role-border)]/30 bg-[var(--role-accent)]/30">
                        <tr>
                          <th className="w-10 px-4 py-3"></th>
                          <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-[var(--role-text)]/50">Code</th>
                          <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-[var(--role-text)]/50">Category</th>
                          <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-[var(--role-text)]/50">Item</th>
                          {/* Removed 'Type' column per Section 1.4 requirements */}
                          <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-[var(--role-text)]/50">Submitted By</th>
                          <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-[var(--role-text)]/50">Priority</th>
                          <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-[var(--role-text)]/50">Date</th>
                          <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-[var(--role-text)]/50">Amount</th>
                          <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-[var(--role-text)]/50">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--role-border)]/20">
                        {group.requests.map((req, idx) => {
                          const sla = calculateSLA(req);
                          const requestCurrency = getSupportedCurrency(req.metadata?.currency || req.currency);
                          const isSelected = selectedRequests.has(req.id);
                          const requestAmount = toNumber(req.amount);
                          const budgetSummary = req.budget_summary || {};
                          const projectedAfter = budgetSummary?.projected_remaining_after_approval;
                          const categoryRemaining = req.remaining_amount ?? budgetSummary?.remaining_budget ?? null;
                          const isInsufficientBudget = (typeof projectedAfter === 'number')
                            ? Number(projectedAfter) < 0
                            : (categoryRemaining != null ? Number(categoryRemaining) < Number(requestAmount) : false);
                          return (
                            <tr
                              key={req.id}
                              className={`transition-colors ${isSelected ? 'bg-emerald-500/5' : idx % 2 === 0 ? 'bg-transparent' : 'bg-[var(--role-accent)]/20'} hover:bg-[var(--role-accent)]/40`}
                            >
                              {/* Checkbox */}
                              <td className="px-4 py-3">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleRequestSelection(req.id)}
                                  className="h-4 w-4 rounded border-[var(--role-border)] text-emerald-500 cursor-pointer"
                                />
                              </td>
                              {/* Code */}
                              <td className="px-4 py-3 font-mono text-xs text-[var(--role-text)]/70 whitespace-nowrap">
                                {req.request_code || '—'}
                              </td>
                              {/* Category */}
                              <td className="px-4 py-3 whitespace-nowrap">
                                <span className="rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] px-2.5 py-1 text-xs font-semibold text-[var(--role-text)]/80">
                                  {getRequestCategoryDisplay(req) || '—'}
                                </span>
                              </td>
                              {/* Item */}
                              <td className="px-4 py-3 max-w-[220px]">
                                <p className="font-semibold text-[var(--role-text)] truncate" title={req.item_name}>{req.item_name}</p>
                                {isInsufficientBudget && (
                                  <div className="mt-2">
                                    <span className="inline-flex items-center rounded-full bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-xs font-semibold">Insufficient Budget</span>
                                    <span className="ml-2 text-xs text-[var(--role-text)]/60">{categoryRemaining != null ? `Remaining ${displayMoney(Number(categoryRemaining), req.currency)}` : 'No budget data'}</span>
                                  </div>
                                )}
                                {req.purpose && (
                                  <p className="text-xs text-[var(--role-text)]/40 truncate mt-0.5" title={req.purpose}>{req.purpose}</p>
                                )}
                              </td>
                              {/* Removed 'Type' column per Section 1.4 requirements */}
                              {/* Submitted By */}
                              <td className="px-4 py-3 text-[var(--role-text)]/70 whitespace-nowrap text-xs">
                                {getRequesterName(req)}
                              </td>
                              {/* Priority */}
                              <td className="px-4 py-3 whitespace-nowrap">
                                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                                  req.priority === 'urgent' ? 'bg-red-500/10 text-red-600 border border-red-500/20' :
                                  req.priority === 'low' ? 'bg-gray-500/10 text-gray-500 border border-gray-500/20' :
                                  'bg-[var(--role-accent)] text-[var(--role-text)]/60 border border-[var(--role-border)]'
                                }`}>
                                  {req.priority || 'normal'}
                                </span>
                                {sla.hours > 0 && (
                                  <span className={`ml-1.5 text-[10px] font-medium ${sla.breached ? 'text-red-500' : 'text-blue-500'}`}>
                                    ⏱{formatSLA(sla.hours)}{sla.breached ? ' ⚠️' : ''}
                                  </span>
                                )}
                              </td>
                              {/* Date */}
                              <td className="px-4 py-3 text-xs text-[var(--role-text)]/60 whitespace-nowrap">
                                {req.submitted_at ? new Date(req.submitted_at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                              </td>
                              {/* Amount */}
                              <td className="px-4 py-3 text-right font-bold text-[var(--role-text)] whitespace-nowrap">
                                {displayMoney(toNumber(req.amount), requestCurrency)}
                              </td>
                              {/* Actions */}
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    onClick={() => void executeApprove(req)}
                                    className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/20 transition whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                                    disabled={req.status === 'on_hold' || (req.within_budget === false && req.request_type !== 'budget_request' && req.request_type !== 'budget_revision' && req.request_type !== 'travel_booking')}
                                    title={req.status === 'on_hold' ? 'Cannot approve - request is On Hold' : (req.within_budget === false && req.request_type !== 'budget_request' && req.request_type !== 'budget_revision' && req.request_type !== 'travel_booking') ? 'Cannot approve - request is outside approved budget' : 'Approve'}
                                  >
                                    Approve
                                  </button>
                                  <button
                                    onClick={() => setModalConfig({
                                      isOpen: true,
                                      requestId: req.id,
                                      type: 'return',
                                      title: 'Return for Revision',
                                      message: 'Explain what needs to be corrected.',
                                      placeholder: 'Enter revision details...',
                                      confirmLabel: 'Send Back'
                                    })}
                                    className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-500/20 transition whitespace-nowrap"
                                    title="Return for revision"
                                  >
                                    Return
                                  </button>
                                  <button
                                    onClick={() => setModalConfig({
                                      isOpen: true,
                                      requestId: req.id,
                                      type: 'reject',
                                      title: 'Reject Request',
                                      message: 'Provide a reason for rejecting this request.',
                                      placeholder: 'Enter rejection reason...',
                                      confirmLabel: 'Reject Request'
                                    })}
                                    className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-500/20 transition whitespace-nowrap"
                                    title="Reject"
                                  >
                                    Reject
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {/* Group total row */}
                        <tr className="bg-[var(--role-accent)]/50 border-t-2 border-[var(--role-border)]/40">
                          <td colSpan={8} className="px-4 py-2.5 text-right text-xs font-bold uppercase tracking-wider text-[var(--role-text)]/50">
                            Department Total
                          </td>
                          <td className="px-4 py-2.5 text-right font-bold text-[var(--role-text)]">
                            {formatMoney(groupTotal, currentCurrency)}
                          </td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })() : null}



      {filteredRequests.length === 0 ? (

        <div className="panel text-center">

          <p className="text-xl font-semibold text-[var(--role-text)]">No pending expenses at this time.</p>

          <p className="mt-2 text-[var(--role-text)]/60">New tickets will appear here automatically when they reach your stage.</p>

        </div>

      ) : (

        (() => {
          // Budget proposals are shown in the grouped table above — exclude them from the card list
          const isBudgetTableView =
            ((user?.role === 'accounting' || user?.role === 'admin') && view === 'pending') ||
            user?.role === 'supervisor' ||
            ((user?.role === 'vp' || user?.role === 'president' || user?.role === 'admin') && view === 'vp_approval');
          const cardRequests = isBudgetTableView
            ? filteredRequests.filter(r => r.request_type !== 'budget_request' && r.request_type !== 'budget_revision')
            : filteredRequests;

          // If all items are budget proposals (shown in table), no cards to render
          if (cardRequests.length === 0) return null;

          const startIndex = (currentPage - 1) * pageSize;

          const paginatedData = cardRequests.slice(startIndex, startIndex + pageSize);

          const totalPages = Math.max(1, Math.ceil(cardRequests.length / pageSize));

          

          return (

            <div className="space-y-4">

              {paginatedData.map((req) => {

            const draftRows = allocationDrafts[req.id] || [];

            const draftTotal = getDraftTotal(req.id);

            const requestAmount = toNumber(req.amount);

            const requestCurrency = getSupportedCurrency(req.metadata?.currency || req.currency);

            const remainingToAllocate = requestAmount - draftTotal;

            const isExpanded = Boolean(expandedRequests[req.id]);

            const isSplitExpanded = Boolean(expandedSplits[req.id]);

            const budgetSummary = req.budget_summary;
            const categoryBudgetSummary = req.category_budget_summary;

            const requestingDepartmentBudget = toNumber(budgetSummary?.annual_budget);
            const requestingDepartmentRemaining = toNumber(budgetSummary?.remaining_budget);
            const projectedRemainingAfterApproval = toNumber(budgetSummary?.projected_remaining_after_approval);

            // Use category budget summary for supervisors if available
            const useCategoryBudget = (user?.role === 'supervisor' || user?.role === 'manager') && categoryBudgetSummary;
            const categoryRemaining = toNumber(categoryBudgetSummary?.remaining_amount);
            const categoryProjectedAfterApproval = toNumber(categoryBudgetSummary?.projected_remaining_after_approval);
            const categoryName = categoryBudgetSummary?.category_name || '';

            const topBudgetLabel = useCategoryBudget ? 'Category Budget' : 'Requesting Dept Total Budget';
            const topBudgetAmount = useCategoryBudget ? toNumber(categoryBudgetSummary?.budget_amount) : requestingDepartmentBudget;
            const topBudgetDescription = useCategoryBudget 
              ? `${categoryName} budget for ${req.department_name || 'Department'}` 
              : `${req.department_name || 'Department'} total annual budget`;
            const remainingAmountBeforeApproval = useCategoryBudget ? categoryRemaining : requestingDepartmentRemaining;
            const projectedAfterApprovalAmount = useCategoryBudget ? categoryProjectedAfterApproval : projectedRemainingAfterApproval;
            const remainingCardLabel = useCategoryBudget ? 'Category Remaining After Approval' : 'Dept Remaining After Approval';


            return (

              <div key={req.id} className={`panel approval-card ${isExpanded ? 'approval-card-open' : 'approval-card-closed'}`}>

                <button type="button" onClick={() => toggleRequestPanel(req.id)} className="w-full text-left">

                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">

                    <div className="min-w-0">

                      <div className="flex flex-wrap items-center gap-3">

                        {/* Checkbox for bulk approve - supervisor on pending requests, or accounting/admin on budget proposals */}

                        {(user?.role === 'supervisor' && req.status === 'pending_supervisor') && (

                          <div 

                            onClick={(e) => {

                              e.stopPropagation();

                              toggleRequestSelection(req.id);

                            }}

                            className="flex items-center"

                          >

                            <input

                              type="checkbox"

                              checked={selectedRequests.has(req.id)}

                              onChange={() => {}}

                              className="h-5 w-5 rounded border-[var(--role-border)] text-emerald-500 focus:ring-emerald-500 cursor-pointer"

                            />

                          </div>

                        )}

                        {(user?.role === 'accounting' || user?.role === 'admin') && view === 'pending' && (req.request_type === 'budget_request' || req.request_type === 'budget_revision') && req.status === 'pending_accounting' && (

                          <div

                            onClick={(e) => {

                              e.stopPropagation();

                              toggleRequestSelection(req.id);

                            }}

                            className="flex items-center"

                          >

                            <input

                              type="checkbox"

                              checked={selectedRequests.has(req.id)}

                              onChange={() => {}}

                              className="h-5 w-5 rounded border-[var(--role-border)] text-emerald-500 focus:ring-emerald-500 cursor-pointer"

                            />

                          </div>

                        )}

                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-3">
                            <span className="rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] px-3 py-1 text-sm font-medium text-[var(--role-text)]">
                              {(() => {
                                switch (req.request_type) {
                                  case 'reimbursement': return 'Reimbursement';
                                  case 'cash_advance': return 'Cash Advance';
                                  case 'liquidation': return 'Liquidation';
                                  case 'budget_request': return 'Budget Proposal';
                                  case 'budget_revision': return 'Budget Revision';
                                  default: return 'Expense';
                                }
                              })()}
                            </span>
                            <span className="rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] px-3 py-1 text-sm font-medium text-[var(--role-text)]">
                              {view === 'vp_approval' && req.status === 'pending_accounting' ? 'For Executive Review' : getStatusLabel(req.status)}
                            </span>
                            {(() => {
                              if (req.request_type === 'travel_booking') return null;
                              const reqAmt = toNumber(req.amount);
                              const bsum = req.budget_summary || {};
                              const proj = bsum?.projected_remaining_after_approval;
                              const catRem = req.remaining_amount ?? bsum?.remaining_budget ?? null;
                              const over = (typeof proj === 'number') ? Number(proj) < 0 : (catRem != null ? Number(catRem) < Number(reqAmt) : false);
                              if (!over) return null;
                              return (
                                <span className="rounded-full px-3 py-1 text-xs font-semibold bg-red-50 text-red-700 border border-red-200 ml-2">
                                  Insufficient Budget
                                </span>
                              );
                            })()}
                          </div>
                          <h2 className="text-2xl font-bold text-[var(--role-text)]">{req.item_name}</h2>
                        </div>

                        {/* SLA Tracking Indicator */}

                        {(() => {

                          const sla = calculateSLA(req);

                          if (sla.hours === 0) return null;

                          return (

                            <span 

                              className={`rounded-full px-3 py-1 text-xs font-medium ${

                                sla.breached 

                                  ? 'bg-red-500/10 text-red-600 border border-red-500/30' 

                                  : 'bg-blue-500/10 text-blue-600 border border-blue-500/30'

                              }`}

                              title={`Time in ${sla.stage} stage`}

                            >

                              ⏱️ {formatSLA(sla.hours)} {sla.breached && '⚠️ SLA'}

                            </span>

                          );

                        })()}

                        {view === 'liquidations' && (

                          <span className="rounded-full border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-sm font-bold text-emerald-600">

                            Liquidation Submitted

                          </span>

                        )}

                      </div>

                      <p className="mt-2 text-lg text-[var(--role-text)]/90">
                        {displayMoney(requestAmount, requestCurrency)}
                      </p>

                      <p className={`mt-3 max-w-2xl text-[var(--role-text)]/70 ${isExpanded ? '' : 'approval-card-description'}`}>{req.purpose}</p>

                      {isExpanded && req.metadata?.items && (

                        <div className="mt-4 space-y-2">

                          <p className="text-xs font-bold uppercase tracking-widest text-[var(--role-text)]/40">Item Breakdown</p>

                          <div className="overflow-hidden rounded-xl border border-[var(--role-border)]/10 bg-[var(--role-accent)]">

                            <table className="w-full text-left text-sm">

                              <thead className="border-b border-[var(--role-border)]/10 bg-[var(--role-border)]/5">

                                <tr>

                                  {req.metadata.items[0]?.expense_date !== undefined ? (
                                    <><th className="px-4 py-2 font-semibold">Date</th><th className="px-4 py-2 font-semibold">Payee</th><th className="px-4 py-2 font-semibold">Type</th><th className="px-4 py-2 font-semibold">Category</th></>
                                  ) : (
                                    <><th className="px-4 py-2 font-semibold">Item</th><th className="px-4 py-2 font-semibold">Category</th></>
                                  )}

                                  <th className="px-4 py-2 text-right font-semibold">Amount</th>

                                </tr>

                              </thead>

                              <tbody>

                                {req.metadata.items.map((item: any, idx: number) => (

                                  <tr key={idx} className="border-b border-[var(--role-border)]/5 last:border-0">

                                    {item.expense_date !== undefined ? (
                                      <><td className="px-4 py-2">{item.expense_date}</td><td className="px-4 py-2">{item.payee_name}</td><td className="px-4 py-2">{item.expense_type}</td><td className="px-4 py-2 text-xs">{[item.main_category, item.sub_category].filter(Boolean).join(' → ') || '—'}</td></>
                                    ) : (
                                      <>
                                        <td className="px-4 py-2">{item.item_name}</td>
                                        <td className="px-4 py-2 text-xs">{[item.main_category, item.sub_category].filter(Boolean).join(' → ') || '—'}</td>
                                      </>
                                    )}

                                    <td className="px-4 py-2 text-right font-medium">{displayMoney(toNumber(item.amount), requestCurrency)}</td>

                                  </tr>

                                ))}

                                <tr className="bg-[var(--role-border)]/5 font-bold">

                                  <td colSpan={req.metadata.items[0]?.expense_date !== undefined ? 4 : 2} className="px-4 py-2 text-right">Total</td>

                                  <td className="px-4 py-2 text-right">{displayMoney(requestAmount, requestCurrency)}</td>

                                </tr>

                              </tbody>

                            </table>

                          </div>

                        </div>

                      )}

                    </div>

                    <div className="space-y-2 text-sm text-[var(--role-text)]/60 lg:text-right">

                      <p>Priority: <span className="font-semibold capitalize text-[var(--role-text)]">{req.priority}</span></p>

                      <p>Submitted: <span className="font-semibold text-[var(--role-text)]">{formatDateTime(req.submitted_at)}</span></p>

                      <span className="inline-flex rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--role-text)]">

                        {isExpanded ? 'Collapse' : 'Expand'}

                      </span>

                    </div>

                  </div>

                </button>



                <div className={`approval-card-details ${isExpanded ? 'approval-card-details-open' : 'approval-card-details-closed'}`}>

                  <div className="pt-5">

                    {view === 'cash_returns' && req.latest_liquidation?.cash_return_amount > 0 && (
                      <div className="mb-6 rounded-[24px] border border-yellow-300 bg-yellow-50/75 p-5">
                        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                          <div>
                            <h3 className="text-lg font-semibold text-[var(--role-text)]">Cash Return Confirmation</h3>
                            <p className="mt-1 text-sm text-[var(--role-text)]/70">
                              This request requires a cash return before it can be completed. Confirm the returned amount and close the request.
                            </p>
                          </div>
                          <div className="grid gap-1 text-sm text-[var(--role-text)]/80">
                            <div className="font-semibold">Amount to return: {displayMoney(toNumber(req.latest_liquidation.cash_return_amount), requestCurrency)}</div>
                            <div>Method: <span className="font-semibold capitalize">{req.latest_liquidation.cash_return_method || 'cash'}</span></div>
                            <div>Status: {req.latest_liquidation.cash_return_status || 'pending_return'}</div>
                            {req.latest_liquidation.cash_return_reference && (
                              <div>Reference: {req.latest_liquidation.cash_return_reference}</div>
                            )}
                          </div>
                        </div>

                        {req.latest_liquidation.cash_return_status === 'pending_return' && (
                          <div className="mt-4">
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={() => void handleConfirmCashReturn(req.id)}
                            >
                              Confirm Cash Return
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {view === 'liquidations' && req.latest_liquidation && (

                      <div className="mb-6 space-y-4">

                        {/* Approval stage indicator */}
                        <div className="rounded-xl border border-blue-200 bg-blue-50/30 p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-bold uppercase tracking-widest text-blue-600">Liquidation Approval</h3>
                            <span className="rounded-full border border-blue-300 bg-blue-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-blue-700">
                              {(req.latest_liquidation.liquidation_status || 'pending_supervisor').replace(/_/g, ' ')}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {['pending_supervisor', 'pending_accounting', 'pending_vp', 'pending_president'].map((stage, idx) => {
                              const stages = ['pending_supervisor', 'pending_accounting', 'pending_vp', 'pending_president'];
                              const currentIdx = stages.indexOf(req.latest_liquidation.liquidation_status || 'pending_supervisor');
                              const isDone = idx < currentIdx;
                              const isCurrent = idx === currentIdx;
                              return (
                                <div key={stage} className="flex items-center gap-2">
                                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${isDone ? 'bg-emerald-500 text-white' : isCurrent ? 'bg-blue-500 text-white animate-pulse' : 'bg-gray-200 text-gray-400'}`}>
                                    {isDone ? '✓' : idx + 1}
                                  </div>
                                  <span className={`text-[10px] capitalize ${isCurrent ? 'text-blue-600 font-bold' : isDone ? 'text-emerald-600' : 'text-gray-400'}`}>
                                    {stage.replace('pending_', '')}
                                  </span>
                                  {idx < 3 && <div className={`w-4 h-0.5 ${isDone ? 'bg-emerald-400' : 'bg-gray-200'}`} />}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

                        <div className="space-y-4">

                          <div className="panel-muted !border-emerald-500/10 !bg-emerald-500/5">

                            <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-600">Liquidation Details</h3>

                            <div className="mt-4 space-y-3">

                              <div className="flex justify-between">

                                <span className="text-[var(--role-text)]/60">Actual Amount:</span>

                                <span className="font-bold text-[var(--role-text)]">{displayMoney(toNumber(req.latest_liquidation.actual_amount), requestCurrency)}</span>

                              </div>

                              <div className="flex justify-between">

                                <span className="text-[var(--role-text)]/60">Difference:</span>

                                <span className={`font-bold ${toNumber(req.latest_liquidation.actual_amount) > toNumber(req.amount) ? 'text-orange-600' : 'text-emerald-600'}`}>

                                  {displayMoney(toNumber(req.latest_liquidation.actual_amount) - requestAmount, requestCurrency)}

                                </span>

                              </div>

                              <div className="pt-2">

                                <p className="text-xs uppercase tracking-wider text-[var(--role-text)]/50">Remarks:</p>

                                <p className="mt-1 text-sm italic text-[var(--role-text)]">"{req.latest_liquidation.remarks || 'No remarks provided'}"</p>

                              </div>

                              {req.latest_liquidation.items?.length > 0 && (
                                <div className="mt-4 rounded-2xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4">
                                  <p className="text-sm font-semibold mb-3">Liquidation Breakdown</p>
                                  <div className="overflow-hidden rounded-xl border border-[var(--role-border)]/10 bg-[var(--role-accent)]">
                                    <table className="w-full text-left text-sm">
                                      <thead className="bg-[var(--role-border)]/5 text-[var(--role-text)]/70">
                                        <tr>
                                          <th className="px-4 py-2 font-semibold">Date</th>
                                          <th className="px-4 py-2 font-semibold">Description</th>
                                          <th className="px-4 py-2 text-right font-semibold">Amount</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {req.latest_liquidation.items.map((item: any, index: number) => (
                                          <tr key={index} className="border-b border-[var(--role-border)]/10 last:border-0">
                                            <td className="px-4 py-2 text-[var(--role-text)]/80">{item.expense_date ? formatDateTime(item.expense_date) : '-'}</td>
                                            <td className="px-4 py-2 text-[var(--role-text)]/80">{item.description || item.item_name || item.category_id || 'Item'}</td>
                                            <td className="px-4 py-2 text-right font-semibold">{displayMoney(toNumber(item.amount), requestCurrency)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                            </div>

                          </div>

                        </div>



                        <div>

                          <p className="mb-2 text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">Receipt / Supporting Documents</p>

                          {(req.attachments || []).filter((a: any) => a.attachment_scope === 'liquidation').length > 0 ? (

                            (req.attachments || []).filter((a: any) => a.attachment_scope === 'liquidation').map((attachment: any) => (

                            <div key={attachment.id} className="group relative overflow-hidden rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)]">

                              <img 

                                src={attachment.file_url} 

                                alt="Receipt" 

                                className="h-auto max-h-[300px] w-full object-contain transition group-hover:scale-105"

                              />

                              <button 

                                type="button"

                                onClick={() => setPreviewFile({ url: attachment.file_url, name: attachment.file_name || 'Receipt' })}

                                className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100"

                              >

                                <span className="btn-secondary">Preview Image</span>

                              </button>

                            </div>

                            ))

                          ) : (

                            <div className="flex h-[200px] items-center justify-center rounded-2xl border border-dashed border-[var(--role-border)] bg-[var(--role-accent)]">

                              <p className="text-[var(--role-text)]/40">No receipt attached</p>

                            </div>

                          )}



                          {req.latest_liquidation?.cash_advance_id && (
                            <div className="mt-4 overflow-hidden rounded-xl border border-[var(--role-border)]/20 bg-[var(--role-surface)]">
                              <div className="p-3 bg-[var(--role-accent)]/70 text-[var(--role-text)]/70">
                                <p className="text-xs font-bold uppercase tracking-[0.16em]">Cash Advance Liquidation</p>
                              </div>
                              <div className="p-3 text-xs">
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <span className="text-[var(--role-text)]/60">Amount Spent:</span>
                                    <span className="ml-2 font-semibold">{displayMoney(toNumber(req.latest_liquidation.amount_spent), requestCurrency)}</span>
                                  </div>
                                  <div>
                                    <span className="text-[var(--role-text)]/60">Receipts:</span>
                                    <span className="ml-2 font-semibold">{req.latest_liquidation.receipt_count || 0}</span>
                                  </div>
                                </div>
                                {req.latest_liquidation.remarks && (
                                  <div className="mt-2">
                                    <span className="text-[var(--role-text)]/60">Remarks:</span>
                                    <p className="mt-1 italic">{req.latest_liquidation.remarks}</p>
                                  </div>
                                )}

                                {req.latest_liquidation.cash_return_amount > 0 && (
                                  <div className="mt-3 rounded-2xl border border-yellow-300 bg-yellow-50/70 p-3 text-sm">
                                    <div className="flex items-center justify-between gap-3">
                                      <div>
                                        <p className="font-semibold text-[var(--role-text)]">Cash Return Required</p>
                                        <p className="text-[var(--role-text)]/70">Amount to return: {displayMoney(toNumber(req.latest_liquidation.cash_return_amount), requestCurrency)}</p>
                                        <p className="text-[var(--role-text)]/70">Method: <span className="font-semibold capitalize">{req.latest_liquidation.cash_return_method || 'cash'}</span></p>
                                        <p className="text-[var(--role-text)]/70">Status: {req.latest_liquidation.cash_return_status || 'pending_return'}</p>
                                        {req.latest_liquidation.cash_return_reference && (
                                          <p className="text-[var(--role-text)]/70">Reference: {req.latest_liquidation.cash_return_reference}</p>
                                        )}
                                      </div>
                                      {req.latest_liquidation.cash_return_status === 'pending_return' && (
                                        <button
                                          type="button"
                                          className="btn-primary"
                                          onClick={() => void handleConfirmCashReturn(req.id)}
                                        >
                                          Confirm Cash Return
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                        </div>

                      </div>

                      </div>

                    )}



                    <div className="mb-5 mt-5">

                      {req.attachments && req.attachments.length > 0 && (

                        <div className="mb-6">

                          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--role-text)]/40">Supporting Documents</p>

                          <div className="flex flex-wrap gap-4">

                            {req.attachments.map((attachment: any) => (

                              <div key={attachment.id} className="group relative h-24 w-24 overflow-hidden rounded-xl border border-[var(--role-border)]/10 bg-[var(--role-accent)] transition hover:border-[var(--role-secondary)]/30">

                                {attachment.attachment_type?.startsWith('image/') ? (

                                  <img 

                                    src={attachment.file_url} 

                                    alt={attachment.file_name} 

                                    className="h-full w-full object-cover transition group-hover:scale-110"

                                  />

                                ) : (

                                  <div className="flex h-full w-full flex-col items-center justify-center p-2 text-center">

                                    <svg className="h-8 w-8 text-[var(--role-text)]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">

                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0112.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />

                                    </svg>

                                    <span className="mt-1 block truncate text-[10px] text-[var(--role-text)]/60">{attachment.file_name}</span>

                                  </div>

                                )}

                                <button 

                                  onClick={() => setPreviewFile({ url: attachment.file_url, name: attachment.file_name })}

                                  className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100"

                                >

                                  <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">

                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />

                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />

                                  </svg>

                                </button>

                              </div>

                            ))}

                          </div>

                        </div>

                      )}



                      <p className="text-sm text-[var(--role-secondary)]">

                        Requested by <span className="font-semibold text-[var(--role-text)]">{getRequesterName(req)}</span>

                      </p>

                      <p className="mt-1 text-sm text-[var(--role-text)]/70">

                        Requesting Department: <span className="font-semibold text-[var(--role-text)]">{req.department_name || 'Unknown department'}</span>

                      </p>

                      {getRequestCategoryName(req) && (

                        <p className="mt-1 text-sm text-[var(--role-text)]/70">

                          Category: <span className="font-semibold text-[var(--role-text)]">{getRequestCategoryName(req)}</span>
                          {getRequestSubCategoryName(req) && (
                            <span className="text-[var(--role-text)]/50"> → <span className="font-semibold text-[var(--role-text)]/80">{getRequestSubCategoryName(req)}</span></span>
                          )}

                        </p>

                      )}

                    </div>



                    {user.role === 'supervisor' && req.request_type !== 'travel_booking' && (

                      <div className="mb-5 rounded-[24px] border border-[var(--role-border)] bg-[var(--role-accent)] p-4">

                        <h3 className="text-lg font-semibold text-[var(--role-text)]">Urgency Control</h3>

                        <p className="mt-1 text-sm text-[var(--role-text)]/60">Supervisors can raise or lower the urgency before approval.</p>

                        <div className="mt-4 flex flex-wrap items-center gap-3">

                          <select

                            className="field-input max-w-[220px]"

                            value={priorityDrafts[req.id] || req.priority || 'normal'}

                            onChange={(event) => setPriorityDrafts((current) => ({

                              ...current,

                              [req.id]: event.target.value

                            }))}

                          >

                            <option value="low">Low</option>

                            <option value="normal">Normal</option>

                            <option value="urgent">Urgent</option>

                          </select>

                          <button

                            type="button"

                            onClick={() => void savePriority(req.id)}

                            className="btn-secondary"

                          >

                            Update Urgency

                          </button>

                        </div>

                        {req.within_budget !== undefined && (
                          <div className={`mt-4 rounded-xl border px-4 py-3 text-sm font-semibold ${req.within_budget ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-red-300 bg-red-50 text-red-700'}`}>
                            {req.within_budget ? 'Within approved budget' : 'Outside approved budget'}
                            {/* For supervisors, show category-level remaining instead of department annual budget */}
                            {budgetSummary && (
                              <p className="mt-1 text-xs font-normal opacity-80">
                                {useCategoryBudget 
                                  ? `${categoryName} remaining: ${displayMoney(remainingAmountBeforeApproval, 'PHP')} · After approval: ${displayMoney(projectedAfterApprovalAmount, 'PHP')}`
                                  : `Dept remaining: ${displayMoney(requestingDepartmentRemaining, 'PHP')} · After approval: ${displayMoney(projectedRemainingAfterApproval, 'PHP')}`
                                }
                              </p>
                            )}
                          </div>
                        )}

                      </div>

                    )}



                    {(user.role === 'accounting' || user.role === 'admin') && view !== 'cash_returns' && (

                      <div className="mb-5 rounded-[24px] border border-[var(--role-border)] bg-[var(--role-accent)] p-4">

                        <button

                          type="button"

                          onClick={() => toggleSplitPanel(req.id)}

                          className="flex w-full flex-col gap-3 rounded-[20px] border border-[var(--role-border)] bg-[var(--role-surface)] px-4 py-4 text-left transition hover:border-[var(--role-secondary)]/30 hover:bg-[var(--role-accent)] sm:flex-row sm:items-center sm:justify-between"

                        >

                          <div>

                            <h3 className="text-lg font-semibold text-[var(--role-text)]">Department Allocation Split</h3>

                            <p className="mt-1 text-sm text-[var(--role-text)]/60">

                              Click to {isSplitExpanded ? 'hide' : 'manage'} the department split before release.

                            </p>

                          </div>

                          <div className="flex items-center gap-4">

                            <div className="text-sm text-[var(--role-text)]/70">

                              Total allocated: <span className="font-semibold text-[var(--role-text)]">{displayMoney(draftTotal, requestCurrency)}</span> / {displayMoney(requestAmount, requestCurrency)}

                            </div>

                            <span className="rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--role-text)]">

                              {isSplitExpanded ? 'Hide' : 'Open'}

                            </span>

                          </div>

                        </button>



                        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">

                          <div className="panel-muted !p-4">

                            <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">{topBudgetLabel}</p>

                            <p className="mt-2 text-lg font-semibold text-[var(--role-text)]">{displayMoney(topBudgetAmount, 'PHP')}</p>

                            <p className="mt-1 text-xs text-[var(--role-text)]/60">{topBudgetDescription}</p>

                          </div>

                          <div className="panel-muted !p-4">

                            <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">Preview Total Budget</p>

                            <p className="mt-2 text-lg font-semibold text-[var(--role-text)]">{displayMoney(requestAmount, requestCurrency)}</p>

                            <p className="mt-1 text-xs text-[var(--role-text)]/60">Full request amount before approval</p>

                          </div>

                          <div className="panel-muted !p-4">

                            <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">Allocated Draft</p>

                            <p className="mt-2 text-lg font-semibold text-[var(--role-text)]">{displayMoney(draftTotal, requestCurrency)}</p>

                            <p className="mt-1 text-xs text-[var(--role-text)]/60">Current split total from accounting</p>

                          </div>

                        </div>



                        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">

                          <div className="panel-muted !p-4">

                            <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">{remainingCardLabel}</p>

                            <p className="mt-2 text-lg font-semibold text-[var(--role-text)]">{displayMoney(projectedAfterApprovalAmount, 'PHP')}</p>

                            <p className="mt-1 text-xs text-[var(--role-text)]/60">

                              Current remaining {displayMoney(remainingAmountBeforeApproval, 'PHP')} before approval

                            </p>

                          </div>

                          <div className="panel-muted !p-4">

                            <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">Balance to Allocate</p>

                            <p className="mt-2 text-lg font-semibold text-[var(--role-text)]">{displayMoney(remainingToAllocate, requestCurrency)}</p>

                            <p className="mt-1 text-xs text-[var(--role-text)]/60">Should be zero before final approval</p>

                          </div>

                        </div>



                        {isSplitExpanded && (

                          <>

                            <div className="mt-4 space-y-3">

                              {draftRows.map((row, index) => (

                                <div key={`${req.id}-${index}`} className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_180px_120px]">

                                  <select

                                    value={row.department_id}

                                    onChange={(event) => updateAllocationRow(req.id, index, 'department_id', event.target.value)}

                                    className="field-input"

                                  >

                                    {getDepartmentOptionsForRequest(req).map((option) => (

                                      <option key={option.id} value={option.id}>

                                        {option.label}

                                      </option>

                                    ))}

                                  </select>

                                  <input

                                    type="number"

                                    step="0.01"

                                    value={row.amount}

                                    onChange={(event) => updateAllocationRow(req.id, index, 'amount', event.target.value)}

                                    className="field-input"

                                  />

                                  <button

                                    type="button"

                                    onClick={() => removeAllocationRow(req.id, index)}

                                    className="btn-danger"

                                    disabled={draftRows.length <= 1}

                                  >

                                    Remove

                                  </button>

                                </div>

                              ))}

                            </div>



                            <div className="mt-4 flex flex-wrap gap-3">

                              <button

                                type="button"

                                onClick={() => addAllocationRow(req.id, req.department_id)}

                                className="btn-secondary"

                              >

                                Add Department Split

                              </button>

                              <button

                                type="button"

                                onClick={() => void saveAllocations(req.id)}

                                className="btn-primary"

                                disabled={savingRequestId === req.id}

                              >

                                {savingRequestId === req.id ? 'Saving...' : 'Save Allocation'}

                              </button>

                            </div>

                          </>

                        )}

                      </div>

                    )}



                    {(user.role === 'accounting' || user.role === 'admin') && req.status === 'pending_accounting' && (
                      <div className="mb-5 rounded-[24px] border border-[var(--role-border)] bg-[var(--role-accent)] p-4">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-semibold text-[var(--role-text)]">Cost Allocation</h3>
                        </div>
                        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div>
                            <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--role-text)]/50 mb-2">
                              Source Cost Center
                            </label>
                            <select
                              className="field-input"
                              value={costAllocationDrafts[req.id]?.cost_center_id || ''}
                              onChange={(event) => setCostAllocationDrafts((current) => ({
                                ...current,
                                [req.id]: { ...current[req.id], cost_center_id: event.target.value }
                              }))}
                            >
                              <option value="">Select cost center...</option>
                              {costCenters.map((cc) => (
                                <option key={cc.id} value={cc.id}>
                                  {cc.name} — FY{cc.fiscal_year || '?'} ({formatMoney(cc.remaining_amount, 'PHP')} remaining)
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--role-text)]/50 mb-2">
                              Chargeable Line
                            </label>
                            <select
                              className="field-input"
                              value={costAllocationDrafts[req.id]?.budget_category_id || ''}
                              onChange={(event) => setCostAllocationDrafts((current) => ({
                                ...current,
                                [req.id]: { ...current[req.id], budget_category_id: event.target.value }
                              }))}
                            >
                              <option value="">Select budget category...</option>
                              {budgetCategories
                                .filter((bc) => bc.department_id === req.department_id || bc.department_id === 'All')
                                .map((bc) => (
                                  <option key={bc.id} value={bc.id}>
                                    {bc.category_name} ({formatMoney(bc.remaining_amount, 'PHP')} remaining)
                                  </option>
                                ))}
                            </select>
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--role-text)]/50 mb-2">
                              Notes (Optional)
                            </label>
                            <input
                              className="field-input"
                              placeholder="Add allocation notes..."
                              value={costAllocationDrafts[req.id]?.notes || ''}
                              onChange={(event) => setCostAllocationDrafts((current) => ({
                                ...current,
                                [req.id]: { ...current[req.id], notes: event.target.value }
                              }))}
                            />
                          </div>
                        </div>
                        <div className="mt-4">
                          <button
                            type="button"
                            disabled={!costAllocationDrafts[req.id]?.cost_center_id || !costAllocationDrafts[req.id]?.budget_category_id}
                            onClick={() => {
                              const draft = costAllocationDrafts[req.id];
                              const costCenter = costCenters.find((cc) => cc.id === draft?.cost_center_id);
                              const budgetCategory = budgetCategories.find((bc) => bc.id === draft?.budget_category_id);
                              setModalConfig({
                                isOpen: true,
                                requestId: req.id,
                                type: 'confirm_allocation',
                                title: 'Confirm Cost Allocation',
                                message: `This will deduct ${displayMoney(requestAmount, requestCurrency)} from:\n• ${costCenter?.name}\n• ${req.department_name} - ${budgetCategory?.category_name}\n\nConfirm?`,
                                placeholder: '',
                                confirmLabel: 'Confirm Allocation'
                              });
                            }}
                            className="btn-primary w-full"
                          >
                            Confirm Allocation
                          </button>
                        </div>
                      </div>
                    )}



                    {(user.role === 'accounting' || user.role === 'admin') && req.request_type !== 'budget_request' && req.request_type !== 'budget_revision' && (

                      <div className="mb-5 rounded-[24px] border border-[var(--role-border)] bg-[var(--role-accent)] p-4">

                        <div className="flex items-center justify-between mb-4">

                          <h3 className="text-lg font-semibold text-[var(--role-text)]">Disbursement Details</h3>

                          {disbursementDrafts[req.id]?.disbursement_method === 'petty_cash' && (

                            <div className={`px-4 py-1.5 rounded-2xl border ${toNumber(budgetSummary?.petty_cash_balance) < requestAmount ? 'bg-red-500/10 border-red-500/30 text-red-600' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600'} flex items-center gap-2 animate-in fade-in duration-300`}>

                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">

                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />

                              </svg>

                              <span className="text-xs font-bold uppercase tracking-widest">

                                Petty Cash: {displayMoney(toNumber(budgetSummary?.petty_cash_balance), 'PHP')}

                              </span>

                            </div>

                          )}

                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">

                          <select

                            className="field-input"

                            value={disbursementDrafts[req.id]?.disbursement_method || 'bank_transfer'}

                            onChange={(event) => updateDisbursementDraft(req.id, 'disbursement_method', event.target.value)}

                          >

                            <option value="bank_transfer">Bank Transfer</option>

                            <option value="cash">Cash</option>

                            <option value="check">Check</option>

                            <option value="petty_cash">Petty Cash</option>

                            <option value="other">Other</option>

                          </select>

                          {disbursementDrafts[req.id]?.disbursement_method !== 'cash' && (

                            <input

                              className="field-input"

                              placeholder="Reference number"

                              value={disbursementDrafts[req.id]?.disbursement_reference_no || ''}

                              onChange={(event) => updateDisbursementDraft(req.id, 'disbursement_reference_no', event.target.value)}

                            />

                          )}

                          <input

                            className="field-input"

                            type="date"

                            value={disbursementDrafts[req.id]?.liquidation_due_at || ''}

                            onChange={(event) => updateDisbursementDraft(req.id, 'liquidation_due_at', event.target.value)}

                          />

                          <input

                            className="field-input"

                            placeholder="Disbursement note"

                            value={disbursementDrafts[req.id]?.disbursement_note || ''}

                            onChange={(event) => updateDisbursementDraft(req.id, 'disbursement_note', event.target.value)}

                          />

                        </div>

                        {(() => {
                          const isBudget = req.request_type === 'budget_request' || req.request_type === 'budget_revision';
                          if (isBudget) return null;
                          const currencyThreshold = thresholds[currentCurrency] || thresholds.PHP;
                          const vpThreshold = currencyThreshold.vp;
                          const needsPresident = requestAmount >= vpThreshold;
                          const atVp = req.status === 'pending_vp';
                          const atPresident = req.status === 'pending_president';
                          return (
                          <div className="mt-4 rounded-2xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4">
                            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                              <div>
                                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--role-text)]/50">
                                  {needsPresident ? 'VP & President Approval' : 'VP Approval'}
                                </p>
                                <p className="mt-1 text-sm text-[var(--role-text)]/70">
                                  {needsPresident
                                    ? `Requests of ${formatMoney(vpThreshold, currentCurrency)} ${currentCurrency} or above require VP and President approval before release.`
                                    : `Requests below ${formatMoney(vpThreshold, currentCurrency)} ${currentCurrency} require VP approval before release.`}
                                </p>
                              </div>

                              {req.co_approved_by ? (
                                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-600">
                                  Approved by {req.co_approver_role?.toUpperCase() || 'VP/President'}
                                </span>
                              ) : atVp ? (
                                (user.role === 'vp' || user.role === 'admin') ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleCoApprove(req)}
                                    className="btn-secondary"
                                  >
                                    Approve as VP
                                  </button>
                                ) : (
                                  <span className="text-xs text-[var(--role-text)]/50">
                                    Waiting for VP approval
                                  </span>
                                )
                              ) : atPresident ? (
                                (user.role === 'president' || user.role === 'admin') ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleCoApprove(req)}
                                    className="btn-secondary"
                                  >
                                    Approve as President
                                  </button>
                                ) : (
                                  <span className="text-xs text-[var(--role-text)]/50">
                                    Waiting for President approval
                                  </span>
                                )
                              ) : (
                                <span className="text-xs text-[var(--role-text)]/50">
                                  Awaiting {needsPresident ? 'VP/President' : 'VP'} approval
                                </span>
                              )}
                            </div>
                          </div>
                        );
                        })()}

                        {disbursementDrafts[req.id]?.disbursement_method === 'petty_cash' && toNumber(budgetSummary?.petty_cash_balance) < requestAmount && (

                          <p className="mt-3 text-[10px] text-red-500 font-bold uppercase tracking-tighter flex items-center gap-1 animate-pulse">

                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">

                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />

                            </svg>

                            Warning: Request amount exceeds current Petty Cash balance.

                          </p>

                        )}

                      </div>

                    )}



                    {req.request_type !== 'travel_booking' && (

                    <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">

                      {(req.allocations || []).map((allocation: any) => (

                        <div key={`${req.id}-${allocation.department_id}`} className="panel-muted !p-4">

                          <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">{allocation.department_name}</p>

                          <p className="mt-2 text-lg font-semibold text-[var(--role-text)]">{displayMoney(toNumber(allocation.amount), requestCurrency)}</p>

                          <p className="mt-1 text-xs text-[var(--role-text)]/60">

                            Remaining {displayMoney(toNumber(allocation.remaining_budget), 'PHP')}

                          </p>

                          <p className="mt-1 text-xs text-[var(--role-text)]/60">

                            Projected {displayMoney(toNumber(allocation.projected_remaining_budget), 'PHP')}

                          </p>

                        </div>

                      ))}

                    </div>

                    )}

                    {req.status === 'released' && (
                      <div className="mb-5 rounded-[24px] border border-emerald-200 bg-emerald-50/30 p-4">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-lg font-semibold text-[var(--role-text)]">Disbursement Records</h3>
                          <span className="rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-700">
                            Released
                          </span>
                        </div>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <div className="panel-muted !p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">Disbursement Method</p>
                            <p className="mt-2 text-sm font-semibold text-[var(--role-text)] capitalize">{req.release_method || req.disbursement_method || '—'}</p>
                          </div>
                          <div className="panel-muted !p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">Reference No.</p>
                            <p className="mt-2 text-sm font-semibold text-[var(--role-text)]">{req.release_reference_no || req.disbursement_reference_no || '—'}</p>
                          </div>
                          <div className="panel-muted !p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">Released At</p>
                            <p className="mt-2 text-sm font-semibold text-[var(--role-text)]">{req.released_at ? formatDateTime(req.released_at) : '—'}</p>
                          </div>
                          <div className="panel-muted !p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">Amount Released</p>
                            <p className="mt-2 text-sm font-semibold text-[var(--role-text)]">{displayMoney(requestAmount, requestCurrency)}</p>
                          </div>
                        </div>
                        {req.release_note && (
                          <div className="mt-3 panel-muted !p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">Disbursement Note</p>
                            <p className="mt-1 text-sm text-[var(--role-text)]/70">{req.release_note}</p>
                          </div>
                        )}
                        {req.liquidation_due_at && (
                          <div className="mt-2 panel-muted !p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">Liquidation Due</p>
                            <p className="mt-1 text-sm font-semibold text-amber-600">{formatDateTime(req.liquidation_due_at)}</p>
                          </div>
                        )}
                      </div>
                    )}



                    <div className="flex flex-wrap gap-3">
                      {/* VP/President/Supervisor/Admin/Accounting - Approval Actions */}
                      {(user.role === 'vp' || user.role === 'president' || user.role === 'supervisor' || user.role === 'admin' || (user.role === 'accounting' && !req.co_approved_by)) && (
                        <>
                          {(() => {
                            const isBudgetFlow = req.request_type === 'budget_request' || req.request_type === 'budget_revision';
                            // VP always marks budget proposals as viewed (President does final approval)
                            const vpMarkViewed = user.role === 'vp' && req.status === 'pending_vp' && isBudgetFlow;
                            const canActAtStage =
                              (user.role === 'supervisor' && req.status === 'pending_supervisor') ||
                              (user.role === 'accounting' && req.status === 'pending_accounting' && !req.co_approved_by) ||
                              (user.role === 'vp' && req.status === 'pending_vp') ||
                              (user.role === 'president' && req.status === 'pending_president') ||
                              (user.role === 'admin' && ['pending_supervisor', 'pending_accounting', 'pending_vp', 'pending_president'].includes(req.status) && !req.co_approved_by);
                            if (!canActAtStage) return null;
                            return (
                          <button 
                            onClick={() => void handleApprove(req)} 
                            className={`${vpMarkViewed ? 'btn-secondary' : 'btn-success'} disabled:opacity-50 disabled:cursor-not-allowed`}
                            disabled={req.status === 'on_hold'}
                            title={
                              req.status === 'on_hold'
                                ? 'Cannot approve - request is On Hold'
                                : undefined
                            }
                          >
                            {vpMarkViewed ? 'Mark as Viewed' : 'Approve'}
                          </button>
                            );
                          })()}

                          <button
                            onClick={() => {
                              setModalConfig({
                                isOpen: true,
                                requestId: req.id,
                                type: 'reject',
                                title: 'Reject Request',
                                message: 'Provide a reason for rejecting this request. This will be visible to the requester.',
                                placeholder: 'Enter rejection reason...',
                                confirmLabel: 'Reject Request'
                              });
                            }}
                            className="btn-danger"
                          >
                            Reject
                          </button>

                          <button
                            onClick={() => {
                              setModalConfig({
                                isOpen: true,
                                requestId: req.id,
                                type: 'return',
                                title: 'Return for Revision',
                                message: 'Explain what needs to be corrected before this request can move forward.',
                                placeholder: 'Enter the revision details or reason for return...',
                                confirmLabel: 'Send Back'
                              });

                        }}

                        className="btn-secondary"

                      >

                        Return for Revision
                      </button>

                      {/* On Hold - VP/President/Admin only */}
                      {(user.role === 'vp' || user.role === 'president' || user.role === 'supervisor' || user.role === 'admin') && (
                        <button
                          onClick={() => {
                            if (req.status === 'on_hold') {
                              handleOnHold(req.id, '');
                            } else {
                              setModalConfig({
                                isOpen: true,
                                requestId: req.id,
                                type: 'on_hold',
                                title: 'Place Request On Hold',
                                message: 'Please provide a reason for placing this request on hold:',
                                placeholder: 'Enter reason...',
                                confirmLabel: 'Place On Hold'
                              });
                            }
                          }}
                          className={`px-4 py-2 rounded-2xl text-sm font-semibold transition ${
                            req.status === 'on_hold'
                              ? 'bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200'
                              : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-amber-50'
                          }`}
                          title={req.status === 'on_hold' ? 'Remove from On Hold' : 'Place On Hold'}
                        >
                          {req.status === 'on_hold' ? (
                            <span className="flex items-center gap-2">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              On Hold
                            </span>
                          ) : (
                            <span className="flex items-center gap-2">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Place On Hold
                            </span>
                          )}
                        </button>
                      )}
                      </>
                    )}

                    {/* Accounting/Admin - Release Only (No Approval Power) */}
                    {/* Show release button if: co-approved OR amount is under threshold (no co-approval needed) */}
                    {(() => {
                      const canRelease = !!req.co_approved_by;
                      
                      if ((user.role === 'accounting' || user.role === 'admin') && canRelease) {
                        return (
                          <button 
                            onClick={() => void handleApprove(req)} 
                            className="btn-success"
                            disabled={req.status === 'on_hold'}
                            title={req.status === 'on_hold' ? 'Cannot release - request is On Hold' : 'Release funds to employee'}
                          >
                            Release Funds
                          </button>
                        );
                      }
                      return null;
                    })()}
                    </div>

                  </div>

                </div>

              </div>

            );

          })}

              

              {/* Pagination */}

              {totalPages > 1 && (

                <div className="flex items-center justify-between pt-4 border-t border-[var(--role-border)]">

                  <p className="text-sm text-[var(--role-text)]/60">

                    Showing {startIndex + 1} to {Math.min(startIndex + pageSize, cardRequests.length)} of {cardRequests.length} requests

                  </p>

                  <div className="flex items-center gap-2">

                    <button

                      onClick={() => setCurrentPage((p: number) => Math.max(1, p - 1))}

                      disabled={currentPage === 1}

                      className="px-3 py-1.5 rounded-lg border border-[var(--role-border)] bg-[var(--role-accent)] text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--role-accent)]/80 transition"

                    >

                      Previous

                    </button>

                    <span className="text-sm text-[var(--role-text)]/80 px-2">

                      Page {currentPage} of {totalPages}

                    </span>

                    <button

                      onClick={() => setCurrentPage((p: number) => Math.min(totalPages, p + 1))}

                      disabled={currentPage === totalPages}

                      className="px-3 py-1.5 rounded-lg border border-[var(--role-border)] bg-[var(--role-accent)] text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--role-accent)]/80 transition"

                    >

                      Next

                    </button>

                  </div>

                </div>

              )}

            </div>

          );

        })()

      )}



      <Modal

        isOpen={modalConfig.isOpen}

        onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}

        onConfirm={(value: string) => {

          if (modalConfig.type === 'reject') {

            void handleReject(modalConfig.requestId, value);

          } else if (modalConfig.type === 'on_hold') {

            void handleOnHold(modalConfig.requestId, value);

          } else if (modalConfig.type === 'confirm_allocation') {

            void handleConfirmAllocation(modalConfig.requestId);

          } else {

            void handleReturn(modalConfig.requestId, value);

          }

          setModalConfig(prev => ({ ...prev, isOpen: false }));

        }}

        title={modalConfig.title}

        message={modalConfig.message}

        placeholder={modalConfig.placeholder}

        confirmLabel={modalConfig.confirmLabel}

        cancelLabel="Cancel"

        type={modalConfig.type === 'confirm_allocation' ? 'confirm' : 'prompt'}

      />

      {previewFile && (

        <FilePreviewer

          isOpen={!!previewFile}

          onClose={() => setPreviewFile(null)}

          fileUrl={previewFile.url}

          fileName={previewFile.name}

        />

      )}



    </div>

  );

};



export default Approvals;

