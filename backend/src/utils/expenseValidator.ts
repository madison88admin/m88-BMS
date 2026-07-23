
export interface ExpenseEligibility {
  allowed: boolean;
  code: string;
  category: string;
  department: string;
  canCA: boolean;
  canRE: boolean;
  reason?: string;
}

export interface ExpenseItem {
  code: string;
  itemName: string;
  category: string;
  dept: string | string[]; // 'All Dept' or specific names
  canCA: boolean;
  canRE: boolean;
  mannerOfSubmission?: 'for_submission' | 'for_upload';
}

export const OFFICIAL_EXPENSE_LIST: ExpenseItem[] = [
  // 4790 Sales
  { code: '4790', itemName: 'Sales', category: 'Sales', dept: 'All Dept', canCA: false, canRE: false },

  // 6600 Cost of Services
  { code: '66001', itemName: 'Payroll Expense Executive', category: 'Cost of Services', dept: 'All Dept', canCA: false, canRE: false },
  { code: '66002', itemName: 'Payroll Expense Accounting', category: 'Cost of Services', dept: 'All Dept', canCA: false, canRE: false },
  { code: '66003', itemName: 'Payroll Expense H.R.', category: 'Cost of Services', dept: 'All Dept', canCA: false, canRE: false },
  { code: '66004', itemName: 'Payroll Expense Logistics', category: 'Cost of Services', dept: 'All Dept', canCA: false, canRE: false },
  { code: '66005', itemName: 'Payroll Expense Planning', category: 'Cost of Services', dept: 'All Dept', canCA: false, canRE: false },
  { code: '66006', itemName: 'Payroll Expense Purchasing', category: 'Cost of Services', dept: 'All Dept', canCA: false, canRE: false },
  { code: '66007', itemName: 'Payroll Expense Costing', category: 'Cost of Services', dept: 'All Dept', canCA: false, canRE: false },
  { code: '66008', itemName: 'Payroll Expense I.T.', category: 'Cost of Services', dept: 'All Dept', canCA: false, canRE: false },
  { code: '66009', itemName: 'Payroll Expense OJT', category: 'Cost of Services', dept: 'All Dept', canCA: false, canRE: false },
  { code: '660010', itemName: 'Payroll Expense Supply Chain', category: 'Cost of Services', dept: 'All Dept', canCA: false, canRE: false },
  { code: '66012', itemName: 'Phil. Health Insurance', category: 'Cost of Services', dept: 'All Dept', canCA: false, canRE: false },
  { code: '66017', itemName: 'Home Development Company', category: 'Cost of Services', dept: 'All Dept', canCA: false, canRE: false },
  { code: '6606', itemName: 'Social Security Company', category: 'Cost of Services', dept: 'All Dept', canCA: false, canRE: false },

  // 6010 Advertising and Promotion
  { code: '6010.1', itemName: 'Zoom', category: 'Advertising and Promotion', dept: 'HR Department', canCA: true, canRE: true },
  { code: '6010.2', itemName: 'LinkedIn', category: 'Advertising and Promotion', dept: 'HR Department', canCA: true, canRE: true },
  { code: '6010.3', itemName: 'Advertising Other', category: 'Advertising and Promotion', dept: 'HR Department', canCA: true, canRE: true },

  // 6020 Automobile Expense
  { code: '6020.1', itemName: 'Automobile Fuel', category: 'Automobile Expense', dept: 'All Dept', canCA: true, canRE: true },
  { code: '6020.2', itemName: 'Parking Fee', category: 'Automobile Expense', dept: 'All Dept', canCA: true, canRE: true },
  { code: '6020.3', itemName: 'Toll Expense', category: 'Automobile Expense', dept: 'All Dept', canCA: true, canRE: true },
  { code: '6020.4', itemName: 'Automobile Repairs', category: 'Automobile Expense', dept: 'Admin Department', canCA: true, canRE: true },
  { code: '6020.5', itemName: 'Car Insurance', category: 'Automobile Expense', dept: 'Admin Department', canCA: false, canRE: false },
  { code: '6020.6', itemName: 'Automobile Expenses-Registration', category: 'Automobile Expense', dept: 'Admin Department', canCA: false, canRE: false },

  // 6040 Bank Service Charges
  { code: '6040', itemName: 'Bank Service Charges', category: 'Bank Service Charges', dept: 'Finance Department', canCA: false, canRE: false },

  // 6041 Realized Forex Gain/Loss
  { code: '6041', itemName: 'Realized Forex Gain/Loss', category: 'Realized Forex Gain/Loss', dept: 'Finance Department', canCA: false, canRE: false },

  // 6170 Computer and Internet Expenses
  { code: '6170', itemName: 'Computer and Internet Expenses', category: 'Computer and Internet Expenses', dept: 'IT Department', canCA: true, canRE: true },

  // 6240 Depreciation Expense
  { code: '6240', itemName: 'Depreciation Expense', category: 'Depreciation Expense', dept: 'Finance Department', canCA: false, canRE: false },

  // 6330 Insurance Expense
  { code: '6330', itemName: 'Insurance Expense', category: 'Insurance Expense', dept: 'Admin Department', canCA: false, canRE: false },

  // 6340 Interest Expense
  { code: '6340', itemName: 'Interest Expense', category: 'Interest Expense', dept: 'Finance Department', canCA: false, canRE: false },

  // 6350 Taxes & Licenses
  { code: '6351', itemName: 'Business Tax/Licenses', category: 'Taxes & Licenses', dept: 'Finance Department', canCA: true, canRE: true },
  { code: '6352', itemName: 'Income Tax', category: 'Taxes & Licenses', dept: 'Finance Department', canCA: false, canRE: false },

  // 6430 Meals and Entertainment
  { code: '6430.1', itemName: 'Birthday Celebrations', category: 'Meals and Entertainment', dept: 'All Dept', canCA: true, canRE: true },
  { code: '6430.2', itemName: 'Training Meal', category: 'Meals and Entertainment', dept: 'All Dept', canCA: true, canRE: true },
  { code: '6430.5', itemName: 'Valentine\'s Day Celebration', category: 'Meals and Entertainment', dept: 'HR Department', canCA: true, canRE: true },
  { code: '6430.7', itemName: 'Representation', category: 'Meals and Entertainment', dept: 'All Dept', canCA: true, canRE: true },
  { code: '6430.8', itemName: 'Meals and Entertainment - Other (company events)', category: 'Meals and Entertainment', dept: 'All Dept', canCA: true, canRE: true },

  // 6490 Office Supplies
  { code: '6490.1', itemName: 'Office Stationery & Supplies', category: 'Office Supplies', dept: 'All Dept', canCA: true, canRE: true },
  { code: '6490.2', itemName: 'Consumable & Pantry/Cleaning Supplies', category: 'Office Supplies', dept: 'All Dept', canCA: true, canRE: true },
  { code: '6490.3', itemName: 'Tools & Equipment', category: 'Office Supplies', dept: 'HR Department', canCA: true, canRE: true },
  { code: '6490.4', itemName: 'Fire Extinguisher', category: 'Office Supplies', dept: 'HR Department', canCA: true, canRE: true },
  { code: '6490.5', itemName: 'Office Supplies Other (Furnitures)', category: 'Office Supplies', dept: 'HR Department', canCA: true, canRE: true },

  // 6500 Medical Records and Supplies
  { code: '6501', itemName: 'Medical Expenses', category: 'Medical Records and Supplies', dept: 'All Dept', canCA: true, canRE: true },

  // 6650 Postage and Delivery
  { code: '6650', itemName: 'Postage and Delivery', category: 'Postage and Delivery', dept: 'All Dept', canCA: true, canRE: true },

  // 6670 Professional Fees
  { code: '6670.01', itemName: 'Professional Fees - Accounting', category: 'Professional Fees', dept: 'Finance Department', canCA: false, canRE: false },
  { code: '6670.08', itemName: 'BIR Compliance Service', category: 'Professional Fees', dept: 'Finance Department', canCA: false, canRE: false },
  { code: '6670.1', itemName: 'DOLE Establishment Report & 13th Month', category: 'Professional Fees', dept: 'Finance Department', canCA: false, canRE: false },
  { code: '6670.11', itemName: 'Filing of Annual GIS', category: 'Professional Fees', dept: 'Finance Department', canCA: true, canRE: true },
  { code: '6670.12', itemName: 'Fire Safety Inspection Certificate', category: 'Professional Fees', dept: 'Finance Department', canCA: false, canRE: false },
  { code: '6670.15', itemName: 'Nominee Directors Service', category: 'Professional Fees', dept: 'Finance Department', canCA: true, canRE: true },
  { code: '6670.17', itemName: 'Posted Transactions', category: 'Professional Fees', dept: 'Finance Department', canCA: true, canRE: true },
  { code: '6670.18', itemName: 'Posted Transactions Adjustment', category: 'Professional Fees', dept: 'Finance Department', canCA: false, canRE: false },
  { code: '6670.24', itemName: 'Notarization Fee', category: 'Professional Fees', dept: 'Finance Department', canCA: false, canRE: false },

  // 6710 Rent Expense
  { code: '6711', itemName: 'Office Rent Expense', category: 'Rent Expense', dept: 'Admin Department', canCA: false, canRE: false },

  // 6720 Repairs and Maintenance
  { code: '6720', itemName: 'Repairs and Maintenance', category: 'Repairs and Maintenance', dept: 'Admin Department', canCA: true, canRE: true },

  // 6840 Travel Expense
  { code: '6840.1', itemName: 'Local Travel - Airline Expenses', category: 'Travel Expense', dept: 'All Dept', canCA: true, canRE: true },
  { code: '6840.2', itemName: 'Local Travel - Hotel', category: 'Travel Expense', dept: 'All Dept', canCA: true, canRE: true },
  { code: '6840.3', itemName: 'Foreign Travel - Airline Expenses', category: 'Travel Expense', dept: 'All Dept', canCA: true, canRE: true },
  { code: '6840.4', itemName: 'Foreign Travel - Hotel', category: 'Travel Expense', dept: 'All Dept', canCA: true, canRE: true },
  { code: '6840.5', itemName: 'Travel Expense - Other', category: 'Travel Expense', dept: 'All Dept', canCA: true, canRE: true },
  { code: '6840.6', itemName: 'Travel Expenses - Indo Representative', category: 'Travel Expense', dept: 'Finance Department', canCA: true, canRE: true },

  // 6860 Utilities
  { code: '6860.1', itemName: 'Electricity', category: 'Utilities', dept: 'Admin Department', canCA: false, canRE: false },
  { code: '6860.2', itemName: 'Water', category: 'Utilities', dept: 'Admin Department', canCA: false, canRE: false },
  { code: '6860.3', itemName: 'Utilities Others (Aircon etc)', category: 'Utilities', dept: 'Admin Department', canCA: false, canRE: false },

  // 6870 Communication
  { code: '6870.1', itemName: 'Globe', category: 'Communication', dept: 'All Dept', canCA: true, canRE: true },
  { code: '6870.2', itemName: 'Smart Bills', category: 'Communication', dept: 'All Dept', canCA: true, canRE: true },
  { code: '6870.3', itemName: 'PLDT Telephone', category: 'Communication', dept: 'Admin Department', canCA: false, canRE: false },
  { code: '6870.5', itemName: 'Internet Subscription', category: 'Communication', dept: 'Admin Department', canCA: false, canRE: false },

  // 6900 Welfare - Employee
  { code: '6900.1', itemName: 'Seminar', category: 'Welfare - Employee', dept: 'All Dept', canCA: true, canRE: true },
  { code: '6900.2', itemName: 'HMO Expenses', category: 'Welfare - Employee', dept: 'HR Department', canCA: true, canRE: true },
  { code: '6900.3', itemName: 'Uniform', category: 'Welfare - Employee', dept: 'HR Department', canCA: true, canRE: true },
  { code: '6900.4', itemName: 'Staff Welfare', category: 'Welfare - Employee', dept: 'HR Department', canCA: true, canRE: true },

  // 9900 Sundry
  { code: '9900', itemName: 'Sundry & Misc', category: 'Sundry', dept: 'All Dept', canCA: true, canRE: true },

  // Asset categories
  { code: '1700', itemName: 'Office Equipment', category: 'Asset', dept: 'All Dept', canCA: true, canRE: true },
  { code: '1701', itemName: 'Furniture & Fixtures', category: 'Asset', dept: 'All Dept', canCA: true, canRE: true },
  { code: '1702', itemName: 'Computer & IT Equipment', category: 'Asset', dept: 'All Dept', canCA: true, canRE: true },
  { code: '1703', itemName: 'Transportation Equipment', category: 'Asset', dept: 'All Dept', canCA: true, canRE: true },
  { code: '1704', itemName: 'Leasehold Improvements', category: 'Asset', dept: 'All Dept', canCA: true, canRE: true }
];

type BudgetCategoryRow = {
  category_code?: string;
  category_name: string;
  parent_category_name?: string | null;
};

/** Add budget-matrix categories that are not represented in the static official list. */
export function mergeBudgetCategoriesIntoOfficialList(
  officialItems: ExpenseItem[],
  budgetCategories: BudgetCategoryRow[],
  departmentName: string
): ExpenseItem[] {
  const merged = [...officialItems];
  const topLevelWithOfficialItems = new Set(officialItems.map((item) => item.category));

  for (const cat of budgetCategories) {
    const categoryName = String(cat.category_name || '').trim();
    if (!categoryName) continue;

    const parentName = String(cat.parent_category_name || '').trim();
    const groupCategory = parentName || categoryName;
    const itemName = categoryName;
    const code = String(cat.category_code || categoryName).trim();

    const alreadyAdded = merged.some(
      (entry) =>
        entry.category === groupCategory &&
        entry.itemName === itemName &&
        entry.code === code
    );
    if (alreadyAdded) {
      // The department-specific budget matrix is authoritative. An expense may
      // exist in the static catalog with an old department assignment, so make
      // sure the scoped result carries the employee's actual department.
      const index = merged.findIndex(
        (entry) => entry.category === groupCategory && entry.itemName === itemName && entry.code === code
      );
      merged[index] = { ...merged[index], dept: departmentName || 'All Dept' };
      continue;
    }

    // When the same code exists in the static catalog, enrich that entry from
    // the department matrix instead of discarding the matrix row. This keeps
    // all main/sub-category mappings visible to employees in every department.
    const existingIndex = merged.findIndex((entry) => entry.code === code);
    if (existingIndex >= 0) {
      merged[existingIndex] = {
        ...merged[existingIndex],
        itemName: parentName ? itemName : merged[existingIndex].itemName,
        category: parentName || merged[existingIndex].category,
        dept: departmentName || 'All Dept',
      };
      continue;
    }

    if (!parentName && topLevelWithOfficialItems.has(categoryName)) continue;

    merged.push({
      code,
      itemName,
      category: groupCategory,
      dept: departmentName || 'All Dept',
      canCA: true,
      canRE: true,
    });
  }

  return merged;
};

export function validateExpense(
  itemName: string,
  departmentName: string,
  requestType: 'cash_advance' | 'reimbursement' | 'liquidation',
  extraItems: ExpenseItem[] = [],
  userRole?: string,
  allowUnlistedItems = false
): ExpenseEligibility {
  // Liquidations don't need validation against official expense list
  if (requestType === 'liquidation') {
    return {
      allowed: true,
      code: 'N/A',
      category: 'Liquidation',
      department: departmentName,
      canCA: false,
      canRE: false,
      reason: ''
    };
  }

  const searchList = extraItems.length ? [...OFFICIAL_EXPENSE_LIST, ...extraItems] : OFFICIAL_EXPENSE_LIST;
  const item = searchList.find(
    (e) => e.itemName.toLowerCase() === itemName.toLowerCase() || 
           `${e.code} | ${e.itemName}`.toLowerCase() === itemName.toLowerCase()
  );

  if (!item) {
    if (allowUnlistedItems) {
      return {
        allowed: true,
        code: 'CUSTOM',
        category: 'Freehand',
        department: departmentName,
        canCA: requestType === 'cash_advance',
        canRE: requestType === 'reimbursement',
        reason: ''
      };
    }

    return {
      allowed: false,
      code: 'N/A',
      category: 'Unknown',
      department: departmentName,
      canCA: false,
      canRE: false,
      reason: `"${itemName}" is not an approved expense item on the official list.`
    };
  }

  const staffRoles = ['employee', 'manager', 'supervisor'];
  const submissionMode = item.mannerOfSubmission || 'for_submission';
  if (staffRoles.includes(String(userRole || '').toLowerCase()) && submissionMode === 'for_upload') {
    return {
      allowed: false,
      code: item.code,
      category: item.category,
      department: item.dept.toString(),
      canCA: item.canCA,
      canRE: item.canRE,
      reason: 'This expense category is for accounting upload only and cannot be selected on employee or supervisor forms.'
    };
  }

  // Check department
  const userDept = departmentName.trim().toLowerCase();
  const allowedDepts = (Array.isArray(item.dept) ? item.dept : [item.dept]).map(d => d.toLowerCase());
  
  // Flexible matching: "HR" matches "HR Department"
  const isDeptAllowed = allowedDepts.includes('all dept') || allowedDepts.some(d => userDept.includes(d) || d.includes(userDept));

  if (!isDeptAllowed) {
    return {
      allowed: false,
      code: item.code,
      category: item.category,
      department: item.dept.toString(),
      canCA: item.canCA,
      canRE: item.canRE,
      reason: `This expense is only allowed for the ${item.dept} department(s). Your department is ${departmentName}.`
    };
  }

  // Check eligibility for request type
  const isEligible = requestType === 'cash_advance' ? item.canCA : item.canRE;
  if (!isEligible) {
    return {
      allowed: false,
      code: item.code,
      category: item.category,
      department: item.dept.toString(),
      canCA: item.canCA,
      canRE: item.canRE,
      reason: `This expense is not eligible for ${requestType === 'cash_advance' ? 'Cash Advance' : 'Reimbursement'}.`
    };
  }

  return {
    allowed: true,
    code: item.code,
    category: item.category,
    department: item.dept.toString(),
    canCA: item.canCA,
    canRE: item.canRE
  };
}
