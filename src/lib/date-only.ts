export const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

type LocalCalendarDate = Pick<Date, "getFullYear" | "getMonth" | "getDate">;

/**
 * Returns the calendar date observed in the browser's local timezone.
 * Deliberately avoids toISOString(), whose UTC conversion can cross a date boundary.
 */
export function browserLocalDate(value: LocalCalendarDate = new Date()): string {
  const year = value.getFullYear();
  const month = value.getMonth() + 1;
  const day = value.getDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const utc = Date.UTC(year, month - 1, day);
  const date = new Date(utc);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isDateOnly(value: string): boolean {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return false;
  return isRealCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function parseDateParts(value: string): DateParts {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Expected a real YYYY-MM-DD date, received ${value}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isRealCalendarDate(year, month, day)) {
    throw new Error(`Expected a real YYYY-MM-DD date, received ${value}`);
  }
  return { year, month, day };
}

export function parseDateOnlyUtc(value: string): Date {
  const { year, month, day } = parseDateParts(value);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addCalendarDays(value: string, amount: number): string {
  const date = parseDateOnlyUtc(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return formatDateOnly(date);
}

export function compareDateOnly(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function startOfMondayWeek(value: string): string {
  const date = parseDateOnlyUtc(value);
  const weekday = date.getUTCDay();
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  date.setUTCDate(date.getUTCDate() - daysFromMonday);
  return formatDateOnly(date);
}

export function endOfMondayWeek(value: string): string {
  return addCalendarDays(startOfMondayWeek(value), 6);
}

export function startOfMonth(value: string): string {
  const { year, month } = parseDateParts(value);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

export function endOfMonth(value: string): string {
  const { year, month } = parseDateParts(value);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

export function addCalendarMonths(value: string, amount: number): string {
  const { year, month, day } = parseDateParts(value);
  const totalMonths = year * 12 + (month - 1) + amount;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = (totalMonths % 12) + 1;
  const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

export function visibleMonthGrid(value: string): string[] {
  const monthStart = startOfMonth(value);
  const gridStart = startOfMondayWeek(monthStart);
  return Array.from({ length: 42 }, (_, index) => addCalendarDays(gridStart, index));
}

export function toIcsDate(value: string): string {
  const { year, month, day } = parseDateParts(value);
  return `${String(year).padStart(4, "0")}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

export function exclusiveIcsEndDate(value: string): string {
  return toIcsDate(addCalendarDays(value, 1));
}

export function datesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  let current = start;
  while (compareDateOnly(current, end) <= 0) {
    dates.push(current);
    current = addCalendarDays(current, 1);
  }
  return dates;
}
