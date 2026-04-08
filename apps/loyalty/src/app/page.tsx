import { Users, Gift, Monitor, ArrowRight } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      {/* Hero */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-950" />
        <div className="relative mx-auto max-w-5xl px-6 py-20 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm backdrop-blur-sm">
            <Image src="/images/celsius-logo-sm.jpg" alt="°C" width={24} height={24} className="h-6 w-6 rounded-full" priority />
            Celsius Coffee Loyalty Program
          </div>
          <h1 className="mb-4 font-serif text-5xl font-bold tracking-tight md:text-6xl">
            Earn Points.
            <br />
            <span className="text-orange-200">Get Rewarded.</span>
          </h1>
          <p className="mx-auto mb-10 max-w-xl text-lg text-orange-100/80">
            Every RM spent earns you points. Redeem for free drinks, cakes, and
            exclusive rewards at any Celsius Coffee outlet.
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/rewards"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-8 py-4 text-lg font-semibold text-[#C2452D] shadow-lg transition hover:bg-orange-50"
            >
              Check My Points
              <ArrowRight className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </header>

      {/* How it works */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="mb-12 text-center text-3xl font-bold">How It Works</h2>
        <div className="grid gap-8 md:grid-cols-3">
          {[
            {
              icon: Users,
              title: "1. Sign Up",
              desc: "Give your phone number at any outlet. No app download needed.",
            },
            {
              icon: Gift,
              title: "2. Earn Points",
              desc: "Every RM1 you spend = 1 point. Watch your balance grow with every visit.",
            },
            {
              icon: Gift,
              title: "3. Redeem Rewards",
              desc: "Use your points for free drinks, cakes, merch, and exclusive perks.",
            },
          ].map((step) => (
            <div
              key={step.title}
              className="rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center"
            >
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#C2452D]/10">
                <step.icon className="h-7 w-7 text-[#C2452D]" />
              </div>
              <h3 className="mb-2 text-xl font-semibold">{step.title}</h3>
              <p className="text-neutral-400">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Quick links */}
      <section className="border-t border-neutral-800 bg-neutral-900">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="mb-8 text-center text-2xl font-bold">Quick Access</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Link
              href="/rewards"
              className="group flex items-center gap-4 rounded-xl border border-neutral-700 bg-neutral-800 p-6 transition hover:border-[#C2452D]"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#C2452D]/10">
                <Gift className="h-6 w-6 text-[#C2452D]" />
              </div>
              <div>
                <div className="font-semibold group-hover:text-[#C2452D]">
                  My Rewards
                </div>
                <div className="text-sm text-neutral-400">
                  Check points & redeem
                </div>
              </div>
            </Link>
            <Link
              href="/staff"
              className="group flex items-center gap-4 rounded-xl border border-neutral-700 bg-neutral-800 p-6 transition hover:border-[#C2452D]"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#C2452D]/10">
                <Monitor className="h-6 w-6 text-[#C2452D]" />
              </div>
              <div>
                <div className="font-semibold group-hover:text-[#C2452D]">
                  Staff Tablet
                </div>
                <div className="text-sm text-neutral-400">
                  Register & award points
                </div>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-800 px-6 py-8 text-center text-sm text-neutral-500">
        © 2026 Celsius Coffee. All rights reserved. Powered by Celsius Loyalty.
      </footer>
    </div>
  );
}
