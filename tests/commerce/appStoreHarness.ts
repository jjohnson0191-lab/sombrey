// Sombrey commerce, Phase 6C — test harness (not a test file).
//
// SYNTHETIC data only. A throwaway certificate chain is generated at runtime
// with openssl (root → intermediate → leaf, P-256, carrying Apple's marker
// OIDs so Apple's own SignedDataVerifier accepts it when — and only when — the
// test root is trusted). No private key is committed; nothing here is Apple's.
// Production trusts only Apple Root CA - G3 (convex/commerce/appStoreConfig.ts).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrivateKey, sign, X509Certificate, type KeyObject } from "node:crypto";
import { createAppleVerifier } from "../../convex/commerce/appStoreVerifier.ts";
import type { AppleStatusItem, AppleStatusSource } from "../../convex/commerce/appStoreFlow.ts";
import type { AppleEnvironment } from "../../convex/commerce/appStoreConfig.ts";

export type Chain = { root: Buffer; intermediate: Buffer; leaf: Buffer; leafKey: KeyObject };

const CNF = `
[req]
distinguished_name = dn
[dn]
[v3_root]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
[v3_int]
basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical,keyCertSign,cRLSign
1.2.840.113635.100.6.2.1 = ASN1:NULL
[v3_leaf]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
1.2.840.113635.100.6.11.1 = ASN1:NULL
[v3_leaf_plain]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
`;

/** A fresh chain. `leafExtension: false` omits Apple's leaf marker OID. */
export function makeChain(name: string, opts: { leafExtension?: boolean } = {}): Chain {
  const dir = mkdtempSync(join(tmpdir(), "sombrey-6c-"));
  const f = (n: string) => join(dir, n);
  const run = (...args: string[]) => execFileSync("openssl", args, { stdio: "pipe" });
  writeFileSync(f("cnf"), CNF);
  for (const k of ["root", "int", "leaf"]) run("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", f(`${k}.key`));
  run("req", "-x509", "-new", "-key", f("root.key"), "-subj", `/CN=${name} TEST Root`, "-days", "3650", "-config", f("cnf"), "-extensions", "v3_root", "-out", f("root.pem"));
  run("req", "-new", "-key", f("int.key"), "-subj", `/CN=${name} TEST Intermediate`, "-config", f("cnf"), "-out", f("int.csr"));
  run("x509", "-req", "-in", f("int.csr"), "-CA", f("root.pem"), "-CAkey", f("root.key"), "-set_serial", "2", "-days", "3650", "-extfile", f("cnf"), "-extensions", "v3_int", "-out", f("int.pem"));
  run("req", "-new", "-key", f("leaf.key"), "-subj", `/CN=${name} TEST Leaf`, "-config", f("cnf"), "-out", f("leaf.csr"));
  run("x509", "-req", "-in", f("leaf.csr"), "-CA", f("int.pem"), "-CAkey", f("int.key"), "-set_serial", "3", "-days", "3650", "-extfile", f("cnf"),
    "-extensions", opts.leafExtension === false ? "v3_leaf_plain" : "v3_leaf", "-out", f("leaf.pem"));
  const der = (p: string) => Buffer.from(new X509Certificate(readFileSync(f(p))).raw);
  return { root: der("root.pem"), intermediate: der("int.pem"), leaf: der("leaf.pem"), leafKey: createPrivateKey(readFileSync(f("leaf.key"))) };
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** An ES256 JWS with an x5c header, as Apple signs StoreKit / server data. */
export function signJws(payload: unknown, chain: Chain, opts: { alg?: string; x5c?: Buffer[] } = {}): string {
  const header = { alg: opts.alg ?? "ES256", x5c: (opts.x5c ?? [chain.leaf, chain.intermediate, chain.root]).map((c) => c.toString("base64")) };
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const sig = sign("sha256", Buffer.from(input), { key: chain.leafKey, dsaEncoding: "ieee-p1363" });
  return `${input}.${b64u(sig)}`;
}

/** Replace a JWS's payload while keeping its (now invalid) signature. */
export function tamper(jws: string, payload: unknown): string {
  const [h, , s] = jws.split(".");
  return `${h}.${b64u(JSON.stringify(payload))}.${s}`;
}

// ─── Synthetic Apple payloads ────────────────────────────────────────────────

export const BUNDLE = "com.sombrey.app";
export const PRODUCT = "test.sombrey.membership.monthly"; // synthetic — not an App Store product id
export const APP_APPLE_ID = 1234567890;                    // synthetic
export const T0 = Date.now();                              // certificates are valid from about now
export const DAY = 86_400_000;

export function transaction(over: Record<string, unknown> = {}) {
  return {
    transactionId: "2000000000000001", originalTransactionId: "2000000000000001", webOrderLineItemId: "2000000000000100",
    bundleId: BUNDLE, productId: PRODUCT, subscriptionGroupIdentifier: "21000000", purchaseDate: T0, originalPurchaseDate: T0,
    expiresDate: T0 + 30 * DAY, quantity: 1, type: "Auto-Renewable Subscription", inAppOwnershipType: "PURCHASED",
    signedDate: T0 + 1000, environment: "Sandbox", transactionReason: "PURCHASE", storefront: "USA", storefrontId: "143441",
    price: 30000, currency: "USD", ...over,
  };
}

export function renewal(over: Record<string, unknown> = {}) {
  return {
    originalTransactionId: "2000000000000001", autoRenewProductId: PRODUCT, productId: PRODUCT, autoRenewStatus: 1,
    signedDate: T0 + 1000, environment: "Sandbox", recentSubscriptionStartDate: T0, renewalDate: T0 + 30 * DAY, ...over,
  };
}

let uuidCounter = 0;
export function nextUuid(): string {
  uuidCounter++;
  return `00000000-0000-4000-8000-${uuidCounter.toString(16).padStart(12, "0")}`;
}

export function notification(chain: Chain, type: string, subtype: string | undefined, tx: object, ren: object, over: Record<string, unknown> = {}) {
  return signJws({
    notificationType: type, ...(subtype ? { subtype } : {}), notificationUUID: nextUuid(), version: "2.0", signedDate: T0 + 5000,
    data: { appAppleId: APP_APPLE_ID, bundleId: BUNDLE, bundleVersion: "1", environment: "Sandbox", status: 1,
      signedTransactionInfo: signJws(tx, chain), signedRenewalInfo: signJws(ren, chain) },
    ...over,
  }, chain);
}

export function verifierFor(chain: Chain, environments: AppleEnvironment[] = ["Sandbox"]) {
  return createAppleVerifier({ roots: [chain.root], bundleId: BUNDLE, environments, appAppleId: APP_APPLE_ID, onlineChecks: false });
}

/** A stand-in for the App Store Server API: returns what "Apple" currently says. */
export function statusSource(items: () => AppleStatusItem[] | "not_found"): AppleStatusSource & { calls: number } {
  const f = (async () => { f.calls++; return items(); }) as AppleStatusSource & { calls: number };
  f.calls = 0;
  return f;
}

// ─── An in-memory Convex database (enough of ctx.db for the commerce store) ──

type Row = Record<string, unknown> & { _id: string; _creationTime: number };

export class MemoryDb {
  tables = new Map<string, Row[]>();
  private n = 0;
  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }
  query(table: string) {
    const all = () => this.rows(table);
    return {
      withIndex: (_name: string, f: (q: unknown) => unknown) => {
        const eqs: Array<[string, unknown]> = [];
        const q = { eq: (field: string, value: unknown) => { eqs.push([field, value]); return q; } };
        f(q);
        const match = () => all().filter((r) => eqs.every(([k, v]) => r[k] === v));
        return {
          unique: async () => {
            const m = match();
            if (m.length > 1) throw new Error(`unique() matched ${m.length} rows in ${table}`);
            return m[0] ?? null;
          },
          first: async () => match()[0] ?? null,
          collect: async () => match(),
          take: async (k: number) => match().slice(0, k),
        };
      },
    };
  }
  async insert(table: string, doc: Record<string, unknown>) {
    const id = `${table}:${++this.n}`;
    this.rows(table).push({ ...structuredClone(doc), _id: id, _creationTime: Date.now() });
    return id;
  }
  async patch(id: string, fields: Record<string, unknown>) {
    const row = this.get(id);
    if (!row) throw new Error(`no row ${id}`);
    for (const [k, v] of Object.entries(fields)) if (v === undefined) delete row[k]; else row[k] = structuredClone(v);
  }
  get(id: string): Row | null {
    const table = id.split(":")[0];
    return this.rows(table).find((r) => r._id === id) ?? null;
  }
  /** Runs mutations one at a time, as Convex's serializable transactions do. */
  private chain: Promise<unknown> = Promise.resolve();
  serial<T>(f: () => Promise<T>): Promise<T> {
    const next = this.chain.then(f, f);
    this.chain = next.catch(() => undefined);
    return next;
  }
}
