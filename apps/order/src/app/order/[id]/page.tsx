import { OrderTrackingView } from "./_OrderTrackingView";
import { BottomNav } from "../../_BottomNav";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className="bg-white text-[#160800] min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
      <OrderTrackingView orderId={id} />
      <BottomNav active="orders" />
    </main>
  );
}
