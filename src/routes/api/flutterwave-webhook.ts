import { createFileRoute } from "@tanstack/react-router";

// Flutterwave calls this after every payment and subscription change.
// Set it in Flutterwave → Settings → Webhooks as https://<your site>/api/flutterwave-webhook,
// with the same Secret hash as FLUTTERWAVE_WEBHOOK_HASH.
export const Route = createFileRoute("/api/flutterwave-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleFlutterwaveWebhook } = await import("@/lib/flutterwave");
        const { flutterwaveDeps } = await import("@/lib/billing.server");
        const reply = await handleFlutterwaveWebhook(
          request.headers,
          await request.text(),
          await flutterwaveDeps(),
        );
        if (reply.status >= 400)
          console.warn(`[flutterwave webhook] ${reply.status} ${reply.body}`);
        return new Response(reply.body, {
          status: reply.status,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      },
    },
  },
});
