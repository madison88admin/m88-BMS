-- Create petty cash fund transactions table and fund summary
CREATE TABLE IF NOT EXISTS petty_cash_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL,
  managed_by uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('disbursement','replenishment','adjustment')),
  amount numeric NOT NULL DEFAULT 0,
  purpose text,
  reference_request_id uuid,
  transaction_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Optional summary table for departmental petty cash (keeps quick balances)
CREATE TABLE IF NOT EXISTS petty_cash_fund (
  department_id uuid PRIMARY KEY,
  balance numeric NOT NULL DEFAULT 0,
  low_balance_threshold numeric DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_petty_cash_transactions_department ON petty_cash_transactions(department_id);
CREATE INDEX IF NOT EXISTS idx_petty_cash_transactions_reference_request ON petty_cash_transactions(reference_request_id);
