# Staff app (web) structure: first-principles audit and redesign

Status: **2026-11-19. Built** on the worktree branch for the owner's ask (19 Nov 2026):
"redesign back based on needed fx (use first principle). remove redundancy" and "the
redesign also still not done for staff app (native and also web)". This covers the
**web** Staff app (`apps/staff`, staff.celsiuscoffee.com PWA). The native manager app
(`apps/staff-native`) is a separate piece of work.

Method, the same as the back office (`backoffice-structure.md`): one question per
screen, duplicates removed, Celsius UI tokens everywhere, Gosamē's Staff app as the
reference for structure only (its 5-tab bar and "Me from the top-right button").
Celsius has no central kitchen, so none of Gosamē's CK screens apply.

## 1. Who uses it, for what

| Person | Opens the app to… |
|---|---|
| Crew (barista, kitchen, cashier) | clock in and out; do the shift's checklists; count, receive, waste and transfer stock; claim back money spent for the outlet; see shifts, leave, payslips, memos |
| Outlet manager | everything crew does, plus today's spot-check audit and how the team is doing on checklists |
| HQ / owner | the same pages for any outlet (outlet switcher); the real admin work happens in the back office |

## 2. The tab bar

Before: Home · Checklists · Audit · HR · Inventory, with Profile reachable only from an
icon on Home, and six pages (dashboard, SOP editor, categories, schedules) reachable
from nowhere or only from each other.

After (at most 5, each one job; tabs a person has no access to are hidden as before):

| Tab | Root | Job | Also lights for |
|---|---|---|---|
| **Today** | `/home` | What do I do next? Clock-in card, the day's tasks (checklists, stock count, deliveries, audit) most urgent first, team progress and recent audits for managers, who's away | `/profile` |
| **Checklists** | `/checklists` | The shift's SOP checklists. Kept as a tab because opening it is what creates the day's checklists (`POST /api/checklists/generate`; the midnight cron only clears them) | `/checklists/*` |
| **Shifts** | `/hr` | When do I work, what time off do I have, what am I paid? | `/hr/*` |
| **Stock** | `/inventory` | Count, receive, waste, transfer, claim | `/stock-count`, `/receiving`, `/wastage`, `/transfers`, `/claims` |
| **Audit** | `/audit` | Managers' spot checks (`ops:audit` only) | `/audit/*` |

**Me** (profile, PIN, sign out, back office link) opens from the initials button at the
top right of Today, as in Gosamē's Staff app. Today is no longer gated on the `ops`
module: everyone signed in has a Today (the page itself only shows what they can use).

## 3. Page audit (38 `page.tsx`)

| Page | Job | Decision | Why |
|---|---|---|---|
| `/` | Sends to `/home` | Keep | Entry redirect |
| `/login` | Sign in (manager password or staff PIN) | Keep, restyled | Paper page that follows light/dark; was a fixed dark screen |
| `/change-pin` | Forced first PIN change | Keep | Different job from Me › Change PIN (forced on first sign-in) |
| `/privacy` | Public privacy policy for the manager app | Keep | Store listing link; colours moved to tokens |
| `/home` | Today | Keep, rebuilt | The one "what next" list. Quick-action grid removed: it repeated the Stock tab |
| `/dashboard` | SOP counts + today's checklists | **Merged → `/home`** (redirect) | Linked from nowhere. Today already shows the checklists and the team's progress; SOP counts are a back-office question |
| `/checklists` | Today's checklists (and creating them) | Keep (tab) | See §2 |
| `/checklists/[id]` | Do one checklist, photo proof | Keep | |
| `/checklists/history` | Past checklists | Keep | Linked from Checklists |
| `/audit` | Start or carry on an audit, see recent ones | Keep (tab) | |
| `/audit/[id]` | Do one audit | Keep | |
| `/audit/history` | Past audits | Keep | Linked from Audit and Today |
| `/sops` | SOP list with drafts and status | **Removed → back office `/ops/sops`** (redirect) | Writing SOPs is a back-office job (`/ops/sops` exists there). Reachable only from the dead `/dashboard`. Staff follow SOPs as checklists |
| `/sops/new` | Write a new SOP | **Removed → back office `/ops/sops/new`** | Same |
| `/sops/[id]` | Edit an SOP and its steps | **Removed → back office `/ops/sops/[id]`** | Same |
| `/categories` | Edit SOP categories | **Removed → back office `/ops/categories`** | Same; reachable only from `/dashboard` |
| `/schedules` | Assign SOPs to outlets and shifts | **Removed → back office `/ops/schedules`** | Linked from nowhere; the back office has the same page |
| `/hr` | Shifts hub | Keep, rebuilt | Three sections: When I work · Time off and pay · How I'm doing. The separate "On shift / Off shift" card is gone: the Clock row says it |
| `/hr/clock` | Clock in/out with selfie and location | Keep | The action |
| `/hr/attendance` | Clock-in history and hours | Keep | Different question from `/hr/clock` (history, not the action); renamed "Clock-in history" |
| `/hr/shifts` | My shifts, swaps | Keep | |
| `/hr/whos-working` | Who is on shift each day | Keep | |
| `/hr/availability` | Part-timers' weekly pattern and days off | Keep | Part-timers and interns only (layout gate unchanged) |
| `/hr/open-shifts` | Ask for an open slot | Keep, unlinked | Hidden by the owner on 2026-07-22 ("slots logic removed"); the page stays so the entry can come back |
| `/hr/leave` | Balances and asking for leave | Keep | |
| `/hr/overtime` | Ask for overtime | Keep, unlinked | Owner/admin preview only (layout gate unchanged); overtime is captured from attendance. **Owner decision:** open it or delete it |
| `/hr/payslips` | Payslips | Keep | |
| `/hr/memos` | Memos to acknowledge | Keep | |
| `/hr/reviews` | Customer reviews during my shifts | Keep | Renamed "Customer feedback" |
| `/hr/my-skills` | Audit scores over time | Keep | |
| `/inventory` | Stock hub | Keep (tab) | One list of the stock jobs |
| `/stock-count` | Count stock | Keep | |
| `/receiving` | Receive a delivery | Keep | |
| `/wastage` | Record waste | Keep | |
| `/transfers` | Transfers between outlets | Keep | |
| `/claims` | Pay and claim | Keep | Under Stock (its access key is `inventory:pay-and-claim`) |
| `/profile` | Me | Keep, rebuilt | Today's checklist count removed (Today and Checklists answer it); the "Admin" pill removed (same link as "Open the back office") |
| `/profile/personal` | Personal info for payroll | Keep | |

Result: 38 pages → **32 pages with a job** + 6 redirects. No API changed; the `/api/sops`,
`/api/sop-categories` and `/api/schedules` routes stay (the native app and the back
office may use them). Every old URL still lands somewhere.

## 4. Design system

- `src/styles/celsius-ui/tokens.css` is a copy of the back office's file; a test fails if
  the two differ. `globals.css` imports it and wires the `@theme` utilities
  (`text-text`, `bg-surface`, `border-line`, `bg-ink`, `ok/warn/danger/info` with
  `-soft`/`-text`, `rounded-card`, `rounded-ctl`), and the shadcn variables used by
  `@celsius/ui` read the tokens.
- Light and dark follow the phone: a script in `app/layout.tsx` sets `.dark` before the
  first paint and follows changes.
- Main action is ink (espresso in light, cream in dark) with `text-on-ink`; terracotta
  only as `brand-text` accents. White text on a solid signal colour is never used
  (it fails in dark mode); signals use `text-on-ink`.
- Phone rules: tab bar 52 px targets with the safe area, back links and row targets
  ≥ 44 px, list rows in one card with hairlines, 12-hour times ("7:40 PM",
  `lib/format-time.ts`), sentence case.
- `src/lib/celsius-ui-palette.test.ts` stops the old fixed colours (grey scale,
  `bg-white`, terracotta, hard-coded hex, and the raw red/green/amber/blue families)
  from coming back into pages and components.

## 5. Open for the owner

1. `/hr/overtime`: open to staff, or delete (it has been an owner-only preview since it was built).
2. `/hr/open-shifts`: still hidden since 22 Jul; delete if slots are not coming back.
3. The redirects for the SOP pages go to the back office; anyone with `ops:sops` but no
   back-office login will land on its sign-in page.
