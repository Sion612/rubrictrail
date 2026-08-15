import { describe, expect, it } from "vitest";
import { appEn, appZhCN, localizeStoredAppMessage } from "@/lib/i18n/messages/app";

describe("localizeStoredAppMessage", () => {
  it("relocalizes persistent and transient messages after a language switch", () => {
    expect(localizeStoredAppMessage(appEn["persistence.storage"], "zh-CN")).toBe(
      appZhCN["persistence.storage"],
    );
    expect(localizeStoredAppMessage(appZhCN["notice.sampleLoaded"], "en")).toBe(
      appEn["notice.sampleLoaded"],
    );
  });

  it("preserves interpolated values while translating the surrounding message", () => {
    expect(
      localizeStoredAppMessage(
        "This will replace the local project “PRIVATE PROJECT”.",
        "zh-CN",
      ),
    ).toBe("这会替换本地项目“PRIVATE PROJECT”。");
  });

  it("leaves unknown user or diagnostic text unchanged", () => {
    expect(localizeStoredAppMessage("PRIVATE diagnostic detail", "zh-CN")).toBe(
      "PRIVATE diagnostic detail",
    );
  });
});
