# Back-office structure: applying the "office structure" template to Celsius

Status: **2026-11-11. Step 1 (the menu shell) is built** (see section 2a). The rest is a proposal.
Source: the Gosamē "Office structure: a template for the Celsius back office" note,
checked here against what `apps/backoffice` really contains today
(`src/lib/nav.tsx`, 175 `page.tsx` routes).

---

## 1. What the audit found

| Measure | Today | Gosamē before its fix |
|---|---|---|
| Routes (`page.tsx`) | **175** (13 of them detail pages such as `/hr/employees/[id]`) | ~97 |
| Sidebar links (visible) | **86** across 9 sections (103 registered, 17 hidden) | 72 |
| Pages missing from the nav registry | **~60**, so ⌘K can't find them. **26** of these aren't under any registered URL either, so the client-side route gate in `(admin)/layout.tsx` doesn't check them (all `/finance/*` extras, `/pos/z-report`, `/pos/tax-report`, `/pos/maybank-qr`, `/pickup/customers`, `/pickup/analytics`, `/ops/audit-*`, `/ops/compliance`, `/ops/schedules`, `/ops/staff-skills`, `/inventory/ai-decisions`, `/inventory/agent-qa`, `/inventory/categories`, `/loyalty/insights`, `/loyalty/push-reminders`) | ~25 |
| Page-view data | **None.** `ActivityLog` records actions (create, approve), not visits | Had a usage page |

What Celsius already does well, and should keep:

- **One nav registry** (`nav.tsx`) that drives the sidebar, ⌘K and the route gate. Changing
  labels and grouping never breaks URLs. That makes Step 1 below cheap.
- **`/dashboard` is already most of "Today":** sales against target by outlet, a dine-in /
  takeaway / delivery split, serve time, COGS %, wastage and people cost.
- **HR already uses tabs inside the module** (`components/hr/module-tabs.tsx`), with one
  sidebar entry for each module. That is the template's tab rule; the other sections don't
  follow it yet.
- **A Settings section, with the hub tile page hidden.**

### Same problems as Gosamē, with Celsius page names

| Problem | Where it shows up |
|---|---|
| **One job spread over many pages** | **Buying:** 10 pages (Purchase Orders chat, PO List, Create PO, Receivings, Invoices, Reconciliation, Payment Requests, payment batches, AI Decisions, Agent QA). **Stock:** 9 pages plus 7 report sub-pages (Stock Count, Wastage, Par Levels, Perishables, Transfers, Ingredients, Groups & Storage, Categories, Reports). **Sales:** 8 pages from 2 sources (`/dashboard`, `/sales/dashboard`, `/sales/compare`, `/pos/reports`, `/pos/z-report`, `/pos/tax-report`, `/pickup/analytics`, `/pickup`) |
| **One clock-in checked in several places** | `/hr/attendance`, `/hr/roster-attendance`, `/hr/pt-hours`, `/hr/overtime`, and the shift report in `/pos/z-report` |
| **Several scoring systems** | `/hr/performance` (Allowance + Scorecard), `/ops/performance` (+ `/ops/performance/staff/[id]`), `/pos/cashier-performance`, `/loyalty/dashboard` ("Area Scorecard"), `/reviews/scoreboard` ("Rank Scoreboard"), `/hr/review-penalties`, `/ops/staff-skills` |
| **Two pages with the same name** | "Reconciliation" (`/inventory/reconciliation` = invoice against PO, `/finance/recon` = bank against books). "Campaigns" (`/loyalty/loops` and `/ads/campaigns`). "Reports" in 4 sections. "Dashboard" in 5 |
| **Two customer pages** | `/loyalty/members` (in the nav) and `/pickup/customers` (not in the nav) |
| **Decisions scattered** | Leave, overtime and shift swaps (HR) · Payment Requests (Procurement) · invoice mismatches · finance exceptions (`/finance`, hidden) · agent proposals (`agent_actions`, shown under Settings → AI Agents) · Feedback Management (Marketing) · audit follow-ups (Ops). **Nothing shows a manager everything waiting on them in one place** |
| **Settings scattered** | 8 HR settings pages under `/hr/settings/*` (only one is in the nav), loyalty set-up mixed into Settings, Grab integration on its own page |

---

## 2. The menu for Celsius

The template's menu, changed in three places for Celsius:

- **CK stays.** Celsius has prep recipes (raw → prepped), `prep-labour` reports, and a
  central kitchen mentioned in the code. Confirm with ops whether it moves stock to outlets
  as a real transfer. If it doesn't, merge CK into Stock.
- **Colony becomes "Agents".** Celsius runs AI agents (procurement, finance, ops pulse,
  verifier). It isn't settings, so it moves out of Settings → System.
- **Growth.** Celsius spends real effort on loyalty loops, SMS/push, Google and Grab ads,
  and local rank. Gosamē's "Customers" section can't hold all of that, so the work splits
  in two: **Customers** (who they are, reviews) and **Growth** (campaigns, ads, rank).

```
Today        How are we doing, and what needs me?          /dashboard
Inbox        What is waiting for my decision?               (new)
Agents       What are the agents doing, and why?            /agents, /inventory/ai-decisions, /inventory/agent-qa

Sell
  Sales      How much did we sell, and through which channel?
  Service    How fast did we hand over, and what ran out?
  Customers  Who are they, are they happy, do they come back?
  Growth     What brings them in and back, and does it pay?

Make and supply
  Menu       What do we sell, how is it made, what does it earn?
  CK         What do we prep, and did it reach the outlets?
  Stock      What do we hold, where, and where does it leak?
  Orders     Right items, right price, paid correctly?

Run the business
  Team       Right people, on time, paid right, performing?
  Money      Where is our cash, and are the books right?
  Standards  Is every outlet running to standard?

⚙ Settings
```

That makes **13 sidebar entries instead of ~85 links**. Every page below becomes a tab in
its section.

---

## 2a. What was built first (Step 1), and the Celsius logic behind it

The first build follows how Celsius runs, not the Gosamē template word for word:

- **The back office is for HQ.** `lib/staff-access-presets.ts` gives crew, leads and outlet
  managers the floor work (counts, wastage, receiving, transfers, checklists, claims) in the
  staff apps. HOD, accountant, executive and director roles live in the back office. So the
  back office is for reviewing and deciding, not for entering data.
- **The team's own words stay:** HR, Procurement, Finance, Ops, "Purchase Orders" /
  "PO List". "Orders" already means customer orders here, so the template's "Orders"
  section stays **Procurement**.
- **No CK section.** `OutletType.CENTRAL_KITCHEN` exists, but no code acts on it. Prep
  Recipes sits under Menu → Recipes until the CK really runs transfers to outlets.
- **Rewards is split by job:** Customers (members, reviews, reward history) and Marketing
  (campaigns, reward channels, Google and Grab ads, local rank).

What changed (`lib/nav.tsx`, `components/section-tabs.tsx`, `(admin)/layout.tsx`):

| Before | After |
|---|---|
| 86 sidebar links in 9 expandable sections | **10 sidebar entries**: Sales · Customers · Marketing │ Menu · Stock · Procurement │ HR · Finance · Ops │ Agents |
| Settings was a sidebar section | **⚙ Settings** in the sidebar footer |
| Pages listed in the sidebar | **Tabs across the top of the page** (6 at most), with a lighter second row for related pages |
| Two pages called "Reconciliation" | **Invoice Match** (Procurement) and **Bank Match** (Finance) |
| Two pages called "Campaigns" | Campaigns (Marketing, the loops) and **Google Campaigns** |
| Area Scorecard under Rewards | Under **Ops → Performance** (it scores outlets) |
| AI Agents under Settings → System | Its own **Agents** entry |

All 103 registered pages keep the same URL, permission (`moduleKey`) and hidden setting;
this was checked mechanically before and after. HR keeps its own module tabs.
`nav-structure.test.ts` keeps every section at 6 tabs or fewer and stops a page from being
listed twice.

**Follow-up:** the Staff & Access editor (`lib/modules.ts`, the grant cards) still groups
permissions under the old section names. It works, but it should be regrouped to match.

---

## 3. Every page, sorted into its section

Key: **Keep** = becomes a tab · **Merge** = folds into the named page · **Retire** = hide,
then delete if nobody asks for it within 30 days of page-view logging · **Move** = goes
behind the gear.

### Today and Inbox
| Page | Decision |
|---|---|
| `/dashboard` | **Keep as Today.** Add a "Needs you" strip (count of Inbox cards) |
| `/`, `/pickup`, `/pos`, `/finance` (landing pages) | `/` and `/pos` redirect to Today. Mine `/finance` (the exceptions view) for Inbox cards, then retire it |
| Inbox (new) | Built from sources that already exist: `agent_actions` (pending), leave, overtime, shift swaps, pay-and-claim, invoice mismatches, finance exceptions, review feedback, audit follow-ups, stuck POs |

### Sales
| Page | Decision |
|---|---|
| `/sales/dashboard` | **Keep: Overview** (period against last period, outlet table, hour × weekday) |
| `/sales/compare` | Merge into Overview as a "compare" toggle |
| `/pos/reports`, `/pickup/analytics` | Merge into one **Items and payments** tab, whatever the source |
| `/pos/z-report`, `/pos/tax-report` | Move to **Money → Close** (they are cash-up and tax) |
| `/pos/maybank-qr` | Move to Money → Bank inbox |
| Grab / delivery app (new tab) | **Delivery apps:** orders, commission, payouts against the statement (`grab-reconcile.ts` exists already) |
| `/pos/cashier-performance` | Merge into Team → Performance (one scoring system) |

### Service
| Page | Decision |
|---|---|
| `/pickup/orders` (+ `[id]`) | **Keep: Order queue** (order → made → handed over, % within target) |
| `/pos/store-menu-status` | **Keep: Sold out** (timeline of what was switched off and for how long) |

### Customers
| Page | Decision |
|---|---|
| `/loyalty/members` | **Keep: Profiles** (one home page per customer) |
| `/pickup/customers` | Merge into Profiles |
| `/reviews`, `/reviews/feedback` | **Keep: Reviews.** Feedback Management becomes the "Make it right" view; reply decisions go to the Inbox |
| `/loyalty/vouchers`, `/loyalty/redemptions`, `/loyalty/points-log` | Merge into one **Rewards history** tab, with a filter |

### Growth
| Page | Decision |
|---|---|
| `/loyalty/loops` | **Keep: Campaigns** (the only page called that) |
| `/loyalty/engage` (+ `/loyalty/push-reminders`, `/loyalty/engage/test`) | Keep as **Messages**; push reminders becomes a tab inside it |
| `/loyalty/missions`, `/loyalty/mystery`, `/loyalty/admin-claimables`, `/loyalty/manual-grant` | One **Rewards** tab, with a second row: Challenges · Mystery · Claimables · Grant |
| `/ads`, `/ads/campaigns`, `/ads/optimizer`, `/ads/grab` | One **Ads** tab, with a second row: Google · Grab · Optimizer. Rename "Campaigns" here to "Google campaigns" |
| `/ads/invoices` | Move to Orders → Invoices (it's a bill) |
| `/reviews/geogrid` (+4 sub-pages), `/reviews/scoreboard` | One **Local rank** tab, with a second row |
| `/loyalty/dashboard` (Area Scorecard) | It scores outlets, so merge it into Standards → Scorecard |
| `/loyalty/insights`, `/loyalty/campaigns` (already redirects) | Retire |

### Menu (today's "Catalog")
| Page | Decision |
|---|---|
| `/pickup/menu` (+ `[id]`, `new`) | **Keep: Items**: one page per item with tabs (details · recipe · packaging · channels · margin) |
| `/inventory/menus`, `/inventory/menus/cards` | Become the **Recipe** tab on the item page; recipe cards become a "Print" button |
| `/inventory/packaging` | Packaging tab on the item page, plus a rules list |
| `/pickup/splash-posters` | Move to Settings → Apps |
| Menu matrix (new) | popular × margin, using the BOM costs that already exist |

### CK
| Page | Decision |
|---|---|
| `/inventory/prep-recipes` | **Keep: Prep** |
| `/inventory/reports/prep-labour` | Keep as a tab |
| Runs and charges to outlets | Only if the CK really sends stock to outlets; otherwise merge into Stock |

### Stock
| Page | Decision |
|---|---|
| `/inventory/dashboard` | **Keep: Overview** (food cost: should cost against did cost) |
| `/inventory/products`, `/inventory/perishables` | Merge into **Items**: one page per ingredient (par level, stock by outlet, suppliers, price history) |
| `/inventory/par-levels` | Becomes a column/tab on Items |
| `/inventory/stock-count` | **Keep: Counts** |
| `/inventory/wastage` | **Keep: Waste** |
| `/inventory/transfers` | **Keep: Transfers** (and fix the pending-transfer backlog noted in STATE.md) |
| `/inventory/reports` + 7 sub-pages | Not a tab. Each report goes onto the tab it explains (COGS and variance → Overview, valuation → Counts, wastage → Waste, scorecard → Suppliers) |
| `/inventory/groups`, `/inventory/categories` | Move to Settings → Stock |

### Orders (today's "Procurement")
Keep the team's own words: **"Purchase Orders"** (the WhatsApp chat) and **"PO List"**,
as the comment in `nav.tsx` asks.

| Page | Decision |
|---|---|
| `/inventory/supplier-chats` | **Keep: Purchase Orders** |
| `/inventory/orders` (+ `create`, `[id]`), `/inventory/receivings` | Merge into **PO List as a board**: Draft → Approved → Sent → Delivered → Invoiced → Matched → Paid, with stuck cards turning red. Receiving becomes a step on the card |
| `/inventory/invoices`, `/inventory/reconciliation` | One **Invoices** tab. Rename "Reconciliation" to **"Invoice match"** |
| `/inventory/pay-and-claim` (+ batches) | **Keep: Payments** (one weekly bank file) |
| `/inventory/suppliers` | **Keep: Suppliers**: one page per supplier with a report card |
| `/inventory/ai-decisions`, `/inventory/agent-qa` | Move to Agents |

### Team (today's "HR")
| Page | Decision |
|---|---|
| `/hr` | **Keep: Overview**; `/hr/analytics` becomes a tab on it |
| `/hr/schedules` (+ availability, coverage, shift swaps) | **Keep: Roster**; swaps go to the Inbox |
| `/hr/attendance`, `/hr/roster-attendance`, `/hr/pt-hours`, `/hr/overtime` | Merge into one **Attendance** tab, with views. Overtime approval goes to the Inbox |
| `/hr/leave` | Approval goes to the Inbox; the page becomes a view under Roster |
| `/hr/payroll` (+ run, weekly), `/hr/pt-rates`, `/hr/allowances`, `/hr/compliance` | **Keep: Payroll**, with a second row: Runs · Rates · Allowances · Statutory |
| `/hr/performance`, `/hr/review-penalties`, `/pos/cashier-performance`, `/ops/performance/staff/[id]`, `/ops/staff-skills` | **One Performance tab, one score**. Biggest people decision: see Q2 in section 6 |
| `/hr/employees` (+ `[id]`, import, certifications, access-presets), `/hr/memos` | **Keep: People** (one page per person: profile · access · certificates · memos · performance) |

### Money (today's "Finance")
| Page | Decision |
|---|---|
| `/finance/cashflow`, `/finance/cash-tracking`, `/finance/monthly-cashflow` | **Keep: Cash flow**, with a second row |
| `/finance/bank-statements`, `/finance/payouts`, `/pos/maybank-qr` | **Bank inbox** (card, QR and delivery-app payouts matched to sales). Brings the hidden pages back with a clear job |
| `/finance/recon` | Rename to **"Bank match"** and merge into Bank inbox |
| `/pos/z-report`, `/pos/tax-report`, `/finance/compliance` | **Close**: daily cash-up per outlet, SST, monthly tax |
| `/finance/transactions`, `/finance/reports`, `/finance/coa`, `/finance/fixed-assets` | **Books**, with a second row: Ledger · P&L/BS · Accounts · Fixed assets |
| `/finance/recurring-expenses` | Bills tab |

### Standards (today's "Ops")
| Page | Decision |
|---|---|
| `/ops/performance` | **Keep: Scorecard** (outlet-level); add the Area Scorecard here |
| `/ops/dashboard` | Retire (already hidden; same data as Performance) |
| `/ops/chat-inbox` ("Ops Workspace") | **Keep: What happened** (incidents and messages); items that need a decision go to the Inbox |
| `/ops/audit`, `/ops/audit-reports`, `/ops/audit-templates` | **Keep: Audits**; templates move to Settings |
| `/ops/compliance`, `/ops/schedules` | **Checklists** (by station and shift) |
| `/ops/sops` (+ new, `[id]`) | **Keep: SOPs** |

### ⚙ Settings (out of the sidebar, behind the gear)
Outlet operations (`/settings/outlets`, `/pos/settings`, `/pos/printers`, `/pos/table-qr`,
`/pickup/settings`) · Company and people (`/settings/staff`, `/settings/rules`,
`/hr/settings` + its 8 sub-pages) · Stock (`/settings/stock-count`, groups, categories) ·
Customers (tiers, discount engine, all rewards, outcome types, birthday, earn rate, reviews
settings, ads settings) · Standards (SOP categories, audit templates) · Apps (splash posters)
· Integrations (`/settings/integrations`, Grab) · System. Bring back the hidden hub
(`/settings`) as the gear's landing page, with a search box.

---

## 4. Order of work for Celsius

The template's order, changed to reuse what Celsius already has. Each step is its own PR.

| Step | What | Size | Notes |
|---|---|---|---|
| **0a** | **Page-view logging.** One `ActivityLog` row (`action: "view"`) per route change, written from `(admin)/layout.tsx`, plus a Settings → Usage page (views per page and per role, last 30 days) | Small | Without it, "Retire" is a guess. Let it run **2–4 weeks before retiring anything** |
| **0b** | **Register the ~60 unregistered pages in `nav.tsx`** (as `hidden`, with the right `moduleKey`), so ⌘K finds them and the route gate covers them | Small | Most important for the 26 pages the client gate doesn't check. Check that each one's API checks permissions on the server too |
| **0c** | **Rename the clashes:** Invoice match / Bank match, Google campaigns, and one "Dashboard" per section | Small | Labels only |
| **1** ✅ | **Menu shell** (built, see 2a): sections, tab strips (generalise `hr/module-tabs.tsx` into a `SectionTabs` driven by `nav.tsx`), Settings behind the gear | Medium | Labels and grouping only. URLs, data and permissions (`moduleKey`) don't change |
| **2** | **Inbox** over the existing sources (see section 3) + a "Needs you" strip on Today and on each tab | Medium | Read-only first (links to the existing approval page); one-tap actions after that |
| **3** | **One page per thing:** item (menu), ingredient, supplier, person, customer | Large | |
| **4** | **Rebuild the jobs, riskiest first:** PO board + Invoice match → one score in Performance → one Attendance → Bank inbox / Close → Reviews → Standards | Large, several PRs | Payroll and payments need an owner's approval at each step (CLAUDE.md hard rule 6) |
| **5** | Staff app (`apps/staff`, `staff-native`): Today · Shifts · Pay · Me | Medium | Check against what Celsius Manager already does before building |
| **6** | Insights (findings in RM a month) | Large, phased | The finance-warehouse and ops-pulse agents already produce findings that can feed it |

**Don't change during any of this:** URLs (bookmarks and WhatsApp links point at them),
`moduleKey` grants, "Purchase Orders" / "PO List".

---

## 5. What not to copy from Gosamē

- **Gosamē's "Food"** becomes "Menu" here; drinks need recipes per size and per hot/iced,
  and costed modifiers.
- **Gosamē's "Service" by table** fits Celsius only for QR dine-in. Most Celsius volume is
  counter, pickup and delivery, so the order queue matters more than tables.
- **A small team of 5:** Celsius has outlet managers with partial grants. Every section must
  keep hiding the tabs a user can't open (`visibleItems` already does this).

---

## 6. Questions for the owner before Step 1

1. Does the central kitchen send stock to outlets as transfers today? This decides whether
   CK is its own section.
2. Which score should stay: the allowance scorecard (`/hr/performance`), ops performance, or
   cashier performance? Allowance pay depends on it, so this is a payroll decision.
3. Is "Growth" the right word, or would the team say "Marketing"? (Naming test: understood
   at midnight on a phone.)
4. Do outlet managers get the Inbox, or only owners? (It changes which card sources are in
   scope.)
