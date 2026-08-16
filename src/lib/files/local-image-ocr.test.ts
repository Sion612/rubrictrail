import { afterEach, describe, expect, it, vi } from "vitest";

import { browserImageOcrAdapter } from "./local-image-ocr";

const ocrMocks = vi.hoisted(() => ({
  createWorker: vi.fn(),
  recognize: vi.fn(),
  terminate: vi.fn(),
}));

vi.mock("tesseract.js", () => ({
  createWorker: ocrMocks.createWorker,
  OEM: { LSTM_ONLY: 1 },
}));

function imageFile(bytes: readonly number[], name: string, type: string): File {
  const blob = new Blob([new Uint8Array(bytes)], { type });
  return Object.assign(blob, { name, lastModified: 0 }) as File;
}

const signatures = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0],
  jpeg: [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0],
  webp: [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
  document.querySelectorAll("script[data-ocr-test]").forEach((script) => script.remove());
  ocrMocks.createWorker.mockReset();
  ocrMocks.recognize.mockReset();
  ocrMocks.terminate.mockReset();
});

describe("browserImageOcrAdapter.createSession", () => {
  it("loads English and Simplified Chinese from same-origin base-path assets", async () => {
    const script = document.createElement("script");
    script.dataset.ocrTest = "true";
    script.src = "/rubrictrail/_next/static/chunks/app.js";
    document.head.append(script);
    ocrMocks.recognize.mockResolvedValue({ data: { text: "Local OCR text" } });
    ocrMocks.createWorker.mockResolvedValue({
      recognize: ocrMocks.recognize,
      terminate: ocrMocks.terminate,
    });

    const session = await browserImageOcrAdapter.createSession();
    expect(ocrMocks.createWorker).toHaveBeenCalledWith(
      ["eng", "chi_sim"],
      1,
      expect.objectContaining({
        workerPath: "http://localhost:3000/rubrictrail/ocr/worker.min.js",
        corePath: "http://localhost:3000/rubrictrail/ocr/core",
        langPath: "http://localhost:3000/rubrictrail/ocr/lang",
        workerBlobURL: false,
        cacheMethod: "none",
        gzip: true,
      }),
    );
    await expect(
      session.recognize(imageFile(signatures.png, "page.png", "image/png"), vi.fn()),
    ).resolves.toBe("Local OCR text");
    await session.terminate();
    expect(ocrMocks.terminate).toHaveBeenCalledOnce();
  });
});

describe("browserImageOcrAdapter.inspect", () => {
  it.each([
    ["png", "page.png", "image/png"],
    ["jpeg", "page.jpg", "image/jpeg"],
    ["webp", "page.webp", "image/webp"],
  ] as const)("validates and decodes a %s file locally", async (kind, name, type) => {
    const close = vi.fn();
    const createImageBitmap = vi.fn().mockResolvedValue({ width: 1200, height: 630, close });
    vi.stubGlobal("createImageBitmap", createImageBitmap);

    await expect(
      browserImageOcrAdapter.inspect(imageFile(signatures[kind], name, type), kind),
    ).resolves.toEqual({ width: 1200, height: 630 });
    expect(createImageBitmap).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects an image whose magic bytes do not match the expected kind", async () => {
    const createImageBitmap = vi.fn();
    vi.stubGlobal("createImageBitmap", createImageBitmap);

    await expect(
      browserImageOcrAdapter.inspect(
        imageFile(signatures.jpeg, "spoofed.png", "image/png"),
        "png",
      ),
    ).rejects.toThrow("signature");
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("closes the decoded bitmap even when reading dimensions succeeds", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 1, height: 1, close }),
    );

    await browserImageOcrAdapter.inspect(
      imageFile(signatures.png, "tiny.png", "image/png"),
      "png",
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("revokes its fallback object URL when browser image decoding fails", async () => {
    const NativeUrl = URL;
    const createObjectURL = vi.fn().mockReturnValue("blob:fictional-image");
    const revokeObjectURL = vi.fn();
    class TestUrl extends NativeUrl {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    }
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("createImageBitmap", undefined);
    vi.stubGlobal("URL", TestUrl);
    vi.stubGlobal("Image", FailingImage);

    await expect(
      browserImageOcrAdapter.inspect(
        imageFile(signatures.png, "fallback.png", "image/png"),
        "png",
      ),
    ).rejects.toThrow("decode");
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fictional-image");
  });
});
