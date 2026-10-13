import { useSyncExternalStore } from "react";

// "Install the app": FinSeka is a web app, so installing it means adding it to the home screen.
// Android and desktop Chrome/Edge offer an install prompt (the beforeinstallprompt event) once
// the page qualifies; it fires early, so it is caught as soon as this module loads and kept until
// the button asks for it. iPhones and iPads have no prompt: the person taps Share, then
// "Add to Home Screen", so the button shows those steps instead.

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallState = {
  /** Already running as an installed app (or just installed): nothing to offer. */
  installed: boolean;
  /** The browser can show its own install prompt. */
  canPrompt: boolean;
  /** iPhone or iPad: installing is done by hand from Safari's Share menu. */
  ios: boolean;
};

let deferred: InstallPromptEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** iPhone, iPod or iPad (iPadOS reports itself as a Mac, but has a touch screen). */
export function isIos(userAgent: string, maxTouchPoints = 0) {
  return (
    /iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && maxTouchPoints > 1)
  );
}

function runningInstalled() {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    installedNow ||
    nav.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true
  );
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // shown from our button instead of the browser's own mini-bar
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installedNow = true;
    notify();
  });
}

let snapshot: InstallState = { installed: false, canPrompt: false, ios: false };
function read(): InstallState {
  const next: InstallState = {
    installed: runningInstalled(),
    canPrompt: deferred !== null,
    ios: isIos(navigator.userAgent, navigator.maxTouchPoints),
  };
  if (
    next.installed !== snapshot.installed ||
    next.canPrompt !== snapshot.canPrompt ||
    next.ios !== snapshot.ios
  ) {
    snapshot = next;
  }
  return snapshot;
}
const serverSnapshot: InstallState = { installed: false, canPrompt: false, ios: false };

export function useInstallState() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => serverSnapshot,
  );
}

/** Shows the browser's install prompt. Returns whether the person accepted. */
export async function promptInstall() {
  const e = deferred;
  if (!e) return false;
  deferred = null; // a prompt can only be shown once
  notify();
  await e.prompt();
  const { outcome } = await e.userChoice;
  return outcome === "accepted";
}
