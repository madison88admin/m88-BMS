import { useEffect, useMemo, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { formatMoney, toNumber, getErrorMessage } from '../utils/format';

interface Preset {
  parent_code: string;
  parent_name: string;
  category_code: string;
  category_name: string;
  default_dept: string;
}

const RECURRING_EXPENSE_PRESETS: Preset[] = [
  { parent_code: '6020', parent_name: 'Automobile Expense', category_code: '6020.1', category_name: 'Automobile Fuel', default_dept: 'All' },
  { parent_code: '6020', parent_name: 'Automobile Expense', category_code: '6020.2', category_name: 'Parking Fee', default_dept: 'All' },
  { parent_code: '6020', parent_name: 'Automobile Expense', category_code: '6020.3', category_name: 'Toll Expense', default_dept: 'All' },
  { parent_code: '6020', parent_name: 'Automobile Expense', category_code: '6020.5', category_name: 'Car Insurance', default_dept: 'Admin' },
  { parent_code: '6020', parent_name: 'Automobile Expense', category_code: '6020.6', category_name: 'Automobile Expenses-Registration', default_dept: 'Admin' },
  { parent_code: '6040', parent_name: 'Bank Service Charges', category_code: '6040', category_name: 'Bank Service Charges', default_dept: 'Accounting' },
  { parent_code: '6041', parent_name: 'Realized Forex Gain/Loss', category_code: '6041', category_name: 'Realized Forex Gain/Loss', default_dept: 'Accounting' },
  { parent_code: '6240', parent_name: 'Depreciation Expense', category_code: '6240', category_name: 'Depreciation Expense', default_dept: 'Accounting' },
  { parent_code: '6330', parent_name: 'Insurance Expense', category_code: '6330', category_name: 'Insurance Expense', default_dept: 'Admin' },
  { parent_code: '6340', parent_name: 'Interest Expense', category_code: '6340', category_name: 'Interest Expense', default_dept: 'Accounting' },
  { parent_code: '6670', parent_name: 'Professional Fees', category_code: '6670.01', category_name: 'Professional Fees - Accounting', default_dept: 'Accounting' },
  { parent_code: '6670', parent_name: 'Professional Fees', category_code: '6670.08', category_name: 'BIR Compliance Service', default_dept: 'Accounting' },
  { parent_code: '6670', parent_name: 'Professional Fees', category_code: '6670.1', category_name: 'DOLE Establishment Report & 13th', default_dept: 'Accounting' },
  { parent_code: '6670', parent_name: 'Professional Fees', category_code: '6670.12', category_name: 'Fire Safety Inspection Certificate', default_dept: 'Accounting' },
  { parent_code: '6670', parent_name: 'Professional Fees', category_code: '6670.18', category_name: 'Posted Transactions Adjustment', default_dept: 'Accounting' },
  { parent_code: '6670', parent_name: 'Professional Fees', category_code: '6670.24', category_name: 'Notarization fee', default_dept: 'Accounting' },
  { parent_code: '6710', parent_name: 'Rent Expense', category_code: '6711', category_name: 'Office Rent Expense', default_dept: 'Admin' },
  { parent_code: '6860', parent_name: 'Utilities', category_code: '6860.1', category_name: 'Electricity', default_dept: 'Admin' },
  { parent_code: '6860', parent_name: 'Utilities', category_code: '6860.2', category_name: 'Water', default_dept: 'Admin' },
  { parent_code: '6860', parent_name: 'Utilities', category_code: '6860.3', category_name: 'Utilities Others (Aircon etc)', default_dept: 'Admin' },
  { parent_code: '6870', parent_name: 'Communication', category_code: '6870.1', category_name: 'Globe', default_dept: 'All' },
  { parent_code: '6870', parent_name: 'Communication', category_code: '6870.2', category_name: 'Smart Bills', default_dept: 'All' },
  { parent_code: '6870', parent_name: 'Communication', category_code: '6870.3', category_name: 'PLDT Telephone', default_dept: 'Admin' },
  { parent_code: '6870', parent_name: 'Communication', category_code: '6870.5', category_name: 'Internet Subscription', default_dept: 'Admin' },
  { parent_code: '6350', parent_name: 'Taxes & Licenses', category_code: '6351', category_name: 'Business tax/Licenses', default_dept: 'Accounting' },
  { parent_code: '6350', parent_name: 'Taxes & Licenses', category_code: '6352', category_name: 'Income Tax', default_dept: 'Accounting' },
  // Payroll & Benefits
  { parent_code: '6600', parent_name: 'Payroll & Benefits', category_code: '66001', category_name: 'Payroll Expense Executive', default_dept: 'Accounting' },
  { parent_code: '6600', parent_name: 'Payroll & Benefits', category_code: '66002', category_name: 'Payroll Expense Accounting', default_dept: 'Accounting' },
  { parent_code: '6600', parent_name: 'Payroll & Benefits', category_code: '66003', category_name: 'Payroll Expense H.R.', default_dept: 'Accounting' },
  { parent_code: '6600', parent_name: 'Payroll & Benefits', category_code: '66004', category_name: 'Payroll Expense Logistics', default_dept: 'Accounting' },
  { parent_code: '6600', parent_name: 'Payroll & Benefits', category_code: '66005', category_name: 'Payroll Expense Planning', default_dept: 'Accounting' },
  { parent_code: '6600', parent_name: 'Payroll & Benefits', category_code: '66006', category_name: 'Payroll Expense Purchasing', default_dept: 'Accounting' },
  { parent_code: '6600', parent_name: 'Payroll & Benefits', category_code: '66007', category_name: 'Payroll Expense Costing', default_dept: 'Accounting' },
  { parent_code: '6600', parent_name: 'Payroll & Benefits', category_code: '66008', category_name: 'Payroll Expense I.T.', default_dept: 'Accounting' },
  { parent_code: '6600', parent_name: 'Payroll & Benefits', category_code: '66009', category_name: 'Payroll Expense OJT', default_dept: 'Accounting' },
  { parent_code: '6600', parent_name: 'Payroll & Benefits', category_code: '660010', category_name: 'Payroll Expense Supply Chain', default_dept: 'Accounting' },
  { parent_code: '6600', parent_name: 'Payroll & Benefits', category_code: '66012', category_name: 'Phil. Health Insurance', default_dept: 'Accounting' },
  { parent_code: '6600', parent_name: 'Payroll & Benefits', category_code: '66017', category_name: 'Home Development Company', default_dept: 'Accounting' },
  { parent_code: '6600', parent_name: 'Payroll & Benefits', category_code: '6606', category_name: 'Social Security Company', default_dept: 'Accounting' },
];

const TEMPLATE_STORAGE_KEY = 'bms_budget_expense_templates';

type Draft = { amount: string; description: string; date: string; category_code: string; category_name: string; parent_code?: string; parent_name?: string };

const today = () => new Date().toISOString().split('T')[0];

const BudgetExpenseUpload = () => {
  const [user, setUser] = useState<any>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>('');
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [directExpenses, setDirectExpenses] = useState<any[]>([]);
  const [batchDrafts, setBatchDrafts] = useState<Record<string, Draft>>({});
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [savedTemplates, setSavedTemplates] = useState<Record<string, Record<string, Draft>>>({});
  const [templateName, setTemplateName] = useState<string>('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [batchDate, setBatchDate] = useState<string>(today());
  const [showConfirm, setShowConfirm] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ category_id: string; amount: string; description: string; expense_date: string }>({ category_id: '', amount: '', description: '', expense_date: today() });

  useEffect(() => {
    const cachedUser = localStorage.getItem('user');
    try {
      if (cachedUser) setUser(JSON.parse(cachedUser));
    } catch { /* silent */ }
    api.get('/api/auth/me')
      .then((res) => { setUser(res.data); localStorage.setItem('user', JSON.stringify(res.data)); })
      .catch(() => { /* use cached */ });
    init();
  }, []);

  useEffect(() => {
    if (selectedDepartmentId) {
      void fetchCategories(selectedDepartmentId);
      void fetchDirectExpenses();
      void fetchAuditLogs();
    }
  }, [selectedDepartmentId]);

  const init = async () => {
    loadSavedTemplates();
    await fetchDepartments();
  };

  const fetchDepartments = async () => {
    try {
      const res = await api.get('/api/departments');
      const depts = Array.isArray(res.data) ? res.data : [];
      setDepartments(depts);
      if (depts.length > 0) {
        setSelectedDepartmentId(depts[0].id);
      }
    } catch (err) {
      toast.error('Failed to load departments');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async (departmentId: string) => {
    setCategoriesLoading(true);
    try {
      const dept = departments.find((d) => d.id === departmentId);
      const fiscalYear = dept?.fiscal_year || new Date().getFullYear();
      const [deptRes, allRes] = await Promise.all([
        api.get('/api/budget/categories', { params: { department_id: departmentId, fiscal_year: fiscalYear } }),
        api.get('/api/budget/categories', { params: { fiscal_year: fiscalYear } })
      ]);
      const deptCats = Array.isArray(deptRes.data) ? deptRes.data : [];
      const allCats = Array.isArray(allRes.data) ? allRes.data : [];
      const generalCats = allCats.filter((c: any) => c.department_id === 'All' || c.department_id === null);
      const merged = [...deptCats, ...generalCats.filter((g: any) => !deptCats.some((c: any) => c.id === g.id))];
      setCategories(merged);
    } catch (err) {
      toast.error('Failed to load categories');
    } finally {
      setCategoriesLoading(false);
    }
  };

  const fetchDirectExpenses = async (departmentId?: string) => {
    try {
      const targetId = departmentId || selectedDepartmentId;
      const dept = departments.find((d) => d.id === targetId);
      const params: any = { fiscal_year: dept?.fiscal_year || new Date().getFullYear() };
      if (targetId) params.department_id = targetId;
      const res = await api.get('/api/expenses', { params });
      setDirectExpenses(Array.isArray(res.data) ? res.data : []);
    } catch { /* silent */ }
  };

  const fetchAuditLogs = async () => {
    try {
      const res = await api.get('/api/audit-logs', {
        params: {
          action: 'all',
          limit: 50
        }
      });
      const logs = Array.isArray(res.data) ? res.data : [];
      setAuditLogs(
        logs.filter((log: any) =>
          log.action_type === 'direct_expense_uploaded' ||
          log.action_type === 'direct_expense_batch_uploaded' ||
          log.action_type === 'direct_expense_updated' ||
          log.action_type === 'direct_expense_deleted'
        )
      );
    } catch { /* silent */ }
  };

  const loadSavedTemplates = () => {
    try {
      const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
      setSavedTemplates(raw ? JSON.parse(raw) : {});
    } catch {
      setSavedTemplates({});
    }
  };

  const saveTemplate = () => {
    if (!templateName.trim()) {
      toast.error('Enter a template name');
      return;
    }
    const entries = Object.entries(batchDrafts).filter(([, v]) => toNumber(v.amount) > 0);
    if (entries.length === 0) {
      toast.error('No amounts to save');
      return;
    }
    const next = { ...savedTemplates, [templateName.trim()]: Object.fromEntries(entries) };
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(next));
    setSavedTemplates(next);
    toast.success(`Template "${templateName.trim()}" saved`);
  };

  const loadTemplate = (name: string) => {
    const template = savedTemplates[name];
    if (!template) return;
    setBatchDrafts(template);
    setSelectedTemplate(name);
    toast.success(`Template "${name}" loaded`);
  };

  const deleteTemplate = (name: string) => {
    const next = { ...savedTemplates };
    delete next[name];
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(next));
    setSavedTemplates(next);
    if (selectedTemplate === name) {
      setSelectedTemplate('');
      setBatchDrafts({});
    }
    toast.success(`Template "${name}" deleted`);
  };

  const clearAll = () => {
    if (!window.confirm('Clear all entered amounts?')) return;
    setBatchDrafts({});
    setSelectedTemplate('');
  };

  const matchedPresets = useMemo(() => {
    return RECURRING_EXPENSE_PRESETS.map((preset) => {
      const category = categories.find((c: any) => String(c.category_code || '').trim() === preset.category_code);
      return { ...preset, category };
    });
  }, [categories]);

  const batchEntries = useMemo(() => {
    return Object.entries(batchDrafts).filter(([, v]) => toNumber(v.amount) > 0);
  }, [batchDrafts]);

  const batchTotal = useMemo(() => {
    return batchEntries.reduce((sum, [, v]) => sum + toNumber(v.amount), 0);
  }, [batchEntries]);

  const submitBatch = async () => {
    if (batchEntries.length === 0) {
      toast.error('Enter at least one amount');
      return;
    }
    setBatchSubmitting(true);
    try {
      const expenses = batchEntries.map(([, v]) => ({
        category_code: v.category_code,
        category_name: v.category_name,
        parent_code: v.parent_code,
        parent_name: v.parent_name,
        amount: toNumber(v.amount),
        description: v.description,
        expense_date: batchDate
      }));
      await api.post('/api/expenses/batch', { expenses, department_id: selectedDepartmentId });
      toast.success(`${expenses.length} adjustments applied`);
      setBatchDrafts({});
      setSelectedTemplate('');
      await fetchDirectExpenses();
      await fetchCategories(selectedDepartmentId);
      await fetchAuditLogs();
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to apply batch'));
    } finally {
      setBatchSubmitting(false);
      setShowConfirm(false);
    }
  };

  const startEdit = (de: any) => {
    setEditingId(de.id);
    setEditForm({
      category_id: de.category_id || '',
      amount: String(de.amount || ''),
      description: de.description || '',
      expense_date: de.expense_date || today()
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ category_id: '', amount: '', description: '', expense_date: today() });
  };

  const saveEdit = async (id: string) => {
    if (!editForm.amount || toNumber(editForm.amount) <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    try {
      await api.put(`/api/expenses/${id}`, {
        category_id: editForm.category_id,
        amount: toNumber(editForm.amount),
        description: editForm.description,
        expense_date: editForm.expense_date
      });
      toast.success('Expense updated');
      setEditingId(null);
      await fetchDirectExpenses();
      await fetchCategories(selectedDepartmentId);
      await fetchAuditLogs();
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to update expense'));
    }
  };

  const deleteExpense = async (id: string) => {
    if (!window.confirm('Delete this direct expense? This will restore the budget back to the category.')) return;
    try {
      await api.delete(`/api/expenses/${id}`);
      toast.success('Expense deleted');
      await fetchDirectExpenses();
      await fetchCategories(selectedDepartmentId);
      await fetchAuditLogs();
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to delete expense'));
    }
  };

  if (user && user.role !== 'accounting' && user.role !== 'admin' && user.role !== 'super_admin') {
    return (
      <div className="p-6 text-center">
        <p className="text-red-600">Access denied. This page is for accounting/admin only.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--role-text)]">Budget Expense Upload</h1>
          <p className="text-sm text-[var(--role-text)]/60">
            Log recurring/admin expenses directly. Deducts from the selected category and M88 Manila.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-sm font-medium text-[var(--role-text)]">Department</label>
          <select
            value={selectedDepartmentId}
            onChange={(e) => setSelectedDepartmentId(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)]"
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-6 p-4 rounded-xl border border-purple-200 bg-purple-50/50">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            {selectedTemplate && (
              <span className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-700">Template: {selectedTemplate}</span>
            )}
          </div>
        </div>

        <div>
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between bg-white rounded-lg p-2 border border-purple-100">
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={selectedTemplate}
                  onChange={(e) => { if (e.target.value) loadTemplate(e.target.value); else { setSelectedTemplate(''); setBatchDrafts({}); } }}
                  className="px-2 py-1.5 text-xs rounded border border-[var(--role-border)] bg-[var(--role-surface)]"
                >
                  <option value="">Load saved template</option>
                  {Object.keys(savedTemplates).map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                {selectedTemplate && (
                  <button type="button" onClick={() => deleteTemplate(selectedTemplate)} className="text-xs text-red-600 hover:underline px-2">Delete</button>
                )}
                <button type="button" onClick={clearAll} className="text-xs text-gray-600 hover:text-gray-800 px-2">Clear all</button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs text-[var(--role-text)]/60">Default date</label>
                <input
                  type="date"
                  value={batchDate}
                  onChange={(e) => setBatchDate(e.target.value)}
                  className="px-2 py-1.5 text-xs rounded border border-[var(--role-border)] bg-[var(--role-surface)]"
                />
                <input
                  type="text"
                  placeholder="Template name"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  className="px-2 py-1.5 text-xs rounded border border-[var(--role-border)] bg-[var(--role-surface)] w-32"
                />
                <button type="button" onClick={saveTemplate} className="text-xs bg-emerald-500 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-600 transition">Save</button>
              </div>
            </div>

            {categoriesLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600" />
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(
                  matchedPresets.reduce((acc, preset) => {
                    (acc[preset.parent_code] = acc[preset.parent_code] || []).push(preset);
                    return acc;
                  }, {} as Record<string, typeof matchedPresets>)
                ).map(([parentCode, presets]) => (
                  <div key={parentCode} className="border border-purple-100 rounded-lg overflow-hidden bg-white">
                    <div className="px-3 py-2 bg-purple-100/50 text-xs font-semibold text-purple-800 flex items-center justify-between">
                      <span>{parentCode} · {presets[0].parent_name}</span>
                      <span className="text-purple-600/70 font-normal">{presets.filter((p) => p.category).length} of {presets.length} categories available</span>
                    </div>
                    <div className="divide-y divide-purple-50">
                      {presets.map((preset) => {
                        const draft = batchDrafts[preset.category_code];
                        const remaining = toNumber(preset.category?.remaining_amount);
                        const amount = toNumber(draft?.amount);
                        const isFound = !!preset.category;
                        return (
                          <div key={preset.category_code} className={`flex flex-col sm:flex-row gap-2 sm:items-center px-3 py-2 text-xs ${isFound ? 'bg-white' : 'bg-gray-50 text-gray-400'}`}>
                            <div className="w-20 font-mono text-[var(--role-text)]/70 shrink-0">{preset.category_code}</div>
                            <div className="flex-1 min-w-0">
                              <div className="truncate font-medium text-[var(--role-text)]">{preset.category_name}</div>
                              <div className="text-[10px] text-[var(--role-text)]/50 truncate">
                                {isFound ? (preset.category.parent_category_name || preset.category.category_name) : 'Category not found - will be created'}
                              </div>
                            </div>
                            <div className="text-right w-28 shrink-0">
                              <div className="text-[10px] text-[var(--role-text)]/50">Budget</div>
                              <div className="font-mono text-[var(--role-text)]">{formatMoney(Math.max(0, remaining))}</div>
                              {amount > 0 && (
                                <div className="text-[10px] text-[var(--role-text)]/70">Upload: {formatMoney(amount)}</div>
                              )}
                            </div>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              value={draft?.amount ?? ''}
                              onChange={(e) => {
                                setBatchDrafts((prev) => ({
                                  ...prev,
                                  [preset.category_code]: {
                                    amount: e.target.value,
                                    description: `${preset.category_name} - ${batchDate}`,
                                    date: batchDate,
                                    category_code: preset.category_code,
                                    category_name: preset.category_name,
                                    parent_code: preset.parent_code,
                                    parent_name: preset.parent_name
                                  }
                                }));
                              }}
                              className="w-28 px-2 py-1.5 rounded border border-[var(--role-border)] bg-[var(--role-surface)]"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-lg bg-white p-3 border border-purple-100">
              <div className="space-y-1">
                <div className="text-xs text-[var(--role-text)]/60">
                  {batchEntries.length} category{batchEntries.length !== 1 ? 'ies' : 'y'} with amount
                </div>
                <div className="text-lg font-bold text-[var(--role-text)]">
                  Total: {formatMoney(batchTotal)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfirm(true)}
                  disabled={batchSubmitting || batchEntries.length === 0}
                  className="btn-primary !px-5 !py-2.5 !text-sm disabled:opacity-50"
                >
                  {batchSubmitting ? 'Applying…' : 'Apply Batch'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {directExpenses.length > 0 && (
        <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4 mb-4">
          <h3 className="text-sm font-semibold mb-2">Recent Adjustments</h3>
          <div className="max-h-96 overflow-y-auto space-y-1">
            {directExpenses
              .filter((de) => (selectedDepartmentId ? de.department_id === selectedDepartmentId : true))
              .slice(-40)
              .reverse()
              .map((de) => {
                const isEditing = editingId === de.id;
                return (
                  <div key={de.id} className="flex flex-col gap-1 text-xs py-2 px-2 rounded border border-[var(--role-border)]/50">
                    {isEditing ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-[var(--role-text)]/50">Category</label>
                          <select
                            value={editForm.category_id}
                            onChange={(e) => setEditForm((f) => ({ ...f, category_id: e.target.value }))}
                            className="w-full px-2 py-1.5 text-xs rounded border border-[var(--role-border)] bg-[var(--role-surface)]"
                          >
                            <option value="">Select category</option>
                            {matchedPresets.filter((p) => p.category).map((p) => (
                              <option key={p.category.id} value={p.category.id}>{p.category_code} · {p.category_name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] text-[var(--role-text)]/50">Amount</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={editForm.amount}
                            onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                            className="w-full px-2 py-1.5 text-xs rounded border border-[var(--role-border)] bg-[var(--role-surface)]"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-[var(--role-text)]/50">Date</label>
                          <input
                            type="date"
                            value={editForm.expense_date}
                            onChange={(e) => setEditForm((f) => ({ ...f, expense_date: e.target.value }))}
                            className="w-full px-2 py-1.5 text-xs rounded border border-[var(--role-border)] bg-[var(--role-surface)]"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-[var(--role-text)]/50">Description</label>
                          <input
                            type="text"
                            value={editForm.description}
                            onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                            className="w-full px-2 py-1.5 text-xs rounded border border-[var(--role-border)] bg-[var(--role-surface)]"
                          />
                        </div>
                        <div className="sm:col-span-2 flex justify-end gap-2">
                          <button type="button" onClick={cancelEdit} className="px-3 py-1.5 text-[10px] rounded border border-gray-300 hover:bg-gray-50">Cancel</button>
                          <button type="button" onClick={() => void saveEdit(de.id)} className="px-3 py-1.5 text-[10px] rounded bg-purple-600 text-white hover:bg-purple-700">Save</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="truncate font-medium text-[var(--role-text)]">{de.category} · {de.description || de.item_name}</div>
                          <div className="text-[10px] text-[var(--role-text)]/50">{de.expense_date}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-rose-600">{formatMoney(toNumber(de.amount))}</span>
                          <button type="button" onClick={() => startEdit(de)} className="text-[10px] text-purple-600 hover:text-purple-800 underline">Edit</button>
                          <button type="button" onClick={() => deleteExpense(de.id)} className="text-[10px] text-red-600 hover:text-red-800 underline">Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {auditLogs.length > 0 && (
        <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Audit Logs</h3>
            <button
              type="button"
              onClick={() => void fetchAuditLogs()}
              className="text-[10px] text-purple-600 hover:text-purple-800 underline"
            >
              Refresh
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {auditLogs.map((log) => (
              <div key={log.id} className="flex flex-col gap-1 text-xs py-2 px-2 rounded border border-[var(--role-border)]/50">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[var(--role-text)]">{log.action_type}</span>
                  <span className="text-[10px] text-[var(--role-text)]/50">{log.created_at}</span>
                </div>
                <div className="text-[10px] text-[var(--role-text)]/70">
                  {log.user_name} · {log.user_role} · {log.department_name || 'N/A'}
                </div>
                <div className="text-[10px] text-[var(--role-text)]/60 truncate">
                  {log.remarks || log.record_label || 'No details'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl p-5 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-semibold mb-2">Confirm Batch Upload</h3>
            <p className="text-sm text-gray-600 mb-4">
              You are about to apply {batchEntries.length} expense adjustment{batchEntries.length !== 1 ? 's' : ''} totaling {formatMoney(batchTotal)}.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowConfirm(false)} className="px-4 py-2 text-xs rounded-lg border border-gray-300 hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={() => void submitBatch()} disabled={batchSubmitting} className="px-4 py-2 text-xs rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50">
                {batchSubmitting ? 'Applying…' : 'Confirm Apply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetExpenseUpload;
