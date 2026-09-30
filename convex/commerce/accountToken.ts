// Sombrey commerce — Phase 6C: the App Store appAccountToken, derived on the server.
//
// The SAME algorithm as the iOS app (Phase 6B, MembershipAccountToken in
// apps/ios/Sombrey/Commerce/MembershipModels.swift): an RFC 4122 version-5
// (SHA-1, name-based) UUID of "sombrey:clerk:" + the Clerk user id, in the
// fixed Sombrey namespace below. The Clerk user id is the Convex identity's
// `subject`, so the server recomputes the token from the AUTHENTICATED user —
// never from anything the client says — and compares it with the token Apple
// signed into the transaction. Same account → same token on every device;
// different accounts → different tokens.
//
// NEVER change the namespace, the prefix or the algorithm: every existing
// subscription is bound to tokens made this way. Reference vector (also in
// the Swift tests): "user_test" → 96d212a9-d972-503e-8c18-87d719330709.
//
// Web Crypto only — runs in the Convex V8 and Node runtimes and in tests.

export const ACCOUNT_TOKEN_NAMESPACE = "155ea3db-9de4-4877-a417-fc8cda0354af";
export const ACCOUNT_TOKEN_PREFIX = "sombrey:clerk:";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

function formatUuid(b: Uint8Array): string {
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** The token for a Clerk user id (lower-case UUID), or null for an empty/oversized id. */
export async function appAccountTokenFor(clerkUserId: string): Promise<string | null> {
  const id = clerkUserId.trim();
  if (!id || id.length > 200) return null;
  const name = new TextEncoder().encode(ACCOUNT_TOKEN_PREFIX + id);
  const data = new Uint8Array(16 + name.length);
  data.set(uuidBytes(ACCOUNT_TOKEN_NAMESPACE), 0);
  data.set(name, 16);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-1", data)).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  return formatUuid(bytes);
}

/** Apple returns the token as a UUID string; case is not significant. */
export function normalizeAccountToken(token: unknown): string | null {
  if (typeof token !== "string") return null;
  const t = token.trim().toLowerCase();
  return UUID.test(t) ? t : null;
}
