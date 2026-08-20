import { describe, expect, it } from "vitest";
import {
  digestOptionalStoredString,
  sha256StoredString,
} from "@/lib/workspace-storage/digest";

describe("workspace stored-string SHA-256", () => {
  it("distinguishes an absent key from a present empty string", async () => {
    await expect(digestOptionalStoredString(null)).resolves.toEqual({
      ok: true,
      digest: null,
    });
    await expect(digestOptionalStoredString("")).resolves.toEqual({
      ok: true,
      digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
  });

  it("fails closed when Web Crypto returns a non-SHA-256-sized buffer", async () => {
    for (const byteLength of [0, 31, 33]) {
      await expect(
        sha256StoredString("fictional-value", {
          subtle: {
            digest: async () => new Uint8Array(byteLength).buffer,
          },
        }),
      ).resolves.toEqual({ ok: false, reason: "failed" });
    }
  });

  it("fails closed when the digest primitive is unavailable or rejects", async () => {
    await expect(sha256StoredString("fictional-value", {})).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    await expect(
      sha256StoredString("fictional-value", {
        subtle: {
          digest: async () => {
            throw new DOMException("Injected digest failure", "OperationError");
          },
        },
      }),
    ).resolves.toEqual({ ok: false, reason: "failed" });
  });

  it("encodes the exact stored string as UTF-8 and requests SHA-256", async () => {
    let observedAlgorithm: string | null = null;
    let observedBytes: number[] = [];
    const result = await sha256StoredString("你好", {
      subtle: {
        digest: async (algorithm, data) => {
          observedAlgorithm = algorithm;
          observedBytes = Array.from(
            ArrayBuffer.isView(data)
              ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
              : new Uint8Array(data),
          );
          return new Uint8Array(32).buffer;
        },
      },
    });

    expect(result).toEqual({ ok: true, digest: "0".repeat(64) });
    expect(observedAlgorithm).toBe("SHA-256");
    expect(observedBytes).toEqual([228, 189, 160, 229, 165, 189]);
  });
});
