// Error monitoring with Sentry, switched on only when VITE_SENTRY_DSN is set (in .env
// locally, or in Vercel's environment settings). Without it this does nothing and the
// Sentry library is never downloaded.
//
// Privacy: no personal data is sent (no IP addresses, cookies or request bodies), and
// only the page path is kept from URLs.

type SentryModule = typeof import("@sentry/react");

let sentry: Promise<SentryModule | null> | null = null;

export function sentryDsn(): string | undefined {
  const dsn = import.meta.env["VITE_SENTRY_DSN"];
  return typeof dsn === "string" && dsn.startsWith("https://") ? dsn : undefined;
}

/** Starts Sentry in the browser. Safe to call more than once. */
export function initMonitoring() {
  if (typeof window === "undefined" || sentry) return;
  const dsn = sentryDsn();
  if (!dsn) {
    sentry = Promise.resolve(null);
    return;
  }
  sentry = import("@sentry/react").then((S) => {
    S.init({
      dsn,
      environment: import.meta.env.MODE,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend(event) {
        // Keep only the path: query strings can carry tokens after sign-in.
        if (event.request?.url) event.request.url = event.request.url.split(/[?#]/)[0] ?? "";
        delete event.request?.cookies;
        delete event.request?.data;
        return event;
      },
    });
    return S;
  });
}

/** Reports an error caught by the app's error screen. */
export function reportError(error: unknown) {
  void sentry?.then((S) => S?.captureException(error));
}
