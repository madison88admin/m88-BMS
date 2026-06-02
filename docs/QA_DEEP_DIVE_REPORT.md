# QA Deep Dive Report - Budget Management System

## Date: June 2, 2026

## Critical Bugs Found

### 1. **Inconsistent Department Budget Update** (HIGH PRIORITY)
**Location:** `backend/src/routes/requests.ts` lines 547-550

**Issue:**
```typescript
const updatePayload: any = {
  used_budget: toNumber(department.used_budget) + toNumber(allocation.amount),
  updated_at: new Date()
};
```

**Problem:**
- Code still updates `department.used_budget` when releasing funds
- Department annual budget validation was removed in recent changes
- This creates inconsistency: validation uses category budget, but deduction updates department budget
- Department.used_budget will be out of sync with actual category budgets

**Impact:**
- Department budget reports will show incorrect values
- Budget monitoring will be inaccurate
- Data integrity issues between department and category levels

**Recommendation:**
Remove department.used_budget update from release logic. Department.used_budget should be calculated from sum of category budgets, not updated directly.

---

## Potential Issues

### 2. **Category Budget Creation on Missing Category** (MEDIUM PRIORITY)
**Location:** `backend/src/routes/requests.ts` lines 1713-1744

**Issue:**
```typescript
// If category doesn't exist for this department, create a placeholder
let effectiveCat = categoryBudget;
if (!effectiveCat) {
  const { data: createdCat, error: createErr } = await supabase
    .from('budget_categories')
    .insert({
      category_name: categoryName,
      department_id: allocation.department_id,
      fiscal_year: request.fiscal_year,
      budget_amount: 0,
      used_amount: 0,
      committed_amount: 0,
      remaining_amount: 0,
      created_at: now,
      updated_at: now
    })
```

**Problem:**
- Creates budget categories with 0 budget on-the-fly
- No parent_category_id set (could be sub-category)
- No category_code set
- Could create duplicate categories
- Bypasses proper budget setup process

**Impact:**
- Categories created without proper setup
- Budget allocation bypassed
- Potential data inconsistency

**Recommendation:**
Reject requests with missing categories instead of auto-creating. Require proper budget setup.

---

### 3. **Direct Expenses Category Deduction** (MEDIUM PRIORITY)
**Location:** `backend/src/routes/expenses.ts` lines 35-78

**Issue:**
```typescript
// Check category budget instead of department annual budget
const { data: categoryBudget, error: categoryError } = await supabase
  .from('budget_categories')
  .select('remaining_amount, used_amount')
  .eq('category_name', category)
  .eq('department_id', req.user.department_id)
  .eq('fiscal_year', new Date().getFullYear())
  .maybeSingle();
```

**Problem:**
- Uses category_name to match (not category_id)
- Could match wrong category if names are similar
- No sub-category support (no parent_category_id check)
- Fiscal year uses new Date().getFullYear() instead of user's fiscal_year

**Impact:**
- Wrong category could be deducted
- Sub-categories not supported for direct expenses
- Fiscal year mismatch possible

**Recommendation:**
Use category_id instead of category_name. Add sub-category support. Use user's fiscal_year from context.

---

## Data Consistency Issues

### 4. **Department vs Category Budget Sync**
**Problem:**
- Department annual_budget is set during budget proposal approval
- Category budgets are set separately
- No sync mechanism to ensure department budget = sum of category budgets
- Department.used_budget updated directly, not calculated from categories

**Impact:**
- Department budget reports may not match category totals
- Budget monitoring could show inconsistent data

**Recommendation:**
Implement sync mechanism to recalculate department budgets from category totals.

---

## Recent Changes Review

### Changes Made:
1. ✅ Removed department annual budget validation
2. ✅ Added sub-category budget validation
3. ✅ Updated budget deduction to use category budget
4. ✅ Added sub-category sync logic
5. ✅ Added pre-fetching for categories

### Issues Found in Changes:
1. ❌ Department.used_budget still updated in release logic (Bug #1)
2. ❌ Auto-creation of missing categories (Issue #2)
3. ❌ Direct expenses not using category_id (Issue #3)

---

## Recommendations

### Immediate Actions:
1. **Fix Bug #1:** Remove department.used_budget update from release logic
2. **Fix Issue #2:** Reject requests with missing categories instead of auto-creating
3. **Fix Issue #3:** Update direct expenses to use category_id and proper fiscal year

### Medium Term:
4. Implement department-category budget sync mechanism
5. Add validation to prevent category budget exceeding department budget
6. Add audit logging for budget changes

### Long Term:
7. Consider removing department.used_budget entirely and calculate on-the-fly
8. Implement proper category hierarchy validation
9. Add budget reconciliation reports

---

## Test Cases Needed

1. **Budget Validation:**
   - Test with main category only
   - Test with sub-category selected
   - Test with insufficient category budget
   - Test with sufficient category budget

2. **Budget Deduction:**
   - Verify deduction from correct category
   - Verify sub-category deduction works
   - Verify parent category not affected
   - Verify department budget not updated

3. **Direct Expenses:**
   - Test with category_name matching
   - Test with sub-category
   - Test with fiscal year mismatch

4. **Data Consistency:**
   - Verify department budget = sum of category budgets
   - Verify budget reports are accurate
   - Verify no duplicate categories created

---

## Conclusion

The recent changes to use category-level budget validation and deduction are good, but there are inconsistencies:
- Department budget is still being updated despite validation removal
- Auto-creation of categories bypasses proper setup
- Direct expenses don't fully support sub-categories

**Critical:** Fix Bug #1 immediately to prevent data integrity issues.
