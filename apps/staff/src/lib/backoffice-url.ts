// The back office, where SOPs, SOP categories and checklist schedules are
// written and managed (docs/design/staff-app-structure.md). The Staff app's
// old copies of those pages now send people there.
export const BACKOFFICE_URL =
  process.env.NEXT_PUBLIC_BACKOFFICE_URL || "https://backoffice.celsiuscoffee.com";
