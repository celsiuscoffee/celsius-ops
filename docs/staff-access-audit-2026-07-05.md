# Staff access-control audit — 2026-07-05

QA of role-based access for outlet **STAFF** and **MANAGER** across every module
they touch: POS login, staff app, checklists, stock count, receiving, and their
own audit/performance data. Evidence gathered by a four-way code sweep
(pos-native + POS routes; apps/staff + staff-native; apps/backoffice; the
cross-app identity layer). Every finding below was read in source; the worst
were re-verified by hand (file:line cited).

This supersedes nothing — it sits alongside `docs/rls-access-map-2026-07-05.md`
(that doc covers the *database* RLS layer; this one covers the *application*
auth layer). The two intersect where routes use the anon Supabase key.

---

## Status of findings (updated 2026-07-05, later same day)

Parallel security work landed on `main` while this audit was being written, plus
the follow-up PRs it prompted. Current state of the findings below:

- **C-1** (order-app `/api/staff/*` unauthenticated) — **fixed twice over.**
  #697 added a `requireStaffSession` guard; the retired web KDS surface + its
  now-dead feed routes were then removed (decommission PR). The live
  `/api/orders/[orderId]/status` route + `staff-token.ts` are kept.
- **C-3** (staff `/api/dashboard` unauthenticated), **H-2** (`products/options`,
  `settings/stock-count` unauthenticated) — **auth added by #697**;
  `/api/dashboard` additionally gained non-admin outlet-scoping in the staff
  hotfix PR.
- **F-3** (audit `[id]` read/write unscoped), **F-4** (`transfers/[id]`
  cross-outlet injection), **F-8** (`switch-outlet` outlet escalation) —
  **fixed** in the staff hotfix PR.
- **RLS surface** (the anon-reachable tables this audit's DB sibling flagged) —
  **closed by #802** (`rls_disabled_in_public` 24→0).
- **Still open** (tracked, not yet fixed): **C-2** (POS `verify-manager` PIN
  oracle — OTA-coupled), **H-1** (backoffice `ops/audit-*` reachable by a STAFF
  cross-app token via the wrong `getSession` import), **H-4** (MANAGER
  over-reach across ~150 `requireAuth`-only backoffice routes), **H-5** (session
  revocation wired to nothing), **M-1** (`CUSTOMER_JWT_SECRET` fallback).

The structural recommendation in §5 (the mandatory `withAuth` guard + CI check)
still stands as the durable fix — the point-fixes above are exactly the
copy-paste drift it would prevent.

---

## TL;DR

The access model is **sound in design and haywire in implementation**. There is
one clean identity table (`User` with `role` + `outletId`) and one good gate
helper (`requireRole`) — but almost nothing uses it. Enforcement is
copy-pasted inline into ~470 routes, five apps each hand-roll their own
variant of "get the session," and page/UI gates are client-only. The result is
a boundary made of hundreds of independent lines, any one of which can be (and
several are) missing.

The intended rules — *STAFF does day-to-day ops scoped to their own outlet and
sees only their own performance; MANAGER supervises their outlet; finance/HR/
payroll is OWNER/ADMIN only* — are **correctly enforced for payroll, HR, and
finance**, and **broken almost everywhere else**: unauthenticated endpoints,
missing outlet scoping, a dead manager-PIN gate, and a cross-app token hole that
lets a STAFF login reach admin-console routes.

**Do not treat this as "tighten a few routes."** The findings are symptoms; the
root cause is structural (§2). Fix the structure and the symptom class closes.

---

## 1. How access works today (the actual mechanics)

- **One identity.** A single Prisma `User` table
  (`packages/db/prisma/schema.prisma:128`) backs every login. POS PIN,
  staff-app PIN, manager-app PIN, and backoffice password all resolve to the
  same row. `role` (OWNER|ADMIN|MANAGER|STAFF), `outletId`/`outletIds[]`,
  `appAccess[]`, and `moduleAccess` (JSON) live on that row. This part is good —
  there is no duplicated identity to keep in sync.
- **One JWT, shared across all apps.** Every app signs/verifies with the same
  `JWT_SECRET`; the cookie is `celsius-session`, made domain-wide by
  `AUTH_COOKIE_DOMAIN=.celsiuscoffee.com`. Shared-auth tokens carry **no
  audience claim** (`packages/auth/src/jwt.ts`). Only backoffice's *own* auth
  lib stamps `aud=backoffice`, and only on its cookie path. **Implication: a
  STAFF token minted by the staff app is a structurally valid session for every
  other app's API that verifies with the shared secret and doesn't check
  audience.**
- **Enforcement is per-route and inline.** `requireRole()` exists in
  `packages/auth` and is the right primitive — but it is called by **0 routes in
  apps/staff** and only **32 of ~470 routes in apps/backoffice**. The dominant
  pattern is a hand-written `getSession(); if (!session) 401;` followed
  (sometimes) by an inline `["OWNER","ADMIN"].includes(role)` check.
- **Pages/UI gates are client-only.** Both `apps/staff` `(ops)/layout.tsx`
  (`RouteAccessGuard`) and `apps/backoffice` `(admin)/layout.tsx` are
  `"use client"` components that fetch `/api/auth/me` and redirect in a
  `useEffect`. They hide nav; they stop nothing. Every real boundary is the API
  route, so any route missing a check is directly reachable.
- **Middleware does not gate roles.** `apps/staff` and `apps/backoffice`
  middleware do CSRF + security headers and, for *pages*, check only that a
  session cookie is *present* (not valid, not any particular role). `/api/*` is
  entirely exempt.

---

## 2. Why it's "haywire" — the structural root cause

Five separate problems compound into the mess:

1. **Three divergent `getSession`/`requireRole` implementations** with different
   guarantees, and routes pick the wrong one by accident:
   | Module | Cookie | Bearer | Audience check | Header role-trust |
   |---|---|---|---|---|
   | `apps/backoffice/src/lib/auth.ts` | ✓ | — | **enforces `aud=backoffice`** | never |
   | `@celsius/auth` (shared) | ✓ | ✓ | **none** | never |
   | `apps/backoffice/src/lib/pos-auth.ts` | ✓ | ✓ | none | **trusts `x-user-*`** (footgun) |
   Importing `getSession` from `@celsius/auth` in a backoffice route silently
   drops the cross-app audience protection. That single mistake is the direct
   cause of finding **H-1** below.

2. **No mandatory gate.** Because auth is a line you remember to write rather
   than a wrapper you can't forget, coverage is a function of copy-paste
   discipline. Sibling routes drift: `audits/[id]` DELETE is correctly scoped
   while `audits/[id]` GET/PATCH right next to it check nothing.

3. **Two parallel authorization systems that don't agree.** `role` (JWT) and
   `moduleAccess` (DB JSON). `moduleAccess` is enforced server-side by exactly
   **2 of ~470 backoffice routes** and **7 of 75 staff routes**; everywhere else
   it's nav-cosmetic. So the "MANAGER gets *these* modules" intent is a UI
   illusion — any authenticated manager can call any `requireAuth`-only API.

4. **Outlet scoping is opt-in, not structural.** `outletId` is a JWT claim, but
   most list/detail routes take `?outletId=` from the query string and trust it.
   Good routes pin non-admins to `session.outletId` (e.g.
   `staff/api/inventory`, `audits/*`); many don't. There is no shared helper
   that says "scope this query to the caller's outlet unless admin."

5. **The client is trusted for elevation.** The POS manager-PIN gate, the staff
   nav guard, and the backoffice module gate all live in the client. The server
   routes they "protect" accept the action regardless.

**Net:** the model is fine; the *enforcement surface* is 500 independent
decisions with no shared, unforgettable choke point. Every finding below is an
instance of one of these five.

---

## 3. Per-module access story (the 6 modules + manager)

Legend — **Gate:** none / auth-only (logged-in, no role/scope) / scoped
(outlet or self checked) / role (manager+) / module (moduleAccess key).

### 1. POS login (`apps/pos-native` → backoffice `/api/pos/*`)
- **Login:** PIN → `POST /api/pos/auth/pin`. Any ACTIVE user with a PIN whose
  outlet matches the client-selected outlet (or has null outlet). Sets a JWT
  cookie the native client **never sends back** — the POS then operates as an
  effectively **unauthenticated client**: catalog + sales writes go through the
  Supabase **anon key**, and cashier/outlet identity is client-supplied and
  unverified. No device authentication. Outlet is chosen from a free dropdown at
  login.
- **Elevation (void/discount/override):** gated by a manager-PIN prompt that is
  **client-side only and, for the whole-cart discount, dead code** — the gate
  compares `role === "staff"` but the JWT delivers `"STAFF"` (uppercase), so it
  never fires; per-line discount has no gate at all. The sale is written via the
  anon `create_pos_sale` RPC regardless, so even a firing gate is bypassable.
- **Shift open/close/reopen** (the cashless Z-report boundary): anon-key writes,
  no manager gate, client-supplied outlet. (No cash drawer / no post-sale
  refund flow exists in this cashless register — those actions aren't present to
  gate.)

### 2. Staff app (`apps/staff` web + `apps/staff-native`)
- **Login:** PIN (`/api/auth/pin`, `/api/auth/pin-native`) admits **STAFF** (the
  native "Manager Login" label is cosmetic). Password login
  (`/api/auth/login`) is MANAGER+ only. Correct — but it means every staff route
  must self-enforce, because STAFF holds a valid token.
- **Self-scoped surface (attendance, clock, payslips, leave, OT, availability,
  memos, reviews, profile):** **solid.** Every one derives the target user from
  `session.id` and never accepts a `userId` param; profile edits use a
  field allow-list that excludes salary/statutory data. This is the model the
  rest should copy.

### 3. Checklists (`apps/staff /api/checklists/*`)
- **Item toggle:** scoped (outlet-checked) ✓.
- **List / detail / generate:** auth-only — a staffer reads or generates any
  outlet's checklists via `?outletId=` or a guessed id. (F-5, F-6.)

### 4. Stock count (`apps/staff /api/stock-checks/*`)
- **Submit/finalize/delete/items:** scoped ✓; `countedById` is server-set from
  the session (good).
- **List:** auth-only with unguarded `?outletId=` → cross-outlet read. (F-5.)

### 5. Receiving (`apps/staff /api/receivings/*`, `/api/transfers/*`)
- **Create:** scoped ✓ (source outlet checked).
- **Receivings/transfers list:** auth-only `?outletId=` → cross-outlet read.
- **`PATCH /api/transfers/[id]`:** auth-only, **no outlet or role check** — any
  staffer can mark any transfer COMPLETED, which credits stock into an arbitrary
  destination outlet (`adjustStockBalance(toOutletId, …)`). Cross-outlet
  inventory injection. (F-4.)

### 6. Own audit / performance (`apps/staff /api/audits/*`)
- **List / staff history / coach / insights / create / delete:** correctly
  scoped — STAFF sees only their own; MANAGER sees their outlet; auditee outlet
  is checked. This is well built.
- **`audits/[id]` GET/PATCH and `items/[itemId]` PATCH:** auth-only, **no
  scoping** — any STAFF can read *and rewrite* any performance audit (their own
  or a colleague's scores/notes) by id. Directly violates "own performance data
  only," and lets staff tamper with evaluations. (F-3.) The sibling DELETE *is*
  scoped, which is exactly the copy-paste drift of §2.2.

### Manager (supervisory)
- **Correct:** SOP authoring, schedules, PO approve/send, payment-request
  (claims) flow, payslip page — all MANAGER+ gated server-side.
- **Broken — over-reach:** in backoffice, ~150 `requireAuth`-only routes are
  reachable by *any* MANAGER regardless of granted modules or outlet, including
  `pos/z-report`, `pos/tax-report`, `settings/system`, `loyalty/sms/blast`,
  `loyalty/manual-grant`, and `pos/maybank-qr-orders/[id]/release` (a payment
  release with no outlet scope). (H-4.)
- **Broken — scope escalation:** `POST /api/auth/switch-outlet` lets a MANAGER
  mint a session for **any** outlet — it checks the outlet exists, not that it's
  in the manager's `outletIds`. (F-8.)

---

## 4. Ranked findings

Severity = impact × reachability. **C** = critical, **H** = high, **M** =
medium, **F** = the ones already itemised above (medium unless noted).

### Critical

- **C-1 — Order-app `/api/staff/*` is fully unauthenticated over the service
  role.** `apps/order/src/app/api/staff/{orders,orders/feed,products,
  availability,outlet/busy}/route.ts` read a `?store=` param and hit the
  service-role Supabase client with **no session check** — the "staff session"
  is client-side `localStorage` only. Anyone on the internet can read full
  orders + `order_items` (customer PII) for any outlet, and PUT/POST to toggle
  menu availability and outlet busy state. The KDS/pickup shell depends on these
  routes. *(Verified: `orders/feed/route.ts` has no auth import; comment even
  says it moved reads server-side "so we can revoke anon SELECT" — but never
  added a caller check.)*

- **C-2 — `POST /api/pos/auth/verify-manager` is a public, unthrottled,
  company-wide manager-PIN oracle.** No auth, no rate limit, accepts any
  `{pin}` of length ≥4, and iterates **every** ACTIVE MANAGER/OWNER/ADMIN in the
  company (`verify-manager/route.ts:24`), returning `ok` + the manager's name on
  any match. 4–6 digit PINs are brute-forceable; a hit anywhere unlocks elevated
  POS actions at *any* outlet. `pos/auth/pin` shares the no-throttle exposure.

- **C-3 — `GET /api/dashboard` (staff app) has zero auth.** *(Verified — no
  `getSession` call.)* Any unauthenticated caller reads any outlet's weekly
  spend, pending approvals, wastage totals, and recent orders via `?outletId=`.

### High

- **H-1 — STAFF reaches backoffice ops/audit routes via the shared token.**
  Six `apps/backoffice/api/ops/audit-*` routes import `getSession` from
  `@celsius/auth` (audience-agnostic) and check only `if (!session)`. A STAFF
  bearer/cookie from the staff app is accepted → read all staff
  performance/audit/coaching data and create/edit/**delete** audit templates.
  Two of them (`audit-templates` GET, `[id]` GET) have **no auth at all** →
  world-readable. *(Verified: `audit-templates/route.ts` GET has no session
  call; POST imports `@celsius/auth`.)* This is the §2.1 wrong-import bug made
  real.

- **H-2 — Unauthenticated commercially-sensitive reads (staff app).**
  `GET /api/products/options` dumps the full catalog **with supplier names and
  cost prices**, no login. `/api/outlets`, `/api/settings/stock-count` also
  unauthenticated (lower sensitivity).

- **H-3 — POS service-role routes: no auth + no outlet binding.**
  `pos/order-status`, `pos/availability`, `pos/ordering-open`,
  `pos/grab/store-control`, and all `pos/loyalty/*` run on the service role with
  no auth and take the target `id`/`outlet_id` from the body. CSRF middleware
  only checks `Origin`/`Referer`, which a non-browser client sets freely. → mark
  any order served, 86 any product, open/close online + Grab ordering, and
  burn/grant loyalty for **any** outlet. Directly answers "can outlet A act on
  outlet B" — yes, at the API layer nothing binds the request to the caller.

- **H-4 — MANAGER over-reach in backoffice.** ~150 `requireAuth`-only routes are
  reachable by any manager regardless of `moduleAccess` or outlet, incl.
  financial Z/tax reports, `settings/system`, SMS blasts, loyalty grants, and
  the maybank-QR payment release (no outlet scope). The "modules per manager"
  system is enforced client-side only.

### Medium

- **H-5 / M — No session revocation or live-token deactivation.**
  `tokenRevokedAt` + `verifyTokenWithFreshness` are implemented but **called by
  zero routes**; password-reset writes `tokenRevokedAt` but nothing reads it. A
  resigned/deactivated employee keeps full access until token expiry — **7 days**
  (backoffice cookie) / 12h (shared). Login paths correctly check
  `status=ACTIVE`; live sessions are the hole.
- **F-3** — `audits/[id]` GET/PATCH + item PATCH: any STAFF reads/rewrites any
  audit. *(Verified.)*
- **F-4** — `transfers/[id]` PATCH: cross-outlet stock injection. *(Verified.)*
- **F-5** — Cross-outlet reads via unguarded `?outletId` on checklists,
  stock-checks, wastage, receivings, transfers, orders lists.
- **F-6** — `checklists/generate` unscoped.
- **F-7** — `GET /api/staff` enumerates every user (name/role/outlet) to any
  STAFF.
- **F-8** — `switch-outlet` lets a MANAGER jump to any outlet (no `outletIds`
  scope check). *(Verified.)*
- **M-1 — `CUSTOMER_JWT_SECRET` falls back to `JWT_SECRET`.** If the dedicated
  secret is unset, customer tokens and staff tokens share a signing key.
- **M-2 — `tools/print-bridge` has no auth** and takes an arbitrary target
  `ip:port` in the body (loopback-bound, so a "connect to any host" primitive
  for any code on the device).
- **M-3 — Legacy credential stores bypass deactivation.** Order-app staff-auth
  still falls back to `staff_members` (plaintext PIN) and a shared per-outlet
  `Outlet.staffPin`; neither honours `status=DEACTIVATED`.
- **M-4 — `lib/pos-auth.ts` still trusts `x-user-*` headers** — the exact
  impersonation pattern already neutered in `packages/auth`. Not used as a gate
  today; a future `requireRole` import from it reintroduces full impersonation.

### What's already right (keep these as the reference pattern)
- Payroll, HR, and finance APIs are correctly OWNER/ADMIN-gated and **not**
  STAFF/MANAGER-reachable.
- The self-scoped staff surface (attendance/payslips/leave/profile) derives the
  target from `session.id` — textbook.
- `audits/{list,staff/[userId],coach,create,delete}` scope correctly.
- `service-token.ts` is well-designed (scoped, 60s TTL, `aud=celsius-service`).
- PIN/password hashing is sound (bcrypt/scrypt, timing-safe, progressive
  rehash); the `x-user-*` trusted-proxy impersonation vector was found and
  neutered; login paths rate-limit and check `status=ACTIVE`; staff provisioning
  clamps manager grants to their own outlet/STAFF-only.

---

## 5. Proposed structure — make it "proper"

The goal is to convert 500 independent decisions into a few unforgettable choke
points. Four changes, in dependency order.

### 5.1 One auth entry point, audience-aware
Collapse the three `getSession`/`requireRole` variants into **one** shared
implementation that always verifies the JWT, always checks audience, and never
trusts headers. Mint tokens with an `aud` per surface (`pos`, `staff`, `kds`,
`backoffice`) and have each app's guard assert the audience it accepts. Delete
`pos-auth.ts`'s header-trust path. This kills H-1, M-4, and the whole "STAFF
token reaches app X" class.

### 5.2 A mandatory route gate (can't-forget-it)
Provide one wrapper every API route must use:
```ts
export const GET = withAuth(
  { roles: ["STAFF", "MANAGER"], module: "inventory:receivings", scope: "outlet" },
  async (req, { user, outletId }) => { /* handler gets a verified user + scoped outletId */ }
);
```
- `roles` — replaces inline `["OWNER","ADMIN"].includes(...)`.
- `module` — makes `moduleAccess` a **server** gate, not nav decoration
  (closes H-4's module half).
- `scope: "outlet" | "self" | "any"` — the wrapper derives `outletId`/`userId`
  from the token and refuses client params for non-admins (closes F-4, F-5, F-6,
  and the outlet half of H-4). `self` forces `where.userId = user.id`.
- Add a lint/CI check that every `route.ts` default-exports through `withAuth`
  (allow-list the genuinely-public ones explicitly). That converts §2.2 from
  "remember to" into "CI fails if you don't."

### 5.3 Real elevation for POS, server-side
- Bind the POS to a **device/session token** (issue at PIN login, send it as a
  bearer on every call) so the data layer knows the outlet and cashier. Move
  sales/shift writes off the raw anon key onto RPCs that read identity from the
  token, not the payload.
- Make manager elevation a **server-issued short-lived grant**: `verify-manager`
  should require the cashier's session, be **rate-limited + outlet-scoped**
  (only managers of *this* outlet), and return a signed 60s "elevation token"
  (reuse the `service-token.ts` design) that the void/discount/refund RPC
  verifies. Fix the dead `role === "staff"` comparison as a stopgap, but the
  real fix is server-verified elevation. Closes C-2, the dead-gate, and the
  anon-write bypass.

### 5.4 Lock the unauthenticated holes immediately (independent of the above)
These don't need the refactor and should land first as isolated fixes:
- C-1: add a staff-session (or KDS device-token) check to order-app
  `/api/staff/*`.
- C-3, H-2: add auth to `/api/dashboard`, `/api/products/options`,
  `/api/outlets`, `/api/settings/stock-count`, and the two `audit-templates`
  GET handlers.
- H-3: require a POS device token + bind `outlet_id` to it on the POS
  service-role routes.
- F-3: scope `audits/[id]` GET/PATCH + item PATCH like the sibling DELETE.
- F-8: check `outletIds` in `switch-outlet`.
- M-1: make `CUSTOMER_JWT_SECRET` required (no `JWT_SECRET` fallback).

### 5.5 Wire the revocation that already exists
`verifyTokenWithFreshness` + `tokenRevokedAt` are built — route the hot
verification paths through them, and have resign/deactivate bump
`tokenRevokedAt`. Closes H-5 without new schema. (Touches auth broadly — stage
behind a flag.)

---

## 6. Suggested sequencing

1. **Hotfix PR (this branch):** §5.4 — the unauthenticated/unscoped holes. Small,
   isolated, no schema, no payments logic. *Human review required; C-1/H-3 touch
   customer PII and outlet control.*
2. **Structure PR:** §5.1 + §5.2 — the shared guard + CI enforcement, migrate
   routes app-by-app (staff → backoffice → order). Mechanical once the wrapper
   exists.
3. **POS elevation PR:** §5.3 — device token + server-verified manager grants.
   *Keep a human in the loop (touches payments-adjacent void/discount).*
4. **Revocation PR:** §5.5 — behind a flag.

Payroll/HR/payments-touching changes and any migration stay
propose-then-approve per CLAUDE.md hard rule 6. Nothing in §5.4 alters payroll or
the ledger; C-2/§5.3 are POS-side and should go through the `ota-release` skill
before hitting live tills.
