-- Add accounting_limited Role
-- This script adds a new role for accounting users with limited access
-- Limited Access: No fund disbursement, no budget matrix access

-- Step 1: Update the users table to allow the new role
-- The role column uses a CHECK constraint, so we need to add 'accounting_limited' to the allowed values

-- First, check the current constraint
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'public.users'::regclass 
AND conname LIKE '%role%';

-- Step 2: Drop the existing role constraint
ALTER TABLE public.users 
DROP CONSTRAINT IF EXISTS users_role_check;

-- Step 3: Add the new constraint with accounting_limited included
ALTER TABLE public.users 
ADD CONSTRAINT users_role_check 
CHECK (role IN ('employee', 'manager', 'supervisor', 'accounting', 'accounting_limited', 'management', 'admin', 'super_admin', 'vp', 'president'));

-- Verification query
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'public.users'::regclass 
AND conname LIKE '%role%';
