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
    MIN_SEARCH_LENGTH,
    POLYGONSCAN_API_URL,
    POLYGONSCAN_NETWORK,
    POLYGONSCAN_METHOD_IDS,
    VOTE_ON_FLAG_RAW_AMOUNTS
} from './constants.js';
import { showCustomAlert, setModalState, txModalAmount, txModalBalanceValue, txModalMinimumValue, stakeModalAmount, stakeModalCurrentStake, stakeModalFreeFunds, dataPriceValueEl, transactionModal, stakeModal, operatorSettingsModal } from './ui.js';
import { getFriendlyErrorMessage, convertWeiToData } from './utils.js';

let graphApiKey = localStorage.getItem('the-graph-api-key') || 'bb77dd994c8e90edcbd73661a326f068';
let API_URL = `https://gateway-arbitrum.network.thegraph.com/api/${graphApiKey}/subgraphs/id/${SUBGRAPH_ID}`;

let etherscanApiKey = localStorage.getItem('etherscan-api-key') || 'B8BXCXWR66RI1J2QYQRTT4SPHCC6VYYJHC';

let streamrClient = null;
let priceSubscription = null;
let coordinationSubscription = null;

// --- API Key Management ---
export function updateGraphApiKey(newKey) {
    const keyToUse = newKey || 'bb77dd994c8e90edcbd73661a326f068';
    graphApiKey = keyToUse;
    API_URL = `https://gateway-arbitrum.network.thegraph.com/api/${graphApiKey}/subgraphs/id/${SUBGRAPH_ID}`;
    console.log("Graph API Key updated.");
}

export function updateEtherscanApiKey(newKey) {
    etherscanApiKey = newKey || '4IYW9RG6W87Y9B9IGCSD6Z8PVJEIBW5S41';
    console.log("Etherscan API Key updated.");
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
        if (network.chainId !== 137) {
            showCustomAlert('Incorrect Network', 'Please switch your wallet to the Polygon Mainnet to use this feature.');
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x89' }],
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
            const { parseOperatorMetadata } = await import('./utils.js');
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


// --- API (Polygonscan) ---

export async function fetchPolygonscanHistory(walletAddress) {
    if (!etherscanApiKey) {
        console.warn("Etherscan API Key not set. Skipping transaction history fetch.");
        return [];
    }

    const { apiUrl, chainId, nativeToken } = POLYGONSCAN_NETWORK;
    const page = 1;
    const offset = 200;
    const sort = "desc";

    const txlistUrl = `${apiUrl}?chainid=${chainId}&module=account&action=txlist&address=${walletAddress}&page=${page}&offset=${offset}&sort=${sort}&apikey=${etherscanApiKey}`;
    const tokentxUrl = `${apiUrl}?chainid=${chainId}&module=account&action=tokentx&address=${walletAddress}&page=${page}&offset=${offset}&sort=${sort}&apikey=${etherscanApiKey}`;

    try {
        const [txlistRes, tokentxRes] = await Promise.all([
            fetch(txlistUrl),
            fetch(tokentxUrl)
        ]);

        if (!txlistRes.ok) throw new Error(`API request failed (txlist): HTTP ${txlistRes.status}`);
        if (!tokentxRes.ok) throw new Error(`API request failed (tokentx): HTTP ${tokentxRes.status}`);

        const txlistData = await txlistRes.json();
        const tokentxData = await tokentxRes.json();

        if (txlistData.status === "0") throw new Error(`API Error (txlist): ${txlistData.result}`);
        if (tokentxData.status === "0") throw new Error(`API Error (tokentx): ${tokentxData.result}`);

        const normalTxs = txlistData.result || [];
        const tokenTxs = tokentxData.result || [];

        const methodIdMap = new Map();
        const processedNormalTxs = normalTxs.map(tx => {
            const direction = tx.from.toLowerCase() === walletAddress.toLowerCase() ? "OUT" : "IN";
            const methodIdHex = (tx.input === "0x" || !tx.input) ? "-" : tx.input.substring(0, 10);
            const methodId = POLYGONSCAN_METHOD_IDS[methodIdHex] || methodIdHex;
            
            if (methodId !== "-") {
                methodIdMap.set(tx.hash, methodId);
            }

            const amount = parseFloat(tx.value) / 1e18;

            return {
                txHash: tx.hash,
                timestamp: parseInt(tx.timeStamp),
                token: nativeToken,
                direction: direction,
                methodId: methodId,
                amount: amount,
                rawValue: tx.value 
            };
        });

        const processedTokenTxs = tokenTxs.map(tx => {
            const direction = tx.from.toLowerCase() === walletAddress.toLowerCase() ? "OUT" : "IN";
            const decimals = parseInt(tx.tokenDecimal) || 18;
            const amount = parseFloat(tx.value) / Math.pow(10, decimals);
            
            let finalMethodId = methodIdMap.get(tx.hash) || "-";

            if (
                finalMethodId === "-" &&
                tx.tokenSymbol === "DATA" &&
                VOTE_ON_FLAG_RAW_AMOUNTS.has(tx.value)
            ) {
                finalMethodId = "Vote On Flag";
            }

            if (finalMethodId === "Withdraw Earnings" && direction === "OUT") {
                finalMethodId = "Protocol Tax";
            }

            return {
                txHash: tx.hash,
                timestamp: parseInt(tx.timeStamp),
                token: tx.tokenSymbol,
                direction: direction,
                methodId: finalMethodId,
                amount: amount,
                rawValue: tx.value
            };
        });

        const allTxs = [...processedNormalTxs, ...processedTokenTxs];

        const filteredFinalTxs = allTxs.filter(tx => {
            const tokenSymbol = tx.token.toUpperCase();
            const nativeTokenSymbol = nativeToken.toUpperCase();
            if (tokenSymbol === 'DATA') {
                return true;
            }
            if (tokenSymbol === nativeTokenSymbol && tx.amount > 0) {
                return true;
            }
            return false;
        });

        return filteredFinalTxs;

    } catch (error) {
        console.error("Error fetching Polygonscan history:", error);
        showCustomAlert("Etherscan API Error", `Failed to fetch transaction history: ${error.message}. Please check your API key in Settings.`);
        return [];
    }
}


// --- Blockchain Interactions (Ethers.js) ---

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
        return '0';
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
            try {
                const configContract = new ethers.Contract(STREAMR_CONFIG_ADDRESS, STREAMR_CONFIG_ABI, provider);
                const minWei = await configContract.minimumDelegationWei();
                txModalMinimumValue.textContent = `${parseFloat(ethers.utils.formatEther(minWei)).toFixed(0)} DATA`;
            } catch (e) {
                console.error("Failed to get minimum delegation", e);
                txModalMinimumValue.textContent = 'N/A';
            }
        } else {
            const operatorContract = new ethers.Contract(currentOperatorId, OPERATOR_CONTRACT_ABI, provider);
            balanceWei = await operatorContract.balanceInData(myRealAddress);
        }
        const balanceFormatted = ethers.utils.formatEther(balanceWei);
        txModalBalanceValue.textContent = `${parseFloat(balanceFormatted).toFixed(4)} DATA`;
        
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
        
        const [userBalanceDataWei, userBalanceTokensWei] = await Promise.all([
            operatorContract.balanceInData(myRealAddress),
            operatorContract.balanceOf(myRealAddress)
        ]);

        if (amountDataWei.gt(userBalanceDataWei)) {
            showCustomAlert('Insufficient Stake', 'You do not have enough staked DATA to undelegate that amount.');
            setModalState('tx-modal', 'input');
            return null;
        }

        let amountOperatorTokensWei;
        const fullWithdrawalThreshold = userBalanceDataWei.mul(9999).div(10000);
        
        if (amountDataWei.gte(fullWithdrawalThreshold)) {
            amountOperatorTokensWei = userBalanceTokensWei;
        } else {
            if (userBalanceDataWei.isZero()) {
                throw new Error("User has no DATA balance, cannot calculate conversion");
            }
            amountOperatorTokensWei = amountDataWei
                .mul(userBalanceTokensWei)
                .div(userBalanceDataWei);
            if (amountOperatorTokensWei.gt(userBalanceTokensWei)) {
                amountOperatorTokensWei = userBalanceTokensWei;
            }
        }

        setModalState('tx-modal', 'loading');
        const tx = await operatorContract.undelegate(amountOperatorTokensWei);
        setModalState('tx-modal', 'loading', { 
            text: 'Processing Transaction...', 
            subtext: 'Waiting for confirmation.' 
        });
        const receipt = await tx.wait();
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
        const tx = await operatorContract.payOutQueue(0);
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

export async function updateOperatorMetadata(signer, operatorId, newMetadataJson) {
    try {
        const operatorContract = new ethers.Contract(operatorId, OPERATOR_CONTRACT_ABI, signer);
        const tx = await operatorContract.updateMetadata(newMetadataJson);
        const receipt = await tx.wait();
        return receipt.transactionHash;
    } catch (e) {
        console.error("Metadata update failed:", e);
        setModalState('operator-settings-modal', 'error', { message: getFriendlyErrorMessage(e) });
        return null;
    }
}

export async function updateOperatorCut(signer, operatorId, newCutPercent) {
    try {
        const percent = parseFloat(newCutPercent);
        if (isNaN(percent) || percent < 0 || percent > 100) {
            throw new Error("Invalid percentage value. Must be between 0 and 100.");
        }
        
        const cutWei = ethers.utils.parseEther((percent / 100).toString());
        
        const operatorContract = new ethers.Contract(operatorId, OPERATOR_CONTRACT_ABI, signer);
        const tx = await operatorContract.updateOperatorsCutFraction(cutWei);
        const receipt = await tx.wait();
        return receipt.transactionHash;
    } catch (e) {
        console.error("Operator cut update failed:", e);
        setModalState('operator-settings-modal', 'error', { message: getFriendlyErrorMessage(e) });
        return null;
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
