"use client";

import { useRef, useState } from "react";

// Lightweight pull-to-refresh for touch devices. Engages only when the page is
// scrolled to the very top; pulling past the threshold and releasing triggers
// onRefresh. A resistance factor makes the pull feel natural. No-op with a mouse.
const THRESHOLD = 70;

export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => void | Promise<void>;
  children: React.ReactNode;
}) {
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  function onTouchStart(e: React.TouchEvent) {
    if (refreshing || window.scrollY > 0) {
      startY.current = null;
      return;
    }
    startY.current = e.touches[0].clientY;
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startY.current === null || refreshing) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) setPull(Math.min(dy * 0.5, THRESHOLD + 24));
  }

  function onTouchEnd() {
    if (startY.current === null) return;
    const shouldRefresh = pull >= THRESHOLD;
    startY.current = null;
    if (shouldRefresh) {
      setRefreshing(true);
      setPull(THRESHOLD);
      // router.refresh() isn't awaitable, so keep the spinner up briefly.
      Promise.resolve(onRefresh()).finally(() => {
        setTimeout(() => {
          setRefreshing(false);
          setPull(0);
        }, 600);
      });
    } else {
      setPull(0);
    }
  }

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div
        className="flex items-center justify-center overflow-hidden transition-[height] duration-150"
        style={{ height: pull }}
      >
        {(pull > 0 || refreshing) && (
          <svg
            className={"h-5 w-5 text-rose-500 " + (refreshing ? "animate-spin" : "")}
            style={refreshing ? undefined : { transform: `rotate(${(pull / THRESHOLD) * 270}deg)` }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-6.2-8.5" />
            <path d="M21 3v6h-6" />
          </svg>
        )}
      </div>
      {children}
    </div>
  );
}
