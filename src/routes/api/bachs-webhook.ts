import { createFileRoute } from "@tanstack/react-router";

// Bachs calls this after payments. Set it in Bachs → Developer Portal → Webhooks as
// https://<your site>/api/bachs-webhook (events checkout.completed and collection.succeeded),
// and put that endpoint's signing secret in BACHS_WEBHOOK_SECRET.
export const Route = createFileRoute("/api/bachs-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleBachsWebhook } = await import("@/lib/bachs");
        const { bachsDeps } = await import("@/lib/billing.server");
        const reply = await handleBachsWebhook(
          request.headers,
          await request.text(),
          await bachsDeps(),
        );
        if (reply.status >= 400) console.warn(`[bachs webhook] ${reply.status} ${reply.body}`);
        return new Response(reply.body, {
          status: reply.status,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      },
    },
  },
});
