import { redirect } from "next/navigation";

// RETIRED — the legacy preset-campaign editor (fixed offer / fixed message /
// no voucher / no learning) has been replaced by Loops, where every campaign
// objective runs as an adaptive loop (holdout → offer optimiser → auto-issued
// voucher tagged to the phone → send-time learning). This route now redirects
// to the loops dashboard; old bookmarks land in the right place.
export default function CampaignsPage() {
  redirect("/loyalty/loops");
}
