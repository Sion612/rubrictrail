import type { UploadedProjectSource } from "@/lib/ui-types";

export function sourceRegistryNumber(sourceId: string): string {
  return sourceId.match(/^source-(\d+)$/u)?.[1] ?? sourceId;
}

export function sourceOptionLabel(
  source: UploadedProjectSource,
  sourceWord: string,
): string {
  return `${source.fileName} · ${source.kind.toUpperCase()} · ${sourceWord} ${sourceRegistryNumber(source.id)}`;
}

export function sourceRegisterSuffix(
  source: UploadedProjectSource,
  sourceWord: string,
): string {
  return `${sourceWord} ${sourceRegistryNumber(source.id)}`;
}

export function parseOptionalPdfPage(
  raw: string,
  pageCount: number | null,
): { ok: true; page: number | null } | { ok: false } {
  const value = raw.trim();
  if (value === "") return { ok: true, page: null };
  if (!/^[1-9]\d*$/u.test(value)) return { ok: false };
  if (pageCount === null || !Number.isInteger(pageCount) || pageCount < 1) {
    return { ok: false };
  }
  const page = Number(value);
  if (page > pageCount) return { ok: false };
  return { ok: true, page };
}
