import { ActionFunctionArgs, json } from "@remix-run/node";
import { PaymentsAppsClient } from "../payments-apps.graphql";
import shopify from "../shopify.server";

export async function action({ request }: ActionFunctionArgs) {
    try {
        const { topic, shop, session, admin, payload } = await shopify.authenticate.webhook(request);

        console.log(`Received Webhook: ${topic} for shop ${shop}`, payload);

        if (topic === "APP_UNINSTALLED") {
            if (session) {
                await shopify.sessionStorage.deleteSession(session.id);
            }
        }

        if (topic === "CUSTOM_PAYMENT_CALLBACK") { // Hypothetical callback from Polaris
            // Resolve session
            // This logic assumes we have a valid session to create the client
            // In reality, webhooks might not keys to session storage directly unless we lookup by shop.
        }

        return json({ received: true });
    } catch (error) {
        console.error("Webhook processing error:", error);
        return json({ error: "Webhook failed" }, { status: 500 });
    }
}
