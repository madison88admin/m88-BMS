import React, { useEffect, useMemo, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import PageSkeleton from '../components/Skeleton';
import { formatMoney, formatDateTime, formatPercent, toNumber , getErrorMessage } from '../utils/format';
import { supabase } from '../lib/supabase';
import {
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  LabelList,
  Cell,
} from 'recharts';

const DEFAULT_FX_RATE_PHP = 56.0;
const DEFAULT_FX_RATE_IDR = 15800.0;
const FX_ENDPOINT = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=PHP,IDR';
const RECENT_PAGE_SIZE = 4;
const TRAVEL_BOOKING_URL = import.meta.env.VITE_TRAVEL_BOOKING_URL || 'https://m88-travel-booking.netlify.app';

// Spending breakdown category mapping
const DISPLAY_CATEGORIES: Record<string, string> = {
  '6010.1': 'Zoom',
  '6020.1': 'Automobile Fuel',
  '6170': 'Computer and Internet Expenses',
  '6430.1': 'Birthday Celebrations',
  '6490.1': 'Office Stationery & Supplies',
  '6501': 'Medical Expenses',
  '6650': 'Postage and Delivery',
  '6670.01': 'Professional Fees - Accounting',
  '6711': 'Office Rent Expense',
  '6720': 'Repairs and Maintenance',
  '6840.1': 'Local Travel - Airline Expenses',
  '6860.1': 'Electricity',
  '6870.1': 'Globe',
  '6900.1': 'Seminar',
  '6351': 'Business Tax/Licenses',
};

const OTHERS_CATEGORIES = new Set([
  '6040',  // Bank Service Charges
  '6041',  // Realized Forex Gain/Loss
  '6240',  // Depreciation Expense
  '6330',  // Insurance Expense
  '6340',  // Interest Expense
  '9900',  // Sundry & Misc
]);

// Segment colors for iPhone storage-style chart
const SEGMENT_COLORS: Record<string, string> = {
  '6020.1': '#FF6B6B', // Automobile Fuel - red-orange
  '6170': '#4ECDC4', // Computer and Internet - teal
  '6430.1': '#45B7D1', // Birthday Celebrations - blue
  '6490.1': '#96CEB4', // Office Stationery - green
  '6501': '#FFEAA7', // Medical Expenses - yellow
  '6650': '#DDA0DD', // Postage and Delivery - plum
  '6670.01': '#98D8C8', // Professional Fees - mint
  '6711': '#F7DC6F', // Office Rent - gold
  '6720': '#BB8FCE', // Repairs and Maintenance - purple
  '6840.1': '#85C1E9', // Local Travel - light blue
  '6860.1': '#F0B27A', // Electricity - orange
  '6870.1': '#82E0AA', // Globe - light green
  '6900.1': '#F1948A', // Seminar - salmon
  '6351': '#AED6F1', // Business Tax - sky blue
  '6010.1': '#D7BDE2', // Zoom - lavender
  'Others': '#BDC3C7', // Others - gray
  'Available': '#ECF0F1', // Available - light gray
};

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

// Inline style fallback — guarantees color even if Tailwind JIT purges dynamic class
const getUtilizationStyle = (pct: number): React.CSSProperties => {
  if (pct >= 80) return { color: '#ef4444' };   // red-500
  if (pct >= 50) return { color: '#f59e0b' };   // amber-500
  return { color: '#16a34a' };                   // green-600
};

const getUtilizationBarStyle = (pct: number): React.CSSProperties => {
  if (pct >= 80) return { backgroundColor: '#ef4444' };
  if (pct >= 50) return { backgroundColor: '#f59e0b' };
  return { backgroundColor: '#16a34a' };
};

const getDeptIcon = (name?: string) => {
  const n = (name || '').toLowerCase();
  if (n.includes('it')) return (
    // Laptop / device icon for IT
    <svg className="h-5 w-5 text-[var(--role-text)]/40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
  if (n.includes('finance') || n.includes('accounting') || n.includes('costing')) return (
    // Receipt / calculator icon for Finance/Accounting/Costing
    <svg className="h-5 w-5 text-[var(--role-text)]/40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
    </svg>
  );
  if (n.includes('hr') || n.includes('human')) return (
    // Users icon for HR
    <svg className="h-5 w-5 text-[var(--role-text)]/40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
  if (n.includes('executive') || n.includes('president') || n.includes('vp')) return (
    // Briefcase icon for Executive
    <svg className="h-5 w-5 text-[var(--role-text)]/40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
  // Default: building icon
  return (
    <svg className="h-5 w-5 text-[var(--role-text)]/40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  );
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
  const [displayCurrency, setDisplayCurrency] = useState<'PHP' | 'USD' | 'IDR'>('PHP');
  const [selectedFiscalYear, setSelectedFiscalYear] = useState<number>(new Date().getFullYear());
  const [departmentSearch] = useState('');
  const [budgetHealthFilter] = useState<'all' | 'low' | 'high' | 'critical'>('all');
  const [newDept, setNewDept] = useState({ name: '', fiscal_year: new Date().getFullYear() });
  const [pettyCashForm, setPettyCashForm] = useState({ amount: '', purpose: '', action: 'replenish' as 'replenish' | 'disburse' });
  const [categoryPage, setCategoryPage] = useState(1);
  const [recentRequestsPage, setRecentRequestsPage] = useState(1);
  const [recentPettyPage, setRecentPettyPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [proposalDrafts, setProposalDrafts] = useState<Record<string, string>>({});
  const [revisionDrafts, setRevisionDrafts] = useState<Record<string, string>>({});
  const [revisionHistory, setRevisionHistory] = useState<Record<string, any[]>>({});
  const [submittingProposal, setSubmittingProposal] = useState(false);
  const [showAllLockedCategories, setShowAllLockedCategories] = useState(false);
  const [m88ManilaCostCenter, setM88ManilaCostCenter] = useState<any>(null);
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string>('');
  const [pettyCashOpen, setPettyCashOpen] = useState(false);
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(new Set());
  const [showInactive, setShowInactive] = useState(true);
  const [categoryPageSize, setCategoryPageSize] = useState(5);
  const [openOverflowId, setOpenOverflowId] = useState<string | null>(null);
  const [costCenterFilterDept, setCostCenterFilterDept] = useState<string>('all');
  const [costCenterFilterCategory, setCostCenterFilterCategory] = useState<string>('all');
  const [costCenterCategories, setCostCenterCategories] = useState<any[]>([]);
  const [spendingBreakdown, setSpendingBreakdown] = useState<any[]>([]);
  const [spendingBreakdownLoading, setSpendingBreakdownLoading] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsFiscalYear, setAnalyticsFiscalYear] = useState<number>(new Date().getFullYear());
  const [analyticsDeptId, setAnalyticsDeptId] = useState<string>('');
  const [analyticsDept, setAnalyticsDept] = useState<string>('all');

  // Accounting, admin, and supervisor may lock/unlock budget matrix
  const canEditMatrix = ['accounting', 'admin', 'supervisor'].includes(String(user?.role || '').toLowerCase());
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
        // Prefer the most recently updated department row when duplicates exist
        const dUpdated = new Date(d.updated_at || d.created_at || 0).getTime();
        const exUpdated = ex ? new Date(ex.updated_at || ex.created_at || 0).getTime() : 0;
        if (!ex || dUpdated > exUpdated) map.set(key, d);
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

      // Filter by cost center department selection
      let matchCostCenterDept = true;
      if (costCenterFilterDept !== 'all') {
        matchCostCenterDept = d.id === costCenterFilterDept;
      }

      return matchYear && matchName && matchHealth && matchCostCenterDept;
    });
  }, [visibleDepartments, selectedFiscalYear, departmentSearch, budgetHealthFilter, costCenterFilterDept]);

  const activeFiscalYear = availableFiscalYears[0] || selectedFiscalYear || new Date().getFullYear();

  const displayAmount = (v: number) => {
    const n = toNumber(v);
    if (displayCurrency === 'USD') return toUsd(n, fxRatePhp);
    if (displayCurrency === 'IDR') return toCurrency(n, fxRatePhp, fxRateIdr);
    return n;
  };
  const displayMoney = (v: number) => formatMoney(displayAmount(v), displayCurrency);

  // Analytics chart number formatter
  const formatChartValue = (value: number): string => {
    const v = toNumber(value);
    if (v >= 1000000) return `₱${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `₱${(v / 1000).toFixed(1)}K`;
    return `₱${v.toFixed(0)}`;
  };

  // Format currency for tooltips
  const formatCurrency = (val: number): string => {
    const v = toNumber(val);
    if (v >= 1_000_000) return `₱${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `₱${(v / 1_000).toFixed(1)}K`;
    return `₱${v.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
  };

  // Analytics chart color scheme
  const BUDGET_COLOR = '#2D6A4F';
  const EXPENSE_COLOR = '#E97316';
  const BUDGET_COLOR_LIGHT = 'rgba(45, 106, 79, 0.5)';

  const selectedDepartment = filteredDepts.find(d => d.id === selectedDepartmentId);
  const breakdownDept = selectedBreakdown?.department;
  const breakdownTotals = selectedBreakdown?.totals;
  const breakdownCounts = selectedBreakdown?.counts;
  const editableBudgetValue = breakdownTotals?.annual_budget ?? toNumber(selectedDepartment?.annual_budget);

  // Filter Quick Totals by expense type
  const filteredBreakdownCounts = useMemo(() => {
    return breakdownCounts;
  }, [breakdownCounts]);

  const enrichedCategories = useMemo(
    () => enrichCategories(selectedBreakdown?.categories || []),
    [selectedBreakdown?.categories]
  );

  // Apply client-side visibility filter for non-accounting viewers when listing categories
  const visibleEnrichedCategories = useMemo(() => {
    try {
      const raw = localStorage.getItem('prefetch_expense_categories');
      const expenseCache = raw ? JSON.parse(raw).data : null;
      if (!expenseCache || !user) return enrichedCategories;
      
      const deptName = selectedDepartment?.name || '';
      const { mapDepartmentNameToShort } = require('../utils/budgetVisibility');
      const deptShort = mapDepartmentNameToShort(deptName);
      
      // Build set of allowed main category codes from expense_categories cache
      const allowedMainCodes = new Set<string>();
      expenseCache.forEach((ec: any) => {
        const code = String(ec.main_category_code || '').trim();
        const dept = String(ec.department || '').trim();
        if (!code) return;
        if (dept === 'All') { allowedMainCodes.add(code); return; }
        if (deptShort && dept === deptShort) { allowedMainCodes.add(code); return; }
      });
      
      // Filter categories based on department restrictions
      return enrichedCategories.filter(c => {
        const code = String(c.category_code || '').trim();
        
        // For main categories: only show if code is in allowed list
        if (!c.parent_category_id) {
          return allowedMainCodes.has(code);
        }
        
        // For sub-categories: show if parent is allowed AND sub-category department is 'All' or matches department
        const parentCode = String(c.parent_category_code || '').trim();
        if (!allowedMainCodes.has(parentCode)) return false;
        
        // Get sub-category's department from expense cache
        const subCatDept = expenseCache.find((ec: any) => ec.category_code === code);
        if (!subCatDept) return true; // If not found, allow (fallback)
        
        const subDept = String(subCatDept.department || '').trim();
        return subDept === 'All' || (deptShort && subDept === deptShort);
      });
    } catch (err) {
      return enrichedCategories;
    }
  }, [enrichedCategories, user, selectedDepartment]);

  const lockedCategories = useMemo(
    () => visibleEnrichedCategories.filter((category) => category.is_locked),
    [visibleEnrichedCategories]
  );

  const orderedCategories = useMemo(
    () => buildOrderedCategories(visibleEnrichedCategories, categorySearch),
    [visibleEnrichedCategories, categorySearch]
  );

  const MAIN_CATEGORY_CODES = useMemo(() => new Set([
    '6010', '6020', '6040', '6041', '6170', '6240', '6330', '6340', '6350', 
    '6430', '6490', '6500', '6650', '6670', '6710', '6720', '6840', '6860', 
    '6870', '6900', '9900'
  ]), []);
  const isNewMainCategory = MAIN_CATEGORY_CODES.has(newCategory.category_code.trim().toUpperCase());

  const parentCategoryOptions = useMemo(
    () => visibleEnrichedCategories.filter((category) => !category.parent_category_id),
    [visibleEnrichedCategories]
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

  const visibleOrderedCategories = useMemo(() => {
    let result = orderedCategories;

    // Apply inactive filter
    if (!showInactive) {
      result = result.filter(({ cat }) => {
        const used = toNumber(cat.used_amount);
        const committed = toNumber(cat.committed_amount);
        const budget = toNumber(cat.budget_amount);
        return !(used === 0 && committed === 0 && budget === 0);
      });
    }

    return result;
  }, [orderedCategories, showInactive]);

  const paginatedCategories = useMemo(
    () => visibleOrderedCategories.slice((categoryPage - 1) * categoryPageSize, categoryPage * categoryPageSize),
    [visibleOrderedCategories, categoryPage, categoryPageSize]
  );

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    api.get('/api/auth/me')
      .then((res) => setUser(res.data))
      .catch(() => {
        try {
          setUser(JSON.parse(localStorage.getItem('user') || '{}'));
        } catch {}
      });
    fetchDepartments();
    fetchExchangeRate(false);
    fetchM88ManilaCostCenter();
    const id = window.setInterval(() => fetchExchangeRate(false), 60000);
    const costCenterId = window.setInterval(() => fetchM88ManilaCostCenter(), 30000);
    let ch: any;
    if (supabase) {
      ch = supabase.channel('bm-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, () => { fetchDepartments(false); if (selectedDepartmentId) fetchBreakdown(selectedDepartmentId, false, false); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_categories' }, () => { if (selectedDepartmentId) fetchBreakdown(selectedDepartmentId, false, false); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cost_centers' }, () => { fetchM88ManilaCostCenter(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_requests' }, () => { fetchM88ManilaCostCenter(); })
        .subscribe();
    }
    return () => { window.clearInterval(id); window.clearInterval(costCenterId); if (ch && supabase) supabase.removeChannel(ch); };
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
    try {
      const res = await api.get('/api/departments');
      const depts = Array.isArray(res.data) ? res.data : [];
      if (!Array.isArray(res.data)) console.warn('fetchDepartments: unexpected response shape', res.data);
      setDepartments(depts);
      setBudgetInputs(prev => { const n = { ...prev }; depts.forEach((d: any) => { if (!(d.id in n)) n[d.id] = ''; }); return n; });
      const visible: any[] = Array.from(depts.filter((d: any) => !/^m88/i.test(d.name || '')).reduce((m: Map<string, any>, d: any) => { const k = `${String(d.name || '').trim().toLowerCase()}::${d.fiscal_year}`; const ex = m.get(k); m.set(k, !ex || toNumber(d.used_budget) > toNumber(ex.used_budget) ? d : ex); return m; }, new Map()).values());
      if (visible.length) {
        const latestFY = Math.max(...visible.map((d: any) => Number(d.fiscal_year || 0)), new Date().getFullYear());
        setSelectedFiscalYear(curr => curr || latestFY);
        setNewDept(curr => ({ ...curr, fiscal_year: curr.fiscal_year || latestFY }));
      }
      setLoading(false);
    } catch { if (showError) toast.error('Failed to load departments'); setLoading(false); }
  };

  const fetchBreakdown = async (deptId: string, showLoading = true, showToast = true) => {
    if (showLoading) setDetailLoading(true);
    setDetailError('');
    try {
      const res = await api.get(`/api/departments/${deptId}/budget-breakdown`);
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
    } catch { if (showToast) toast.error('Failed to refresh exchange rate'); }
  };

  const updateCategoryBudget = async (catId: string, budget: number) => {
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
      await api.put(`/api/budget/categories/${catId}`, { budget_amount: budget });
      toast.success('Category budget updated!');
      if (selectedDepartmentId) { await fetchBreakdown(selectedDepartmentId, false, false); await fetchDepartments(false); await fetchM88ManilaCostCenter(); }
    } catch (err: any) { toast.error(getErrorMessage(err, 'Failed to update category')); }
  };

  const addNewCategory = async () => {
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
      });
      toast.success('Category added!');
      setNewCategory({ category_code: '', category_name: '', budget_amount: '', parent_category_id: '' }); setShowAddCategory(false);
      if (selectedDepartmentId) { await fetchBreakdown(selectedDepartmentId, false, false); await fetchDepartments(false); }
    } catch (err: any) { toast.error(getErrorMessage(err, 'Failed to add category')); }
  };

  const deleteCategory = async (catId: string) => {
    if (!confirm('Delete this category?')) return;
    try {
      await api.delete(`/api/budget/categories/${catId}`);
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
    try {
      toast.loading(`Resetting to ${defaults.length} standard categories...`, { id: 'init-cats' });
      const existing = await api.get(`/api/budget/categories?department_id=${selectedDepartmentId}&fiscal_year=${selectedFiscalYear}`);
      if (existing.data?.length) await Promise.all(existing.data.map((c: any) => api.delete(`/api/budget/categories/${c.id}`)));
      await Promise.all(defaults.map(c => api.post('/api/budget/categories', { department_id: selectedDepartmentId, fiscal_year: selectedFiscalYear, ...c })));
      toast.success('Categories reset!', { id: 'init-cats' });
      await fetchBreakdown(selectedDepartmentId, false, false); await fetchDepartments(false);
    } catch (err: any) { toast.error(getErrorMessage(err, 'Failed to reset categories'), { id: 'init-cats' }); }
  };

  const createDepartment = async () => {
    try {
      await api.post('/api/departments', { name: newDept.name, fiscal_year: newDept.fiscal_year });
      toast.success('Department created!');
      setNewDept({ name: '', fiscal_year: selectedFiscalYear || availableFiscalYears[0] || new Date().getFullYear() });
      await fetchDepartments(false);
    } catch (err: any) { toast.error(getErrorMessage(err, 'Failed to create department')); }
  };

  const createNextFiscalYearDepts = async () => {
    const nextFY = (availableFiscalYears[0] || new Date().getFullYear()) + 1;
    const base = filteredDepts[0] || visibleDepartments[0];
    try {
      await api.post('/api/departments', { name: base?.name || 'Finance Department', annual_budget: toNumber(base?.annual_budget), fiscal_year: nextFY });
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
    try {
      const ep = pettyCashForm.action === 'replenish' ? '/api/petty-cash/replenish' : '/api/petty-cash/disburse';
      await api.post(ep, { department_id: selectedDepartmentId, amount, purpose: pettyCashForm.purpose });
      toast.success(pettyCashForm.action === 'replenish' ? 'Petty cash added!' : 'Petty cash deducted!');
      setPettyCashForm(p => ({ ...p, amount: '', purpose: '' }));
      await fetchDepartments(false); await fetchBreakdown(selectedDepartmentId, false, false);
    } catch (err: any) { toast.error(getErrorMessage(err, 'Failed to update petty cash')); }
  };

  const unlockCategory = async (catId: string) => {
    try {
      await api.patch(`/api/budget/categories/${catId}/unlock`, {});
      toast.success('Category unlocked');
      if (selectedDepartmentId) await fetchBreakdown(selectedDepartmentId, false, false);
    } catch (err: any) { toast.error(getErrorMessage(err, 'Failed to unlock category')); }
  };

  const lockAllCategories = async () => {
    if (!selectedDepartmentId || enrichedCategories.length === 0) return;
    if (!confirm(`Lock all ${enrichedCategories.length} categories?`)) return;
    try {
      toast.loading('Locking all categories…', { id: 'lockAll' });
      await Promise.all(
        enrichedCategories.map(cat =>
          api.patch(`/api/budget/categories/${cat.id}/lock`, {})
        )
      );
      toast.success('All categories locked', { id: 'lockAll' });
      if (selectedDepartmentId) await fetchBreakdown(selectedDepartmentId, false, false);
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to lock categories'), { id: 'lockAll' });
    }
  };

  const unlockAllCategories = async () => {
    if (!selectedDepartmentId || enrichedCategories.length === 0) return;
    if (!confirm(`Unlock all ${enrichedCategories.length} categories?`)) return;
    try {
      toast.loading('Unlocking all categories…', { id: 'unlockAll' });
      await Promise.all(
        enrichedCategories.map(cat =>
          api.patch(`/api/budget/categories/${cat.id}/unlock`, {})
        )
      );
      toast.success('All categories unlocked', { id: 'unlockAll' });
      if (selectedDepartmentId) await fetchBreakdown(selectedDepartmentId, false, false);
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to unlock categories'), { id: 'unlockAll' });
    }
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
        });
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
        });
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
    try {
      const res = await api.get(`/api/audit-logs/budget-revisions/${categoryId}`);
      setRevisionHistory((prev) => ({ ...prev, [categoryId]: res.data || [] }));
    } catch {
      toast.error('Failed to load revision history');
    }
  };

  const fetchM88ManilaCostCenter = async () => {
    try {
      console.log('Fetching M88 Manila cost center for fiscal year:', selectedFiscalYear);
      const res = await api.get('/api/budget/cost-centers', { params: { fiscal_year: selectedFiscalYear } });
      console.log('Cost centers response:', res.data);
      const m88 = res.data?.find((cc: any) => cc.name === 'M88 Manila');
      console.log('M88 Manila cost center found:', m88);
      setM88ManilaCostCenter(m88 || null);
    } catch (err) {
      console.error('Failed to fetch M88 Manila cost center:', err);
      // Silent fail - cost center might not exist yet
    }
  };

  const fetchAnalyticsData = async () => {
    setAnalyticsLoading(true);
    try {
      // Fetch all requests for the selected fiscal year and department
      const params: any = { fiscal_year: analyticsFiscalYear };
      if (analyticsDeptId) params.department_id = analyticsDeptId;
      const res = await api.get('/api/requests', { params });
      const requests = Array.isArray(res.data) ? res.data : [];

      // Fetch all requests for all fiscal years for expense trend chart
      const allFiscalYears = [2022, 2023, 2024, 2025, 2026];
      const allRequestsPromises = allFiscalYears.map(fy => {
        const fyParams: any = { fiscal_year: fy };
        if (analyticsDeptId) fyParams.department_id = analyticsDeptId;
        return api.get('/api/requests', { params: fyParams });
      });
      const allRequestsResponses = await Promise.all(allRequestsPromises);
      const allRequests = allRequestsResponses.flatMap(r => Array.isArray(r.data) ? r.data : []);

      // Process data for charts
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

      // Get department budget for the selected fiscal year
      const selectedDept = analyticsDeptId ? departments.find(d => d.id === analyticsDeptId) : (selectedDepartmentId ? departments.find(d => d.id === selectedDepartmentId) : null);
      const deptAnnualBudget = selectedDept ? toNumber(selectedDept.annual_budget) : 0;
      const monthlyBudget = deptAnnualBudget / 12;

      // Chart 1: Budget vs Expense by month (current FY)
      const budgetVsExpense = months.map((month, idx) => {
        const monthRequests = requests.filter((r: any) => {
          const d = new Date(r.submitted_at || r.created_at);
          return d.getMonth() === idx && d.getFullYear() === analyticsFiscalYear;
        });
        const expense = monthRequests
          .filter((r: any) => ['released', 'approved'].includes(r.status))
          .reduce((sum: number, r: any) => sum + toNumber(r.amount), 0);
        return { month, budget: monthlyBudget, expense };
      });

      // Chart 2: Expense trend by fiscal year (use all requests for all FYs)
      const fyGroups: Record<number, { expense: number; budget: number }> = {};
      allRequests.forEach((r: any) => {
        const fy = Number(r.fiscal_year || new Date(r.created_at).getFullYear());
        if (!fyGroups[fy]) fyGroups[fy] = { expense: 0, budget: 0 };
        if (['released', 'approved'].includes(r.status)) {
          fyGroups[fy].expense += toNumber(r.amount);
        }
      });

      // Populate budget for each fiscal year from departments data
      departments.forEach((d: any) => {
        const fy = Number(d.fiscal_year || 0);
        if (fy > 0 && fyGroups[fy]) {
          // If specific department is selected, use that department's budget
          if (analyticsDeptId && d.id === analyticsDeptId) {
            fyGroups[fy].budget = toNumber(d.annual_budget);
          } else if (!analyticsDeptId) {
            // If no specific department selected, sum all departments' budgets for that FY
            fyGroups[fy].budget += toNumber(d.annual_budget);
          }
        }
      });

      const expenseTrend = Object.entries(fyGroups)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([fy, data]) => ({
          fy: `FY${fy}`,
          expense: data.expense,
          utilPct: data.budget > 0 ? (data.expense / data.budget) * 100 : 0
        }));

      // Chart 3: Monthly comparison 2025 vs 2026
      const monthlyComparison = months.map((month, idx) => {
        const get = (yr: number) => requests
          .filter((r: any) => {
            const d = new Date(r.submitted_at || r.created_at);
            return d.getMonth() === idx && d.getFullYear() === yr && ['released', 'approved'].includes(r.status);
          })
          .reduce((sum: number, r: any) => sum + toNumber(r.amount), 0);
        return { month, '2025': get(2025), '2026': get(2026) };
      });

      // Chart 4: Top 5 expenses by amount
      const categoryTotals: Record<string, { name: string; amount: number }> = {};
      requests
        .filter((r: any) => ['released', 'approved'].includes(r.status))
        .forEach((r: any) => {
          const cat = r.category || r.main_category || 'Uncategorized';
          if (!categoryTotals[cat]) categoryTotals[cat] = { name: cat, amount: 0 };
          categoryTotals[cat].amount += toNumber(r.amount);
        });
      const top5ByAmount = Object.values(categoryTotals)
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5);

      // Chart 5: Top 5 by utilization % (use categories based on analytics selection)
      let filteredCategories: any[] = [];
      if (analyticsDeptId) {
        // If specific department selected for analytics, use that department's categories
        const analyticsDept = departments.find(d => d.id === analyticsDeptId);
        if (analyticsDept) {
          // Fetch categories for this department
          try {
            const res = await api.get(`/api/budget/categories?department_id=${analyticsDeptId}&fiscal_year=${analyticsFiscalYear}`);
            filteredCategories = Array.isArray(res.data) ? res.data : [];
          } catch { filteredCategories = []; }
        }
      } else if (selectedDepartmentId) {
        // If "All Departments" selected but a department is selected in the main view, use that department's categories
        try {
          const res = await api.get(`/api/budget/categories?department_id=${selectedDepartmentId}&fiscal_year=${analyticsFiscalYear}`);
          filteredCategories = Array.isArray(res.data) ? res.data : [];
        } catch { filteredCategories = []; }
      }

      const top5ByUtil = filteredCategories
        .filter((cat: any) => toNumber(cat.budget_amount) > 0)
        .map((cat: any) => ({
          name: cat.category_name,
          pct: (toNumber(cat.used_amount) / toNumber(cat.budget_amount)) * 100
        }))
        .sort((a: any, b: any) => b.pct - a.pct)
        .slice(0, 5);

      // Apply currency conversion to all analytics data based on displayCurrency
      const convertAmount = (amount: number) => {
        if (displayCurrency === 'PHP') return amount;
        if (displayCurrency === 'USD') return amount / fxRatePhp;
        if (displayCurrency === 'IDR') return amount / fxRateIdr;
        return amount;
      };

      const convertedBudgetVsExpense = budgetVsExpense.map(item => ({
        ...item,
        budget: convertAmount(item.budget),
        expense: convertAmount(item.expense)
      }));

      const convertedExpenseTrend = expenseTrend.map(item => ({
        ...item,
        expense: convertAmount(item.expense)
      }));

      const convertedMonthlyComparison = monthlyComparison.map(item => ({
        ...item,
        '2025': convertAmount(item['2025']),
        '2026': convertAmount(item['2026'])
      }));

      const convertedTop5ByAmount = top5ByAmount.map(item => ({
        ...item,
        amount: convertAmount(item.amount)
      }));

      setAnalyticsData({ 
        budgetVsExpense: convertedBudgetVsExpense, 
        expenseTrend: convertedExpenseTrend, 
        monthlyComparison: convertedMonthlyComparison, 
        top5ByAmount: convertedTop5ByAmount, 
        top5ByUtil 
      });
    } catch (err) {
      console.error('Failed to fetch analytics data:', err);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  useEffect(() => {
    setAnalyticsDeptId(selectedDepartmentId);
  }, [selectedDepartmentId]);

  useEffect(() => {
    fetchAnalyticsData();
  }, [analyticsFiscalYear, analyticsDeptId, selectedDepartmentId, displayCurrency]);

  const fetchSpendingBreakdown = async () => {
    setSpendingBreakdownLoading(true);
    try {
      const deptId = costCenterFilterDept !== 'all' ? costCenterFilterDept : selectedDepartmentId;
      if (!deptId) {
        setSpendingBreakdown([]);
        return;
      }

      const fiscalYear = selectedFiscalYear || new Date().getFullYear();
      const res = await api.get('/api/budget/categories', {
        params: { department_id: deptId, fiscal_year: fiscalYear }
      });

      const categories = Array.isArray(res.data) ? res.data : [];

      // Filter by selected category if not 'all'
      const filteredCategories = costCenterFilterCategory !== 'all'
        ? categories.filter((cat: any) => String(cat.category_code || '').trim() === costCenterFilterCategory)
        : categories;

      // Group categories into display and others
      const displayItems: any[] = [];
      let othersTotal = 0;
      let othersBudget = 0;

      filteredCategories.forEach((cat: any) => {
        const code = String(cat.category_code || '').trim();
        const used = toNumber(cat.used_amount || 0);
        const budget = toNumber(cat.budget_amount || 0);

        if (DISPLAY_CATEGORIES[code]) {
          displayItems.push({
            name: DISPLAY_CATEGORIES[code],
            code: code,
            used: used,
            budget: budget,
            utilization: budget > 0 ? (used / budget) * 100 : 0
          });
        } else if (OTHERS_CATEGORIES.has(code) || !DISPLAY_CATEGORIES[code]) {
          othersTotal += used;
          othersBudget += budget;
        }
      });

      // Add "Others" if there are any others
      if (othersTotal > 0 || othersBudget > 0) {
        displayItems.push({
          name: 'Others',
          code: 'Others',
          used: othersTotal,
          budget: othersBudget,
          utilization: othersBudget > 0 ? (othersTotal / othersBudget) * 100 : 0
        });
      }

      // Sort by used amount descending
      displayItems.sort((a, b) => b.used - a.used);

      setSpendingBreakdown(displayItems);
    } catch (err) {
      console.error('Failed to fetch spending breakdown:', err);
      setSpendingBreakdown([]);
    } finally {
      setSpendingBreakdownLoading(false);
    }
  };

  useEffect(() => {
    fetchSpendingBreakdown();
  }, [costCenterFilterDept, costCenterFilterCategory, selectedDepartmentId, selectedFiscalYear]);

  // Fetch categories for selected department in cost center filter
  useEffect(() => {
    const fetchCostCenterCategories = async () => {
      if (costCenterFilterDept === 'all') {
        setCostCenterCategories([]);
        return;
      }

      try {
        const fiscalYear = selectedFiscalYear || new Date().getFullYear();
        const res = await api.get('/api/budget/categories', {
          params: { department_id: costCenterFilterDept, fiscal_year: fiscalYear }
        });
        const categories = Array.isArray(res.data) ? res.data : [];
        setCostCenterCategories(categories);
      } catch (err) {
        console.error('Failed to fetch cost center categories:', err);
        setCostCenterCategories([]);
      }
    };

    fetchCostCenterCategories();
  }, [costCenterFilterDept, selectedFiscalYear]);

  // Auto-refresh spending breakdown every 15 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchSpendingBreakdown();
    }, 15000);
    return () => clearInterval(interval);
  }, [costCenterFilterDept, costCenterFilterCategory, selectedDepartmentId, selectedFiscalYear]);

  // Real-time subscription for budget categories changes
  useEffect(() => {
    if (!supabase) return;
    const subscription = supabase
      .channel('budget_categories_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_categories' }, () => {
        fetchSpendingBreakdown();
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [costCenterFilterDept, costCenterFilterCategory, selectedDepartmentId, selectedFiscalYear]);

  if (loading) return <PageSkeleton />;

  return (
    <div className="text-[var(--role-text)] page-transition">
      {/* Header with compact summary bar */}
      <div className="page-header">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="page-title">{isViewOnlyMatrix && !canEditMatrix ? 'Cost Center Dashboard (View Only)' : 'Cost Center Dashboard'}</h1>
              <p className="page-subtitle">
                {user?.role === 'supervisor'
                  ? 'Propose budgets and manage category locks for your department.'
                  : user?.role === 'vp' || user?.role === 'president'
                    ? 'View-only access to department budget proposals and approved matrices.'
                    : 'Org-level cost center overview, department budgets, category management, and fiscal year planning.'}
              </p>
            </div>
            {/* Currency toggle */}
            <button
              className="btn-secondary !rounded-full !px-4 !py-2 !text-sm shrink-0"
              onClick={() => setDisplayCurrency(c => c === 'PHP' ? 'USD' : c === 'USD' ? 'IDR' : 'PHP')}
            >
              {displayCurrency === 'PHP' ? 'Show in USD' : displayCurrency === 'USD' ? 'Show in IDR' : 'Show in PHP'}
            </button>
            {/* Travel Booking button */}
            <a
              href={TRAVEL_BOOKING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary !rounded-full !px-4 !py-2 !text-sm shrink-0 inline-flex items-center gap-2"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Travel Booking
            </a>
          </div>

          {/* M88 Manila cost center row — only for accounting/admin/supervisor */}
          {(user?.role === 'supervisor' || user?.role === 'accounting' || user?.role === 'admin') && m88ManilaCostCenter && (
            <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-surface)] p-5 shadow-sm">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <svg className="h-5 w-5 text-[var(--role-primary)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  <span className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[var(--role-text)]">M88 MANILA GENERAL BUDGET</span>
                </div>
                <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--role-text)]/40 font-semibold">MASTER COST CENTER</span>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--role-text)]/50 mb-1">Total Budget</p>
                  <p className="text-[20px] font-semibold text-[var(--role-text)]">{formatMoney(toNumber(m88ManilaCostCenter.total_budget), 'PHP')}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--role-text)]/50 mb-1">Used</p>
                  <p className="text-[20px] font-semibold text-[var(--role-text)]">{formatMoney(toNumber(m88ManilaCostCenter.used_amount), 'PHP')} <span className="text-xs text-[var(--role-text)]/50">(released)</span></p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--role-text)]/50 mb-1">Pending</p>
                  <p className="text-[20px] font-semibold text-amber-600">{formatMoney(toNumber(m88ManilaCostCenter.pending_amount || 0), 'PHP')} <span className="text-xs text-amber-600/70">(amber)</span></p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--role-text)]/50 mb-1">Available</p>
                  <p className="text-[20px] font-semibold" style={{
                    color: (() => {
                      const available = toNumber(m88ManilaCostCenter.available_amount || 0);
                      const total = toNumber(m88ManilaCostCenter.total_budget);
                      const pct = total > 0 ? (available / total) * 100 : 0;
                      if (pct >= 50) return '#16a34a';
                      if (pct >= 20) return '#f59e0b';
                      return '#ef4444';
                    })()
                  }}>{formatMoney(toNumber(m88ManilaCostCenter.available_amount || 0), 'PHP')} <span className="text-xs opacity-70">(color-coded)</span></p>
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mb-4 flex overflow-hidden">
                <div className="h-2 bg-emerald-500 rounded-l-full" style={{ width: `${Math.min((toNumber(m88ManilaCostCenter.used_amount) / toNumber(m88ManilaCostCenter.total_budget)) * 100, 100)}%` }} />
                <div className="h-2 bg-amber-500" style={{ width: `${Math.min((toNumber(m88ManilaCostCenter.pending_amount || 0) / toNumber(m88ManilaCostCenter.total_budget)) * 100, 100)}%` }} />
                <div className="h-2 bg-gray-300 rounded-r-full" style={{ width: `${Math.max(0, 100 - ((toNumber(m88ManilaCostCenter.used_amount) + toNumber(m88ManilaCostCenter.pending_amount || 0)) / toNumber(m88ManilaCostCenter.total_budget)) * 100)}%` }} />
              </div>
              <div className="flex justify-between text-[10px] text-[var(--role-text)]/50 mb-4">
                <span className="text-emerald-600 font-medium">Used</span>
                <span className="text-amber-600 font-medium">Pending</span>
                <span className="text-gray-600 font-medium">Available</span>
              </div>
              <div className="flex gap-6 text-xs text-[var(--role-text)]/70">
                <div>
                  <span className="font-semibold text-[var(--role-text)]">Active Requests:</span> {toNumber(m88ManilaCostCenter.pending_count || 0)} pending approval
                </div>
                <div>
                  <span className="font-semibold text-[var(--role-text)]">Departments using:</span> {toNumber(m88ManilaCostCenter.departments_count || 0)}
                </div>
              </div>

              {/* Spending by Category Chart - iPhone Storage Style */}
              <div className="mt-6 pt-6 border-t border-[var(--role-border)]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-[var(--role-text)]">Spending by Category</h3>
                  {!spendingBreakdownLoading && spendingBreakdown.length > 0 && (() => {
                    const totalUsed = spendingBreakdown.reduce((sum, item) => sum + (item.used || 0), 0);
                    const totalBudget = toNumber(m88ManilaCostCenter?.total_budget || 0);
                    const utilization = totalBudget > 0 ? (totalUsed / totalBudget) * 100 : 0;
                    return (
                      <span className="text-xs text-[var(--role-text)]/70">
                        {formatMoney(totalUsed)} of {formatMoney(totalBudget)} used ({utilization.toFixed(1)}%)
                      </span>
                    );
                  })()}
                </div>
                {spendingBreakdownLoading ? (
                  <div className="py-8 text-center text-[var(--role-text)]/60 text-xs">Loading spending breakdown…</div>
                ) : spendingBreakdown.length > 0 ? (() => {
                  const totalBudget = toNumber(m88ManilaCostCenter?.total_budget || 0);
                  const totalUsed = spendingBreakdown.reduce((sum, item) => sum + (item.used || 0), 0);
                  const available = totalBudget - totalUsed;

                  return (
                    <div>
                      {/* Stacked Bar */}
                      <div className="relative h-6 rounded-full overflow-hidden bg-gray-200 flex">
                        {spendingBreakdown.map((item) => {
                          const width = totalBudget > 0 ? (item.used / totalBudget) * 100 : 0;
                          if (width < 0.5) return null; // Skip very small segments
                          const color = SEGMENT_COLORS[item.code] || SEGMENT_COLORS['Others'];
                          return (
                            <div
                              key={item.code}
                              className="h-full transition-all hover:opacity-90"
                              style={{
                                width: `${width}%`,
                                backgroundColor: color,
                                position: 'relative'
                              }}
                              title={`${item.name}: ₱${formatMoney(item.used)} (${((item.used / totalBudget) * 100).toFixed(1)}% of total)`}
                            />
                          );
                        })}
                        {/* Available segment */}
                        {available > 0 && (
                          <div
                            className="h-full"
                            style={{
                              width: `${(available / totalBudget) * 100}%`,
                              backgroundColor: SEGMENT_COLORS['Available']
                            }}
                            title={`Available: ₱${formatMoney(available)}`}
                          />
                        )}
                      </div>

                      {/* Legend */}
                      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                        {spendingBreakdown.filter(item => item.used > 0).map((item) => {
                          const color = SEGMENT_COLORS[item.code] || SEGMENT_COLORS['Others'];
                          return (
                            <div key={item.code} className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: color }}
                              />
                              <span className="text-[var(--role-text)]/80">{item.name}</span>
                              <span className="ml-auto font-medium text-[var(--role-text)]">{formatMoney(item.used)}</span>
                            </div>
                          );
                        })}
                        {available > 0 && (
                          <div className="flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: SEGMENT_COLORS['Available'] }}
                            />
                            <span className="text-[var(--role-text)]/80">Available</span>
                            <span className="ml-auto font-medium text-[var(--role-text)]">{formatMoney(available)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })() : (
                  <div className="py-8 text-center text-[var(--role-text)]/60 text-xs">No spending data available</div>
                )}
              </div>
            </div>
          )}
          {/* Refresh on right */}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-[var(--role-text)]/40">Synced: {formatDateTime(selectedBreakdown?.generated_at)}</span>
            <button
              className="btn-secondary !rounded-full !px-3 !py-1.5 text-xs"
              onClick={() => { fetchExchangeRate(true); fetchAnalyticsData(); if (selectedDepartmentId) fetchBreakdown(selectedDepartmentId, true, true); }}
            >↻ Refresh</button>
          </div>
        </div>
      </div>

      {/* Analytics Section */}
      <div className="rounded-[28px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5 mb-8">
        <div className="flex items-center justify-between mb-4 pb-4 border-b border-[var(--role-border)]">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 text-[var(--role-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <div>
              <h3 className="text-[18px] font-bold text-[var(--role-text)]">Analytics</h3>
              <p className="text-[12px] text-[var(--role-text)]/50 mt-0.5">Budget insights and expense trends</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--role-text)]/60">FY:</label>
              <select
                value={analyticsFiscalYear}
                onChange={(e) => setAnalyticsFiscalYear(Number(e.target.value))}
                className="px-3 py-1.5 text-xs rounded-full border border-[var(--role-border)] bg-[var(--role-surface)]"
              >
                {availableFiscalYears.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--role-text)]/60">Dept:</label>
              <select
                value={analyticsDept}
                onChange={(e) => setAnalyticsDept(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-full border border-[var(--role-border)] bg-[var(--role-surface)]"
              >
                <option value="all">All Departments</option>
                {visibleDepartments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {(costCenterFilterDept !== 'all' || costCenterFilterCategory !== 'all') && (
          <div className="mb-4 flex items-center justify-between rounded-lg bg-[var(--role-surface)] px-3 py-2">
            <span className="text-xs text-[var(--role-text)]/60">
              Showing: {costCenterFilterDept !== 'all' ? departments.find(d => d.id === costCenterFilterDept)?.name : 'All Departments'} · {costCenterFilterCategory !== 'all' ? costCenterFilterCategory : 'All Categories'}
            </span>
            <button
              onClick={() => { setCostCenterFilterDept('all'); setCostCenterFilterCategory('all'); }}
              className="text-xs text-[var(--role-primary)] hover:text-[var(--role-secondary)]"
            >
              ×
            </button>
          </div>
        )}

        {analyticsLoading ? (
          <div className="py-8 text-center text-[var(--role-text)]/60">Loading analytics data…</div>
        ) : analyticsData ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Chart 1: Budget vs Expense by Month */}
            <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] p-5 md:col-span-2" style={{ borderTop: '3px solid #2D6A4F' }}>
              <div className="mb-4 pb-3 border-b border-[var(--role-border)]">
                <h4 className="text-[14px] font-semibold text-[var(--role-text)]">Budget vs Expense — FY{analyticsFiscalYear}</h4>
                <p className="text-[11px] text-[var(--role-text)]/50 mt-1">Monthly budget allocation vs actual spend</p>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={analyticsData.budgetVsExpense}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.5} vertical={false} />
                  <XAxis dataKey="month" stroke="var(--role-text)" fontSize={11} />
                  <YAxis stroke="var(--role-text)" fontSize={11} tickFormatter={formatChartValue} />
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', border: '0.5px solid #e5e7eb', fontSize: '12px' }}
                    formatter={(value: any) => formatCurrency(Number(value || 0))}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                  <Bar dataKey="budget" fill={BUDGET_COLOR} name="Budget" radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="budget" position="top" fontSize={11} fill="var(--role-text)" formatter={(v: any) => formatCurrency(Number(v || 0))} />
                  </Bar>
                  <Bar dataKey="expense" fill={EXPENSE_COLOR} name="Expense" radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="expense" position="top" fontSize={11} fill="var(--role-text)" formatter={(v: any) => formatCurrency(Number(v || 0))} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Chart 2: Expense Trend by Fiscal Year */}
            <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] p-5" style={{ borderTop: '3px solid #E97316' }}>
              <div className="mb-4 pb-3 border-b border-[var(--role-border)]">
                <h4 className="text-[14px] font-semibold text-[var(--role-text)]">Expense Trend FY2022–FY2026</h4>
                <p className="text-[11px] text-[var(--role-text)]/50 mt-1">Year-over-year total expense with % of budget</p>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={analyticsData.expenseTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.5} vertical={false} />
                  <XAxis dataKey="fy" stroke="var(--role-text)" fontSize={11} />
                  <YAxis yAxisId="left" stroke="var(--role-text)" fontSize={11} tickFormatter={formatChartValue} />
                  <YAxis yAxisId="right" orientation="right" stroke="var(--role-text)" fontSize={11} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', border: '0.5px solid #e5e7eb', fontSize: '12px' }}
                    formatter={(value: any, name: any) => name === 'utilPct' ? `${Number(value || 0).toFixed(1)}%` : formatCurrency(Number(value || 0))}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                  <Bar yAxisId="left" dataKey="expense" fill={EXPENSE_COLOR} name="Expense" radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="expense" position="top" fontSize={11} fill="var(--role-text)" formatter={(v: any) => formatCurrency(Number(v || 0))} />
                  </Bar>
                  <Line yAxisId="right" dataKey="utilPct" stroke={BUDGET_COLOR} strokeWidth={3} name="% of Budget" dot={{ fill: BUDGET_COLOR, r: 5 }}>
                    <LabelList dataKey="utilPct" position="top" fontSize={11} fill={BUDGET_COLOR} formatter={(v: any) => `${Number(v || 0).toFixed(1)}%`} />
                  </Line>
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Chart 3: Monthly Comparison 2025 vs 2026 */}
            <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] p-5" style={{ borderTop: '3px solid #2D6A4F' }}>
              <div className="mb-4 pb-3 border-b border-[var(--role-border)]">
                <h4 className="text-[14px] font-semibold text-[var(--role-text)]">Monthly Expenses — 2025 vs 2026</h4>
                <p className="text-[11px] text-[var(--role-text)]/50 mt-1">Month-by-month comparison across fiscal years</p>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={analyticsData.monthlyComparison}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.5} vertical={false} />
                  <XAxis dataKey="month" stroke="var(--role-text)" fontSize={11} />
                  <YAxis stroke="var(--role-text)" fontSize={11} tickFormatter={formatChartValue} />
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', border: '0.5px solid #e5e7eb', fontSize: '12px' }}
                    formatter={(value: any) => formatCurrency(Number(value || 0))}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                  <Bar dataKey="2025" fill={BUDGET_COLOR_LIGHT} name="2025" radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="2025" position="top" fontSize={11} fill="var(--role-text)" formatter={(v: any) => formatCurrency(Number(v || 0))} />
                  </Bar>
                  <Bar dataKey="2026" fill={BUDGET_COLOR} name="2026" radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="2026" position="top" fontSize={11} fill="var(--role-text)" formatter={(v: any) => formatCurrency(Number(v || 0))} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Chart 4: Top 5 Expenses by Amount */}
            <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] p-5 md:col-span-2" style={{ borderTop: '3px solid #E97316' }}>
              <div className="mb-4 pb-3 border-b border-[var(--role-border)]">
                <h4 className="text-[14px] font-semibold text-[var(--role-text)]">Top 5 Expenses by Amount</h4>
                <p className="text-[11px] text-[var(--role-text)]/50 mt-1">Highest spending categories this fiscal year</p>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={analyticsData.top5ByAmount} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.5} vertical={false} />
                  <XAxis type="number" stroke="var(--role-text)" fontSize={11} tickFormatter={formatChartValue} />
                  <YAxis dataKey="name" type="category" width={100} stroke="var(--role-text)" fontSize={11} />
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', border: '0.5px solid #e5e7eb', fontSize: '12px' }}
                    formatter={(value: any) => formatCurrency(Number(value || 0))}
                  />
                  <Bar dataKey="amount" fill={EXPENSE_COLOR} radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="amount" position="right" fontSize={11} fill="var(--role-text)" formatter={(v: any) => formatCurrency(Number(v || 0))} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Chart 5: Top 5 by Budget Utilization % */}
            <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] p-5 md:col-span-2" style={{ borderTop: '3px solid #2D6A4F' }}>
              <div className="mb-4 pb-3 border-b border-[var(--role-border)]">
                <h4 className="text-[14px] font-semibold text-[var(--role-text)]">Top 5 by Budget Utilization %</h4>
                <p className="text-[11px] text-[var(--role-text)]/50 mt-1">Categories with highest budget consumption</p>
              </div>
              {analyticsData.top5ByUtil && analyticsData.top5ByUtil.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={analyticsData.top5ByUtil}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.5} vertical={false} />
                    <XAxis dataKey="name" stroke="var(--role-text)" fontSize={11} />
                    <YAxis stroke="var(--role-text)" fontSize={11} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                    <Tooltip
                      contentStyle={{ borderRadius: '8px', border: '0.5px solid #e5e7eb', fontSize: '12px' }}
                      formatter={(value: any) => `${Number(value || 0).toFixed(1)}%`}
                    />
                    <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
                      {analyticsData.top5ByUtil.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={entry.pct < 50 ? '#16a34a' : entry.pct < 80 ? '#f59e0b' : '#ef4444'} />
                      ))}
                      <LabelList dataKey="pct" position="top" fontSize={11} fill="var(--role-text)" formatter={(v: any) => `${Number(v || 0).toFixed(1)}%`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="py-8 text-center text-[var(--role-text)]/60 text-sm">No budget utilization data available</div>
              )}
            </div>
          </div>
        ) : (
          <div className="py-12 text-center text-[var(--role-text)]/60">
            <svg className="h-12 w-12 mx-auto mb-3 text-[var(--role-text)]/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p className="text-sm">No data available for the selected filters</p>
          </div>
        )}
      </div>

      {/* Main Layout: dept list left, detail right */}
      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
        {/* Left: Org Tree Navigation */}
        <div className="panel xl:sticky xl:top-24 xl:self-start">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-base font-bold text-[var(--role-text)]">Cost Centers</h2>
            {(costCenterFilterDept !== 'all' || costCenterFilterCategory !== 'all') && (
              <span className="h-2 w-2 rounded-full bg-amber-500" title="Filters active — some departments or categories may be hidden" />
            )}
          </div>

          {/* FY toggle */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {availableFiscalYears.map(y => (
              <button
                key={y}
                onClick={() => setSelectedFiscalYear(y)}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] transition ${selectedFiscalYear === y ? 'border-[var(--role-secondary)] bg-[var(--role-secondary)] text-white' : 'border-[var(--role-border)] bg-[var(--role-surface)] text-[var(--role-text)]/60 hover:border-[var(--role-secondary)]/50'}`}
              >
                FY {y}
              </button>
            ))}
          </div>

          {/* Root node: M88 Manila */}
          <div className="mb-2">
            <div
              className="flex items-center gap-2 rounded-2xl border border-[var(--role-primary)]/30 bg-[var(--role-primary)]/8 px-3 py-2.5 cursor-pointer"
              onClick={() => { setSelectedDepartmentId(''); setSelectedNodeId('root'); }}
            >
              <svg className="h-4 w-4 text-[var(--role-primary)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-[var(--role-text)] truncate">M88 Manila</p>
                <p className="text-[10px] text-[var(--role-text)]/50 uppercase tracking-[0.14em]">Master Cost Center</p>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="mb-3 space-y-2">
            <select
              value={costCenterFilterDept}
              onChange={(e) => {
                setCostCenterFilterDept(e.target.value);
                setCostCenterFilterCategory('all');
              }}
              className="w-full px-2 py-1.5 text-xs rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-[var(--role-text)]"
            >
              <option value="all">All Departments</option>
              {departments.map(dept => (
                <option key={dept.id} value={dept.id}>{dept.name}</option>
              ))}
            </select>
            <select
              value={costCenterFilterCategory}
              onChange={(e) => setCostCenterFilterCategory(e.target.value)}
              className="w-full px-2 py-1.5 text-xs rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-[var(--role-text)]"
              disabled={costCenterFilterDept === 'all'}
            >
              <option value="all">All Categories</option>
              {costCenterCategories.map((cat: any) => (
                <option key={cat.id} value={cat.category_code}>{cat.category_name}</option>
              ))}
            </select>
            {(costCenterFilterDept !== 'all' || costCenterFilterCategory !== 'all') && (
              <button
                onClick={() => { setCostCenterFilterDept('all'); setCostCenterFilterCategory('all'); }}
                className="w-full text-xs text-[var(--role-primary)] hover:text-[var(--role-secondary)] text-left"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Department tree */}
          <div className="space-y-0.5 max-h-[600px] overflow-y-auto pl-3 border-l-2 border-[var(--role-border)]">
            {filteredDepts.map(dept => {
              const annual = toNumber(dept.annual_budget), used = toNumber(dept.used_budget);
              const remaining = toNumber(dept.remaining_budget || (annual - used));
              const utilization = annual > 0 ? (used / annual) * 100 : 0;
              const health = getBudgetHealth(dept);
              const isSelected = dept.id === selectedDepartmentId;
              const isExpanded = expandedDepts.has(dept.id);
              const deptCategories = dept.id === selectedDepartmentId && selectedBreakdown?.categories
                ? enrichCategories(selectedBreakdown.categories)
                : [];

              return (
                <div key={dept.id}>
                  {/* Department node */}
                  <div
                    className={`group flex items-start gap-2 rounded-xl px-2.5 py-2 cursor-pointer transition ${isSelected ? 'bg-[var(--role-accent)] border border-[var(--role-secondary)]/30' : 'hover:bg-[var(--role-accent)]/60 border border-transparent'}`}
                    onClick={() => {
                      setSelectedDepartmentId(dept.id);
                      setSelectedNodeId(dept.id);
                      setExpandedDepts(prev => {
                        const next = new Set(prev);
                        if (next.has(dept.id)) next.delete(dept.id); else next.add(dept.id);
                        return next;
                      });
                    }}
                  >
                    {/* Expand/collapse chevron */}
                    <svg
                      className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--role-text)]/30 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-xs font-semibold text-[var(--role-text)] truncate">{dept.name}</p>
                        <span className="rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--role-text)]/50 shrink-0">{getDeptCode(dept.name)}</span>
                      </div>
                      {/* Mini utilization bar */}
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--role-border)]">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(utilization, 100)}%`, ...getUtilizationBarStyle(utilization) }} />
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="text-[10px] text-[var(--role-text)]/50">{displayMoney(remaining)} rem.</span>
                        <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${health === 'critical' ? 'border-red-500/20 bg-red-500/10 text-red-600' : health === 'high' ? 'border-orange-500/20 bg-orange-500/10 text-orange-600' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700'}`}>
                          {health === 'critical' ? 'HIGH' : health === 'high' ? 'MED' : 'LOW'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Category children — shown when dept is expanded and selected */}
                  {isExpanded && isSelected && deptCategories.length > 0 && (
                    <div className="relative ml-5 mt-0.5 space-y-0.5 pb-1">
                      {/* Vertical connector line from parent */}
                      <div className="absolute left-0 top-0 bottom-0 w-px bg-[var(--role-border)]" />
                      {deptCategories
                        .filter(c => !c.parent_category_id)
                        .filter(c => {
                          // Filter by cost center category selection
                          if (costCenterFilterCategory !== 'all') {
                            return c.category_code === costCenterFilterCategory;
                          }
                          return true;
                        })
                        .sort((a, b) => String(a.category_name).localeCompare(String(b.category_name)))
                        .map(cat => (
                          <div
                            key={cat.id}
                            className={`relative flex items-center gap-1.5 rounded-lg pl-4 pr-2 py-1.5 cursor-pointer transition text-xs ${selectedNodeId === cat.id ? 'bg-[var(--role-primary)]/10 text-[var(--role-primary)]' : 'text-[var(--role-text)]/70 hover:bg-[var(--role-accent)]'}`}
                            onClick={(e) => { e.stopPropagation(); setSelectedNodeId(cat.id); }}
                          >
                            {/* Horizontal tick connector */}
                            <div className="absolute left-0 top-1/2 w-3 h-px bg-[var(--role-border)]" />
                            {cat.is_locked && (
                              <svg className="h-3 w-3 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                              </svg>
                            )}
                            <span className="truncate">{cat.category_name}</span>
                            <span className="ml-auto shrink-0 text-[10px] text-[var(--role-text)]/40 font-mono">{cat.category_code}</span>
                          </div>
                        ))
                      }
                    </div>
                  )}
                </div>
              );
            })}
            {filteredDepts.length === 0 && (
              <p className="py-6 text-center text-xs text-[var(--role-text)]/50">No departments for this fiscal year.</p>
            )}
          </div>
        </div>

        {/* Budget Workspace */}
        <div className="panel overflow-hidden">
          {/* Slim department header — name + code + compact utilization line */}
          <div className="flex items-center justify-between gap-3 pb-4 border-b border-[var(--role-border)]">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                {getDeptIcon(selectedDepartment?.name || breakdownDept?.name)}
                <h2 className="text-base font-bold text-[var(--role-text)]">
                  {selectedDepartment?.name || breakdownDept?.name || 'Select a department'}
                </h2>
                {(selectedDepartment || breakdownDept) && (
                  <span className="rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--role-text)]/60">
                    {getDeptCode(selectedDepartment?.name || breakdownDept?.name)}
                  </span>
                )}
              </div>
              {breakdownTotals && breakdownDept && (
                <p className="mt-0.5 text-xs text-[var(--role-text)]/50">
                  {displayMoney(breakdownTotals.used_budget)} utilized of {displayMoney(breakdownTotals.annual_budget)} total
                  {' '}(<span style={getUtilizationStyle(breakdownDept.utilization_percentage)}>{formatPercent(breakdownDept.utilization_percentage)}</span>)
                  {breakdownDept.remaining_budget != null && (
                    <> · <span className="text-emerald-600 font-medium">{displayMoney(breakdownDept.remaining_budget)} remaining</span></>
                  )}
                </p>
              )}
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
            </div>
          ) : (
            <div className="mt-4 space-y-6">
              {/* Unlock Budget Matrix — accounting/admin/supervisor can manage locks */}
              {canEditMatrix && lockedCategories.length > 0 && (
                <div className="rounded-[24px] border border-amber-400/50 bg-amber-50/60 overflow-hidden">
                  {/* Accordion header — always visible */}
                  <button
                    type="button"
                    onClick={() => setShowAllLockedCategories(prev => !prev)}
                    className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-amber-100/40 transition"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 border border-amber-400/30">
                      <svg className="h-4 w-4 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </div>
                    <span className="font-semibold text-amber-900 text-sm">
                      {lockedCategories.length} Locked Categor{lockedCategories.length !== 1 ? 'ies' : 'y'}
                    </span>
                    <span className="rounded-full bg-amber-500/20 border border-amber-400/30 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                      {lockedCategories.length}
                    </span>
                    <div className="ml-auto flex items-center gap-3" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={async () => {
                          let ok = 0;
                          await Promise.all(
                            lockedCategories.map(async (cat) => {
                              try {
                                await api.patch(`/api/budget/categories/${cat.id}/unlock`, {});
                                ok++;
                              } catch { /* skip */ }
                            })
                          );
                          if (ok > 0) toast.success(`Unlocked ${ok} categor${ok !== 1 ? 'ies' : 'y'}`);
                          if (selectedDepartmentId) await fetchBreakdown(selectedDepartmentId, false, false);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-600 transition"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                        </svg>
                        Unlock All
                      </button>
                    </div>
                    <svg
                      className={`h-4 w-4 text-amber-700/50 transition-transform ${showAllLockedCategories ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Accordion body — collapsed by default */}
                  {showAllLockedCategories && (
                    <div className="border-t border-amber-300/40 px-5 py-4">
                      <p className="mb-3 text-xs text-amber-700/80">
                        The budget matrix is locked after approval. Unlock categories to allow new proposals, edits, and mid-period revisions.
                      </p>
                      <div className="space-y-1.5 max-h-56 overflow-y-auto">
                        {lockedCategories.map((cat) => (
                          <div key={cat.id} className="flex items-center justify-between gap-3 rounded-xl border border-amber-300/50 bg-white/80 px-3 py-2">
                            <div className="min-w-0 flex items-center gap-2">
                              <span className="font-mono text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded shrink-0">{cat.category_code}</span>
                              <p className="text-xs font-medium text-[var(--role-text)] truncate">{cat.category_name}</p>
                            </div>
                            <button
                              onClick={() => unlockCategory(cat.id)}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 hover:bg-amber-200 transition"
                              aria-label={`Unlock ${cat.category_name}`}
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.1fr)_340px]">
                <div className="space-y-6">
                  {/* Category Management */}
                  <div className="rounded-[28px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-semibold text-[var(--role-text)]">Category Budgets</h3>
                        <p className="text-xs text-[var(--role-text)]/50 mt-0.5">FY{selectedDepartment?.fiscal_year} · {visibleEnrichedCategories.length || 0} categories · {displayMoney(editableBudgetValue)} budget</p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {canEditMatrix && enrichedCategories.length > 0 && (
                          <>
                            <button onClick={lockAllCategories} className="text-xs bg-amber-500 text-white px-3 py-1.5 rounded-lg hover:bg-amber-600 transition flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm6-10V7a3 3 0 00-6 0v4a3 3 0 006 0z" /></svg>
                              Lock All
                            </button>
                            <button onClick={unlockAllCategories} className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg hover:bg-blue-600 transition flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                              Unlock All
                            </button>
                          </>
                        )}
                        <button onClick={() => setShowAddCategory(v => !v)} disabled={!canEditMatrix} className="text-xs bg-emerald-500 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-600 transition flex items-center gap-1 disabled:opacity-50">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                          {showAddCategory ? 'Cancel' : 'Add'}
                        </button>
                      </div>
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
                          Showing {orderedCategories.length} of {visibleEnrichedCategories.length} categories
                        </p>
                      )}
                    </div>

                    {/* Budget / Committed / Pending Approval / Available summary */}
                    <div className="mb-4 flex gap-1 text-xs">
                      {(() => {
                        // If category is selected in cost center filter, show category-specific budget info
                        if (costCenterFilterCategory !== 'all' && costCenterFilterDept !== 'all') {
                          const selectedCategory = enrichedCategories.find(c => c.category_code === costCenterFilterCategory);
                          if (selectedCategory) {
                            const budget = toNumber(selectedCategory.budget_amount);
                            const used = toNumber(selectedCategory.used_amount);
                            const pending = toNumber(selectedCategory.committed_amount || 0);
                            const available = budget - used - pending;
                            return [
                              { label: 'Budget', val: budget, cls: 'bg-emerald-50 border-emerald-100 text-emerald-700' },
                              { label: 'Used', val: used, cls: 'bg-blue-50 border-blue-100 text-blue-700' },
                              { label: 'Pending', val: pending, cls: 'bg-amber-50 border-amber-100 text-amber-700' },
                              { label: 'Available', val: available, cls: 'bg-gray-50 border-gray-100 text-gray-700' }
                            ];
                          }
                        }
                        // Default department-level summary
                        return [
                          { label: 'Budget', val: editableBudgetValue, cls: 'bg-emerald-50 border-emerald-100 text-emerald-700' },
                          { label: 'Committed', val: enrichedCategories.reduce((sum, cat) => sum + toNumber(cat.committed_amount || 0), 0), cls: 'bg-blue-50 border-blue-100 text-blue-700' },
                          { label: 'Pending', val: selectedBreakdown?.department?.pending_budget || 0, cls: 'bg-amber-50 border-amber-100 text-amber-700' },
                          { label: 'Available', val: selectedBreakdown?.department?.available_budget || 0, cls: 'bg-gray-50 border-gray-100 text-gray-700' }
                        ];
                      })().map(s => (
                        <div key={s.label} className={`flex-1 p-2 rounded-lg border text-center ${s.cls}`}>
                          <span className="block text-[10px] uppercase font-semibold">{s.label}</span>
                          <span className="font-bold">{displayMoney(s.val)}</span>
                        </div>
                      ))}
                    </div>

                    {selectedBreakdown?.categories?.length > 0 && (
                      <div className="mb-3 flex gap-2">
                        <button onClick={async () => { if (!confirm('Delete ALL categories?')) return; try { toast.loading('Clearing…', { id: 'clr' }); await Promise.all(selectedBreakdown.categories.map((c: any) => api.delete(`/api/budget/categories/${c.id}`))); toast.success('Cleared!', { id: 'clr' }); await fetchBreakdown(selectedDepartmentId, false, false); await fetchDepartments(false); } catch { toast.error('Failed', { id: 'clr' }); } }} className="text-xs bg-red-100 text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-200 transition">🗑 Clear All</button>
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
                        {/* Show inactive toggle */}
                        <div className="mb-2">
                          <label className="flex items-center gap-2 text-xs text-[var(--role-text)]/60 cursor-pointer select-none">
                            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="rounded" />
                            Show inactive categories
                          </label>
                        </div>
                        <div className="space-y-1 max-h-[600px] overflow-y-auto">
                          {paginatedCategories.map(({ cat, depth }) => {
                              const budget = toNumber(cat.budget_amount), used = toNumber(cat.used_amount), committed = toNumber(cat.committed_amount);
                              const totalConsumed = used + committed;
                              const rem = Math.max(0, budget - totalConsumed);
                              const pct = budget > 0 ? (totalConsumed / budget) * 100 : 0;
                              const utilizationWarning = user?.role === 'supervisor' && pct >= 80;
                              const isInactive = used === 0 && committed === 0 && toNumber(cat.budget_amount) === 0;

                              // Skip inactive if toggle is off
                              if (!showInactive && isInactive) return null;
                              
                              // Calculate sub-category total for parent categories
                              const children = enrichedCategories.filter(c => c.parent_category_id === cat.id);
                              const childrenTotal = children.reduce((sum, child) => sum + toNumber(child.budget_amount), 0);
                              const hasChildren = children.length > 0;
                              const childrenWarning = hasChildren && childrenTotal > budget;

                              const isExpanded = expandedCategoryIds.has(cat.id);
                              
                              return (
                                <div
                                  key={cat.id}
                                  className={`rounded-xl border ${utilizationWarning ? 'border-amber-400 bg-amber-50/40' : ''} ${childrenWarning ? 'border-red-400 bg-red-50/40' : 'border-[var(--role-border)] bg-[var(--role-surface)]'} ${isInactive ? 'opacity-60' : ''}`}
                                  style={{ marginLeft: `${depth * 16}px` }}
                                >
                                  {/* Row header — always visible, click to toggle */}
                                  <div
                                    className="flex items-center gap-2 p-3 cursor-pointer"
                                    onClick={() => setExpandedCategoryIds(prev => {
                                      const next = new Set(prev);
                                      if (next.has(cat.id)) next.delete(cat.id); else next.add(cat.id);
                                      return next;
                                    })}
                                  >
                                    <span className="font-mono text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded shrink-0">{cat.category_code}</span>
                                    {cat.is_locked && (
                                      <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded shrink-0">LOCKED</span>
                                    )}
                                    <span className="flex-1 text-sm font-medium truncate text-[var(--role-text)]">
                                      {depth > 0 ? '↳ ' : ''}{cat.category_name}
                                    </span>
                                    {isInactive && (
                                      <span className="text-[10px] text-[var(--role-text)]/40 border border-[var(--role-border)] rounded-full px-1.5 py-0.5 shrink-0">No activity</span>
                                    )}
                                    {/* Remaining pill */}
                                    <span className="text-xs text-emerald-600 font-medium shrink-0">{displayMoney(rem)}</span>
                                    {/* Overflow menu — always visible */}
                                    {canEditMatrix && (
                                      <div className="relative shrink-0" onClick={e => e.stopPropagation()}>
                                        <button
                                          className="p-1 rounded hover:bg-[var(--role-accent)] text-[var(--role-text)]/40 hover:text-[var(--role-text)]/70 transition"
                                          onClick={() => setOpenOverflowId(openOverflowId === cat.id ? null : cat.id)}
                                        >
                                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                            <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
                                          </svg>
                                        </button>
                                        {openOverflowId === cat.id && (
                                          <div className="absolute right-0 top-7 z-20 min-w-[120px] rounded-xl border border-[var(--role-border)] bg-[var(--bms-bg-2)] shadow-lg p-1">
                                            {cat.is_locked ? (
                                              <button onClick={() => { unlockCategory(cat.id); setOpenOverflowId(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-amber-600 hover:bg-amber-50 transition">
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" /></svg>
                                                Unlock
                                              </button>
                                            ) : (
                                              <button onClick={() => { deleteCategory(cat.id); setOpenOverflowId(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 transition">
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                Delete
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    {/* Chevron */}
                                    <svg className={`h-3.5 w-3.5 shrink-0 text-[var(--role-text)]/30 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                  </div>

                                  {/* Expanded body */}
                                  {isExpanded && (
                                    <div className="px-3 pb-3 space-y-2 border-t border-[var(--role-border)]">
                                      {/* Utilization bar + stats */}
                                      <div className="pt-2">
                                        {utilizationWarning && (
                                          <span className="text-[10px] font-semibold text-amber-800 bg-amber-200 px-1.5 py-0.5 rounded mr-1" title="80%+ of approved budget used">
                                            ⚠ {pct.toFixed(0)}% used
                                          </span>
                                        )}
                                        {childrenWarning && (
                                          <span className="text-[10px] font-semibold text-red-800 bg-red-200 px-1.5 py-0.5 rounded mr-1" title="Sub-categories exceed parent budget">
                                            ⚠ Sub-cats: {displayMoney(childrenTotal)} &gt; {displayMoney(budget)}
                                          </span>
                                        )}
                                        {hasChildren && !childrenWarning && (
                                          <span className="text-[10px] text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded mr-1" title="Sub-categories total">
                                            Sub-cats: {displayMoney(childrenTotal)}
                                          </span>
                                        )}
                                        {cat.department_id === 'All' && (
                                          <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded mr-1">General</span>
                                        )}
                                        {cat.parent_category_name && (
                                          <span className="text-[10px] text-[var(--role-text)]/50 whitespace-nowrap">
                                            under {cat.parent_category_name}
                                          </span>
                                        )}
                                        <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1.5 mb-1 flex overflow-hidden">
                                          <div className="h-1.5 bg-emerald-500 rounded-l-full" style={{ width: `${Math.min((used / budget) * 100, 100)}%` }} />
                                          <div className="h-1.5 bg-blue-500" style={{ width: `${Math.min((committed / budget) * 100, 100)}%` }} />
                                          <div className="h-1.5 bg-amber-500" style={{ width: `${Math.min((toNumber(cat.pending_approval_amount || 0) / budget) * 100, 100)}%` }} />
                                          <div className="h-1.5 bg-gray-300 rounded-r-full" style={{ width: `${Math.max(0, 100 - ((used + committed + toNumber(cat.pending_approval_amount || 0)) / budget) * 100)}%` }} />
                                        </div>
                                        <div className="flex justify-between text-[10px] text-[var(--role-text)]/50">
                                          <span>Used: <span className="font-medium text-emerald-600">{displayMoney(used)}</span> | Committed: <span className="font-medium text-blue-600">{displayMoney(committed)}</span> | Pending: <span className="font-medium text-amber-600">{displayMoney(toNumber(cat.pending_approval_amount || 0))}</span> | Available: <span className="font-medium text-gray-600">{displayMoney(toNumber(cat.available_amount || rem))}</span></span>
                                        </div>
                                      </div>

                                      {/* Budget input — only in expanded + canEditMatrix */}
                                      {canEditMatrix && (
                                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                          <input type="number" step="0.01" min="0" value={budgetInputs[`cat_${cat.id}`] ?? cat.budget_amount} onChange={e => setBudgetInputs(p => ({ ...p, [`cat_${cat.id}`]: e.target.value }))} className="w-24 px-2 py-1 text-right text-xs rounded border border-[var(--role-border)] bg-[var(--role-accent)]" disabled={cat.is_locked} />
                                          <button onClick={() => { const v = parseFloat(budgetInputs[`cat_${cat.id}`] ?? cat.budget_amount); if (v >= 0) updateCategoryBudget(cat.id, v); }} disabled={cat.is_locked} className="px-2 py-1 text-[10px] bg-emerald-500 text-white rounded hover:bg-emerald-600 disabled:opacity-50">✓</button>
                                        </div>
                                      )}
                                      {!canEditMatrix && (
                                        <span className="text-sm font-semibold text-emerald-600">{displayMoney(budget)}</span>
                                      )}

                                      {/* Revision history */}
                                      {(revisionHistory[cat.id]?.length ?? 0) > 0 && (
                                        <div className="pt-2 border-t border-[var(--role-border)] text-[10px] text-[var(--role-text)]/60 space-y-1">
                                          <p className="font-semibold">Revision history</p>
                                          {revisionHistory[cat.id].slice(0, 3).map((entry: any) => (
                                            <p key={entry.id}>
                                              {formatDateTime(entry.approved_at || entry.created_at)} — {displayMoney(toNumber(entry.previous_amount))} → {displayMoney(toNumber(entry.approved_amount ?? entry.proposed_amount))} ({entry.revision_type?.replace(/_/g, ' ')})
                                            </p>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                        {visibleOrderedCategories.length === 0 && categorySearch.trim() && (
                          <p className="text-sm text-center text-[var(--role-text)]/50 py-4">No categories match your search.</p>
                        )}
                        {/* Pagination bar */}
                        {visibleOrderedCategories.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {/* Count + page size selector */}
                            <div className="flex items-center justify-between text-xs text-[var(--role-text)]/50">
                              <span>
                                Showing {Math.min((categoryPage - 1) * categoryPageSize + 1, visibleOrderedCategories.length)}–{Math.min(categoryPage * categoryPageSize, visibleOrderedCategories.length)} of {visibleOrderedCategories.length} categories
                              </span>
                              <select
                                className="rounded border border-[var(--role-border)] bg-[var(--role-surface)] px-2 py-0.5 text-xs"
                                value={categoryPageSize}
                                onChange={e => { setCategoryPageSize(Number(e.target.value)); setCategoryPage(1); }}
                              >
                                <option value={5}>5 / page</option>
                                <option value={10}>10 / page</option>
                                <option value={20}>20 / page</option>
                              </select>
                            </div>
                            {/* Page number buttons */}
                            {Math.ceil(visibleOrderedCategories.length / categoryPageSize) > 1 && (
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => setCategoryPage(p => Math.max(1, p - 1))}
                                  disabled={categoryPage === 1}
                                  className="rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] px-2.5 py-1 text-xs disabled:opacity-40 hover:bg-[var(--role-accent)] transition"
                                >←</button>
                                {(() => {
                                  const total = Math.ceil(visibleOrderedCategories.length / categoryPageSize);
                                  const pages: (number | '...')[] = [];
                                  if (total <= 7) {
                                    for (let i = 1; i <= total; i++) pages.push(i);
                                  } else {
                                    pages.push(1);
                                    if (categoryPage > 3) pages.push('...');
                                    for (let i = Math.max(2, categoryPage - 1); i <= Math.min(total - 1, categoryPage + 1); i++) pages.push(i);
                                    if (categoryPage < total - 2) pages.push('...');
                                    pages.push(total);
                                  }
                                  return pages.map((p, i) =>
                                    p === '...' ? (
                                      <span key={`ellipsis-${i}`} className="px-1.5 text-xs text-[var(--role-text)]/40">…</span>
                                    ) : (
                                      <button
                                        key={p}
                                        onClick={() => setCategoryPage(p as number)}
                                        className={`min-w-[28px] rounded-lg border px-2 py-1 text-xs transition ${categoryPage === p ? 'border-[var(--role-primary)] bg-[var(--role-primary)] text-white' : 'border-[var(--role-border)] bg-[var(--role-surface)] hover:bg-[var(--role-accent)]'}`}
                                      >{p}</button>
                                    )
                                  );
                                })()}
                                <button
                                  onClick={() => setCategoryPage(p => Math.min(Math.ceil(visibleOrderedCategories.length / categoryPageSize), p + 1))}
                                  disabled={categoryPage >= Math.ceil(visibleOrderedCategories.length / categoryPageSize)}
                                  className="rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] px-2.5 py-1 text-xs disabled:opacity-40 hover:bg-[var(--role-accent)] transition"
                                >→</button>
                              </div>
                            )}
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

                  {/* Petty Cash — collapsible */}
                  {canEditMatrix && (
                  <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setPettyCashOpen(o => !o)}
                      className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-[var(--role-accent)]/80 transition"
                    >
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-[var(--role-text)]">Petty Cash Adjustment</h3>
                        <span className="rounded-full border border-[var(--role-border)] bg-[var(--role-surface)] px-2.5 py-0.5 text-xs text-[var(--role-text)]/60">
                          Balance: <span className="font-semibold text-[var(--role-text)]">{displayMoney(breakdownTotals.petty_cash_balance)}</span>
                        </span>
                      </div>
                      <svg
                        className={`h-4 w-4 text-[var(--role-text)]/40 transition-transform ${pettyCashOpen ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {pettyCashOpen && (
                      <div className="border-t border-[var(--role-border)] px-5 py-4">
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
                  )}
                </div>

                {/* Right sidebar: Quick Totals + Recent Requests + Recent Petty Cash */}
                <div className="space-y-6">
                  <div className="rounded-[28px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5">
                    <h3 className="text-sm font-semibold text-[var(--role-text)]">Quick Totals</h3>
                    <p className="text-[10px] text-[var(--role-text)]/40 mt-0.5 mb-3">
                      {selectedDepartment ? `${selectedDepartment.name} · FY ${activeFiscalYear}` : `Across all departments · FY ${activeFiscalYear}`}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'Requests', val: filteredBreakdownCounts?.total_requests ?? 0 },
                        { label: 'Disbursed', val: filteredBreakdownCounts?.released_requests ?? 0 },
                        { label: 'Direct Exp.', val: filteredBreakdownCounts?.direct_expenses ?? 0 },
                        { label: 'Petty Txns', val: filteredBreakdownCounts?.petty_cash_transactions ?? 0 },
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
                        <div
                          key={req.id}
                          className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4 cursor-pointer hover:border-[var(--role-secondary)]/40 hover:bg-[var(--role-accent)]/50 transition group"
                          onClick={() => window.location.href = `/tracker`}
                        >
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
                            <div className="flex items-center gap-1">
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize whitespace-nowrap ${statusTone(req.status)}`}>{req.status?.replace('_', ' ')}</span>
                              <span className="text-[var(--role-text)]/0 group-hover:text-[var(--role-text)]/40 transition text-sm ml-1">→</span>
                            </div>
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
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <input className="field-input" placeholder="Department Name" value={newDept.name} onChange={e => setNewDept(p => ({ ...p, name: e.target.value }))} />
          <input className="field-input" type="number" placeholder="Fiscal Year" value={newDept.fiscal_year} onChange={e => setNewDept(p => ({ ...p, fiscal_year: Number(e.target.value) }))} />
        </div>
        <button className="btn-primary mt-4" onClick={createDepartment}>Create Department</button>
      </div>
    </div>
  );
};

export default BudgetManagement;
