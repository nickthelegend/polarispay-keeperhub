#!/usr/bin/env node
/**
 * Run the PolarisPay MCP server over stdio.
 *
 *   npx polaris-mcp
 *
 * Register it with any MCP client. Reads work with no credentials; set
 * KEEPERHUB_API_KEY to enable the tools that spend.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createPolarisMcpServer } from "./server.js";

const server = createPolarisMcpServer({
  chainId: Number(process.env.CHAIN_ID ?? 11_155_111),
  rpcUrl: process.env.SEPOLIA_RPC_URL,
  keeperHubApiKey: process.env.KEEPERHUB_API_KEY,
  keeperHubBaseUrl: process.env.KEEPERHUB_BASE_URL,
  contracts: {
    loanEngine: process.env.POLARIS_LOAN_ENGINE ?? "0x5d6F049f791C40b09701129b3663d1A8ce9eAB86",
    scoreManager: process.env.POLARIS_SCORE_MANAGER ?? "0x13C5af8f4c6E7f3b26998451Cf4FD65a6Ca268e2",
    collateralVault:
      process.env.POLARIS_COLLATERAL_VAULT ?? "0xDb6781ed843Ba07Af3321bB8C3952db643324b98",
    payments: process.env.POLARIS_PAYMENTS ?? "0x3BD1609abDC915eA9e01A399a26e2B8A2a06243f",
    stablecoin: process.env.POLARIS_USDC ?? "0x49C86277a91002c4943837bf20F6ED41976Db09F",
  },
});

await server.connect(new StdioServerTransport());
