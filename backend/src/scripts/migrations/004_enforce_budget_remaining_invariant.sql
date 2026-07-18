-- Keep category balances mathematically consistent and repair existing rows.
-- remaining_amount is always budget - used - committed, never below zero.

CREATE OR REPLACE FUNCTION "M88_BMS".enforce_budget_category_remaining()
RETURNS TRIGGER AS $$
BEGIN
  NEW.remaining_amount := GREATEST(
    0,
    COALESCE(NEW.budget_amount, 0)
      - COALESCE(NEW.used_amount, 0)
      - COALESCE(NEW.committed_amount, 0)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_enforce_budget_category_remaining
  ON "M88_BMS".budget_categories;

CREATE TRIGGER trigger_enforce_budget_category_remaining
BEFORE INSERT OR UPDATE OF budget_amount, used_amount, committed_amount, remaining_amount
ON "M88_BMS".budget_categories
FOR EACH ROW
EXECUTE FUNCTION "M88_BMS".enforce_budget_category_remaining();

UPDATE "M88_BMS".budget_categories
SET remaining_amount = GREATEST(
  0,
  COALESCE(budget_amount, 0)
    - COALESCE(used_amount, 0)
    - COALESCE(committed_amount, 0)
),
updated_at = NOW();

NOTIFY pgrst, 'reload schema';
