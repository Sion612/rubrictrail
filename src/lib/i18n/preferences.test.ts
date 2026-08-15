import { describe, expect, it, vi } from "vitest";
import {
  detectBrowserLocale,
  localeBootstrapScript,
  LOCALE_PREFERENCE_KEY,
  readLocalePreference,
  writeLocalePreference,
} from "@/lib/i18n/preferences";

function runLocaleBootstrap(
  languages: readonly string[],
  getItem: () => string | null = () => null,
): string {
  const documentElement = document.createElement("html");
  const execute = new Function(
    "localStorage",
    "navigator",
    "document",
    localeBootstrapScript(),
  ) as (
    storage: Pick<Storage, "getItem">,
    navigatorValue: { languages: readonly string[]; language: string },
    documentValue: { documentElement: HTMLElement },
  ) => void;
  execute(
    { getItem },
    { languages, language: languages[0] ?? "" },
    { documentElement },
  );
  return documentElement.lang;
}

describe("locale preferences", () => {
  it("uses the first supported browser locale in preference order", () => {
    expect(detectBrowserLocale(["en-US", "zh-CN"])).toBe("en");
    expect(detectBrowserLocale(["zh-CN", "en-US"])).toBe("zh-CN");
    expect(detectBrowserLocale(["fr-FR", "zh-SG", "en-US"])).toBe("zh-CN");
    expect(detectBrowserLocale(["fr-FR", "en-GB", "zh-CN"])).toBe("en");
  });

  it("uses the same preference order in the pre-hydration bootstrap", () => {
    expect(runLocaleBootstrap(["en-US", "zh-CN"])).toBe("en");
    expect(runLocaleBootstrap(["zh-CN", "en-US"])).toBe("zh-CN");
    expect(runLocaleBootstrap(["fr-FR", "zh-Hans-SG", "en-US"])).toBe(
      "zh-CN",
    );
  });

  it("keeps the browser locale when preference storage cannot be read", () => {
    expect(
      runLocaleBootstrap(["zh-CN", "en-US"], () => {
        throw new DOMException("Storage unavailable", "SecurityError");
      }),
    ).toBe("zh-CN");
  });

  it("detects supported Simplified Chinese browser locales", () => {
    expect(detectBrowserLocale(["zh-Hans-SG"])).toBe("zh-CN");
    expect(detectBrowserLocale(["zh-TW", "en-GB"])).toBe("en");
  });

  it("falls back to navigator.language when the preference list is empty", () => {
    const languages = vi
      .spyOn(window.navigator, "languages", "get")
      .mockReturnValue([]);
    const language = vi
      .spyOn(window.navigator, "language", "get")
      .mockReturnValue("zh-CN");

    expect(detectBrowserLocale()).toBe("zh-CN");

    languages.mockRestore();
    language.mockRestore();
  });

  it("reads and writes a minimal versioned preference", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    expect(writeLocalePreference(storage, "zh-CN")).toBe(true);
    expect(values.get(LOCALE_PREFERENCE_KEY)).toBe(
      JSON.stringify({ version: 1, locale: "zh-CN" }),
    );
    expect(readLocalePreference(storage)).toBe("zh-CN");
  });

  it("falls back safely when storage is unavailable or malformed", () => {
    const getItem = vi.fn(() => {
      throw new DOMException("blocked");
    });
    const setItem = vi.fn(() => {
      throw new DOMException("blocked");
    });
    expect(readLocalePreference({ getItem })).toBeNull();
    expect(writeLocalePreference({ setItem }, "en")).toBe(false);
    expect(
      readLocalePreference({ getItem: () => '{"version":1,"locale":"fr"}' }),
    ).toBeNull();
  });
});
