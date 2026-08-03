-- Repair the "+600xxxxxxxxx" malformed-phone artifact (applied live 2026-08-03).
--
-- A legacy bulk import (2026-03-29 batch, member ids member-1774739012831-*)
-- built phones as '+60' || <local number WITH its leading 0>, producing
-- '+600142877753' instead of '+60142877753'. These are GHOST records that
-- duplicate a real account. The SMS gateway still delivers to them, so a loop
-- would text the customer an offer while minting the voucher onto the ghost --
-- the customer then finds nothing in their wallet at the till (reported by a
-- customer 2026-08-03: "RM15 off RM50+" SMS, no voucher on their number).
--
-- 1) Re-home ACTIVE vouchers from ghosts onto the customer's real account.
UPDATE issued_rewards ir
SET member_id = good.id
FROM members bad, members good
WHERE ir.member_id = bad.id
  AND bad.phone LIKE '+600%'
  AND good.phone = '+60' || substring(bad.phone from 5)
  AND ir.status = 'active'
  AND (ir.expires_at IS NULL OR ir.expires_at > now());

-- 2) Ghosts with NO real twin are simply mis-typed: repair in place (no
--    collision possible because the target phone does not exist).
UPDATE members m
SET phone = '+60' || substring(m.phone from 5)
WHERE m.phone LIKE '+600%'
  AND NOT EXISTS (SELECT 1 FROM members g WHERE g.phone = '+60' || substring(m.phone from 5));

-- Ghosts that DO have a real twin are left in place on purpose: consolidating
-- them means merging points/visits/tier/missions across two rows, which is a
-- judgement call for the owner, not a migration. The loop engine now skips
-- '+600' phones (isMalformedPhone) so they can never be targeted or stranded
-- again while they await that merge.
