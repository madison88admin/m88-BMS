import express from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { supabase } from '../utils/supabase';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { getAccessibleDepartmentIdsForUser, getLatestConfiguredFiscalYear } from '../utils/fiscal';
import { resolveOfficialExpenseList } from '../utils/expenseCategories';

const router = express.Router();
const normalizeDepartmentName = (value: string) => String(value || '').trim();
const normalizeDepartmentKey = (value: string) => normalizeDepartmentName(value).toLowerCase();
const getDepartmentFilterKey = (department: { name?: string; fiscal_year?: number }) =>
  `${normalizeDepartmentKey(String(department?.name || ''))}::${department?.fiscal_year ?? ''}`;
const LEGACY_TO_CANONICAL_DEPARTMENT: Record<string, string> = {
  m88it: 'IT Department',
  m88purchasing: 'Purchasing Department',
  m88planning: 'Planning Department',
  m88logistics: 'Logistics Department',
  m88hr: 'HR Department',
  m88accounting: 'Finance Department',
  m88admin: 'Admin Department',
  'accounting department': 'Finance Department'
};
const toCanonicalDepartmentName = (value: string) => {
  const normalizedValue = normalizeDepartmentName(value);
  if (!normalizedValue) return '';
  return LEGACY_TO_CANONICAL_DEPARTMENT[normalizeDepartmentKey(normalizedValue)] || normalizedValue;
};

const appendReportRelations = async (rows: any[]) => {
  if (!rows.length) return rows;

  const employeeIds = Array.from(new Set(rows.map((row) => row.employee_id).filter(Boolean)));
  const departmentIds = Array.from(new Set(rows.map((row) => row.department_id).filter(Boolean)));

  const [usersResult, departmentsResult] = await Promise.all([
    employeeIds.length
      ? supabase.from('users').select('id, name').in('id', employeeIds)
      : { data: [] as any[], error: null },
    departmentIds.length
      ? supabase.from('departments').select('id, name, fiscal_year').in('id', departmentIds)
      : { data: [] as any[], error: null }
  ]);

  if (usersResult.error) throw usersResult.error;
  if (departmentsResult.error) throw departmentsResult.error;

  const usersById = new Map((usersResult.data || []).map((user: any) => [user.id, { name: user.name }]));
  const departmentsById = new Map(
    (departmentsResult.data || []).map((department: any) => [
      department.id,
      { name: department.name, fiscal_year: department.fiscal_year }
    ])
  );

  return rows.map((row) => ({
    ...row,
    users: usersById.get(row.employee_id) || null,
    departments: departmentsById.get(row.department_id) || null
  }));
};

// GET /api/reports/filter-options
router.get('/filter-options', authenticate, authorize('accounting', 'admin'), async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  let requestQuery = supabase
    .from('expense_requests')
    .select('category, department_id, fiscal_year')
    .order('category', { ascending: true });

  let departmentQuery = supabase
    .from('departments')
    .select('id, name, fiscal_year')
    .order('name', { ascending: true });

  if (req.user.role === 'employee' || req.user.role === 'manager' || req.user.role === 'supervisor') {
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
    if (req.user.role === 'employee' || req.user.role === 'manager') {
      const activeDepartmentId = accessibleDepartmentIds[0] || req.user.department_id;
      requestQuery = requestQuery.eq('department_id', activeDepartmentId);
      departmentQuery = departmentQuery.eq('id', activeDepartmentId);
    } else {
      requestQuery = accessibleDepartmentIds.length
        ? requestQuery.in('department_id', accessibleDepartmentIds)
        : requestQuery.eq('department_id', req.user.department_id);
      departmentQuery = accessibleDepartmentIds.length
        ? departmentQuery.in('id', accessibleDepartmentIds)
        : departmentQuery.eq('id', req.user.department_id);
    }
  }

  const [{ data: requestRows, error: requestError }, { data: departments, error: departmentError }] = await Promise.all([
    requestQuery,
    departmentQuery
  ]);

  if (requestError) return res.status(400).json({ error: requestError });
  if (departmentError) return res.status(400).json({ error: departmentError });

  const uniqueDepartments = new Map<string, any>();
  (departments || []).forEach((department: any) => {
    const canonicalName = toCanonicalDepartmentName(department.name);
    const key = getDepartmentFilterKey({ name: canonicalName, fiscal_year: department.fiscal_year });
    const current = uniqueDepartments.get(key);

    if (!current || String(department.id) < String(current.id)) {
      uniqueDepartments.set(key, {
        ...department,
        name: canonicalName
      });
    }
  });

  const categories = Array.from(
    new Set(
      (requestRows || [])
        .map((row: any) => String(row.category || '').trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));

  res.json({
    departments: Array.from(uniqueDepartments.values()).sort((left: any, right: any) => left.name.localeCompare(right.name)),
    categories,
    fiscal_years: Array.from(
      new Set(
        [
          ...(requestRows || []).map((row: any) => Number(row.fiscal_year || 0)),
          ...(departments || []).map((department: any) => Number(department.fiscal_year || 0))
        ].filter((year) => Number.isInteger(year) && year > 0)
      )
    ).sort((left, right) => right - left)
  });
});

// GET /api/reports/summary?dept=&from=&to=&archived=false&format=json|pdf|excel
router.get('/summary', authenticate, async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  const { dept, from, to, status, category, fiscal_year, archived = 'false', format } = req.query;
  let query = supabase.from('expense_requests').select('*');
  if (req.user.role === 'employee' || req.user.role === 'manager') query = query.eq('employee_id', req.user.id);
  else if (req.user.role === 'supervisor') {
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
    query = accessibleDepartmentIds.length
      ? query.in('department_id', accessibleDepartmentIds)
      : query.eq('department_id', req.user.department_id);
  }
  if (dept) query = query.eq('department_id', dept);
  if (fiscal_year) query = query.eq('fiscal_year', Number(fiscal_year));
  if (from) query = query.gte('submitted_at', from);
  if (to) query = query.lte('submitted_at', to);
  if (status) query = query.eq('status', status);
  if (category) query = query.eq('category', category);
  if (archived === 'true') query = query.eq('archived', true);
  else if (archived === 'false') query = query.eq('archived', false);
  const { data: requestRows, error } = await query;
  if (error) return res.status(400).json({ error });
  const requests = await appendReportRelations(requestRows || []);

  const summary = {
    total_requests: requests.length,
    approved: requests.filter(r => r.status === 'approved' || r.status === 'released').length,
    rejected: requests.filter(r => r.status === 'rejected').length,
    total_amount: requests.reduce((sum, r) => sum + parseFloat(r.amount), 0),
    by_status: requests.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {}),
    by_category: requests.reduce((acc, r) => {
      const cat = r.category || 'Uncategorized';
      acc[cat] = (acc[cat] || 0) + parseFloat(r.amount);
      return acc;
    }, {})
  };

  if (format === 'pdf') {
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=summary.pdf');
    doc.pipe(res);
    doc.fontSize(20).text('Expense Summary Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Total Requests: ${summary.total_requests}`);
    doc.text(`Approved: ${summary.approved}`);
    doc.text(`Rejected: ${summary.rejected}`);
    doc.text(`Total Amount: ₱${summary.total_amount.toFixed(2)}`);
    doc.end();
  } else if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Summary');
    worksheet.columns = [
      { header: 'Metric', key: 'metric' },
      { header: 'Value', key: 'value' }
    ];
    worksheet.addRow({ metric: 'Total Requests', value: summary.total_requests });
    worksheet.addRow({ metric: 'Approved', value: summary.approved });
    worksheet.addRow({ metric: 'Rejected', value: summary.rejected });
    worksheet.addRow({ metric: 'Total Amount', value: `₱${summary.total_amount.toFixed(2)}` });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=summary.xlsx');
    await workbook.xlsx.write(res);
  } else {
    res.json(summary);
  }
});

// GET /api/reports/requests?dept=&from=&to=&archived=false&status=&category=&format=json|pdf|excel
router.get('/requests', authenticate, authorize('accounting', 'admin'), async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  const { dept, from, to, status, category, fiscal_year, archived = 'false', format } = req.query;
  let query = supabase.from('expense_requests').select('*');
  if (req.user.role === 'employee' || req.user.role === 'manager') query = query.eq('employee_id', req.user.id);
  else if (req.user.role === 'supervisor') {
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
    query = accessibleDepartmentIds.length
      ? query.in('department_id', accessibleDepartmentIds)
      : query.eq('department_id', req.user.department_id);
  }
  if (dept) query = query.eq('department_id', dept);
  if (fiscal_year) query = query.eq('fiscal_year', Number(fiscal_year));
  if (from) query = query.gte('submitted_at', from);
  if (to) query = query.lte('submitted_at', to);
  if (status) query = query.eq('status', status);
  if (category) query = query.eq('category', category);
  if (archived === 'true') query = query.eq('archived', true);
  else if (archived === 'false') query = query.eq('archived', false);
  const { data: requestRows, error } = await query;
  if (error) return res.status(400).json({ error });
  const requests = await appendReportRelations(requestRows || []);

  if (format === 'pdf') {
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=requests.pdf');
    doc.pipe(res);
    doc.fontSize(20).text('Expense Requests Report', { align: 'center' });
    doc.moveDown();
    requests.forEach((r: any) => {
      doc.fontSize(12).text(`Request: ${r.request_code} - ${r.item_name} - ₱${r.amount} - ${r.status}`);
    });
    doc.end();
  } else if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Requests');
    worksheet.columns = [
      { header: 'Request Code', key: 'request_code' },
      { header: 'Employee', key: 'employee' },
      { header: 'Department', key: 'department' },
      { header: 'Item', key: 'item_name' },
      { header: 'Amount', key: 'amount' },
      { header: 'Status', key: 'status' },
      { header: 'Submitted At', key: 'submitted_at' }
    ];
    requests.forEach((r: any) => {
      worksheet.addRow({
        request_code: r.request_code,
        employee: r.users?.name,
        department: r.departments?.name,
        item_name: r.item_name,
        amount: r.amount,
        status: r.status,
        submitted_at: r.submitted_at
      });
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=requests.xlsx');
    await workbook.xlsx.write(res);
  } else {
    res.json(requests);
  }
});

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const toNumber = (value: any) => Number.parseFloat(value ?? 0) || 0;

const formatReportMoney = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1000) {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(value);
  }
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
};

const getMonthLabel = (dateStr: string) => {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return MONTH_LABELS[d.getMonth()];
};

const ALLOWED_REPORT_DEPARTMENTS = [
  'Executive', 'Accounting', 'H.R.', 'Logistics', 'Planning', 'Purchasing', 'Costing', 'I.T.', 'Supply Chain', 'Admin', 'OJT', 'All Department'
];

const PAYROLL_CODE_TO_DEPARTMENT: Record<string, string> = {
  '66001': 'Executive',
  '66002': 'Accounting',
  '66003': 'H.R.',
  '66004': 'Logistics',
  '66005': 'Planning',
  '66006': 'Purchasing',
  '66007': 'Costing',
  '66008': 'I.T.',
  '66009': 'OJT',
  '660010': 'Supply Chain',
  '66012': 'All Department',
  '66017': 'All Department',
  '6606': 'All Department'
};

const normalizeReportDepartment = (raw: string | string[], code?: string): { department: string; scope: string; valid: boolean } => {
  const rawCode = String(code || '').trim().toUpperCase();
  if (PAYROLL_CODE_TO_DEPARTMENT[rawCode]) {
    return { department: PAYROLL_CODE_TO_DEPARTMENT[rawCode], scope: PAYROLL_CODE_TO_DEPARTMENT[rawCode] === 'All Department' ? 'Shared' : 'Department-specific', valid: true };
  }

  const values = Array.isArray(raw) ? raw : [raw];
  const mapped = values.map((value) => {
    const v = String(value || '').trim();
    if (!v || v.toLowerCase() === 'all dept' || v.toLowerCase() === 'all department' || v.toLowerCase() === 'all') return 'All Department';
    if (v.toLowerCase().includes('hr')) return 'H.R.';
    if (v.toLowerCase().includes('finance')) return 'Accounting';
    if (v.toLowerCase().includes('admin')) return 'Admin';
    if (v.toLowerCase().includes('it')) return 'I.T.';
    if (v.toLowerCase().includes('purchasing')) return 'Purchasing';
    if (v.toLowerCase().includes('planning')) return 'Planning';
    if (v.toLowerCase().includes('logistics')) return 'Logistics';
    if (v.toLowerCase().includes('costing')) return 'Costing';
    if (v.toLowerCase().includes('supply chain')) return 'Supply Chain';
    if (v.toLowerCase().includes('executive')) return 'Executive';
    if (v.toLowerCase().includes('ojt')) return 'OJT';
    return v;
  }).filter(Boolean);

  const unique = Array.from(new Set(mapped));
  const first = unique[0] || 'Unknown';
  const valid = ALLOWED_REPORT_DEPARTMENTS.includes(first);
  const scope = first === 'All Department' ? 'Shared' : 'Department-specific';
  return { department: first, scope, valid };
};

const DEPARTMENT_ORDER = ['All Department', 'Executive', 'Accounting', 'H.R.', 'Logistics', 'Planning', 'Purchasing', 'Costing', 'I.T.', 'Supply Chain', 'Admin', 'OJT'];

const getAccessibleDepartmentIds = async (reqUser: any, fiscalYear: number) => {
  if (reqUser.role === 'supervisor') {
    const ids = await getAccessibleDepartmentIdsForUser(supabase, reqUser, fiscalYear);
    return ids.length ? ids : [reqUser.department_id];
  }
  if (reqUser.role === 'employee' || reqUser.role === 'manager') {
    return [reqUser.department_id];
  }
  return null;
};

// GET /api/reports/monthly-spend-by-category?fiscal_year=2026&department_id=&months=Jan,Feb&format=json|excel
router.get('/monthly-spend-by-category', authenticate, async (req: any, res) => {
  try {
    const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
    const fiscalYear = req.query.fiscal_year ? Number(req.query.fiscal_year) : activeFiscalYear;
    const departmentId = req.query.department_id ? String(req.query.department_id) : undefined;
    const requestedMonths = req.query.months
      ? String(req.query.months).split(',').map((m) => m.trim()).filter(Boolean)
      : MONTH_LABELS;
    const months = requestedMonths.length ? requestedMonths : MONTH_LABELS;
    const monthsElapsed = months.length;

    const accessibleDepartmentIds = await getAccessibleDepartmentIds(req.user, fiscalYear);
    const allowedDepartmentIds = accessibleDepartmentIds || undefined;

    // Load all departments for name resolution
    const { data: allDepartments, error: departmentsError } = await supabase
      .from('departments')
      .select('id, name, fiscal_year');
    if (departmentsError) throw departmentsError;
    const departmentNameById = new Map((allDepartments || []).map((d: any) => [String(d.id), String(d.name || '').trim()]));

    // Master category list from the official expense list (budget expense master)
    const officialItems = await resolveOfficialExpenseList();
    const masterCategories = officialItems.map((item) => ({
      code: String(item.code || '').trim(),
      expenseGroup: String(item.category || '').trim(),
      itemName: String(item.itemName || '').trim(),
      department: Array.isArray(item.dept) ? item.dept : [item.dept]
    })).filter((item) => item.code);

    // Budget categories for the fiscal year
    let categoryQuery = supabase
      .from('budget_categories')
      .select('id, category_code, category_name, department_id, fiscal_year, budget_amount, departments!department_id(name)')
      .eq('fiscal_year', fiscalYear);
    if (departmentId) categoryQuery = categoryQuery.eq('department_id', departmentId);
    const { data: categoryRows, error: categoryError } = await categoryQuery;
    if (categoryError) throw categoryError;

    const categories = (categoryRows || []).filter((cat: any) => {
      if (!allowedDepartmentIds) return true;
      return allowedDepartmentIds.includes(String(cat.department_id));
    });
    const categoryById = new Map(categories.map((cat: any) => [cat.id, cat]));

    // Map budget categories by exact code
    const budgetByCode = new Map<string, { budgetAmount: number; departmentIds: Set<string>; names: Set<string> }>();
    categories.forEach((cat: any) => {
      const code = String(cat.category_code || '').trim().toUpperCase();
      if (!code) return;
      const existing = budgetByCode.get(code);
      if (existing) {
        existing.budgetAmount += toNumber(cat.budget_amount);
        existing.departmentIds.add(String(cat.department_id));
        existing.names.add(String(cat.category_name || '').trim());
      } else {
        budgetByCode.set(code, {
          budgetAmount: toNumber(cat.budget_amount),
          departmentIds: new Set([String(cat.department_id)]),
          names: new Set([String(cat.category_name || '').trim()])
        });
      }
    });

    // Build code to department name mapping from budget categories
    const categoryCodeToDepartmentNames = new Map<string, Set<string>>();
    categories.forEach((cat: any) => {
      const code = String(cat.category_code || '').trim().toUpperCase();
      if (!code) return;
      const deptName = departmentNameById.get(String(cat.department_id)) || cat.departments?.name || 'Unknown';
      const set = categoryCodeToDepartmentNames.get(code) || new Set<string>();
      set.add(deptName);
      categoryCodeToDepartmentNames.set(code, set);
    });

    // Direct expenses
    let directQuery = supabase
      .from('direct_expenses')
      .select('category_id, amount, expense_date, department_id, fiscal_year')
      .eq('fiscal_year', fiscalYear);
    if (departmentId) directQuery = directQuery.eq('department_id', departmentId);
    const { data: directRows, error: directError } = await directQuery;
    if (directError) throw directError;

    // Released expense requests
    let requestQuery = supabase
      .from('expense_requests')
      .select('id, category_id, amount, status, released_at, updated_at, department_id, fiscal_year')
      .eq('fiscal_year', fiscalYear)
      .eq('status', 'released')
      .not('category_id', 'is', null);
    if (departmentId) requestQuery = requestQuery.eq('department_id', departmentId);
    const { data: requestRows, error: requestError } = await requestQuery;
    if (requestError) throw requestError;

    // Liquidation items (actual transaction dates for cash advances)
    const requestIds = (requestRows || []).map((r: any) => r.id);
    let liquidationIds: string[] = [];
    let requestIdsWithLiquidation = new Set<string>();
    if (requestIds.length) {
      const { data: liquidationIdRows, error: liquidationIdError } = await supabase
        .from('request_liquidations')
        .select('id, request_id')
        .in('request_id', requestIds);
      if (liquidationIdError) throw liquidationIdError;
      liquidationIds = (liquidationIdRows || []).map((row: any) => row.id).filter(Boolean);
      requestIdsWithLiquidation = new Set((liquidationIdRows || []).map((row: any) => String(row.request_id)).filter(Boolean));
    }

    let liquidationRows: any[] = [];
    if (liquidationIds.length) {
      const { data: liqRows, error: liquidationError } = await supabase
        .from('liquidation_items')
        .select('category_id, amount, expense_date, cash_advance_id, liquidation_id')
        .in('liquidation_id', liquidationIds);
      if (liquidationError) throw liquidationError;
      liquidationRows = liqRows || [];
    }

    // Build code lookup for actual spend (category_id -> code)
    const codeByCategoryId = new Map<string, string>();
    const addCodeByCategoryId = (categoryId: string, codeFallback?: string) => {
      if (!categoryId || codeByCategoryId.has(categoryId)) return;
      const cat = categoryById.get(categoryId);
      if (cat) {
        codeByCategoryId.set(categoryId, String(cat.category_code || '').trim().toUpperCase());
      } else if (codeFallback) {
        codeByCategoryId.set(categoryId, codeFallback);
      }
    };

    (directRows || []).forEach((row: any) => addCodeByCategoryId(row.category_id));
    (requestRows || []).forEach((row: any) => addCodeByCategoryId(row.category_id));
    (liquidationRows || []).forEach((row: any) => addCodeByCategoryId(row.category_id));

    const actualsByCategoryMonth = new Map<string, Map<string, { amountSpent: number; transactionCount: number }>>();
    const addActual = (categoryId: string, dateStr: string, amount: number) => {
      const code = codeByCategoryId.get(categoryId);
      if (!code) return;
      const month = getMonthLabel(dateStr);
      if (!month || !months.includes(month)) return;

      const monthMap = actualsByCategoryMonth.get(code) || new Map<string, { amountSpent: number; transactionCount: number }>();
      const current = monthMap.get(month) || { amountSpent: 0, transactionCount: 0 };
      current.amountSpent += toNumber(amount);
      current.transactionCount += 1;
      monthMap.set(month, current);
      actualsByCategoryMonth.set(code, monthMap);
    };

    (directRows || []).forEach((row: any) => {
      if (allowedDepartmentIds && !allowedDepartmentIds.includes(String(row.department_id))) return;
      addActual(row.category_id, row.expense_date, row.amount);
    });

    (liquidationRows || []).forEach((row: any) => {
      addActual(row.category_id, row.expense_date, row.amount);
    });

    // For requests without liquidation items, use released_at as fallback
    (requestRows || []).forEach((row: any) => {
      if (allowedDepartmentIds && !allowedDepartmentIds.includes(String(row.department_id))) return;
      if (requestIdsWithLiquidation.has(String(row.id))) return;
      const dateStr = row.released_at || row.updated_at;
      if (!dateStr) return;
      addActual(row.category_id, dateStr, row.amount);
    });

    // Build category breakdown from the master list
    const categoryBreakdown = masterCategories.map((master) => {
      const code = master.code.toUpperCase();
      const budgetInfo = budgetByCode.get(code);
      const fy2026Budget = budgetInfo?.budgetAmount || 0;
      const deptNorm = normalizeReportDepartment(master.department, code);

      const monthMap = actualsByCategoryMonth.get(code) || new Map<string, { amountSpent: number; transactionCount: number }>();
      let runningTotal = 0;
      const monthly = months.map((month) => {
        const spent = monthMap.get(month)?.amountSpent || 0;
        runningTotal += spent;
        return { month, amountSpent: spent, runningTotal };
      });
      const totalSpentToDate = runningTotal;
      const percentOfBudgetUsed = fy2026Budget > 0 ? (totalSpentToDate / fy2026Budget) * 100 : null;
      const monthlyPace = fy2026Budget > 0 ? (fy2026Budget / 12) * monthsElapsed : 0;

      let paceStatus: 'On track' | 'Ahead of pace' | 'Over budget' | 'No spend' | 'Unbudgeted spend' = 'No spend';
      if (totalSpentToDate > 0) {
        if (fy2026Budget === 0) {
          paceStatus = 'Unbudgeted spend';
        } else if (totalSpentToDate > fy2026Budget) {
          paceStatus = 'Over budget';
        } else if (totalSpentToDate > monthlyPace) {
          paceStatus = 'Ahead of pace';
        } else {
          paceStatus = 'On track';
        }
      }

      return {
        code,
        expenseGroup: master.expenseGroup,
        department: deptNorm.department,
        scope: deptNorm.scope,
        validDepartment: deptNorm.valid,
        monthly,
        fy2026Budget,
        totalSpentToDate,
        percentOfBudgetUsed: percentOfBudgetUsed === null ? 'N/A (no budget)' : Math.round(percentOfBudgetUsed * 10) / 10,
        paceStatus
      };
    });

    // Group by department
    const sectionsMap = new Map<string, { department: string; scope: string; categories: any[] }>();
    categoryBreakdown.forEach((cat) => {
      const section = sectionsMap.get(cat.department) || { department: cat.department, scope: cat.scope, categories: [] };
      section.categories.push(cat);
      sectionsMap.set(cat.department, section);
    });

    const sections = Array.from(sectionsMap.values()).sort((a, b) => {
      const aIndex = DEPARTMENT_ORDER.indexOf(a.department);
      const bIndex = DEPARTMENT_ORDER.indexOf(b.department);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.department.localeCompare(b.department);
    });

    // Sort categories within each section by code
    sections.forEach((section) => {
      section.categories.sort((a: any, b: any) => a.code.localeCompare(b.code));
    });

    const topCategories = categoryBreakdown
      .filter((c) => c.totalSpentToDate > 0)
      .sort((a, b) => b.totalSpentToDate - a.totalSpentToDate)
      .slice(0, 5)
      .map((c) => ({ code: c.code, expenseGroup: c.expenseGroup, totalSpent: c.totalSpentToDate }));

    const dataGaps: string[] = [];
    const missingBudgetCodes = categoryBreakdown.filter((c) => c.fy2026Budget === 0 && c.totalSpentToDate > 0);
    if (missingBudgetCodes.length > 0) {
      dataGaps.push(`${missingBudgetCodes.length} category code(s) with spend but no FY${fiscalYear} budget: ${missingBudgetCodes.slice(0, 10).map((c) => c.code).join(', ')}${missingBudgetCodes.length > 10 ? '...' : ''}.`);
    }
    const invalidDepartmentCategories = categoryBreakdown.filter((c) => !c.validDepartment && c.department !== 'Unknown');
    if (invalidDepartmentCategories.length > 0) {
      dataGaps.push(`${invalidDepartmentCategories.length} category code(s) with invalid department mapping: ${invalidDepartmentCategories.slice(0, 10).map((c) => `${c.code} (${c.department})`).join(', ')}${invalidDepartmentCategories.length > 10 ? '...' : ''}.`);
    }
    const codesWithSpendButNoCategory = Array.from(actualsByCategoryMonth.keys()).filter((code) => !budgetByCode.has(code) && !masterCategories.some((m) => m.code.toUpperCase() === code));
    if (codesWithSpendButNoCategory.length > 0) {
      dataGaps.push(`Spending recorded for ${codesWithSpendButNoCategory.length} category code(s) not in the master list: ${codesWithSpendButNoCategory.slice(0, 10).join(', ')}${codesWithSpendButNoCategory.length > 10 ? '...' : ''}.`);
    }
    if (actualsByCategoryMonth.size === 0) dataGaps.push(`No released expenses or direct expenses recorded for fiscal year ${fiscalYear}.`);

    const allCategories = sections.flatMap((s) => s.categories);
    const aheadCategories = allCategories.filter((c: any) => c.paceStatus === 'Ahead of pace' || c.paceStatus === 'Over budget' || c.paceStatus === 'Unbudgeted spend');
    let summary = `As of ${months.join('/')}, total actual spend across ${allCategories.length} categories is ${formatReportMoney(allCategories.reduce((sum: number, c: any) => sum + c.totalSpentToDate, 0))}.`;
    if (topCategories.length > 0) {
      summary += ` Top spend category is ${topCategories[0].expenseGroup} at ${formatReportMoney(topCategories[0].totalSpent)}.`;
    }
    if (aheadCategories.length > 0) {
      summary += ` ${aheadCategories.length} categor${aheadCategories.length === 1 ? 'y is' : 'ies are'} ahead of pace, over budget, or unbudgeted.`;
    } else {
      summary += ' All categories are on track or have no spend.';
    }

    const format = String(req.query.format || '').trim().toLowerCase();
    if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Monthly Spend by Category');
      const headers = ['Code', 'Expense Group', 'Department', 'Scope', ...months, 'Total Spent', 'FY2026 Budget', '% Used', 'Pace Status'];
      worksheet.columns = headers.map((h) => ({ header: h, key: h.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, ''), width: 16 }));
      sections.forEach((section) => {
        const label = section.department === 'All Department' ? 'All Department (Shared/Company-wide)' : `Department: ${section.department}`;
        worksheet.addRow({ Code: label, ExpenseGroup: '', Department: '', Scope: section.scope });
        const sectionRow = worksheet.lastRow;
        if (sectionRow) sectionRow.font = { bold: true };
        section.categories.forEach((c: any) => {
          const row: any = {
            Code: c.code,
            ExpenseGroup: c.expenseGroup,
            Department: c.department,
            Scope: c.scope,
            TotalSpent: c.totalSpentToDate,
            FY2026Budget: c.fy2026Budget,
            Used: typeof c.percentOfBudgetUsed === 'number' ? c.percentOfBudgetUsed / 100 : null,
            PaceStatus: c.paceStatus
          };
          c.monthly.forEach((m: any) => {
            row[m.month] = m.amountSpent;
          });
          worksheet.addRow(row);
        });
        worksheet.addRow({});
      });
      worksheet.getRow(1).font = { bold: true };
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=monthly_spend_by_category_FY${fiscalYear}.xlsx`);
      await workbook.xlsx.write(res);
      return;
    }

    res.json({
      reportPeriod: `FY${fiscalYear}`,
      generatedAt: new Date().toISOString(),
      summary,
      sections,
      categoryBreakdown: allCategories,
      topCategories,
      dataGaps
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
