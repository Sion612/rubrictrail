import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  addCalendarMonths,
  browserLocalDate,
  compareDateOnly,
  exclusiveIcsEndDate,
  isDateOnly,
  startOfMondayWeek,
  startOfMonth,
  toIcsDate,
  visibleMonthGrid,
} from "@/lib/date-only";

describe("date-only utilities", () => {
  it("accepts real dates and rejects impossible ones", () => {
    expect(isDateOnly("2026-02-28")).toBe(true);
    expect(isDateOnly("2024-02-29")).toBe(true);
    expect(isDateOnly("2026-02-29")).toBe(false);
    expect(isDateOnly("2026-13-01")).toBe(false);
  });

  it("starts weeks on Monday and builds complete month grids", () => {
    expect(startOfMondayWeek("2026-08-16")).toBe("2026-08-10");
    expect(startOfMondayWeek("2026-08-10")).toBe("2026-08-10");
    const februaryLeap = visibleMonthGrid("2024-02-01");
    expect(februaryLeap[0]).toBe("2024-01-29");
    expect(februaryLeap).toHaveLength(42);
    expect(februaryLeap).toContain("2024-02-29");
    const februaryCommon = visibleMonthGrid("2026-02-01");
    expect(februaryCommon).not.toContain("2026-02-29");
    expect(addCalendarMonths("2026-12-31", 1)).toBe("2027-01-31");
  });

  it("compares and converts dates without timezone drift", () => {
    expect(compareDateOnly("2026-08-16", "2026-08-17")).toBe(-1);
    expect(addCalendarDays("2026-08-16", 1)).toBe("2026-08-17");
    expect(toIcsDate("2026-08-16")).toBe("20260816");
    expect(exclusiveIcsEndDate("2026-08-16")).toBe("20260817");
    expect(startOfMonth("2026-08-16")).toBe("2026-08-01");
  });

  it("uses local calendar fields instead of a UTC ISO date", () => {
    const localBoundary = {
      getFullYear: () => 2026,
      getMonth: () => 7,
      getDate: () => 21,
      toISOString: () => {
        throw new Error("browserLocalDate must not read UTC ISO fields");
      },
    };

    expect(browserLocalDate(localBoundary)).toBe("2026-08-21");
  });
});
