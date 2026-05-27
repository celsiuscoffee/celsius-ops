"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bell, BellOff, Shield, FileText, Trash2, ChevronRight } from "lucide-react";

/**
 * Settings — push notifications + privacy + danger zone (account
 * delete). Mirrors apps/pickup-native/app/settings.tsx.
 */
export function SettingsView() {
  const [pushOn, setPushOn] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof Notification === "undefined") {
      setPushOn(false);
      return;
    }
    setPushOn(Notification.permission === "granted");
  }, []);

  const togglePush = async () => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      const r = await Notification.requestPermission();
      setPushOn(r === "granted");
    } else {
      // Already granted or denied; the customer needs to flip it in
      // browser settings. Open instructions instead.
      setPushOn(Notification.permission === "granted");
    }
  };

  return (
    <>
      <header
        className="bg-[#160800] text-white px-4 pb-3 flex items-center gap-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Link href="/account" className="-ml-1 p-1 active:opacity-60" aria-label="Back">
          <ArrowLeft size={20} color="#FFFFFF" />
        </Link>
        <h1 className="font-peachi font-bold text-[22px]">Settings</h1>
      </header>

      <section className="px-4 pt-5">
        <h2 className="font-peachi font-bold text-[16px] mb-3">Notifications</h2>
        <button
          type="button"
          onClick={togglePush}
          className="w-full flex items-center gap-3 rounded-2xl border border-[#EBE5DE] bg-white px-4 py-3 active:opacity-80 text-left"
        >
          {pushOn ? (
            <Bell size={18} color="#A2492C" />
          ) : (
            <BellOff size={18} color="#8E8E93" />
          )}
          <div className="flex-1">
            <p className="text-sm font-bold">Push notifications</p>
            <p className="text-[11px] text-[#6E6E73] mt-0.5">
              {pushOn === null
                ? "Loading…"
                : pushOn
                ? "On — order updates + rewards"
                : "Off — tap to allow in your browser"}
            </p>
          </div>
          <ChevronRight size={14} color="#8E8E93" />
        </button>
      </section>

      <section className="px-4 pt-6">
        <h2 className="font-peachi font-bold text-[16px] mb-3">Privacy &amp; terms</h2>
        <ul className="flex flex-col gap-2">
          <Row href="/privacy" Icon={Shield} label="Privacy policy" />
          <Row href="/support" Icon={FileText} label="Help &amp; support" />
        </ul>
      </section>

      <section className="px-4 pt-6">
        <h2 className="font-peachi font-bold text-[16px] mb-3">Danger zone</h2>
        <Link
          href="/account-delete"
          className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 active:opacity-80"
        >
          <Trash2 size={18} color="#B91C1C" />
          <span className="text-sm font-bold flex-1" style={{ color: "#B91C1C" }}>
            Delete my account
          </span>
          <ChevronRight size={14} color="#B91C1C" />
        </Link>
      </section>
    </>
  );
}

function Row({ href, Icon, label }: { href: string; Icon: typeof Bell; label: string }) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 rounded-2xl border border-[#EBE5DE] bg-white px-4 py-3 active:opacity-80"
      >
        <Icon size={18} color="#8E8E93" />
        <span className="text-sm font-bold flex-1">{label}</span>
        <ChevronRight size={14} color="#8E8E93" />
      </Link>
    </li>
  );
}
