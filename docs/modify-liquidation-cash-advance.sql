-- Modify Liquidation to Use Cash Advance Selection
-- This script modifies the liquidation system to simplify the workflow:
-- 1. Remove expense line items (liquidation_items)
-- 2. Add direct cash_advance_id to request_liquidations
-- 3. User selects cash advance from dropdown and inputs amount spent
-- 4. Attach receipts directly to liquidation

-- Step 1: Add cash_advance_id to request_liquidations table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'request_liquidations' AND column_name = 'cash_advance_id'
  ) THEN
    ALTER TABLE request_liquidations ADD COLUMN cash_advance_id UUID REFERENCES cash_advances(id);
  END IF;
END $$;

-- Step 2: Add amount_spent column to request_liquidations (amount actually spent from cash advance)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'request_liquidations' AND column_name = 'amount_spent'
  ) THEN
    ALTER TABLE request_liquidations ADD COLUMN amount_spent DECIMAL(15,2);
  END IF;
END $$;

-- Step 3: Add receipt_count column to track number of receipts attached
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'request_liquidations' AND column_name = 'receipt_count'
  ) THEN
    ALTER TABLE request_liquidations ADD COLUMN receipt_count INT DEFAULT 0;
  END IF;
END $$;

-- Step 4: Add foreign key constraint for cash_advance_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_request_liquidations_cash_advance_id'
  ) THEN
    ALTER TABLE request_liquidations
      ADD CONSTRAINT fk_request_liquidations_cash_advance_id FOREIGN KEY (cash_advance_id) REFERENCES cash_advances(id);
  END IF;
END $$;

-- Step 5: Create index for cash_advance_id
CREATE INDEX IF NOT EXISTS idx_request_liquidations_cash_advance_id ON request_liquidations(cash_advance_id);

-- Step 6: Migrate existing liquidation items to new structure
-- This will sum up amounts from liquidation_items and update request_liquidations
DO $$
BEGIN
  -- Update request_liquidations with cash_advance_id and amount_spent from liquidation_items
  UPDATE request_liquidations rl
  SET 
    cash_advance_id = li.cash_advance_id,
    amount_spent = li.total_amount,
    receipt_count = li.item_count
  FROM (
    SELECT 
      cash_advance_id,
      liquidation_id,
      SUM(amount) as total_amount,
      COUNT(*) as item_count
    FROM liquidation_items
    GROUP BY cash_advance_id, liquidation_id
  ) li
  WHERE rl.id = li.liquidation_id;
END $$;

-- Step 7: (Optional) Drop liquidation_items table after migration
-- Uncomment the following lines after verifying migration is successful
-- DROP TABLE IF EXISTS liquidation_items CASCADE;

-- Step 8: Update cash advance balance calculation trigger
-- This should now consider request_liquidations instead of liquidation_items
CREATE OR REPLACE FUNCTION update_cash_advance_balance_from_liquidations()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE cash_advances
    SET 
      amount_liquidated = (
        SELECT COALESCE(SUM(amount_spent), 0) 
        FROM request_liquidations 
        WHERE cash_advance_id = NEW.cash_advance_id 
        AND status IN ('submitted', 'verified')
      ),
      balance = amount_issued - (
        SELECT COALESCE(SUM(amount_spent), 0) 
        FROM request_liquidations 
        WHERE cash_advance_id = NEW.cash_advance_id 
        AND status IN ('submitted', 'verified')
      ),
      status = CASE
        WHEN balance <= 0 THEN 'fully_liquidated'
        WHEN amount_liquidated > 0 THEN 'partially_liquidated'
        ELSE status
      END,
      fully_liquidated_at = CASE
        WHEN balance <= 0 THEN NOW()
        ELSE fully_liquidated_at
      END,
      updated_at = NOW()
    WHERE id = NEW.cash_advance_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE cash_advances
    SET 
      amount_liquidated = (
        SELECT COALESCE(SUM(amount_spent), 0) 
        FROM request_liquidations 
        WHERE cash_advance_id = OLD.cash_advance_id 
        AND status IN ('submitted', 'verified')
      ),
      balance = amount_issued - (
        SELECT COALESCE(SUM(amount_spent), 0) 
        FROM request_liquidations 
        WHERE cash_advance_id = OLD.cash_advance_id 
        AND status IN ('submitted', 'verified')
      ),
      status = CASE
        WHEN balance <= 0 THEN 'fully_liquidated'
        WHEN amount_liquidated > 0 THEN 'partially_liquidated'
        ELSE status
      END,
      updated_at = NOW()
    WHERE id = OLD.cash_advance_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 9: Create trigger for request_liquidations
DROP TRIGGER IF EXISTS trigger_update_cash_advance_balance ON request_liquidations;
CREATE TRIGGER trigger_update_cash_advance_balance
  AFTER INSERT OR UPDATE OR DELETE ON request_liquidations
  FOR EACH ROW EXECUTE FUNCTION update_cash_advance_balance_from_liquidations();

-- Step 10: Add comment to document the changes
COMMENT ON COLUMN request_liquidations.cash_advance_id IS 'Reference to the cash advance being liquidated';
COMMENT ON COLUMN request_liquidations.amount_spent IS 'Total amount actually spent from the cash advance';
COMMENT ON COLUMN request_liquidations.receipt_count IS 'Number of receipts attached to this liquidation';
