-- Applied to prod (kqdcdhpnyuwrxqhbuyfl) 2026-07-12 via Supabase MCP
-- (migration name: drop_qa_monitor_tables).
--
-- Decommission the April-era QA monitor (qa-health / qa-autofix edge functions).
-- The pg_cron job 'qa-health-check' was unscheduled 2026-07-12; these tables
-- backed only that system (verified: no app code references them).

-- The qa_* tables are in prevent_drop_critical_tables()'s protected list
-- (added when the QA system was live). Remove ONLY those three entries;
-- every other protected table stays protected.
CREATE OR REPLACE FUNCTION public.prevent_drop_critical_tables()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  obj record;
  protected_tables text[] := ARRAY[
    'members','member_brands','point_transactions','brands',
    'rewards','redemptions','campaigns','products',
    'categories','orders','order_items','otp_codes','sms_logs',
    'sms_credits','rate_limits','app_settings','payment_gateway_config',
    'reward_configs','issued_rewards','product_overrides',
    'pos_orders','pos_order_items','pos_order_payments','pos_shifts',
    'pos_registers','pos_branch_settings','pos_kitchen_stations',
    'pos_printer_config','pos_promotions','pos_register_layouts',
    '_outlets_backup','_outlet_settings_backup'
  ];
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type = 'table' AND obj.object_name = ANY(protected_tables) THEN
      RAISE EXCEPTION 'BLOCKED: Cannot drop protected table "%".', obj.object_name;
    END IF;
  END LOOP;
END;
$function$;

DROP TABLE IF EXISTS public.qa_alerts;
DROP TABLE IF EXISTS public.qa_fix_rules;
DROP TABLE IF EXISTS public.qa_health_checks;
