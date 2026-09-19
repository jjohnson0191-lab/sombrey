import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

/**
 * Must match capacitor.config.ts's `server.iosScheme` and the
 * CFBundleURLSchemes entry in ios/App/App/Info.plist.
 */
const NATIVE_ORIGIN_PREFIX = "com.sombrey.app://localhost";

/**
 * Clerk's OAuth (Google/Apple) sign-in redirects the WebView to the
 * provider, then back to `{origin}{path}#/sso-callback?...` for its
 * virtual-routing SignIn/SignUp components to pick up and complete the
 * session. On iOS that outbound redirect gets handed to the system
 * browser (Capacitor won't navigate the app's WebView off-origin), so the
 * return trip only reaches the app if that origin is a URL scheme iOS
 * knows to route back to us — which is what `NATIVE_ORIGIN_PREFIX` is for.
 *
 * `location.replace` (not a router push) is deliberate: it reloads the app
 * at the callback URL, the same code path Clerk already relies on for a
 * plain browser redirect, rather than assuming its virtual router reacts
 * to a live, script-driven hash change on an already-mounted instance.
 */
function restoreFromNativeCallback(rawUrl: string) {
  if (!rawUrl.startsWith(NATIVE_ORIGIN_PREFIX)) {
    return;
  }

  const target = rawUrl.slice(NATIVE_ORIGIN_PREFIX.length) || "/";
  window.location.replace(target);
}

let initialized = false;

/**
 * Wires up the two ways a native OAuth return can reach the app: while
 * it's suspended in the background (`appUrlOpen`) or after iOS has fully
 * terminated it and relaunches cold via the callback URL (`getLaunchUrl`).
 * Call once at startup, before rendering.
 *
 * Guarded against re-entry so a dev-mode HMR re-run of this module can't
 * stack a second `appUrlOpen` listener onto the same native bridge; a real
 * app launch only ever calls this once regardless.
 */
export function initNativeOAuthReturnBridge(): void {
  if (!Capacitor.isNativePlatform() || initialized) {
    return;
  }
  initialized = true;

  App.addListener("appUrlOpen", ({ url }) => {
    restoreFromNativeCallback(url);
  });

  void App.getLaunchUrl().then((result) => {
    if (result?.url) {
      restoreFromNativeCallback(result.url);
    }
  });
}
