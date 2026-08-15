"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  enMessages,
  zhCNMessages,
  type MessageKey,
} from "@/lib/i18n/messages";
import {
  detectBrowserLocale,
  LOCALE_PREFERENCE_KEY,
  readLocalePreference,
  writeLocalePreference,
} from "@/lib/i18n/preferences";
import {
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
  type MessageValues,
} from "@/lib/i18n/types";

interface LocaleContextValue {
  locale: Locale;
  localePreferenceSaveFailed: boolean;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, values?: MessageValues) => string;
  formatDate: (value: string | Date, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
}

const LOCALE_CHANGE_EVENT = "rubrictrail:locale-change";
let activeLocale: Locale | null = null;

function interpolate(template: string, values?: MessageValues): string {
  if (!values) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

function messagesFor(locale: Locale) {
  return locale === "zh-CN" ? zhCNMessages : enMessages;
}

function applyDocumentLocale(locale: Locale) {
  document.documentElement.lang = locale;
  document.documentElement.dataset.locale = locale;
  const messages = messagesFor(locale);
  document.title = messages["app.metadata.title"];
  document
    .querySelector<HTMLMetaElement>('meta[name="description"]')
    ?.setAttribute("content", messages["app.metadata.description"]);
}

const defaultMessages = messagesFor(DEFAULT_LOCALE);
const defaultContext: LocaleContextValue = {
  locale: DEFAULT_LOCALE,
  localePreferenceSaveFailed: false,
  setLocale: () => undefined,
  t: (key, values) => interpolate(defaultMessages[key], values),
  formatDate: (value, options) =>
    new Intl.DateTimeFormat("en-GB", options).format(
      typeof value === "string" ? new Date(value) : value,
    ),
  formatNumber: (value, options) => new Intl.NumberFormat("en-GB", options).format(value),
};

const LocaleContext = createContext<LocaleContextValue>(defaultContext);

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [localePreferenceSaveFailed, setLocalePreferenceSaveFailed] =
    useState(false);
  const locale = useSyncExternalStore(
    useCallback((onStoreChange) => {
      function handleLocaleChange() {
        onStoreChange();
      }

      function handleStorage(event: StorageEvent) {
        const storage = browserStorage();
        if (
          (event.key !== LOCALE_PREFERENCE_KEY && event.key !== null) ||
          (storage && event.storageArea !== storage)
        ) {
          return;
        }
        activeLocale = storage ? readLocalePreference(storage) ?? detectBrowserLocale() : detectBrowserLocale();
        applyDocumentLocale(activeLocale);
        setLocalePreferenceSaveFailed(false);
        onStoreChange();
      }

      window.addEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
      window.addEventListener("storage", handleStorage);
      return () => {
        window.removeEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
        window.removeEventListener("storage", handleStorage);
      };
    }, []),
    () => {
      const storage = browserStorage();
      activeLocale ??= storage ? readLocalePreference(storage) ?? detectBrowserLocale() : detectBrowserLocale();
      return activeLocale;
    },
    () => DEFAULT_LOCALE,
  );

  useEffect(() => {
    applyDocumentLocale(locale);
  }, [locale]);

  const setLocale = useCallback((nextLocale: Locale) => {
    if (!isLocale(nextLocale)) return;
    activeLocale = nextLocale;
    applyDocumentLocale(nextLocale);
    const storage = browserStorage();
    const preferenceSaved = storage
      ? writeLocalePreference(storage, nextLocale)
      : false;
    setLocalePreferenceSaveFailed(!preferenceSaved);
    window.dispatchEvent(new Event(LOCALE_CHANGE_EVENT));
  }, []);

  const value = useMemo<LocaleContextValue>(() => {
    const messages = messagesFor(locale);
    const intlLocale = locale === "zh-CN" ? "zh-CN" : "en-GB";
    return {
      locale,
      localePreferenceSaveFailed,
      setLocale,
      t: (key, values) => interpolate(messages[key], values),
      formatDate: (input, options) =>
        new Intl.DateTimeFormat(intlLocale, options).format(
          typeof input === "string" ? new Date(input) : input,
        ),
      formatNumber: (input, options) =>
        new Intl.NumberFormat(intlLocale, options).format(input),
    };
  }, [locale, localePreferenceSaveFailed, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n(): LocaleContextValue {
  return useContext(LocaleContext);
}

export function useLocalizedMessages<T extends Record<string, string>>(
  english: T,
  simplifiedChinese: { [K in keyof T]: string },
): { [K in keyof T]: string } {
  const { locale } = useI18n();
  return locale === "zh-CN" ? simplifiedChinese : english;
}
