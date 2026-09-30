"use node";
// Sombrey commerce — Phase 6C: Apple's signatures, verified with Apple's
// official App Store Server Library (@apple/app-store-server-library).
//
//   createAppleVerifier  SignedDataVerifier per allowed environment: the JWS's
//                        x5c chain must lead to Apple Root CA - G3 (pinned in
//                        appStoreConfig.ts) with Apple's leaf/intermediate
//                        marker OIDs, the ES256 signature must verify, and the
//                        bundle id / environment (and, in Production, the app's
//                        Apple ID) must match. With online checks the chain's
//                        revocation status is checked with Apple (OCSP).
//   createStatusSource   App Store Server API "Get All Subscription Statuses"
//                        (authenticated with Sombrey's API key) — the CURRENT
//                        status, as signed transaction + renewal info that are
//                        verified again by the verifier above.
//
// Nothing here decides membership: appStoreFlow.ts applies the rules.

import {
  APIException, AppStoreServerAPIClient, Environment, SignedDataVerifier, VerificationException, VerificationStatus,
} from "@apple/app-store-server-library";
import type { AppleEnvironment } from "./appStoreConfig.ts";
import type { AppleVerifier, AppleStatusSource, AppleNotification, VerifyFailure } from "./appStoreFlow.ts";
import { AppleVerificationError } from "./appStoreFlow.ts";
import type { AppleRenewalInfo, AppleTransaction } from "./appStoreRules.ts";

const LIBRARY_ENV: Record<AppleEnvironment, Environment> = { Production: Environment.PRODUCTION, Sandbox: Environment.SANDBOX };

/** The environment a JWS CLAIMS — used only to pick which verifier checks it
 * (that verifier then rejects any mismatch after the signature is verified). */
function claimedEnvironment(jws: string, kind: "transaction" | "notification"): string | null {
  try {
    const payload = JSON.parse(Buffer.from(jws.split(".")[1] ?? "", "base64url").toString("utf8"));
    const env = kind === "notification" ? (payload?.data?.environment ?? payload?.summary?.environment) : payload?.environment;
    return typeof env === "string" ? env : null;
  } catch {
    return null;
  }
}

function failure(e: unknown): AppleVerificationError {
  if (e instanceof AppleVerificationError) return e;
  if (e instanceof VerificationException) {
    const reason: VerifyFailure =
      e.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE ? "retryable"
        : e.status === VerificationStatus.INVALID_APP_IDENTIFIER ? "wrong_bundle"
          : e.status === VerificationStatus.INVALID_ENVIRONMENT ? "wrong_environment"
            : "invalid_signature";
    return new AppleVerificationError(reason);
  }
  return new AppleVerificationError("invalid_signature");
}

export function createAppleVerifier(opts: {
  roots: Buffer[];
  bundleId: string;
  environments: AppleEnvironment[];
  appAppleId: number | null;
  onlineChecks: boolean;
}): AppleVerifier {
  const verifiers = new Map<string, SignedDataVerifier>();
  for (const env of opts.environments) {
    verifiers.set(env, new SignedDataVerifier(opts.roots, opts.onlineChecks, LIBRARY_ENV[env], opts.bundleId, env === "Production" ? opts.appAppleId ?? undefined : undefined));
  }
  const pick = (jws: string, kind: "transaction" | "notification") => {
    if (typeof jws !== "string" || jws.split(".").length !== 3) throw new AppleVerificationError("malformed");
    const v = verifiers.get(claimedEnvironment(jws, kind) ?? "");
    if (!v) throw new AppleVerificationError("wrong_environment");
    return v;
  };
  return {
    async transaction(jws) {
      try { return (await pick(jws, "transaction").verifyAndDecodeTransaction(jws)) as AppleTransaction; } catch (e) { throw failure(e); }
    },
    async renewalInfo(jws) {
      try { return (await pick(jws, "transaction").verifyAndDecodeRenewalInfo(jws)) as AppleRenewalInfo; } catch (e) { throw failure(e); }
    },
    async notification(jws) {
      try { return (await pick(jws, "notification").verifyAndDecodeNotification(jws)) as AppleNotification; } catch (e) { throw failure(e); }
    },
  };
}

export function createStatusSource(api: { keyId: string; issuerId: string; privateKey: string }, bundleId: string): AppleStatusSource {
  const clients = new Map<AppleEnvironment, AppStoreServerAPIClient>();
  const client = (env: AppleEnvironment) => {
    let c = clients.get(env);
    if (!c) {
      c = new AppStoreServerAPIClient(api.privateKey, api.keyId, api.issuerId, bundleId, LIBRARY_ENV[env]);
      clients.set(env, c);
    }
    return c;
  };
  return async (env, transactionId) => {
    try {
      const res = await client(env).getAllSubscriptionStatuses(transactionId);
      return (res.data ?? []).flatMap((g) => (g.lastTransactions ?? []).map((t) => ({
        status: typeof t.status === "number" ? t.status : -1,
        originalTransactionId: t.originalTransactionId ?? "",
        signedTransactionInfo: t.signedTransactionInfo ?? "",
        signedRenewalInfo: t.signedRenewalInfo ?? "",
      })));
    } catch (e) {
      if (e instanceof APIException && (e.httpStatusCode === 404 || e.httpStatusCode === 400)) return "not_found";
      if (e instanceof APIException && e.httpStatusCode === 401) throw new AppleVerificationError("api_unauthorized");
      throw new AppleVerificationError("retryable");
    }
  };
}
