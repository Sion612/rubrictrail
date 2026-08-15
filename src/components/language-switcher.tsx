"use client";

import { Languages } from "lucide-react";
import { useI18n } from "@/components/locale-provider";
import type { Locale } from "@/lib/i18n/types";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, localePreferenceSaveFailed, setLocale, t } = useI18n();

  return (
    <div className={compact ? "language-switcher-group language-switcher-group--compact" : "language-switcher-group"}>
      <label className={compact ? "language-switcher language-switcher--compact" : "language-switcher"}>
        <Languages aria-hidden="true" />
        <span className={compact ? "visually-hidden" : undefined}>{t("language.label")}</span>
        <select
          aria-label={compact ? t("language.label") : undefined}
          value={locale}
          onChange={(event) => setLocale(event.target.value as Locale)}
        >
          <option value="en" lang="en">{t("language.english")}</option>
          <option value="zh-CN" lang="zh-CN">{t("language.chinese")}</option>
        </select>
      </label>
      {localePreferenceSaveFailed ? (
        <span className="locale-preference-warning" role="status">
          {t("language.saveFailed")}
        </span>
      ) : null}
    </div>
  );
}
