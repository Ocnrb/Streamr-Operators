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

// --- Application Constants ---
export const DELEGATORS_PER_PAGE = 100;
export const OPERATORS_PER_PAGE = 20; 
export const MIN_SEARCH_LENGTH = 3;
export const MAX_STREAM_MESSAGES = 20;
