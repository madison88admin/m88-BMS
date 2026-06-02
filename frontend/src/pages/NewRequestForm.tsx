import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';
import { formatMoney , getErrorMessage } from '../utils/format';

type RequestType = 'reimbursement' | 'cash_advance' | 'liquidation';

interface Category {
  id: string;
  category_code: string;
  category_name: string;
  department_id: string;
  budget_amount?: number;
  allocated_amount?: number;
  remaining_amount?: number;
}

interface CostCenter {
  id: string;
  cost_center_code: string;
  cost_center_name: string;
}

interface CashAdvance {
  id: string;
  request_id?: string | null;
  advance_code: string;
  amount_issued: number;
  balance: number;
  purpose: string;
}

interface OfficialExpense {
  code: string;
  itemName: string;
  category: string;
  dept: string | string[];
  canCA: boolean;
  canRE: boolean;
  mannerOfSubmission?: 'for_submission' | 'for_upload';
}

const resolveCategoryIdFromOfficialItem = (
  selectedItem: OfficialExpense | undefined,
  categories: Category[]
) => {
  if (!selectedItem) return '';
  const byItemName = categories.find((category) => category.category_name === selectedItem.itemName);
  if (byItemName) return byItemName.id;
  const byCode = categories.find((category) => category.category_code === selectedItem.code);
  if (byCode) return byCode.id;
  return categories.find((category) => category.category_name === selectedItem.category)?.id || '';
};

const NewRequestForm = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialType = (searchParams.get('type') as RequestType) || 'reimbursement';
  const initialAdvanceId = searchParams.get('advance_id');

  const [activeTab, setActiveTab] = useState<RequestType>(() => {
    const saved = localStorage.getItem('active_request_tab');
    if (saved) return saved as RequestType;
    return initialType;
  });
  const [user, setUser] = useState<any>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [cashAdvances, setCashAdvances] = useState<CashAdvance[]>([]);
  const [officialList, setOfficialList] = useState<OfficialExpense[]>([]);
  const [selectedAdvance, setSelectedAdvance] = useState<CashAdvance | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Selected main categories for hierarchical dropdowns
  const [cashAdvanceMainCategory, setCashAdvanceMainCategory] = useState('');
  const [reimbursementMainCategory, setReimbursementMainCategory] = useState('');

  // Helper: Get unique main categories from official list
  const getUniqueMainCategories = () => {
    const categories = new Set<string>();
    officialList.forEach(item => {
      if (item.category) categories.add(item.category);
    });
    return Array.from(categories).sort();
  };

  const isStaffUser = !user?.role || user.role === 'employee' || user.role === 'manager' || user.role === 'supervisor';

  const departmentNameForFilter = () =>
    departments.find((d) => d.id === (activeTab === 'reimbursement' ? reimbursementForm.department_id : cashAdvanceForm.department_id))?.name || '';

  const matchesDepartment = (item: OfficialExpense) => {
    const userDeptName = departmentNameForFilter();
    if (!userDeptName) return true;
    const allowedDepts = Array.isArray(item.dept) ? item.dept : [item.dept];
    return allowedDepts.includes('All Dept') || allowedDepts.some((d) => {
      const allowedCore = d.toLowerCase().replace(/\s+department$/i, '').trim();
      const userCore = userDeptName.toLowerCase().replace(/\s+department$/i, '').trim();
      return d.toLowerCase() === userDeptName.toLowerCase() || allowedCore === userCore || userDeptName.toLowerCase().includes(allowedCore);
    });
  };

  const isVisibleForRequestForm = (item: OfficialExpense, canUse: 'canRE' | 'canCA') => {
    if (isStaffUser && item.mannerOfSubmission === 'for_upload') return false;
    if (!item[canUse]) return false;
    if (!item.canCA && !item.canRE && isStaffUser) return false;
    return matchesDepartment(item);
  };

  // Helper: Filter items by main category
  const getItemsByMainCategory = (mainCategory: string, canUse: 'canRE' | 'canCA') => {
    return officialList.filter(item => 
      item.category === mainCategory && 
      isVisibleForRequestForm(item, canUse)
    );
  };

  const uploadSupportingFile = async (file: File) => {
    const token = localStorage.getItem('token');
    if (!token) {
      throw new Error('Not authenticated');
    }

    const formData = new FormData();
    formData.append('file', file);

    const response = await api.post('/api/upload', formData, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    return response.data;
  };

  // Reimbursement Form
  const [reimbursementForm, setReimbursementForm] = useState({
    expense_date: new Date().toISOString().split('T')[0],
    department_id: '',
    cost_center_id: '',
    project: '',
    business_purpose: '',
    main_category: '',
    item_name: '',
    items: [
      { item: '', amount: '' }
    ] as Array<{
      item: string;
      amount: string;
    }>,
    receipt_files: [] as File[]
  });

  // Cash Advance Form
  const [cashAdvanceForm, setCashAdvanceForm] = useState({
    advance_type: 'Travel',
    department_id: '',
    main_category: '',
    item_name: '',
    amount: '',
    expected_use_date: '',
    expected_liquidation_date: '',
    purpose: '',
    cost_center_id: '',
    breakdown: [
      { item: 'Transportation', amount: '' },
      { item: 'Meals', amount: '' },
      { item: 'Miscellaneous', amount: '' }
    ],
    attachments: [] as File[]
  });

  // Liquidation Form
  const [liquidationForm, setLiquidationForm] = useState({
    advance_id: initialAdvanceId || '',
    amount_spent: '',
    remarks: '',
    attachments: [] as File[]
  });

  // Load drafts on mount
  useEffect(() => {
    const rDraft = localStorage.getItem('reimbursement_draft');
    if (rDraft) {
      try {
        const parsed = JSON.parse(rDraft);
        setReimbursementForm((prev: any) => ({ ...prev, ...parsed, receipt_files: [] }));
        if (parsed.main_category) {
          setReimbursementMainCategory(parsed.main_category);
        }
      } catch (e) { /* invalid draft, skip */ }
    }

    const cDraft = localStorage.getItem('cash_advance_draft');
    if (cDraft) {
      try {
        const parsed = JSON.parse(cDraft);
        setCashAdvanceForm((prev: any) => ({ ...prev, ...parsed, attachments: [] }));
      } catch (e) { /* invalid draft, skip */ }
    }

    const lDraft = localStorage.getItem('liquidation_draft');
    if (lDraft) {
      try {
        const parsed = JSON.parse(lDraft);
        setLiquidationForm((prev: any) => ({
          ...prev,
          advance_id: parsed.advance_id || '',
          amount_spent: parsed.amount_spent || '',
          remarks: parsed.remarks || '',
          attachments: []
        }));
      } catch (e) { /* invalid draft, skip */ }
    }
  }, []);

  // Save drafts when forms change
  useEffect(() => {
    // Save whenever there is substantial content
    const hasContent = reimbursementForm.items.some(i => i.item && i.amount) || reimbursementForm.business_purpose;
    if (hasContent) {
      const { receipt_files, ...rest } = reimbursementForm;
      localStorage.setItem('reimbursement_draft', JSON.stringify(rest));
    }
  }, [reimbursementForm]);

  useEffect(() => {
    // Save whenever there is ANY user input in crucial fields
    const hasAnyContent = 
      cashAdvanceForm.purpose.length > 0 || 
      cashAdvanceForm.expected_use_date || 
      cashAdvanceForm.breakdown.some(i => i.amount && i.amount !== '0' && i.amount !== '') ||
      cashAdvanceForm.department_id !== '';
    
    if (hasAnyContent) {
      const { attachments, ...rest } = cashAdvanceForm;
      localStorage.setItem('cash_advance_draft', JSON.stringify(rest));
    }
  }, [cashAdvanceForm]);

  useEffect(() => {
    const hasDraft = Boolean(liquidationForm.advance_id);
    if (hasDraft) {
      const { attachments, ...rest } = liquidationForm;
      localStorage.setItem('liquidation_draft', JSON.stringify(rest));
    }
  }, [liquidationForm]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }

    const loadData = async () => {
      try {
        // First get user data
        const userRes = await api.get('/api/auth/me');
        const userData = userRes.data;
        setUser(userData);

        // Fetch departments, categories and cost centers (filtered by user's department and fiscal year)
        const currentFiscalYear = userData.fiscal_year || new Date().getFullYear();
        const [departmentsRes, categoriesRes, costCentersRes] = await Promise.all([
          api.get('/api/departments'),
          api.get(`/api/budget/categories?department_id=${userData.department_id || ''}&fiscal_year=${currentFiscalYear}`),
          api.get(`/api/budget/cost-centers?department_id=${userData.department_id || ''}`)
        ]);

        setDepartments(departmentsRes.data || []);
        // Only show categories that belong to the user's department
        setCategories(categoriesRes.data || []);
        setCostCenters(costCentersRes.data || []);

        // Load cash advances for liquidation
        const advancesRes = await api.get(`/api/cash-advances/for-liquidation/${userRes.data.id}`);
        setCashAdvances(advancesRes.data || []);

        // Load official expense list (includes budget-matrix categories)
        const initialRequestType = initialType === 'cash_advance' ? 'cash_advance' : initialType === 'reimbursement' ? 'reimbursement' : '';
        const officialRes = await api.get(`/api/requests/official-list${initialRequestType ? `?request_type=${initialRequestType}` : ''}`);
        setOfficialList(officialRes.data || []);

        // If initial advance_id provided, select it
        if (initialAdvanceId) {
          const advance = advancesRes.data?.find((a: CashAdvance) => a.id === initialAdvanceId);
          if (advance) {
            setSelectedAdvance(advance);
            setLiquidationForm(prev => ({ ...prev, advance_id: advance.id }));
          }
        } else {
          // Check for liquidation draft advance_id if not provided in URL
          const lDraft = localStorage.getItem('liquidation_draft');
          if (lDraft) {
            try {
              const parsed = JSON.parse(lDraft);
              if (parsed.advance_id) {
                const advance = advancesRes.data?.find((a: CashAdvance) => a.id === parsed.advance_id);
                if (advance) setSelectedAdvance(advance);
              }
            } catch (e) { /* silent */ }
          }
        }

        // Initialize department if user has one
        if (userData.department_id) {
          const isStaff = userData.role !== 'admin' && userData.role !== 'accounting';
          
          setReimbursementForm(prev => {
            if (isStaff || !prev.department_id) {
              return { ...prev, department_id: userData.department_id };
            }
            return prev;
          });
          
          setCashAdvanceForm(prev => {
            if (isStaff || !prev.department_id) {
              return { ...prev, department_id: userData.department_id };
            }
            return prev;
          });
        } else if (departmentsRes.data?.length > 0) {
          // If no department, default to first one for admins
          setReimbursementForm(prev => prev.department_id ? prev : ({ ...prev, department_id: departmentsRes.data[0].id }));
          setCashAdvanceForm(prev => prev.department_id ? prev : ({ ...prev, department_id: departmentsRes.data[0].id }));
        }

        // Now that data is loaded and department is set correctly, notify about drafts if they were restored
        if (localStorage.getItem('reimbursement_draft')) toast.success('Restored draft for reimbursement', { id: 'r-draft' });
        if (localStorage.getItem('cash_advance_draft')) toast.success('Restored draft for cash advance', { id: 'c-draft' });
        if (localStorage.getItem('liquidation_draft')) toast.success('Restored draft for liquidation', { id: 'l-draft' });
      } catch (err) {
        toast.error('Failed to load form data');
      } finally {
        setLoading(false);
      }
    };

    loadData();

    const refreshOfficialList = async () => {
      try {
        const requestTypeParam = activeTab === 'cash_advance' ? 'cash_advance' : activeTab === 'reimbursement' ? 'reimbursement' : '';
        const officialRes = await api.get(`/api/requests/official-list${requestTypeParam ? `?request_type=${requestTypeParam}` : ''}`);
        setOfficialList(officialRes.data || []);
      } catch {
        // silent refresh
      }
    };
    refreshOfficialList();
    const officialListIntervalId = setInterval(refreshOfficialList, 5000);
    return () => clearInterval(officialListIntervalId);
  }, [navigate, initialAdvanceId, activeTab]);

  // Re-fetch categories when department or fiscal year changes
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const targetDeptId = activeTab === 'reimbursement' ? reimbursementForm.department_id : cashAdvanceForm.department_id;
    if (!targetDeptId) return;

    const loadCategoriesAndCostCenters = async () => {
      try {
        const currentFiscalYear = user?.fiscal_year || new Date().getFullYear();
        const [categoriesRes, costCentersRes] = await Promise.all([
          api.get(`/api/budget/categories?department_id=${targetDeptId}&fiscal_year=${currentFiscalYear}`),
          api.get(`/api/budget/cost-centers?department_id=${targetDeptId}`)
        ]);

        const categoriesData = categoriesRes.data || [];
        const costCentersData = costCentersRes.data || [];

        setCategories(categoriesData);
        setCostCenters(costCentersData);

        // Automatically select the first cost center if available and not yet set
        if (costCentersData.length > 0) {
          const defaultCostCenterId = costCentersData[0].id;
          if (activeTab === 'reimbursement') {
            setReimbursementForm(prev => {
              if (!prev.cost_center_id) {
                return { ...prev, cost_center_id: defaultCostCenterId };
              }
              return prev;
            });
          } else if (activeTab === 'cash_advance') {
            setCashAdvanceForm(prev => {
              if (!prev.cost_center_id) {
                return { ...prev, cost_center_id: defaultCostCenterId };
              }
              return prev;
            });
          }
        }
      } catch (err: any) {
        toast.error(getErrorMessage(err, 'Failed to load form data'));
      }
    };

    loadCategoriesAndCostCenters();

    // Poll for new categories every 5 seconds
    const intervalId = setInterval(loadCategoriesAndCostCenters, 5000);
    return () => clearInterval(intervalId);
  }, [user?.id, activeTab, reimbursementForm.department_id, cashAdvanceForm.department_id]);

  // Save active tab
  useEffect(() => {
    localStorage.setItem('active_request_tab', activeTab);
  }, [activeTab]);

  // Removed tab-reset logic to allow auto-draft persistence

  const handleSubmitReimbursement = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const token = localStorage.getItem('token');

    try {
      let attachments: any[] = [];
      
      // Upload all files
      if (reimbursementForm.receipt_files.length > 0) {
        for (const file of reimbursementForm.receipt_files) {
          try {
            const uploaded = await uploadSupportingFile(file);
            attachments.push(uploaded);
          } catch (uploadErr: any) {
            toast.error(getErrorMessage(uploadErr, 'Failed to upload file'));
          }
        }
      }

      // Calculate total and prepare items
      const totalAmount = reimbursementForm.items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
      
      // Prepare items with category info for backend
      const itemsForBackend = reimbursementForm.items.map(item => {
        const selectedItem = officialList.find(i => `${i.code} | ${i.itemName}` === item.item);
        return {
          item_name: item.item,
          main_category: selectedItem?.category || reimbursementForm.main_category || '',
          category: selectedItem?.category || reimbursementForm.main_category || '',
          category_id: resolveCategoryIdFromOfficialItem(selectedItem, categories),
          amount: parseFloat(item.amount) || 0
        };
      });

      const mainOfficialItem = officialList.find(i => `${i.code} | ${i.itemName}` === reimbursementForm.item_name);
      const primaryCategoryId = resolveCategoryIdFromOfficialItem(mainOfficialItem, categories);

      await api.post('/api/requests', {
        request_type: 'reimbursement',
        item_name: reimbursementForm.item_name,
        department_id: reimbursementForm.department_id,
        category: mainOfficialItem?.category || reimbursementForm.main_category || 'Reimbursement',
        category_id: primaryCategoryId || '',
        amount: totalAmount,
        purpose: reimbursementForm.business_purpose,
        expense_date: reimbursementForm.expense_date,
        cost_center_id: reimbursementForm.cost_center_id,
        project: reimbursementForm.project,
        priority: 'normal',
        attachments,
        items: itemsForBackend,
        metadata: {
          request_type: 'reimbursement',
          expense_date: reimbursementForm.expense_date,
          cost_center_id: reimbursementForm.cost_center_id || null,
          project: reimbursementForm.project || null,
          main_category: reimbursementForm.main_category || mainOfficialItem?.category || null,
        }
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      toast.success('Expense request submitted!');
      localStorage.removeItem('reimbursement_draft');
      navigate('/tracker');
    } catch (err: any) {
      let errorMsg = 'Failed to Submit Expense';
      if (err.response?.data?.error) {
        errorMsg = typeof err.response.data.error === 'string' 
          ? err.response.data.error 
          : JSON.stringify(err.response.data.error);
      } else if (err.message) {
        errorMsg = err.message;
      }
      toast.error(`Error: ${errorMsg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitCashAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const token = localStorage.getItem('token');

    const totalAmount = cashAdvanceForm.breakdown.reduce((sum: number, item: any) => sum + (parseFloat(item.amount as string) || 0), 0);

    try {
      let attachments: any[] = [];
      if (cashAdvanceForm.attachments.length > 0) {
        for (const file of cashAdvanceForm.attachments) {
          try {
            const uploaded = await uploadSupportingFile(file);
            attachments.push(uploaded);
          } catch (uploadErr: any) {
            toast.error(getErrorMessage(uploadErr, 'Failed to upload file'));
          }
        }
      }

      const selectedItem = officialList.find(i => `${i.code} | ${i.itemName}` === cashAdvanceForm.item_name);
      const itemsForBackend = cashAdvanceForm.breakdown.map(item => {
        const breakdownItem = officialList.find(i => `${i.code} | ${i.itemName}` === item.item);
        return {
          item_name: item.item,
          main_category: breakdownItem?.category || cashAdvanceForm.main_category || selectedItem?.category || '',
          category: breakdownItem?.category || cashAdvanceForm.main_category || selectedItem?.category || '',
          category_id: resolveCategoryIdFromOfficialItem(breakdownItem, categories) || '',
          amount: parseFloat(item.amount) || 0
        };
      });
      const primaryBreakdownCategoryId = itemsForBackend.find(i => i.category_id)?.category_id || resolveCategoryIdFromOfficialItem(selectedItem, categories) || '';

      await api.post('/api/requests', {
        request_type: 'cash_advance',
        item_name: cashAdvanceForm.item_name,
        department_id: cashAdvanceForm.department_id,
        category: selectedItem?.category || cashAdvanceForm.main_category || 'Cash Advance',
        category_id: primaryBreakdownCategoryId || '',
        amount: totalAmount,
        purpose: cashAdvanceForm.purpose,
        expected_liquidation_date: cashAdvanceForm.expected_liquidation_date,
        priority: 'normal',
        attachments,
        items: itemsForBackend,
        metadata: {
          request_type: 'cash_advance',
          main_category: cashAdvanceForm.main_category || selectedItem?.category || null,
        },
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      toast.success('Cash advance request submitted!');
      localStorage.removeItem('cash_advance_draft');
      navigate('/tracker');
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to Submit Expense'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitLiquidation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdvance) {
      toast.error('Please select a cash advance to liquidate');
      return;
    }

    const amountSpent = parseFloat(String(liquidationForm.amount_spent || '0'));
    if (!Number.isFinite(amountSpent) || amountSpent <= 0) {
      toast.error('Please enter a valid amount spent');
      return;
    }
    if (amountSpent > Number(selectedAdvance.balance || 0)) {
      toast.error(`Amount spent cannot exceed the cash advance balance of ${formatMoney(Number(selectedAdvance.balance || 0))}`);
      return;
    }
    if (!selectedAdvance.request_id) {
      toast.error('Selected cash advance is missing request reference. Please contact admin.');
      return;
    }

    setSubmitting(true);
    const token = localStorage.getItem('token');

    try {
      // Upload files
      let attachments: any[] = [];
      if (liquidationForm.attachments.length > 0) {
        for (const file of liquidationForm.attachments) {
          try {
            const uploaded = await uploadSupportingFile(file);
            attachments.push(uploaded);
          } catch (uploadErr: any) {
            toast.error(getErrorMessage(uploadErr, 'Failed to upload file'));
          }
        }
      }

      await api.patch(`/api/requests/${selectedAdvance.request_id}/liquidation`, {
        cash_advance_id: selectedAdvance.id,
        amount_spent: amountSpent,
        remarks: liquidationForm.remarks,
        attachments
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      toast.success('Liquidation submitted successfully!');
      localStorage.removeItem('liquidation_draft');
      navigate('/tracker');
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to submit liquidation'));
    } finally {
      setSubmitting(false);
    }
  };



  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="bms-spinner"></div>
      </div>
    );
  }

  const getTotalBreakdown = () => {
    return cashAdvanceForm.breakdown.reduce((sum: number, item: any) => sum + (parseFloat(item.amount as string) || 0), 0);
  };

  return (
    <div className="text-[var(--role-text)] page-transition">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">New Request</h1>
        <p className="page-subtitle">Submit reimbursement, cash advance, or liquidation</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {[
          { key: 'reimbursement', label: 'Reimbursement', icon: '📄' },
          { key: 'cash_advance', label: 'Cash Advance', icon: '💵' },
          { key: 'liquidation', label: 'Liquidation', icon: '📊' }
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as RequestType)}
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

      {/* Reimbursement Form */}
      {activeTab === 'reimbursement' && (
        <form onSubmit={handleSubmitReimbursement} className="panel max-w-3xl">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
            </svg>
            Submit Expense
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2">Employee</label>
              <input
                type="text"
                value={user?.name || user?.email}
                disabled
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Department *</label>
              <select
                required
                value={reimbursementForm.department_id}
                onChange={(e) => {
                  const val = e.target.value;
                  setReimbursementForm(prev => ({ ...prev, department_id: val, category_id: '', cost_center_id: '' }));
                }}
                disabled={user?.role !== 'admin' && user?.role !== 'accounting'}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] disabled:bg-gray-100"
              >
                {!reimbursementForm.department_id && <option value="">Select department...</option>}
                {departments.map(dept => (
                  <option key={dept.id} value={dept.id}>{dept.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2">Expense Date *</label>
              <input
                type="date"
                required
                value={reimbursementForm.expense_date}
                onChange={(e) => setReimbursementForm(prev => ({ ...prev, expense_date: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Cost Center</label>
              <input
                type="text"
                readOnly
                value={(() => {
                  const selected = costCenters.find(cc => cc.id === reimbursementForm.cost_center_id);
                  return selected ? `${selected.cost_center_code} - ${selected.cost_center_name}` : 'Loading...';
                })()}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] cursor-not-allowed opacity-80"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Main Category *</label>
            <select
              required
              value={reimbursementMainCategory}
              onChange={(e) => {
                const selectedMainCat = e.target.value;
                setReimbursementMainCategory(selectedMainCat);
                setReimbursementForm(prev => ({ 
                  ...prev, 
                  main_category: selectedMainCat,
                  item_name: ''
                }));
              }}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
            >
              <option value="">Select main category...</option>
              {getUniqueMainCategories()
                .filter(cat => getItemsByMainCategory(cat, 'canRE').length > 0)
                .map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
            </select>
          </div>

          {reimbursementMainCategory && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Sub-category / Item *</label>
              <select
                required
                value={reimbursementForm.item_name}
                onChange={(e) => {
                  const selectedItemValue = e.target.value;
                  setReimbursementForm(prev => ({ 
                    ...prev, 
                    item_name: selectedItemValue
                  }));
                }}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
              >
                <option value="">Select sub-category...</option>
                {getItemsByMainCategory(reimbursementMainCategory, 'canRE')
                  .map(item => (
                    <option key={item.code} value={`${item.code} | ${item.itemName}`}>
                      {item.category} - {item.itemName}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* Multiple Items Section */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium">Estimated Breakdown</label>
              <button
                type="button"
                onClick={() => {
                  setReimbursementForm(prev => ({
                    ...prev,
                    items: [...prev.items, { item: '', amount: '' }]
                  }));
                }}
                className="text-sm text-[var(--role-primary)] hover:underline flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Item
              </button>
            </div>
            <div className="space-y-3">
              {reimbursementForm.items.map((item, index) => (
                <div key={index} className="flex items-center gap-3">
                  <span className="text-sm text-[var(--role-text)]/60">→</span>
                  <select
                    value={item.item}
                    onChange={(e) => {
                      const newItems = [...reimbursementForm.items];
                      newItems[index].item = e.target.value;
                      setReimbursementForm(prev => ({ ...prev, items: newItems }));
                    }}
                    className="flex-1 px-3 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                  >
                    <option value="">Select approved item...</option>
                    {officialList
                      .filter(off => isVisibleForRequestForm(off, 'canRE'))
                      .map(off => (
                        <option key={off.code} value={`${off.code} | ${off.itemName}`}>
                          {off.category} - {off.itemName}
                        </option>
                      ))}
                  </select>
                  <div className="relative w-40">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--role-text)]/60">₱</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.amount}
                      onChange={(e) => {
                        const newItems = [...reimbursementForm.items];
                        newItems[index].amount = e.target.value;
                        setReimbursementForm(prev => ({ ...prev, items: newItems }));
                      }}
                      className="w-full pl-7 pr-3 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                      placeholder="0.00"
                    />
                  </div>
                  {reimbursementForm.items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        const newItems = reimbursementForm.items.filter((_, i) => i !== index);
                        setReimbursementForm(prev => ({ ...prev, items: newItems }));
                      }}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="Remove item"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Total Amount */}
            <div className="mt-4 pt-4 border-t border-[var(--role-border)]">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Total Amount:</span>
                <span className="text-xl font-bold text-emerald-600">
                  {formatMoney(reimbursementForm.items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0))}
                </span>
              </div>
            </div>
          </div>

          {/* Budget status hidden from reimbursement form - they can submit continuously */}
          {false && reimbursementForm.items.some(i => i.item) && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Budget Status</label>
              {(() => {
                const itemCategoryIds = reimbursementForm.items
                  .map(i => {
                    const selectedItem = officialList.find(off => `${off.code} | ${off.itemName}` === i.item);
                    return resolveCategoryIdFromOfficialItem(selectedItem, categories);
                  })
                  .filter(Boolean);
                const uniqueCategoryIds = [...new Set(itemCategoryIds)];
                
                return uniqueCategoryIds.map(catId => {
                  const selectedCat = categories.find(c => c.id === catId);
                  if (!selectedCat) return null;
                  
                  const remaining = Number(selectedCat.remaining_amount || 0);
                  const allocated = Number(selectedCat.allocated_amount || 0);
                  
                  // Calculate total amount for this category
                  const categoryTotalAmount = reimbursementForm.items
                    .filter(i => {
                      const selectedItem = officialList.find(off => `${off.code} | ${off.itemName}` === i.item);
                      return resolveCategoryIdFromOfficialItem(selectedItem, categories) === catId;
                    })
                    .reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);
                  
                  if (categoryTotalAmount === 0) return null;
                  
                  const isOutOfBudget = remaining < categoryTotalAmount;
                  const isLowBudget = remaining >= categoryTotalAmount && remaining > 0 && remaining < (allocated * 0.2);
                  
                  if (isOutOfBudget) {
                    return (
                      <div key={catId} className="px-4 py-3 rounded-xl border border-red-300 bg-red-50 flex items-center gap-2 mb-2">
                        <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-red-700 font-medium">Out of Budget ({selectedCat.category_name})</span>
                      </div>
                    );
                  }
                  
                  if (isLowBudget) {
                    return (
                      <div key={catId} className="px-4 py-3 rounded-xl border border-amber-300 bg-amber-50 flex items-center gap-2 mb-2">
                        <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span className="text-amber-700 font-medium">Budget Running Low ({selectedCat.category_name})</span>
                      </div>
                    );
                  }
                  
                  return (
                    <div key={catId} className="px-4 py-3 rounded-xl border border-emerald-300 bg-emerald-50 flex items-center gap-2 mb-2">
                      <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-emerald-700 font-medium">Within Budget ({selectedCat.category_name})</span>
                    </div>
                  );
                });
              })()}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Project (Optional)</label>
            <input
              type="text"
              value={reimbursementForm.project}
              onChange={(e) => setReimbursementForm(prev => ({ ...prev, project: e.target.value }))}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
              placeholder="Enter project name"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Business Purpose *</label>
            <textarea
              required
              value={reimbursementForm.business_purpose}
              onChange={(e) => setReimbursementForm(prev => ({ ...prev, business_purpose: e.target.value }))}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] min-h-[100px]"
              placeholder="Describe the business purpose..."
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium mb-3">Supporting Documents (Optional)</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              {reimbursementForm.receipt_files.map((file, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-[var(--role-accent)] border border-[var(--role-border)]">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <svg className="w-5 h-5 text-[var(--role-primary)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm truncate">{file.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const newFiles = reimbursementForm.receipt_files.filter((_, i) => i !== idx);
                      setReimbursementForm(prev => ({ ...prev, receipt_files: newFiles }));
                    }}
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
                    const files = Array.from(e.target.files);
                    setReimbursementForm(prev => ({ ...prev, receipt_files: [...prev.receipt_files, ...files] }));
                  }
                }}
                className="hidden"
                id="receipt-upload"
              />
              <label htmlFor="receipt-upload" className="cursor-pointer">
                <svg className="w-10 h-10 mx-auto mb-2 text-[var(--role-text)]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-[var(--role-text)]/60">
                  Click to add receipts or documents
                </p>
              </label>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate('/tracker')}
              className="btn-secondary px-8"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary px-8 flex-1"
            >
              {submitting ? 'Submitting...' : 'Submit Expense'}
            </button>
          </div>
        </form>
      )}

      {/* Cash Advance Form */}
      {activeTab === 'cash_advance' && (
        <form onSubmit={handleSubmitCashAdvance} className="panel max-w-3xl">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Cash Advance
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2">Employee</label>
              <input
                type="text"
                value={user?.name || 'Loading...'}
                disabled
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-gray-100 text-[var(--role-text)]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Department *</label>
              <select
                required
                value={cashAdvanceForm.department_id}
                onChange={(e) => {
                  const val = e.target.value;
                  setCashAdvanceForm(prev => ({ ...prev, department_id: val, cost_center_id: '' }));
                }}
                disabled={user?.role !== 'admin' && user?.role !== 'accounting'}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] disabled:bg-gray-100"
              >
                {!cashAdvanceForm.department_id && <option value="">Select department...</option>}
                {departments.map(dept => (
                  <option key={dept.id} value={dept.id}>{dept.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2">Expected Use Date *</label>
              <input
                type="date"
                required
                value={cashAdvanceForm.expected_use_date}
                onChange={(e) => setCashAdvanceForm(prev => ({ ...prev, expected_use_date: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Cost Center</label>
              <input
                type="text"
                readOnly
                value={(() => {
                  const selected = costCenters.find(cc => cc.id === cashAdvanceForm.cost_center_id);
                  return selected ? `${selected.cost_center_code} - ${selected.cost_center_name}` : 'Loading...';
                })()}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] cursor-not-allowed opacity-80"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Main Category *</label>
            <select
              required
              value={cashAdvanceMainCategory}
              onChange={(e) => {
                const selectedMainCat = e.target.value;
                setCashAdvanceMainCategory(selectedMainCat);
                setCashAdvanceForm(prev => ({ 
                  ...prev, 
                  main_category: selectedMainCat,
                  item_name: '',
                  advance_type: ''
                }));
              }}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
            >
              <option value="">Select main category...</option>
              {getUniqueMainCategories()
                .filter(cat => getItemsByMainCategory(cat, 'canCA').length > 0)
                .map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
            </select>
          </div>

          {cashAdvanceMainCategory && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Sub-category / Item *</label>
              <select
                required
                value={cashAdvanceForm.item_name}
                onChange={(e) => {
                  const selectedItemValue = e.target.value;
                  const selectedItem = officialList.find(i => `${i.code} | ${i.itemName}` === selectedItemValue);
                  setCashAdvanceForm(prev => ({ 
                    ...prev, 
                    item_name: selectedItemValue,
                    advance_type: selectedItem ? selectedItem.category : prev.advance_type
                  }));
                }}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
              >
                <option value="">Select sub-category...</option>
                {getItemsByMainCategory(cashAdvanceMainCategory, 'canCA')
                  .map(item => (
                    <option key={item.code} value={`${item.code} | ${item.itemName}`}>
                      {item.category} - {item.itemName}
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2">Expected Liquidation Date *</label>
              <input
                type="date"
                required
                value={cashAdvanceForm.expected_liquidation_date}
                onChange={(e) => setCashAdvanceForm(prev => ({ ...prev, expected_liquidation_date: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Purpose *</label>
              <input
                type="text"
                required
                value={cashAdvanceForm.purpose}
                onChange={(e) => setCashAdvanceForm(prev => ({ ...prev, purpose: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
                placeholder="Brief description of the cash advance purpose"
              />
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium">Estimated Breakdown</label>
              <button
                type="button"
                onClick={() => {
                  setCashAdvanceForm(prev => ({
                    ...prev,
                    breakdown: [...prev.breakdown, { item: '', amount: '' }]
                  }));
                }}
                className="text-sm text-[var(--role-primary)] hover:underline flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Item
              </button>
            </div>
            <div className="space-y-3">
              {cashAdvanceForm.breakdown.map((item, index) => (
                <div key={index} className="flex items-center gap-3">
                  <span className="text-sm text-[var(--role-text)]/60">→</span>
                  <select
                    value={item.item}
                    onChange={(e) => {
                      const newBreakdown = [...cashAdvanceForm.breakdown];
                      newBreakdown[index].item = e.target.value;
                      setCashAdvanceForm(prev => ({ ...prev, breakdown: newBreakdown }));
                    }}
                    className="flex-1 px-3 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                  >
                    <option value="">Select approved item...</option>
                    {officialList
                      .filter(off => isVisibleForRequestForm(off, 'canCA'))
                      .map(off => (
                        <option key={off.code} value={`${off.code} | ${off.itemName}`}>
                          {off.category} - {off.itemName}
                        </option>
                      ))}
                  </select>
                  <div className="relative w-40">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--role-text)]/60">₱</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.amount}
                      onChange={(e) => {
                        const newBreakdown = [...cashAdvanceForm.breakdown];
                        newBreakdown[index].amount = e.target.value;
                        setCashAdvanceForm(prev => ({ ...prev, breakdown: newBreakdown }));
                      }}
                      className="w-full pl-7 pr-3 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                      placeholder="0.00"
                    />
                  </div>
                  {cashAdvanceForm.breakdown.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        const newBreakdown = cashAdvanceForm.breakdown.filter((_, i) => i !== index);
                        setCashAdvanceForm(prev => ({ ...prev, breakdown: newBreakdown }));
                      }}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="Remove item"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-[var(--role-border)] flex justify-between items-center">
              <span className="font-medium">Total Amount:</span>
              <span className="text-xl font-bold text-emerald-600">{formatMoney(getTotalBreakdown())}</span>
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">Purpose *</label>
            <textarea
              required
              value={cashAdvanceForm.purpose}
              onChange={(e) => setCashAdvanceForm(prev => ({ ...prev, purpose: e.target.value }))}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] min-h-[100px]"
              placeholder="Describe the purpose for this cash advance..."
            />
          </div>

          {/* Supporting Documents Section for Cash Advance */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-3">Supporting Documents (Optional)</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              {cashAdvanceForm.attachments.map((file, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-[var(--role-accent)] border border-[var(--role-border)]">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <svg className="w-5 h-5 text-[var(--role-primary)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm truncate">{file.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const newAtts = cashAdvanceForm.attachments.filter((_, i) => i !== idx);
                      setCashAdvanceForm(prev => ({ ...prev, attachments: newAtts }));
                    }}
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
                    const files = Array.from(e.target.files);
                    setCashAdvanceForm(prev => ({ ...prev, attachments: [...prev.attachments, ...files] }));
                  }
                }}
                className="hidden"
                id="cash-advance-attachments"
              />
              <label htmlFor="cash-advance-attachments" className="cursor-pointer">
                <svg className="w-10 h-10 mx-auto mb-2 text-[var(--role-text)]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-[var(--role-text)]/60">
                  Click to add images or PDFs
                </p>
              </label>
            </div>
          </div>

          {/* Budget status hidden from Cash Advance form - they can submit continuously */}
          {false && cashAdvanceForm.department_id && categories.length > 0 && (
            <div className="mb-6">
              <label className="block text-sm font-medium mb-3">Budget Status</label>
              <div className="space-y-2">
                {(() => {
                  const selectedItem = officialList.find(i => `${i.code} | ${i.itemName}` === cashAdvanceForm.item_name);
                  const selectedCat = selectedItem ? categories.find(c => c.category_name === selectedItem?.category) : null;
                  
                  if (!selectedCat) return null;
                  
                  const remaining = Number(selectedCat?.remaining_amount || 0);
                  const allocated = Number(selectedCat?.allocated_amount || 0);
                  const totalAmount = cashAdvanceForm.breakdown.reduce((sum: number, item: any) => sum + (parseFloat(item.amount) || 0), 0);
                  
                  if (totalAmount === 0) return null;
                  
                  const isOutOfBudget = remaining < totalAmount;
                  const isLowBudget = remaining >= totalAmount && remaining > 0 && remaining < (allocated * 0.2);
                  
                  if (isOutOfBudget) {
                    return (
                      <div className="px-4 py-3 rounded-xl border border-red-300 bg-red-50 flex items-center gap-2">
                        <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-red-700 font-medium">Out of Budget</span>
                      </div>
                    );
                  }
                  
                  if (isLowBudget) {
                    return (
                      <div className="px-4 py-3 rounded-xl border border-amber-300 bg-amber-50 flex items-center gap-2">
                        <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span className="text-amber-700 font-medium">Budget Running Low</span>
                      </div>
                    );
                  }
                  
                  return (
                    <div className="px-4 py-3 rounded-xl border border-emerald-300 bg-emerald-50 flex items-center gap-2">
                      <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-emerald-700 font-medium">Within Budget</span>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate('/tracker')}
              className="btn-secondary px-8"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary px-8 flex-1"
            >
              {submitting ? 'Submitting...' : 'Cash Advance'}
            </button>
          </div>
        </form>
      )}

      {/* Liquidation Form */}
      {activeTab === 'liquidation' && (
        <form onSubmit={handleSubmitLiquidation} className="panel max-w-4xl">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <svg className="w-6 h-6 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            Liquidate Cash Advance
          </h2>

          {/* Select Cash Advance */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">Select Cash Advance *</label>
            {cashAdvances.length === 0 ? (
              <div className="rounded-xl border border-amber-300/40 bg-amber-50/50 px-4 py-3 text-sm text-amber-700">
                No outstanding cash advances to liquidate.
              </div>
            ) : (
              <select
                required
                value={liquidationForm.advance_id}
                onChange={(e) => {
                  const advance = cashAdvances.find(a => a.id === e.target.value);
                  setSelectedAdvance(advance || null);
                  setLiquidationForm(prev => ({ ...prev, advance_id: e.target.value, amount_spent: '' }));
                }}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
              >
                <option value="">Select outstanding cash advance...</option>
                {cashAdvances.map(advance => (
                  <option key={advance.id} value={advance.id}>
                    {advance.advance_code} — Balance: {formatMoney(advance.balance)} — {advance.purpose}
                  </option>
                ))}
              </select>
            )}
          </div>

          {selectedAdvance && (
            <>
              {/* Advance summary */}
              <div className="mb-6 grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-accent)] p-4 text-center">
                  <p className="text-xs uppercase tracking-wider text-[var(--role-text)]/50 mb-1">Original Advance</p>
                  <p className="text-lg font-bold text-[var(--role-text)]">{formatMoney(selectedAdvance.amount_issued)}</p>
                </div>
                <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-accent)] p-4 text-center">
                  <p className="text-xs uppercase tracking-wider text-[var(--role-text)]/50 mb-1">Already Liquidated</p>
                  <p className="text-lg font-bold text-[var(--role-text)]">{formatMoney(selectedAdvance.amount_issued - selectedAdvance.balance)}</p>
                </div>
                <div className="rounded-xl border border-emerald-400/30 bg-emerald-50/50 p-4 text-center">
                  <p className="text-xs uppercase tracking-wider text-emerald-600/70 mb-1">Remaining Balance</p>
                  <p className="text-lg font-bold text-emerald-700">{formatMoney(selectedAdvance.balance)}</p>
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium mb-2">Amount Spent *</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--role-text)]/50 text-sm">₱</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={Number(selectedAdvance.balance || 0)}
                    value={liquidationForm.amount_spent}
                    onChange={(e) => setLiquidationForm(prev => ({ ...prev, amount_spent: e.target.value }))}
                    className="w-full pl-8 pr-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
                    required
                  />
                </div>
                {(() => {
                  const amountSpent = parseFloat(String(liquidationForm.amount_spent || '0')) || 0;
                  if (!amountSpent) return null;
                  const remaining = Math.max(0, Number(selectedAdvance.balance || 0) - amountSpent);
                  return (
                    <div className="mt-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-accent)] px-4 py-3 text-sm">
                      Remaining balance after this submission: <span className="font-semibold">{formatMoney(remaining)}</span>
                    </div>
                  );
                })()}
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium mb-2">Remarks (Optional)</label>
                <textarea
                  value={liquidationForm.remarks}
                  onChange={(e) => setLiquidationForm(prev => ({ ...prev, remarks: e.target.value }))}
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
                  placeholder="Add notes for accounting (e.g., where receipts are, explanation, etc.)"
                />
              </div>
            </>
          )}

          {/* Supporting Documents */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-3">Receipts / Supporting Documents</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              {liquidationForm.attachments.map((file, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-[var(--role-accent)] border border-[var(--role-border)]">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <svg className="w-5 h-5 text-[var(--role-primary)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm truncate">{file.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const newAtts = liquidationForm.attachments.filter((_, i) => i !== idx);
                      setLiquidationForm(prev => ({ ...prev, attachments: newAtts }));
                    }}
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
                    const files = Array.from(e.target.files);
                    setLiquidationForm(prev => ({ ...prev, attachments: [...prev.attachments, ...files] }));
                  }
                }}
                className="hidden"
                id="liquidation-attachments"
              />
              <label htmlFor="liquidation-attachments" className="cursor-pointer">
                <svg className="w-10 h-10 mx-auto mb-2 text-[var(--role-text)]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-[var(--role-text)]/60">Click to add receipts or documents</p>
              </label>
            </div>
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={() => navigate('/tracker')} className="btn-secondary px-8">Cancel</button>
            <button
              type="submit"
              disabled={submitting || !selectedAdvance}
              className="btn-primary px-8 flex-1"
            >
              {submitting ? 'Submitting...' : 'Submit Liquidation'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default NewRequestForm;
