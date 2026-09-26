// Security headers added to every response the server sends (see src/server.ts).
//
// Content-Security-Policy lists where the page may load things from:
//   * scripts: this site only. TanStack Start writes small inline scripts to hand the
//     page its data, so inline scripts are allowed, but no script can come from elsewhere.
//   * styles and fonts: this site and Google Fonts
//   * data: this site and our Supabase project (REST, auth, storage, realtime)
//   * no one may show FinSeka inside a frame (stops click-jacking)

export function securityHeaders(supabaseUrl: string | undefined): Record<string, string> {
  let supabase = "https://*.supabase.co";
  let supabaseWs = "wss://*.supabase.co";
  try {
    if (supabaseUrl) {
      const u = new URL(supabaseUrl);
      supabase = u.origin;
      supabaseWs = `wss://${u.host}`;
    }
  } catch {
    // keep the wildcard
  }

  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    `img-src 'self' data: blob: ${supabase}`,
    `connect-src 'self' ${supabase} ${supabaseWs}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  return {
    "Content-Security-Policy": csp,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  };
}

/** Returns the response with the security headers set (headers already present win). */
export function withSecurityHeaders(response: Response, supabaseUrl: string | undefined) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders(supabaseUrl))) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
