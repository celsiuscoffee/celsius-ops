// Staff Rewards Portal — RETIRED.
//
// This counter portal (PIN login → award / redeem Beans) has been replaced by
// the loyalty flow built into the Celsius POS app (apps/pos-native): member
// lookup, points award on payment, and reward redemption now happen at the POS
// terminal. The interactive portal was removed here.
//
// We keep a static notice instead of deleting the route so outlet tablets still
// parked on loyalty.celsiuscoffee.com/staff land on an explanation rather than a
// 404 (same approach as apps/order/src/app/staff/kds). The loyalty app's
// headless APIs (OTP, members, member-tier, promotions) stay — they're still
// used by the order app and backoffice/POS.

export const metadata = {
  title: "Celsius Coffee — Staff Portal Retired",
};

export default function StaffPortalRetired() {
  return (
    <div className="portal-fixed flex min-h-screen flex-col items-center justify-center bg-neutral-900 px-6 text-center pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="w-full max-w-sm">
        <img
          src="/images/celsius-wordmark.png"
          alt="Celsius Coffee"
          className="mx-auto mb-8 h-10 invert"
        />
        <h1 className="text-xl font-bold text-white">Staff portal has moved</h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-400">
          Awarding and redeeming Beans now happens directly in the{" "}
          <span className="font-semibold text-neutral-200">Celsius POS app</span>.
          Please use the POS terminal at your outlet — there&apos;s no separate
          rewards login anymore.
        </p>
        <p className="mt-6 text-xs text-neutral-600">
          Need help? Ask your manager or contact the operations team.
        </p>
      </div>
      <div className="absolute bottom-4 left-0 right-0 text-center">
        <p className="text-[10px] tracking-wide text-neutral-800">Powered by Celsius Rewards</p>
      </div>
    </div>
  );
}
