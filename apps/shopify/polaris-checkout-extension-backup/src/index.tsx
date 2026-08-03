import {
    reactExtension,
    useApi,
    Text,
    BlockStack,
    InlineStack,
    Image,
    useTranslate,
    useExtensionCapability,
    Banner,
    Button
} from '@shopify/ui-extensions-react/checkout';
import { useState } from 'react';

// Neon-Lime PayEase Theme Constants
// Note: Shopify Checkout UI is restrictive. You cannot inject raw CSS.
// However, we can use images and standard components.

export default reactExtension(
    'purchase.checkout.payment-method-list.render-after',
    () => <Extension />
);

function Extension() {
    const { extension } = useApi();
    const translate = useTranslate();
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    // Logo URL for Neon PayEase branding
    // Hosted externally or bundled via Shopify asset CDN
    const LOGO_URL = "https://your-cdn.com/polaris-logo-neon.png";

    return (
        <BlockStack spacing="base">
            <InlineStack spacing="base" blockAlignment="center">
                {/* Branding - matching the Polaris aesthetic */}
                <Image
                    source={LOGO_URL}
                    alt="Polaris Protocol"
                />
                <Text size="medium" emphasis="bold">
                    {translate('paymentMethodName', {
                        default: 'Pay with Polaris Protocol',
                    })}
                </Text>
            </InlineStack>

            <Text size="small" appearance="subdued">
                {translate('paymentMethodDescription', {
                    default: 'Secure, instant crypto payments via Creditcoin Network.',
                })}
            </Text>

            {error && (
                <Banner status="critical">
                    {error}
                </Banner>
            )}

            {/* 
        Shopify Offsite Payments usually redirect. 
        If this was a direct tokenization, we'd have inputs here. 
        For standard redirect, we just show the method. 
        
        However, we can add a 'Help' or 'Info' block if needed.
      */}
            <Banner status="info">
                <Text>
                    You will be redirected to the secure Polaris Terminal to complete your transaction.
                    <Text emphasis="bold" appearance="success"> Zero gas fees for first-time users.</Text>
                </Text>
            </Banner>

        </BlockStack>
    );
}
