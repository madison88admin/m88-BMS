import { useEffect, useMemo, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { formatMoney, formatDateTime, formatPercent, toNumber , getErrorMessage } from '../utils/format';
import { supabase } from '../lib/supabase';

const DEFAULT_FX_RATE_PHP = 56.0;
const DEFAULT_FX_RATE_IDR = 15800.0;
const FX_ENDPOINT = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=PHP,IDR';
const RECENT_PAGE_SIZE = 4;
const CATEGORY_PAGE_SIZE = 5;

const enrichCategories = (categories: any[]) => {
  const nameById = new Map(categories.map((category) => [category.id, category.category_name]));
  return categories.map((category) => ({
    ...category,
    parent_category_name: category.parent_category_id ? nameById.get(category.parent_category_id) || null : null,
  }));
};

const buildOrderedCategories = (categories: any[], searchQuery: string) => {
  const query = searchQuery.trim().toLowerCase();
  const filtered = !query
    ? categories
    : categories.filter((category) => {
        const parentName = String(category.parent_category_name || '').toLowerCase();
        return (
          String(category.category_name || '').toLowerCase().includes(query) ||
          String(category.category_code || '').toLowerCase().includes(query) ||
          parentName.includes(query)
        );
      });

  const visibleIds = new Set(filtered.map((category) => category.id));
  const roots = filtered.filter(
    (category) => !category.parent_category_id || !visibleIds.has(category.parent_category_id)
  );
  const childrenByParent = new Map<string, any[]>();

  filtered.forEach((category) => {
    if (category.parent_category_id && visibleIds.has(category.parent_category_id)) {
      const siblings = childrenByParent.get(category.parent_category_id) || [];
      siblings.push(category);
      childrenByParent.set(category.parent_category_id, siblings);
    }
  });

  const ordered: Array<{ cat: any; depth: number }> = [];
  const visit = (category: any, depth: number) => {
    ordered.push({ cat: category, depth });
    (childrenByParent.get(category.id) || [])
      .sort((left, right) => String(left.category_name).localeCompare(String(right.category_name)))
      .forEach((child) => visit(child, depth + 1));
  };

  roots
    .sort((left, right) => String(left.category_name).localeCompare(String(right.category_name)))
    .forEach((root) => visit(root, 0));

  filtered
    .filter((category) => !ordered.some((entry) => entry.cat.id === category.id))
    .forEach((category) => visit(category, 0));

  return ordered;
};

const toUsd = (amount: number, fxRate: number) => amount / (fxRate || DEFAULT_FX_RATE_PHP);
const toCurrency = (amount: number, fromRate: number, toRate: number) => (amount / fromRate) * toRate;

const getBudgetHealth = (dept: any) => {
  const annual = toNumber(dept?.annual_budget);
  const used = toNumber(dept?.used_budget);
  const utilization = annual > 0 ? (used / annual) * 100 : 0;
  if (utilization >= 90) return 'critical';
  if (utilization >= 70) return 'high';
  return 'low';
};

const getDeptCode = (name?: string) => {
  const n = (name || '').trim().toLowerCase();
  if (n.includes('it')) return 'm88IT';
  if (n.includes('purchasing')) return 'm88Purchasing';
  if (n.includes('planning')) return 'm88Planning';
  if (n.includes('logistics') || n.includes('operations')) return 'm88Logistics';
  if (n.includes('hr') || n.includes('human')) return 'm88HR';
  if (n.includes('finance') || n.includes('accounting')) return 'm88Accounting';
  if (n.includes('admin')) return 'm88Admin';
  const compact = (name || '').replace(/department/gi, '').replace(/[^a-z0-9]/gi, '');
  return compact ? `m88${compact}` : 'm88DEPT';
};

const statusTone = (status: string) => {
  switch (status) {
    case 'released': return 'border-[var(--role-border)] bg-[var(--role-accent)] text-[var(--role-text)]';
    case 'pending_supervisor':
    case 'pending_accounting': return 'border-[var(--role-secondary)]/18 bg-[var(--role-secondary)]/12 text-[var(--role-text)]';
    default: return 'border-[var(--role-border)] bg-[var(--role-accent)] text-[var(--role-text)]/70';
  }
};

const getRequestTypeLabel = (requestType?: string) => {
  switch (requestType) {
    case 'budget_request': return 'Budget Proposal';
    case 'budget_revision': return 'Budget Revision';
    default: return 'Expense Request';
  }
};

const BudgetManagement = () => {
  const [user, setUser] = useState<any>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>('');
  const [selectedBreakdown, setSelectedBreakdown] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [budgetInputs, setBudgetInputs] = useState<Record<string, string>>({});
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategory, setNewCategory] = useState({ category_code: '', category_name: '', budget_amount: '', parent_category_id: '' });
  const [categorySearch, setCategorySearch] = useState('');
  const [fxRatePhp, setFxRatePhp] = useState(DEFAULT_FX_RATE_PHP);
  const [fxRateIdr, setFxRateIdr] = useState(DEFAULT_FX_RATE_IDR);
  const [fxRateUpdatedAt, setFxRateUpdatedAt] = useState('');
  const [fxStatus, setFxStatus] = useState<'live' | 'fallback'>('fallback');
  const [displayCurrency, setDisplayCurrency] = useState<'PHP' | 'USD' | 'IDR'>('PHP');
  const [selectedFiscalYear, setSelectedFiscalYear] = useState<number>(new Date().getFullYear());
  const [departmentSearch, setDepartmentSearch] = useState('');
  const [budgetHealthFilter, setBudgetHealthFilter] = useState<'all' | 'low' | 'high' | 'critical'>('all');
  const [newDept, setNewDept] = useState({ name: '', annual_budget: '', fiscal_year: new Date().getFullYear() });
  const [pettyCashForm, setPettyCashForm] = useState({ amount: '', purpose: '', action: 'replenish' as 'replenish' | 'disburse' });
  const [categoryPage, setCategoryPage] = useState(1);
  const [recentRequestsPage, setRecentRequestsPage] = useState(1);
  const [recentPettyPage, setRecentPettyPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [proposalDrafts, setProposalDrafts] = useState<Record<string, string>>({});
  const [revisionDrafts, setRevisionDrafts] = useState<Record<string, string>>({});
  const [revisionHistory, setRevisionHistory] = useState<Record<string, any[]>>({});
  const [submittingProposal, setSubmittingProposal] = useState(false);

  const canEditMatrix = user?.role === 'accounting' || user?.role === 'admin';
  const isViewOnlyMatrix = user?.role === 'supervisor' || user?.role === 'vp' || user?.role === 'president';

  const visibleDepartments = useMemo(() => {
    const map = new Map<string, any>();
    const filtered = departments.filter(d => {
      // Supervisors can only see their own department
      if (user?.role === 'supervisor' && user?.department_id) {
        return d.id === user.department_id;
      }
      // Managers can only see their own department
      if (user?.role === 'manager' && user?.department_id) {
        return d.id === user.department_id;
      }
      return true;
    });
    filtered
      .filter(d => !/^m88/i.test(d.name || ''))
      .forEach(d => {
        const key = `${String(d.name || '').trim().toLowerCase()}::${d.fiscal_year ?? ''}`;
        const ex = map.get(key);
        if (!ex || toNumber(d.used_budget) > toNumber(ex.used_budget)) map.set(key, d);
      });
    return Array.from(map.values()).sort((a, b) => toNumber(b.used_budget) - toNumber(a.used_budget));
  }, [departments, user]);

  const availableFiscalYears = useMemo(() =>
    Array.from(new Set(visibleDepartments.map(d => Number(d.fiscal_year || 0)).filter(y => y > 0))).sort((a, b) => b - a),
    [visibleDepartments]
  );

  const filteredDepts = useMemo(() => {
    const q = departmentSearch.trim().toLowerCase();
    return visibleDepartments.filter(d => {
      const matchYear = !selectedFiscalYear || Number(d.fiscal_year) === Number(selectedFiscalYear);
      const matchName = !q || String(d.name || '').toLowerCase().includes(q);
      const matchHealth = budgetHealthFilter === 'all' || getBudgetHealth(d) === budgetHealthFilter;
      return matchYear && matchName && matchHealth;
    });
  }, [visibleDepartments, selectedFiscalYear, departmentSearch, budgetHealthFilter]);

  const activeFiscalYear = availableFiscalYears[0] || selectedFiscalYear || new Date().getFullYear();

  const overview = useMemo(() => {
    const totalBudget = filteredDepts.reduce((s, d) => s + toNumber(d.annual_budget), 0);
    const usedBudget = filteredDepts.reduce((s, d) => s + toNumber(d.used_budget), 0);
    return { totalDepartments: filteredDepts.length, totalBudget, usedBudget, utilization: totalBudget > 0 ? (usedBudget / totalBudget) * 100 : 0 };
  }, [filteredDepts]);

  const displayAmount = (v: number) => {
    const n = toNumber(v);
    if (displayCurrency === 'USD') return toUsd(n, fxRatePhp);
    if (displayCurrency === 'IDR') return toCurrency(n, fxRatePhp, fxRateIdr);
    return n;
  };
  const displayMoney = (v: number) => formatMoney(displayAmount(v), displayCurrency);
  const secondaryMoney = (v: number) => {
    const n = toNumber(v);
    if (displayCurrency === 'PHP') return formatMoney(toUsd(n, fxRatePhp), 'USD');
    return formatMoney(n, 'PHP');
  };

  const selectedDepartment = filteredDepts.find(d => d.id === selectedDepartmentId);
  const breakdownDept = selectedBreakdown?.department;
  const breakdownTotals = selectedBreakdown?.totals;
  const breakdownCounts = selectedBreakdown?.counts;
  const editableBudgetValue = breakdownTotals?.annual_budget ?? toNumber(selectedDepartment?.annual_budget);

  const enrichedCategories = useMemo(
    () => enrichCategories(selectedBreakdown?.categories || []),
    [selectedBreakdown?.categories]
  );

  const orderedCategories = useMemo(
    () => buildOrderedCategories(enrichedCategories, categorySearch),
    [enrichedCategories, categorySearch]
  );

  const MAIN_CATEGORY_CODES = useMemo(() => new Set([
    '6010', '6020', '6040', '6041', '6170', '6240', '6330', '6340', '6350', 
    '6430', '6490', '6500', '6650', '6670', '6710', '6720', '6840', '6860', 
    '6870', '6900', '9900'
  ]), []);
  const isNewMainCategory = MAIN_CATEGORY_CODES.has(newCategory.category_code.trim().toUpperCase());

  const parentCategoryOptions = useMemo(
    () => enrichedCategories.filter((category) => !category.parent_category_id),
    [enrichedCategories]
  );

  const categoryAllocatedTotal = useMemo(() => {
    const childParentIds = new Set(
      enrichedCategories
        .map((category) => category.parent_category_id)
        .filter(Boolean)
    );

    return enrichedCategories.reduce((sum, category) => {
      if (category.parent_category_id) return sum + toNumber(category.budget_amount);
      if (!childParentIds.has(category.id)) return sum + toNumber(category.budget_amount);
      return sum;
    }, 0);
  }, [enrichedCategories]);
  const categoryAllocationRemaining = Math.max(0, editableBudgetValue - categoryAllocatedTotal);

  const paginatedCategories = useMemo(
    () => orderedCategories.slice((categoryPage - 1) * CATEGORY_PAGE_SIZE, categoryPage * CATEGORY_PAGE_SIZE),
    [orderedCategories, categoryPage]
  );

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    api.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setUser(res.data))
      .catch(() => {
        try {
          setUser(JSON.parse(localStorage.getItem('user') || '{}'));
        } catch {}
      });
    fetchDepartments();
    fetchExchangeRate(false);
    const id = window.setInterval(() => fetchExchangeRate(false), 60000);
    let ch: any;
    if (supabase) {
      ch = supabase.channel('bm-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, () => { fetchDepartments(false); if (selectedDepartmentId) fetchBreakdown(selectedDepartmentId, false, false); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_categories' }, () => { if (selectedDepartmentId) fetchBreakdown(selectedDepartmentId, false, false); })
        .subscribe();
    }
    return () => { window.clearInterval(id); if (ch && supabase) supabase.removeChannel(ch); };
  }, [selectedDepartmentId]);

  useEffect(() => {
    setCategoryPage(1);
  }, [categorySearch, selectedDepartmentId]);

  useEffect(() => {
    if (!selectedDepartmentId) return;
    setCategoryPage(1); setRecentRequestsPage(1); setRecentPettyPage(1);
    fetchBreakdown(selectedDepartmentId, true, false);
    const id = window.setInterval(() => { fetchDepartments(false); fetchBreakdown(selectedDepartmentId, false, false); }, 15000);
    return () => window.clearInterval(id);
  }, [selectedDepartmentId]);

  useEffect(() => {
    if (!availableFiscalYears.length) return;
    if (!availableFiscalYears.includes(selectedFiscalYear)) setSelectedFiscalYear(availableFiscalYears[0]);
  }, [availableFiscalYears]);

  useEffect(() => {
    if (!filteredDepts.length) { setSelectedDepartmentId(''); return; }
    if (!filteredDepts.some(d => d.id === selectedDepartmentId)) setSelectedDepartmentId(filteredDepts[0].id);
  }, [filteredDepts]);

  const fetchDepartments = async (showError = true) => {
    const token = localStorage.getItem('token');
    try {
      const res = await api.get('/api/departments', { headers: { Authorization: `Bearer ${token}` } });
      setDepartments(res.data || []);
      setBudgetInputs(prev => { const n = { ...prev }; res.data.forEach((d: any) => { if (!(d.id in n)) n[d.id] = ''; }); return n; });
      const visible: any[] = Array.from(res.data.filter((d: any) => !/^m88/i.test(d.name || '')).reduce((m: Map<string, any>, d: any) => { const k = `${String(d.name || '').trim().toLowerCase()}::${d.fiscal_year}`; const ex = m.get(k); m.set(k, !ex || toNumber(d.used_budget) > toNumber(ex.used_budget) ? d : ex); return m; }, new Map()).values());
      if (visible.length) {
        const latestFY = Math.max(...visible.map((d: any) => Number(d.fiscal_year || 0)), new Date().getFullYear());
        setSelectedFiscalYear(curr => curr || latestFY);
        setNewDept(curr => ({ ...curr, fiscal_year: curr.fiscal_year || latestFY }));
      }
      setLoading(false);
    } catch { if (showError) toast.error('Failed to load departments'); setLoading(false); }
  };

  const fetchBreakdown = async (deptId: string, showLoading = true, showToast = true) => {
    const token = localStorage.getItem('token');
    if (showLoading) setDetailLoading(true);
    setDetailError('');
    try {
      const res = await api.get(`/api/departments/${deptId}/budget-breakdown`, { headers: { Authorization: `Bearer ${token}` } });
      setSelectedBreakdown(res.data);
    } catch (err: any) {
      setSelectedBreakdown(null);
      const msg = err.response?.data?.error?.message || err.response?.data?.error || 'Detailed breakdown unavailable.';
      setDetailError(String(msg));
      if (showToast) toast.error(`Failed to load breakdown: ${msg}`);
    } finally { if (showLoading) setDetailLoading(false); }
  };

  const fetchExchangeRate = async (showToast = false) => {
    try {
      const res = await fetch(FX_ENDPOINT);
      const data = await res.json();
      const php = toNumber(data?.rates?.PHP); const idr = toNumber(data?.rates?.IDR);
      if (php > 0) setFxRatePhp(php);
      if (idr > 0) setFxRateIdr(idr);
      if (php > 0 || idr > 0) { setFxRateUpdatedAt(data?.date || new Date().toISOString()); setFxStatus('live'); }
    } catch { setFxStatus('fallback'); if (showToast) toast.error('Failed to refresh exchange rate'); }
  };

  const updateBudget = async (deptId: string, budget: number) => {
    const token = localStorage.getItem('token');
    try {
      await api.patch(`/api/departments/${deptId}/budget`, { annual_budget: budget }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success('Budget updated!');
      await fetchDepartments(false); await fetchBreakdown(deptId, false, false);
      setBudgetInputs(prev => ({ ...prev, [deptId]: '' }));
    } catch (err: any) { toast.error(getErrorMessage(err, 'Failed to update budget')); }
  };

  const updateCategoryBudget = async (catId: string, budget: number) => {
    const token = localStorage.getItem('token');
    
    // Validation for sub-categories: ensure budget doesn't exceed parent category
    const category = enrichedCategories.find(c => c.id === catId);
    if (category?.parent_category_id) {
      const parentCategory = enrichedCategories.find(c => c.id === category.parent_category_id);
      if (parentCategory) {
        const siblings = enrichedCategories.filter(c => c.parent_category_id === category.parent_category_id && c.id !== catId);
        const siblingsTotal = siblings.reduce((sum, sib) => sum + toNumber(sib.budget_amount), 0);
        const newTotal = siblingsTotal + budget;
        
        if (newTotal > toNumber(parentCategory.budget_amount)) {
          toast.error(`Sub-category budget (₱${budget.toFixed(2)}) + siblings (₱${siblingsTotal.toFixed(2)}) exceeds parent budget (₱${toNumber(parentCategory.budget_amount).toFixed(2)})`);
          return;
        }
      }
    }
    
    // Validation for parent categories: ensure sum of sub-categories doesn't exceed parent budget
    if (!category?.parent_category_id) {
      const children = enrichedCategories.filter(c => c.parent_category_id === catId);
      if (children.length > 0) {
        const childrenTotal = children.reduce((sum, child) => sum + toNumber(child.budget_amount), 0);
        if (childrenTotal > budget) {
          toast.error(`Parent budget (₱${budget.toFixed(2)}) is less than sum of sub-categories (₱${childrenTotal.toFixed(2)})`);
          return;
        }
      }
    }
    
    try {
      await api.put(`/api/budget/categories/${catId}`, { budget_amount: budget }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success('Category budget updated!');
      if (selectedDepartmentId) { await fetchBreakdown(selectedDepartmentId, false, false); await fetchDepartments(false); }
    } catch (err: any) { toast.error(getErrorMessage(err, 'Failed to update category')); }
  };

  const addNewCategory = async () => {
    const token = localStorage.getItem('token');
    if (!selectedDepartmentId || !newCategory.category_code || !newCategory.category_name) { toast.error('Fill in category code and name'); return; }
    if (!isNewMainCategory && !newCategory.parent_category_id) { toast.error('Select a parent category for sub-categories'); return; }
    try {
      await api.post('/api/budget/categories', {
        department_id: selectedDepartmentId,
        fiscal_year: selectedFiscalYear,
        category_code: newCategory.category_code.toUpperCase(),
        category_name: newCategory.category_name,
        budget_amount: parseFloat(newCategory.budget_amount) || 0,
        parent_category_id: newCategory.parent_category_id || null,
      }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success('Category added!');
      setNewCategory({ category_code: '', category_name: '', budget_amount: '', parent_category_id: '' }); setShowAddCategory(false);
      if (selectedDepartmentId) { await fetchBreakdown(selectedDepartmentId, false, false); await fetchDepartments(false); }
    } catch (err: any) { toast.error(getErrorMessage(err, 'Failed to add category')); }
  };

  const deleteCategory = async (catId: string) => {
    if (!confirm('Delete this category?')) return;
    const token = localStorage.getItem('token');
    try {
      await api.delete(`/api/budget/categories/${catId}`, { headers: { Authorization: `Bearer ${token}` } });
      toast.success('Category deleted!');
      if (selectedDepartmentId) { await fetchBreakdown(selectedDepartmentId, false, false); await fetchDepartments(false); }
    } catch (err: any) { toast.error(getErrorMessage(err, 'Failed to delete category')); }
  };

  const getDeptCategories = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes('accounting') || n.includes('finance')) return [{ category_code: '6040', category_name: 'Bank Service Charges', budget_amount: 0 }, { category_code: '6041', category_name: 'Realized Forex Gain/Loss', budget_amount: 0 }, { category_code: '6240', category_name: 'Depreciation Expense', budget_amount: 0 }, { category_code: '6340', category_name: 'Interest Expense', budget_amount: 0 }, { category_code: '6351', category_name: 'Taxes & Licenses - Business', budget_amount: 0 }, { category_code: '6352', category_name: 'Taxes & Licenses - Income', budget_amount: 0 }, { category_code: '9900', category_name: 'Sundry', budget_amount: 0 }];
    if (n.includes('it')) return [{ category_code: '6170', category_name: 'Computer and Internet Expenses', budget_amount: 0 }];
    if (n.includes('hr') || n.includes('human')) return [{ category_code: '6010', category_name: 'Advertising and Promotion', budget_amount: 0 }, { category_code: '6430', category_name: 'Meals and Entertainment', budget_amount: 0 }, { category_code: '6490', category_name: 'Office Supplies', budget_amount: 0 }, { category_code: '6840', category_name: 'Travel Expense', budget_amount: 0 }, { category_code: '6900', category_name: 'Welfare - Employee', budget_amount: 0 }];
    return [{ category_code: '66001', category_name: 'Payroll Expense', budget_amount: 0 }, { category_code: 'MISC', category_name: 'Miscellaneous Expense', budget_amount: 0 }];
  };

  const initializeDefaultCategories = async () => {
    if (!selectedDepartmentId || !selectedDepartment) { toast.error('Select a department first'); return; }
    if (!confirm('Reset ALL current categories to department defaults?')) return;
    const defaults = getDeptCategories(selectedDepartment.name);
    const token = localStorage.getItem('token');
    try {
      toast.loading(`Resetting to ${defaults.length} standard categories...`, { id: 'init-cats' });
      const existing = await api.get(`/api/budget/categories?department_id=${selectedDepartmentId}&fiscal_year=${selectedFiscalYear}`, { headers: { Authorization: `Bearer ${token}` } });
      if (existing.data?.length) await Promise.all(existing.data.map((c: any) => api.delete(`/api/budget/categories/${c.id}`, { headers: { Authorization: `Bearer ${token}` } })));
      await Promise.all(defaults.map(c => api.post('/api/budget/categories', { department_id: selectedDepartmentId, fiscal_year: selectedFiscalYear, ...c }, { headers: { Authorization: `Bearer ${token}` } })));
      toast.success('Categories reset!', { id: 'init-cats' });
      await fetchBreakdown(selectedDepartmentId, false, false); await fetchDepartments(false);
    } catch (err: any) { toast.error(getErrorMessage(err, 'Failed to reset categories'), { id: 'init-cats' }); }
  };

  const createDepartment = async () => {
    const token = localStorage.getItem('token');
    try {
      await api.post('/api/departments', { name: newDept.name, annual_budget: toNumber(newDept.annual_budget), fiscal_year: newDept.fiscal_year }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success('Department created!');
      setNewDept({ name: '', annual_budget: '', fiscal_year: selectedFiscalYear || availableFiscalYears[0] || new Date().getFullYear() });
      await fetchDepartments(false);
    } catch (err: any) { toast.error(getErrorMessage(err, 'Failed to create department')); }
  };

  const createNextFiscalYearDepts = async () => {
    const token = localStorage.getItem('token');
    const nextFY = (availableFiscalYears[0] || new Date().getFullYear()) + 1;
    const base = filteredDepts[0] || visibleDepartments[0];
    try {
      await api.post('/api/departments', { name: base?.name || 'Finance Department', annual_budget: toNumber(base?.annual_budget), fiscal_year: nextFY }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(`FY ${nextFY} is now active!`);
      setSelectedFiscalYear(nextFY);
      await fetchDepartments(false);
    } catch (err: any) { toast.error(getErrorMessage(err, 'Failed to create next fiscal year departments')); }
  };

  const submitPettyCash = async () => {
    if (!selectedDepartmentId) { toast.error('Select a department first'); return; }
    const amount = toNumber(pettyCashForm.amount);
    if (amount <= 0) { toast.error('Enter a valid amount'); return; }
    if (!pettyCashForm.purpose.trim()) { toast.error('Reason is required'); return; }
    const token = localStorage.getItem('token');
    try {
      const ep = pettyCashForm.action === 'replenish' ? '/api/petty-cash/replenish' : '/api/petty-cash/disburse';
      await api.post(ep, { department_id: selectedDepartmentId, amount, purpose: pettyCashForm.purpose }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(pettyCashForm.action === 'replenish' ? 'Petty cash added!' : 'Petty cash deducted!');
      setPettyCashForm(p => ({ ...p, amount: '', purpose: '' }));
      await fetchDepartments(false); await fetchBreakdown(selectedDepartmentId, false, false);
    } catch (err: any) { toast.error(getErrorMessage(err, 'Failed to update petty cash')); }
  };

  const unlockCategory = async (catId: string) => {
    const token = localStorage.getItem('token');
    try {
      await api.patch(`/api/budget/categories/${catId}/unlock`, {}, { headers: { Authorization: `Bearer ${token}` } });
      toast.success('Category unlocked');
      if (selectedDepartmentId) await fetchBreakdown(selectedDepartmentId, false, false);
    } catch (err: any) { toast.error(getErrorMessage(err, 'Failed to unlock category')); }
  };

  const submitBudgetProposals = async () => {
    if (!selectedDepartmentId) { toast.error('Select a department first'); return; }
    const mainCategories = enrichedCategories.filter((c) => !c.parent_category_id);
    const proposals = mainCategories
      .map((cat) => ({
        category: cat,
        amount: toNumber(proposalDrafts[cat.id] ?? cat.budget_amount)
      }))
      .filter(({ category, amount }) => !category.is_locked && amount >= 0 && amount !== toNumber(category.budget_amount));

    if (!proposals.length) {
      toast.error('Enter proposed amounts for unlocked categories that differ from current budgets');
      return;
    }

    const token = localStorage.getItem('token');
    setSubmittingProposal(true);
    try {
      for (const { category, amount } of proposals) {
        await api.post('/api/requests', {
          request_type: 'budget_request',
          department_id: selectedDepartmentId,
          category_id: category.id,
          category: category.category_name,
          item_name: `Budget Proposal: ${category.category_name}`,
          amount,
          purpose: `Proposed budget for ${category.category_name}`,
          priority: 'normal'
        }, { headers: { Authorization: `Bearer ${token}` } });
      }
      toast.success(`Submitted ${proposals.length} budget proposal(s) for approval`);
      setProposalDrafts({});
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to submit budget proposal'));
    } finally {
      setSubmittingProposal(false);
    }
  };

  const submitBudgetRevisions = async () => {
    if (!selectedDepartmentId) { toast.error('Select a department first'); return; }
    const mainCategories = enrichedCategories.filter((c) => !c.parent_category_id);
    const revisions = mainCategories
      .map((cat) => ({
        category: cat,
        amount: toNumber(revisionDrafts[cat.id] ?? 0)
      }))
      .filter(({ category, amount }) => category.is_locked && amount > toNumber(category.budget_amount));

    if (!revisions.length) {
      toast.error('Enter increased amounts for locked categories (must exceed current approved budget)');
      return;
    }

    const token = localStorage.getItem('token');
    setSubmittingProposal(true);
    try {
      for (const { category, amount } of revisions) {
        await api.post('/api/requests', {
          request_type: 'budget_revision',
          department_id: selectedDepartmentId,
          category_id: category.id,
          category: category.category_name,
          item_name: `Budget Revision: ${category.category_name}`,
          amount,
          purpose: `Mid-period budget increase for ${category.category_name}`,
          priority: 'normal'
        }, { headers: { Authorization: `Bearer ${token}` } });
      }
      toast.success(`Submitted ${revisions.length} budget revision request(s) for approval`);
      setRevisionDrafts({});
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to submit budget revision'));
    } finally {
      setSubmittingProposal(false);
    }
  };

  const loadRevisionHistory = async (categoryId: string) => {
    const token = localStorage.getItem('token');
    try {
      const res = await api.get(`/api/audit-logs/budget-revisions/${categoryId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRevisionHistory((prev) => ({ ...prev, [categoryId]: res.data || [] }));
    } catch {
      toast.error('Failed to load revision history');
    }
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="bms-spinner" /></div>;

  const overviewCards = [
    { label: 'Departments', value: overview.totalDepartments.toString(), helper: 'Active in view', glow: 'bg-[var(--role-primary)]' },
    { label: 'Budget Pool', value: displayMoney(overview.totalBudget), helper: secondaryMoney(overview.totalBudget), glow: 'bg-[var(--role-secondary)]' },
    { label: 'Used', value: displayMoney(overview.usedBudget), helper: `Remaining ${displayMoney(Math.max(overview.totalBudget - overview.usedBudget, 0))}`, glow: 'bg-[var(--role-primary)]' },
    { label: 'Utilization', value: formatPercent(overview.utilization), helper: `${displayMoney(Math.max(overview.totalBudget - overview.usedBudget, 0))} available`, glow: 'bg-[var(--role-secondary)]' },
  ];

  return (
    <div className="text-[var(--role-text)] page-transition">
      {/* Header with overview cards + FX panel */}
      <div className="page-header">
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="page-title">{isViewOnlyMatrix && !canEditMatrix ? 'Budget Matrix (View Only)' : 'Budget Matrix'}</h1>
            <p className="page-subtitle">
              {user?.role === 'supervisor'
                ? 'Propose budgets for your department. Locked matrices cannot be edited — contact accounting to unlock.'
                : user?.role === 'vp' || user?.role === 'president'
                  ? 'View-only access to department budget proposals and approved matrices.'
                  : 'Live FX conversion, department budgets, category management, and fiscal year planning.'}
            </p>
            <p className="mt-2 text-sm text-[var(--role-text)]/60">Active fiscal year: <span className="font-semibold text-[var(--role-text)]">FY {activeFiscalYear}</span></p>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_360px]">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {overviewCards.map(card => (
                <div key={card.label} className="group relative overflow-hidden rounded-[28px] border border-[var(--role-border)] bg-[var(--role-surface)] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.04)]">
                  <div className={`absolute -right-10 top-0 h-24 w-24 rounded-full blur-2xl ${card.glow} opacity-10`} />
                  <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--role-text)]/60">{card.label}</p>
                  <p className="mt-3 break-words text-2xl font-bold leading-tight text-[var(--role-text)]">{card.value}</p>
                  <p className="mt-3 border-t border-[var(--role-border)] pt-3 text-sm text-[var(--role-text)]/70">{card.helper}</p>
                </div>
              ))}
            </div>
            {/* FX Card */}
            <div className="relative overflow-hidden rounded-[32px] border border-[var(--role-border)] bg-[var(--role-surface)] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.04)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--role-text)]/50">Exchange Rates</p>
                  <p className="mt-2 text-2xl font-bold leading-none text-[var(--role-text)]">{fxRatePhp.toFixed(4)} <span className="text-sm font-normal text-[var(--role-text)]/60">PHP / USD</span></p>
                  <p className="mt-1 text-2xl font-bold leading-none text-[var(--role-text)]">{(fxRateIdr / 1000).toFixed(3)}K <span className="text-sm font-normal text-[var(--role-text)]/60">IDR / USD</span></p>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${fxStatus === 'live' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700' : 'border-[var(--role-border)] bg-[var(--role-accent)] text-[var(--role-text)]/70'}`}>
                  <span className={`h-2 w-2 rounded-full ${fxStatus === 'live' ? 'animate-pulse bg-emerald-500' : 'bg-[var(--role-text)]/30'}`} />
                  {fxStatus === 'live' ? 'Live' : 'Fallback'}
                </span>
              </div>
              <p className="mt-2 text-xs text-[var(--role-text)]/50">Updated {fxRateUpdatedAt ? formatDateTime(fxRateUpdatedAt) : 'just now'}</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--role-border)]">
                <div className="h-full rounded-full bg-gradient-to-r from-[var(--role-primary)] to-[var(--role-secondary)]" style={{ width: `${Math.min(100, overview.utilization)}%` }} />
              </div>
              <p className="mt-1 text-xs text-[var(--role-text)]/50">{formatPercent(overview.utilization)} budget utilized</p>
              <div className="mt-3 flex gap-2">
                <button className="btn-primary flex-1 text-sm" onClick={() => setDisplayCurrency(c => c === 'PHP' ? 'USD' : c === 'USD' ? 'IDR' : 'PHP')}>
                  {displayCurrency === 'PHP' ? 'Show in USD' : displayCurrency === 'USD' ? 'Show in IDR' : 'Show in PHP'}
                </button>
                <button className="btn-secondary text-sm px-3" onClick={() => fetchExchangeRate(true)} title="Refresh FX">↻</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Layout: dept list left, detail right */}
      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
        {/* Department List */}
        <div className="panel xl:sticky xl:top-24 xl:self-start">
          <h2 className="text-lg font-bold mb-1">Departments</h2>
          <p className="text-xs text-[var(--role-text)]/50 mb-4">Filtered per fiscal year. Legacy m88 entries hidden.</p>

          <div className="space-y-3 rounded-[24px] border border-[var(--role-border)] bg-[var(--role-accent)] p-4 mb-4">
            <div className="flex flex-wrap gap-2">
              {availableFiscalYears.map(y => (
                <button key={y} onClick={() => setSelectedFiscalYear(y)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] transition ${selectedFiscalYear === y ? 'border-[var(--role-secondary)] bg-[var(--role-secondary)] text-[var(--role-text-inverse)]' : 'border-[var(--role-border)] bg-[var(--role-surface)] text-[var(--role-text)]/60 hover:border-[var(--role-secondary)]/50'}`}>
                  FY {y}
                </button>
              ))}
            </div>
            <input className="field-input" placeholder="Filter by name…" value={departmentSearch} onChange={e => setDepartmentSearch(e.target.value)} />
            <select className="field-input" value={budgetHealthFilter} onChange={e => setBudgetHealthFilter(e.target.value as any)}>
              <option value="all">All Budget Health</option>
              <option value="low">Low Utilization</option>
              <option value="high">High Utilization</option>
              <option value="critical">Critical Budget</option>
            </select>
          </div>

          <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
            {filteredDepts.map(dept => {
              const annual = toNumber(dept.annual_budget), used = toNumber(dept.used_budget);
              const remaining = toNumber(dept.remaining_budget || (annual - used));
              const utilization = annual > 0 ? (used / annual) * 100 : 0;
              const health = getBudgetHealth(dept);
              const isSelected = dept.id === selectedDepartmentId;
              return (
                <button key={dept.id} onClick={() => setSelectedDepartmentId(dept.id)} className={`w-full overflow-hidden rounded-[24px] border text-left transition ${isSelected ? 'border-[var(--role-secondary)]/50 bg-[var(--role-accent)] shadow-[0_8px_32px_rgba(0,0,0,0.06)]' : 'border-[var(--role-border)] bg-[var(--role-surface)] hover:border-[var(--role-secondary)]/30 hover:bg-[var(--role-accent)]/50'}`}>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="inline-flex rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--role-text)]/60">{getDeptCode(dept.name)}</span>
                        <p className="mt-1 font-semibold text-sm text-[var(--role-text)]">{dept.name}</p>
                        <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--role-text)]/40">FY {dept.fiscal_year}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-xs text-[var(--role-text)]/60">{formatPercent(utilization)}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${health === 'critical' ? 'border-red-500/20 bg-red-500/10 text-red-600' : health === 'high' ? 'border-orange-500/20 bg-orange-500/10 text-orange-600' : 'border-[var(--role-border)] bg-[var(--role-accent)] text-[var(--role-text)]/50'}`}>{health}</span>
                      </div>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--role-border)]">
                      <div className="h-full rounded-full bg-gradient-to-r from-[var(--role-primary)] to-[var(--role-secondary)]" style={{ width: `${Math.min(utilization, 100)}%` }} />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-accent)] p-2 text-center">
                        <p className="text-[10px] uppercase text-[var(--role-text)]/50">Total</p>
                        <p className="font-semibold text-[var(--role-text)]">{displayMoney(annual)}</p>
                      </div>
                      <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-accent)] p-2 text-center">
                        <p className="text-[10px] uppercase text-[var(--role-text)]/50">Remaining</p>
                        <p className="font-semibold text-[var(--role-text)]">{displayMoney(remaining)}</p>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
            {filteredDepts.length === 0 && <p className="text-sm text-[var(--role-text)]/50 text-center py-6">No departments match filters.</p>}
          </div>
        </div>

        {/* Budget Workspace */}
        <div className="panel overflow-hidden">
          <div className="relative overflow-hidden rounded-[28px] border border-[var(--role-border)] bg-[var(--role-surface)] p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)]">
            <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-[var(--role-primary)]/5 blur-3xl" />
            <div className="relative">
              <p className="text-xs uppercase tracking-[0.22em] text-[var(--role-text)]/50">Budget Workspace</p>
              <h2 className="mt-2 text-3xl font-bold text-[var(--role-text)]">{selectedDepartment?.name || breakdownDept?.name || 'Select a department'}</h2>
              {(selectedDepartment || breakdownDept) && (
                <span className="mt-2 inline-flex rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--role-text)]/70">
                  {getDeptCode(selectedDepartment?.name || breakdownDept?.name)}
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)] px-4 py-3 text-sm text-[var(--role-text)]/60 sm:flex-row sm:items-center sm:justify-between">
            <span>Auto-refresh every 15s · Displaying in {displayCurrency}</span>
            <div className="flex items-center gap-2">
              <span>Synced: {formatDateTime(selectedBreakdown?.generated_at)}</span>
              <button className="btn-secondary !rounded-full !px-3 !py-1.5 text-xs" onClick={() => { fetchExchangeRate(true); if (selectedDepartmentId) fetchBreakdown(selectedDepartmentId, true, true); }}>Refresh</button>
            </div>
          </div>

          {detailLoading ? (
            <div className="py-16 text-center text-[var(--role-text)]/60">Loading breakdown…</div>
          ) : detailError || !breakdownDept || !breakdownTotals ? (
            <div className="mt-6 space-y-6">
              <div className="rounded-[28px] border border-[var(--role-border)] bg-[var(--role-accent)] p-8 text-center">
                <p className="text-lg font-semibold text-[var(--role-text)]">Detailed breakdown unavailable</p>
                <p className="mt-2 text-sm text-[var(--role-text)]/60">{detailError || 'Select a department to view details.'}</p>
                <button className="btn-secondary mt-4" onClick={() => { if (selectedDepartmentId) fetchBreakdown(selectedDepartmentId, true, true); }}>Try Again</button>
              </div>
              {selectedDepartment && (
                <div className="rounded-[28px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5 space-y-3">
                  <h3 className="font-semibold text-[var(--role-text)]">Budget Update</h3>
                  <div className="flex gap-3">
                    <input type="number" step="0.01" placeholder="New Budget Amount" className="field-input flex-1" value={budgetInputs[selectedDepartmentId] || ''} onChange={e => setBudgetInputs(p => ({ ...p, [selectedDepartmentId]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') { const v = parseFloat((e.target as HTMLInputElement).value); if (v > 0) updateBudget(selectedDepartmentId, v); } }} />
                    <button className="btn-success" onClick={() => { const v = parseFloat(budgetInputs[selectedDepartmentId]); if (v > 0) updateBudget(selectedDepartmentId, v); }}>Update</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              {/* 4-stat grid */}
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {[
                  { label: 'Annual Budget', value: displayMoney(breakdownTotals.annual_budget), sub: secondaryMoney(breakdownTotals.annual_budget) },
                  { label: 'Utilized', value: displayMoney(breakdownTotals.used_budget), sub: secondaryMoney(breakdownTotals.used_budget) },
                  { label: 'Available', value: displayMoney(breakdownDept.remaining_budget), sub: secondaryMoney(breakdownDept.remaining_budget) },
                  { label: 'Utilization', value: formatPercent(breakdownDept.utilization_percentage), sub: `Committed: ${displayMoney(breakdownDept.projected_committed_total)}` },
                ].map(s => (
                  <div key={s.label} className="rounded-[24px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5">
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/60">{s.label}</p>
                    <p className="mt-3 text-2xl font-bold text-[var(--role-text)]">{s.value}</p>
                    <p className="mt-1 text-sm text-[var(--role-text)]/60">{s.sub}</p>
                  </div>
                ))}
              </div>

              {/* Unlock Budget Matrix — prominent banner, accounting/admin only */}
              {canEditMatrix && enrichedCategories.some(c => c.is_locked) && (
                <div className="rounded-[24px] border-2 border-amber-400/50 bg-amber-50/60 p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 border border-amber-400/30">
                        <svg className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-bold text-amber-800">
                          {enrichedCategories.filter(c => c.is_locked).length} Locked Categor{enrichedCategories.filter(c => c.is_locked).length !== 1 ? 'ies' : 'y'}
                        </p>
                        <p className="text-xs text-amber-700/70 mt-0.5">
                          Budget matrix is locked after approval. Unlock to allow new proposals or edits.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <button
                        onClick={async () => {
                          const locked = enrichedCategories.filter(c => c.is_locked);
                          const token = localStorage.getItem('token');
                          let ok = 0;
                          for (const cat of locked) {
                            try {
                              await api.patch(`/api/budget/categories/${cat.id}/unlock`, {}, { headers: { Authorization: `Bearer ${token}` } });
                              ok++;
                            } catch { /* skip */ }
                          }
                          if (ok > 0) toast.success(`Unlocked ${ok} categor${ok !== 1 ? 'ies' : 'y'}`);
                          if (selectedDepartmentId) await fetchBreakdown(selectedDepartmentId, false, false);
                        }}
                        className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white hover:bg-amber-600 transition flex items-center gap-2 whitespace-nowrap"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                        </svg>
                        Unlock All ({enrichedCategories.filter(c => c.is_locked).length})
                      </button>
                    </div>
                  </div>
                  {/* Locked category chips */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {enrichedCategories.filter(c => c.is_locked).map(cat => (
                      <div key={cat.id} className="flex items-center gap-1.5 rounded-full border border-amber-300/50 bg-white/70 pl-2.5 pr-1.5 py-1">
                        <span className="font-mono text-[10px] text-amber-700 font-bold">{cat.category_code}</span>
                        <span className="text-xs text-[var(--role-text)]/70 max-w-[120px] truncate">{cat.category_name}</span>
                        <button
                          onClick={() => unlockCategory(cat.id)}
                          className="ml-1 rounded-full bg-amber-100 hover:bg-amber-200 p-0.5 transition"
                          title={`Unlock ${cat.category_name}`}
                        >
                          <svg className="h-3 w-3 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.1fr)_340px]">
                <div className="space-y-6">
                  {/* Category Management */}
                  <div className="rounded-[28px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-semibold text-[var(--role-text)]">Category Budgets</h3>
                        <p className="text-xs text-[var(--role-text)]/50 mt-0.5">FY{selectedDepartment?.fiscal_year} · {selectedBreakdown?.categories?.length || 0} categories · {displayMoney(editableBudgetValue)} budget</p>
                      </div>
                      <button onClick={() => setShowAddCategory(v => !v)} disabled={!canEditMatrix} className="text-xs bg-emerald-500 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-600 transition flex items-center gap-1 disabled:opacity-50">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        {showAddCategory ? 'Cancel' : 'Add'}
                      </button>
                    </div>

                    <div className="mb-4">
                      <label className="field-label">Search categories</label>
                      <input
                        type="search"
                        value={categorySearch}
                        onChange={(e) => setCategorySearch(e.target.value)}
                        placeholder="Search by code, name, or parent category…"
                        className="field-input"
                      />
                      {categorySearch.trim() && (
                        <p className="mt-1 text-xs text-[var(--role-text)]/50">
                          Showing {orderedCategories.length} of {enrichedCategories.length} categories
                        </p>
                      )}
                    </div>

                    {/* Budget / Allocated / Available summary */}
                    <div className="mb-4 flex gap-2 text-xs">
                      {[{ label: 'Budget', val: editableBudgetValue, cls: 'bg-emerald-50 border-emerald-100 text-emerald-700' }, { label: 'Allocated', val: categoryAllocatedTotal, cls: 'bg-amber-50 border-amber-100 text-amber-700' }, { label: 'Available', val: categoryAllocationRemaining, cls: 'bg-blue-50 border-blue-100 text-blue-700' }].map(s => (
                        <div key={s.label} className={`flex-1 p-2 rounded-lg border text-center ${s.cls}`}>
                          <span className="block text-[10px] uppercase font-semibold">{s.label}</span>
                          <span className="font-bold">{displayMoney(s.val)}</span>
                        </div>
                      ))}
                    </div>

                    {selectedBreakdown?.categories?.length > 0 && (
                      <div className="mb-3 flex gap-2">
                        <button onClick={async () => { if (!confirm('Delete ALL categories?')) return; const t = localStorage.getItem('token'); try { toast.loading('Clearing…', { id: 'clr' }); await Promise.all(selectedBreakdown.categories.map((c: any) => api.delete(`/api/budget/categories/${c.id}`, { headers: { Authorization: `Bearer ${t}` } }))); toast.success('Cleared!', { id: 'clr' }); await fetchBreakdown(selectedDepartmentId, false, false); await fetchDepartments(false); } catch { toast.error('Failed', { id: 'clr' }); } }} className="text-xs bg-red-100 text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-200 transition">🗑 Clear All</button>
                        <button onClick={initializeDefaultCategories} className="text-xs bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-200 transition">↺ Reset to Default</button>
                      </div>
                    )}

                    {user?.role === 'supervisor' && parentCategoryOptions.some((c) => c.is_locked) && (
                      <div className="mb-4 p-4 rounded-xl border border-amber-200 bg-amber-50/50 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <h4 className="text-sm font-semibold text-[var(--role-text)]">Budget Revision Request</h4>
                            <p className="text-xs text-[var(--role-text)]/60">Request a mid-period increase for locked categories. Follows the same approval flow as a new proposal.</p>
                          </div>
                          <button type="button" onClick={() => void submitBudgetRevisions()} disabled={submittingProposal} className="btn-secondary !px-4 !py-2 !text-xs disabled:opacity-50">
                            {submittingProposal ? 'Submitting…' : 'Submit Revision'}
                          </button>
                        </div>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {parentCategoryOptions.filter((c) => c.is_locked).map((cat) => (
                            <div key={`rev-${cat.id}`} className="flex items-center gap-2 text-sm">
                              <span className="flex-1 truncate font-medium">{cat.category_name}</span>
                              <span className="text-xs text-[var(--role-text)]/50 whitespace-nowrap">Approved: {displayMoney(toNumber(cat.budget_amount))}</span>
                              <input
                                type="number"
                                step="0.01"
                                min={toNumber(cat.budget_amount) + 0.01}
                                placeholder="New amount"
                                value={revisionDrafts[cat.id] ?? ''}
                                onChange={(e) => setRevisionDrafts((prev) => ({ ...prev, [cat.id]: e.target.value }))}
                                className="w-28 px-2 py-1 text-xs rounded border border-[var(--role-border)] bg-[var(--role-surface)]"
                              />
                              <button type="button" onClick={() => void loadRevisionHistory(cat.id)} className="text-[10px] text-[var(--role-primary)] underline">History</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Add form */}
                    {user?.role === 'supervisor' && parentCategoryOptions.length > 0 && (
                      <div className="mb-4 p-4 rounded-xl border border-blue-200 bg-blue-50/50 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <h4 className="text-sm font-semibold text-[var(--role-text)]">Budget Proposal</h4>
                            <p className="text-xs text-[var(--role-text)]/60">Propose amounts per main category, then submit for accounting → VP → President approval.</p>
                          </div>
                          <button type="button" onClick={() => void submitBudgetProposals()} disabled={submittingProposal} className="btn-primary !px-4 !py-2 !text-xs disabled:opacity-50">
                            {submittingProposal ? 'Submitting…' : 'Submit Proposal'}
                          </button>
                        </div>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {parentCategoryOptions.map((cat) => (
                            <div key={cat.id} className="flex items-center gap-2 text-sm">
                              <span className="flex-1 truncate font-medium">{cat.category_name}</span>
                              <span className="text-xs text-[var(--role-text)]/50 whitespace-nowrap">Current: {displayMoney(toNumber(cat.budget_amount))}</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="Proposed"
                                value={proposalDrafts[cat.id] ?? ''}
                                onChange={(e) => setProposalDrafts((prev) => ({ ...prev, [cat.id]: e.target.value }))}
                                disabled={cat.is_locked}
                                className="w-28 px-2 py-1 text-xs rounded border border-[var(--role-border)] bg-[var(--role-surface)] disabled:bg-gray-100"
                              />
                              {cat.is_locked && <span className="text-[10px] text-amber-700 font-semibold">LOCKED</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {showAddCategory && canEditMatrix && (
                      <div className="mb-4 p-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-accent)]/50 space-y-2">
                        <div>
                          <label className="text-[10px] uppercase tracking-wide text-[var(--role-text)]/50">
                            Under parent category {isNewMainCategory ? '(optional)' : '(required)'}
                          </label>
                          <select
                            value={newCategory.parent_category_id}
                            onChange={(e) => setNewCategory((prev) => ({ ...prev, parent_category_id: e.target.value }))}
                            className="mt-1 w-full px-2 py-1.5 text-sm rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)]"
                          >
                            <option value="">None — top-level category</option>
                            {parentCategoryOptions.map((category) => (
                              <option key={category.id} value={category.id}>
                                {category.category_code} — {category.category_name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <input type="text" placeholder="Code" value={newCategory.category_code} onChange={e => setNewCategory(p => ({ ...p, category_code: e.target.value.toUpperCase() }))} className="w-20 px-2 py-1.5 text-sm rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)]" />
                          <input type="text" placeholder="Category Name" value={newCategory.category_name} onChange={e => setNewCategory(p => ({ ...p, category_name: e.target.value }))} className="flex-1 px-2 py-1.5 text-sm rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)]" />
                          <input type="number" step="0.01" min="0" placeholder="₱" value={newCategory.budget_amount} onChange={e => setNewCategory(p => ({ ...p, budget_amount: e.target.value }))} className="w-24 px-2 py-1.5 text-sm rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)]" />
                          <button onClick={addNewCategory} disabled={!newCategory.category_code || !newCategory.category_name || (!isNewMainCategory && !newCategory.parent_category_id)} className="px-3 py-1.5 text-sm bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition">+</button>
                        </div>
                      </div>
                    )}

                    {/* Category list */}
                    {enrichedCategories.length > 0 ? (
                      <>
                        <div className="space-y-1 max-h-64 overflow-y-auto">
                          {paginatedCategories.map(({ cat, depth }) => {
                              const budget = toNumber(cat.budget_amount), used = toNumber(cat.used_amount), committed = toNumber(cat.committed_amount);
                              const totalConsumed = used + committed;
                              const rem = Math.max(0, budget - totalConsumed);
                              const pct = budget > 0 ? (totalConsumed / budget) * 100 : 0;
                              const utilizationWarning = user?.role === 'supervisor' && pct >= 80;
                              
                              // Calculate sub-category total for parent categories
                              const children = enrichedCategories.filter(c => c.parent_category_id === cat.id);
                              const childrenTotal = children.reduce((sum, child) => sum + toNumber(child.budget_amount), 0);
                              const hasChildren = children.length > 0;
                              const childrenWarning = hasChildren && childrenTotal > budget;
                              
                              return (
                                <div key={cat.id} className={`rounded-xl border p-3 ${utilizationWarning ? 'border-amber-400 bg-amber-50/40' : ''} ${childrenWarning ? 'border-red-400 bg-red-50/40' : 'border-[var(--role-border)] bg-[var(--role-surface)]'}`} style={{ marginLeft: `${depth * 16}px` }}>
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-mono text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">{cat.category_code}</span>
                                    <span className="flex-1 text-sm font-medium truncate text-[var(--role-text)]">
                                      {depth > 0 ? '↳ ' : ''}{cat.category_name}
                                    </span>
                                    {utilizationWarning && (
                                      <span className="text-[10px] font-semibold text-amber-800 bg-amber-200 px-1.5 py-0.5 rounded" title="80%+ of approved budget used">
                                        ⚠ {pct.toFixed(0)}% used
                                      </span>
                                    )}
                                    {childrenWarning && (
                                      <span className="text-[10px] font-semibold text-red-800 bg-red-200 px-1.5 py-0.5 rounded" title="Sub-categories exceed parent budget">
                                        ⚠ Sub-cats: {displayMoney(childrenTotal)} &gt; {displayMoney(budget)}
                                      </span>
                                    )}
                                    {hasChildren && !childrenWarning && (
                                      <span className="text-[10px] text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded" title="Sub-categories total">
                                        Sub-cats: {displayMoney(childrenTotal)}
                                      </span>
                                    )}
                                    {cat.is_locked && (
                                      <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">LOCKED</span>
                                    )}
                                    {cat.parent_category_name && (
                                      <span className="text-[10px] text-[var(--role-text)]/50 whitespace-nowrap">
                                        under {cat.parent_category_name}
                                      </span>
                                    )}
                                    {canEditMatrix ? (
                                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                      <input type="number" step="0.01" min="0" value={budgetInputs[`cat_${cat.id}`] ?? cat.budget_amount} onChange={e => setBudgetInputs(p => ({ ...p, [`cat_${cat.id}`]: e.target.value }))} className="w-20 px-2 py-1 text-right text-xs rounded border border-[var(--role-border)] bg-[var(--role-accent)]" disabled={cat.is_locked} />
                                      <button onClick={() => { const v = parseFloat(budgetInputs[`cat_${cat.id}`] ?? cat.budget_amount); if (v >= 0) updateCategoryBudget(cat.id, v); }} disabled={cat.is_locked} className="px-2 py-1 text-[10px] bg-emerald-500 text-white rounded hover:bg-emerald-600 disabled:opacity-50">✓</button>
                                      {cat.is_locked ? (
                                        <button onClick={() => unlockCategory(cat.id)} className="px-2 py-1 text-[10px] bg-amber-500 text-white rounded hover:bg-amber-600">Unlock</button>
                                      ) : (
                                        <button onClick={() => deleteCategory(cat.id)} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded" title="Delete"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                                      )}
                                    </div>
                                    ) : (
                                    <span className="text-sm font-semibold text-emerald-600">{displayMoney(budget)}</span>
                                    )}
                                  </div>
                                  <div className="w-full bg-gray-200 rounded-full h-1.5 mb-1">
                                    <div className={`h-1.5 rounded-full ${utilizationWarning ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                                  </div>
                                  <div className="flex justify-between text-[10px] text-[var(--role-text)]/50">
                                    <span>Used: <span className={`font-medium ${utilizationWarning ? 'text-amber-700' : 'text-amber-600'}`}>{displayMoney(used)}</span> + Committed: {displayMoney(committed)} ({pct.toFixed(1)}%)</span>
                                    <span>Approved: {displayMoney(budget)} · Rem: <span className="text-emerald-600 font-medium">{displayMoney(rem)}</span></span>
                                  </div>
                                  {(revisionHistory[cat.id]?.length ?? 0) > 0 && (
                                    <div className="mt-2 pt-2 border-t border-[var(--role-border)] text-[10px] text-[var(--role-text)]/60 space-y-1">
                                      <p className="font-semibold">Revision history</p>
                                      {revisionHistory[cat.id].slice(0, 3).map((entry: any) => (
                                        <p key={entry.id}>
                                          {formatDateTime(entry.approved_at || entry.created_at)} — {displayMoney(toNumber(entry.previous_amount))} → {displayMoney(toNumber(entry.approved_amount ?? entry.proposed_amount))} ({entry.revision_type?.replace(/_/g, ' ')})
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                        {orderedCategories.length === 0 && categorySearch.trim() && (
                          <p className="text-sm text-center text-[var(--role-text)]/50 py-4">No categories match your search.</p>
                        )}
                        {orderedCategories.length > CATEGORY_PAGE_SIZE && (
                          <div className="mt-3 flex items-center justify-between rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] px-3 py-2">
                            <span className="text-xs text-[var(--role-text)]/50">Page {categoryPage} / {Math.ceil(orderedCategories.length / CATEGORY_PAGE_SIZE)}</span>
                            <div className="flex gap-2">
                              <button onClick={() => setCategoryPage(p => Math.max(1, p - 1))} disabled={categoryPage === 1} className="btn-secondary !px-3 !py-1 !text-xs disabled:opacity-50">← Prev</button>
                              <button onClick={() => setCategoryPage(p => Math.min(Math.ceil(orderedCategories.length / CATEGORY_PAGE_SIZE), p + 1))} disabled={categoryPage >= Math.ceil(orderedCategories.length / CATEGORY_PAGE_SIZE)} className="btn-secondary !px-3 !py-1 !text-xs disabled:opacity-50">Next →</button>
                            </div>
                          </div>
                        )}
                        <div className="mt-3 pt-3 border-t border-[var(--role-border)] flex justify-between items-center">
                          <span className="text-xs font-semibold text-[var(--role-text)]">Total Allocated</span>
                          <span className="text-base font-bold text-emerald-600">{displayMoney(categoryAllocatedTotal)}</span>
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-8">
                        <p className="text-sm text-[var(--role-text)]/50 mb-3">No categories defined yet.</p>
                        {selectedDepartmentId && <button onClick={initializeDefaultCategories} className="text-xs bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition">Initialize Default Categories</button>}
                      </div>
                    )}
                  </div>

                  {/* Budget Update */}
                  {canEditMatrix && (
                  <div className="rounded-[28px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5">
                    <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                      <h3 className="text-lg font-semibold text-[var(--role-text)]">Update Annual Budget</h3>
                      <span className="rounded-full border border-[var(--role-border)] bg-[var(--role-surface)] px-4 py-2 text-sm text-[var(--role-text)]/60">Current: <span className="font-semibold text-[var(--role-text)]">{displayMoney(breakdownTotals.annual_budget)}</span></span>
                    </div>
                    <div className="flex gap-3">
                      <input type="number" step="0.01" placeholder="New Budget Amount" className="field-input flex-1" value={budgetInputs[selectedDepartmentId] || ''} onChange={e => setBudgetInputs(p => ({ ...p, [selectedDepartmentId]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') { const v = parseFloat((e.target as HTMLInputElement).value); if (v > 0) updateBudget(selectedDepartmentId, v); } }} />
                      <button className="btn-success" onClick={() => { const v = parseFloat(budgetInputs[selectedDepartmentId]); if (v > 0) updateBudget(selectedDepartmentId, v); }}>Update Budget</button>
                    </div>
                  </div>
                  )}

                  {/* Petty Cash */}
                  {canEditMatrix && (
                  <div className="rounded-[28px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5">
                    <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                      <h3 className="text-lg font-semibold text-[var(--role-text)]">Petty Cash Adjustment</h3>
                      <span className="rounded-full border border-[var(--role-border)] bg-[var(--role-surface)] px-4 py-2 text-sm text-[var(--role-text)]/60">Balance: <span className="font-semibold text-[var(--role-text)]">{displayMoney(breakdownTotals.petty_cash_balance)}</span></span>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <select className="field-input sm:w-40" value={pettyCashForm.action} onChange={e => setPettyCashForm(p => ({ ...p, action: e.target.value as any }))}>
                        <option value="replenish">Add Cash</option>
                        <option value="disburse">Deduct Cash</option>
                      </select>
                      <input type="text" className="field-input flex-1" placeholder="Reason for adjustment" value={pettyCashForm.purpose} onChange={e => setPettyCashForm(p => ({ ...p, purpose: e.target.value }))} />
                      <input type="number" step="0.01" className="field-input sm:w-40" placeholder="Amount" value={pettyCashForm.amount} onChange={e => setPettyCashForm(p => ({ ...p, amount: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') submitPettyCash(); }} />
                      <button className="btn-success" onClick={submitPettyCash}>Save</button>
                    </div>
                  </div>
                  )}
                </div>

                {/* Right sidebar: Quick Totals + Recent Requests + Recent Petty Cash */}
                <div className="space-y-6">
                  <div className="rounded-[28px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5">
                    <h3 className="text-lg font-semibold mb-4">Quick Totals</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'Requests', val: breakdownCounts.total_requests },
                        { label: 'Disbursed', val: breakdownCounts.released_requests },
                        { label: 'Direct Exp.', val: breakdownCounts.direct_expenses },
                        { label: 'Petty Txns', val: breakdownCounts.petty_cash_transactions },
                      ].map(s => (
                        <div key={s.label} className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4">
                          <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--role-text)]/60">{s.label}</p>
                          <p className="mt-2 text-2xl font-bold text-[var(--role-text)]">{s.val}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-semibold">Recent Requests</h3>
                        <p className="text-xs text-[var(--role-text)]/50">Budget proposals and revisions are only category updates until released; actual spend is tracked separately.</p>
                      </div>
                      <span className="text-xs text-[var(--role-text)]/50 uppercase tracking-[0.14em]">Latest {RECENT_PAGE_SIZE}/page</span>
                    </div>
                    <div className="space-y-3">
                      {selectedBreakdown.recent_requests.length === 0 && <p className="text-sm text-[var(--role-text)]/60">No recent requests.</p>}
                      {selectedBreakdown.recent_requests.slice((recentRequestsPage - 1) * RECENT_PAGE_SIZE, recentRequestsPage * RECENT_PAGE_SIZE).map((req: any) => (
                        <div key={req.id} className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold text-sm text-[var(--role-text)]">{req.item_name}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--role-text)]/60">
                                <span>{req.request_code}</span>
                                <span>·</span>
                                <span>{req.category}</span>
                                <span className="rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] px-2 py-0.5 uppercase tracking-[0.12em]">{getRequestTypeLabel(req.request_type)}</span>
                              </div>
                            </div>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize whitespace-nowrap ${statusTone(req.status)}`}>{req.status?.replace('_', ' ')}</span>
                          </div>
                          <div className="mt-2 flex items-center justify-between text-sm">
                            <p className="font-semibold text-[var(--role-text)]">{displayMoney(toNumber(req.department_allocation_amount || req.amount))}</p>
                            <p className="text-xs text-[var(--role-text)]/50">{formatDateTime(req.submitted_at || req.updated_at)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    {selectedBreakdown.recent_requests.length > RECENT_PAGE_SIZE && (
                      <div className="mt-3 flex items-center justify-between rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] px-3 py-2">
                        <span className="text-xs text-[var(--role-text)]/50">Page {recentRequestsPage} / {Math.ceil(selectedBreakdown.recent_requests.length / RECENT_PAGE_SIZE)}</span>
                        <div className="flex gap-2">
                          <button onClick={() => setRecentRequestsPage(p => Math.max(1, p - 1))} disabled={recentRequestsPage === 1} className="btn-secondary !px-3 !py-1 !text-xs disabled:opacity-50">Prev</button>
                          <button onClick={() => setRecentRequestsPage(p => Math.min(Math.ceil(selectedBreakdown.recent_requests.length / RECENT_PAGE_SIZE), p + 1))} disabled={recentRequestsPage >= Math.ceil(selectedBreakdown.recent_requests.length / RECENT_PAGE_SIZE)} className="btn-secondary !px-3 !py-1 !text-xs disabled:opacity-50">Next</button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-[28px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold">Recent Petty Cash</h3>
                      <span className="text-xs text-[var(--role-text)]/50 uppercase tracking-[0.14em]">Latest {RECENT_PAGE_SIZE}/page</span>
                    </div>
                    <div className="space-y-3">
                      {selectedBreakdown.recent_petty_cash_transactions.length === 0 && <p className="text-sm text-[var(--role-text)]/60">No petty cash activity yet.</p>}
                      {selectedBreakdown.recent_petty_cash_transactions.slice((recentPettyPage - 1) * RECENT_PAGE_SIZE, recentPettyPage * RECENT_PAGE_SIZE).map((txn: any) => (
                        <div key={txn.id} className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold capitalize text-sm text-[var(--role-text)]">{txn.type}</p>
                              <p className="text-xs text-[var(--role-text)]/60">{txn.purpose || 'No purpose provided.'}</p>
                            </div>
                            <p className="font-semibold text-sm text-[var(--role-text)]">{displayMoney(toNumber(txn.amount))}</p>
                          </div>
                          <p className="mt-2 text-xs text-[var(--role-text)]/50">{formatDateTime(txn.transaction_date || txn.created_at)}</p>
                        </div>
                      ))}
                    </div>
                    {selectedBreakdown.recent_petty_cash_transactions.length > RECENT_PAGE_SIZE && (
                      <div className="mt-3 flex items-center justify-between rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] px-3 py-2">
                        <span className="text-xs text-[var(--role-text)]/50">Page {recentPettyPage} / {Math.ceil(selectedBreakdown.recent_petty_cash_transactions.length / RECENT_PAGE_SIZE)}</span>
                        <div className="flex gap-2">
                          <button onClick={() => setRecentPettyPage(p => Math.max(1, p - 1))} disabled={recentPettyPage === 1} className="btn-secondary !px-3 !py-1 !text-xs disabled:opacity-50">Prev</button>
                          <button onClick={() => setRecentPettyPage(p => Math.min(Math.ceil(selectedBreakdown.recent_petty_cash_transactions.length / RECENT_PAGE_SIZE), p + 1))} disabled={recentPettyPage >= Math.ceil(selectedBreakdown.recent_petty_cash_transactions.length / RECENT_PAGE_SIZE)} className="btn-secondary !px-3 !py-1 !text-xs disabled:opacity-50">Next</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Department Panel */}
      <div className="panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-[var(--role-text)]">Add New Department</h2>
            <p className="mt-2 text-[var(--role-text)]/60">Add a single department or bulk-generate all departments for the next fiscal year.</p>
          </div>
          <button className="btn-secondary w-full lg:w-auto" onClick={createNextFiscalYearDepts}>
            Add All Depts for FY {activeFiscalYear + 1}
          </button>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <input className="field-input" placeholder="Department Name" value={newDept.name} onChange={e => setNewDept(p => ({ ...p, name: e.target.value }))} />
          <input className="field-input" type="number" step="0.01" placeholder="Annual Budget" value={newDept.annual_budget} onChange={e => setNewDept(p => ({ ...p, annual_budget: e.target.value }))} />
          <input className="field-input" type="number" placeholder="Fiscal Year" value={newDept.fiscal_year} onChange={e => setNewDept(p => ({ ...p, fiscal_year: Number(e.target.value) }))} />
        </div>
        <button className="btn-primary mt-4" onClick={createDepartment}>Create Department</button>
      </div>
    </div>
  );
};

export default BudgetManagement;
