-- Expand campaign type constraint to allow more types
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_type_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_type_check
  CHECK (type IN ('multiplier', 'bonus', 'broadcast', 'cash_rebate', 'buy1free1', 'custom'));

-- Expand target_segment to allow more segments
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_target_segment_check;
-- If there was no constraint, this is a no-op. Add one now:
ALTER TABLE campaigns ADD CONSTRAINT campaigns_target_segment_check
  CHECK (target_segment IN ('all', 'new', 'active', 'inactive', 'birthday', 'eligible', 'custom'));
