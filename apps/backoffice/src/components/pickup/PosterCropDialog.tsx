"use client";

import { useCallback, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Loader2, X } from "lucide-react";

type Props = {
  // Source: either a File the user just picked, or an existing image
  // URL the operator wants to re-crop.
  source: File | string;
  aspect: number;
  aspectLabel: string;
  // Output is a JPEG File ready for upload — same flow as the existing
  // /api/pickup/upload-image route, just with a pre-cropped image.
  onSave: (cropped: File) => void;
  onCancel: () => void;
};

// In-memory data URL for File sources so the cropper has a stable img
// src across re-renders.
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Render the cropped region from the source image into a JPEG. Output
// long-edge is capped at 1440 — same as the splash auto-resize so we
// don't blow up Cloudinary with megapixels.
async function makeCroppedJpeg(
  src: string,
  pixelCrop: Area,
  maxLongEdge = 1440,
  quality = 0.85,
): Promise<File> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });

  const scale = Math.min(1, maxLongEdge / Math.max(pixelCrop.width, pixelCrop.height));
  const w = Math.round(pixelCrop.width * scale);
  const h = Math.round(pixelCrop.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas ctx unavailable");
  ctx.drawImage(
    img,
    pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
    0, 0, w, h,
  );

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new Error("canvas toBlob failed");

  return new File([blob], `poster-${Date.now()}.jpg`, { type: "image/jpeg" });
}

export function PosterCropDialog({ source, aspect, aspectLabel, onSave, onCancel }: Props) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixelCrop, setPixelCrop] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);

  // Lazy-load the src once on mount.
  if (imgSrc === null) {
    if (typeof source === "string") {
      setImgSrc(source);
    } else {
      fileToDataUrl(source).then(setImgSrc).catch(() => onCancel());
    }
  }

  const onCropComplete = useCallback((_: Area, areaPx: Area) => {
    setPixelCrop(areaPx);
  }, []);

  const handleSave = async () => {
    if (!imgSrc || !pixelCrop) return;
    setSaving(true);
    try {
      const file = await makeCroppedJpeg(imgSrc, pixelCrop);
      onSave(file);
    } catch {
      onCancel();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Position the image</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Drag to pan · scroll / pinch to zoom · {aspectLabel}
            </p>
          </div>
          <button onClick={onCancel} className="rounded-md p-1 hover:bg-gray-100">
            <X className="h-4 w-4 text-gray-600" />
          </button>
        </div>

        {/* The cropper viewport. Black background so the crop window
            edge is obvious. Height is fixed; the cropper handles the
            aspect-ratio constraint inside. */}
        <div className="relative bg-black" style={{ height: 460 }}>
          {imgSrc ? (
            <Cropper
              image={imgSrc}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              objectFit="contain"
              minZoom={1}
              maxZoom={4}
              zoomSpeed={0.25}
              showGrid={false}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
        </div>

        {/* Zoom slider — necessary on mouse-only setups where the
            scroll-wheel zoom feels too sensitive. Range 1× (fit) to 4×. */}
        <div className="flex items-center gap-3 px-5 py-3">
          <span className="text-[11px] font-medium text-gray-500">Zoom</span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1"
          />
          <span className="text-[11px] tabular-nums text-gray-500 w-8 text-right">
            {zoom.toFixed(1)}×
          </span>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!imgSrc || !pixelCrop || saving}
            className="flex items-center gap-2 rounded-lg bg-terracotta px-3 py-1.5 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-60"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save crop
          </button>
        </div>
      </div>
    </div>
  );
}
