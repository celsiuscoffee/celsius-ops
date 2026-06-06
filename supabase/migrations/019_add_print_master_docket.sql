-- Per-outlet "Counter master docket" default, editable from Backoffice POS Settings.
-- The POS till reads this as the outlet default for the consolidated full-order
-- ("ORDER") expo slip the D3 prints (see apps/pos-native/lib/network-printer.ts
-- routeKitchenDockets); a till may still override locally (lib/print-prefs.ts).
-- Default true preserves the prior always-on behaviour for every existing outlet.
ALTER TABLE pos_branch_settings
  ADD COLUMN IF NOT EXISTS print_master_docket boolean NOT NULL DEFAULT true;
