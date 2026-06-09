-- Fix cost_centers table - remove department_id column references
-- The cost_centers table does not have a department_id column
-- This script removes any references to department_id in cost_centers queries

-- Note: The cost_centers table structure is:
-- id, name, total_budget, used_amount, remaining_amount, fiscal_year, is_active, created_at, updated_at
-- No department_id column exists in this table
