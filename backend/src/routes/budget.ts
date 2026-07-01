import { Router } from 'express';
import { supabase } from '../utils/supabase';
import { authenticate, authorize } from '../middleware/auth';
import { getLatestConfiguredFiscalYear } from '../utils/fiscal';
import { restoreAllBudgetCategoriesForFiscalYear } from '../utils/restoreBudgetCategories';
import { filterBudgetCategoriesForUser } from '../utils/budgetCategoryVisibility';
import { cacheResponse, CACHE_TTL, invalidateCache } from '../middleware/cache';
import { AUDIT_ACTIONS, logAuditEvent } from '../utils/auditLog';
import { checkBudgetUtilizationWarning, notifyDepartmentSupervisor } from '../utils/workflowNotify';
import { ensureDepartmentCostCenterCode } from '../utils/costCenters';
import { isMainCategoryCode } from '../utils/budgetCategoryHierarchy';
import { updateM88ManilaCostCenterBudget } from '../utils/generalBudget';
import PDFDocument from 'pdfkit';

const router = Router();
const toNumber = (value: any) => Number.parseFloat(value ?? 0) || 0;

const sumChildBudgets = async (parentCategoryId: string, excludeCategoryId?: string) => {
  let query = supabase
    .from('budget_categories')
    .select('id, budget_amount')
    .eq('parent_category_id', parentCategoryId);

  if (excludeCategoryId) {
    query = query.neq('id', excludeCategoryId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).reduce((sum: number, category: any) => sum + toNumber(category.budget_amount), 0);
};

const syncMainCategoryRemaining = async (categoryId?: string | null) => {
  if (!categoryId) return;

  const { data: category, error } = await supabase
    .from('budget_categories')
    .select('id, parent_category_id, budget_amount, used_amount, committed_amount')
    .eq('id', categoryId)
    .maybeSingle();

  if (error) throw error;
  if (!category || category.parent_category_id) return;

  const childTotal = await sumChildBudgets(category.id);
  const remainingAmount = Math.max(0, toNumber(category.budget_amount) - childTotal);

  await supabase
    .from('budget_categories')
    .update({ remaining_amount: remainingAmount, updated_at: new Date() })
    .eq('id', category.id);
};

const assertChildAllocationFitsParent = async (
  parentCategoryId: string,
  requestedBudget: number,
  excludeCategoryId?: string
) => {
  const { data: parentCategory, error: parentError } = await supabase
    .from('budget_categories')
    .select('id, department_id, fiscal_year, parent_category_id, budget_amount, category_name')
    .eq('id', parentCategoryId)
    .maybeSingle();

  if (parentError || !parentCategory) {
    throw new Error('Parent category not found');
  }
  if (parentCategory.parent_category_id) {
    throw new Error('Parent category cannot itself be a subcategory');
  }

  const existingChildTotal = await sumChildBudgets(parentCategoryId, excludeCategoryId);
  const nextChildTotal = existingChildTotal + requestedBudget;
  const parentBudget = toNumber(parentCategory.budget_amount);

  if (nextChildTotal > parentBudget) {
    throw new Error(`Sub-category allocations exceed "${parentCategory.category_name}" budget. Available: ${(parentBudget - existingChildTotal).toFixed(2)}, Requested: ${requestedBudget.toFixed(2)}`);
  }

  return parentCategory;
};

const syncDepartmentBudget = async (department_id: string, fiscal_year: number) => {
  // Get all categories for this department (by ID)
  const { data: cats } = await supabase
    .from('budget_categories')
    .select('budget_amount')
    .eq('department_id', department_id)
    .eq('fiscal_year', fiscal_year)
    .is('parent_category_id', null);
  const total = (cats || []).reduce((s: number, c: any) => s + toNumber(c.budget_amount), 0);

  // Get the department name so we can update ALL duplicate rows with the same name+FY
  const { data: dept } = await supabase
    .from('departments')
    .select('name')
    .eq('id', department_id)
    .single();

  if (dept?.name) {
    // Update all rows matching this name+FY (handles duplicates)
    await supabase
      .from('departments')
      .update({ annual_budget: total, updated_at: new Date() })
      .ilike('name', dept.name)
      .eq('fiscal_year', fiscal_year);
  } else {
    // Fallback: update just by ID
    await supabase
      .from('departments')
      .update({ annual_budget: total, updated_at: new Date() })
      .eq('id', department_id);
  }
  return total;
};

const detachCategoryReferences = async (categoryId: string) => {
  await Promise.all([
    supabase.from('expense_requests').update({ category_id: null }).eq('category_id', categoryId),
    supabase.from('request_items').update({ category_id: null }).eq('category_id', categoryId),
    supabase.from('liquidation_items').update({ category_id: null }).eq('category_id', categoryId),
    supabase.from('budget_categories').update({ parent_category_id: null }).eq('parent_category_id', categoryId)
  ]);
};

// POST /api/budget/categories/restore-all - Recover categories deleted by cascade (admin/accounting)
router.post('/categories/restore-all', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
    const fiscalYear = req.body?.fiscal_year ? parseInt(String(req.body.fiscal_year), 10) : activeFiscalYear;
    const results = await restoreAllBudgetCategoriesForFiscalYear(supabase, fiscalYear);
    const restoredCount = results.filter((row) => row.restored).length;
    res.json({
      fiscal_year: fiscalYear,
      restored_departments: restoredCount,
      results
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/budget/categories - Get budget categories for a department
router.get('/categories', authenticate, cacheResponse(CACHE_TTL.MEDIUM), async (req: any, res) => {
  try {
    const { department_id, fiscal_year, all_years } = req.query;
    const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
    const targetFiscalYear = fiscal_year ? parseInt(fiscal_year as string) : activeFiscalYear;

    let query = supabase
      .from('budget_categories')
      .select('*');

    if (all_years === 'true') {
      // Return all fiscal years (used by accounting for department filtering)
    } else {
      query = query.eq('fiscal_year', targetFiscalYear);
    }

    if (department_id && department_id !== '') {
      if (req.user?.role === 'admin' || req.user?.role === 'super_admin' || req.user?.role === 'accounting') {
        query = query.eq('department_id', department_id);
      } else if (req.user?.department_id && String(req.user.department_id) === String(department_id)) {
        query = query.eq('department_id', department_id);
      } else {
        return res.status(403).json({ error: 'Forbidden' });
      }
    } else if (req.user?.role !== 'admin' && req.user?.role !== 'super_admin' && req.user?.role !== 'accounting') {
      // Regular users use their own department_id from token
      if (req.user?.department_id) {
        query = query.eq('department_id', req.user.department_id);
      } else {
        // If no department in token, return empty
        return res.json([]);
      }
    }

    const { data, error } = await query.order('category_name');
    if (error) throw error;

    const rows = await filterBudgetCategoriesForUser(supabase, data || [], { userRole: req.user?.role });
    const nameById = new Map(rows.map((row: any) => [row.id, row.category_name]));
    const enriched = rows.map((row: any) => ({
      ...row,
      parent_category_name: row.parent_category_id ? nameById.get(row.parent_category_id) || null : null,
    }));

    res.json(enriched);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/budget/categories - Create budget category (finance/admin only)
router.post('/categories', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { department_id, category_code, category_name, budget_amount, fiscal_year, parent_category_id } = req.body;
    const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
    const requestedBudget = budget_amount !== undefined && budget_amount !== null ? toNumber(budget_amount) : 0;


    const [{ data: department, error: departmentError }, { data: existingCategories, error: categoriesError }] = await Promise.all([
      supabase
        .from('departments')
        .select('id, annual_budget')
        .eq('id', department_id)
        .single(),
      supabase
        .from('budget_categories')
        .select('budget_amount')
        .eq('department_id', department_id)
        .eq('fiscal_year', fiscal_year || activeFiscalYear)
    ]);

    if (departmentError || !department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    if (categoriesError) throw categoriesError;

    const targetFY = toNumber(fiscal_year || activeFiscalYear);

    const cleanCategoryCode = String(category_code || '').toUpperCase();

    if (!parent_category_id && !isMainCategoryCode(cleanCategoryCode)) {
      return res.status(400).json({ error: 'Sub-categories must be assigned under a main category.' });
    }

    if (parent_category_id) {
      const { data: parentCategory, error: parentError } = await supabase
        .from('budget_categories')
        .select('id, department_id, fiscal_year, parent_category_id')
        .eq('id', parent_category_id)
        .maybeSingle();

      if (parentError || !parentCategory) {
        return res.status(400).json({ error: 'Parent category not found' });
      }
      if (parentCategory.department_id !== department_id || Number(parentCategory.fiscal_year) !== targetFY) {
        return res.status(400).json({ error: 'Parent category must belong to the same department and fiscal year' });
      }
      if (parentCategory.parent_category_id) {
        return res.status(400).json({ error: 'Parent category cannot itself be a subcategory' });
      }
      await assertChildAllocationFitsParent(parent_category_id, requestedBudget);
      
      // Check for circular reference
      const checkCircularReference = async (categoryId: string, visited: Set<string> = new Set()): Promise<boolean> => {
        if (visited.has(categoryId)) return true;
        visited.add(categoryId);
        
        const { data: category } = await supabase
          .from('budget_categories')
          .select('parent_category_id')
          .eq('id', categoryId)
          .single();
        
        if (!category?.parent_category_id) return false;
        return checkCircularReference(category.parent_category_id, visited);
      };
      
      const isCircular = await checkCircularReference(parent_category_id);
      if (isCircular) {
        return res.status(400).json({ error: 'Circular reference detected in category hierarchy' });
      }
    }

    const { data, error } = await supabase
      .from('budget_categories')
      .insert({
        department_id,
        fiscal_year: targetFY,
        category_code: cleanCategoryCode,
        category_name,
        budget_amount: requestedBudget,
        remaining_amount: requestedBudget,
        parent_category_id: parent_category_id || null,
        created_at: new Date(),
        updated_at: new Date()
      })
      .select()
      .single();

    if (error) throw error;

    await syncDepartmentBudget(department_id, targetFY);
    await syncMainCategoryRemaining(parent_category_id || data.id);

    // Update M88 Manila cost center budget (sum of all departments' annual budgets)
    await updateM88ManilaCostCenterBudget(targetFY, req.user);

    // Invalidate cache for budget categories
    invalidateCache('/api/budget/categories');
    invalidateCache('/api/departments');

    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/budget/categories/:id/unlock - Unlock budget category (accounting only)
router.patch('/categories/:id/unlock', authenticate, authorize('accounting', 'admin'), async (req: any, res) => {
  try {
    const { id } = req.params;

    const { data: current } = await supabase
      .from('budget_categories')
      .select('*')
      .eq('id', id)
      .single();

    if (!current) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const { data, error } = await supabase
      .from('budget_categories')
      .update({ is_locked: false, locked_at: null, unlocked_at: new Date() })
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(400).json({ error });

    await logAuditEvent({
      user: req.user,
      actionType: AUDIT_ACTIONS.BUDGET_UNLOCKED,
      recordType: 'budget',
      recordId: id,
      recordLabel: current.category_name,
      oldValue: { is_locked: true },
      newValue: { is_locked: false },
      remarks: req.body?.reason || 'Unlocked by accounting',
    });
    await notifyDepartmentSupervisor(
      current.department_id,
      `Budget category "${current.category_name}" was unlocked by accounting. You may submit revisions if needed.`
    );

    // Sync department budget after unlock
    await syncDepartmentBudget(current.department_id, current.fiscal_year);

    // Invalidate cache
    invalidateCache('/api/budget/categories');
    invalidateCache('/api/departments');

    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/budget/categories/:id/lock - Lock budget category (accounting/supervisor/admin)
router.patch('/categories/:id/lock', authenticate, authorize('accounting', 'admin', 'supervisor'), async (req: any, res) => {
  try {
    const { id } = req.params;

    const { data: current } = await supabase
      .from('budget_categories')
      .select('*')
      .eq('id', id)
      .single();

    if (!current) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const { data, error } = await supabase
      .from('budget_categories')
      .update({ is_locked: true, locked_at: new Date() })
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(400).json({ error });

    await logAuditEvent({
      user: req.user,
      actionType: AUDIT_ACTIONS.BUDGET_LOCKED,
      recordType: 'budget',
      recordId: id,
      recordLabel: current.category_name,
      oldValue: { is_locked: false },
      newValue: { is_locked: true },
      remarks: req.body?.reason || 'Locked by accounting',
    });

    await notifyDepartmentSupervisor(
      current.department_id,
      `Budget category "${current.category_name}" was locked by accounting. No further edits are allowed until unlocked.`
    );

    // Sync department budget after lock
    await syncDepartmentBudget(current.department_id, current.fiscal_year);

    // Invalidate cache
    invalidateCache('/api/budget/categories');
    invalidateCache('/api/departments');

    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/budget/categories/:id - Update budget category
router.put('/categories/:id', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { id } = req.params;
    const { budget_amount, category_name, parent_category_id } = req.body;

    // Get current category to calculate remaining adjustment
    const { data: current } = await supabase
      .from('budget_categories')
      .select('*')
      .eq('id', id)
      .single();

    if (!current) {
      return res.status(404).json({ error: 'Category not found' });
    }

    if (current.is_locked) {
      return res.status(403).json({ error: 'This budget category is locked. Only accounting can unlock it before editing.' });
    }

    const requestedBudget = budget_amount !== undefined && budget_amount !== null ? toNumber(budget_amount) : toNumber(current.budget_amount);
    const usedAmount = toNumber(current.used_amount);
    const committedAmount = toNumber(current.committed_amount);

    let nextParentCategoryId = current.parent_category_id || null;
    const isMovingToMain = parent_category_id !== undefined && (parent_category_id === null || parent_category_id === '');

    const updatePayload: Record<string, unknown> = {
      budget_amount: requestedBudget,
      category_name: category_name || current.category_name,
      remaining_amount: Math.max(0, requestedBudget - usedAmount - committedAmount),
      updated_at: new Date(),
    };

    if (parent_category_id !== undefined) {
      if (parent_category_id === null || parent_category_id === '') {
        if (!isMainCategoryCode(current.category_code)) {
          return res.status(400).json({ error: 'Only main category codes can be moved to the top level.' });
        }
        updatePayload.parent_category_id = null;
        nextParentCategoryId = null;
      } else if (parent_category_id === id) {
        return res.status(400).json({ error: 'Category cannot be its own parent' });
      } else {
        const { data: parentCategory, error: parentError } = await supabase
          .from('budget_categories')
          .select('id, department_id, fiscal_year, parent_category_id')
          .eq('id', parent_category_id)
          .maybeSingle();

        if (parentError || !parentCategory) {
          return res.status(400).json({ error: 'Parent category not found' });
        }
        if (
          parentCategory.department_id !== current.department_id ||
          Number(parentCategory.fiscal_year) !== Number(current.fiscal_year)
        ) {
          return res.status(400).json({ error: 'Parent category must belong to the same department and fiscal year' });
        }
        if (parentCategory.parent_category_id) {
          return res.status(400).json({ error: 'Parent category cannot itself be a subcategory' });
        }
        await assertChildAllocationFitsParent(parent_category_id, requestedBudget, id);
        updatePayload.parent_category_id = parent_category_id;
        nextParentCategoryId = parent_category_id;
      }
    }

    if (nextParentCategoryId) {
      await assertChildAllocationFitsParent(nextParentCategoryId, requestedBudget, id);
    }

    if (!nextParentCategoryId && !isMovingToMain) {
      const childTotal = await sumChildBudgets(id);
      if (requestedBudget < childTotal) {
        return res.status(400).json({ error: `Main category budget cannot be below its sub-category allocations. Allocated: ${childTotal.toFixed(2)}` });
      }
      updatePayload.remaining_amount = Math.max(0, requestedBudget - childTotal);
    }

    const { data, error } = await supabase
      .from('budget_categories')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await logAuditEvent({
      user: req.user,
      actionType: AUDIT_ACTIONS.BUDGET_UPDATED,
      recordType: 'budget',
      recordId: id,
      recordLabel: current.category_name,
      oldValue: { budget_amount: current.budget_amount, category_name: current.category_name },
      newValue: { budget_amount: requestedBudget, category_name: updatePayload.category_name },
    });
    await checkBudgetUtilizationWarning(id);

    await syncDepartmentBudget(current.department_id, current.fiscal_year);
    await syncMainCategoryRemaining(current.parent_category_id);
    await syncMainCategoryRemaining(nextParentCategoryId || id);

    // Update M88 Manila cost center budget (sum of all departments' annual budgets)
    await updateM88ManilaCostCenterBudget(current.fiscal_year, req.user);

    // Invalidate cache for budget categories
    invalidateCache('/api/budget/categories');
    invalidateCache('/api/departments');

    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/budget/categories/:id - Delete budget category
router.delete('/categories/:id', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { id } = req.params;

    const { data: current } = await supabase
      .from('budget_categories')
      .select('id, used_amount, committed_amount, category_name, department_id, fiscal_year, is_locked, parent_category_id')
      .eq('id', id)
      .single();

    if (!current) {
      return res.status(404).json({ error: 'Category not found' });
    }

    if (current.is_locked) {
      return res.status(403).json({ error: 'This budget category is locked. Only accounting can unlock it before deleting.' });
    }

    if (toNumber(current.used_amount) > 0 || toNumber(current.committed_amount) > 0) {
      return res.status(400).json({
        error: `Cannot delete category "${current.category_name}" — it has existing used or committed budget amounts. Zero out the amounts first.`
      });
    }

    const { error } = await supabase
      .from('budget_categories')
      .delete()
      .eq('id', id);

    if (error) throw error;

    await syncDepartmentBudget(current.department_id as string, current.fiscal_year as number);
    await syncMainCategoryRemaining(current.parent_category_id);

    // Invalidate cache for budget categories
    invalidateCache('/api/budget/categories');
    invalidateCache('/api/departments');

    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/budget/cost-centers - Get cost centers
router.get('/cost-centers', authenticate, async (req: any, res) => {
  try {
    const { department_id, fiscal_year } = req.query;

    if (department_id) {
      await ensureDepartmentCostCenterCode(supabase, String(department_id));
    }

    // Recalculate M88 Manila budget so the dashboard always shows fresh data
    if (fiscal_year) {
      try {
        await updateM88ManilaCostCenterBudget(parseInt(fiscal_year as string));
      } catch (recalcError) {
        console.error('[GET /cost-centers] Failed to recalculate M88 Manila budget:', recalcError);
      }
    }

    let query = supabase
      .from('cost_centers')
      .select('*')
      .eq('is_active', true);

    if (fiscal_year) {
      query = query.eq('fiscal_year', parseInt(fiscal_year as string));
    }

    const { data, error } = await query.order('name');
    if (error) throw error;

    res.json(data || []);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/budget/cost-centers - Create cost center
router.post('/cost-centers', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { name, total_budget, fiscal_year, is_active } = req.body;

    const costCenterData = {
      name: name.trim(),
      total_budget: parseFloat(total_budget),
      used_amount: 0,
      pending_amount: 0,
      pending_count: 0,
      remaining_amount: parseFloat(total_budget),
      fiscal_year: fiscal_year || new Date().getFullYear(),
      is_active: is_active !== undefined ? is_active : true
    };

    const { data, error } = await supabase
      .from('cost_centers')
      .insert(costCenterData)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/budget/monitoring - Budget vs Actual report
router.get('/monitoring', authenticate, authorize('accounting', 'admin', 'super_admin', 'supervisor', 'management'), async (req: any, res) => {
  try {
    const { department_id, fiscal_year } = req.query;
    const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
    const targetFiscalYear = fiscal_year ? parseInt(fiscal_year as string) : activeFiscalYear;
    const normalizedRole = String(req.user?.role || '').trim().toLowerCase();
    let effectiveDepartmentId = department_id ? String(department_id) : '';
    if (normalizedRole === 'supervisor') {
      if (!req.user?.department_id) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (effectiveDepartmentId && effectiveDepartmentId !== String(req.user.department_id)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      effectiveDepartmentId = String(req.user.department_id);
    }

    // Get budget categories with their stats
    let categoriesQuery = supabase
      .from('budget_categories')
      .select(`
        *,
        departments(name)
      `)
      .eq('fiscal_year', targetFiscalYear);

    if (effectiveDepartmentId) {
      categoriesQuery = categoriesQuery.eq('department_id', effectiveDepartmentId);
    }

    const { data: categories, error: catError } = await categoriesQuery;
    if (catError) throw catError;
    const visibleCategories = await filterBudgetCategoriesForUser(supabase, categories || [], { userRole: req.user?.role });

    // Get actual expenses (released requests) by category
    let expensesQuery = supabase
      .from('expense_requests')
      .select(`
        category_id,
        amount,
        status,
        department_id
      `)
      .eq('fiscal_year', targetFiscalYear)
      .eq('status', 'released')
      .not('category_id', 'is', null);
    if (effectiveDepartmentId) {
      expensesQuery = expensesQuery.eq('department_id', effectiveDepartmentId);
    }
    const { data: expenses, error: expError } = await expensesQuery;

    if (expError) throw expError;

    // Get committed amounts (approved but not released)
    let committedQuery = supabase
      .from('expense_requests')
      .select(`
        category_id,
        amount,
        department_id
      `)
      .eq('fiscal_year', targetFiscalYear)
      .in('status', ['pending_supervisor', 'pending_accounting', 'pending_vp', 'pending_president', 'approved', 'on_hold'])
      .not('category_id', 'is', null);
    if (effectiveDepartmentId) {
      committedQuery = committedQuery.eq('department_id', effectiveDepartmentId);
    }
    const { data: committed, error: comError } = await committedQuery;

    if (comError) throw comError;

    // Build budget vs actual report
    const report = (visibleCategories || []).map((cat: any) => {
      const categoryExpenses = (expenses || []).filter((e: any) => e.category_id === cat.id);
      const categoryCommitted = (committed || []).filter((c: any) => c.category_id === cat.id);

      const actualAmount = categoryExpenses.reduce((sum: number, e: any) => sum + Number(e.amount), 0);
      const committedAmount = categoryCommitted.reduce((sum: number, c: any) => sum + Number(c.amount), 0);

      return {
        category_id: cat.id,
        category_code: cat.category_code,
        category_name: cat.category_name,
        department_id: cat.department_id,
        department_name: cat.departments?.name || 'Unknown',
        budget: Number(cat.budget_amount),
        actual: actualAmount,
        committed: committedAmount,
        remaining: Number(cat.budget_amount) - actualAmount - committedAmount,
        utilization_pct: Number(cat.budget_amount) > 0 
          ? ((actualAmount + committedAmount) / Number(cat.budget_amount) * 100).toFixed(1)
          : 0
      };
    });

    const format = String(req.query.format || '').trim().toLowerCase();
    if (format === 'pdf') {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=budget_vs_actual_${targetFiscalYear}.pdf`);
      doc.pipe(res);
      doc.fontSize(18).text(`Budget vs Actual - Fiscal Year ${targetFiscalYear}`, { align: 'center' });
      doc.moveDown();

      const tableTop = doc.y;
      const colWidths = [180, 120, 80, 80, 80, 80];
      // Header
      doc.fontSize(10).text('Category', 40, tableTop, { width: colWidths[0] });
      doc.text('Department', 40 + colWidths[0], tableTop, { width: colWidths[1] });
      doc.text('Budget', 40 + colWidths[0] + colWidths[1], tableTop, { width: colWidths[2], align: 'right' });
      doc.text('Actual', 40 + colWidths[0] + colWidths[1] + colWidths[2], tableTop, { width: colWidths[3], align: 'right' });
      doc.text('Committed', 40 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], tableTop, { width: colWidths[4], align: 'right' });
      doc.text('Remaining', 40 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], tableTop, { width: colWidths[5], align: 'right' });
      doc.moveDown(0.6);

      for (const row of report) {
        if (doc.y > 720) doc.addPage();
        doc.fontSize(9).text(row.category_name, { width: colWidths[0] });
        doc.text(row.department_name, 40 + colWidths[0], undefined, { width: colWidths[1] });
        doc.text(Number(row.budget).toFixed(2), 40 + colWidths[0] + colWidths[1], undefined, { width: colWidths[2], align: 'right' });
        doc.text(Number(row.actual).toFixed(2), 40 + colWidths[0] + colWidths[1] + colWidths[2], undefined, { width: colWidths[3], align: 'right' });
        doc.text(Number(row.committed).toFixed(2), 40 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], undefined, { width: colWidths[4], align: 'right' });
        doc.text(Number(row.remaining).toFixed(2), 40 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], undefined, { width: colWidths[5], align: 'right' });
        doc.moveDown(0.4);
      }
      doc.end();
    } else {
      res.json(report);
    }
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/budget/setup - Bulk budget setup for fiscal year
router.post('/setup', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { fiscal_year, department_budgets } = req.body;
    // department_budgets: [{ department_id, categories: [{ category_code, category_name, budget_amount }] }]

    const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
    const targetYear = fiscal_year || activeFiscalYear;

    const createdCategories = [];

    for (const dept of department_budgets) {
      for (const cat of dept.categories) {
        const { data, error } = await supabase
          .from('budget_categories')
          .upsert({
            department_id: dept.department_id,
            fiscal_year: targetYear,
            category_code: cat.category_code.toUpperCase(),
            category_name: cat.category_name,
            budget_amount: cat.budget_amount,
            remaining_amount: cat.budget_amount,
            updated_at: new Date()
          }, { onConflict: 'department_id,fiscal_year,category_code' })
          .select()
          .single();

        if (error) {
          console.error('Error creating category:', error);
          continue;
        }

        createdCategories.push(data);
      }
    }

    res.json({
      message: `Created ${createdCategories.length} budget categories for fiscal year ${targetYear}`,
      categories: createdCategories
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/budget/summary - Finance dashboard summary
router.get('/summary', authenticate, authorize('accounting', 'admin', 'super_admin', 'management'), async (req: any, res) => {
  try {
    const { fiscal_year } = req.query;
    const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
    const targetFiscalYear = fiscal_year ? parseInt(fiscal_year as string) : activeFiscalYear;

    // Get all budget categories for the fiscal year
    const { data: categories, error: catError } = await supabase
      .from('budget_categories')
      .select('*')
      .eq('fiscal_year', targetFiscalYear);

    if (catError) throw catError;

    // Get pending for review count (pending_accounting + on_hold)
    const { data: pending, error: penError } = await supabase
      .from('expense_requests')
      .select('id', { count: 'exact' })
      .eq('fiscal_year', targetFiscalYear)
      .in('status', ['pending_accounting', 'on_hold']);

    if (penError) throw penError;

    // Get outstanding cash advances
    const { data: cashAdvances, error: caError } = await supabase
      .from('cash_advances')
      .select('balance, status')
      .in('status', ['outstanding', 'partially_liquidated', 'overdue']);

    if (caError) throw caError;

    // Get overdue liquidations
    const { data: overdue, error: odError } = await supabase
      .from('cash_advances')
      .select('id', { count: 'exact' })
      .eq('status', 'overdue');

    if (odError) throw odError;

    const totalBudget = (categories || []).reduce((sum: number, c: any) => sum + Number(c.budget_amount), 0);
    const totalUsed = (categories || []).reduce((sum: number, c: any) => sum + Number(c.used_amount), 0);
    const totalCommitted = (categories || []).reduce((sum: number, c: any) => sum + Number(c.committed_amount), 0);
    const totalOutstandingCash = (cashAdvances || []).reduce((sum: number, ca: any) => sum + Number(ca.balance), 0);

    res.json({
      fiscal_year: targetFiscalYear,
      pending_for_review: pending?.length || 0,
      outstanding_cash_advances: totalOutstandingCash,
      overdue_liquidations: overdue?.length || 0,
      budget_utilization_pct: totalBudget > 0 ? ((totalUsed + totalCommitted) / totalBudget * 100).toFixed(1) : 0,
      total_budget: totalBudget,
      total_used: totalUsed,
      total_committed: totalCommitted,
      total_remaining: totalBudget - totalUsed - totalCommitted
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
