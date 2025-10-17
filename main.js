// --- External Libraries ---
// Ethers.js is imported via CDN in index.html
// StreamrClient is imported via CDN in index.html

// --- Module Imports ---
import * as Constants from './constants.js';
import * as Utils from './utils.js';
import * as UI from './ui.js';
import * as Services from './services.js';

// --- Global State ---
let state = {
    signer: null,
    myRealAddress: '',
    currentOperatorId: null,
    currentOperatorData: null,
    currentDelegations: [],
    sponsorshipHistory: [],
    operatorDailyBuckets: [],
    chartTimeFrame: 90, // Default to 90 days
    totalDelegatorCount: 0,
    dataPriceUSD: null,
    loadedOperatorCount: 0,
    searchQuery: '',
    searchTimeout: null,
    detailsRefreshInterval: null,
    activeSponsorshipMenu: null,
    // UI State
    uiState: {
        isStatsPanelExpanded: false,
        isDelegatorViewActive: true,
        reputationViewIndex: 0,
        walletViewIndex: 0,
        isSponsorshipsListViewActive: true,
    },
    // Streamr State
    activeNodes: new Set(),
    unreachableNodes: new Set(),
};

// --- Initialization ---

/**
 * Initializes the main application logic after login.
 */
async function initializeApp() {
    await Services.cleanupClient();
    try {
        const streamrClient = new StreamrClient();
        Services.setStreamrClient(streamrClient);
        console.log("Streamr client initialized.");

        await Services.setupDataPriceStream((price) => {
            state.dataPriceUSD = price;
        });
        
        await fetchAndRenderOperatorsList();

        UI.loginModal.classList.add('hidden');
        UI.mainContainer.classList.remove('hidden');

    } catch (error) {
        console.error("Initialization failed:", error);
        UI.showCustomAlert('Initialization Error', `Failed to initialize the application: ${error.message}`);
        UI.setLoginModalState('buttons');
    }
}

/**
 * Sets up listeners for wallet events like account or chain changes.
 */
function setupWalletListeners() {
    if (window.ethereum) {
        window.ethereum.on('accountsChanged', () => {
            console.log('Wallet account changed, reloading page.');
            window.location.reload();
        });
        window.ethereum.on('chainChanged', () => {
            console.log('Wallet network changed, reloading page.');
            window.location.reload();
        });
    }
}

/**
 * Connects the application using a web3 wallet (e.g., MetaMask).
 */
async function connectWithWallet() {
    const injectedProvider = window.ethereum || window.top?.ethereum;
    if (!injectedProvider) {
        UI.showCustomAlert("MetaMask Not Found", "Please install the MetaMask extension.");
        return;
    }

    try {
        UI.setLoginModalState('loading', 'wallet');
        const provider = new ethers.providers.Web3Provider(injectedProvider);
        await provider.send("eth_requestAccounts", []);
        state.signer = provider.getSigner();
        state.myRealAddress = await state.signer.getAddress();

        if (!await Services.checkAndSwitchNetwork()) {
            UI.setLoginModalState('buttons');
            return;
        }

        UI.updateWalletUI(state.myRealAddress);
        setupWalletListeners();
        await initializeApp();
        sessionStorage.setItem('authMethod', 'metamask');

    } catch (err) {
        console.error("Wallet connection error:", err);
        state.myRealAddress = '';
        state.signer = null;
        UI.walletInfoEl.classList.add('hidden');
        const message = (err.code === 4001 || err.info?.error?.code === 4001) 
            ? "The signature request was rejected in your wallet."
            : "Wallet connection request was rejected or failed.";
        UI.showCustomAlert('Wallet Connection Failed', message);
        UI.setLoginModalState('buttons');
    }
}

/**
 * Initializes the application in guest mode (read-only).
 */
async function connectAsGuest() {
    UI.setLoginModalState('loading', 'guest');
    state.myRealAddress = '';
    state.signer = null;
    UI.walletInfoEl.classList.add('hidden');
    sessionStorage.removeItem('authMethod');
    await initializeApp();
}

// --- Data Fetching and Rendering Orchestration ---

/**
 * Fetches and renders the list of operators.
 * @param {boolean} [isLoadMore=false] - True if appending to the list.
 * @param {number} [skip=0] - The number of items to skip for pagination.
 * @param {string} [filterQuery=''] - The search query.
 */
async function fetchAndRenderOperatorsList(isLoadMore = false, skip = 0, filterQuery = '') {
    UI.showLoader(!isLoadMore);
    try {
        const operators = await Services.fetchOperators(skip, filterQuery);

        if (isLoadMore) {
            UI.appendOperatorsList(operators);
        } else {
            UI.renderOperatorsList(operators, filterQuery);
        }

        if (!filterQuery || (filterQuery.toLowerCase().startsWith('0x'))) {
            state.loadedOperatorCount += operators.length;
        }
        
        UI.loadMoreOperatorsBtn.style.display = (operators.length === Constants.OPERATORS_PER_PAGE && (!filterQuery || filterQuery.toLowerCase().startsWith('0x'))) ? 'inline-block' : 'none';

    } catch (error) {
        console.error("Failed to fetch operators:", error);
        UI.operatorsGrid.innerHTML = `<p class="text-red-400 col-span-full">${Utils.escapeHtml(error.message)}</p>`;
    } finally {
        UI.showLoader(false);
    }
}

/**
 * Fetches and renders the details for a specific operator.
 * @param {string} operatorId - The ID of the operator.
 */
async function fetchAndRenderOperatorDetails(operatorId) {
    UI.showLoader(true);
    if (state.detailsRefreshInterval) clearInterval(state.detailsRefreshInterval);

    state.currentOperatorId = operatorId.toLowerCase();
    state.activeNodes.clear();
    state.unreachableNodes.clear();
    state.chartTimeFrame = 90; // Reset timeframe on new operator view

    try {
        await refreshOperatorData(true); // isFirstLoad = true
        state.detailsRefreshInterval = setInterval(() => refreshOperatorData(false), 30000);
    } catch (error) {
        UI.detailContent.innerHTML = `<p class="text-red-400">${Utils.escapeHtml(error.message)}</p>`;
    } finally {
        UI.showLoader(false);
    }
}

/**
 * Refreshes the operator detail data, either fully or partially.
 * @param {boolean} [isFirstLoad=false] - True for a full re-render.
 */
async function refreshOperatorData(isFirstLoad = false) {
    try {
        const data = await Services.fetchOperatorDetails(state.currentOperatorId);
        state.currentOperatorData = data.operator; // Keep current data fresh
        state.currentDelegations = data.operator?.delegations || [];
        state.totalDelegatorCount = data.operator?.delegatorCount || 0;
        state.operatorDailyBuckets = data.operatorDailyBuckets || [];
        
        processSponsorshipHistory(data);

        if (isFirstLoad) {
            UI.renderOperatorDetails(data, state);
            // After rendering, fetch balances and my stake
            const addresses = [...(data.operator.controllers || []), ...(data.operator.nodes || [])];
            UI.renderBalances(addresses);
            updateMyStakeUI();
            setupOperatorStream();
            filterAndRenderChart();
        } else {
            UI.updateOperatorDetails(data, state);
            // Also refresh balances and my stake on updates
            const addresses = [...(data.operator.controllers || []), ...(data.operator.nodes || [])];
            UI.renderBalances(addresses);
            updateMyStakeUI();
            filterAndRenderChart();
        }

    } catch (error) {
        console.error("Failed to refresh operator data:", error);
        if (isFirstLoad) {
            UI.detailContent.innerHTML = `<p class="text-red-400">${Utils.escapeHtml(error.message)}</p>`;
        }
    }
}

/**
 * Processes and unifies sponsorship-related events into a single chronological feed.
 * @param {object} gqlData - The raw data object from The Graph query.
 */
function processSponsorshipHistory(gqlData) {
    if (!gqlData) {
        state.sponsorshipHistory = [];
        return;
    }

    const stakeEvents = gqlData.stakingEvents?.map(e => ({
        ...e,
        timestamp: e.date, // Unify timestamp field
        // We can't determine the type, so we leave it undefined
    })) || [];

    const unifiedHistory = [...stakeEvents];

    // Sort by timestamp (date) descending
    unifiedHistory.sort((a, b) => b.timestamp - a.timestamp); 
    
    state.sponsorshipHistory = unifiedHistory;
}

/**
 * Filters the daily bucket data based on the current timeframe and renders the chart.
 */
function filterAndRenderChart() {
    const now = new Date();
    const filteredBuckets = state.operatorDailyBuckets.filter(bucket => {
        if (state.chartTimeFrame === 'all') {
            return true;
        }
        const bucketDate = new Date(bucket.date * 1000);
        const daysAgo = (now - bucketDate) / (1000 * 60 * 60 * 24);
        return daysAgo <= state.chartTimeFrame;
    });
    UI.renderStakeChart(filteredBuckets);
    UI.updateChartTimeframeButtons(state.chartTimeFrame);
}


/**
 * Fetches and updates the "My Stake" section in the UI.
 */
async function updateMyStakeUI() {
    if (!state.myRealAddress) return;
    const myStakeSection = document.getElementById('my-stake-section');
    const myStakeValueEl = document.getElementById('my-stake-value');
    if (!myStakeSection || !myStakeValueEl) return;
    
    myStakeSection.classList.remove('hidden');
    myStakeValueEl.textContent = 'Loading...';

    const myStakeWei = await Services.fetchMyStake(state.currentOperatorId, state.myRealAddress, state.signer);
    const myStakeData = Utils.convertWeiToData(myStakeWei);
    myStakeValueEl.textContent = `${Utils.formatBigNumber(myStakeData)} DATA`;
}


// --- Event Handlers ---

function handleShowOperatorDetails(operatorId) {
    UI.displayView('detail');
    // Reset view-specific UI states
    state.uiState.reputationViewIndex = 0;
    state.uiState.walletViewIndex = 0;
    state.uiState.isSponsorshipsListViewActive = true;
    fetchAndRenderOperatorDetails(operatorId);
}

async function handleLoadMoreOperators(button) {
    button.disabled = true;
    button.innerHTML = `<div class="w-4 h-4 border-2 border-white rounded-full border-t-transparent btn-spinner"></div> Loading...`;
    try {
        await fetchAndRenderOperatorsList(true, state.loadedOperatorCount, state.searchQuery);
    } catch (error) {
        console.error("Failed to load more operators:", error);
    } finally {
        button.disabled = false;
        button.innerHTML = 'Load More Operators';
    }
}

function handleSearch(query) {
    if (state.searchTimeout) clearTimeout(state.searchTimeout);
    state.searchTimeout = setTimeout(() => {
        const trimmedQuery = query.trim();
        if (state.searchQuery !== trimmedQuery) {
            state.searchQuery = trimmedQuery;
            state.loadedOperatorCount = 0;
            fetchAndRenderOperatorsList(false, 0, state.searchQuery);
        }
    }, 300);
}

async function handleLoadMoreDelegators(button) {
    button.disabled = true;
    button.innerHTML = `<div class="w-4 h-4 border-2 border-white rounded-full border-t-transparent btn-spinner"></div> Loading...`;
    try {
        const newDelegations = await Services.fetchMoreDelegators(state.currentOperatorId, state.currentDelegations.length);
        state.currentDelegations.push(...newDelegations);
        UI.updateDelegatorsSection(state.currentDelegations, state.totalDelegatorCount);
    } catch (error) {
        console.error("Failed to load more delegators:", error);
    } finally {
        button.disabled = false;
        button.textContent = 'Load More';
    }
}

// --- Transaction Handlers ---

async function handleDelegateClick() {
    if (!state.signer) {
        UI.showCustomAlert('Action Required', 'Please connect a wallet to delegate.');
        return;
    }
    if (!await Services.checkAndSwitchNetwork()) return;

    let maxAmountWei = await Services.manageTransactionModal(true, 'delegate', state.signer, state.myRealAddress, state.currentOperatorId);

    // Use a clone to ensure the event listener is fresh
    const confirmBtn = document.getElementById('tx-modal-confirm');
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

    document.getElementById('tx-modal-max-btn').onclick = () => {
        if (maxAmountWei !== '0') {
            UI.txModalAmount.value = ethers.utils.formatEther(maxAmountWei);
        }
    };
    
    newConfirmBtn.addEventListener('click', async () => {
        newConfirmBtn.disabled = true;
        newConfirmBtn.innerHTML = `<div class="w-4 h-4 border-2 border-white rounded-full border-t-transparent btn-spinner"></div> Processing...`;
        
        const txHash = await Services.confirmDelegation(state.signer, state.myRealAddress, state.currentOperatorId);
        if (txHash) {
            await updateMyStakeUI();
        }

        newConfirmBtn.disabled = false;
        newConfirmBtn.textContent = 'Confirm';
    });
}

async function handleUndelegateClick() {
    if (!state.signer) {
        UI.showCustomAlert('Action Required', 'Please connect a wallet to undelegate.');
        return;
    }
    if (!await Services.checkAndSwitchNetwork()) return;

    let maxAmountWei = await Services.manageTransactionModal(true, 'undelegate', state.signer, state.myRealAddress, state.currentOperatorId);
    
    const confirmBtn = document.getElementById('tx-modal-confirm');
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    
    document.getElementById('tx-modal-max-btn').onclick = () => {
        if (maxAmountWei !== '0') {
            UI.txModalAmount.value = ethers.utils.formatEther(maxAmountWei);
        }
    };
    
    newConfirmBtn.addEventListener('click', async () => {
        newConfirmBtn.disabled = true;
        newConfirmBtn.innerHTML = `<div class="w-4 h-4 border-2 border-white rounded-full border-t-transparent btn-spinner"></div> Processing...`;

        const txHash = await Services.confirmUndelegation(state.signer, state.myRealAddress, state.currentOperatorId, state.currentOperatorData);
        if (txHash) {
            await updateMyStakeUI();
        }

        newConfirmBtn.disabled = false;
        newConfirmBtn.textContent = 'Confirm';
    });
}

async function handleProcessQueueClick(button) {
    if (!state.signer) {
        UI.showCustomAlert('Action Required', 'Please connect your wallet.');
        return;
    }
    button.disabled = true;
    button.innerHTML = `<div class="w-4 h-4 border-2 border-white rounded-full border-t-transparent btn-spinner"></div> Processing...`;
    
    await Services.handleProcessQueue(state.signer, state.currentOperatorId);
    await refreshOperatorData(true); // Full refresh after queue processing

    button.disabled = false;
    button.innerHTML = 'Process Queue';
}

async function handleEditStakeClick(sponsorshipId, currentStakeWei) {
    if (!state.signer) {
        UI.showCustomAlert('Action Required', 'Please connect your wallet.');
        return;
    }
    UI.setModalState('stake-modal', 'input');
    UI.stakeModal.classList.remove('hidden');

    const currentStakeData = Utils.convertWeiToData(currentStakeWei);
    UI.stakeModalCurrentStake.textContent = `${Utils.formatBigNumber(currentStakeData)} DATA`;
    UI.stakeModalAmount.value = parseFloat(currentStakeData);
    
    // Fetch free funds and calculate max
    const tokenContract = new ethers.Contract(Constants.DATA_TOKEN_ADDRESS_POLYGON, Constants.DATA_TOKEN_ABI, state.signer.provider);
    const freeFundsWei = await tokenContract.balanceOf(state.currentOperatorId);
    UI.stakeModalFreeFunds.textContent = `${Utils.formatBigNumber(Utils.convertWeiToData(freeFundsWei))} DATA`;
    const maxStakeAmountWei = ethers.BigNumber.from(currentStakeWei).add(freeFundsWei).toString();
    
    document.getElementById('stake-modal-max-btn').onclick = () => {
        UI.stakeModalAmount.value = ethers.utils.formatEther(maxStakeAmountWei);
    };

    const confirmBtn = document.getElementById('stake-modal-confirm');
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

    newConfirmBtn.addEventListener('click', async () => {
        newConfirmBtn.disabled = true;
        newConfirmBtn.innerHTML = `<div class="w-4 h-4 border-2 border-white rounded-full border-t-transparent btn-spinner"></div> Processing...`;

        const result = await Services.confirmStakeEdit(state.signer, state.currentOperatorId, sponsorshipId, currentStakeWei);
        if (result && result !== 'nochange') {
            await refreshOperatorData(false); // Partial refresh
        }
        
        newConfirmBtn.disabled = false;
        newConfirmBtn.textContent = 'Confirm';
    });
}

async function handleCollectEarningsClick(button, sponsorshipId) {
     if (!state.signer) {
        UI.showCustomAlert('Action Required', 'Please connect your wallet.');
        return;
    }
    button.classList.add('processing');
    const originalText = button.textContent;
    button.textContent = 'Processing...';

    await Services.handleCollectEarnings(state.signer, state.currentOperatorId, sponsorshipId);
    await refreshOperatorData(false);

    button.classList.remove('processing');
    button.textContent = originalText;
}

async function handleCollectAllEarningsClick(button) {
    if (!state.signer) {
        UI.showCustomAlert('Action Required', 'Please connect your wallet.');
        return;
    }
    button.disabled = true;
    button.innerHTML = `<div class="w-4 h-4 border-2 border-white rounded-full border-t-transparent btn-spinner"></div>`;

    await Services.handleCollectAllEarnings(state.signer, state.currentOperatorId, state.currentOperatorData);
    await refreshOperatorData(false);

    button.disabled = false;
    button.textContent = 'Collect All';
}

// --- Streamr Coordination Stream ---
function setupOperatorStream() {
    Services.setupStreamrSubscription(state.currentOperatorId, (message) => {
        UI.addStreamMessageToUI(message, state.activeNodes, state.unreachableNodes);
    });
}

// --- Event Listener Setup ---

function setupEventListeners() {
    // Login
    document.getElementById('connectWalletBtn').addEventListener('click', connectWithWallet);
    document.getElementById('guestBtn').addEventListener('click', connectAsGuest);
    document.getElementById('closeAlertBtn').addEventListener('click', () => UI.customAlertModal.classList.add('hidden'));

    // Main List
    UI.searchInput.addEventListener('input', (e) => handleSearch(e.target.value));
    document.getElementById('load-more-operators-btn').addEventListener('click', (e) => handleLoadMoreOperators(e.target));
    
    // Detail View Navigation
    document.getElementById('back-to-list-btn').addEventListener('click', () => {
        if (state.detailsRefreshInterval) clearInterval(state.detailsRefreshInterval);
        Services.unsubscribeFromCoordinationStream();
        UI.displayView('list');
    });

    // Modals
    document.getElementById('tx-modal-cancel').addEventListener('click', () => UI.transactionModal.classList.add('hidden'));
    document.getElementById('tx-modal-close').addEventListener('click', () => UI.transactionModal.classList.add('hidden'));
    document.getElementById('stake-modal-cancel').addEventListener('click', () => UI.stakeModal.classList.add('hidden'));
    document.getElementById('stake-modal-close').addEventListener('click', () => UI.stakeModal.classList.add('hidden'));
    
    // Settings
    document.getElementById('settings-btn').addEventListener('click', () => {
        UI.theGraphApiKeyInput.value = localStorage.getItem('the-graph-api-key') || '';
        UI.settingsModal.classList.remove('hidden');
    });
    document.getElementById('settings-cancel-btn').addEventListener('click', () => UI.settingsModal.classList.add('hidden'));
    document.getElementById('settings-save-btn').addEventListener('click', () => {
        const newKey = UI.theGraphApiKeyInput.value.trim();
        if (newKey) {
            localStorage.setItem('the-graph-api-key', newKey);
        } else {
            localStorage.removeItem('the-graph-api-key');
        }
        Services.updateGraphApiKey(newKey);
        UI.settingsModal.classList.add('hidden');
        UI.showCustomAlert('Settings Saved', 'Data will be refreshed with the new API key.');
        state.loadedOperatorCount = 0;
        fetchAndRenderOperatorsList(false, 0, state.searchQuery);
    });
    
    // Event Delegation for dynamic content
    document.body.addEventListener('click', (e) => {
        const target = e.target;

        // Operator cards and links
        const operatorCard = target.closest('.card, .operator-link');
        if (operatorCard && operatorCard.dataset.operatorId) {
            e.preventDefault();
            handleShowOperatorDetails(operatorCard.dataset.operatorId);
            return;
        }

        // Detail view buttons
        if (target.id === 'delegate-btn') handleDelegateClick();
        if (target.id === 'undelegate-btn') handleUndelegateClick();
        if (target.id === 'process-queue-btn') handleProcessQueueClick(target);
        if (target.id === 'collect-all-earnings-btn') handleCollectAllEarningsClick(target);
        if (target.id === 'load-more-delegators-btn') handleLoadMoreDelegators(target);
        
        // Detail view toggles
        if (target.closest('#toggle-stats-btn')) UI.toggleStatsPanel(false, state.uiState);
        if (target.id === 'toggle-delegator-view-btn') {
            UI.toggleDelegatorQueueView(state.currentOperatorData, state.uiState);
            if(state.uiState.isDelegatorViewActive) {
                UI.updateDelegatorsSection(state.currentDelegations, state.totalDelegatorCount);
            }
        }
        if (target.id === 'toggle-reputation-view-btn') UI.toggleReputationView(false, state.uiState);
        if (target.id === 'toggle-wallets-view-btn') UI.toggleWalletsView(false, state.uiState);
        if (target.id === 'toggle-sponsorship-view-btn') {
            UI.toggleSponsorshipsView(state.uiState, state.currentOperatorData);
            // Render history only when switching to that view, if not already rendered
            if (!state.uiState.isSponsorshipsListViewActive) {
                 UI.renderSponsorshipsHistory(state.sponsorshipHistory);
            }
        }
        if (target.closest('.toggle-vote-list-btn')) UI.toggleVoteList(target.closest('.toggle-vote-list-btn').dataset.flagId);

        // Chart timeframe buttons
        const timeframeButton = target.closest('#chart-timeframe-buttons button');
        if (timeframeButton && timeframeButton.dataset.days) {
            const days = timeframeButton.dataset.days === 'all' ? 'all' : parseInt(timeframeButton.dataset.days, 10);
            state.chartTimeFrame = days;
            filterAndRenderChart();
            return;
        }

        // Sponsorship menu
        const menuBtn = target.closest('.toggle-sponsorship-menu-btn');
        if (menuBtn) {
            e.stopPropagation();
            const sponsorshipId = menuBtn.dataset.sponsorshipId;
            const menu = document.getElementById(`sponsorship-menu-${sponsorshipId}`);
            if (state.activeSponsorshipMenu && state.activeSponsorshipMenu !== menu) {
                state.activeSponsorshipMenu.classList.add('hidden');
            }
            menu.classList.toggle('hidden');
            state.activeSponsorshipMenu = menu.classList.contains('hidden') ? null : menu;
        } else {
             if (state.activeSponsorshipMenu) {
                state.activeSponsorshipMenu.classList.add('hidden');
                state.activeSponsorshipMenu = null;
            }
        }
        
        // Sponsorship actions
        const editStakeLink = target.closest('.edit-stake-link');
        if(editStakeLink) {
            e.preventDefault();
            handleEditStakeClick(editStakeLink.dataset.sponsorshipId, editStakeLink.dataset.currentStake);
        }
        
        const collectEarningsLink = target.closest('.collect-earnings-link');
        if(collectEarningsLink) {
            e.preventDefault();
            if (collectEarningsLink.classList.contains('processing')) return;
            handleCollectEarningsClick(collectEarningsLink, collectEarningsLink.dataset.sponsorshipId);
        }
    });

    // Tooltip listeners
    UI.mainContainer.addEventListener('mouseover', (e) => {
        const target = e.target.closest('[data-tooltip-value], [data-tooltip-content]');
        if (!target) return;
        const content = target.dataset.tooltipContent || Utils.formatUsdForTooltip(target.dataset.tooltipValue, state.dataPriceUSD);
        if (content) {
            UI.customTooltip.textContent = content;
            UI.customTooltip.classList.remove('hidden');
        }
    });
    UI.mainContainer.addEventListener('mousemove', (e) => {
        if (!UI.customTooltip.classList.contains('hidden')) {
            UI.customTooltip.style.left = `${e.pageX + 15}px`;
            UI.customTooltip.style.top = `${e.pageY + 15}px`;
        }
    });
    UI.mainContainer.addEventListener('mouseout', (e) => {
        if (e.target.closest('[data-tooltip-value], [data-tooltip-content]')) {
            UI.customTooltip.classList.add('hidden');
        }
    });
}


// --- App Entry Point ---
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    UI.loginModal.classList.remove('hidden');
});

