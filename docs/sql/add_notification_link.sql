-- Add link column to notifications table for click-to-redirect
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;
