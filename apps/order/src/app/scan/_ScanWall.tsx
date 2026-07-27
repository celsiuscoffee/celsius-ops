"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QrCode, Camera as CameraIcon } from "lucide-react";
import jsQR from "jsqr";
import { getDineInContext } from "@/lib/checkout-session";

/**
 * Scan wall + in-browser table-QR scanner. This app is dine-in QR-table
 * ordering ONLY: a session begins from the physical table QR
 * (/table/{outletId}/{tableId} → _TableEntry). Every no-table entry point
 * funnels here.
 *
 * The wall opens the device camera and scans the table QR directly (owner:
 * keep the camera — the retired Expo /scan screen had a live scanner, and
 * "open your phone camera" alone is a worse path). A decoded Celsius table
 * QR routes into the same /table/… handoff the printed QR uses, so all
 * validation stays server-side. If the camera is denied or unavailable the
 * wall falls back to the instruction copy, and the "Get the app" CTA for
 * pickup stays in both states.
 *
 * If a fresh dine-in context already exists (a seated customer who wandered
 * onto this URL), bounce straight back into the menu.
 */

/**
 * Pull {outletId, tableId} out of a scanned Celsius table QR. Same trust
 * rules as apps/pickup-native/app/scan.tsx — only our own domain, so a stray
 * QR in the wild can't start a dine-in session for an arbitrary store/table.
 */
function parseTableQr(raw: string): { outletId: string; tableId: string } | null {
  if (!raw) return null;
  if (!raw.includes("celsiuscoffee.com")) return null;
  const m = raw.match(/\/table\/([^/?#]+)\/([^/?#]+)/);
  if (!m) return null;
  const outletId = decodeURIComponent(m[1]).trim();
  const tableId = decodeURIComponent(m[2]).trim();
  if (!outletId || !tableId) return null;
  return { outletId, tableId };
}

const WRONG_QR_HINT =
  "That isn't a Celsius table code. Point the camera at the QR on your table.";

type Phase = "init" | "camera" | "fallback";

export function ScanWall() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("init");
  // Camera was denied (vs. simply unavailable) — offer a retry tap, which
  // re-triggers the browser permission prompt where the platform allows it.
  const [denied, setDenied] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const handledRef = useRef(false);

  const stopCamera = useCallback(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPhase("fallback");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      setDenied(false);
      setPhase("camera");

      // The <video> renders on the "camera" phase — attach on next tick.
      requestAnimationFrame(() => {
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        void video.play().catch(() => {});
      });

      // Decode loop — downscaled canvas + jsQR, ~6fps is plenty for a QR
      // held at arm's length and keeps older phones cool.
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      timerRef.current = window.setInterval(() => {
        const video = videoRef.current;
        if (!video || !ctx || handledRef.current) return;
        if (video.readyState < video.HAVE_ENOUGH_DATA) return;
        const scale = Math.min(1, 400 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, {
          inversionAttempts: "dontInvert",
        });
        if (!code?.data) return;
        const parsed = parseTableQr(code.data);
        if (!parsed) {
          setHint(WRONG_QR_HINT);
          return;
        }
        handledRef.current = true;
        stopCamera();
        // Same handoff the printed QR runs — _TableEntry validates the
        // outlet/table server-side and pins the dine-in session.
        router.replace(`/table/${encodeURIComponent(parsed.outletId)}/${encodeURIComponent(parsed.tableId)}`);
      }, 160);
    } catch (err) {
      setDenied(err instanceof DOMException && err.name === "NotAllowedError");
      setPhase("fallback");
    }
  }, [router, stopCamera]);

  useEffect(() => {
    if (getDineInContext()) {
      router.replace("/menu");
      return;
    }
    void startCamera();
    return stopCamera;
  }, [router, startCamera, stopCamera]);

  if (phase === "init") {
    return <div className="p-8 text-center text-[#8E8E93]">Loading…</div>;
  }

  if (phase === "camera") {
    return (
      <div
        className="flex flex-col items-center px-6 text-center"
        style={{ minHeight: "80vh", paddingTop: "8vh" }}
      >
        <h1 className="font-peachi font-bold" style={{ color: "#1A0200", fontSize: 22 }}>
          Scan the QR on your table
        </h1>
        <div
          className="w-full overflow-hidden"
          style={{
            maxWidth: 340,
            aspectRatio: "1 / 1",
            borderRadius: 24,
            marginTop: 20,
            backgroundColor: "#160800",
            border: "3px solid rgba(162,73,44,0.35)",
          }}
        >
          {/* playsInline + muted are required for iOS Safari to render the
              stream inline instead of hijacking to fullscreen. */}
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="w-full h-full"
            style={{ objectFit: "cover" }}
          />
        </div>
        <p
          className="text-sm mt-4 max-w-xs"
          style={{ color: hint ? "#A2492C" : "#6B6B6B", lineHeight: 1.5, fontWeight: hint ? 600 : 400 }}
        >
          {hint ?? "Point your camera at the QR code on your table to order from your seat."}
        </p>
        <p className="text-sm mt-4 max-w-xs" style={{ color: "#6B6B6B", lineHeight: 1.5 }}>
          Want to order ahead for pickup? Use the Celsius app.
        </p>
        <a
          href="/get-app"
          className="mt-4 rounded-full bg-[#A2492C] text-white px-6 py-3 font-peachi font-bold active:opacity-80"
        >
          Get the app
        </a>
        <Link
          href="/"
          className="mt-4 mb-8 text-[13px] font-bold active:opacity-70"
          style={{ color: "#A2492C" }}
        >
          Back to home
        </Link>
      </div>
    );
  }

  // Fallback — camera denied or unavailable. Same wall as before, with a
  // retry when the customer can grant permission.
  return (
    <div
      className="flex flex-col items-center justify-center px-8 text-center"
      style={{ minHeight: "80vh" }}
    >
      <span
        className="flex items-center justify-center"
        style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: "rgba(162,73,44,0.10)" }}
      >
        <QrCode size={40} color="#A2492C" strokeWidth={1.6} />
      </span>
      <h1 className="font-peachi font-bold mt-6" style={{ color: "#1A0200", fontSize: 22 }}>
        Scan the QR on your table
      </h1>
      <p className="text-sm mt-3 max-w-xs" style={{ color: "#6B6B6B", lineHeight: 1.5 }}>
        Open your phone camera and scan the QR code on your table to browse the
        menu and order from your seat.
      </p>
      {denied ? (
        <button
          type="button"
          onClick={() => void startCamera()}
          className="mt-4 inline-flex items-center gap-2 rounded-full px-5 py-2.5 font-peachi font-bold active:opacity-80"
          style={{ border: "1.5px solid #A2492C", color: "#A2492C", fontSize: 14 }}
        >
          <CameraIcon size={16} color="#A2492C" strokeWidth={2} />
          Scan with camera instead
        </button>
      ) : null}
      <p className="text-sm mt-4 max-w-xs" style={{ color: "#6B6B6B", lineHeight: 1.5 }}>
        Want to order ahead for pickup? Use the Celsius app.
      </p>
      <a
        href="/get-app"
        className="mt-6 rounded-full bg-[#A2492C] text-white px-6 py-3 font-peachi font-bold active:opacity-80"
      >
        Get the app
      </a>
      <Link
        href="/"
        className="mt-4 text-[13px] font-bold active:opacity-70"
        style={{ color: "#A2492C" }}
      >
        Back to home
      </Link>
    </div>
  );
}
