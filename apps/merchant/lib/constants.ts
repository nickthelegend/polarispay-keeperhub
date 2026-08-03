export const CONTRACTS = {
    MASTER: {
        POOL_MANAGER: "0x2effA4cb512A1513a0a1AC490FA92e52Fe2d274F",
        LOAN_ENGINE: "0xa77923565D58fc05d5A1B9A50c9CB125d9B1F097",
        SCORE_MANAGER: "0x3a665926175E63f7cD76eC93f2Ed4d6add74B0F8",
        CREDIT_ORACLE: "0x958d0f0Ee78f0f92CF86609BD565438a98E1bd63",
        PROTOCOL_FUNDS: "0xfd3e165D706Df5447Fc344BE8c128304Bf270D0D",
        MERCHANT_ROUTER: "0x55889bA47fb6F272f7742678936AB6076138015E",
        USDC: "0x209e6F4c016245833DE2999E170eb14F07C29BB1",
        USDT: "0x010453c439A7a91e372AA256b7B6F65f59E7F44C",
        WETH: "0xaf4D66F3f9D6325fd08ef6174949376702b76431",
        BNB: "0xEB5c6F2094cEDafcC9dBba249f43BacacFb085CA",
    },
};

export const NETWORKS = {
    SEPOLIA: {
        chainId: 11155111,
        name: "Ethereum Sepolia",
        rpc: "https://eth-sepolia.g.alchemy.com/v2/3qRB0TMQQv3hyKgav_6lF",
        explorer: "https://sepolia.etherscan.io",
    },
    LOCAL_HARDHAT: {
        chainId: 50312,
        name: "Fhenix Local",
        rpc: "http://localhost:8545",
        explorer: "https://explorer.sepolia.fhenix.zone",
    },
};
