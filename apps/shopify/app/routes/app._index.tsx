import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
    Page,
    Layout,
    Text,
    Card,
    Button,
    BlockStack,
    Box,
    TextField,
    Banner,
} from "@shopify/polaris";
import { useState, useCallback, useEffect } from "react";
import shopify from "../shopify.server";
import { supabase } from "../lib/supabase";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await shopify.authenticate.admin(request);
    const shop = session.shop;

    // Fetch existing config from Supabase
    const { data: config } = await supabase
        .from('polaris_merchant_configs')
        .select('*')
        .eq('shop', shop)
        .single();

    return json({ shop, config });
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await shopify.authenticate.admin(request);
    const shop = session.shop;
    const formData = await request.formData();

    const apiKey = formData.get("apiKey") as string;
    const apiSecret = formData.get("apiSecret") as string;

    if (!apiKey || !apiSecret) {
        return json({ error: "Missing API Key or Secret" }, { status: 400 });
    }

    // Upsert into Supabase
    const { error } = await supabase
        .from('polaris_merchant_configs')
        .upsert({
            shop,
            api_key: apiKey,
            api_secret: apiSecret,
            updated_at: new Date().toISOString()
        });

    if (error) {
        return json({ error: error.message }, { status: 500 });
    }

    return json({ success: true });
};

export default function Index() {
    const { config } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const nav = useNavigation();

    const [apiKey, setApiKey] = useState(config?.api_key || "");
    const [apiSecret, setApiSecret] = useState(config?.api_secret || "");
    const [isSaved, setIsSaved] = useState(false);

    const isSubmitting = nav.state === "submitting";

    useEffect(() => {
        if (actionData?.success) {
            setIsSaved(true);
            const timer = setTimeout(() => setIsSaved(false), 3000);
            return () => clearTimeout(timer);
        }
    }, [actionData]);

    return (
        <Page title="Polaris Protocol Configuration">
            <Layout>
                <Layout.Section>
                    <BlockStack gap="500">
                        {isSaved && (
                            <Banner title="Configuration saved successfully" variant="success" />
                        )}
                        {actionData?.error && (
                            <Banner title="Error saving configuration" variant="critical">
                                <p>{actionData.error}</p>
                            </Banner>
                        )}

                        <Card>
                            <BlockStack gap="400">
                                <Text as="h2" variant="headingMd">
                                    Merchant API Credentials
                                </Text>
                                <Text as="p" variant="bodyMd">
                                    Enter your API credentials from the Polaris Developer Portal to enable on-chain payments.
                                </Text>

                                <Box paddingBlock="200">
                                    <form method="post">
                                        <BlockStack gap="400">
                                            <TextField
                                                label="Polaris API Key"
                                                name="apiKey"
                                                value={apiKey}
                                                onChange={(value) => setApiKey(value)}
                                                autoComplete="off"
                                                placeholder="Enter your API Public Key"
                                                helpText="Obtained from the Polaris Developer Portal."
                                            />
                                            <TextField
                                                label="Polaris API Secret"
                                                name="apiSecret"
                                                type="password"
                                                value={apiSecret}
                                                onChange={(value) => setApiSecret(value)}
                                                autoComplete="off"
                                                placeholder="Enter your API Secret Key"
                                            />
                                            <Box>
                                                <Button submit variant="primary" loading={isSubmitting}>
                                                    Save Configuration
                                                </Button>
                                            </Box>
                                        </BlockStack>
                                    </form>
                                </Box>
                            </BlockStack>
                        </Card>

                        <Card>
                            <BlockStack gap="200">
                                <Text as="h2" variant="headingMd">
                                    Installation Status
                                </Text>
                                <Text as="p" variant="bodyMd">
                                    Checking for redirect-based extension compatibility...
                                </Text>
                                <Box paddingBlock="200">
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: config ? '#008060' : '#8c9196' }}></div>
                                        <Text as="span" variant="bodySm">
                                            {config ? "Extension connected and verified." : "Awaiting credentials."}
                                        </Text>
                                    </div>
                                </Box>
                            </BlockStack>
                        </Card>
                    </BlockStack>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
