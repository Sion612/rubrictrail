"use client";

import { useEffect, useState } from "react";

import { browserLocalDate } from "@/lib/date-only";

function delayUntilNextLocalDay(now: Date): number {
  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(1_000, nextDay.getTime() - now.getTime() + 100);
}

/** Keeps time-relative UI aligned with the browser-local date across midnight. */
export function useBrowserLocalDate(): string {
  const [currentDate, setCurrentDate] = useState(() => browserLocalDate());

  useEffect(() => {
    let timer = 0;
    const refresh = () => {
      const now = new Date();
      setCurrentDate(browserLocalDate(now));
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, delayUntilNextLocalDay(now));
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  return currentDate;
}
