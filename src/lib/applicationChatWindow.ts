import type { ApplicationChatTarget } from "../components/ApplicationChat";

/**
 * Out-of-band registry for sandboxed application iframe windows.
 *
 * Window objects from `sandbox="allow-scripts"` iframes are opaque
 * cross-origin proxies. Holding one inside React props or state breaks any
 * deep diff/clone over it (React DevTools' component logging throws
 * "Sandbox access violation"), so hosts register the live window here keyed
 * by a serializable target key, and consumers look it up at send time only.
 */

const registeredAppWindows = new Map<string, WeakRef<Window>>();

/** Stable per-target key under which the iframe window is registered. */
function windowKey(target: ApplicationChatTarget): string {
  return target.kind === "marketplace"
    ? `marketplace:${target.appId}`
    : `studio:${target.appPath}`;
}

export function registerApplicationChatWindow(
  target: ApplicationChatTarget,
  frameWindow: Window | null,
): void {
  if (frameWindow) {
    registeredAppWindows.set(windowKey(target), new WeakRef(frameWindow));
  } else {
    registeredAppWindows.delete(windowKey(target));
  }
}

export function lookupApplicationChatWindow(target: ApplicationChatTarget): Window | null {
  return registeredAppWindows.get(windowKey(target))?.deref() ?? null;
}
