import { ActionFunctionArgs, json } from "@remix-run/node";
import { supabase } from "../lib/supabase";


interface PolarisPaymentResponse {
    payment_session_id?: string;
    redirect_url?: string;
    tokens?: string[];
    status?: string;
    error?: string;
    amount?: number;
    currency?: string;
    customer?: { id: string; email: string };
}

// Ensure you set your API keys as env vars in Shopify or `.env`

// Ensure you set your API keys as env vars in Shopify or `.env`
// Pointing to PayEase (Main App) local URL by default
const POLARIS_API_URL = process.env.POLARIS_CHECKOUT_APP_URL || "https://polaris-pay.vercel.app/api/bills/create";


export async function action({ request }: ActionFunctionArgs) {
    try {
        const payload = await request.json();
        const {
            amount,
            currency,
            payment_method, // Has data like card token if tokenized
            customer,
            id: order_id,
            gid: order_gid,
        } = payload;


        // Identify the merchant by their shop domain
        const shopDomain = request.headers.get("shopify-shop-domain") || "unknown";

        // Fetch credentials from Supabase
        const { data: config, error: configError } = await supabase
            .from('polaris_merchant_configs')
            .select('api_key, api_secret')
            .eq('shop', shopDomain)
            .single();

        if (configError || !config) {
            console.error("Merchant config not found for shop:", shopDomain);
            return json(
                {
                    error: {
                        reason: "processing_error",
                        message: "Merchant has not configured Polaris API keys.",
                    },
                },
                { status: 400 }
            );
        }

        const response = await fetch(POLARIS_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-client-id": config.api_key,
                "x-client-secret": config.api_secret,
            },
            body: JSON.stringify({
                amount: amount,
                description: `Shopify Order #${order_id}`,
                currency: currency,
                metadata: {
                    shopify_order_id: String(order_id),
                    shopify_order_gid: order_gid,
                    customer_email: customer?.email,
                    shop_domain: shopDomain,
                },
            }),
        });


        if (!response.ok) {
            const errorData = await response.json();
            console.error("Polaris Payment Error:", errorData);
            return json(
                {
                    error: {
                        reason: "processing_error",
                        message: errorData.error || "Payment creation failed at Polaris.",
                    },
                },
                { status: 422 }
            );
        }

        const data = await response.json();

        // If Polaris returns a checkout URL, we tell Shopify to redirect
        if (data.checkoutUrl) {
            return json({
                redirect_url: data.checkoutUrl,
            });
        }

        // If direct processing (e.g. tokenized), handle success
        return json({
            redirect_url: `https://your-shop.myshopify.com/checkouts/${order_id}/thank_you`, // Fallback for direct success
        });

    } catch (error) {
        console.error("Internal Payment Error:", error);
        return json(
            {
                error: {
                    reason: "processing_error",
                    message: "Unable to reach Polaris Payment Gateway.",
                },
            },
            { status: 500 }
        );
    }
}
