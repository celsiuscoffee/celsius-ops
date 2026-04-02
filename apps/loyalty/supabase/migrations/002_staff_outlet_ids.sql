-- Add outlet_ids array column to staff_users for multi-outlet assignment
ALTER TABLE staff_users ADD COLUMN outlet_ids UUID[] DEFAULT '{}';

-- Backfill: copy existing outlet_id into outlet_ids array
UPDATE staff_users SET outlet_ids = ARRAY[outlet_id] WHERE outlet_id IS NOT NULL AND (outlet_ids IS NULL OR outlet_ids = '{}');
