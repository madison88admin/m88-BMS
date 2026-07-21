import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';
import PageSkeleton from '../components/Skeleton';
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
  name: string;
}

interface CashAdvance {
  id: string;
  request_id?: string | null;
  advance_code: string;
  amount_issued: number;
  balance: number;
  purpose: string;
}

interface LiquidationCategoryItem {
  category_id: string;
  category_name: string;
  original_amount: number;
  item_label: string;
  amount_spent: string;
  attachments: File[];
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
  const [reimbursementMainCategory, setReimbursementMainCategory] = useState('');
  const [cashAdvanceMainCategory, setCashAdvanceMainCategory] = useState('');

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

    const response = await api.post('/api/upload', formData);

    return response.data;
  };

  const uploadFiles = async (files: File[]) => {
    const attachments: any[] = [];
    for (const file of files) {
      const uploaded = await uploadSupportingFile(file);
      attachments.push({
        file_name: uploaded.file_name,
        file_url: uploaded.file_url,
        attachment_type: uploaded.attachment_type || 'receipt',
        attachment_scope: 'request'
      });
    }
    return attachments;
  };

  // Fetch cash advance request details and build category breakdown
  const fetchAndBuildCategoryBreakdown = async (advanceId: string) => {
    try {
      const advance = cashAdvances.find(a => a.id === advanceId);
      if (!advance || !advance.request_id) {
        setLiquidationForm(prev => ({ ...prev, categoryItems: [] }));
        return;
      }

      // Fetch the original cash advance request details
      const res = await api.get(`/api/requests/${advance.request_id}`);
      const request = res.data;

      // Build itemized breakdown from request metadata items or request items
      const requestItems = Array.isArray(request.items)
        ? request.items
        : Array.isArray(request.metadata?.items)
          ? request.metadata.items
          : [];

      // Store the cash advance's category for new items
      const caCategoryId = request.category_id || request.metadata?.category_id || '';
      const caCategoryName = request.category || request.metadata?.category || request.metadata?.main_category || '';
      setLiquidationCategory({ category_id: caCategoryId, category_name: caCategoryName });

      const breakdown = requestItems.map((item: any) => ({
        category_id: item.category_id || caCategoryId,
        category_name: item.category_name || item.category || item.main_category || caCategoryName || 'Uncategorized',
        original_amount: parseFloat(item.amount || 0) || 0,
        item_label: item.item_name || item.item || item.description || 'Item'
      }));

      // Initialize liquidation category items per original request item
      const categoryItems: LiquidationCategoryItem[] = breakdown.map((entry: any) => ({
        category_id: entry.category_id,
        category_name: entry.category_name,
        original_amount: entry.original_amount,
        item_label: entry.item_label,
        amount_spent: '',
        attachments: []
      }));
      setLiquidationForm(prev => ({ ...prev, categoryItems }));
    } catch (err) {
      console.error('Error fetching cash advance details:', err);
      toast.error('Failed to load cash advance details');
      setLiquidationForm(prev => ({ ...prev, categoryItems: [] }));
    }
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
    currency: 'PHP' as 'PHP' | 'USD' | 'IDR',
    items: [
      { item: '', amount: '' }
    ] as Array<{
      item: string;
      amount: string;
    }>,
    attachments: [] as File[]
  });

  // Cash Advance Form
  const [cashAdvanceForm, setCashAdvanceForm] = useState({
    advance_type: 'Travel',
    department_id: '',
    main_category: '',
    item_name: '',
    amount: '',
    currency: 'PHP' as 'PHP' | 'USD' | 'IDR',
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
    remarks: '',
    categoryItems: [] as LiquidationCategoryItem[]
  });
  const [liquidationCategory, setLiquidationCategory] = useState<{ category_id: string; category_name: string }>({ category_id: '', category_name: '' });

  // Load drafts on mount
  useEffect(() => {
    const rDraft = localStorage.getItem('reimbursement_draft');
    if (rDraft) {
      try {
        const parsed = JSON.parse(rDraft);
        setReimbursementForm((prev: any) => ({ ...prev, ...parsed }));
      } catch (e) { /* invalid draft, skip */ }
    }

    const cDraft = localStorage.getItem('cash_advance_draft');
    if (cDraft) {
      try {
        const parsed = JSON.parse(cDraft);
        setCashAdvanceForm((prev: any) => ({ ...prev, ...parsed }));
      } catch (e) { /* invalid draft, skip */ }
    }

    const lDraft = localStorage.getItem('liquidation_draft');
    if (lDraft) {
      try {
        const parsed = JSON.parse(lDraft);
        setLiquidationForm((prev: any) => ({
          ...prev,
          advance_id: parsed.advance_id || '',
          remarks: parsed.remarks || '',
          categoryItems: []
        }));
      } catch (e) { /* invalid draft, skip */ }
    }
  }, []);

  // Save drafts when forms change
  useEffect(() => {
    // Save whenever there is substantial content
    const hasContent = reimbursementForm.items.some(i => i.item && i.amount) || reimbursementForm.business_purpose;
    if (hasContent) {
      localStorage.setItem('reimbursement_draft', JSON.stringify(reimbursementForm));
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
      localStorage.setItem('cash_advance_draft', JSON.stringify(cashAdvanceForm));
    }
  }, [cashAdvanceForm]);

  useEffect(() => {
    const hasDraft = Boolean(liquidationForm.advance_id);
    if (hasDraft) {
      const { categoryItems, ...rest } = liquidationForm;
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
          api.get('/api/budget/cost-centers')
        ]);

        setDepartments(departmentsRes.data || []);
        // Only show categories that belong to the user's department
        try {
          const expenseCacheRaw = localStorage.getItem('prefetch_expense_categories');
          const expenseCache = expenseCacheRaw ? JSON.parse(expenseCacheRaw).data : null;
          if (expenseCache && userData) {
            const { filterCategoriesForUser } = await import('../utils/budgetVisibility');
            const deptName = departmentsRes.data?.find((d: any) => d.id === userData.department_id)?.name || '';
            setCategories(filterCategoriesForUser(categoriesRes.data || [], userData, deptName));
          } else {
            setCategories(categoriesRes.data || []);
          }
        } catch (err) {
          setCategories(categoriesRes.data || []);
        }
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

        // Initialize department if user has one (as default, but user can change it)
        if (userData.department_id) {
          setReimbursementForm(prev => prev.department_id ? prev : ({ ...prev, department_id: userData.department_id }));
          setCashAdvanceForm(prev => prev.department_id ? prev : ({ ...prev, department_id: userData.department_id }));
        } else if (departmentsRes.data?.length > 0) {
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

  }, [navigate, initialAdvanceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh official list when tab changes (separate from init to avoid full reload)
  useEffect(() => {
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
  }, [activeTab]);

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
          api.get('/api/budget/cost-centers')
        ]);

        const categoriesData = categoriesRes.data || [];
        const costCentersData = costCentersRes.data || [];

        try {
          const expenseCacheRaw = localStorage.getItem('prefetch_expense_categories');
          const expenseCache = expenseCacheRaw ? JSON.parse(expenseCacheRaw).data : null;
          if (expenseCache && user) {
            const { filterCategoriesForUser } = await import('../utils/budgetVisibility');
            const deptName = departments.find((d: any) => d.id === targetDeptId)?.name || '';
            setCategories(filterCategoriesForUser(categoriesData || [], user, deptName));
          } else {
            setCategories(categoriesData);
          }
        } catch (err) {
          setCategories(categoriesData);
        }
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

    try {
      const totalAmount = reimbursementForm.items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
      const selectedCategory = categories.find(c => c.category_name === reimbursementForm.main_category);
      const categoryId = selectedCategory?.id || '';

      const itemsForBackend = reimbursementForm.items.map(item => {
        const selectedItem = officialList.find(off => `${off.code} | ${off.itemName}` === item.item);
        const itemCategoryId = resolveCategoryIdFromOfficialItem(selectedItem, categories) || categoryId;
        return {
          item_name: item.item,
          main_category: reimbursementForm.main_category || 'Reimbursement',
          category: selectedItem?.itemName || reimbursementForm.main_category || 'Reimbursement',
          category_id: itemCategoryId,
          amount: parseFloat(item.amount) || 0
        };
      });

      const reimbursementAttachments = reimbursementForm.attachments.length > 0
        ? await uploadFiles(reimbursementForm.attachments)
        : [];

      await api.post('/api/requests', {
        request_type: 'reimbursement',
        item_name: reimbursementForm.item_name,
        department_id: reimbursementForm.department_id,
        category: reimbursementForm.main_category || 'Reimbursement',
        category_id: categoryId,
        amount: totalAmount,
        purpose: reimbursementForm.business_purpose,
        expense_date: reimbursementForm.expense_date,
        cost_center_id: reimbursementForm.cost_center_id,
        project: reimbursementForm.project,
        priority: 'normal',
        items: itemsForBackend,
        metadata: {
          request_type: 'reimbursement',
          expense_date: reimbursementForm.expense_date,
          cost_center_id: reimbursementForm.cost_center_id || null,
          project: reimbursementForm.project || null,
          main_category: reimbursementForm.main_category || null,
          currency: reimbursementForm.currency,
        },
        attachments: reimbursementAttachments
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

    const totalAmount = cashAdvanceForm.breakdown.reduce((sum: number, item: any) => sum + (parseFloat(item.amount as string) || 0), 0);

    try {
      const selectedCategory = categories.find(c => c.category_name === cashAdvanceForm.main_category);
      const categoryId = selectedCategory?.id || '';
      const itemsForBackend = cashAdvanceForm.breakdown.map((item: any) => {
        const selectedItem = officialList.find(off => `${off.code} | ${off.itemName}` === item.item);
        const itemCategoryId = resolveCategoryIdFromOfficialItem(selectedItem, categories) || categoryId;
        return {
          item_name: item.item,
          main_category: cashAdvanceForm.main_category || 'Cash Advance',
          category: selectedItem?.itemName || cashAdvanceForm.main_category || 'Cash Advance',
          category_id: itemCategoryId,
          amount: parseFloat(item.amount) || 0
        };
      });

      const cashAdvanceAttachments = cashAdvanceForm.attachments.length > 0
        ? await uploadFiles(cashAdvanceForm.attachments)
        : [];

      await api.post('/api/requests', {
        request_type: 'cash_advance',
        item_name: cashAdvanceForm.item_name,
        department_id: cashAdvanceForm.department_id,
        category: cashAdvanceForm.main_category || 'Cash Advance',
        category_id: categoryId,
        amount: totalAmount,
        purpose: cashAdvanceForm.purpose,
        expected_liquidation_date: cashAdvanceForm.expected_liquidation_date,
        priority: 'normal',
        items: itemsForBackend,
        metadata: {
          request_type: 'cash_advance',
          main_category: cashAdvanceForm.main_category || null,
          currency: cashAdvanceForm.currency,
        },
        attachments: cashAdvanceAttachments
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

    if (liquidationForm.categoryItems.length === 0) {
      toast.error('Please select a cash advance with breakdown');
      return;
    }

    // Validate that all categories have amounts entered
    const invalidItems = liquidationForm.categoryItems.filter(item => {
      const amount = parseFloat(item.amount_spent || '0');
      return !Number.isFinite(amount) || amount <= 0;
    });

    if (invalidItems.length > 0) {
      toast.error('Please enter valid amount spent for all categories');
      return;
    }

    // Validate per-item amounts don't exceed original amounts
    const overBudgetItems = liquidationForm.categoryItems.filter(item => {
      const spent = parseFloat(item.amount_spent || '0');
      return spent > item.original_amount;
    });
    if (overBudgetItems.length > 0) {
      toast.error(`Amount spent cannot exceed the original amount for: ${overBudgetItems.map(i => i.item_label).join(', ')}`);
      return;
    }

    // Calculate total
    const totalSpent = liquidationForm.categoryItems.reduce((sum, item) => {
      return sum + (parseFloat(item.amount_spent || '0') || 0);
    }, 0);

    if (totalSpent > Number(selectedAdvance.balance || 0)) {
      toast.error(`Total amount cannot exceed the cash advance balance of ${formatMoney(Number(selectedAdvance.balance || 0))}`);
      return;
    }

    if (!selectedAdvance.request_id) {
      toast.error('Selected cash advance is missing request reference. Please contact admin.');
      return;
    }

    setSubmitting(true);

    try {
      // Process category items with their attachments
      const categoryItems = await Promise.all(
        liquidationForm.categoryItems.map(async (item) => {
          let attachments: any[] = [];
          if (item.attachments.length > 0) {
            for (const file of item.attachments) {
              try {
                const uploaded = await uploadSupportingFile(file);
                attachments.push(uploaded);
              } catch (uploadErr: any) {
                console.error('File upload error:', uploadErr);
              }
            }
          }
          return {
            category_id: item.category_id,
            category_name: item.category_name,
            amount_spent: parseFloat(item.amount_spent || '0'),
            attachments
          };
        })
      );

      await api.patch(`/api/requests/${selectedAdvance.request_id}/liquidation`, {
        cash_advance_id: selectedAdvance.id,
        amount_spent: totalSpent,
        category_items: categoryItems,
        total_amount_spent: totalSpent,
        remarks: liquidationForm.remarks
      }, {
        suppressErrorToast: true
      });

      toast.success('Liquidation submitted successfully!');
      localStorage.removeItem('liquidation_draft');
      navigate('/tracker');
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to submit liquidation'), { id: 'liquidation-submit' });
    } finally {
      setSubmitting(false);
    }
  };



  if (loading) {
    return <PageSkeleton />;
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
                  setReimbursementForm(prev => ({ ...prev, department_id: val, main_category: '', item_name: '', cost_center_id: '' }));
                  setReimbursementMainCategory('');
                }}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
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
                  return selected ? selected.name : 'Loading...';
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

          {/* Info banner for General/Dept Category */}
          {reimbursementMainCategory && (() => {
            const selectedCategory = categories.find(c => c.category_name === reimbursementMainCategory);
            const isGeneralCategory = selectedCategory?.department_id === 'All';
            return (
              <div className={`mb-4 px-4 py-3 rounded-xl border ${isGeneralCategory ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
                <p className={`text-sm ${isGeneralCategory ? 'text-blue-800' : 'text-gray-700'}`}>
                  {isGeneralCategory 
                    ? 'This expense will be charged to both your department budget and the M88 Manila General Budget.'
                    : 'This expense will be charged to your department budget only.'}
                </p>
              </div>
            );
          })()}

          {/* Remaining budget info - hidden per user request */}
          {/* {reimbursementMainCategory && (() => {
            const selectedCategory = categories.find(c => c.category_name === reimbursementMainCategory);
            const isGeneralCategory = selectedCategory?.department_id === 'All';
            const deptRemaining = selectedCategory?.remaining_amount || 0;
            return (
              <div className="mb-4 px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]">
                <p className="text-sm text-[var(--role-text)]">
                  Department Budget Remaining: <span className="font-semibold">{formatMoney(deptRemaining)}</span>
                </p>
                {isGeneralCategory && m88ManilaCostCenter && (
                  <p className="text-sm text-[var(--role-text)] mt-1">
                    M88 Manila General Budget Remaining: <span className="font-semibold">{formatMoney(m88ManilaCostCenter.remaining_amount)}</span>
                  </p>
                )}
              </div>
            );
          })()} */}

          {reimbursementMainCategory && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Sub-category / Item *</label>
              <select
                required
                value={reimbursementForm.item_name}
                onChange={(e) => setReimbursementForm(prev => ({ ...prev, item_name: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
              >
                <option value="">Select item...</option>
                {getItemsByMainCategory(reimbursementMainCategory, 'canRE').map((item) => (
                  <option key={`${item.code}-${item.itemName}`} value={`${item.code} | ${item.itemName}`}>
                    {item.itemName}
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
                  <input
                    value={item.item}
                    onChange={(e) => {
                      const newItems = [...reimbursementForm.items];
                      newItems[index].item = e.target.value;
                      setReimbursementForm(prev => ({ ...prev, items: newItems }));
                    }}
                    className="flex-1 px-3 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                    placeholder="Description of expense"
                    required
                  />
                  <div className="relative w-40">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--role-text)]/60">
                      {reimbursementForm.currency === 'USD' ? '$' : reimbursementForm.currency === 'IDR' ? 'Rp' : '₱'}
                    </span>
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
                <div className="flex items-center gap-3">
                  <select
                    value={reimbursementForm.currency}
                    onChange={(e) => setReimbursementForm(prev => ({ ...prev, currency: e.target.value as 'PHP' | 'USD' | 'IDR' }))}
                    className="px-2 py-1 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                  >
                    <option value="PHP">PHP</option>
                    <option value="USD">USD</option>
                    <option value="IDR">IDR</option>
                  </select>
                  <span className="text-xl font-bold text-emerald-600">
                    {formatMoney(reimbursementForm.items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0), reimbursementForm.currency)}
                  </span>
                </div>
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

          <div className="mb-6 rounded-xl border border-dashed border-[var(--role-border)]/40 bg-[var(--role-accent)]/50 p-4">
            <p className="text-sm font-semibold text-[var(--role-text)]/70 mb-3">Attach receipts or supporting documents for this reimbursement.</p>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label htmlFor="reimbursement-attachments" className="btn-secondary cursor-pointer">
                  Select files
                </label>
                <span className="text-sm text-[var(--role-text)]/70">Upload multiple images or PDF files.</span>
              </div>
              <input
                id="reimbursement-attachments"
                type="file"
                multiple
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (!files) return;
                  setReimbursementForm(prev => ({
                    ...prev,
                    attachments: [...prev.attachments, ...Array.from(files)]
                  }));
                  e.target.value = '';
                }}
              />
              {reimbursementForm.attachments.length > 0 && (
                <div className="grid gap-2">
                  {reimbursementForm.attachments.map((file, idx) => (
                    <div key={idx} className="flex items-center justify-between rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] px-3 py-2 text-sm">
                      <span className="truncate">{file.name}</span>
                      <button
                        type="button"
                        className="text-red-600 hover:text-red-800"
                        onClick={() => setReimbursementForm(prev => ({
                          ...prev,
                          attachments: prev.attachments.filter((_, i) => i !== idx)
                        }))}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
                  setCashAdvanceForm(prev => ({ ...prev, department_id: val, main_category: '', item_name: '', cost_center_id: '' }));
                  setCashAdvanceMainCategory('');
                }}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
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
                  return selected ? selected.name : 'Loading...';
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
                  item_name: ''
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

          {/* Info banner for General/Dept Category */}
          {cashAdvanceMainCategory && (() => {
            const selectedCategory = categories.find(c => c.category_name === cashAdvanceMainCategory);
            const isGeneralCategory = selectedCategory?.department_id === 'All';
            return (
              <div className={`mb-4 px-4 py-3 rounded-xl border ${isGeneralCategory ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
                <p className={`text-sm ${isGeneralCategory ? 'text-blue-800' : 'text-gray-700'}`}>
                  {isGeneralCategory 
                    ? 'This expense will be charged to both your department budget and the M88 Manila General Budget.'
                    : 'This expense will be charged to your department budget only.'}
                </p>
              </div>
            );
          })()}

          {/* Remaining budget info - hidden per user request */}
          {/* {cashAdvanceMainCategory && (() => {
            const selectedCategory = categories.find(c => c.category_name === cashAdvanceMainCategory);
            const isGeneralCategory = selectedCategory?.department_id === 'All';
            const deptRemaining = selectedCategory?.remaining_amount || 0;
            return (
              <div className="mb-4 px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]">
                <p className="text-sm text-[var(--role-text)]">
                  Department Budget Remaining: <span className="font-semibold">{formatMoney(deptRemaining)}</span>
                </p>
                {isGeneralCategory && m88ManilaCostCenter && (
                  <p className="text-sm text-[var(--role-text)] mt-1">
                    M88 Manila General Budget Remaining: <span className="font-semibold">{formatMoney(m88ManilaCostCenter.remaining_amount)}</span>
                  </p>
                )}
              </div>
            );
          })()} */}

          {cashAdvanceMainCategory && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Sub-category / Item *</label>
              <select
                required
                value={cashAdvanceForm.item_name}
                onChange={(e) => setCashAdvanceForm(prev => ({ ...prev, item_name: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
              >
                <option value="">Select item...</option>
                {getItemsByMainCategory(cashAdvanceMainCategory, 'canCA').map((item) => (
                  <option key={`${item.code}-${item.itemName}`} value={`${item.code} | ${item.itemName}`}>
                    {item.itemName}
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
                  <input
                    value={item.item}
                    onChange={(e) => {
                      const newBreakdown = [...cashAdvanceForm.breakdown];
                      newBreakdown[index].item = e.target.value;
                      setCashAdvanceForm(prev => ({ ...prev, breakdown: newBreakdown }));
                    }}
                    className="flex-1 px-3 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                    placeholder="Expense description"
                    required
                  />
                  <div className="relative w-40">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--role-text)]/60">
                      {cashAdvanceForm.currency === 'USD' ? '$' : cashAdvanceForm.currency === 'IDR' ? 'Rp' : '₱'}
                    </span>
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
              <div className="flex items-center gap-3">
                <select
                  value={cashAdvanceForm.currency}
                  onChange={(e) => setCashAdvanceForm(prev => ({ ...prev, currency: e.target.value as 'PHP' | 'USD' | 'IDR' }))}
                  className="px-2 py-1 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                >
                  <option value="PHP">PHP</option>
                  <option value="USD">USD</option>
                  <option value="IDR">IDR</option>
                </select>
                <span className="text-xl font-bold text-emerald-600">{formatMoney(getTotalBreakdown(), cashAdvanceForm.currency)}</span>
              </div>
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
          <div className="mb-6 rounded-xl border border-dashed border-[var(--role-border)]/40 bg-[var(--role-accent)]/50 p-4">
            <p className="text-sm font-semibold text-[var(--role-text)]/70 mb-3">Attach receipts or supporting documents for this cash advance.</p>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label htmlFor="cash-advance-attachments" className="btn-secondary cursor-pointer">
                  Select files
                </label>
                <span className="text-sm text-[var(--role-text)]/70">Upload multiple images or PDF receipts.</span>
              </div>
              <input
                id="cash-advance-attachments"
                type="file"
                multiple
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (!files) return;
                  setCashAdvanceForm(prev => ({
                    ...prev,
                    attachments: [...prev.attachments, ...Array.from(files)]
                  }));
                  e.target.value = '';
                }}
              />
              {cashAdvanceForm.attachments.length > 0 && (
                <div className="grid gap-2">
                  {cashAdvanceForm.attachments.map((file, idx) => (
                    <div key={idx} className="flex items-center justify-between rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] px-3 py-2 text-sm">
                      <span className="truncate">{file.name}</span>
                      <button
                        type="button"
                        className="text-red-600 hover:text-red-800"
                        onClick={() => setCashAdvanceForm(prev => ({
                          ...prev,
                          attachments: prev.attachments.filter((_, i) => i !== idx)
                        }))}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
                  setLiquidationForm(prev => ({ ...prev, advance_id: e.target.value }));
                  if (e.target.value) {
                    fetchAndBuildCategoryBreakdown(e.target.value);
                  }
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

              {/* Estimated Breakdown with Amount Spent and Receipts */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium">Estimated Breakdown</label>
                  <button
                    type="button"
                    className="btn-secondary !py-1 !px-3 text-xs"
                    onClick={() => {
                      setLiquidationForm(prev => ({
                        ...prev,
                        categoryItems: [...prev.categoryItems, {
                          category_id: liquidationCategory.category_id,
                          category_name: liquidationCategory.category_name,
                          original_amount: 0,
                          item_label: '',
                          amount_spent: '',
                          attachments: []
                        } as LiquidationCategoryItem]
                      }));
                    }}
                  >
                    + Add Item
                  </button>
                </div>
                {liquidationForm.categoryItems.length === 0 ? (
                  <div className="rounded-xl border border-amber-300/40 bg-amber-50/50 px-4 py-3 text-sm text-amber-700">
                    Select a cash advance to see the estimated breakdown, or click "Add Item" to add manually.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {liquidationForm.categoryItems.map((catItem, idx) => (
                      <div key={idx} className="rounded-xl border border-[var(--role-border)] bg-[var(--role-accent)] p-4">
                        <div className="mb-3 flex items-start justify-between">
                          <div className="flex-1">
                            <input
                              type="text"
                              placeholder="Item name (e.g., Laptop)"
                              value={catItem.item_label}
                              onChange={(e) => {
                                const newItems = [...liquidationForm.categoryItems];
                                newItems[idx].item_label = e.target.value;
                                setLiquidationForm(prev => ({ ...prev, categoryItems: newItems }));
                              }}
                              onKeyDown={(e) => e.stopPropagation()}
                              className="w-full px-3 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm font-semibold"
                            />
                            <p className="text-xs uppercase tracking-[0.12em] text-[var(--role-text)]/50 mt-1">Category</p>
                            {catItem.category_name ? (
                              <p className="text-sm text-[var(--role-text)]/70">{catItem.category_name}</p>
                            ) : (
                              <select
                                value={catItem.category_id}
                                onChange={(e) => {
                                  const newItems = [...liquidationForm.categoryItems];
                                  newItems[idx].category_id = e.target.value;
                                  const selectedOpt = e.target.options[e.target.selectedIndex];
                                  newItems[idx].category_name = selectedOpt?.text || '';
                                  setLiquidationForm(prev => ({ ...prev, categoryItems: newItems }));
                                }}
                                className="mt-1 w-full px-3 py-1.5 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                              >
                                <option value="">Select category</option>
                                {categories.map((cat: any) => (
                                  <option key={cat.id} value={cat.id}>{cat.category_name}</option>
                                ))}
                              </select>
                            )}
                            {catItem.original_amount > 0 && (
                              <p className="text-sm text-[var(--role-text)]/70 mt-2">
                                Original Amount: <span className="font-semibold">{formatMoney(catItem.original_amount)}</span>
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            className="p-1 text-red-500 hover:bg-red-50 rounded-lg transition-colors ml-2"
                            onClick={() => {
                              const newItems = liquidationForm.categoryItems.filter((_, i) => i !== idx);
                              setLiquidationForm(prev => ({ ...prev, categoryItems: newItems }));
                            }}
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Amount Spent */}
                          <div>
                            <label className="block text-xs font-medium text-[var(--role-text)]/70 mb-1">Amount Spent *</label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--role-text)]/50 text-sm">₱</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                max={catItem.original_amount > 0 ? catItem.original_amount : undefined}
                                value={catItem.amount_spent}
                                onChange={(e) => {
                                  const newItems = [...liquidationForm.categoryItems];
                                  newItems[idx].amount_spent = e.target.value;
                                  setLiquidationForm(prev => ({ ...prev, categoryItems: newItems }));
                                }}
                                className="w-full pl-8 pr-3 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                                required
                              />
                            </div>
                          </div>

                          {/* Receipts */}
                          <div>
                            <label className="block text-xs font-medium text-[var(--role-text)]/70 mb-1">Receipts</label>
                            <button
                              type="button"
                              onClick={() => {
                                const input = document.createElement('input');
                                input.type = 'file';
                                input.multiple = true;
                                input.accept = 'image/*,.pdf';
                                input.onchange = (e: any) => {
                                  if (e.target.files) {
                                    const newItems = [...liquidationForm.categoryItems];
                                    newItems[idx].attachments = [...newItems[idx].attachments, ...Array.from(e.target.files) as File[]];
                                    setLiquidationForm(prev => ({ ...prev, categoryItems: newItems }));
                                  }
                                };
                                input.click();
                              }}
                              className="w-full px-3 py-2 rounded-lg border border-dashed border-[var(--role-border)] bg-[var(--role-surface)]/50 text-xs text-[var(--role-text)]/60 hover:bg-[var(--role-primary)]/5 transition-colors"
                            >
                              {catItem.attachments.length === 0 ? 'Add receipts' : `${catItem.attachments.length} file(s)`}
                            </button>
                          </div>
                        </div>

                        {/* Display attached files */}
                        {catItem.attachments.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-[var(--role-border)]/50">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {catItem.attachments.map((file, fileIdx) => (
                                <div key={fileIdx} className="flex items-center justify-between p-2 rounded-lg bg-[var(--role-surface)] border border-[var(--role-border)]">
                                  <span className="text-xs text-[var(--role-text)]/70 truncate">{file.name}</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const newItems = [...liquidationForm.categoryItems];
                                      newItems[idx].attachments = newItems[idx].attachments.filter((_, i) => i !== fileIdx);
                                      setLiquidationForm(prev => ({ ...prev, categoryItems: newItems }));
                                    }}
                                    className="text-red-500 hover:text-red-700 ml-2"
                                  >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    
                    {/* Total Amount */}
                    {liquidationForm.categoryItems.length > 0 && (
                      <div className="rounded-xl bg-emerald-50/50 border border-emerald-200 p-4">
                        <div className="flex justify-between items-center">
                          <span className="font-semibold text-emerald-900">Total Amount to be Liquidated:</span>
                          <span className="text-2xl font-bold text-emerald-700">
                            {formatMoney(
                              liquidationForm.categoryItems.reduce((sum, item) => {
                                const amount = parseFloat(item.amount_spent || '0') || 0;
                                return sum + amount;
                              }, 0)
                            )}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium mb-2">Remarks (Optional)</label>
                <textarea
                  value={liquidationForm.remarks}
                  onChange={(e) => setLiquidationForm(prev => ({ ...prev, remarks: e.target.value }))}
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
                  placeholder="Add notes for accounting (e.g., explanation, notes, etc.)"
                />
              </div>
            </>
          )}

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
