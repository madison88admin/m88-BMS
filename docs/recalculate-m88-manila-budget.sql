-- Migration Script: Recalculate M88 Manila Cost Center Budget from Historical General Category Requests
-- 
-- This script recalculates the M88 Manila cost center budget based on all historical
-- General Category requests that have been released. It ensures the M88 Manila budget
-- reflects the actual dual deductions that should have occurred.
--
-- Run this script in your Supabase SQL editor or via psql

-- Step 1: Create a backup of the current M88 Manila cost center data
CREATE TABLE IF NOT EXISTS cost_centers_backup AS 
SELECT * FROM cost_centers WHERE name = 'M88 Manila';

-- Step 2: For each fiscal year, recalculate M88 Manila budget
DO $$
DECLARE
    fiscal_year_record RECORD;
    m88_cost_center_id TEXT;
    total_released_amount NUMERIC;
    current_total_budget NUMERIC;
    new_used_amount NUMERIC;
    new_remaining_amount NUMERIC;
BEGIN
    -- Loop through each fiscal year
    FOR fiscal_year_record IN 
        SELECT DISTINCT fiscal_year FROM budget_categories WHERE department_id::text = 'All'
        UNION
        SELECT DISTINCT fiscal_year FROM cost_centers WHERE name = 'M88 Manila'
    LOOP
        -- Find or create M88 Manila cost center for this fiscal year
        SELECT id INTO m88_cost_center_id 
        FROM cost_centers 
        WHERE name = 'M88 Manila' AND fiscal_year = fiscal_year_record.fiscal_year;
        
        IF m88_cost_center_id IS NULL THEN
            -- Create M88 Manila cost center if it doesn't exist
            INSERT INTO cost_centers (name, total_budget, used_amount, remaining_amount, fiscal_year, is_active)
            VALUES ('M88 Manila', 0, 0, 0, fiscal_year_record.fiscal_year, true)
            RETURNING id INTO m88_cost_center_id;
        END IF;
        
        -- Calculate total amount from released General Category requests for this fiscal year
        SELECT COALESCE(SUM(er.amount), 0) INTO total_released_amount
        FROM expense_requests er
        JOIN budget_categories bc ON er.category_id = bc.id OR er.category = bc.category_name
        WHERE bc.department_id::text = 'All'
          AND bc.fiscal_year = fiscal_year_record.fiscal_year
          AND er.status = 'released'
          AND er.fiscal_year = fiscal_year_record.fiscal_year;
        
        -- Get current total budget for M88 Manila
        SELECT total_budget INTO current_total_budget
        FROM cost_centers
        WHERE id = m88_cost_center_id;
        
        -- Calculate new values
        new_used_amount := total_released_amount;
        new_remaining_amount := current_total_budget - total_released_amount;
        
        -- Update M88 Manila cost center
        UPDATE cost_centers
        SET used_amount = new_used_amount,
            remaining_amount = new_remaining_amount,
            updated_at = NOW()
        WHERE id = m88_cost_center_id;
        
        RAISE NOTICE 'Updated M88 Manila for fiscal year %: Used = %, Remaining = %', 
            fiscal_year_record.fiscal_year, new_used_amount, new_remaining_amount;
    END LOOP;
END $$;

-- Step 3: Verify the results
SELECT 
    name,
    fiscal_year,
    total_budget,
    used_amount,
    remaining_amount,
    updated_at
FROM cost_centers
WHERE name = 'M88 Manila'
ORDER BY fiscal_year;

-- Step 4: Show summary of General Category requests by fiscal year
SELECT 
    bc.fiscal_year,
    COUNT(*) as total_general_requests,
    COALESCE(SUM(er.amount), 0) as total_released_amount
FROM expense_requests er
JOIN budget_categories bc ON er.category_id = bc.id OR er.category = bc.category_name
WHERE bc.department_id::text = 'All'
  AND er.status = 'released'
GROUP BY bc.fiscal_year
ORDER BY bc.fiscal_year;

-- Note: After running this migration, the M88 Manila cost center should accurately
-- reflect all historical dual deductions from General Category requests.
-- 
-- To rollback: Restore from the cost_centers_backup table
-- DROP TABLE cost_centers;
-- INSERT INTO cost_centers SELECT * FROM cost_centers_backup;
