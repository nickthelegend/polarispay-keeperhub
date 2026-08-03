# Polaris SDK

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)
![ethers](https://img.shields.io/badge/ethers-6-2535A0?style=flat-square)

> A drop-in React component for accepting on-chain USDC payments through the Polaris payment gateway.

## Overview

Polaris SDK is a lightweight React/TypeScript library that lets a web app collect crypto payments with a single component. It ships one export — `<PayWithPolaris />` — which handles the full checkout flow: it initializes a bill against the Polaris API, connects the user's wallet, ensures they are on the right network, approves the stablecoin, and settles the payment through an on-chain escrow contract. It is aimed at developers who want to add a "Pay with USDC" button to their app without writing wallet, network, and contract-interaction plumbing themselves.

## Features

- **One-component checkout** — render `<PayWithPolaris />` with your API credentials and payment details; the component drives the rest.
- **Wallet integration via MetaMask** — connects through `window.ethereum` and signs with the user's account using [ethers](https://docs.ethers.org/) v6.
- **Automatic network handling** — detects the current chain and prompts the wallet to switch to (or add) the Creditcoin Testnet if needed.
- **ERC-20 approval flow** — reads the escrow contract's `stablecoin()` address, checks the existing allowance, and only requests an `approve` transaction when required.
- **Escrow settlement** — calls `settlePayment(amount, orderId, details)` on the escrow contract and waits for confirmation.
- **Live status + callbacks** — surfaces step-by-step status and error UI, and exposes `onSuccess(txHash)` / `onError(message)` callbacks.

## Tech Stack

- **Language:** TypeScript (targeting ES5, `react-jsx`)
- **UI:** React 18 (peer dependency)
- **Blockchain:** ethers v6 (peer dependency), MetaMask, Creditcoin Testnet
- **Icons/Styling:** lucide-react icons with Tailwind-style utility classes
- **Build:** `tsc` via the TypeScript compiler

## Getting Started

`react`, `react-dom`, and `ethers` are peer dependencies and must be present in the host app.

```bash
# clone
git clone https://github.com/nickthelegend/polaris-sdk.git
cd polaris-sdk

# install and build
npm install
npm run build
```

Use the component in your app:

```tsx
import { PayWithPolaris } from 'polaris-sdk';

export default function Checkout() {
  return (
    <PayWithPolaris
      apiKey={process.env.POLARIS_API_KEY!}
      apiSecret={process.env.POLARIS_API_SECRET!}
      amount={25}
      details="Order #1234"
      onSuccess={(txHash) => console.log('Paid:', txHash)}
      onError={(err) => console.error(err)}
    />
  );
}
```

> Note: the component points at `http://localhost:3000/api/bills/create` for bill creation, so a Polaris API server must be running (or the URL adjusted) for the flow to complete.

## Project Structure

```
polaris-sdk/
├── src/
│   ├── components/
│   │   └── PayWithPolaris.tsx   # the payment button + full checkout flow
│   └── index.ts                # public entry point (re-exports the component)
├── package.json
├── package-lock.json
├── tsconfig.json
└── README.md
```

## License

MIT

---

Built by [**nickthelegend**](https://github.com/nickthelegend) · [nickthelegend.tech](https://nickthelegend.tech)
