"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { Coffee } from "lucide-react";

const SUPABASE_HOST  = "kqdcdhpnyuwrxqhbuyfl.supabase.co";
const CLOUDINARY_HOST = "res.cloudinary.com";

/**
 * Build an optimised URL for a thumbnail.
 * - Cloudinary: inject transformation segment for instant edge-resized delivery
 * - Supabase fallback: use the render/image endpoint
 */
function toTransformedUrl(src: string, width: number, fit: "cover" | "contain"): string {
  try {
    if (src.includes(CLOUDINARY_HOST)) {
      // Insert Cloudinary transform before /image/upload/
      // e.g. .../image/upload/v123/... → .../image/upload/w_88,q_auto,f_auto/v123/...
      const cropMode = fit === "contain" ? "fit" : "fill";
      const transforms = `w_${width},c_${cropMode},q_auto,f_auto`;
      return src.replace("/image/upload/", `/image/upload/${transforms}/`);
    }
    if (src.includes(SUPABASE_HOST)) {
      const url = new URL(src);
      url.pathname = url.pathname.replace("/storage/v1/object/", "/storage/v1/render/image/");
      url.searchParams.set("width", String(width));
      url.searchParams.set("quality", "80");
      url.searchParams.set("resize", fit);
      return url.toString();
    }
  } catch { /* ignore */ }
  return src;
}

function isTransformable(src: string) {
  return src.includes(CLOUDINARY_HOST) || src.includes(SUPABASE_HOST);
}

interface ProductImageProps {
  src?: string;
  alt: string;
  fill?: boolean;
  className?: string;
  sizes?: string;
  priority?: boolean;
  thumbnailWidth?: number;
  /** "cover" (default) fills & crops · "contain" shows full image on white bg */
  fit?: "cover" | "contain";
  /** Set true to suppress the default bg-white in contain mode (lets parent bg show through) */
  noBg?: boolean;
}

export function ProductImage({
  src,
  alt,
  fill = false,
  className,
  sizes,
  priority = false,
  thumbnailWidth,
  fit = "cover",
  noBg = false,
}: ProductImageProps) {
  const [error, setError]   = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // If image loads from cache before React mounts, onLoad won't fire — check on mount
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoaded(true);
    }
  }, []);

  if (!src || error) {
    return (
      <div className={`flex items-center justify-center bg-muted ${className ?? ""}`}>
        <Coffee className="h-8 w-8 text-muted-foreground/30" />
      </div>
    );
  }

  const imgClass = fit === "contain"
    ? "object-contain p-1.5 w-full h-full"
    : "object-cover w-full h-full";

  // For thumbnails: use a plain <img> to avoid Next.js domain-whitelist restrictions.
  // Cloudinary/Supabase URLs get CDN transforms for faster delivery; others load as-is.
  if (thumbnailWidth) {
    const imgSrc = isTransformable(src) ? toTransformedUrl(src, thumbnailWidth, fit) : src;
    return (
      <div className={`relative overflow-hidden ${fit === "contain" && !noBg ? "bg-white" : ""} ${fill ? "w-full h-full" : ""} ${className ?? ""}`}>
        {!loaded && <div className="absolute inset-0 bg-muted animate-pulse" />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={imgSrc}
          alt={alt}
          className={`transition-opacity duration-200 ${imgClass} ${loaded ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
        />
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${fit === "contain" && !noBg ? "bg-white" : ""} ${fill ? "w-full h-full" : ""} ${className ?? ""}`}>
      {!loaded && <div className="absolute inset-0 bg-muted animate-pulse" />}
      <Image
        src={src}
        alt={alt}
        fill={fill}
        sizes={sizes ?? "(max-width: 430px) 50vw, 215px"}
        className={`transition-opacity duration-200 ${fit === "contain" ? "object-contain p-1.5" : "object-cover"} ${loaded ? "opacity-100" : "opacity-0"}`}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        priority={priority}
      />
    </div>
  );
}
