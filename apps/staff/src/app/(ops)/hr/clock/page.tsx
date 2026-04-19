"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useFetch } from "@/lib/use-fetch";
import Link from "next/link";
import { Clock, MapPin, LogIn, LogOut, Loader2, CheckCircle2, AlertTriangle, Camera, RefreshCw, ArrowLeft } from "lucide-react";

type ClockStatus = {
  activeLog: {
    id: string;
    clock_in: string;
    outlet_id: string;
  } | null;
  geofence: {
    name: string;
    latitude: number;
    longitude: number;
    radius_meters: number;
  } | null;
  outletId: string | null;
};

export default function ClockPage() {
  const { data: status, mutate } = useFetch<ClockStatus>("/api/hr/clock");
  const [loading, setLoading] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsLoading, setGpsLoading] = useState(true);
  const [result, setResult] = useState<{ success: boolean; message: string; withinGeofence?: boolean } | null>(null);
  const [elapsed, setElapsed] = useState("");

  // Camera state
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const isClockedIn = !!status?.activeLog;

  // Get GPS on mount
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError("Geolocation not supported");
      setGpsLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsLoading(false);
      },
      (err) => {
        setGpsError(err.message);
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  // Start camera on mount — skip entirely if the user has no outlet (they'll
  // see the "no outlet" message instead and don't need the camera running).
  const hasOutlet = !!status?.outletId;
  useEffect(() => {
    if (status && !hasOutlet) return;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 480, height: 480 },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => setCameraReady(true);
        }
      } catch (err) {
        setCameraError(err instanceof Error ? err.message : "Camera not available");
      }
    }
    startCamera();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [status, hasOutlet]);

  // Capture photo from video feed
  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = 480;
    canvas.height = 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Mirror for selfie
    ctx.translate(480, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, 480, 480);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Timestamp overlay
    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const dateStr = now.toLocaleDateString("en-MY");
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 440, 480, 40);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText(`${dateStr}  ${timeStr}`, 12, 464);

    return canvas.toDataURL("image/jpeg", 0.7);
  }, []);

  // Elapsed time ticker
  useEffect(() => {
    if (!status?.activeLog) { setElapsed(""); return; }
    const clockIn = new Date(status.activeLog.clock_in).getTime();
    const tick = () => {
      const diff = Date.now() - clockIn;
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setElapsed(`${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [status?.activeLog]);

  const handleClock = useCallback(async () => {
    // Capture photo first
    const photo = capturePhoto();
    setCapturedPhoto(photo);

    setLoading(true);
    setResult(null);
    try {
      const action = isClockedIn ? "clock_out" : "clock_in";
      const res = await fetch("/api/hr/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          latitude: gps?.lat,
          longitude: gps?.lng,
          photo,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ success: false, message: data.error || "Failed" });
        setCapturedPhoto(null);
      } else {
        const hours = data.totalHours ? ` (${data.totalHours}h)` : "";
        setResult({
          success: true,
          message: action === "clock_in" ? "Clocked in!" : `Clocked out!${hours}`,
          withinGeofence: data.withinGeofence,
        });
        mutate();
      }
    } catch {
      setResult({ success: false, message: "Network error" });
      setCapturedPhoto(null);
    } finally {
      setLoading(false);
    }
  }, [isClockedIn, gps, mutate, capturePhoto]);

  const retakePhoto = () => setCapturedPhoto(null);

  // Distance to geofence
  let distanceInfo = "";
  let withinZone = false;
  if (gps && status?.geofence) {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(status.geofence.latitude - gps.lat);
    const dLng = toRad(status.geofence.longitude - gps.lng);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(gps.lat)) * Math.cos(toRad(status.geofence.latitude)) * Math.sin(dLng / 2) ** 2;
    const dist = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
    withinZone = dist <= status.geofence.radius_meters;
    distanceInfo = withinZone ? "Within zone" : `${dist}m away`;
  }

  const backBtn = (
    <Link
      href="/hr"
      aria-label="Back"
      className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-600 active:scale-95 active:bg-gray-200"
    >
      <ArrowLeft className="h-5 w-5" />
    </Link>
  );

  // Short-circuit: staff without an assigned outlet can't use the time clock.
  // Show just the banner instead of an empty camera / stuck GPS spinner.
  if (status && !status.outletId) {
    return (
      <div className="relative flex min-h-[80vh] flex-col items-center justify-center px-4">
        {backBtn}
        <Clock className="mb-3 h-10 w-10 text-gray-300" />
        <h1 className="mb-2 text-xl font-bold">Time Clock</h1>
        <div className="max-w-xs rounded-xl bg-amber-50 px-5 py-3 text-center text-sm text-amber-700">
          No outlet assigned. Time clock is for outlet staff only.
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[80vh] flex-col items-center px-4 pt-6">
      {backBtn}
      {/* Header */}
      <div className="mb-4 text-center">
        <Clock className="mx-auto mb-2 h-8 w-8 text-terracotta" />
        <h1 className="text-xl font-bold">Time Clock</h1>
        {status?.geofence && (
          <p className="mt-0.5 text-sm text-gray-500">{status.geofence.name}</p>
        )}
      </div>

      {/* GPS Status */}
      <div className={`mb-4 flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium ${
        gpsLoading ? "bg-gray-100 text-gray-500" :
        gpsError ? "bg-red-50 text-red-600" :
        withinZone ? "bg-green-50 text-green-700" :
        "bg-amber-50 text-amber-700"
      }`}>
        {gpsLoading ? (
          <><Loader2 className="h-3 w-3 animate-spin" /> Getting location...</>
        ) : gpsError ? (
          <><AlertTriangle className="h-3 w-3" /> {gpsError}</>
        ) : withinZone ? (
          <><CheckCircle2 className="h-3 w-3" /> <MapPin className="h-3 w-3" /> {distanceInfo}</>
        ) : (
          <><AlertTriangle className="h-3 w-3" /> <MapPin className="h-3 w-3" /> {distanceInfo}</>
        )}
      </div>

      {/* Camera Preview / Captured Photo */}
      <div className="relative mb-4 h-48 w-48 overflow-hidden rounded-2xl border-2 border-gray-200 bg-black">
        {capturedPhoto ? (
          <>
            <img src={capturedPhoto} alt="Captured" className="h-full w-full object-cover" />
            <button
              onClick={retakePhoto}
              className="absolute bottom-2 right-2 rounded-full bg-black/60 p-1.5 text-white"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </>
        ) : cameraError ? (
          <div className="flex h-full w-full flex-col items-center justify-center text-gray-400">
            <Camera className="mb-1 h-8 w-8" />
            <span className="text-xs">Camera unavailable</span>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
            style={{ transform: "scaleX(-1)" }}
          />
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Elapsed Time (when clocked in) */}
      {isClockedIn && elapsed && (
        <div className="mb-4 text-center">
          <p className="text-3xl font-bold tabular-nums text-terracotta">{elapsed}</p>
          <p className="mt-0.5 text-xs text-gray-500">
            Since {new Date(status!.activeLog!.clock_in).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      )}

      {/* Clock Button */}
      {/* Clock-in requires being within geofence; clock-out allowed anywhere */}
      <button
        onClick={handleClock}
        disabled={
          loading ||
          gpsLoading ||
          !status ||
          !!gpsError ||
          !gps ||
          (!cameraReady && !cameraError) ||
          (!isClockedIn && !!status?.geofence && !withinZone)
        }
        className={`flex h-32 w-32 flex-col items-center justify-center rounded-full shadow-lg transition-all active:scale-95 disabled:opacity-50 ${
          isClockedIn
            ? "bg-red-500 text-white hover:bg-red-600"
            : "bg-terracotta text-white hover:bg-terracotta-dark"
        }`}
      >
        {loading ? (
          <Loader2 className="h-8 w-8 animate-spin" />
        ) : isClockedIn ? (
          <>
            <LogOut className="mb-1 h-8 w-8" />
            <span className="text-sm font-bold">Clock Out</span>
          </>
        ) : (
          <>
            <LogIn className="mb-1 h-8 w-8" />
            <span className="text-sm font-bold">Clock In</span>
          </>
        )}
      </button>

      {/* GPS required warning */}
      {gpsError && (
        <p className="mt-3 text-center text-xs font-medium text-red-600">
          Location permission is required to clock in. Please enable it in your browser settings.
        </p>
      )}

      {/* Outside geofence warning */}
      {!isClockedIn && !gpsLoading && !gpsError && status?.geofence && !withinZone && (
        <p className="mt-3 text-center text-xs font-medium text-amber-700">
          You must be at {status.geofence.name} to clock in. {distanceInfo}.
        </p>
      )}

      {/* Result feedback */}
      {result && (
        <div className={`mt-4 rounded-xl px-5 py-2.5 text-center text-sm font-medium ${
          result.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
        }`}>
          {result.message}
          {result.success && result.withinGeofence === false && (
            <p className="mt-0.5 text-xs text-amber-600">Outside geofence zone</p>
          )}
        </div>
      )}

      {/* No outlet warning */}
      {status && !status.outletId && (
        <div className="mt-4 rounded-xl bg-amber-50 px-5 py-2.5 text-center text-sm text-amber-700">
          No outlet assigned. Contact your manager.
        </div>
      )}
    </div>
  );
}
