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

const router = Router();
const toNumber = (value: any) => Number.parseFloat(value ?? 0) || 0;

const syncDepartmentBudget = async (department_id: string, fiscal_year: number) => {
  // Get all categories for this department (by ID)
  const { data: cats } = await supabase
    .from('budget_categories')
    .select('budget_amount')
    .eq('department_id', department_id)
    .eq('fiscal_year', fiscal_year);
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
        category_code: category_code.toUpperCase(),
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

    const newRemaining = Math.max(0, requestedBudget - usedAmount - committedAmount);

    const updatePayload: Record<string, unknown> = {
      budget_amount: requestedBudget,
      category_name: category_name || current.category_name,
      remaining_amount: newRemaining,
      updated_at: new Date(),
    };

    if (parent_category_id !== undefined) {
      if (parent_category_id === null || parent_category_id === '') {
        updatePayload.parent_category_id = null;
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
        updatePayload.parent_category_id = parent_category_id;
      }
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
      .select('id, used_amount, committed_amount, category_name, department_id, fiscal_year, is_locked')
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
    const { department_id } = req.query;

    if (department_id) {
      await ensureDepartmentCostCenterCode(supabase, String(department_id));
    }

    let query = supabase
      .from('cost_centers')
      .select('*, departments(name)')
      .eq('is_active', true);

    if (department_id) {
      query = query.eq('department_id', department_id);
    }

    const { data, error } = await query.order('cost_center_code');
    if (error) throw error;

    res.json(data || []);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/budget/cost-centers - Create cost center
router.post('/cost-centers', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { department_id, cost_center_code, cost_center_name, description } = req.body;

    const { data, error } = await supabase
      .from('cost_centers')
      .insert({
        department_id,
        cost_center_code: cost_center_code.toUpperCase(),
        cost_center_name,
        description,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      })
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

    res.json(report);
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
