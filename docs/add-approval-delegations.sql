-- Adds approval delegation support so supervisors, VPs, and presidents can delegate approval duties.

CREATE TABLE IF NOT EXISTS approval_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approver_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delegate_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delegated_role text NOT NULL CHECK (delegated_role IN ('supervisor', 'vp', 'president')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NULL,
  note text NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_delegations_delegate_id ON approval_delegations(delegate_id);
CREATE INDEX IF NOT EXISTS idx_approval_delegations_approver_id ON approval_delegations(approver_id);
CREATE INDEX IF NOT EXISTS idx_approval_delegations_active ON approval_delegations(active);
