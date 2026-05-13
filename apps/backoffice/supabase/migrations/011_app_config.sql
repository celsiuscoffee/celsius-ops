-- app_config: simple key/value store used by engagement settings.
-- Birthday and Referral pages on the backoffice both upsert into this
-- table; without it, every PUT /api/loyalty/{birthday,referral}-config
-- returns 500 "relation public.app_config does not exist" and the
-- form silently fails to save.

CREATE TABLE IF NOT EXISTS public.app_config (
  key        text PRIMARY KEY,
  value      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_config DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.app_config IS
  'Key/value app settings. Used by birthday-config, referral-config, and other singleton settings the backoffice exposes.';
