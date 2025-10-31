// --- Smart Contract & Network Constants ---
export const DATA_TOKEN_ADDRESS_POLYGON = '0x3a9A81d576d83FF21f26f325066054540720fC34';
export const STREAMR_CONFIG_ADDRESS = '0x344587b3d00394821557352354331D7048754d24';

export const DATA_TOKEN_ABI = [
     {
        "inputs": [
            { "internalType": "address", "name": "to", "type": "address" },
            { "internalType": "uint256", "name": "value", "type": "uint256" },
            { "internalType": "bytes", "name": "data", "type": "bytes" }
        ],
        "name": "transferAndCall",
        "outputs": [ { "internalType": "bool", "name": "", "type": "bool" } ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "constant": true,
        "inputs": [ { "name": "_owner", "type": "address" } ],
        "name": "balanceOf",
        "outputs": [ { "name": "balance", "type": "uint256" } ],
        "stateMutability": "view",
        "type": "function"
    }
];

export const OPERATOR_CONTRACT_ABI = [
    // Minimal ABI for undelegating and checking stake
    {
        "inputs": [],
        "name": "totalSupply",
        "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "totalValueInQueuesAndSponsorships",
        "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [ { "internalType": "uint256", "name": "operatorTokenAmount", "type": "uint256" } ],
        "name": "undelegate",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [ { "internalType": "address", "name": "account", "type": "address" } ],
        "name": "balanceOf", // Returns the amount of Operator Tokens (shares) a delegator has
        "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [ { "internalType": "address", "name": "delegator", "type": "address" } ],
        "name": "balanceInData", // Returns a delegator's stake value in DATA tokens
        "outputs": [ { "internalType": "uint256", "name": "amountDataWei", "type": "uint256" } ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [ { "internalType": "uint256", "name": "maxIterations", "type": "uint256" } ],
        "name": "payOutQueue",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    // New functions for stake management
    {
        "inputs": [ { "internalType": "address", "name": "sponsorship", "type": "address" }, { "internalType": "uint256", "name": "amountWei", "type": "uint256" } ],
        "name": "stake",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [ { "internalType": "address", "name": "sponsorship", "type": "address" }, { "internalType": "uint256", "name": "targetStakeWei", "type": "uint256" } ],
        "name": "reduceStakeTo",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [ { "internalType": "address[]", "name": "sponsorshipAddresses", "type": "address[]" } ],
        "name": "withdrawEarningsFromSponsorships",
        "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];

export const STREAMR_CONFIG_ABI = [{ "inputs": [], "name": "minimumDelegationWei", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" }];


// --- API & SDK Constants ---
export const SUBGRAPH_ID = 'EGWFdhhiWypDuz22Uy7b3F69E9MEkyfU9iAQMttkH5Rj';
export const DATA_PRICE_STREAM_ID = 'binance-streamr.eth/DATAUSDT/ticker';
export const POLYGON_RPC_URL = 'https://polygon-rpc.com';

// --- NEW: Polygonscan Constants ---
export const POLYGONSCAN_API_URL = "https://api.etherscan.io/v2/api";
export const POLYGONSCAN_NETWORK = {
    apiUrl: "https://api.etherscan.io/v2/api", // Unified endpoint
    nativeToken: "MATIC",
    explorerUrl: "https://polygonscan.com/tx/",
    chainId: 137 // ChainId for Polygon
};

// MethodID Dictionary (from our previous app)
export const POLYGONSCAN_METHOD_IDS = {
    // Standard ERC-20 IDs
    "0xa9059cbb": "transfer",
    "0x23b872dd": "transferFrom",
    "0x095ea7b3": "approve",
    "0xd0e30db0": "deposit (WETH/WMATIC)",
    "0x2e1a7d4d": "withdraw (WETH/WMATIC)",

    // 'DATA' contract IDs
    "0x4000aea0": "Transfer And Call",
    "0x918b5be1": "Update Metadata",
    "0x25c33549": "Set Node Address",
    "0xe8e658b4": "Withdraw Earnings",
    "0xbed6ff09": "Vote On Flag",
    "0x0fd6ff49": "Heartbeat",
    "0x6c68c0e1": "Undelegate",
    "0xadc9772e": "Stake",
    "0xd1b68611": "Reduce Stake To",
    "0x4a178fe4": "Flag",

    // Other common IDs
    "0x42842e0e": "safeTransferFrom (ERC721)",
    "0x522f6445": "safeTransferFrom (ERC1155)",
    "0x70a08231": "balanceOf"
};

// "Vote On Flag" logic 
export const VOTE_ON_FLAG_RAW_AMOUNTS = new Set([
    "50000000000000000",   // 0.05
    "500000000000000000",  // 0.5
    "150000000000000000",  // 0.15
    "36000000000000000000", // 36
    "2000000000000000000"  // 2
]);

// --- Application Constants ---
export const DELEGATORS_PER_PAGE = 100;
export const OPERATORS_PER_PAGE = 20; 
export const MIN_SEARCH_LENGTH = 3;
export const MAX_STREAM_MESSAGES = 20;