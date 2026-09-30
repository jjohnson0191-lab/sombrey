// Sombrey commerce — Phase 6C: App Store server configuration.
//
// Nothing here is a secret and nothing is invented:
//   • the bundle id is the existing app's (com.sombrey.app);
//   • the App Store product id is convex/commerce/config.ts
//     products.membership.appStoreProductId — null until the real product
//     exists, and while it is null NOTHING is verified or recorded;
//   • Apple Root CA - G3 is Apple's PUBLIC root certificate
//     (https://www.apple.com/certificateauthority/AppleRootCA-G3.cer), the
//     anchor for every StoreKit 2 / App Store Server signature. Its SHA-256
//     fingerprint is pinned below and checked by tests/commerce.
//
// Everything deployment-specific comes from Convex environment variables
// (`npx convex env set …` — never committed):
//   APPLE_ALLOWED_ENVIRONMENTS   "Production", "Sandbox" or "Production,Sandbox"
//   APPLE_APP_APPLE_ID           the app's numeric Apple ID (required for Production)
//   APPLE_API_KEY_ID             App Store Server API key id        ┐ required to verify
//   APPLE_API_ISSUER_ID          App Store Server API issuer id     │ app submissions
//   APPLE_API_PRIVATE_KEY        the .p8 private key (PEM) — SECRET ┘
//   COMMERCE_SANDBOX_GRANTS_ACCESS "true" lets sandbox subscriptions grant
//                                access on this deployment (default: never)
// Missing configuration = "not configured": nothing is accepted, nothing breaks.
//
// Pure — no Convex imports — tested in tests/commerce/appStore*.test.ts.

export const APPLE_BUNDLE_ID = "com.sombrey.app";

/** Apple Root CA - G3, DER, base64 (public). */
export const APPLE_ROOT_CA_G3_BASE64 = "MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA==";
export const APPLE_ROOT_CA_G3_SHA256 = "63343ABFB89A6A03EBB57E9B3F5FA7BE7C4F5C756F3017B3A8C488C3653E9179";

export type AppleEnvironment = "Production" | "Sandbox";

export type AppStoreServerConfig = {
  bundleId: string;
  productIds: string[];
  environments: AppleEnvironment[];
  appAppleId: number | null;
  /** App Store Server API credentials, or null (app submissions can't be verified without them). */
  api: { keyId: string; issuerId: string; privateKey: string } | null;
};

export type ConfigResult = { ok: true; config: AppStoreServerConfig } | { ok: false; missing: string[] };

type Env = Record<string, string | undefined>;

/** Reads and validates the deployment's App Store configuration. */
export function readAppStoreServerConfig(env: Env, appStoreProductId: string | null): ConfigResult {
  const missing: string[] = [];
  if (!appStoreProductId) missing.push("products.membership.appStoreProductId (convex/commerce/config.ts)");
  const envs = (env.APPLE_ALLOWED_ENVIRONMENTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const environments = [...new Set(envs)].filter((e): e is AppleEnvironment => e === "Production" || e === "Sandbox");
  if (!environments.length || environments.length !== new Set(envs).size) missing.push("APPLE_ALLOWED_ENVIRONMENTS");
  const rawId = env.APPLE_APP_APPLE_ID?.trim();
  const appAppleId = rawId && /^[0-9]{1,15}$/.test(rawId) ? Number(rawId) : null;
  if (environments.includes("Production") && appAppleId === null) missing.push("APPLE_APP_APPLE_ID");
  const keyId = env.APPLE_API_KEY_ID?.trim(), issuerId = env.APPLE_API_ISSUER_ID?.trim(), privateKey = env.APPLE_API_PRIVATE_KEY?.trim();
  const api = keyId && issuerId && privateKey && privateKey.includes("PRIVATE KEY") ? { keyId, issuerId, privateKey } : null;
  if (missing.length) return { ok: false, missing };
  return { ok: true, config: { bundleId: APPLE_BUNDLE_ID, productIds: [appStoreProductId!], environments, appAppleId, api } };
}

/** Whether sandbox subscriptions grant access on this deployment (default: no). */
export function sandboxGrantsAccess(env: Env): boolean {
  return env.COMMERCE_SANDBOX_GRANTS_ACCESS === "true";
}
