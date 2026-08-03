import { ActionFunctionArgs, json } from "@remix-run/node";
import crypto from "crypto";

export async function action({ request }: ActionFunctionArgs) {
    try {
        const payload = await request.text();
        const headers = request.headers;

        console.log("Mock Webhook Handler received:", {
            signature: headers.get("X-Webhook-Signature"),
            payload: JSON.parse(payload)
        });

        return json({ success: true, message: "Refund processed" });
    } catch (err) {
        console.error("Refund processing error:", err);
        return json({ error: "Failed to parse webhook" }, { status: 500 });
    }
}
