-- Add adjustment_type column to document_uploads table
-- This column tracks the type of budget adjustment (increase, decrease, reallocation)

ALTER TABLE document_uploads 
ADD COLUMN IF NOT EXISTS adjustment_type VARCHAR(50);

-- Add comment to document the column
COMMENT ON COLUMN document_uploads.adjustment_type IS 'Type of budget adjustment: increase, decrease, or reallocation';
