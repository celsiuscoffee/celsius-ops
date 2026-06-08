import { OrderTrackingView } from "./_OrderTrackingView";
import { reconcileRmOrder } from "@/lib/revenue-monster/reconcile";

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ payment?: string }>;
}) {
  const { id } = await params;
  const { payment } = await searchParams;

  // RM redirects the customer's browser back here right after they pay
  // (…/order/[id]?payment=done). That return is a guaranteed signal that
  // depends on neither webhook delivery nor the customer keeping the
  // tracking screen open — so settle the order server-side, the moment the
  // page is requested, by asking RM directly. Idempotent + never throws, so
  // a non-RM/already-settled order is a cheap no-op and a gateway blip can't
  // break the render (the on-screen poll + cron remain as backstops).
  if (payment === "done") {
    await reconcileRmOrder({ orderId: id });
  }

  return (
    // No bottom tab bar — matches native (sub-screens opt out). Back via header.
    <main className="bg-white text-[#160800] min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
      <OrderTrackingView orderId={id} />
    </main>
  );
}
