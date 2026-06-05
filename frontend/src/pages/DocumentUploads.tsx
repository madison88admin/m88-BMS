import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api';
import FilePreviewer from '../components/FilePreviewer';
import Modal from '../components/Modal';
import PageSkeleton from '../components/Skeleton';
import { formatDateTime, formatMoney, getErrorMessage } from '../utils/format';

interface OfficialExpense {
  code: string;
  itemName: string;
  category: string;
  dept: string | string[];
  canCA: boolean;
  canRE: boolean;
  mannerOfSubmission?: 'for_submission' | 'for_upload';
}

interface DocumentUploadAttachment {
  id: string;
  document_upload_id: string;
  file_name: string;
  file_url: string;
  file_type: string;
  file_size: number | null;
  created_at: string;
}

interface DocumentUpload {
  id: string;
  category_code: string;
  category_name: string;
  main_category_code: string | null;
  main_category_name: string | null;
  department_id: string;
  uploaded_by: string;
  uploaded_by_role: string | null;
  description: string;
  amount: number | null;
  fiscal_year: number | null;
  status: string;
  accounting_remarks: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  attachments: DocumentUploadAttachment[];
  budget_amount?: number | null;
  current_used_amount?: number | null;
  current_remaining_amount?: number | null;
  adjustment_type?: string | null;
}

const DocumentUploads = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [officialList, setOfficialList] = useState<OfficialExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'submit' | 'history'>('submit');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [mainCategory, setMainCategory] = useState('');
  const [selectedCode, setSelectedCode] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [adjustmentType, setAdjustmentType] = useState<'increase' | 'decrease' | 'reallocation'>('increase');
  const [submitting, setSubmitting] = useState(false);
  const [uploads, setUploads] = useState<DocumentUpload[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'submitted_to_accounting' | 'acknowledged' | 'returned'>('all');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [dateRangeFilter, setDateRangeFilter] = useState({ start: '', end: '' });
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string } | null>(null);
  const [selectedUpload, setSelectedUpload] = useState<DocumentUpload | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ status: 'acknowledged' | 'returned'; uploadId: string } | null>(null);
  const [targetDepartmentId, setTargetDepartmentId] = useState<string>('');
  const [currentBudgetInfo, setCurrentBudgetInfo] = useState<any>(null);

  const fiscalYear = 2026;
  const isReviewRole = user?.role === 'accounting';

  const uniqueMainCategories = useMemo(() => {
    const categories = new Set<string>();
    officialList.forEach((item) => {
      if (item.category) categories.add(item.category);
    });
    return Array.from(categories).sort();
  }, [officialList]);

  const itemsByMainCategory = useMemo(() => {
    if (!mainCategory) return [];
    return officialList
      .filter((item) => item.category === mainCategory)
      .sort((a, b) => a.itemName.localeCompare(b.itemName));
  }, [officialList, mainCategory]);

  const departmentNameById = useMemo(() => {
    const map = new Map<string, string>();
    departments.forEach((dept) => map.set(dept.id, dept.name));
    return map;
  }, [departments]);

  const statusLabel = (status: string) => {
    if (status === 'submitted_to_accounting') return 'Submitted to Accounting';
    if (status === 'acknowledged') return 'Acknowledged';
    if (status === 'returned') return 'Returned';
    return status;
  };

  const fetchCurrentBudgetInfo = async (departmentId: string, categoryCode: string) => {
    try {
      if (!departmentId || !categoryCode) {
        setCurrentBudgetInfo(null);
        return;
      }

      const params = new URLSearchParams();
      params.set('department_id', departmentId);
      params.set('fiscal_year', String(fiscalYear));

      const res = await api.get(`/api/budget/categories?${params.toString()}`);
      const category = Array.isArray(res.data)
        ? res.data.find((c: any) => String(c.category_code) === String(categoryCode))
        : null;

      setCurrentBudgetInfo(category || null);
    } catch (err: any) {
      console.error('Failed to fetch current budget info:', err);
    }
  };

  const fetchHistory = async (showError = true) => {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('fiscal_year', String(fiscalYear));
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (departmentFilter) params.set('department_id', departmentFilter);
      if (categoryFilter) params.set('category_code', categoryFilter);
      if (dateRangeFilter.start) params.set('start_date', dateRangeFilter.start);
      if (dateRangeFilter.end) params.set('end_date', dateRangeFilter.end);
      const res = await api.get(`/api/document-uploads?${params.toString()}`, {
        });
      setUploads(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      if (showError) toast.error(getErrorMessage(err, 'Failed to load budget override data'));
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDepartment) {
      toast.error('Please select a department');
      return;
    }
    if (!mainCategory) {
      toast.error('Please select a main category');
      return;
    }
    if (!selectedCode) {
      toast.error('Please select a sub-category');
      return;
    }
    if (!amount || Number.parseFloat(amount) <= 0) {
      toast.error('Please enter a valid override amount');
      return;
    }

    setSubmitting(true);
    try {
      const overrideAmount = Number.parseFloat(amount);

      await api.post('/api/document-uploads', {
        category_code: selectedCode,
        department_id: selectedDepartment,
        description,
        amount: overrideAmount,
        fiscal_year: fiscalYear,
        adjustment_type: adjustmentType,
      });

      toast.success('Budget override submitted successfully');
      setSelectedDepartment('');
      setMainCategory('');
      setSelectedCode('');
      setDescription('');
      setAmount('');
      setAdjustmentType('increase');
      setCurrentBudgetInfo(null);
      setActiveTab('history');
      await fetchHistory(false);
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to submit budget override'));
    } finally {
      setSubmitting(false);
    }
  };

  const submitReview = async (payload: { uploadId: string; status: 'acknowledged' | 'returned'; remarks?: string; target_department_id?: string }) => {
    try {
      const res = await api.patch(
        `/api/document-uploads/${payload.uploadId}/review`,
        { 
          status: payload.status, 
          remarks: payload.remarks || '',
          target_department_id: payload.target_department_id
        }
      );
      const updated = res.data as DocumentUpload;
      setUploads((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      setSelectedUpload(updated);
      toast.success('Review saved');
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to save review'));
    }
  };

  useEffect(() => {
    if (!localStorage.getItem('token')) {
      navigate('/login');
      return;
    }

    const bootstrap = async () => {
      try {
        const [meRes, departmentsRes, officialRes] = await Promise.all([
          api.get('/api/auth/me'),
          api.get('/api/departments'),
          api.get('/api/requests/official-list?manner_of_submission=for_upload'),
        ]);
        setUser(meRes.data);
        setDepartments(Array.isArray(departmentsRes.data) ? departmentsRes.data : []);
        setOfficialList(Array.isArray(officialRes.data) ? officialRes.data : []);
      } catch (err: any) {
        toast.error(getErrorMessage(err, 'Failed to load budget override form'));
      } finally {
        setLoading(false);
      }
    };

    void bootstrap();
  }, [navigate]);

  useEffect(() => {
    if (activeTab !== 'history') return;
    void fetchHistory(false);
  }, [activeTab, statusFilter, departmentFilter, categoryFilter, dateRangeFilter]);

  useEffect(() => {
    if (selectedDepartment && selectedCode) {
      void fetchCurrentBudgetInfo(selectedDepartment, selectedCode);
      return;
    }
    setCurrentBudgetInfo(null);
  }, [selectedDepartment, selectedCode]);

  if (loading) {
    return <PageSkeleton />;
  }

  // Restrict access to accounting personnel only
  if (user?.role !== 'accounting') {
    return (
      <div className="text-[var(--role-text)] page-transition">
        <div className="page-header">
          <h1 className="page-title">Access Denied</h1>
          <p className="page-subtitle">Budget override is only available to accounting personnel</p>
        </div>
        <div className="rounded-xl border border-red-300 bg-red-50 p-6 max-w-2xl">
          <p className="text-red-700 mb-4">You do not have permission to access this page.</p>
          <button
            onClick={() => navigate('/overview')}
            className="btn-primary"
          >
            Back to Overview
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="text-[var(--role-text)] page-transition">
      <div className="page-header">
        <h1 className="page-title">Budget Override</h1>
        <p className="page-subtitle">Create a budget override request for accounting review</p>
      </div>

      <div className="flex gap-2 mb-6">
        {[
          { key: 'submit', label: 'Submit Override' },
          { key: 'history', label: 'History' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as 'submit' | 'history')}
            className={`px-6 py-3 rounded-2xl font-medium transition-all flex items-center gap-2 ${
              activeTab === tab.key
                ? 'bg-[var(--role-primary)] text-white shadow-lg'
                : 'bg-[var(--role-surface)] border border-[var(--role-border)] text-[var(--role-text)]/70 hover:bg-[var(--role-accent)]'
            }`}
          >
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {activeTab === 'submit' && (
        <form onSubmit={handleSubmit} className="panel max-w-3xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2">Uploader</label>
              <input
                value={user?.name || user?.email || ''}
                disabled
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Fiscal Year</label>
              <input
                value={String(fiscalYear)}
                disabled
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-gray-100"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Department *</label>
            <select
              required
              value={selectedDepartment}
              onChange={(e) => {
                setSelectedDepartment(e.target.value);
                setMainCategory('');
                setSelectedCode('');
                setCurrentBudgetInfo(null);
              }}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
            >
              <option value="">Select department...</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>{dept.name}</option>
              ))}
            </select>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Main Category *</label>
            <select
              required
              value={mainCategory}
              onChange={(e) => {
                setMainCategory(e.target.value);
                setSelectedCode('');
                setCurrentBudgetInfo(null);
              }}
              disabled={!selectedDepartment}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] disabled:bg-gray-100"
            >
              <option value="">Select main category...</option>
              {uniqueMainCategories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Sub-category *</label>
            <select
              required
              value={selectedCode}
              onChange={(e) => setSelectedCode(e.target.value)}
              disabled={!mainCategory}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] disabled:bg-gray-100"
            >
              <option value="">Select sub-category...</option>
              {itemsByMainCategory.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.code} — {item.itemName}
                </option>
              ))}
            </select>
          </div>

          {currentBudgetInfo && (
            <div className="mb-4 rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)] p-4">
              <h3 className="text-sm font-semibold mb-3">Current Budget Info</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-[var(--role-text)]/60">Approved Budget</p>
                  <p className="font-semibold">{formatMoney(currentBudgetInfo.budget_amount || 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--role-text)]/60">Used</p>
                  <p className="font-semibold">{formatMoney(currentBudgetInfo.used_amount || 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--role-text)]/60">Committed</p>
                  <p className="font-semibold">{formatMoney(currentBudgetInfo.committed_amount || 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--role-text)]/60">Remaining</p>
                  <p className="font-semibold">{formatMoney(currentBudgetInfo.remaining_amount || 0)}</p>
                </div>
                <div className="col-span-2 md:col-span-1">
                  <p className="text-xs text-[var(--role-text)]/60">Utilization</p>
                  <p className="font-semibold">
                    {currentBudgetInfo.budget_amount 
                      ? `${((currentBudgetInfo.used_amount || 0) / currentBudgetInfo.budget_amount * 100).toFixed(1)}%`
                      : '0%'}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Adjustment Type *</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  value="increase"
                  checked={adjustmentType === 'increase'}
                  onChange={(e) => setAdjustmentType(e.target.value as any)}
                  className="w-4 h-4"
                />
                <span className="text-sm">Budget Increase</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  value="decrease"
                  checked={adjustmentType === 'decrease'}
                  onChange={(e) => setAdjustmentType(e.target.value as any)}
                  className="w-4 h-4"
                />
                <span className="text-sm">Budget Decrease</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  value="reallocation"
                  checked={adjustmentType === 'reallocation'}
                  onChange={(e) => setAdjustmentType(e.target.value as any)}
                  className="w-4 h-4"
                />
                <span className="text-sm">Budget Reallocation</span>
              </label>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Override Amount *</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--role-text)]/50 text-sm">₱</span>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full pl-8 pr-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
                placeholder="Enter new budget amount"
              />
            </div>
          </div>

          {currentBudgetInfo && amount && (
            <div className="mb-4 rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)] p-4">
              <h3 className="text-sm font-semibold mb-3">Before & After Preview</h3>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-[var(--role-text)]/60">Before</p>
                  <p className="font-semibold">{formatMoney(currentBudgetInfo.remaining_amount || 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--role-text)]/60">New Budget</p>
                  <p className="font-semibold">{formatMoney(Number.parseFloat(amount))}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--role-text)]/60">Change</p>
                  <p className={`font-semibold ${Number.parseFloat(amount) > (currentBudgetInfo.remaining_amount || 0) ? 'text-green-600' : 'text-red-600'}`}>
                    {Number.parseFloat(amount) > (currentBudgetInfo.remaining_amount || 0) ? '+' : ''}
                    {formatMoney(Number.parseFloat(amount) - (currentBudgetInfo.remaining_amount || 0))}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Description / Remarks (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] min-h-[100px]"
              placeholder="Add notes explaining the budget adjustment..."
            />
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={() => navigate('/tracker')} className="btn-secondary px-8">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="btn-primary px-8 flex-1">
              {submitting ? 'Submitting...' : 'Submit Budget Override'}
            </button>
          </div>
        </form>
      )}

      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="panel">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="flex flex-wrap gap-2">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">Department</label>
                  <select
                    value={departmentFilter}
                    onChange={(e) => setDepartmentFilter(e.target.value)}
                    className="w-full md:w-48 px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
                  >
                    <option value="">All Departments</option>
                    {departments.map((dept) => (
                      <option key={dept.id} value={dept.id}>{dept.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">Category</label>
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="w-full md:w-48 px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
                  >
                    <option value="">All Categories</option>
                    {uniqueMainCategories.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">Status</label>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                    className="w-full md:w-48 px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
                  >
                    <option value="all">All</option>
                    <option value="submitted_to_accounting">Submitted to Accounting</option>
                    <option value="acknowledged">Acknowledged</option>
                    <option value="returned">Returned</option>
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">Date Range</label>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={dateRangeFilter.start}
                      onChange={(e) => setDateRangeFilter({ ...dateRangeFilter, start: e.target.value })}
                      className="px-3 py-2 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                    />
                    <input
                      type="date"
                      value={dateRangeFilter.end}
                      onChange={(e) => setDateRangeFilter({ ...dateRangeFilter, end: e.target.value })}
                      className="px-3 py-2 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => fetchHistory()} className="btn-secondary px-6">
                  Refresh
                </button>
              </div>
            </div>
          </div>

          {historyLoading ? (
            <div className="space-y-4 py-10">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-16 rounded-3xl bg-slate-200/80 dark:bg-slate-700/80 animate-pulse"></div>
              ))}
            </div>
          ) : uploads.length === 0 ? (
            <div className="panel text-center py-14">
              <p className="text-sm text-[var(--role-text)]/70">No budget allocation records found for fiscal year {fiscalYear}.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--role-border)]">
                    <th className="text-left px-4 py-3 text-sm font-semibold">Date</th>
                    <th className="text-left px-4 py-3 text-sm font-semibold">Department</th>
                    <th className="text-left px-4 py-3 text-sm font-semibold">Category</th>
                    <th className="text-right px-4 py-3 text-sm font-semibold">Old Amount</th>
                    <th className="text-right px-4 py-3 text-sm font-semibold">New Amount</th>
                    <th className="text-right px-4 py-3 text-sm font-semibold">Change</th>
                    <th className="text-left px-4 py-3 text-sm font-semibold">Adjustment Type</th>
                    <th className="text-left px-4 py-3 text-sm font-semibold">Changed By</th>
                    <th className="text-left px-4 py-3 text-sm font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {uploads.map((upload) => (
                    <tr
                      key={upload.id}
                      onClick={() => {
                        setSelectedUpload(upload);
                        setShowDetails(true);
                      }}
                      className="border-b border-[var(--role-border)] hover:bg-[var(--role-accent)] cursor-pointer"
                    >
                      <td className="px-4 py-3 text-sm">{upload.created_at ? formatDateTime(upload.created_at) : '—'}</td>
                      <td className="px-4 py-3 text-sm">{departmentNameById.get(upload.department_id) || upload.department_id}</td>
                      <td className="px-4 py-3 text-sm">{upload.category_code} — {upload.category_name}</td>
                      <td className="px-4 py-3 text-sm text-right">{upload.current_remaining_amount != null ? formatMoney(upload.current_remaining_amount) : '—'}</td>
                      <td className="px-4 py-3 text-sm text-right">{upload.amount ? formatMoney(upload.amount) : '—'}</td>
                      <td className={`px-4 py-3 text-sm text-right ${upload.amount && upload.amount > (upload.current_remaining_amount || 0) ? 'text-green-600' : 'text-red-600'}`}>
                        {upload.amount && upload.current_remaining_amount != null
                          ? (upload.amount > upload.current_remaining_amount ? '+' : '') + formatMoney(upload.amount - upload.current_remaining_amount)
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm capitalize">{upload.adjustment_type || '—'}</td>
                      <td className="px-4 py-3 text-sm">{upload.uploaded_by || '—'}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className="inline-flex items-center rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] px-3 py-1 text-xs font-semibold">
                          {statusLabel(upload.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showDetails && selectedUpload && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowDetails(false)} />
          <div className="relative w-full max-w-3xl overflow-hidden rounded-[32px] border border-[var(--role-border)] bg-[var(--bms-bg-1)] shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--role-border)] p-6">
              <div className="min-w-0">
                <h3 className="text-xl font-bold truncate text-[var(--role-text)]">
                  {selectedUpload.category_code} — {selectedUpload.category_name}
                </h3>
                <p className="mt-1 text-sm text-[var(--role-text)]/70">{statusLabel(selectedUpload.status)}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowDetails(false)}
                className="rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] p-2 hover:bg-[var(--role-accent)]/80"
              >
                <svg className="h-5 w-5 text-[var(--role-text)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)] p-4">
                  <p className="text-xs uppercase tracking-wide text-[var(--role-text)]/50">Department</p>
                  <p className="mt-1 font-semibold">{departmentNameById.get(selectedUpload.department_id) || selectedUpload.department_id}</p>
                </div>
                <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)] p-4">
                  <p className="text-xs uppercase tracking-wide text-[var(--role-text)]/50">Amount</p>
                  <p className="mt-1 font-semibold">{selectedUpload.amount ? formatMoney(selectedUpload.amount) : '—'}</p>
                </div>
                <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)] p-4">
                  <p className="text-xs uppercase tracking-wide text-[var(--role-text)]/50">Remaining</p>
                  <p className="mt-1 font-semibold">{selectedUpload.current_remaining_amount != null ? formatMoney(selectedUpload.current_remaining_amount) : '—'}</p>
                </div>
                <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)] p-4">
                  <p className="text-xs uppercase tracking-wide text-[var(--role-text)]/50">Submitted</p>
                  <p className="mt-1 font-semibold">{selectedUpload.created_at ? formatDateTime(selectedUpload.created_at) : '—'}</p>
                </div>
                <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)] p-4">
                  <p className="text-xs uppercase tracking-wide text-[var(--role-text)]/50">Fiscal Year</p>
                  <p className="mt-1 font-semibold">{selectedUpload.fiscal_year || '—'}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4">
                <p className="text-sm font-semibold mb-2">Description</p>
                <p className="text-sm text-[var(--role-text)]/80 whitespace-pre-wrap">{selectedUpload.description}</p>
              </div>

              {selectedUpload.accounting_remarks && (
                <div className="rounded-2xl border border-amber-400/40 bg-amber-50/60 p-4">
                  <p className="text-sm font-semibold mb-2 text-amber-800">Accounting Remarks</p>
                  <p className="text-sm text-amber-800/90 whitespace-pre-wrap">{selectedUpload.accounting_remarks}</p>
                </div>
              )}

              <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4">
                <p className="text-sm font-semibold mb-3">Attachments</p>
                {(selectedUpload.attachments || []).length === 0 ? (
                  <p className="text-sm text-[var(--role-text)]/70">No attachments.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {selectedUpload.attachments.map((att) => (
                      <button
                        key={att.id}
                        type="button"
                        onClick={() => setPreviewFile({ url: att.file_url, name: att.file_name })}
                        className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)] px-4 py-3 text-left hover:bg-[var(--role-accent)]/80"
                      >
                        <p className="text-sm font-semibold truncate">{att.file_name}</p>
                        <p className="mt-1 text-xs text-[var(--role-text)]/60">{att.file_type.toUpperCase()}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {isReviewRole && (
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    type="button"
                    disabled={selectedUpload.status === 'acknowledged'}
                    onClick={() => {
                      setTargetDepartmentId('');
                      setConfirmAction({ status: 'acknowledged', uploadId: selectedUpload.id });
                    }}
                    className="btn-success flex-1"
                  >
                    Acknowledge
                  </button>
                  <button
                    type="button"
                    disabled={selectedUpload.status === 'acknowledged'}
                    onClick={() => setConfirmAction({ status: 'returned', uploadId: selectedUpload.id })}
                    className="btn-danger flex-1"
                  >
                    Return
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {previewFile && (
        <FilePreviewer
          isOpen={Boolean(previewFile)}
          onClose={() => setPreviewFile(null)}
          fileUrl={previewFile.url}
          fileName={previewFile.name}
        />
      )}

      {confirmAction?.status === 'acknowledged' && (
        <Modal
          isOpen={true}
          onClose={() => setConfirmAction(null)}
          onConfirm={async () => {
            await submitReview({ 
              uploadId: confirmAction.uploadId, 
              status: 'acknowledged',
              target_department_id: targetDepartmentId || undefined
            });
            setConfirmAction(null);
            setTargetDepartmentId('');
          }}
          title="Acknowledge Upload"
          message={
            <div className="space-y-4">
              <p>Mark this upload as acknowledged?</p>
              <div>
                <label className="block text-sm font-medium mb-2">Override Department (optional)</label>
                <select
                  value={targetDepartmentId}
                  onChange={(e) => setTargetDepartmentId(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-accent)]"
                >
                  <option value="">Use original department</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[var(--role-text)]/60 mt-1">
                  Leave empty to deduct from the original department's budget
                </p>
              </div>
            </div>
          }
          confirmLabel="Acknowledge"
          type="confirm"
        />
      )}

      {confirmAction?.status === 'returned' && (
        <Modal
          isOpen={true}
          onClose={() => setConfirmAction(null)}
          onConfirm={async (remarks) => {
            if (!String(remarks || '').trim()) {
              toast.error('Remarks are required');
              return;
            }
            await submitReview({ uploadId: confirmAction.uploadId, status: 'returned', remarks });
            setConfirmAction(null);
          }}
          title="Return Upload"
          message="Provide remarks for the uploader."
          confirmLabel="Return"
          placeholder="Enter remarks..."
          type="prompt"
        />
      )}
    </div>
  );
};

export default DocumentUploads;

