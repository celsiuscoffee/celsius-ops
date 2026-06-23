-- Delivery channel per loop assignment: 'push' (free, device-reachable members)
-- or 'sms' (the paid fallback). Set by sendRound's push-preferred delivery.
-- Null on rows that predate push delivery (those were all SMS). Lets the
-- scorecard split delivery and bill SMS-only once push volume is material.
alter table loop_assignments add column if not exists channel text;
