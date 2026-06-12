import Link from "next/link";

// The web KDS is retired — pos-native on the SUNMI till now owns order
// intake (new-order alerts + kitchen-slip printing). The route is kept as
// a static notice so outlet tablets still parked on /staff/kds don't 404.
export default function KdsRetiredPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center bg-[#160800] text-white">
      <h1 className="text-2xl font-bold">The KDS has moved</h1>
      <p className="max-w-sm text-sm leading-relaxed text-white/70">
        Incoming orders now appear directly on the POS till — new-order
        alerts and kitchen slips print there. This screen is no longer in
        use.
      </p>
      <Link
        href="/staff/availability"
        className="mt-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#160800]"
      >
        Go to Availability
      </Link>
    </main>
  );
}
