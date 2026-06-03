import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api';
import FilePreviewer from '../components/FilePreviewer';
import Modal from '../components/Modal';
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
}

const resolveUploadFileType = (file: File) => {
  const mime = String(file.type || '').toLowerCase();
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  const ext = String(file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'png') return 'png';
  if (ext === 'jpeg' || ext === 'jpg') return 'jpg';
  return '';
};

const DocumentUploads = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [officialList, setOfficialList] = useState<OfficialExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'submit' | 'history'>('submit');
  const [mainCategory, setMainCategory] = useState('');
  const [selectedCode, setSelectedCode] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploads, setUploads] = useState<DocumentUpload[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'submitted_to_accounting' | 'acknowledged' | 'returned'>('all');
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string } | null>(null);
  const [selectedUpload, setSelectedUpload] = useState<DocumentUpload | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ status: 'acknowledged' | 'returned'; uploadId: string } | null>(null);

  const fiscalYear = 2026;
  const isReviewRole = user?.role === 'accounting' || user?.role === 'admin' || user?.role === 'super_admin';

  const selectedItem = useMemo(
    () => officialList.find((item) => item.code === selectedCode),
    [officialList, selectedCode]
  );

  const requiresAmount = Boolean(selectedItem?.canCA || selectedItem?.canRE);

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

  const uploadSupportingFile = async (file: File) => {
    const token = localStorage.getItem('token');
    if (!token) throw new Error('Not authenticated');
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post('/api/upload', formData, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  };

  const fetchHistory = async (showError = true) => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('fiscal_year', String(fiscalYear));
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await api.get(`/api/document-uploads?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUploads(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      if (showError) toast.error(getErrorMessage(err, 'Failed to load document uploads'));
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCode) {
      toast.error('Please select a sub-category');
      return;
    }
    if (!description.trim()) {
      toast.error('Please enter description / remarks');
      return;
    }
    if (!files.length) {
      toast.error('Please attach at least one file');
      return;
    }
    if (requiresAmount) {
      const value = Number.parseFloat(amount);
      if (!Number.isFinite(value) || value <= 0) {
        toast.error('Please enter a valid amount');
        return;
      }
    }

    setSubmitting(true);
    const token = localStorage.getItem('token');
    try {
      const attachments: any[] = [];
      for (const file of files) {
        const fileType = resolveUploadFileType(file);
        if (!fileType) {
          toast.error(`Unsupported file type: ${file.name}`);
          continue;
        }
        const uploaded = await uploadSupportingFile(file);
        attachments.push({
          ...uploaded,
          attachment_scope: 'document_upload',
          file_type: fileType,
          file_size: file.size,
        });
      }

      if (!attachments.length) {
        toast.error('No valid attachments were uploaded');
        return;
      }

      await api.post(
        '/api/document-uploads',
        {
          category_code: selectedCode,
          description,
          amount: amount ? Number.parseFloat(amount) : null,
          fiscal_year: fiscalYear,
          attachments,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      toast.success('Document upload submitted to accounting');
      setMainCategory('');
      setSelectedCode('');
      setDescription('');
      setAmount('');
      setFiles([]);
      setActiveTab('history');
      await fetchHistory(false);
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to submit document upload'));
    } finally {
      setSubmitting(false);
    }
  };

  const submitReview = async (payload: { uploadId: string; status: 'acknowledged' | 'returned'; remarks?: string }) => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await api.patch(
        `/api/document-uploads/${payload.uploadId}/review`,
        { status: payload.status, remarks: payload.remarks || '' },
        { headers: { Authorization: `Bearer ${token}` } }
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
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }

    const bootstrap = async () => {
      try {
        const [meRes, departmentsRes, officialRes] = await Promise.all([
          api.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }),
          api.get('/api/departments', { headers: { Authorization: `Bearer ${token}` } }),
          api.get('/api/requests/official-list?manner_of_submission=for_upload', { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        setUser(meRes.data);
        setDepartments(Array.isArray(departmentsRes.data) ? departmentsRes.data : []);
        setOfficialList(Array.isArray(officialRes.data) ? officialRes.data : []);
      } catch (err: any) {
        toast.error(getErrorMessage(err, 'Failed to load document upload form'));
      } finally {
        setLoading(false);
      }
    };

    void bootstrap();
  }, [navigate]);

  useEffect(() => {
    if (activeTab !== 'history') return;
    void fetchHistory(false);
  }, [activeTab, statusFilter]);

  useEffect(() => {
    if (!requiresAmount) {
      setAmount('');
    }
  }, [requiresAmount]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="bms-spinner"></div>
      </div>
    );
  }

  return (
    <div className="text-[var(--role-text)] page-transition">
      <div className="page-header">
        <h1 className="page-title">Document Uploads</h1>
        <p className="page-subtitle">Submit supporting documents and track accounting review</p>
      </div>

      <div className="flex gap-2 mb-6">
        {[
          { key: 'submit', label: 'Submit Upload' },
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
            <label className="block text-sm font-medium mb-2">Main Category *</label>
            <select
              required
              value={mainCategory}
              onChange={(e) => {
                setMainCategory(e.target.value);
                setSelectedCode('');
              }}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2">Amount {requiresAmount ? '*' : '(Optional)'}</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--role-text)]/50 text-sm">₱</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required={requiresAmount}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full pl-8 pr-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
                  placeholder={requiresAmount ? '0.00' : 'Optional'}
                />
              </div>
              {selectedItem && !requiresAmount && (
                <p className="mt-2 text-xs text-[var(--role-text)]/60">
                  Amount is optional for this category.
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Status</label>
              <input
                value="Submitted to Accounting"
                disabled
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-gray-100"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Description / Remarks *</label>
            <textarea
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] min-h-[100px]"
              placeholder="Add notes for accounting..."
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium mb-3">Attachments *</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              {files.map((file, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-[var(--role-accent)] border border-[var(--role-border)]">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <svg className="w-5 h-5 text-[var(--role-primary)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828L18 9.828M8 7v.01M10.5 21H19a2 2 0 002-2V8.414a1 1 0 00-.293-.707l-3.414-3.414A1 1 0 0016.586 4H10.5a2 2 0 00-2 2V7" />
                    </svg>
                    <span className="text-sm truncate">{file.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                    className="p-1 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>

            <div className="border-2 border-dashed border-[var(--role-border)] rounded-xl p-6 text-center hover:border-[var(--role-primary)]/50 transition-colors">
              <input
                type="file"
                multiple
                accept="image/*,.pdf"
                onChange={(e) => {
                  if (e.target.files) {
                    const incoming = Array.from(e.target.files);
                    setFiles((prev) => [...prev, ...incoming]);
                  }
                }}
                className="hidden"
                id="document-uploads-attachments"
              />
              <label htmlFor="document-uploads-attachments" className="cursor-pointer">
                <svg className="w-10 h-10 mx-auto mb-2 text-[var(--role-text)]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-[var(--role-text)]/60">Click to add PDF or images</p>
              </label>
            </div>
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={() => navigate('/tracker')} className="btn-secondary px-8">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="btn-primary px-8 flex-1">
              {submitting ? 'Submitting...' : 'Submit to Accounting'}
            </button>
          </div>
        </form>
      )}

      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="panel">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="w-full md:w-72 px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
                >
                  <option value="all">All</option>
                  <option value="submitted_to_accounting">Submitted to Accounting</option>
                  <option value="acknowledged">Acknowledged</option>
                  <option value="returned">Returned</option>
                </select>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => fetchHistory()} className="btn-secondary px-6">
                  Refresh
                </button>
              </div>
            </div>
          </div>

          {historyLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="bms-spinner"></div>
            </div>
          ) : uploads.length === 0 ? (
            <div className="panel text-center py-14">
              <p className="text-sm text-[var(--role-text)]/70">No document uploads found for fiscal year {fiscalYear}.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {uploads.map((upload) => (
                <button
                  key={upload.id}
                  type="button"
                  onClick={() => {
                    setSelectedUpload(upload);
                    setShowDetails(true);
                  }}
                  className="panel text-left hover:shadow-lg transition-shadow"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs text-[var(--role-text)]/60">Submitted {upload.created_at ? formatDateTime(upload.created_at) : ''}</p>
                      <h3 className="mt-1 text-lg font-semibold truncate">
                        {upload.category_code} — {upload.category_name}
                      </h3>
                      <p className="mt-1 text-sm text-[var(--role-text)]/70 truncate">{upload.description}</p>
                    </div>
                    <span className="inline-flex items-center rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] px-3 py-1 text-xs font-semibold">
                      {statusLabel(upload.status)}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-accent)] px-4 py-3">
                      <p className="text-xs uppercase tracking-wide text-[var(--role-text)]/50">Department</p>
                      <p className="mt-1 font-semibold truncate">{departmentNameById.get(upload.department_id) || upload.department_id}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-accent)] px-4 py-3">
                      <p className="text-xs uppercase tracking-wide text-[var(--role-text)]/50">Amount</p>
                      <p className="mt-1 font-semibold">{upload.amount ? formatMoney(upload.amount) : '—'}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-accent)] px-4 py-3">
                      <p className="text-xs uppercase tracking-wide text-[var(--role-text)]/50">Remaining</p>
                      <p className="mt-1 font-semibold">{upload.current_remaining_amount != null ? formatMoney(upload.current_remaining_amount) : '—'}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-[var(--role-text)]/60">
                    <span>{(upload.attachments || []).length} attachment(s)</span>
                    {upload.reviewed_at && <span>Reviewed {formatDateTime(upload.reviewed_at)}</span>}
                  </div>
                </button>
              ))}
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
                    onClick={() => setConfirmAction({ status: 'acknowledged', uploadId: selectedUpload.id })}
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
            await submitReview({ uploadId: confirmAction.uploadId, status: 'acknowledged' });
            setConfirmAction(null);
          }}
          title="Acknowledge Upload"
          message="Mark this upload as acknowledged?"
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

