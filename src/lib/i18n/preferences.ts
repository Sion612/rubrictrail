import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/types";

export const LOCALE_PREFERENCE_KEY = "rubrictrail.preferences.v1";

interface LocalePreferenceV1 {
  version: 1;
  locale: Locale;
}

function localeForLanguage(language: string): Locale | null {
  const normalized = language.toLowerCase();
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  if (
    normalized === "zh" ||
    normalized === "zh-cn" ||
    normalized.startsWith("zh-cn-") ||
    normalized === "zh-sg" ||
    normalized.startsWith("zh-sg-") ||
    normalized === "zh-hans" ||
    normalized.startsWith("zh-hans-")
  ) {
    return "zh-CN";
  }
  return null;
}

export function detectBrowserLocale(
  languages?: readonly string[],
): Locale {
  let preferences = languages;
  if (!preferences && typeof navigator !== "undefined") {
    try {
      preferences = navigator.languages?.length
        ? navigator.languages
        : navigator.language
          ? [navigator.language]
          : [];
    } catch {
      preferences = [];
    }
  }
  for (const language of preferences ?? []) {
    const locale = localeForLanguage(language);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

export function readLocalePreference(storage: Pick<Storage, "getItem">): Locale | null {
  try {
    const raw = storage.getItem(LOCALE_PREFERENCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalePreferenceV1>;
    return parsed.version === 1 && isLocale(parsed.locale) ? parsed.locale : null;
  } catch {
    return null;
  }
}

export function writeLocalePreference(
  storage: Pick<Storage, "setItem">,
  locale: Locale,
): boolean {
  const preference: LocalePreferenceV1 = { version: 1, locale };
  try {
    storage.setItem(LOCALE_PREFERENCE_KEY, JSON.stringify(preference));
    return true;
  } catch {
    return false;
  }
}

export function localeBootstrapScript(): string {
  return `(() => { const languages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]; let browserLocale = "en"; for (const value of languages) { const language = String(value).toLowerCase(); if (language === "en" || language.startsWith("en-")) { browserLocale = "en"; break; } if (language === "zh" || language === "zh-cn" || language.startsWith("zh-cn-") || language === "zh-sg" || language.startsWith("zh-sg-") || language === "zh-hans" || language.startsWith("zh-hans-")) { browserLocale = "zh-CN"; break; } } let locale = browserLocale; try { const key = ${JSON.stringify(LOCALE_PREFERENCE_KEY)}; const raw = localStorage.getItem(key); const saved = raw ? JSON.parse(raw) : null; if (saved && saved.version === 1 && (saved.locale === "en" || saved.locale === "zh-CN")) locale = saved.locale; } catch {} document.documentElement.lang = locale; document.documentElement.dataset.locale = locale; })();`;
}
