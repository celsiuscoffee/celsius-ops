# Access-Control Guide — Roles, Apps & Modules

**Status:** reference / for verification · **Date:** 2026-07-05 · **Owner:** ops
**Companion to:** `docs/staff-access-audit-2026-07-05.md` (findings), `docs/rls-strategy.md` (DB layer)

This is the single, human-readable map of *who can reach what* across celsius-ops:
the role tiers, the app boundaries, and the grantable modules — how they work
today, where they contradict each other, and the recommended target model.

Read this top-to-bottom to verify the intended access matrix. Where today's
behaviour differs from the intent, it's called out as **⚠️ mess** with a file
citation so you can check it yourself.

---

## 1. The three layers

Access is decided by three independent layers. A request must pass **all** of them.

```
  ┌─────────────────────────────────────────────────────────────┐
  │ 1. ROLE        who you are          OWNER / ADMIN / MANAGER / STAFF
  │ 2. APP         where you logged in  audience claim (aud) + appAccess flag
  │ 3. MODULE      what you may open    moduleAccess[app] grants
  │ (+ outlet)     whose data           outletId / outletIds scope
  └─────────────────────────────────────────────────────────────┘
```

The identity record is one `User` row (`packages/db/prisma/schema.prisma:128`):

| Field | Type | Purpose |
|---|---|---|
| `role` | `OWNER\|ADMIN\|MANAGER\|STAFF` | Coarse tier. **OWNER/ADMIN bypass all module gates.** |
| `outletId` | `String?` | Home outlet. |
| `outletIds` | `String[]` | Extra outlets a manager may act in / switch to. |
| `appAccess` | `String[]` | Which apps / nav areas are offered (UX gate — see §3). |
| `moduleAccess` | `Json` | Granular `{ app: true \| [keys] }` grants (§4). |
| `permissions` | `String[]` | **Legacy / unused** — not read by any access helper. |
| `pin` | `String?` | POS / native lock-screen PIN. |
| `status` | `ACTIVE\|DEACTIVATED` | Deactivated = login blocked (**but see §6 revocation gap**). |
| `tokenRevokedAt` | `DateTime?` | Scaffolding for session revocation — **currently dead** (§6). |

---

## 2. Roles

Four roles only (`schema.prisma:195`). Roles are a **tier**, not a permission set —
the granular permissions live in the app + module layers.

| Role | Intent | Module gates? | Notes |
|---|---|---|---|
| **OWNER** | Business owner. | **Bypassed** — sees everything. | Reserve the irreversible grants (payroll, `settings:staff`, finance). |
| **ADMIN** | Head-office admin. | **Bypassed** — sees everything. | Same power as OWNER in code; separate it by *convention* + human-in-loop. |
| **MANAGER** | Outlet manager. | **Enforced.** | Outlet-scoped. Can create STAFF and grant them a subset of their own access. |
| **STAFF** | Floor staff. | **Enforced.** | Outlet-scoped. Operational modules only. |

**Key rule (`apps/staff/src/lib/access.ts:24`, `hasAccess`):**
`OWNER` and `ADMIN` short-circuit to `true` before `moduleAccess` is even read.
So module grants **only matter for MANAGER and STAFF.**

**Manager grant-clamping (`apps/backoffice/src/lib/staff-grants.ts`,
`clampGrantsToCaller`):** a MANAGER creating/editing a STAFF user cannot grant an
app or module they don't personally hold, and (via `settings/staff` route) can
only create the `STAFF` role. OWNER/ADMIN can grant anything.

---

## 3. Apps

> **This is the layer that feels "very messy," and it's because there are two
> mechanisms that don't agree.**

### 3a. Audience claim (`aud`) — the *real* boundary

Every app signs the **same** `celsius-session` cookie with the **same**
`JWT_SECRET`, and with `AUTH_COOKIE_DOMAIN=.celsiuscoffee.com` the cookie is sent
across every subdomain. The only thing separating apps on the cookie path is the
JWT **audience** claim:

- Backoffice mints + verifies `aud="backoffice"` (`apps/backoffice/src/lib/auth.ts:20`,
  `getSession` / `getUserFromHeaders`).
- Staff app, POS-native and loyalty sign the same cookie with their own audiences.

This is cryptographic and is the true "which app can you log into" gate.

**⚠️ mess — the Bearer path is audience-agnostic by design**
(`apps/backoffice/src/lib/auth.ts:101`, `verifyToken`). It's used by the native
sales dashboard, but any route that reaches for it (or for the audience-agnostic
`pos-auth.ts getSession`) drops the app boundary. This is audit finding **H-1**.

**⚠️ mess — three divergent auth modules** all define their own
`getSession`/`requireRole`:
- `packages/auth/src/` — the canonical, audience-aware set.
- `apps/backoffice/src/lib/auth.ts` — backoffice cookie, enforces `aud="backoffice"`.
- `apps/backoffice/src/lib/pos-auth.ts` — POS path, **audience-agnostic**.

Routes pick one by import, sometimes by accident. (`apps/order/src/lib/staff-auth.ts`
was a fourth — **removed** by #800.)

### 3b. `appAccess` flag — a per-user nav/entry list (UX, not security)

Set in Settings → Staff & Access. Allowed values
(`apps/backoffice/src/app/(admin)/settings/staff/page.tsx:239`):

```
["backoffice", "pickup", "inventory", "loyalty", "sales", "ops", "kds", "staff_app", "order"]
```

**⚠️ mess — this list conflates real apps with backoffice nav sections.**
Only four are standalone apps; the rest are areas *inside* backoffice.

### 3c. The real apps

| App | `appAccess` value | Objective | Who logs in | Deploy note |
|---|---|---|---|---|
| **Backoffice** (`apps/backoffice`, :3003) | `backoffice` | Admin console: finance, inventory, HR/payroll, procurement, marketing | OWNER / ADMIN / MANAGER | Web (Vercel) |
| **Staff PWA** (`apps/staff`, :3006) | `staff_app` | Floor web app: checklists, stock count, receiving, wastage, transfers | STAFF / MANAGER | Web |
| **Staff-native** ("Celsius Manager") | `staff_app` | Manager native app: sales dashboard, ops | MANAGER (+ ADMIN) | **OTA — hard rule 5** |
| **POS-native** ("Celsius POS", SUNMI) | **— none —** | The till | Any active outlet user via **PIN lock-screen** | **OTA — hard rules 5 & 6** |
| **Pickup / KDS** (`apps/pickup`, `pickup-native`) | `kds` | Kitchen pickup display | Outlet device | pickup-native OTA |
| **Order** (`apps/order`, :3007) | `order` | Customer online ordering | Customers (not `User` rows) | Web · see `apps/order/AGENTS.md` (hard rule 3) |

### 3d. `appAccess` values that are *really backoffice nav sections*

These gate which sidebar area shows once you already hold `backoffice`:

`pickup` · `inventory` · `loyalty` · `sales` · `ops`

Plus four **auto-granted** whenever a user holds `backoffice`
(`BACKOFFICE_SUB_APPS`, `apps/backoffice/src/lib/modules.ts:334`):

`settings` · `hr` · `reviews` · `ads`

### 3e. Two concrete quirks to verify

- **POS has no `appAccess` gate at all.** Any active `User` with a PIN at the
  register can unlock the till — access is the PIN + being on the device, not a
  flag. Same surface as audit finding **C-2** (the unthrottled manager-PIN
  oracle at `pos/auth/verify-manager`).
- **OWNER/ADMIN get a hardcoded app set on save** (`page.tsx:175`):
  `["backoffice", "inventory", "sales", "loyalty", "pickup", "ops"]` — which
  **omits `staff_app`, `kds`, `order`**. Role-bypass lets them in anyway, so the
  flag and the role openly disagree. This is the clearest symptom of the mess.

---

## 4. Modules (grantable)

Canonical registry: `apps/backoffice/src/lib/modules.ts` (`APP_MODULES`) — the
**single source of truth**. The Staff & Access editor builds its toggles from it,
and the backoffice sidebar gates nav on the same `${app}:${key}` keys (a dev-time
check warns if they drift). A grant is stored as `moduleAccess[app] = true` (whole
app) or `moduleAccess[app] = ["key", ...]` (specific modules).

> `finance:*` is **intentionally absent** — Finance is OWNER/ADMIN-only and can
> never be granted to a manager (`modules.ts:10`).

### Pickup / POS — `pickup:*`
| Key | Objective |
|---|---|
| `orders` | Live order queue for the outlet (KDS-style feed) |
| `menu` | Products & splash posters shown to customers |
| `settings` | POS, printers, table-QR & pickup config (also powers Sales→Reports + cashier performance) |

### Procurement / Inventory — `inventory:*`
| Key | Objective |
|---|---|
| `products` | Ingredients master + inventory dashboard |
| `perishables` | Perishable-item management |
| `packaging` | Packaging materials |
| `suppliers` | Supplier master data |
| `categories` | Item groups & storage locations |
| `menus` | Menu & BOM (recipes / bill of materials) |
| `orders` | Purchase Orders (raise / approve POs) |
| `receivings` | Goods-in against POs |
| `invoices` | Supplier invoices |
| `pay-and-claim` | Payment requests / staff claims |
| `stock-count` | Stock counting |
| `wastage` | Wastage logging |
| `transfers` | Inter-outlet stock transfers |
| `par-levels` | Par levels driving auto-reorder |
| `reports` | Inventory analytics |

### Rewards / Loyalty — `loyalty:*`
| Key | Objective |
|---|---|
| `dashboard` | Area loyalty scorecard |
| `members` | Customer / member records — **PII** |
| `rewards` | Challenges, mystery, manual grant, tiers & discount-engine setup |
| `redemptions` | Vouchers, redemptions & points log |
| `campaigns` | Loyalty campaigns |
| `engage` | Engagement / messaging loops (SMS) |

### Sales — `sales:*`
| Key | Objective |
|---|---|
| `dashboard` | Sales dashboard & compare |

### Ops — `ops:*`
| Key | Objective |
|---|---|
| `performance` | Ops dashboard & outlet performance |
| `audit` | Performance audits |
| `sops` | SOPs & templates |
| `categories` | Ops categories |
| `chat-inbox` | Ops Workspace (chat inbox) |

### HR — `hr:*`
| Key | Objective |
|---|---|
| `dashboard` | HR dashboard & analytics |
| `attendance` | Attendance records |
| `schedules` | Schedules, availability & coverage |
| `leave` | Leave requests |
| `overtime` | Overtime |
| `payroll` | Payroll runs & statutory — **sensitive (hard rule 6)** |
| `employees` | Employee records & certifications — **PII** |
| `performance` | Monthly performance scores |
| `allowances` | Allowances |
| `review-penalties` | Review penalties |
| `memos` | Memos |
| `settings` | HR settings |

### Marketing — `reviews:*`, `ads:*`
| Key | Objective |
|---|---|
| `reviews:list` | All customer reviews |
| `reviews:settings` | Reviews config |
| `ads:overview` | Google Ads overview |
| `ads:campaigns` | Ad campaigns |
| `ads:invoices` | Ad invoices |
| `ads:settings` | Ad settings |
| `ads:grab` | GrabFood marketing (campaigns & ad spend) |

### Settings — `settings:*` (administrative)
| Key | Objective |
|---|---|
| `outlets` | Hub & outlet configuration |
| `staff` | **Staff & Access — user management + permission granting (keys to the kingdom)** |
| `rules` | Approval rules (spend thresholds) |
| `integrations` | Third-party integrations |
| `stock-count` | Stock-count system settings |
| `system` | System-level settings |

### Finance — `finance:*` — **not grantable, OWNER/ADMIN only**
The agentic finance module: ledger, P&L, exception inbox, the 8 finance agents.
See `docs/finance-module-spec.md` and the `finance-module` skill.

**⚠️ mess — known registry drift:** the staff app gates `/checklists` and
`/schedules` on `ops:checklists` (`apps/staff/src/lib/access.ts:49,51`), but
`ops:checklists` **is not in the registry** (ops only defines
performance/audit/sops/categories/chat-inbox). So that toggle can't be granted in
the editor — it silently never appears. Fix: add `{ label: "Checklists", key:
"checklists" }` to `APP_MODULES.ops`.

---

## 5. Recommended access matrix (the thing to verify)

`OWNER`/`ADMIN` bypass module gates, so the grant columns are the **defaults for
MANAGER and STAFF**. `✅` = grant, `⚠️` = optional / read-only, `❌` = deny.

### 5a. Apps

| App | STAFF | MANAGER | ADMIN | OWNER |
|---|:--:|:--:|:--:|:--:|
| POS-native (till, PIN) | ✅ | ✅ | ✅ | ✅ |
| Staff PWA (`staff_app`) | ✅ | ✅ | ✅ | ✅ |
| Staff-native (Manager app) | ❌ | ✅ | ✅ | ✅ |
| Pickup / KDS (`kds`) | device | device | ✅ | ✅ |
| Backoffice (`backoffice`) | ❌ | ✅ (scoped nav) | ✅ | ✅ |
| Order app | customer-facing | — | — | — |

### 5b. Modules

| Module group | STAFF | MANAGER | ADMIN | OWNER |
|---|:--:|:--:|:--:|:--:|
| `pickup:orders`, `pickup:menu` | ✅ orders | ✅ | ✅ | ✅ |
| `pickup:settings` | ❌ | ✅ | ✅ | ✅ |
| `sales:dashboard` | ❌ | ✅ | ✅ | ✅ |
| `inventory:` stock-count, wastage, transfers, receivings, pay-and-claim | ✅ | ✅ | ✅ | ✅ |
| `inventory:` products, perishables, packaging, suppliers, categories, menus, par-levels, reports | ❌ | ✅ | ✅ | ✅ |
| `inventory:orders` (PO) | ❌ | ✅ raise (approve via `rules`) | ✅ | ✅ |
| `ops:sops` | ✅ read | ✅ | ✅ | ✅ |
| `ops:` performance, audit, categories, chat-inbox | ❌ | ✅ | ✅ | ✅ |
| `loyalty:members` (PII) | ❌ | ✅ own outlet | ✅ | ✅ |
| `loyalty:` dashboard, rewards, redemptions, campaigns, engage | ❌ | ⚠️ optional | ✅ | ✅ |
| `hr:` attendance, schedules, leave, overtime | ❌ | ✅ own team | ✅ | ✅ |
| `hr:` employees, performance, allowances, memos, review-penalties, dashboard | ❌ | ⚠️ read-only | ✅ | ✅ |
| **`hr:payroll`** | ❌ | ❌ | ✅ | ✅ |
| `reviews:*`, `ads:*` | ❌ | ❌ | ✅ | ✅ |
| `settings:` outlets, rules | ❌ | ❌ | ✅ | ✅ |
| **`settings:` staff, system, integrations** | ❌ | ❌ | ⚠️ OWNER-preferred | ✅ |
| **`finance:*`** | ❌ | ❌ | ✅ | ✅ |

**Principle:** STAFF get only the *doing* modules (count, receive, log wastage,
transfer, submit claims, read SOPs). MANAGER get the full *run-my-outlet* set but
**not** payroll, staff-provisioning, integrations, ads, or finance. The three
genuinely dangerous grants — `settings:staff` (can re-grant anyone anything),
`hr:payroll` (money out), `finance:*` — stay pinned to OWNER, ADMIN as a
controlled second.

### 5c. Seed grants (copy-paste `moduleAccess` JSON)

**Default STAFF** (`role: "STAFF"`, `appAccess: ["staff_app"]`, `outletId` set):
```json
{
  "inventory": ["stock-count", "wastage", "transfers", "receivings", "pay-and-claim"],
  "pickup": ["orders"],
  "ops": ["sops"]
}
```

**Default MANAGER** (`role: "MANAGER"`, `appAccess: ["staff_app","backoffice","inventory","sales","loyalty","pickup","ops"]`, `outletId` + `outletIds` set):
```json
{
  "pickup": ["orders", "menu", "settings"],
  "sales": ["dashboard"],
  "inventory": true,
  "ops": ["performance", "audit", "sops", "categories", "chat-inbox"],
  "loyalty": ["dashboard", "members"],
  "hr": ["attendance", "schedules", "leave", "overtime"]
}
```

> `"inventory": true` grants the whole app group; swap for an array to narrow it.

---

## 6. Open gaps (verify against the audit)

These are live weaknesses, each tracked in `docs/staff-access-audit-2026-07-05.md`.
The **durable fix** for all of them is the structural `withAuth({ roles, module,
scope })` wrapper + CI check proposed in the audit §5.

| ID | Gap | Status |
|---|---|---|
| **C-2** | `pos/auth/verify-manager` — public, unthrottled company-wide manager-PIN oracle | open (OTA/payments — hard rule 6) |
| **H-1** | STAFF token reaches backoffice `ops/audit-*` via audience-agnostic `getSession` | open (needs audience-import fix) |
| **H-4** | Manager over-reach beyond own outlet on some routes | open |
| **H-5** | **Session revocation is dead code** — `tokenRevokedAt` / freshness check built but wired to nothing; a DEACTIVATED user's existing token keeps working up to 7 days (`apps/backoffice/src/lib/auth.ts:22-41`) | open (behind-flag rollout) |
| **M-1** | Secret fallback / config hardening | open |
| — | **Registry drift**: `ops:checklists` gated but not grantable (§4) | open (one-line fix) |
| — | **`appAccess` conflates apps + nav sections** (§3b) | open (recommend migration) |

### Recommended target model
1. **Collapse `appAccess` to real apps only** — `backoffice`, `staff_app`, `kds`
   — and move `inventory/sales/loyalty/pickup/ops` fully into `moduleAccess`
   where they belong.
2. **Make the audience claim the enforced app boundary** on every route via one
   audience-aware `withAuth` wrapper (kills the three-divergent-modules problem).
3. **Wire the revocation** that already exists (`tokenRevokedAt`), behind a flag,
   using Redis not a per-request DB query.
4. Then `appAccess` reverts to pure nav UX and can't be mistaken for security.

---

## 7. How to verify this document

- **Roles:** `packages/db/prisma/schema.prisma:195` (`enum UserRole`).
- **App audience:** `apps/backoffice/src/lib/auth.ts:20` (`AUDIENCE`), `:83`, `:118`.
- **appAccess values:** `apps/backoffice/src/app/(admin)/settings/staff/page.tsx:239`.
- **OWNER/ADMIN hardcoded apps:** same file, `:175`.
- **Auto sub-apps:** `apps/backoffice/src/lib/modules.ts:334` (`BACKOFFICE_SUB_APPS`).
- **Module registry:** `apps/backoffice/src/lib/modules.ts` (`APP_MODULES`).
- **Access decision:** `apps/staff/src/lib/access.ts:18` (`hasAccess`).
- **Grant clamping:** `apps/backoffice/src/lib/staff-grants.ts` (`clampGrantsToCaller`).
- **Findings:** `docs/staff-access-audit-2026-07-05.md`.
