import type {
  AssignmentImageKind,
  AssignmentImageOcrAdapter,
  AssignmentImageOcrSession,
} from "./parse-assignment-files";

const IMAGE_SIGNATURE_BYTES = 12;

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function matchesImageSignature(bytes: Uint8Array, kind: AssignmentImageKind): boolean {
  if (kind === "png") {
    return hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (kind === "jpeg") {
    return hasBytes(bytes, 0, [0xff, 0xd8, 0xff]);
  }
  return (
    hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
    hasBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  );
}

async function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    try {
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }

  if (
    typeof Image === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    throw new Error("This browser cannot decode images locally.");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The browser could not decode the image."));
    });
    image.src = objectUrl;
    await loaded;
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function ocrAssetBaseUrl(): URL {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Local image OCR is only available in a browser.");
  }

  const nextScript = [...document.scripts]
    .map((script) => script.src)
    .find((source) => {
      if (!source) return false;
      const url = new URL(source, window.location.href);
      return url.origin === window.location.origin && url.pathname.includes("/_next/");
    });
  const basePath = nextScript
    ? new URL(nextScript, window.location.href).pathname.split("/_next/")[0]
    : new URL(document.baseURI).pathname.replace(/\/$/u, "");
  const assetUrl = new URL(`${basePath}/ocr/`, window.location.origin);

  if (assetUrl.origin !== window.location.origin || !assetUrl.pathname.endsWith("/ocr/")) {
    throw new Error("The local OCR asset path is not same-origin.");
  }
  return assetUrl;
}

export const browserImageOcrAdapter: AssignmentImageOcrAdapter = {
  async inspect(file, expectedKind) {
    const signature = new Uint8Array(await file.slice(0, IMAGE_SIGNATURE_BYTES).arrayBuffer());
    if (!matchesImageSignature(signature, expectedKind)) {
      throw new Error("The file signature does not match its declared image type.");
    }
    return imageDimensions(file);
  },

  async createSession(): Promise<AssignmentImageOcrSession> {
    const tesseract = await import("tesseract.js");
    const assets = ocrAssetBaseUrl();
    let activeProgress: ((progress: number) => void) | null = null;
    const worker = await tesseract.createWorker(
      ["eng", "chi_sim"],
      tesseract.OEM.LSTM_ONLY,
      {
        workerPath: new URL("worker.min.js", assets).href,
        corePath: new URL("core/", assets).href.replace(/\/$/u, ""),
        langPath: new URL("lang/", assets).href.replace(/\/$/u, ""),
        workerBlobURL: false,
        cacheMethod: "none",
        gzip: true,
        logger(message) {
          if (message.status === "recognizing text" && Number.isFinite(message.progress)) {
            activeProgress?.(Math.max(0, Math.min(1, message.progress)));
          }
        },
      },
    );

    return {
      async recognize(file, onProgress) {
        activeProgress = onProgress;
        try {
          const result = await worker.recognize(file);
          return result.data.text;
        } finally {
          activeProgress = null;
        }
      },
      async terminate() {
        activeProgress = null;
        await worker.terminate();
      },
    };
  },
};
