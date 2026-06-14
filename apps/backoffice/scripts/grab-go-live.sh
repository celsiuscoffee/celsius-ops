#!/usr/bin/env bash
#
# GrabFood production cutover for the celsius-backoffice Vercel project.
#
# Sets the production GrabFood env vars, then redeploys. Your secret values
# stay LOCAL: fill apps/backoffice/.grab-prod.env (gitignored) from the Grab
# Developer Portal, then run this. No secret is echoed or committed.
#
#   cd apps/backoffice && ./scripts/grab-go-live.sh            # do it
#   cd apps/backoffice && ./scripts/grab-go-live.sh --dry-run  # preview only
#
set -euo pipefail
cd "$(dirname "$0")/.."   # → apps/backoffice (where .vercel/ links the project)

DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
ENVFILE=".grab-prod.env"

if [ ! -f "$ENVFILE" ]; then
  echo "Missing $ENVFILE — copy .grab-prod.env.example to it and fill in your"
  echo "production values from the Grab Developer Portal, then re-run."
  exit 1
fi
set -a; # shellcheck disable=SC1090
source "$ENVFILE"; set +a

# GRAB_PARTNER_JWT_SECRET is OURS (signs the tokens we hand Grab) — if you
# didn't set one, mint a stable random key now so token signing is decoupled
# from credential rotation.
: "${GRAB_PARTNER_JWT_SECRET:=$(openssl rand -hex 32)}"

VARS=(GRAB_ENV GRAB_CLIENT_ID GRAB_CLIENT_SECRET GRAB_MERCHANT_ID
      GRAB_PARTNER_CLIENT_ID GRAB_PARTNER_CLIENT_SECRET
      GRAB_HMAC_SECRET GRAB_PARTNER_JWT_SECRET)

echo "Will set on celsius-backoffice [production]:"
for v in "${VARS[@]}"; do
  if [ -n "${!v:-}" ]; then echo "  ✓ $v"; else echo "  ✗ $v (empty — skipped)"; fi
done

if [ "$DRY" = "1" ]; then echo "(dry-run — nothing changed)"; exit 0; fi
read -r -p "Apply to PRODUCTION now? [y/N] " ok; [ "$ok" = "y" ] || { echo "aborted"; exit 1; }

setvar() {
  local name="$1" val="${!1:-}"
  [ -n "$val" ] || { echo "  skip $name"; return; }
  vercel env rm "$name" production -y >/dev/null 2>&1 || true
  printf '%s' "$val" | vercel env add "$name" production >/dev/null
  echo "  set $name"
}
for v in "${VARS[@]}"; do setvar "$v"; done

echo "Redeploying production so the new env vars take effect…"
vercel deploy --prod --yes >/dev/null
echo

cat <<'EOF'
Done. Next:
  1. Verify (staff-auth):  https://backoffice.celsiuscoffee.com/api/pos/grab/health
                           → expect { ok:true, env:"production", tokenAcquired:true }
  2. Register these in the Grab Developer Portal → Partner configuration:
       OAuth token        https://backoffice.celsiuscoffee.com/api/pos/grab/oauth/token
       Submit order       https://backoffice.celsiuscoffee.com/api/pos/grab/webhook
       Push order state   https://backoffice.celsiuscoffee.com/api/pos/grab/webhook
       Get menu           https://backoffice.celsiuscoffee.com/api/pos/grab/merchant/menu
       Integration status https://backoffice.celsiuscoffee.com/api/pos/grab/status
       Menu sync          https://backoffice.celsiuscoffee.com/api/pos/grab/menu-sync
       Push grab menu     https://backoffice.celsiuscoffee.com/api/pos/grab/menus
  3. In BackOffice → Settings → Integrations → Grab: set each outlet's
     PRODUCTION merchant ID, then generate the self-serve activation link.
  4. Place a real GrabFood test order → confirm it lands in the order list.
EOF
