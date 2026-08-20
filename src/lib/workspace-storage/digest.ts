export const WORKSPACE_DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export type WorkspaceDigestResult =
  | { ok: true; digest: string }
  | { ok: false; reason: "unavailable" | "failed" };

interface DigestCrypto {
  subtle?: {
    digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer>;
  };
}

export async function sha256StoredString(
  value: string,
  cryptoProvider: DigestCrypto | undefined = globalThis.crypto,
): Promise<WorkspaceDigestResult> {
  if (!cryptoProvider?.subtle?.digest) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const bytes = new TextEncoder().encode(value);
    const digest = await cryptoProvider.subtle.digest("SHA-256", bytes);
    if (digest.byteLength !== 32) {
      return { ok: false, reason: "failed" };
    }
    return {
      ok: true,
      digest: Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function digestOptionalStoredString(
  value: string | null,
  cryptoProvider?: DigestCrypto,
): Promise<WorkspaceDigestResult | { ok: true; digest: null }> {
  return value === null
    ? { ok: true, digest: null }
    : sha256StoredString(value, cryptoProvider);
}
