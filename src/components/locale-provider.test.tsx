import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LocaleProvider, useI18n } from "@/components/locale-provider";
import { LOCALE_PREFERENCE_KEY } from "@/lib/i18n/preferences";

function Probe() {
  const { locale, localePreferenceSaveFailed, t } = useI18n();
  return (
    <p data-testid="locale-probe">
      {locale}:{t("common.continue")}:{String(localePreferenceSaveFailed)}
    </p>
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LocaleProvider", () => {
  it("switches the interface language without remounting children", async () => {
    render(
      <LocaleProvider>
        <LanguageSwitcher />
        <Probe />
      </LocaleProvider>,
    );

    const select = await screen.findByRole("combobox", { name: "Interface language" });
    fireEvent.change(select, { target: { value: "zh-CN" } });

    expect(screen.getByTestId("locale-probe")).toHaveTextContent("zh-CN:继续");
    expect(document.documentElement).toHaveAttribute("lang", "zh-CN");
    expect(JSON.parse(window.localStorage.getItem(LOCALE_PREFERENCE_KEY) ?? "{}")).toEqual({
      version: 1,
      locale: "zh-CN",
    });
  });

  it("restores a saved locale before showing its children", async () => {
    window.localStorage.setItem(
      LOCALE_PREFERENCE_KEY,
      JSON.stringify({ version: 1, locale: "zh-CN" }),
    );
    render(
      <LocaleProvider>
        <LanguageSwitcher />
        <Probe />
      </LocaleProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("locale-probe")).toHaveTextContent("zh-CN:继续");
    });
  });

  it("returns to the browser locale when another tab clears stored preferences", async () => {
    render(
      <LocaleProvider>
        <LanguageSwitcher />
        <Probe />
      </LocaleProvider>,
    );

    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: "zh-CN" } });
    window.localStorage.removeItem(LOCALE_PREFERENCE_KEY);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: null,
        storageArea: window.localStorage,
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("locale-probe")).toHaveTextContent("en:Continue");
    });
  });

  it("keeps the selected locale but reports a failed preference write until a later save succeeds", async () => {
    render(
      <LocaleProvider>
        <LanguageSwitcher />
        <Probe />
      </LocaleProvider>,
    );

    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: "en" } });

    const nativeSetItem = Storage.prototype.setItem;
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === LOCALE_PREFERENCE_KEY) {
          throw new DOMException("Storage unavailable", "QuotaExceededError");
        }
        nativeSetItem.call(this, key, value);
      });

    fireEvent.change(select, { target: { value: "zh-CN" } });

    expect(screen.getByTestId("locale-probe")).toHaveTextContent(
      "zh-CN:继续:true",
    );
    const saveWarning = screen.getByRole("status");
    expect(saveWarning).toHaveTextContent(
      "界面语言已在此标签页切换，但 RubricTrail 无法记住你的选择。",
    );
    expect(saveWarning.parentElement).toHaveClass("language-switcher-group");

    setItem.mockRestore();
    fireEvent.change(select, { target: { value: "en" } });

    expect(screen.getByTestId("locale-probe")).toHaveTextContent(
      "en:Continue:false",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("reports the same tab-only outcome when the storage getter is unavailable", async () => {
    const storageGetter = vi
      .spyOn(window, "localStorage", "get")
      .mockImplementation(() => {
        throw new DOMException("Storage unavailable", "SecurityError");
      });

    render(
      <LocaleProvider>
        <LanguageSwitcher />
        <Probe />
      </LocaleProvider>,
    );

    const select = await screen.findByRole("combobox");
    const nextLocale = (select as HTMLSelectElement).value === "zh-CN" ? "en" : "zh-CN";
    fireEvent.change(select, { target: { value: nextLocale } });

    expect(screen.getByTestId("locale-probe")).toHaveTextContent(":true");
    expect(screen.getByRole("status")).toHaveTextContent(
      nextLocale === "zh-CN"
        ? "界面语言已在此标签页切换，但 RubricTrail 无法记住你的选择。"
        : "Language changed for this tab, but RubricTrail could not remember your choice.",
    );

    storageGetter.mockRestore();
  });

  it("clears a stale save warning when another tab stores a valid preference", async () => {
    render(
      <LocaleProvider>
        <LanguageSwitcher />
        <Probe />
      </LocaleProvider>,
    );
    const select = await screen.findByRole("combobox");
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Storage unavailable", "QuotaExceededError");
      });
    fireEvent.change(select, { target: { value: "zh-CN" } });
    expect(screen.getByRole("status")).toBeInTheDocument();

    setItem.mockRestore();
    const storedPreference = JSON.stringify({ version: 1, locale: "en" });
    window.localStorage.setItem(LOCALE_PREFERENCE_KEY, storedPreference);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: LOCALE_PREFERENCE_KEY,
        newValue: storedPreference,
        storageArea: window.localStorage,
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("locale-probe")).toHaveTextContent("en:Continue:false");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });
});
