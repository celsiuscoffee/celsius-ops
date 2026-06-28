"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Loader2 } from "lucide-react";

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  className?: string;
  // When true the pull gesture is inert (no listeners attached) — e.g. on full-screen,
  // internally-scrolled pages like the Purchase Orders workspace, where an accidental pull
  // reloading the page makes it hard to navigate.
  disabled?: boolean;
}

const THRESHOLD = 80;

export function PullToRefresh({ onRefresh, children, className, disabled = false }: PullToRefreshProps) {
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const el = containerRef.current;
    if (!el || el.scrollTop > 0) return;
    startY.current = e.touches[0].clientY;
    setPulling(true);
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!pulling || refreshing) return;
    const dist = Math.max(0, e.touches[0].clientY - startY.current);
    setPullDistance(dist > THRESHOLD ? THRESHOLD + (dist - THRESHOLD) * 0.3 : dist);
  }, [pulling, refreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (!pulling) return;
    if (pullDistance >= THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPullDistance(THRESHOLD);
      try { await onRefresh(); } catch { /* ignore */ }
      setRefreshing(false);
    }
    setPulling(false);
    setPullDistance(0);
  }, [pulling, pullDistance, refreshing, onRefresh]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || disabled) return;
    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: true });
    el.addEventListener("touchend", handleTouchEnd);
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd, disabled]);

  const progress = Math.min(pullDistance / THRESHOLD, 1);

  return (
    <div ref={containerRef} className={className}>
      {pullDistance > 0 && (
        <div
          className="flex items-center justify-center overflow-hidden transition-[height] duration-200"
          style={{ height: `${pullDistance}px` }}
        >
          <div className="flex items-center gap-2 text-xs text-gray-400" style={{ opacity: progress }}>
            <Loader2
              className={`h-4 w-4 ${refreshing ? "animate-spin text-terracotta" : ""}`}
              style={!refreshing ? { transform: `rotate(${progress * 360}deg)` } : undefined}
            />
            {refreshing ? "Refreshing..." : progress >= 1 ? "Release to refresh" : "Pull to refresh"}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
