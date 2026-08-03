# Polaris Shopify App

> **A Shopify payments app that plugs the Polaris Protocol crypto payment gateway into merchant checkout — an embedded admin app, checkout UI extensions, and an offsite payments flow.**

## Overview

Polaris Shopify App is an [embedded Shopify app](https://shopify.dev/docs/apps) that lets merchants accept payments through the **Polaris Protocol** gateway. Merchants install the app, save their Polaris API credentials from an embedded admin page, and shoppers are then offered a *"Pay with Polaris Protocol"* option in checkout that hands off to the external Polaris payment portal.

The project is built on the Shopify App Remix framework and Shopify CLI. It combines an admin-side configuration UI (Shopify Polaris components), Checkout UI Extensions rendered in the storefront checkout, and server routes that broker payment sessions between Shopify and the Polaris gateway. It is an active work in progress — some handlers are mocked or stubbed and an alternate offsite payments extension is kept under `polaris-checkout-extension-backup/`.

## Features

- **Embedded admin configuration page** (`app/routes/app._index.tsx`) — merchants enter and save their Polaris API key/secret; credentials are persisted per shop in Supabase and surfaced back on reload with a connection-status indicator.
- **Shopify OAuth & session handling** — authentication routes (`auth.$.tsx`, `auth.login.tsx`) backed by `@shopify/shopify-app-remix`, with sessions stored via Prisma.
- **Payment session brokering** (`app/routes/api.payment-session.ts`) — looks up the merchant's credentials by shop domain, forwards the order to the Polaris gateway, and returns a redirect URL to the shopper.
- **Checkout UI extension** (`extensions/polaris-checkout-ui/`) — injects a Polaris payment banner and button into the `checkout` block and the `thank-you` page, redirecting shoppers to the secure Polaris payment portal with order/amount context. Ships English and French locales.
- **Payments Apps GraphQL client** (`app/payments-apps.graphql.ts`) — wraps the Shopify `paymentSessionResolve`, `paymentSessionReject`, and `paymentSessionPending` mutations.
- **Webhook handling** (`app/routes/api.webhooks.ts`) — verifies Shopify webhooks and cleans up sessions on `APP_UNINSTALLED`.
- **Offsite payments extension (backup)** — an alternate `payments_extension` configuration (`polaris-checkout-extension-backup/`) targeting `payments.offsite.render` with payment/refund/capture/void session URLs.

## Tech Stack

- **Language:** TypeScript
- **App framework:** [Remix](https://remix.run/) (`@remix-run/node`, `@remix-run/serve`) on the [Shopify App Remix](https://shopify.dev/docs/api/shopify-app-remix) framework
- **Tooling:** [Shopify CLI](https://shopify.dev/docs/apps/tools/cli) (`@shopify/app`, `@shopify/cli`)
- **Admin UI:** [Shopify Polaris](https://polaris.shopify.com/) components
- **Checkout extensions:** [Shopify Checkout UI Extensions](https://shopify.dev/docs/api/checkout-ui-extensions) (`@shopify/ui-extensions`, `@shopify/ui-extensions-react`), React / Preact
- **Session storage:** [Prisma](https://www.prisma.io/) with SQLite
- **Merchant config store:** [Supabase](https://supabase.com/) (`@supabase/supabase-js`)
- **Payment gateway:** Polaris Protocol (external)

## Getting Started

### Prerequisites

- Node.js and npm
- A [Shopify Partner account](https://partners.shopify.com/) and a development store
- A Supabase project (for storing merchant credentials)

### Install & run

```bash
# clone
git clone https://github.com/nickthelegend/polaris-shopify-app.git
cd polaris-shopify-app

# install dependencies (uses legacy-peer-deps via .npmrc)
npm install

# generate the Prisma client and create the local SQLite DB
npx prisma generate
npx prisma migrate dev

# run the app with the Shopify CLI dev server
npm run dev
```

Configure the following environment variables (e.g. in a `.env` file, which is gitignored):

```bash
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
SHOPIFY_APP_URL=...
SCOPES=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_KEY=...
POLARIS_CHECKOUT_APP_URL=...
```

The Supabase table for merchant credentials is defined in `supabase_schema_merchant_configs.sql`.

### Deploy

```bash
npm run deploy
```

## Project Structure

```
polaris-shopify-app/
├── app/
│   ├── routes/
│   │   ├── app._index.tsx             # Embedded admin config page
│   │   ├── api.payment-session.ts     # Brokers payment sessions to Polaris
│   │   ├── api.refunds.ts             # Refund/webhook handler (mock)
│   │   ├── api.webhooks.ts            # Shopify webhook handler
│   │   ├── auth.$.tsx                 # OAuth catch-all
│   │   └── auth.login.tsx             # Login form
│   ├── lib/supabase.ts                # Supabase client
│   ├── payments-apps.graphql.ts       # Payments Apps GraphQL client
│   ├── payments.repository.ts         # In-memory payment session store
│   ├── shopify.server.ts              # Shopify app configuration
│   └── db.server.ts                   # Prisma client
├── extensions/
│   └── polaris-checkout-ui/           # Checkout & thank-you UI extension
├── polaris-checkout-extension-backup/ # Alternate offsite payments extension
├── prisma/schema.prisma               # Session / PaymentSession / Configuration models
├── supabase_schema_merchant_configs.sql
├── shopify.app.toml                   # Shopify app configuration
└── package.json
```

---

Built by [nickthelegend](https://github.com/nickthelegend) · [nickthelegend.tech](https://nickthelegend.tech)
