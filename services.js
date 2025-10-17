import {
    DATA_TOKEN_ADDRESS_POLYGON,
    STREAMR_CONFIG_ADDRESS,
    DATA_TOKEN_ABI,
    OPERATOR_CONTRACT_ABI,
    STREAMR_CONFIG_ABI,
    SUBGRAPH_ID,
    DATA_PRICE_STREAM_ID,
    POLYGON_RPC_URL,
    DELEGATORS_PER_PAGE,
    OPERATORS_PER_PAGE,
    MIN_SEARCH_LENGTH
} from './constants.js';
import { showCustomAlert, setModalState, txModalAmount, txModalBalanceValue, txModalMinimumValue, stakeModalAmount, stakeModalCurrentStake, stakeModalFreeFunds, dataPriceValueEl, transactionModal, stakeModal } from './ui.js';
import { getFriendlyErrorMessage, convertWeiToData } from './utils.js';

// Service state
let graphApiKey = localStorage.getItem('the-graph-api-key') || 'bb77dd994c8e90edcbd73661a326f068';
let API_URL = `https://gateway-arbitrum.network.thegraph.com/api/${graphApiKey}/subgraphs/id/${SUBGRAPH_ID}`;

// To be initialized by main.js
let streamrClient = null;
let priceSubscription = null;
let coordinationSubscription = null;

// --- API Key Management ---
export function updateGraphApiKey(newKey) {
    const keyToUse = newKey || 'bb77dd994c8e90edcbd73661a326f068';
    graphApiKey = keyToUse;
    API_URL = `https://gateway-arbitrum.network.thegraph.com/api/${graphApiKey}/subgraphs/id/${SUBGRAPH_ID}`;
    console.log("API Key updated. New URL:", API_URL);
}

// --- Wallet & Network ---
export async function checkAndSwitchNetwork() {
    try {
        if (!window.ethereum) {
            showCustomAlert('Wallet not detected', 'Please install a wallet like MetaMask.');
            return false;
        }
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const network = await provider.getNetwork();
        if (network.chainId !== 137) { // 137 is the chainId for Polygon Mainnet
            showCustomAlert('Incorrect Network', 'Please switch your wallet to the Polygon Mainnet to use this feature.');
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x89' }], // 0x89 is hex for 137
                });
                window.location.reload();
                return true;
            } catch (switchError) {
                if (switchError.code === 4902) {
                    try {
                        await window.ethereum.request({
                            method: 'wallet_addEthereumChain',
                            params: [{
                                chainId: '0x89',
                                chainName: 'Polygon Mainnet',
                                rpcUrls: ['https://polygon-rpc.com'],
                                nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
                                blockExplorerUrls: ['https://polygonscan.com/'],
                            }],
                        });
                        window.location.reload();
                        return true;
                    } catch (addError) {
                        console.error("Failed to add Polygon network", addError);
                        showCustomAlert('Error', 'Failed to add the Polygon network to your wallet.');
                    }
                } else {
                     showCustomAlert('Error', 'Failed to switch network. Please do it manually in your wallet.');
                }
                console.error("Failed to switch network", switchError);
                return false;
            }
        }
        return true;
    } catch (e) {
        console.error("Could not check network:", e);
        return false;
    }
}

// --- API (The Graph) ---
export async function runQuery(query) {
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
    });
    if (!response.ok) throw new Error(`Network error: ${response.statusText}`);
    const result = await response.json();
    if (result.errors) throw new Error(`GraphQL error: ${result.errors.map(e => e.message).join(', ')}`);
    return result.data;
}

const isAddressFilter = (query) => {
    const normalizedQuery = query.toLowerCase();
    return normalizedQuery.startsWith('0x') && /^[0-9a-f]+$/.test(normalizedQuery.substring(2));
};

export async function fetchOperators(skip = 0, filterQuery = '') {
    if (filterQuery && filterQuery.length > 0 && filterQuery.length < MIN_SEARCH_LENGTH) {
        return [];
    }

    if (filterQuery) {
        const lowerCaseFilter = filterQuery.toLowerCase();
        if (isAddressFilter(lowerCaseFilter)) {
            const query = `
                query GetOperatorsList {
                    operators(first: ${OPERATORS_PER_PAGE}, skip: ${skip}, orderBy: valueWithoutEarnings, orderDirection: desc, where: {id_contains: "${lowerCaseFilter}"}) {
                        id valueWithoutEarnings delegatorCount metadataJsonString stakes(first: 50) { amountWei sponsorship { spotAPY } }
                    }
                }`;
            const data = await runQuery(query);
            return data.operators;
        } else {
            const topResultsQuery = `
                query GetTopOperatorsForClientSearch {
                    operators(first: 1000, orderBy: valueWithoutEarnings, orderDirection: desc) {
                        id valueWithoutEarnings delegatorCount metadataJsonString stakes(first: 50) { amountWei sponsorship { spotAPY } }
                    }
                }`;
            const data = await runQuery(topResultsQuery);
            return data.operators.filter(op => {
                const { name } = parseOperatorMetadata(op.metadataJsonString);
                return name ? name.toLowerCase().includes(lowerCaseFilter) : false;
            });
        }
    } else {
        const query = `
            query GetOperatorsList {
                operators(first: ${OPERATORS_PER_PAGE}, skip: ${skip}, orderBy: valueWithoutEarnings, orderDirection: desc) {
                    id valueWithoutEarnings delegatorCount metadataJsonString stakes(first: 50) { amountWei sponsorship { spotAPY } }
                }
            }`;
        const data = await runQuery(query);
        return data.operators;
    }
}

export async function fetchOperatorDetails(operatorId) {
    const query = `
        query GetOperatorDetails {
          operator(id: "${operatorId}") {
            id owner valueWithoutEarnings operatorTokenTotalSupplyWei delegatorCount cumulativeEarningsWei cumulativeProfitsWei cumulativeOperatorsCutWei operatorsCutFraction nodes controllers metadataJsonString
            stakes(first: 100) { amountWei sponsorship { id remainingWei spotAPY isRunning stream { id } } }
            delegations(where: {isSelfDelegation: false}, first: 15, orderBy: _valueDataWei, orderDirection: desc) { id _valueDataWei delegator { id } }
            queueEntries(orderBy: date, orderDirection: asc) { id amount delegator { id } date }
          }
          selfDelegation: delegations(where: {operator: "${operatorId}", isSelfDelegation: true}, first: 1) { _valueDataWei }
          stakingEvents(orderBy: date, orderDirection: desc, first: 100, where: {operator: "${operatorId}"}) {
            id
            amount
            date
            sponsorship { id stream { id } }
          }
          operatorDailyBuckets(first: 1000, orderBy: date, orderDirection: asc, where: {operator: "${operatorId}"}) {
            date
            valueWithoutEarnings
          }
          flagsAgainst: flags(where: {target: "${operatorId}"}, orderBy: flaggingTimestamp, orderDirection: desc) {
                id
                flagger { id, metadataJsonString }
                sponsorship { id stream { id } }
                flaggingTimestamp
                result
                votes(orderBy: timestamp, orderDirection: desc) {
                    id
                    voter { id, metadataJsonString }
                    voterWeight
                    votedKick
                    timestamp
                }
          }
          flagsAsFlagger: flags(where: {flagger: "${operatorId}"}, orderBy: flaggingTimestamp, orderDirection: desc, first: 100) {
            id
            target { id, metadataJsonString }
            sponsorship { id stream { id } }
            flaggingTimestamp
            result
             votes(orderBy: timestamp, orderDirection: desc) {
                id
                voter { id, metadataJsonString }
                voterWeight
                votedKick
                timestamp
            }
          }
          slashingEvents(where: {operator: "${operatorId}"}, orderBy: date, orderDirection: desc, first: 100) { id amount date sponsorship { id stream { id } } }
        }`;
    return await runQuery(query);
}

export async function fetchMoreDelegators(operatorId, skip) {
    const query = `
        query GetMoreDelegators {
            operator(id: "${operatorId}") {
                delegations(where: {isSelfDelegation: false}, first: ${DELEGATORS_PER_PAGE}, skip: ${skip}, orderBy: _valueDataWei, orderDirection: desc) {
                    id _valueDataWei delegator { id }
                }
            }
        }`;
    const data = await runQuery(query);
    return data.operator.delegations;
}


// --- Blockchain Interactions (Ethers.js) ---

/**
 * Fetches the MATIC (POL) balance for a given address.
 * @param {string} address The address to check.
 * @returns {Promise<string>} The formatted balance or 'Error'.
 */
export async function getMaticBalance(address) {
    try {
        const response = await fetch(POLYGON_RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_getBalance',
                params: [address, 'latest'],
                id: 1,
            }),
        });
        if (!response.ok) return 'Error';
        const data = await response.json();
        if (data.error) {
            console.error('RPC Error:', data.error);
            return 'Error';
        }
        const balanceWei = BigInt(data.result);
        const balanceMatic = Number(balanceWei) / 1e18;
        return balanceMatic.toFixed(2);
    } catch (error) {
        console.error(`Failed to get MATIC balance for ${address}:`, error);
        return 'Error';
    }
}

export async function manageTransactionModal(show, mode = 'delegate', signer, myRealAddress, currentOperatorId) {
    if (!show) {
        transactionModal.classList.add('hidden');
        return;
    }
    
    const titleEl = document.getElementById('tx-modal-title');
    const descriptionEl = document.getElementById('tx-modal-description');
    const balanceLabelEl = document.getElementById('tx-modal-balance-label');
    
    titleEl.textContent = mode === 'delegate' ? 'Delegate to Operator' : 'Undelegate from Operator';
    descriptionEl.textContent = mode === 'delegate' ? 'Enter the amount of DATA to delegate.' : 'Enter the amount of DATA to undelegate.';
    balanceLabelEl.textContent = 'Your Balance:';
    txModalBalanceValue.textContent = 'Loading...';
    
    const minimumDelegationContainer = txModalMinimumValue.parentElement;
    minimumDelegationContainer.style.display = mode === 'delegate' ? 'flex' : 'none';

    setModalState('tx-modal', 'input');
    transactionModal.classList.remove('hidden');

    try {
        const provider = signer.provider;
        let balanceWei;
        if (mode === 'delegate') {
            const dataTokenContract = new ethers.Contract(DATA_TOKEN_ADDRESS_POLYGON, DATA_TOKEN_ABI, provider);
            balanceWei = await dataTokenContract.balanceOf(myRealAddress);
        } else { // 'undelegate'
            const operatorContract = new ethers.Contract(currentOperatorId, OPERATOR_CONTRACT_ABI, provider);
            balanceWei = await operatorContract.balanceInData(myRealAddress);
        }
        const balanceFormatted = ethers.utils.formatEther(balanceWei);
        txModalBalanceValue.textContent = `${parseFloat(balanceFormatted).toFixed(4)} DATA`;
        
        // Return the max amount for the confirmation logic
        return balanceWei.toString();
    } catch (e) {
        console.error(`Failed to get balance for ${mode}:`, e);
        txModalBalanceValue.textContent = 'Error';
        return '0';
    }
}

export async function confirmDelegation(signer, myRealAddress, currentOperatorId) {
    const amount = txModalAmount.value.replace(',', '.');
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
        showCustomAlert('Invalid Amount', 'Please enter a valid amount greater than zero.');
        return null;
    }
    setModalState('tx-modal', 'loading', { text: "Checking balance...", subtext: "Please wait." });
    try {
        const dataTokenContract = new ethers.Contract(DATA_TOKEN_ADDRESS_POLYGON, DATA_TOKEN_ABI, signer);
        const amountWei = ethers.utils.parseEther(amount);
        const userBalanceWei = await dataTokenContract.balanceOf(myRealAddress);

        if (amountWei.gt(userBalanceWei)) {
            showCustomAlert('Insufficient Balance', 'You do not have enough DATA to delegate that amount.');
            setModalState('tx-modal', 'input');
            return null;
        }

        setModalState('tx-modal', 'loading');
        const tx = await dataTokenContract.transferAndCall(currentOperatorId, amountWei, '0x');
        setModalState('tx-modal', 'loading', { text: 'Processing Transaction...', subtext: 'Waiting for confirmation.' });
        const receipt = await tx.wait();
        setModalState('tx-modal', 'success', { txHash: receipt.transactionHash });
        return receipt.transactionHash;
    } catch (e) {
        console.error("Delegation failed:", e);
        setModalState('tx-modal', 'error', { message: getFriendlyErrorMessage(e) });
        return null;
    }
}

/**
 * Confirms undelegation transaction with FIXED conversion logic.
 * * KEY CHANGES:
 * - Fetches current values directly from the contract (not from The Graph API)
 * - Uses user's balance proportions instead of pool totals
 * - Handles full withdrawal by using all user's tokens
 * - Includes detailed console logging for debugging
 * * @param {ethers.Signer} signer - The wallet signer
 * @param {string} myRealAddress - User's wallet address
 * @param {string} currentOperatorId - Operator contract address
 * @param {Object} currentOperatorData - Operator data (not used in calculation anymore)
 * @returns {Promise<string|null>} Transaction hash or null if failed
 */
export async function confirmUndelegation(signer, myRealAddress, currentOperatorId, currentOperatorData) {
    const amountData = txModalAmount.value.replace(',', '.');
    if (!amountData || isNaN(amountData) || parseFloat(amountData) <= 0) {
        showCustomAlert('Invalid Amount', 'Please enter a valid amount greater than zero.');
        return null;
    }
    
    setModalState('tx-modal', 'loading', { text: "Checking stake...", subtext: "Please wait." });
    
    try {
        const operatorContract = new ethers.Contract(currentOperatorId, OPERATOR_CONTRACT_ABI, signer);
        const amountDataWei = ethers.utils.parseEther(amountData);
        
        // Fetch CURRENT values from the contract (not from The Graph API)
        // This ensures we have the most up-to-date data including recent earnings
        const [userBalanceDataWei, userBalanceTokensWei] = await Promise.all([
            operatorContract.balanceInData(myRealAddress),      // How much DATA the user has
            operatorContract.balanceOf(myRealAddress)           // How many Operator Tokens the user has
        ]);

        console.log("=== UNDELEGATION DEBUG INFO ===");
        console.log("User wants to withdraw:", ethers.utils.formatEther(amountDataWei), "DATA");
        console.log("User balance in DATA:", ethers.utils.formatEther(userBalanceDataWei), "DATA");
        console.log("User balance in Operator Tokens:", ethers.utils.formatEther(userBalanceTokensWei), "tokens");
        console.log("Conversion rate:", parseFloat(ethers.utils.formatEther(userBalanceDataWei)) / parseFloat(ethers.utils.formatEther(userBalanceTokensWei)), "DATA per token");

        // Check if user has sufficient stake
        if (amountDataWei.gt(userBalanceDataWei)) {
            showCustomAlert('Insufficient Stake', 'You do not have enough staked DATA to undelegate that amount.');
            setModalState('tx-modal', 'input');
            return null;
        }

        // FIXED CONVERSION LOGIC
        // The correct formula is: tokens_to_burn = (amount_to_withdraw / user_total_data) * user_total_tokens
        // This uses the user's own balances, not the pool's totals
        let amountOperatorTokensWei;
        
        // Check if this is a full withdrawal (or very close to it)
        // We use 99.99% threshold to handle rounding issues
        const fullWithdrawalThreshold = userBalanceDataWei.mul(9999).div(10000);
        
        if (amountDataWei.gte(fullWithdrawalThreshold)) {
            // For full withdrawal, use ALL user's tokens to avoid rounding issues
            console.log("Full withdrawal detected - using all user's tokens");
            amountOperatorTokensWei = userBalanceTokensWei;
        } else {
            // For partial withdrawal, calculate proportionally
            // Formula: tokens = (data_amount * user_tokens) / user_data
            if (userBalanceDataWei.isZero()) {
                throw new Error("User has no DATA balance, cannot calculate conversion");
            }
            
            amountOperatorTokensWei = amountDataWei
                .mul(userBalanceTokensWei)
                .div(userBalanceDataWei);
            
            console.log("Calculated tokens to burn:", ethers.utils.formatEther(amountOperatorTokensWei));
            
            // Safety check: ensure we don't try to burn more tokens than user has
            if (amountOperatorTokensWei.gt(userBalanceTokensWei)) {
                console.warn("Calculated tokens exceed user balance, capping to user balance");
                amountOperatorTokensWei = userBalanceTokensWei;
            }
        }

        console.log("Final tokens to burn:", ethers.utils.formatEther(amountOperatorTokensWei), "tokens");
        console.log("Expected DATA to receive:", ethers.utils.formatEther(amountDataWei), "DATA");
        console.log("===============================");

        // Execute the undelegation transaction
        setModalState('tx-modal', 'loading');
        const tx = await operatorContract.undelegate(amountOperatorTokensWei);
        
        setModalState('tx-modal', 'loading', { 
            text: 'Processing Transaction...', 
            subtext: 'Waiting for confirmation.' 
        });
        
        const receipt = await tx.wait();
        
        console.log("Undelegation successful! Transaction hash:", receipt.transactionHash);
        
        setModalState('tx-modal', 'success', { txHash: receipt.transactionHash });
        return receipt.transactionHash;
        
    } catch (e) {
        console.error("Undelegation failed:", e);
        setModalState('tx-modal', 'error', { message: getFriendlyErrorMessage(e) });
        return null;
    }
}


export async function handleProcessQueue(signer, operatorId) {
    transactionModal.classList.remove('hidden');
    document.getElementById('tx-modal-title').textContent = 'Process Undelegation Queue';
    setModalState('tx-modal', 'loading', { text: "Preparing transaction...", subtext: "This will pay out queued undelegations." });
    try {
        const operatorContract = new ethers.Contract(operatorId, OPERATOR_CONTRACT_ABI, signer);
        const tx = await operatorContract.payOutQueue(0); // 0 means iterate as many times as gas limit allows
        setModalState('tx-modal', 'loading', { text: 'Processing Transaction...', subtext: 'Waiting for confirmation.' });
        const receipt = await tx.wait();
        setModalState('tx-modal', 'success', { txHash: receipt.transactionHash });
    } catch (e) {
        console.error("Queue processing failed:", e);
        setModalState('tx-modal', 'error', { message: getFriendlyErrorMessage(e) });
    }
}

export async function confirmStakeEdit(signer, operatorId, sponsorshipId, currentStakeWei) {
    const targetAmount = stakeModalAmount.value.replace(',', '.');
    if (!targetAmount || isNaN(targetAmount) || parseFloat(targetAmount) < 0) {
        showCustomAlert('Invalid Amount', 'Please enter a valid number.');
        return null;
    }
    setModalState('stake-modal', 'loading', { text: "Preparing transaction...", subtext: "Please wait." });
    try {
        const operatorContract = new ethers.Contract(operatorId, OPERATOR_CONTRACT_ABI, signer);
        const targetAmountWei = ethers.utils.parseEther(targetAmount);
        const currentAmountWei = ethers.BigNumber.from(currentStakeWei);
        let tx;
        if (targetAmountWei.gt(currentAmountWei)) {
            const differenceWei = targetAmountWei.sub(currentAmountWei);
            tx = await operatorContract.stake(sponsorshipId, differenceWei);
        } else if (targetAmountWei.lt(currentAmountWei)) {
            tx = await operatorContract.reduceStakeTo(sponsorshipId, targetAmountWei);
        } else {
            stakeModal.classList.add('hidden');
            return 'nochange';
        }
        setModalState('stake-modal', 'loading');
        const receipt = await tx.wait();
        setModalState('stake-modal', 'success', { txHash: receipt.transactionHash });
        return receipt.transactionHash;
    } catch(e) {
        console.error("Stake edit failed:", e);
        setModalState('stake-modal', 'error', { message: getFriendlyErrorMessage(e) });
        return null;
    }
}

export async function handleCollectEarnings(signer, operatorId, sponsorshipId) {
    transactionModal.classList.remove('hidden');
    document.getElementById('tx-modal-title').textContent = 'Collect Earnings';
    setModalState('tx-modal', 'loading', { text: "Preparing transaction...", subtext: "Please wait." });
    try {
        const operatorContract = new ethers.Contract(operatorId, OPERATOR_CONTRACT_ABI, signer);
        const tx = await operatorContract.withdrawEarningsFromSponsorships([sponsorshipId]);
        setModalState('tx-modal', 'loading', { text: 'Processing Transaction...', subtext: 'Waiting for confirmation.' });
        const receipt = await tx.wait();
        setModalState('tx-modal', 'success', { txHash: receipt.transactionHash });
    } catch (e) {
        console.error("Earnings collection failed:", e);
        setModalState('tx-modal', 'error', { message: getFriendlyErrorMessage(e) });
    }
}

export async function handleCollectAllEarnings(signer, operatorId, currentOperatorData) {
    transactionModal.classList.remove('hidden');
    document.getElementById('tx-modal-title').textContent = 'Collect All Earnings';
    setModalState('tx-modal', 'loading', { text: "Preparing transaction...", subtext: "This will collect from all sponsorships." });
    try {
        const operatorContract = new ethers.Contract(operatorId, OPERATOR_CONTRACT_ABI, signer);
        const allSponsorshipIds = currentOperatorData.stakes.map(stake => stake.sponsorship.id);
        const tx = await operatorContract.withdrawEarningsFromSponsorships(allSponsorshipIds);
        setModalState('tx-modal', 'loading', { text: 'Processing Transaction...', subtext: 'Waiting for confirmation.' });
        const receipt = await tx.wait();
        setModalState('tx-modal', 'success', { txHash: receipt.transactionHash });
    } catch (e) {
        console.error("Collect all earnings failed:", e);
        setModalState('tx-modal', 'error', { message: getFriendlyErrorMessage(e) });
    }
}


export async function fetchMyStake(operatorId, myRealAddress, signer) {
    if (!myRealAddress) return '0';
    try {
        const provider = signer?.provider || new ethers.providers.JsonRpcProvider(POLYGON_RPC_URL);
        const operatorContract = new ethers.Contract(operatorId, OPERATOR_CONTRACT_ABI, provider);
        const myStakeWei = await operatorContract.balanceInData(myRealAddress);
        return myStakeWei.toString();
    } catch (e) {
        console.error("Failed to get user's stake:", e);
        return '0';
    }
}

// --- Streamr SDK ---
export function setStreamrClient(client) {
    streamrClient = client;
}

export async function setupDataPriceStream(onPriceUpdate) {
    dataPriceValueEl.textContent = 'Subscribing...';
    try {
        if (priceSubscription) await priceSubscription.unsubscribe();
        priceSubscription = await streamrClient.subscribe(DATA_PRICE_STREAM_ID, (message) => {
            if (message && message.bestBid !== undefined) {
                const price = parseFloat(message.bestBid);
                dataPriceValueEl.textContent = `$${price.toFixed(4)}`;
                onPriceUpdate(price);
            }
        });
        console.log(`Subscribed to DATA price stream: ${DATA_PRICE_STREAM_ID}`);
    } catch (error) {
        console.error("Error setting up DATA price stream:", error);
        dataPriceValueEl.textContent = 'Stream Error';
    }
}

export async function setupStreamrSubscription(operatorId, onMessageCallback) {
    const streamId = `${operatorId}/operator/coordination`;
    await unsubscribeFromCoordinationStream();
    
    const indicatorEl = document.getElementById('stream-status-indicator');
    if (!indicatorEl || !streamrClient) return { subscription: null, error: new Error("Client not ready") };

    indicatorEl.className = 'w-3 h-3 rounded-full bg-yellow-500 animate-pulse';
    indicatorEl.title = `Connecting to ${streamId}...`;
    try {
        coordinationSubscription = await streamrClient.subscribe(streamId, (message) => {
            indicatorEl.className = 'w-3 h-3 rounded-full bg-green-500';
            indicatorEl.title = `Subscribed, receiving data.`;
            onMessageCallback(message);
        });
        indicatorEl.className = 'w-3 h-3 rounded-full bg-gray-400';
        indicatorEl.title = `Subscribed to stream. Awaiting first message...`;
        return { subscription: coordinationSubscription, error: null };
    } catch (error) {
        console.error(`[Streamr] Error subscribing to ${streamId}:`, error);
        indicatorEl.className = 'w-3 h-3 rounded-full bg-red-500';
        indicatorEl.title = `Error subscribing to stream.`;
        return { subscription: null, error };
    }
}

export async function unsubscribeFromCoordinationStream() {
    if (coordinationSubscription) {
        try { await coordinationSubscription.unsubscribe(); } catch (e) { /* ignore */ }
        coordinationSubscription = null;
    }
}

export async function cleanupClient() {
    await unsubscribeFromCoordinationStream();
    if (priceSubscription) {
        try { await priceSubscription.unsubscribe(); } catch (e) { /* ignore */ }
        priceSubscription = null;
    }
    if (streamrClient) {
        try { await streamrClient.destroy(); } catch (e) { /* ignore */ }
        streamrClient = null;
    }
}

