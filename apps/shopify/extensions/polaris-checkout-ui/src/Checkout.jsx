import {
  reactExtension,
  Banner,
  BlockStack,
  Button,
  Text,
  useApi,
  useTotalAmount,
  useOrder,
} from "@shopify/ui-extensions-react/checkout";

// ----- Checkout Page Extension -----
function CheckoutUI() {
  const total = useTotalAmount();
  const api = useApi();
  const shopDomain = api?.shop?.myshopifyDomain || "";

  console.log("Polaris Checkout Phase Rendered", { total, shopDomain });

  const paymentUrl = `https://polaris-pay.vercel.app/pay?shop=${shopDomain}&amount=${total?.amount}&currency=${total?.currencyCode}&status=checkout`;

  return (
    <BlockStack spacing="loose">
      <Banner title="Polaris Protocol Payments" status="info">
        <Text>
          Ready to pay with Polaris? Click the button below to proceed to the secure payment portal.
        </Text>
      </Banner>
      <Button to={paymentUrl} kind="primary">
        Pay Now with Polaris Protocol
      </Button>
      <BlockStack spacing="tight">
        <Text size="small" appearance="subdued">Debug: Checkout Phase</Text>
        {total && (
          <Text size="small" appearance="subdued">Amount: {total.amount} {total.currencyCode}</Text>
        )}
      </BlockStack>
    </BlockStack>
  );
}

// ----- Thank You Page Extension -----
function ThankYouUI() {
  const order = useOrder();
  const total = useTotalAmount();
  const api = useApi();
  const shopDomain = api?.shop?.myshopifyDomain || "";

  console.log("Polaris Thank You Phase Rendered", { order, total });

  // Handle cases where order data might be delayed or missing
  const orderId = order?.id?.split("/").pop() || "pending";
  const amount = total?.amount || "0.00";
  const currency = total?.currencyCode || "USD";

  const paymentUrl = `https://polaris-pay.vercel.app/pay?orderId=${orderId}&shop=${shopDomain}&amount=${amount}&currency=${currency}&status=thank_you`;

  return (
    <BlockStack spacing="loose">
      <Banner title="Order Placed - Payment Required" status="warning">
        <Text>
          To complete your order using Polaris Protocol, please click the button below to finalize your payment.
        </Text>
      </Banner>
      <Button to={paymentUrl} kind="primary">
        Finalize Polaris Payment
      </Button>
      <BlockStack spacing="tight">
        <Text size="small" appearance="subdued">Debug: Thank You Phase (ID: {orderId})</Text>
        <Text size="small" appearance="subdued">Amount: {amount} {currency}</Text>
      </BlockStack>
    </BlockStack>
  );
}

export const checkoutExtension = reactExtension("purchase.checkout.block.render", () => <CheckoutUI />);
export const thankYouExtension = reactExtension("purchase.thank-you.block.render", () => <ThankYouUI />);
