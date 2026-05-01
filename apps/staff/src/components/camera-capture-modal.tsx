"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, X, Check, RefreshCw, AlertTriangle } from "lucide-react";

// Fullscreen camera capture modal. Uses getUserMedia directly so we
// have a live preview, a custom capture button, and 100% camera-only
// behavior — no gallery picker fallback, no browser chooser dialog.
//
// Why not <input type="file" capture="environment">? On Android the
// `capture` attribute is a HINT — many browsers (Samsung Internet,
// MIUI, some OEM skins) still show a chooser with both Camera and
// Files options. Combining it with `multiple` flips Chrome itself
// into file-picker mode. getUserMedia is the only way to enforce
// camera-only on the web.
//
// Constraints note: ALWAYS use { ideal: N } not { N }. Android
// device cameras typically only expose 720p/1080p natively and
// reject exact constraints with OverconstrainedError. The capture
// canvas crops/scales to whatever the calling page wants, so the
// stream resolution doesn't have to match.

export type CameraCaptureModalProps = {
  open: boolean;
  facingMode?: "user" | "environment";   // selfie vs rear (default rear)
  mirror?: boolean;                       // mirror preview + captured pixels (default: matches selfie)
  onCapture: (blob: Blob, dataUrl: string) => void | Promise<void>;
  onClose: () => void;
  // Quality for JPEG output (0..1). Default 0.85.
  quality?: number;
  // Optional title shown in the header.
  title?: string;
};

export function CameraCaptureModal({
  open,
  facingMode = "environment",
  mirror,
  onCapture,
  onClose,
  quality = 0.85,
  title,
}: CameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Default mirror behaviour: mirror selfies (so the user sees themselves
  // as in a real mirror), don't mirror rear-camera shots.
  const shouldMirror = mirror ?? facingMode === "user";

  useEffect(() => {
    if (!open) return;
    setError(null);
    setReady(false);
    setPreviewUrl(null);
    setSubmitting(false);

    let cancelled = false;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode,
            // Hints, not requirements — Android cameras typically only
            // support standard resolutions and will reject exact specs.
            width:  { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            if (!cancelled) setReady(true);
          };
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error
          ? (err.name === "NotAllowedError"
              ? "Camera permission denied. Allow camera access in your browser settings, then close and reopen."
              : err.name === "NotFoundError"
                ? "No camera found on this device."
                : err.name === "NotReadableError"
                  ? "Camera is already in use by another app. Close other camera apps and try again."
                  : err.name === "OverconstrainedError"
                    ? "This camera doesn't support the requested settings."
                    : err.message)
          : "Camera not available";
        setError(msg);
      }
    }
    start();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open, facingMode]);

  const capture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (shouldMirror) {
      ctx.translate(vw, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, vw, vh);
    if (shouldMirror) ctx.setTransform(1, 0, 0, 1, 0, 0);
    setPreviewUrl(canvas.toDataURL("image/jpeg", quality));
  };

  const retake = () => setPreviewUrl(null);

  const accept = async () => {
    if (!previewUrl || !canvasRef.current) return;
    setSubmitting(true);
    await new Promise<void>((resolve) => {
      canvasRef.current!.toBlob(
        async (blob) => {
          if (blob) {
            try { await onCapture(blob, previewUrl); }
            catch (err) {
              setError(err instanceof Error ? err.message : "Save failed");
              setSubmitting(false);
              resolve();
              return;
            }
          }
          onClose();
          resolve();
        },
        "image/jpeg",
        quality,
      );
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      {/* Header */}
      <div className="flex items-center justify-between bg-black/80 px-4 py-3 text-white">
        <button onClick={onClose} className="rounded-full p-2 hover:bg-white/10" aria-label="Close camera">
          <X className="h-5 w-5" />
        </button>
        <p className="text-sm font-medium">{title ?? "Take Photo"}</p>
        <div className="w-9" />
      </div>

      {/* Live preview / captured preview / error */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {error ? (
          <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center text-white">
            <AlertTriangle className="h-10 w-10 text-amber-400" />
            <p className="text-sm">{error}</p>
            <button
              onClick={onClose}
              className="mt-2 rounded-md bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20"
            >
              Close
            </button>
          </div>
        ) : previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Captured" className="max-h-full max-w-full object-contain" />
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`h-full w-full object-cover ${shouldMirror ? "scale-x-[-1]" : ""}`}
          />
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Footer controls */}
      <div className="flex items-center justify-around bg-black/80 px-6 py-5">
        {error ? null : previewUrl ? (
          <>
            <button
              onClick={retake}
              disabled={submitting}
              className="flex flex-col items-center gap-1 rounded-full px-4 py-2 text-white disabled:opacity-50"
            >
              <RefreshCw className="h-6 w-6" />
              <span className="text-[11px]">Retake</span>
            </button>
            <button
              onClick={accept}
              disabled={submitting}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500 text-white shadow-lg active:scale-95 disabled:opacity-50"
              aria-label="Use photo"
            >
              <Check className="h-8 w-8" />
            </button>
            <div className="w-16" />
          </>
        ) : (
          <>
            <div className="w-16" />
            <button
              onClick={capture}
              disabled={!ready}
              className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-white/10 active:scale-95 disabled:opacity-40"
              aria-label="Capture photo"
            >
              <div className="h-14 w-14 rounded-full bg-white" />
            </button>
            <div className="flex h-16 w-16 items-center justify-center text-white/40">
              <Camera className="h-6 w-6" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
