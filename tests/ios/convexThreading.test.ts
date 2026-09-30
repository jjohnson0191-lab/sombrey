// Launch-crash regression (hotfix/launch-crash): ConvexMobile delivers query
// results and errors on its own background thread. The app is compiled in
// Swift 6 mode, where a main-actor-isolated closure running off the main
// thread traps — so every Convex subscription consumed with Combine's `sink`
// must hop to the main queue first. NotificationManager.fetchOnce didn't, and
// crashed the app on every launch once notifications were allowed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const APP = join(import.meta.dirname, "../../apps/ios/Sombrey");
const swiftFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? swiftFiles(join(dir, d.name)) : d.name.endsWith(".swift") ? [join(dir, d.name)] : []);

test("every Convex subscription consumed with sink hops to the main queue first", () => {
  let checked = 0;
  for (const file of swiftFiles(APP)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/\.subscribe\(to:[\s\S]*?\.sink\(/g)) {
      // Only chains that start from the Convex client (not other publishers).
      if (!/ConvexClientProvider\.client\s*$/.test(src.slice(Math.max(0, m.index! - 200), m.index!).trimEnd())) continue;
      checked++;
      assert.match(m[0], /\.receive\(on: DispatchQueue\.main\)/, `${file.replace(APP, "Sombrey")}: Convex results arrive on a background thread — add .receive(on: DispatchQueue.main) before .sink`);
    }
  }
  assert.ok(checked >= 3, `expected the known Convex sinks (AppState, ConvexQuery, NotificationManager), found ${checked}`);
});

test("fetchOnce (notification reconciliation) receives on the main queue", () => {
  const src = readFileSync(join(APP, "Notifications/NotificationManager.swift"), "utf8");
  const fetchOnce = src.slice(src.indexOf("private func fetchOnce"));
  assert.match(fetchOnce, /\.first\(\)\s*\.receive\(on: DispatchQueue\.main\)\s*\.sink\(/);
});
