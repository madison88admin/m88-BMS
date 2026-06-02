import { supabase } from './supabase';

const toNumber = (value: any) => {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const parsed = parseFloat(String(value));
  return isNaN(parsed) ? 0 : parsed;
};

export const migrateRequestItemsToSubCategories = async () => {
  console.log('Starting migration of request items to sub-categories...');
  
  // Fetch all expense categories
  const { data: expenseCategories, error: expenseError } = await supabase
    .from('expense_categories')
    .select('code, description, main_category_code')
    .neq('main_category_code', null);

  if (expenseError) {
    console.error('Error fetching expense categories:', expenseError);
    return { success: false, error: expenseError.message };
  }

  if (!expenseCategories || expenseCategories.length === 0) {
    console.log('No expense categories found');
    return { success: true, message: 'No expense categories to migrate' };
  }

  // Create a map of expense categories by code
  const expenseCategoryByCode = new Map(
    expenseCategories.map((ec: any) => [ec.code, ec])
  );

  // Fetch all budget categories
  const { data: budgetCategories, error: budgetError } = await supabase
    .from('budget_categories')
    .select('id, category_code, category_name, department_id, fiscal_year, parent_category_id');

  if (budgetError) {
    console.error('Error fetching budget categories:', budgetError);
    return { success: false, error: budgetError.message };
  }

  // Create a map of budget sub-categories by code
  const budgetSubCategoryByCode = new Map(
    (budgetCategories || [])
      .filter((bc: any) => bc.parent_category_id)
      .map((bc: any) => [bc.category_code, bc])
  );

  // Fetch all request items
  const { data: requestItems, error: itemsError } = await supabase
    .from('request_items')
    .select('id, request_id, category, category_id, amount');

  if (itemsError) {
    console.error('Error fetching request items:', itemsError);
    return { success: false, error: itemsError.message };
  }

  if (!requestItems || requestItems.length === 0) {
    console.log('No request items found');
    return { success: true, message: 'No request items to migrate' };
  }

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const item of requestItems) {
    try {
      // Check if the item's category matches an expense category
      const expenseCategory = expenseCategoryByCode.get(item.category);
      
      if (!expenseCategory) {
        skippedCount++;
        continue;
      }

      // Find the corresponding budget sub-category
      const budgetSubCategory = budgetSubCategoryByCode.get(item.category);
      
      if (!budgetSubCategory) {
        skippedCount++;
        continue;
      }

      // If the category_id is already the sub-category, skip
      if (item.category_id === budgetSubCategory.id) {
        skippedCount++;
        continue;
      }

      // Update the request item's category_id
      const { error: updateError } = await supabase
        .from('request_items')
        .update({ category_id: budgetSubCategory.id })
        .eq('id', item.id);

      if (updateError) {
        console.error(`Error updating request item ${item.id}:`, updateError);
        errorCount++;
        continue;
      }

      updatedCount++;
      console.log(`Updated request item ${item.id}: ${item.category} -> ${budgetSubCategory.id}`);
    } catch (err) {
      console.error(`Error processing request item ${item.id}:`, err);
      errorCount++;
    }
  }

  console.log(`Migration complete: ${updatedCount} updated, ${skippedCount} skipped, ${errorCount} errors`);
  
  return {
    success: true,
    message: `Migration complete: ${updatedCount} updated, ${skippedCount} skipped, ${errorCount} errors`,
    updatedCount,
    skippedCount,
    errorCount
  };
};

export const recalculateBudgetDeductions = async () => {
  console.log('Starting budget deduction recalculation...');
  
  // This is a complex operation that would require:
  // 1. Reset all used_amount and committed_amount to 0 for all budget categories
  // 2. Re-process all approved/released requests
  // 3. Re-calculate deductions based on the correct category_id
  
  // For now, we'll skip this as it's risky without proper backup
  console.log('Budget deduction recalculation skipped - requires manual review');
  
  return {
    success: true,
    message: 'Budget deduction recalculation skipped - requires manual review'
  };
};
