
## Build log

- 2026-09-16 — Approach A built on branch `owner-todo-kanban` (worktree).
  Files: `packages/db/prisma/schema.prisma` (OpsReminder capture columns) +
  twin migrations `packages/db/prisma/migrations/20260916_owner_todo_capture`
  and `supabase/migrations/111_owner_todo_capture.sql` (also seeds the two
  registry rows); `apps/backoffice/src/lib/owner-todo/{capture,board,digest}.ts`;
  routes `api/owner/todo` (GET board, POST card), `api/owner/todo/[id]`
  (PATCH stage / reject / tomorrow / edit), `api/owner/todo/ingest` (bearer);
  page `(admin)/owner/todo` with dnd-kit; nav entry "My board" under Ops,
  `owner:*` keys OWNER-only; pulse-webhook `owner_todo` action; digest folded
  into the celsius-overview 9am firing; Mac scanner
  `scripts/owner-todo-scanner.mjs` + launchd template `scripts/launchd/`.
  Scanner dry-run against the live store: 40 chats, 121 KB, clean.
  Not applied to prod; see docs/STATE.md resume pointer for the go-live order.
- Message types shipped from WhatsApp: 0 (text), 7 (text with link preview),
  8 (document, filename only). Group sender names resolve through
  ZWAGROUPMEMBER.ZCONTACTNAME, which is often null for LID members; those
  ship as `member <last 6 of jid>` so identity stays consistent within a chat.
