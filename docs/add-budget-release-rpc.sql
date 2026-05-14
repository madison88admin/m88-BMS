-- Create RPC functions for safe budget operations with row locking
-- Prevents race conditions when multiple users release requests simultaneously

CREATE OR REPLACE FUNCTION release_budget(
  p_department_id UUID,
  p_amount NUMERIC
) RETURNS void AS $$
BEGIN
  UPDATE departments
  SET used_budget = used_budget + p_amount
  WHERE id = p_department_id
    AND (annual_budget - used_budget) >= p_amount;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient department budget';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION release_category_budget(
  p_category_id UUID,
  p_amount NUMERIC
) RETURNS void AS $$
BEGIN
  UPDATE budget_categories
  SET 
    used_amount = used_amount + p_amount,
    committed_amount = GREATEST(0, committed_amount - p_amount),
    remaining_amount = GREATEST(0, budget_amount - (used_amount + p_amount) - GREATEST(0, committed_amount - p_amount))
  WHERE id = p_category_id
    AND (budget_amount - used_amount - committed_amount) >= p_amount;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient category budget';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION release_petty_cash(
  p_department_id UUID,
  p_amount NUMERIC
) RETURNS void AS $$
BEGIN
  UPDATE departments
  SET petty_cash_balance = petty_cash_balance - p_amount
  WHERE id = p_department_id
    AND petty_cash_balance >= p_amount;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient petty cash';
  END IF;
END;
$$ LANGUAGE plpgsql;
