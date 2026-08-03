import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
    AppProvider,
    Button,
    Card,
    FormLayout,
    Page,
    Text,
    TextField,
} from "@shopify/polaris";
import shopify from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");

    if (shop) {
        throw await shopify.login(request);
    }

    return json({ showForm: Boolean(shop) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const errors = await shopify.login(request);

    return json(errors);
};

export default function Login() {
    const loaderData = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const [shop, setShop] = useState("");

    return (
        <AppProvider isEmbedded={false} i18n={{}}>
            <Page>
                <Card>
                    <Form method="post">
                        <FormLayout>
                            <Text as="h2" variant="headingMd">
                                Log in
                            </Text>
                            <TextField
                                label="Shop domain"
                                name="shop"
                                value={shop}
                                onChange={setShop}
                                autoComplete="on"
                                error={actionData?.shop}
                            />
                            <Button submit variant="primary">
                                Log in
                            </Button>
                        </FormLayout>
                    </Form>
                </Card>
            </Page>
        </AppProvider>
    );
}
