"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bell, BellOff, Shield, CircleHelp, Trash2, ChevronRight } from "lucide-react";

/**
 * Settings — divider-row list matching apps/pickup-native/app
 * /settings.tsx: 36×36 rounded icon tile (#FBEBE8 / #FEE2E2 for
 * destructive), 15px SpaceGrotesk label + 12px sub-text, top hairline
 * between rows. Push-notifications toggle is web-only (native handles
 * notifications through the OS) so it sits first as a toggle row.
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

      <div className="px-4 py-3">
        <button
          type="button"
          onClick={togglePush}
          className="w-full flex items-center text-left active:opacity-70"
          style={{ paddingTop: 14, paddingBottom: 14, gap: 12 }}
        >
          <span
            className="flex items-center justify-center flex-shrink-0"
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#FBEBE8" }}
          >
            {pushOn ? (
              <Bell size={16} color="#A2492C" strokeWidth={2} />
            ) : (
              <BellOff size={16} color="#A2492C" strokeWidth={2} />
            )}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block" style={{ color: "#1A0200", fontSize: 15, fontWeight: 600 }}>
              Push notifications
            </span>
            <span className="block" style={{ color: "rgba(26,2,0,0.55)", fontSize: 12, marginTop: 2 }}>
              {pushOn === null
                ? "Loading…"
                : pushOn
                ? "On — order updates + rewards"
                : "Off — tap to allow in your browser"}
            </span>
          </span>
          <ChevronRight size={16} color="#8E8E93" />
        </button>

        <SettingsRow
          href="/support"
          Icon={CircleHelp}
          label="Support"
          sub="WhatsApp us, FAQ, contact"
        />
        <SettingsRow
          href="/privacy"
          Icon={Shield}
          label="Privacy policy"
          sub="What we store and why"
        />
        <SettingsRow
          href="/account-delete"
          Icon={Trash2}
          label="Delete account"
          sub="Wipe all my data"
          destructive
        />
      </div>
    </>
  );
}

function SettingsRow({
  href,
  Icon,
  label,
  sub,
  destructive,
}: {
  href: string;
  Icon: typeof Bell;
  label: string;
  sub?: string;
  destructive?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex items-center active:opacity-70"
      style={{
        paddingTop: 14,
        paddingBottom: 14,
        gap: 12,
        borderTop: "1px solid rgba(26,2,0,0.08)",
      }}
    >
      <span
        className="flex items-center justify-center flex-shrink-0"
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: destructive ? "#FEE2E2" : "#FBEBE8",
        }}
      >
        <Icon size={16} color={destructive ? "#B91C1C" : "#A2492C"} strokeWidth={2} />
      </span>
      <span className="flex-1 min-w-0">
        <span
          className="block"
          style={{ color: destructive ? "#B91C1C" : "#1A0200", fontSize: 15, fontWeight: 600 }}
        >
          {label}
        </span>
        {sub ? (
          <span
            className="block"
            style={{
              color: destructive ? "rgba(185,28,28,0.65)" : "rgba(26,2,0,0.55)",
              fontSize: 12,
              marginTop: 2,
            }}
          >
            {sub}
          </span>
        ) : null}
      </span>
      <ChevronRight size={16} color={destructive ? "#B91C1C" : "#8E8E93"} />
    </Link>
  );
}
