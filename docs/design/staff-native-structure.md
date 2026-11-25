# Manager app (`apps/staff-native`) — structure and Celsius UI

Owner, 19 Nov 2026: "redesign back based on needed fx (use first principle).
remove redundancy" and "the redesign also still not done for staff app
(native and also web)". This is the native half. JS and assets only: no
`app.json`, `eas.json`, runtime, version, plugin, permission or dependency
change, so it reaches installed phones (runtime 1.0.0) as an OTA. **Merging it
to `main` is a production deploy to managers' phones** (`ota-release` skill).

## 1. First principles: what the phone is for

A manager (or staff member) opens the app on the floor for five jobs. Anything
that is not one of them belongs in the back office.

| Job | Question it answers | Tab |
|---|---|---|
| Start and run the shift | Am I clocked in? What must be done today, and what is late? | **Today** |
| Watch the takings | How are sales going against last period? (managers and up) | **Sales** |
| Keep standards | Are today's checklists done? Are audits up to date? | **Checks** |
| Keep stock right | What is low? Count, receive, log waste, order, pay. | **Stock** |
| Look after myself | My shifts, leave, pay, scoreboard, profile and settings. | **Me** |

Owners and admins have Sales as their Today tab (already the case), so they see
four tabs. Before: six tabs (Home, Sales, Checklists, Audit, HR, Inventory),
with the same destinations reachable from two or three places.

## 2. Screen audit (37 route files)

Keep = the job is real and done only here. Merge = it stays as a route but its
duplicate entry point or duplicate content is gone. Remove = taken out of the
navigation; its path now opens the screen that does the job.

| Screen (route) | Job | Decision | Why |
|---|---|---|---|
| `index` | Redirect to Today or sign-in | Keep | Entry point |
| `(auth)/login` | Outlet + PIN sign-in | Keep | Now follows light and dark (was always dark) |
| `(staff)/home` — **Today** | Clock card, today's tasks by urgency | Keep, trimmed | Removed its copies of other tabs: the Checklists and Audits cards (= Checks tab), the five quick actions (= Stock tab, same module gates), the My Scoreboard card (= Me), and the second settings button (the header already opens Profile) |
| `(staff)/sales` — **Sales** | Revenue, orders, payment mix, growth | Keep | Managers' tab; owners get it as Today (unchanged). Was a fixed dark screen; now on the tokens |
| `(staff)/checklists` — **Checks** | Today's checklists, team and personal progress | Keep, merged | Now also the home of Audits (one row at the top, for people with `ops:audit`) |
| `(staff)/checklists/[id]` | Do one checklist (photos, ticks) | Keep | |
| `(staff)/audit` | Audit list and coverage | Merge into Checks | Was its own tab; now opened from Checks with a back button. It takes the tab only for someone with audits but no checklists, so nobody loses access |
| `(staff)/audit/new`, `audit/[id]` | Start / run / read an audit | Keep | Rating chips now soft signal colours (no white on solid colour) |
| `(staff)/inventory` — **Stock** | Stock status + every stock job | Keep, regrouped | Grouped by the life of an ingredient: On the shelf (count, wastage), In and out (receiving, transfers), Buy and pay (purchase orders, invoices, pay and claim). Rainbow icon tiles dropped (colour only for meaning) |
| `(staff)/inventory/levels` | What is out / low, by area | Keep | |
| `(staff)/stock-count` | Count the shelf | Keep | |
| `(staff)/wastage` | Log waste | Keep | |
| `(staff)/receiving` | Check in a delivery | Keep | Title "Receiving" (was "Receive", the Stock row said "Receiving") |
| `(staff)/transfers` | Transfers log for this outlet | Keep | Read only; approval stays in the back office |
| `(staff)/orders`, `orders/new`, `orders/[id]` | Create, approve, send purchase orders | Keep | Module-gated (`inventory:orders`). See §5 |
| `(staff)/invoices`, `invoices/[id]` | Attach invoice photos, send proof of payment | Keep | Module-gated (`inventory:invoices`). See §5 |
| `(staff)/claims`, `claims/new` | Pay and claim (receipts, payment requests) | Keep | Title now "Pay and claim" to match Stock; had no back button; `claims/new` drew two headers (native + page) — the native one is off |
| `(staff)/clock` | Selfie + location clock in / out | Keep | Opened from Today (or from Me for people with no outlet) |
| `(staff)/hr` — **Me** | Everything about the person | Keep, merged | Was "HR". Its clock card repeated Today's (now shown only for people without an outlet, whom Today does not show it to). Its whole allowance card repeated My scoreboard: now one row, "RM x of RM y in November · n days left". Profile is the first row |
| `(staff)/hr/scoreboard` | KPIs and allowance this month | Keep, merged | Took the itemised deductions (late, absent, reviews) that only the old HR card had, so nothing was lost |
| `(staff)/hr/shifts` | My upcoming shifts, add to calendar | Keep | |
| `(staff)/hr/open-shifts` | Ask for an extra shift | Removed | Owner 20 Nov 2026: "follow gosame" — Gosamē's phone app has no open-shift screen; slots off since 22 Jul |
| `(staff)/hr/whos-working` | Team on shift by day | Keep | |
| `(staff)/hr/availability` | Weekly pattern, days off (part-timers) | Keep | |
| `(staff)/hr/attendance` | Clock-in history, overtime | Keep | |
| `(staff)/hr/leave` | Balances, apply | Keep | |
| `(staff)/hr/payslips` | Pay history | Keep | |
| `(staff)/hr/memos` | Notices from HR, acknowledge | Keep | |
| `(staff)/hr/reviews` | Customer reviews during my shifts | Keep | |
| `(staff)/hr/my-skills` | Audit scores about me | Keep | |
| `(staff)/profile` | Personal info, PIN, Face ID, appearance, sign out | Keep | Reached from Today's header, Me's first row, and Sales' settings button for owners. Now has a back button |
| `(staff)/personal` | Address, IC, emergency contact | Keep | |

Removed from navigation: the **Audit tab** (→ Checks), and the duplicate entry
points listed above. No route was deleted and no path stopped working: every
old path (notifications, deep links) opens the same screen as before, now with
a back button where it is an inner page. Tabs use `backBehavior="history"`, so
back returns to the tab you came from instead of Today.

## 3. Shell

- Tab bar on the tokens: `--tab` background, `--line` top border, active icon in
  `--text` on a `--sunken` pill, inactive `--text-3`. It follows light and dark
  (it was espresso in both). Height comes from the safe area, not a fixed 84.
- Stack layouts share `useStackScreenOptions()` (`lib/screen-options.ts`):
  native header hidden (every screen draws `PageHeader`), page colour behind
  every push so dark mode never flashes white.

## 4. Celsius UI on the phone

- `lib/celsius-ui/tokens.ts`: the back office's token names and values
  (`apps/backoffice/src/styles/celsius-ui/tokens.css`), light and dark.
  `celsius-ui.test.ts` fails if a value drifts, if a Tailwind colour stops
  reading its token, if a screen uses an old palette class or a hex colour, or
  if there are more than five tabs.
- `lib/theme.ts` applies them as CSS variables at the root (System / Light /
  Dark choice kept); `tailwind.config.js` exposes them as classes
  (`bg-surface`, `text-text-2`, `border-line`, `bg-ink`, `bg-ok-soft` …).
  Style objects, icons and charts read `useCelsius().color`.
- Components (`components/ui`): Button (ink main action, outline secondary,
  outline danger), Card, ListRow + List, KeyNumber, Segmented, Pill (soft fill +
  signal text), Section, Field, EmptyState, Skeleton, FAB. `PageHeader` and
  `Screen` are the page frame (16 px side margin).
- Rules applied app-wide: one main action per screen in ink (never white on a
  solid signal colour, unreadable in dark mode); red, amber, green, blue only
  for meaning; terracotta only for the logo tile; sentence-case labels (no
  uppercase micro-labels, no 10–11 px text); 12-hour times in Malaysia time
  ("7:40 PM", `lib/celsius-ui/format.ts`); touch targets at least 44 pt;
  cards radius 16.
- Camera overlays (selfie, receipt) keep white on the live photo.

## 5. For the owner

1. **Purchase orders and invoices on the phone.** They are full back-office
   jobs (approve and send POs, proof of payment to suppliers). They stay on the
   phone because they are gated per person (`inventory:orders`,
   `inventory:invoices`) and the floor uses them (photo of the invoice at
   delivery). Say if they should be back office only; removing them is a
   menu change, not an API change.
2. **Transfers** is a read-only log on the phone. Approving stays in the back
   office.
3. Check on a phone in both themes before merging: Today, Checks, Stock, Me,
   Sales, sign-in. Merge = OTA to every manager's phone.
