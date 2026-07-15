-- ============================================================
-- M88 BMS - Complete Schema Creation + Seed Data
-- Schema: M88_BMS
-- Target: VPS Supabase (5.223.78.194)
-- ============================================================

-- Create schema
CREATE SCHEMA IF NOT EXISTS "M88_BMS";

SET search_path TO "M88_BMS", public;

-- ============================================================
-- 1. USERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT CHECK (role IN ('employee', 'manager', 'supervisor', 'accounting', 'accounting_limited', 'management', 'admin', 'super_admin', 'vp', 'president')) NOT NULL,
  department_id UUID,
  employee_id TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 2. DEPARTMENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".departments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  annual_budget DECIMAL(15,2) DEFAULT 0,
  used_budget DECIMAL(15,2) DEFAULT 0,
  petty_cash_balance DECIMAL(15,2) DEFAULT 0,
  fiscal_year INT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS departments_name_fiscal_year_unique_idx
ON "M88_BMS".departments (LOWER(TRIM(name)), fiscal_year);

-- FK: users -> departments
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_department_id_m88') THEN
    ALTER TABLE "M88_BMS".users
      ADD CONSTRAINT fk_users_department_id_m88 FOREIGN KEY (department_id) REFERENCES "M88_BMS".departments(id);
  END IF;
END $$;

-- ============================================================
-- 3. PASSWORD RESET TOKENS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".password_reset_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES "M88_BMS".users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  last_sent_at TIMESTAMP DEFAULT NOW(),
  used_at TIMESTAMP,
  invalidated_at TIMESTAMP,
  invalidation_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON "M88_BMS".password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_active_lookup ON "M88_BMS".password_reset_tokens(user_id, expires_at);

-- ============================================================
-- 4. EXPENSE REQUESTS (TICKETS)
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".expense_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_code TEXT UNIQUE NOT NULL,
  employee_id UUID,
  department_id UUID,
  fiscal_year INT,
  request_type TEXT CHECK (request_type IN ('reimbursement', 'cash_advance', 'liquidation', 'budget_request', 'budget_revision', 'direct_expense', 'travel_booking')) DEFAULT 'reimbursement',
  item_name TEXT NOT NULL,
  category TEXT NOT NULL,
  category_id UUID,
  cost_center_id UUID,
  amount DECIMAL(15,2) NOT NULL,
  currency TEXT DEFAULT 'PHP',
  purpose TEXT,
  business_purpose TEXT,
  business_reason TEXT,
  expense_date DATE,
  expected_use_date DATE,
  expected_liquidation_date DATE,
  receipt_url TEXT,
  receipt_required BOOLEAN DEFAULT true,
  receipt_submitted_at TIMESTAMP,
  project TEXT,
  project_id UUID,
  vendor_id UUID,
  priority TEXT CHECK (priority IN ('normal', 'urgent', 'low')) DEFAULT 'normal',
  status TEXT CHECK (status IN ('draft', 'pending_supervisor', 'pending_accounting', 'pending_vp', 'pending_president', 'approved', 'rejected', 'returned_for_revision', 'released', 'on_hold')) DEFAULT 'draft',
  on_hold_reason TEXT,
  on_hold_at TIMESTAMP,
  on_hold_by UUID,
  returned_by UUID,
  returned_at TIMESTAMP,
  return_reason TEXT,
  returned_reason TEXT,
  rejected_by UUID,
  rejected_at TIMESTAMP,
  rejected_reason TEXT,
  rejection_reason TEXT,
  rejection_stage TEXT CHECK (rejection_stage IN ('supervisor', 'accounting')),
  approved_by UUID,
  approved_at TIMESTAMP,
  co_approved_by UUID,
  co_approved_at TIMESTAMP,
  co_approver_role TEXT,
  disbursement_status TEXT CHECK (disbursement_status IN ('pending', 'scheduled', 'released', 'cancelled')) DEFAULT 'pending',
  release_method TEXT CHECK (release_method IN ('cash', 'bank_transfer', 'check', 'petty_cash', 'other')),
  release_reference_no TEXT,
  release_note TEXT,
  released_by UUID,
  released_at TIMESTAMP,
  revision_count INT DEFAULT 0,
  reconciled BOOLEAN NOT NULL DEFAULT false,
  discrepancy_note TEXT,
  reconciled_at TIMESTAMPTZ,
  reconciled_by UUID,
  archived BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}'::jsonb,
  submitted_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- FKs for expense_requests
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_er_employee_id_m88') THEN
    ALTER TABLE "M88_BMS".expense_requests ADD CONSTRAINT fk_er_employee_id_m88 FOREIGN KEY (employee_id) REFERENCES "M88_BMS".users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_er_department_id_m88') THEN
    ALTER TABLE "M88_BMS".expense_requests ADD CONSTRAINT fk_er_department_id_m88 FOREIGN KEY (department_id) REFERENCES "M88_BMS".departments(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_er_released_by_m88') THEN
    ALTER TABLE "M88_BMS".expense_requests ADD CONSTRAINT fk_er_released_by_m88 FOREIGN KEY (released_by) REFERENCES "M88_BMS".users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_er_returned_by_m88') THEN
    ALTER TABLE "M88_BMS".expense_requests ADD CONSTRAINT fk_er_returned_by_m88 FOREIGN KEY (returned_by) REFERENCES "M88_BMS".users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_er_on_hold_by_m88') THEN
    ALTER TABLE "M88_BMS".expense_requests ADD CONSTRAINT fk_er_on_hold_by_m88 FOREIGN KEY (on_hold_by) REFERENCES "M88_BMS".users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_er_co_approved_by_m88') THEN
    ALTER TABLE "M88_BMS".expense_requests ADD CONSTRAINT fk_er_co_approved_by_m88 FOREIGN KEY (co_approved_by) REFERENCES "M88_BMS".users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_er_rejected_by_m88') THEN
    ALTER TABLE "M88_BMS".expense_requests ADD CONSTRAINT fk_er_rejected_by_m88 FOREIGN KEY (rejected_by) REFERENCES "M88_BMS".users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_er_approved_by_m88') THEN
    ALTER TABLE "M88_BMS".expense_requests ADD CONSTRAINT fk_er_approved_by_m88 FOREIGN KEY (approved_by) REFERENCES "M88_BMS".users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_er_reconciled_by_m88') THEN
    ALTER TABLE "M88_BMS".expense_requests ADD CONSTRAINT fk_er_reconciled_by_m88 FOREIGN KEY (reconciled_by) REFERENCES "M88_BMS".users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_er_status ON "M88_BMS".expense_requests(status);
CREATE INDEX IF NOT EXISTS idx_er_department_id ON "M88_BMS".expense_requests(department_id);
CREATE INDEX IF NOT EXISTS idx_er_fiscal_year ON "M88_BMS".expense_requests(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_er_submitted_at ON "M88_BMS".expense_requests(submitted_at);
CREATE INDEX IF NOT EXISTS idx_er_disbursement_status ON "M88_BMS".expense_requests(disbursement_status);
CREATE INDEX IF NOT EXISTS idx_er_released_at ON "M88_BMS".expense_requests(released_at);
CREATE INDEX IF NOT EXISTS idx_er_archived ON "M88_BMS".expense_requests(archived);
CREATE INDEX IF NOT EXISTS idx_er_archived_status ON "M88_BMS".expense_requests(archived, status);

-- ============================================================
-- 5. BUDGET CATEGORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".budget_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES "M88_BMS".departments(id) ON DELETE CASCADE,
  fiscal_year INT NOT NULL,
  category_code TEXT NOT NULL,
  category_name TEXT NOT NULL,
  budget_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  used_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  committed_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  remaining_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  parent_category_id UUID REFERENCES "M88_BMS".budget_categories(id) ON DELETE SET NULL,
  is_locked BOOLEAN DEFAULT FALSE,
  locked_at TIMESTAMPTZ,
  unlocked_at TIMESTAMPTZ,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(department_id, fiscal_year, category_code)
);

CREATE INDEX IF NOT EXISTS idx_bc_dept_year ON "M88_BMS".budget_categories(department_id, fiscal_year);
CREATE INDEX IF NOT EXISTS idx_bc_parent ON "M88_BMS".budget_categories(parent_category_id);

-- Now add FK for expense_requests.category_id -> budget_categories
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_er_category_id_m88') THEN
    ALTER TABLE "M88_BMS".expense_requests ADD CONSTRAINT fk_er_category_id_m88 FOREIGN KEY (category_id) REFERENCES "M88_BMS".budget_categories(id);
  END IF;
END $$;

-- ============================================================
-- 6. COST CENTERS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".cost_centers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  total_budget NUMERIC NOT NULL DEFAULT 0,
  used_amount NUMERIC NOT NULL DEFAULT 0,
  remaining_amount NUMERIC NOT NULL DEFAULT 0,
  fiscal_year INTEGER NOT NULL DEFAULT 2026,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS cost_centers_name_fiscal_year_unique_idx
ON "M88_BMS".cost_centers (LOWER(TRIM(name)), fiscal_year);
CREATE INDEX IF NOT EXISTS cost_centers_fiscal_year_active_idx ON "M88_BMS".cost_centers(fiscal_year, is_active);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION "M88_BMS".update_cost_centers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cost_centers_updated_at_trigger_m88
BEFORE UPDATE ON "M88_BMS".cost_centers
FOR EACH ROW EXECUTE FUNCTION "M88_BMS".update_cost_centers_updated_at();

-- FK: expense_requests.cost_center_id -> cost_centers
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_er_cost_center_id_m88') THEN
    ALTER TABLE "M88_BMS".expense_requests ADD CONSTRAINT fk_er_cost_center_id_m88 FOREIGN KEY (cost_center_id) REFERENCES "M88_BMS".cost_centers(id);
  END IF;
END $$;

-- ============================================================
-- 7. REQUEST COST ALLOCATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".request_cost_allocations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID NOT NULL REFERENCES "M88_BMS".expense_requests(id) ON DELETE CASCADE,
  cost_center_id UUID NOT NULL REFERENCES "M88_BMS".cost_centers(id) ON DELETE RESTRICT,
  budget_category_id UUID NOT NULL REFERENCES "M88_BMS".budget_categories(id) ON DELETE RESTRICT,
  amount NUMERIC NOT NULL,
  tagged_by UUID NOT NULL REFERENCES "M88_BMS".users(id),
  tagged_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES "M88_BMS".users(id)
);

CREATE INDEX IF NOT EXISTS idx_rca_request_id ON "M88_BMS".request_cost_allocations(request_id);
CREATE INDEX IF NOT EXISTS idx_rca_cost_center_id ON "M88_BMS".request_cost_allocations(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_rca_budget_category_id ON "M88_BMS".request_cost_allocations(budget_category_id);
CREATE UNIQUE INDEX IF NOT EXISTS rca_request_unique_idx ON "M88_BMS".request_cost_allocations(request_id);

-- ============================================================
-- 8. CASH ADVANCES
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".cash_advances (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID REFERENCES "M88_BMS".expense_requests(id) ON DELETE SET NULL,
  employee_id UUID NOT NULL REFERENCES "M88_BMS".users(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES "M88_BMS".departments(id) ON DELETE CASCADE,
  advance_code TEXT UNIQUE NOT NULL,
  amount_issued DECIMAL(15,2) NOT NULL,
  amount_liquidated DECIMAL(15,2) DEFAULT 0,
  balance DECIMAL(15,2) NOT NULL,
  expected_liquidation_date DATE,
  liquidation_due_at TIMESTAMP,
  purpose TEXT,
  status TEXT CHECK (status IN ('outstanding', 'partially_liquidated', 'fully_liquidated', 'overdue')) DEFAULT 'outstanding',
  issued_at TIMESTAMP DEFAULT NOW(),
  issued_by UUID REFERENCES "M88_BMS".users(id),
  fully_liquidated_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ca_employee ON "M88_BMS".cash_advances(employee_id);
CREATE INDEX IF NOT EXISTS idx_ca_status ON "M88_BMS".cash_advances(status);
CREATE INDEX IF NOT EXISTS idx_ca_due ON "M88_BMS".cash_advances(liquidation_due_at);

-- Add original_advance_id to expense_requests
ALTER TABLE "M88_BMS".expense_requests ADD COLUMN IF NOT EXISTS original_advance_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_er_original_advance_id_m88') THEN
    ALTER TABLE "M88_BMS".expense_requests ADD CONSTRAINT fk_er_original_advance_id_m88 FOREIGN KEY (original_advance_id) REFERENCES "M88_BMS".cash_advances(id);
  END IF;
END $$;

-- ============================================================
-- 9. LIQUIDATION ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".liquidation_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cash_advance_id UUID NOT NULL REFERENCES "M88_BMS".cash_advances(id) ON DELETE CASCADE,
  liquidation_id UUID REFERENCES "M88_BMS".expense_requests(id) ON DELETE SET NULL,
  expense_date DATE NOT NULL,
  category_id UUID REFERENCES "M88_BMS".budget_categories(id),
  description TEXT,
  amount DECIMAL(15,2) NOT NULL,
  receipt_attached BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_li_advance ON "M88_BMS".liquidation_items(cash_advance_id);

-- Trigger: update cash advance balance on liquidation item changes
CREATE OR REPLACE FUNCTION "M88_BMS".update_cash_advance_balance()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE "M88_BMS".cash_advances
  SET 
    amount_liquidated = (SELECT COALESCE(SUM(amount), 0) FROM "M88_BMS".liquidation_items WHERE cash_advance_id = NEW.cash_advance_id),
    balance = amount_issued - (SELECT COALESCE(SUM(amount), 0) FROM "M88_BMS".liquidation_items WHERE cash_advance_id = NEW.cash_advance_id),
    status = CASE 
      WHEN amount_issued - (SELECT COALESCE(SUM(amount), 0) FROM "M88_BMS".liquidation_items WHERE cash_advance_id = NEW.cash_advance_id) <= 0 THEN 'fully_liquidated'
      WHEN (SELECT COALESCE(SUM(amount), 0) FROM "M88_BMS".liquidation_items WHERE cash_advance_id = NEW.cash_advance_id) > 0 THEN 'partially_liquidated'
      ELSE 'outstanding'
    END,
    fully_liquidated_at = CASE 
      WHEN amount_issued - (SELECT COALESCE(SUM(amount), 0) FROM "M88_BMS".liquidation_items WHERE cash_advance_id = NEW.cash_advance_id) <= 0 THEN NOW()
      ELSE NULL
    END,
    updated_at = NOW()
  WHERE id = NEW.cash_advance_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_cash_advance_balance_m88
AFTER INSERT OR UPDATE OR DELETE ON "M88_BMS".liquidation_items
FOR EACH ROW EXECUTE FUNCTION "M88_BMS".update_cash_advance_balance();

-- Function: check overdue cash advances
CREATE OR REPLACE FUNCTION "M88_BMS".check_overdue_cash_advances()
RETURNS void AS $$
BEGIN
  UPDATE "M88_BMS".cash_advances
  SET status = 'overdue', updated_at = NOW()
  WHERE status IN ('outstanding', 'partially_liquidated') AND liquidation_due_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 10. REQUEST LIQUIDATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".request_liquidations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID NOT NULL,
  liquidation_no TEXT UNIQUE NOT NULL,
  status TEXT CHECK (status IN ('pending_submission', 'submitted', 'returned', 'verified', 'overdue')) DEFAULT 'pending_submission',
  due_at TIMESTAMP,
  submitted_at TIMESTAMP,
  reviewed_at TIMESTAMP,
  actual_amount DECIMAL(15,2),
  reimbursable_amount DECIMAL(15,2) DEFAULT 0,
  cash_return_amount DECIMAL(15,2) DEFAULT 0,
  shortage_amount DECIMAL(15,2) DEFAULT 0,
  cash_return_status TEXT,
  cash_returned_at TIMESTAMPTZ,
  cash_returned_confirmed_by TEXT,
  remarks TEXT,
  created_by UUID,
  reviewed_by UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rl_request_id_m88') THEN
    ALTER TABLE "M88_BMS".request_liquidations ADD CONSTRAINT fk_rl_request_id_m88 FOREIGN KEY (request_id) REFERENCES "M88_BMS".expense_requests(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rl_created_by_m88') THEN
    ALTER TABLE "M88_BMS".request_liquidations ADD CONSTRAINT fk_rl_created_by_m88 FOREIGN KEY (created_by) REFERENCES "M88_BMS".users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rl_reviewed_by_m88') THEN
    ALTER TABLE "M88_BMS".request_liquidations ADD CONSTRAINT fk_rl_reviewed_by_m88 FOREIGN KEY (reviewed_by) REFERENCES "M88_BMS".users(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rl_request_id ON "M88_BMS".request_liquidations(request_id);
CREATE INDEX IF NOT EXISTS idx_rl_status ON "M88_BMS".request_liquidations(status);
CREATE INDEX IF NOT EXISTS idx_rl_due_at ON "M88_BMS".request_liquidations(due_at);
CREATE INDEX IF NOT EXISTS idx_rl_cash_return_status ON "M88_BMS".request_liquidations(cash_return_status);

-- ============================================================
-- 11. REQUEST ATTACHMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".request_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID NOT NULL,
  liquidation_id UUID,
  attachment_scope TEXT CHECK (attachment_scope IN ('request', 'disbursement', 'liquidation')) DEFAULT 'request',
  attachment_type TEXT,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  storage_bucket TEXT,
  storage_path TEXT,
  mime_type TEXT,
  file_size_bytes BIGINT,
  uploaded_by UUID,
  uploaded_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ra_request_id_m88') THEN
    ALTER TABLE "M88_BMS".request_attachments ADD CONSTRAINT fk_ra_request_id_m88 FOREIGN KEY (request_id) REFERENCES "M88_BMS".expense_requests(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ra_liquidation_id_m88') THEN
    ALTER TABLE "M88_BMS".request_attachments ADD CONSTRAINT fk_ra_liquidation_id_m88 FOREIGN KEY (liquidation_id) REFERENCES "M88_BMS".request_liquidations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ra_uploaded_by_m88') THEN
    ALTER TABLE "M88_BMS".request_attachments ADD CONSTRAINT fk_ra_uploaded_by_m88 FOREIGN KEY (uploaded_by) REFERENCES "M88_BMS".users(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ra_request_id ON "M88_BMS".request_attachments(request_id);
CREATE INDEX IF NOT EXISTS idx_ra_liquidation_id ON "M88_BMS".request_attachments(liquidation_id);

-- ============================================================
-- 12. REQUEST ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES "M88_BMS".expense_requests(id) ON DELETE CASCADE,
  item_name VARCHAR(255) NOT NULL,
  category_id UUID REFERENCES "M88_BMS".budget_categories(id),
  amount DECIMAL(15,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ri_request_id ON "M88_BMS".request_items(request_id);

-- ============================================================
-- 13. REQUEST ALLOCATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".request_allocations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID,
  department_id UUID,
  amount DECIMAL(15,2) NOT NULL,
  created_by UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ral_request_id_m88') THEN
    ALTER TABLE "M88_BMS".request_allocations ADD CONSTRAINT fk_ral_request_id_m88 FOREIGN KEY (request_id) REFERENCES "M88_BMS".expense_requests(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ral_department_id_m88') THEN
    ALTER TABLE "M88_BMS".request_allocations ADD CONSTRAINT fk_ral_department_id_m88 FOREIGN KEY (department_id) REFERENCES "M88_BMS".departments(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ral_created_by_m88') THEN
    ALTER TABLE "M88_BMS".request_allocations ADD CONSTRAINT fk_ral_created_by_m88 FOREIGN KEY (created_by) REFERENCES "M88_BMS".users(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ral_request_id ON "M88_BMS".request_allocations(request_id);
CREATE INDEX IF NOT EXISTS idx_ral_department_id ON "M88_BMS".request_allocations(department_id);

-- ============================================================
-- 14. ALLOCATION LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".allocation_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID,
  actor_id UUID,
  action TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_al_request_id_m88') THEN
    ALTER TABLE "M88_BMS".allocation_logs ADD CONSTRAINT fk_al_request_id_m88 FOREIGN KEY (request_id) REFERENCES "M88_BMS".expense_requests(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_al_actor_id_m88') THEN
    ALTER TABLE "M88_BMS".allocation_logs ADD CONSTRAINT fk_al_actor_id_m88 FOREIGN KEY (actor_id) REFERENCES "M88_BMS".users(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_al_request_id ON "M88_BMS".allocation_logs(request_id);

-- ============================================================
-- 15. APPROVAL LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".approval_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID,
  actor_id UUID,
  action TEXT CHECK (action IN ('submitted', 'approved', 'rejected', 'returned', 'forwarded', 'released', 'comment')) NOT NULL,
  stage TEXT CHECK (stage IN ('supervisor', 'accounting', 'finance')) NOT NULL,
  note TEXT,
  timestamp TIMESTAMP DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_apl_request_id_m88') THEN
    ALTER TABLE "M88_BMS".approval_logs ADD CONSTRAINT fk_apl_request_id_m88 FOREIGN KEY (request_id) REFERENCES "M88_BMS".expense_requests(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_apl_actor_id_m88') THEN
    ALTER TABLE "M88_BMS".approval_logs ADD CONSTRAINT fk_apl_actor_id_m88 FOREIGN KEY (actor_id) REFERENCES "M88_BMS".users(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_apl_request_id ON "M88_BMS".approval_logs(request_id);

-- ============================================================
-- 16. REQUEST AUDIT LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".request_audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID NOT NULL,
  actor_id UUID,
  entity_type TEXT CHECK (entity_type IN ('request', 'allocation', 'attachment', 'liquidation', 'release')) NOT NULL,
  action TEXT NOT NULL,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  note TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ral2_request_id_m88') THEN
    ALTER TABLE "M88_BMS".request_audit_logs ADD CONSTRAINT fk_ral2_request_id_m88 FOREIGN KEY (request_id) REFERENCES "M88_BMS".expense_requests(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ral2_actor_id_m88') THEN
    ALTER TABLE "M88_BMS".request_audit_logs ADD CONSTRAINT fk_ral2_actor_id_m88 FOREIGN KEY (actor_id) REFERENCES "M88_BMS".users(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ral2_request_id ON "M88_BMS".request_audit_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_ral2_created_at ON "M88_BMS".request_audit_logs(created_at);

-- ============================================================
-- 17. AUDIT LOGS (system-wide)
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES "M88_BMS".users(id),
  user_name TEXT NOT NULL,
  user_role TEXT NOT NULL,
  department_id UUID REFERENCES "M88_BMS".departments(id),
  department_name TEXT,
  action_type TEXT NOT NULL,
  record_type TEXT,
  record_id UUID,
  record_label TEXT,
  old_value JSONB,
  new_value JSONB,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON "M88_BMS".audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON "M88_BMS".audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON "M88_BMS".audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_record_id ON "M88_BMS".audit_logs(record_id);

-- ============================================================
-- 18. BUDGET REVISION HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".budget_revision_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES "M88_BMS".budget_categories(id),
  department_id UUID REFERENCES "M88_BMS".departments(id),
  request_id UUID REFERENCES "M88_BMS".expense_requests(id),
  previous_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  proposed_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  approved_amount NUMERIC(15,2),
  fiscal_year INTEGER,
  revision_type TEXT DEFAULT 'budget_revision',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_brh_category ON "M88_BMS".budget_revision_history(category_id);

-- ============================================================
-- 19. DIRECT EXPENSES
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".direct_expenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id UUID,
  logged_by UUID,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  description TEXT,
  expense_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_de_department_id_m88') THEN
    ALTER TABLE "M88_BMS".direct_expenses ADD CONSTRAINT fk_de_department_id_m88 FOREIGN KEY (department_id) REFERENCES "M88_BMS".departments(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_de_logged_by_m88') THEN
    ALTER TABLE "M88_BMS".direct_expenses ADD CONSTRAINT fk_de_logged_by_m88 FOREIGN KEY (logged_by) REFERENCES "M88_BMS".users(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_de_department_id ON "M88_BMS".direct_expenses(department_id);

-- ============================================================
-- 20. PETTY CASH TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".petty_cash_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL,
  managed_by UUID NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('disbursement','replenishment','adjustment')),
  amount NUMERIC NOT NULL DEFAULT 0,
  purpose TEXT,
  reference_request_id UUID,
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pct_department_id_m88') THEN
    ALTER TABLE "M88_BMS".petty_cash_transactions ADD CONSTRAINT fk_pct_department_id_m88 FOREIGN KEY (department_id) REFERENCES "M88_BMS".departments(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pct_managed_by_m88') THEN
    ALTER TABLE "M88_BMS".petty_cash_transactions ADD CONSTRAINT fk_pct_managed_by_m88 FOREIGN KEY (managed_by) REFERENCES "M88_BMS".users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pct_reference_request_id_m88') THEN
    ALTER TABLE "M88_BMS".petty_cash_transactions ADD CONSTRAINT fk_pct_reference_request_id_m88 FOREIGN KEY (reference_request_id) REFERENCES "M88_BMS".expense_requests(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pct_department_id ON "M88_BMS".petty_cash_transactions(department_id);

-- ============================================================
-- 21. PETTY CASH FUND
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".petty_cash_fund (
  department_id UUID PRIMARY KEY,
  balance NUMERIC NOT NULL DEFAULT 0,
  low_balance_threshold NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 22. NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES "M88_BMS".users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON "M88_BMS".notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON "M88_BMS".notifications(created_at);

-- ============================================================
-- 23. APPROVAL DELEGATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".approval_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approver_id UUID NOT NULL REFERENCES "M88_BMS".users(id) ON DELETE CASCADE,
  delegate_id UUID NOT NULL REFERENCES "M88_BMS".users(id) ON DELETE CASCADE,
  delegated_role TEXT NOT NULL CHECK (delegated_role IN ('supervisor', 'vp', 'president')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NULL,
  note TEXT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_delegate_id ON "M88_BMS".approval_delegations(delegate_id);
CREATE INDEX IF NOT EXISTS idx_ad_approver_id ON "M88_BMS".approval_delegations(approver_id);
CREATE INDEX IF NOT EXISTS idx_ad_active ON "M88_BMS".approval_delegations(active);

-- ============================================================
-- 24. PROJECTS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_code TEXT UNIQUE NOT NULL,
  project_name TEXT NOT NULL,
  description TEXT,
  department_id UUID,
  client_name TEXT,
  start_date DATE,
  end_date DATE,
  budget_allocated DECIMAL(15,2) DEFAULT 0,
  budget_used DECIMAL(15,2) DEFAULT 0,
  status TEXT CHECK (status IN ('active', 'completed', 'on_hold', 'cancelled')) DEFAULT 'active',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_projects_department_id_m88') THEN
    ALTER TABLE "M88_BMS".projects ADD CONSTRAINT fk_projects_department_id_m88 FOREIGN KEY (department_id) REFERENCES "M88_BMS".departments(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_projects_department_id ON "M88_BMS".projects(department_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON "M88_BMS".projects(status);

-- FK: expense_requests.project_id -> projects
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_er_project_id_m88') THEN
    ALTER TABLE "M88_BMS".expense_requests ADD CONSTRAINT fk_er_project_id_m88 FOREIGN KEY (project_id) REFERENCES "M88_BMS".projects(id);
  END IF;
END $$;

-- ============================================================
-- 25. VENDORS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".vendors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_code TEXT UNIQUE NOT NULL,
  vendor_name TEXT NOT NULL,
  contact_person TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  tin TEXT,
  vat_registered BOOLEAN DEFAULT false,
  payment_terms TEXT,
  bank_name TEXT,
  bank_account_number TEXT,
  bank_account_name TEXT,
  category TEXT,
  remarks TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendors_vendor_name ON "M88_BMS".vendors(vendor_name);
CREATE INDEX IF NOT EXISTS idx_vendors_category ON "M88_BMS".vendors(category);

-- FK: expense_requests.vendor_id -> vendors
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_er_vendor_id_m88') THEN
    ALTER TABLE "M88_BMS".expense_requests ADD CONSTRAINT fk_er_vendor_id_m88 FOREIGN KEY (vendor_id) REFERENCES "M88_BMS".vendors(id);
  END IF;
END $$;

-- ============================================================
-- 26. SLA POLICIES
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".sla_policies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  policy_name TEXT NOT NULL,
  policy_type TEXT CHECK (policy_type IN ('liquidation', 'approval', 'receipt_submission', 'escalation')) NOT NULL,
  trigger_condition TEXT NOT NULL,
  deadline_days INT NOT NULL,
  escalation_action TEXT,
  escalation_user_id UUID,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sla_policies_type ON "M88_BMS".sla_policies(policy_type);
CREATE INDEX IF NOT EXISTS idx_sla_policies_active ON "M88_BMS".sla_policies(is_active);

-- ============================================================
-- 27. BUDGET ALERTS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".budget_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id UUID,
  project_id UUID,
  alert_type TEXT CHECK (alert_type IN ('threshold_warning', 'over_budget', 'threshold_exceeded')) NOT NULL,
  threshold_percentage INT DEFAULT 80,
  current_percentage DECIMAL(5,2) DEFAULT 0,
  amount_over DECIMAL(15,2) DEFAULT 0,
  status TEXT CHECK (status IN ('active', 'acknowledged', 'resolved')) DEFAULT 'active',
  acknowledged_by UUID,
  acknowledged_at TIMESTAMP,
  resolution_note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ba_department_id_m88') THEN
    ALTER TABLE "M88_BMS".budget_alerts ADD CONSTRAINT fk_ba_department_id_m88 FOREIGN KEY (department_id) REFERENCES "M88_BMS".departments(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ba_project_id_m88') THEN
    ALTER TABLE "M88_BMS".budget_alerts ADD CONSTRAINT fk_ba_project_id_m88 FOREIGN KEY (project_id) REFERENCES "M88_BMS".projects(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ba_department ON "M88_BMS".budget_alerts(department_id);
CREATE INDEX IF NOT EXISTS idx_ba_status ON "M88_BMS".budget_alerts(status);

-- ============================================================
-- 28. FISCAL ROLLOVERS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".fiscal_rollovers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL,
  from_year INTEGER NOT NULL,
  to_year INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fr_to_year ON "M88_BMS".fiscal_rollovers(to_year);

-- ============================================================
-- 29. EXPENSE CATEGORIES (master catalog)
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  description TEXT NOT NULL,
  main_category_code TEXT NOT NULL,
  main_category_name TEXT NOT NULL,
  department TEXT NOT NULL,
  manner_of_submission TEXT NOT NULL DEFAULT 'for_submission'
    CHECK (manner_of_submission IN ('for_submission', 'for_upload')),
  cash_advance_allowed BOOLEAN NOT NULL DEFAULT false,
  reimbursement_allowed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expense_categories_code_unique_m88 UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_ec_main_code ON "M88_BMS".expense_categories(main_category_code);
CREATE INDEX IF NOT EXISTS idx_ec_department ON "M88_BMS".expense_categories(department);
CREATE INDEX IF NOT EXISTS idx_ec_submission ON "M88_BMS".expense_categories(manner_of_submission);

-- ============================================================
-- 30. DOCUMENT UPLOADS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".document_uploads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category_code TEXT,
  category_name TEXT,
  main_category_code TEXT,
  main_category_name TEXT,
  department_id UUID,
  uploaded_by UUID,
  uploaded_by_role TEXT,
  description TEXT,
  amount DECIMAL(15,2),
  fiscal_year INT,
  adjustment_type VARCHAR(50),
  status TEXT DEFAULT 'pending',
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  accounting_remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 31. DOCUMENT UPLOAD ATTACHMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".document_upload_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  document_upload_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  file_size BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 32. TRAVEL BOOKINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".travel_bookings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  department_id UUID,
  request_id UUID,
  booking_code TEXT UNIQUE NOT NULL,
  booking_type TEXT,
  purpose TEXT,
  total_estimated_amount DECIMAL(15,2) DEFAULT 0,
  fiscal_year INT,
  flight_details JSONB DEFAULT '{}'::jsonb,
  notes TEXT,
  status TEXT DEFAULT 'pending_supervisor',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 33. TRAVEL BOOKING FLIGHTS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".travel_booking_flights (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID NOT NULL,
  sequence INT DEFAULT 1,
  origin_city TEXT,
  destination_city TEXT,
  airline TEXT,
  departure_date DATE,
  arrival_date DATE,
  terminal_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 34. TRAVEL BOOKING HOTELS
-- ============================================================
CREATE TABLE IF NOT EXISTS "M88_BMS".travel_booking_hotels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID NOT NULL,
  sequence INT DEFAULT 1,
  hotel_name TEXT,
  city_area TEXT,
  check_in_date DATE,
  check_out_date DATE,
  total_nights INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SEED DATA
-- ============================================================

-- Departments
WITH active_year AS (SELECT EXTRACT(YEAR FROM CURRENT_DATE)::INT AS fiscal_year)
INSERT INTO "M88_BMS".departments (name, annual_budget, fiscal_year)
SELECT name, annual_budget, fiscal_year
FROM (
  SELECT department_rows.name, department_rows.annual_budget, active_year.fiscal_year
  FROM (VALUES
    ('IT Department', 500000.00),
    ('Purchasing Department', 400000.00),
    ('Planning Department', 350000.00),
    ('Logistics Department', 450000.00),
    ('HR Department', 200000.00),
    ('Finance Department', 300000.00),
    ('Admin Department', 250000.00)
  ) AS department_rows(name, annual_budget)
  CROSS JOIN active_year
) AS vals(name, annual_budget, fiscal_year)
WHERE NOT EXISTS (
  SELECT 1 FROM "M88_BMS".departments d
  WHERE LOWER(TRIM(d.name)) = LOWER(TRIM(vals.name)) AND d.fiscal_year = vals.fiscal_year
);

-- Users (password for all: password123)
-- bcrypt hash: $2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu
WITH user_rows AS (
  SELECT * FROM (VALUES
    ('John Employee', 'john.employee@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'employee', 'IT Department'),
    ('Jane Supervisor', 'jane.supervisor@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'supervisor', 'IT Department'),
    ('Michael Accounting', 'michael@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'accounting', 'Finance Department'),
    ('Alice Admin', 'alice.admin@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'admin', 'Admin Department'),
    ('Management Executive', 'management@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'management', NULL),
    ('Sarah Super Admin', 'sarah.superadmin@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'super_admin', NULL)
  ) AS v(name, email, password_hash, role, department_name)
)
INSERT INTO "M88_BMS".users (name, email, password_hash, role, department_id)
SELECT u.name, u.email, u.password_hash, u.role, d.id
FROM user_rows u
LEFT JOIN "M88_BMS".departments d ON d.name = u.department_name
WHERE NOT EXISTS (SELECT 1 FROM "M88_BMS".users x WHERE x.email = u.email);

-- Cost Centers
INSERT INTO "M88_BMS".cost_centers (name, total_budget, remaining_amount, fiscal_year)
VALUES ('M88 Manila', 1000000, 1000000, 2026)
ON CONFLICT DO NOTHING;

-- SLA Policies
INSERT INTO "M88_BMS".sla_policies (policy_name, policy_type, trigger_condition, deadline_days, escalation_action) VALUES
  ('Cash Advance Liquidation', 'liquidation', 'cash_advance_released', 15, 'notify_supervisor'),
  ('Receipt Submission', 'receipt_submission', 'expense_incurred', 5, 'reminder'),
  ('Supervisor Approval', 'approval', 'request_submitted', 3, 'escalate_to_finance'),
  ('Finance Approval', 'approval', 'supervisor_approved', 5, 'auto_approve')
ON CONFLICT DO NOTHING;

-- Expense Categories
INSERT INTO "M88_BMS".expense_categories (
  code, description, main_category_code, main_category_name, department,
  manner_of_submission, cash_advance_allowed, reimbursement_allowed, updated_at
) VALUES
  ('6010.1', 'Zoom', '6010', 'Advertising and Promotion', 'HR', 'for_submission', true, true, NOW()),
  ('6010.2', 'LinkedIn', '6010', 'Advertising and Promotion', 'HR', 'for_submission', true, true, NOW()),
  ('6010.3', 'Advertising Other', '6010', 'Advertising and Promotion', 'HR', 'for_submission', true, true, NOW()),
  ('6020.1', 'Automobile Fuel', '6020', 'Automobile Expense', 'All', 'for_upload', true, true, NOW()),
  ('6020.2', 'Parking Fee', '6020', 'Automobile Expense', 'All', 'for_upload', true, true, NOW()),
  ('6020.3', 'Toll Expense', '6020', 'Automobile Expense', 'All', 'for_upload', true, true, NOW()),
  ('6020.4', 'Automobile Repairs', '6020', 'Automobile Expense', 'Admin', 'for_submission', true, true, NOW()),
  ('6020.5', 'Car Insurance', '6020', 'Automobile Expense', 'Admin', 'for_upload', false, false, NOW()),
  ('6020.6', 'Automobile Expenses-Registration', '6020', 'Automobile Expense', 'Admin', 'for_upload', false, false, NOW()),
  ('6040', 'Bank Service Charges', '6040', 'Bank Service Charges', 'Accounting', 'for_upload', false, false, NOW()),
  ('6041', 'Realized Forex Gain/Loss', '6041', 'Realized Forex Gain/Loss', 'Accounting', 'for_upload', false, false, NOW()),
  ('6170', 'Computer and Internet Expenses', '6170', 'Computer and Internet Expenses', 'IT', 'for_submission', true, true, NOW()),
  ('6240', 'Depreciation Expense', '6240', 'Depreciation Expense', 'Accounting', 'for_upload', false, false, NOW()),
  ('6330', 'Insurance Expense', '6330', 'Insurance Expense', 'Admin', 'for_upload', false, false, NOW()),
  ('6340', 'Interest Expense', '6340', 'Interest Expense', 'Accounting', 'for_upload', false, false, NOW()),
  ('6351', 'Business Tax/Licenses', '6350', 'Taxes & Licenses', 'Accounting', 'for_upload', true, true, NOW()),
  ('6352', 'Income Tax', '6350', 'Taxes & Licenses', 'Accounting', 'for_upload', false, false, NOW()),
  ('6430.1', 'Birthday Celebrations', '6430', 'Meals and Entertainment', 'All', 'for_submission', true, true, NOW()),
  ('6430.2', 'Training Meal', '6430', 'Meals and Entertainment', 'All', 'for_submission', true, true, NOW()),
  ('6430.5', 'Valentine''s Day Celebration', '6430', 'Meals and Entertainment', 'HR', 'for_submission', true, true, NOW()),
  ('6430.7', 'Representation', '6430', 'Meals and Entertainment', 'All', 'for_submission', true, true, NOW()),
  ('6430.8', 'Meals and Entertainment - Other (company events)', '6430', 'Meals and Entertainment', 'All', 'for_submission', true, true, NOW()),
  ('6490.1', 'Office Stationery & Supplies', '6490', 'Office Supplies', 'All', 'for_submission', true, true, NOW()),
  ('6490.2', 'Consumable & Pantry/Cleaning Supplies', '6490', 'Office Supplies', 'All', 'for_submission', true, true, NOW()),
  ('6490.3', 'Tools & Equipment', '6490', 'Office Supplies', 'HR', 'for_submission', true, true, NOW()),
  ('6490.4', 'Fire Extinguisher', '6490', 'Office Supplies', 'HR', 'for_submission', true, true, NOW()),
  ('6490.5', 'Office Supplies Other (Furnitures)', '6490', 'Office Supplies', 'HR', 'for_submission', true, true, NOW()),
  ('6501', 'Medical Expenses', '6500', 'Medical Records and Supplies', 'All', 'for_submission', true, true, NOW()),
  ('6650', 'Postage and Delivery', '6650', 'Postage and Delivery', 'All', 'for_submission', true, true, NOW()),
  ('6670.01', 'Professional Fees - Accounting', '6670', 'Professional Fees', 'Accounting', 'for_upload', false, false, NOW()),
  ('6670.08', 'BIR Compliance Service', '6670', 'Professional Fees', 'Accounting', 'for_upload', false, false, NOW()),
  ('6670.1', 'DOLE Establishment Report & 13th', '6670', 'Professional Fees', 'Accounting', 'for_upload', false, false, NOW()),
  ('6670.11', 'Filing of Annual GIS', '6670', 'Professional Fees', 'Accounting', 'for_submission', true, true, NOW()),
  ('6670.12', 'Fire Safety Inspection Certificate', '6670', 'Professional Fees', 'Accounting', 'for_upload', false, false, NOW()),
  ('6670.15', 'Nominee Directors Service', '6670', 'Professional Fees', 'Accounting', 'for_submission', true, true, NOW()),
  ('6670.17', 'Posted Transactions', '6670', 'Professional Fees', 'Accounting', 'for_submission', true, true, NOW()),
  ('6670.18', 'Posted Transactions Adjustment', '6670', 'Professional Fees', 'Accounting', 'for_upload', false, false, NOW()),
  ('6670.24', 'Notarization Fee', '6670', 'Professional Fees', 'Accounting', 'for_upload', false, false, NOW()),
  ('6711', 'Office Rent Expense', '6710', 'Rent Expense', 'Admin', 'for_upload', false, false, NOW()),
  ('6720', 'Repairs and Maintenance', '6720', 'Repairs and Maintenance', 'Admin', 'for_submission', true, true, NOW()),
  ('6840.1', 'Local Travel - Airline Expenses', '6840', 'Travel Expense', 'All', 'for_submission', true, true, NOW()),
  ('6840.2', 'Local Travel - Hotel', '6840', 'Travel Expense', 'All', 'for_submission', true, true, NOW()),
  ('6840.3', 'Foreign Travel - Airline Expenses', '6840', 'Travel Expense', 'All', 'for_submission', true, true, NOW()),
  ('6840.4', 'Foreign Travel - Hotel', '6840', 'Travel Expense', 'All', 'for_submission', true, true, NOW()),
  ('6840.5', 'Travel Expense - Other', '6840', 'Travel Expense', 'All', 'for_submission', true, true, NOW()),
  ('6840.6', 'Travel Expenses - Indo Representative', '6840', 'Travel Expense', 'Accounting', 'for_submission', true, true, NOW()),
  ('6860.1', 'Electricity', '6860', 'Utilities', 'Admin', 'for_upload', false, false, NOW()),
  ('6860.2', 'Water', '6860', 'Utilities', 'Admin', 'for_upload', false, false, NOW()),
  ('6860.3', 'Utilities Others (Aircon etc)', '6860', 'Utilities', 'Admin', 'for_upload', false, false, NOW()),
  ('6870.1', 'Globe', '6870', 'Communication', 'All', 'for_upload', true, true, NOW()),
  ('6870.2', 'Smart Bills', '6870', 'Communication', 'All', 'for_upload', true, true, NOW()),
  ('6870.3', 'PLDT Telephone', '6870', 'Communication', 'Admin', 'for_upload', false, false, NOW()),
  ('6870.5', 'Internet Subscription', '6870', 'Communication', 'Admin', 'for_upload', false, false, NOW()),
  ('6900.1', 'Seminar', '6900', 'Welfare - Employee', 'All', 'for_submission', true, true, NOW()),
  ('6900.2', 'HMO Expenses', '6900', 'Welfare - Employee', 'HR', 'for_submission', true, true, NOW()),
  ('6900.3', 'Uniform', '6900', 'Welfare - Employee', 'HR', 'for_submission', true, true, NOW()),
  ('6900.4', 'Staff Welfare', '6900', 'Welfare - Employee', 'HR', 'for_submission', true, true, NOW()),
  ('9900', 'Sundry & Misc', '9900', 'Sundry', 'All', 'for_submission', true, true, NOW())
ON CONFLICT (code) DO UPDATE SET
  description = EXCLUDED.description,
  main_category_code = EXCLUDED.main_category_code,
  main_category_name = EXCLUDED.main_category_name,
  department = EXCLUDED.department,
  manner_of_submission = EXCLUDED.manner_of_submission,
  cash_advance_allowed = EXCLUDED.cash_advance_allowed,
  reimbursement_allowed = EXCLUDED.reimbursement_allowed,
  updated_at = NOW();

-- ============================================================
-- VERIFICATION
-- ============================================================
SELECT 'tables created' as status, count(*) as table_count
FROM information_schema.tables 
WHERE table_schema = 'M88_BMS';

SELECT 'users' as table_name, count(*) as count FROM "M88_BMS".users
UNION ALL
SELECT 'departments', count(*) FROM "M88_BMS".departments
UNION ALL
SELECT 'expense_categories', count(*) FROM "M88_BMS".expense_categories
UNION ALL
SELECT 'sla_policies', count(*) FROM "M88_BMS".sla_policies
UNION ALL
SELECT 'cost_centers', count(*) FROM "M88_BMS".cost_centers;

SELECT id, name, email, role FROM "M88_BMS".users WHERE role = 'accounting';
