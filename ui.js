import { escapeHtml, formatBigNumber, convertWeiToData, createAddressLink, createEntityLink, parseOperatorMetadata, calculateWeightedApy } from './utils.js';
import { getMaticBalance } from './services.js';

// --- Element Cache ---
export const loginModal = document.getElementById('loginModal');
export const mainContainer = document.getElementById('main-container');
export const operatorsGrid = document.getElementById('operators-grid');
export const searchInput = document.getElementById('search-input');
export const loadMoreOperatorsBtn = document.getElementById('load-more-operators-btn');
export const detailContent = document.getElementById('detail-content');
export const operatorDetailView = document.getElementById('operator-detail-view');
export const operatorListView = document.getElementById('operator-list-view');
export const customTooltip = document.getElementById('custom-tooltip');
export const loaderOverlay = document.getElementById('loader-overlay');
export const customAlertModal = document.getElementById('customAlertModal');
export const walletInfoEl = document.getElementById('wallet-info');
export const dataPriceValueEl = document.getElementById('data-price-value');
export const transactionModal = document.getElementById('transactionModal');
export const stakeModal = document.getElementById('stakeModal');
export const settingsModal = document.getElementById('settingsModal');
export const theGraphApiKeyInput = document.getElementById('thegraph-api-key-input');
// Transaction Modal Elements
export const txModalAmount = document.getElementById('tx-modal-amount');
export const txModalBalanceValue = document.getElementById('tx-modal-balance-value');
export const txModalMinimumValue = document.getElementById('tx-modal-minimum-value');
// Stake Modal Elements
export const stakeModalAmount = document.getElementById('stake-modal-amount');
export const stakeModalCurrentStake = document.getElementById('stake-modal-current-stake');
export const stakeModalFreeFunds = document.getElementById('stake-modal-free-funds');

// --- Module State ---
let stakeHistoryChart = null;


// --- UI Update Functions ---

export function showLoader(show) {
    loaderOverlay.style.display = show ? 'flex' : 'none';
}

export function showCustomAlert(title, message) {
    document.getElementById('customAlertTitle').textContent = title;
    document.getElementById('customAlertMessage').textContent = message;
    customAlertModal.classList.remove('hidden');
}

export function setLoginModalState(state, mode = 'wallet') {
    const walletLoginView = document.getElementById('walletLoginView');
    const loadingContent = document.getElementById('loadingContent');
    const loadingMainText = document.getElementById('loading-main-text');
    const loadingSubText = document.getElementById('loading-sub-text');

    if (state === 'loading') {
        walletLoginView.classList.add('hidden');
        loadingContent.classList.remove('hidden');
        loadingMainText.textContent = mode === 'guest' ? 'Loading...' : 'Connecting...';
        loadingSubText.textContent = mode === 'guest' ? 'Fetching operator data, please wait.' : 'Please follow the instructions in your wallet.';
    } else { // 'buttons'
        loadingContent.classList.add('hidden');
        walletLoginView.classList.remove('hidden');
    }
}

export function updateWalletUI(address) {
    walletInfoEl.innerHTML = `
        <svg class="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path>
        </svg>
        <span>${address.substring(0, 6)}...${address.substring(address.length - 4)}</span>`;
    walletInfoEl.classList.remove('hidden');
    walletInfoEl.classList.add('flex');
}


export function displayView(view) {
    if (view === 'list') {
        operatorDetailView.style.display = 'none';
        operatorListView.style.display = 'block';
    } else { // 'detail'
        operatorListView.style.display = 'none';
        operatorDetailView.style.display = 'block';
        window.scrollTo(0, 0);
    }
}

/**
 * A generic function to control the state of modals (tx-modal, stake-modal, etc.).
 * @param {string} baseId - The base ID of the modal elements (e.g., 'tx-modal').
 * @param {string} state - The target state: 'input', 'loading', 'success', 'error'.
 * @param {object} options - Optional parameters for the state.
 */
export function setModalState(baseId, state, options = {}) {
    const inputSection = document.getElementById(`${baseId}-input-section`);
    const statusSection = document.getElementById(`${baseId}-status-section`);
    const receiptSection = document.getElementById(`${baseId}-receipt`);
    const closeButton = document.getElementById(`${baseId}-close`);
    const loader = document.getElementById(`${baseId}-loader`);
    const statusText = document.getElementById(`${baseId}-status-text`);
    const statusSubtext = document.getElementById(`${baseId}-status-subtext`);
    const amountInput = document.getElementById(`${baseId}-amount`);
    const receiptLink = document.getElementById(`${baseId}-receipt-link`);

    // Hide all dynamic sections first
    if (inputSection) inputSection.classList.add('hidden');
    if (statusSection) statusSection.classList.add('hidden');
    if (receiptSection) receiptSection.classList.add('hidden');
    if (closeButton) closeButton.classList.add('hidden');
    if (loader) loader.classList.remove('hidden');
    if (statusText) statusText.classList.remove('text-red-400');

    if (state === 'input') {
        if (inputSection) inputSection.classList.remove('hidden');
        if (statusText) statusText.textContent = '';
        if (amountInput) amountInput.value = '';
    } else if (state === 'loading') {
        if (statusSection) statusSection.classList.remove('hidden');
        if (statusText) statusText.textContent = options.text || 'Awaiting confirmation...';
        if (statusSubtext) statusSubtext.textContent = options.subtext || 'Please confirm the transaction in your wallet.';
    } else if (state === 'success') {
        if (statusSection) statusSection.classList.remove('hidden');
        if (receiptSection) receiptSection.classList.remove('hidden');
        if (closeButton) closeButton.classList.remove('hidden');
        if (loader) loader.classList.add('hidden');
        if (statusText) statusText.textContent = 'Transaction Successful!';
        if (statusSubtext) statusSubtext.textContent = '';
        if (receiptLink) receiptLink.href = `https://polygonscan.com/tx/${options.txHash}`;
    } else if (state === 'error') {
        if (statusSection) statusSection.classList.remove('hidden');
        if (closeButton) closeButton.classList.remove('hidden');
        if (loader) loader.classList.add('hidden');
        if (statusText) {
            statusText.textContent = 'Transaction Failed';
            statusText.classList.add('text-red-400');
        }
        if (statusSubtext) statusSubtext.textContent = options.message || 'Something went wrong.';
    }
}


// --- List View Rendering ---

function createOperatorCardHtml(op) {
    const { name, description, imageUrl } = parseOperatorMetadata(op.metadataJsonString);
    const placeholderUrl = 'https://placehold.co/64x64/1E1E1E/a3a3a3?text=OP';
    const weightedApy = calculateWeightedApy(op.stakes);
    const totalStakedData = convertWeiToData(op.valueWithoutEarnings);
    const safeOperatorName = escapeHtml(name || op.id);

    // Adiciona lógica para a cor da APY
    const roundedApy = Math.round(weightedApy * 100);
    const apyColorClass = roundedApy === 0 ? 'text-red-400' : 'text-green-400';

    return `
     <div class="bg-[#1E1E1E] p-5 rounded-xl border border-[#333333] card flex flex-col items-center text-center" data-operator-id="${op.id}">
         <img src="${imageUrl || placeholderUrl}" onerror="this.src='${placeholderUrl}'; this.onerror=null;" alt="Operator Avatar" class="w-16 h-16 rounded-full border-2 border-[#333333] object-cover mb-4" ${description ? `data-tooltip-content="${escapeHtml(description)}"` : ''}>
         <div class="w-full">
             <h3 class="font-bold text-lg text-white truncate" title="${safeOperatorName}">${safeOperatorName}</h3>
             ${name ? `<div class="font-mono text-xs text-gray-500 truncate mt-1">${createAddressLink(op.id)}</div>` : ''}
         </div>
         <div class="mt-4 pt-4 border-t border-[#333333] w-full text-left space-y-2 text-sm">
             <p><strong class="text-gray-400">APY:</strong> <span class="font-mono ${apyColorClass}">${roundedApy}%</span></p>
             <div><strong class="text-gray-400">Total Staked:</strong> <span class="font-mono text-white block" data-tooltip-value="${totalStakedData}">${formatBigNumber(totalStakedData)} DATA</span></div>
             <p><strong class="text-gray-400">Delegators:</strong> <span class="font-mono text-white">${op.delegatorCount > 0 ? op.delegatorCount - 1 : 0}</span></p>
         </div>
     </div>`;
}

export function renderOperatorsList(operators, searchQuery) {
    if (!operators || operators.length === 0) {
        let message = 'No operators found.';
        if (searchQuery && searchQuery.length > 0) message = `No operators found for your search "${escapeHtml(searchQuery)}".`;
        operatorsGrid.innerHTML = `<p class="text-gray-500 col-span-full">${message}</p>`;
        return;
    }
    operatorsGrid.innerHTML = operators.map(createOperatorCardHtml).join('');
}

export function appendOperatorsList(operators) {
    if (operators?.length > 0) {
        operatorsGrid.insertAdjacentHTML('beforeend', operators.map(createOperatorCardHtml).join(''));
    }
}

// --- Detail View Rendering ---

/**
 * Fetches and renders the POL balances for a list of addresses.
 * @param {string[]} addresses - An array of addresses.
 */
export async function renderBalances(addresses) {
    const uniqueAddresses = [...new Set(addresses)];
    for (const address of uniqueAddresses) {
        const balance = await getMaticBalance(address);
        const formattedBalance = `${balance} POL`;
        document.querySelectorAll(`#agent-balance-${address}, #node-balance-${address}`).forEach(el => {
            if (el) el.textContent = formattedBalance;
        });
    }
}

export function updateDelegatorsSection(delegations, totalDelegatorCount) {
    const listEl = document.getElementById('delegators-list');
    const footerEl = document.getElementById('delegators-footer');
    if (!listEl || !footerEl) return;

    listEl.innerHTML = delegations.map(delegation => `
        <li class="flex justify-between items-center py-2 border-b border-[#333333]">
            <div class="font-mono text-xs text-gray-300 truncate">${createAddressLink(delegation.delegator.id)}</div>
            <div class="text-right"><span class="font-mono text-xs text-green-400 block" data-tooltip-value="${convertWeiToData(delegation._valueDataWei)}">${formatBigNumber(convertWeiToData(delegation._valueDataWei))} DATA</span></div>
        </li>`
    ).join('');

    footerEl.innerHTML = '';
    if (delegations.length < (totalDelegatorCount - 1)) {
        footerEl.innerHTML = `<button id="load-more-delegators-btn" class="w-full bg-[#2C2C2C] hover:bg-[#3A3A3A] text-white font-bold py-2 px-4 rounded-lg transition-colors flex items-center justify-center">Load More</button>`;
    }
}

/**
 * Renders the unified sponsorship history list (The Graph + Polygonscan).
 * @param {Array} history - The merged and sorted history array from main.js.
 */
export function renderSponsorshipsHistory(history) {
    const listEl = document.getElementById('sponsorships-history-list');
    if (!listEl) return;

    if (history.length === 0) {
        listEl.innerHTML = '<li class="text-gray-500 text-sm p-4 text-center">No recent activity found from The Graph or Polygonscan.</li>';
        return;
    }

    listEl.innerHTML = history.map(event => {
        // Item timestamp
        const date = new Date(event.timestamp * 1000).toLocaleString();

        // --- RENDER LOGIC FOR 'graph' (The Graph Staking Event) ---
        if (event.type === 'graph') {
            const sp = event.relatedObject; // This is the sponsorship object
            if (!sp) return ''; // Should not happen

            const sponsorshipUrl = `https://streamr.network/hub/network/sponsorships/${sp.id}`;
            const sponsorshipDisplayText = escapeHtml(sp.stream?.id || sp.id);
            const link = `<a href="${sponsorshipUrl}" target="_blank" rel="noopener noreferrer" class="text-gray-300 hover:text-white transition-colors" title="${sponsorshipDisplayText}">${sponsorshipDisplayText}</a>`;
            const text = `Staking action on ${link}`;
            const icon = '<svg class="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path></svg>';

            return `
            <li class="flex items-start gap-3 py-3 border-b border-[#333333]">
                <div class="flex-shrink-0 pt-1">${icon}</div>
                <div class="flex-1 min-w-0">
                    <p class="text-sm text-gray-300 truncate">${text}</p>
                    <p class="text-xs text-gray-500 font-mono mt-1">${date}</p>
                </div>
                <div class="text-right flex-shrink-0">
                    <p class="font-mono text-sm text-white" ${event.token.toUpperCase() === 'DATA' ? `data-tooltip-value="${Math.round(event.amount)}"` : ''}>${formatBigNumber(Math.round(event.amount).toString())} ${escapeHtml(event.token)}</p>
                </div>
            </li>`;
        }

        // --- RENDER LOGIC FOR 'scan' (Polygonscan Transaction) ---
        if (event.type === 'scan') {
            const directionClass = event.relatedObject === "IN" ? "tx-badge-in" : "tx-badge-out";
            const txUrl = `https://polygonscan.com/tx/${event.txHash}`;

            return `
            <li class="flex items-center gap-3 py-3 border-b border-[#333333]">
                <div class="flex-shrink-0">
                    <span class="tx-badge ${directionClass}">${event.relatedObject}</span>
                </div>
                <div class="flex-1 min-w-0">
                    <a href="${txUrl}" target="_blank" rel="noopener noreferrer" class="text-sm font-medium text-gray-300 hover:text-white truncate transition-colors block">
                        ${escapeHtml(event.methodId)}
                    </a>
                    <p class="text-xs text-gray-400 font-mono mt-1">
                        ${date}
                    </p>
                </div>
                <div class="text-right flex-shrink-0">
                    <p class="font-mono text-sm text-white" ${event.token.toUpperCase() === 'DATA' ? `data-tooltip-value="${Math.round(event.amount)}"` : ''}>${formatBigNumber(Math.round(event.amount).toString())} ${escapeHtml(event.token)}</p>
                </div>
            </li>`;
        }

        return ''; // Fallback for unknown types
    }).join('');
}


/**
 * Renders the daily stake history chart.
 * @param {Array} buckets - The filtered operatorDailyBuckets data.
 */
export function renderStakeChart(buckets) {
    const container = document.getElementById('stake-chart-container');
    if (!container) return;

    // Clear previous state and recreate canvas
    container.innerHTML = '<canvas id="stake-history-chart"></canvas>';
    const canvas = document.getElementById('stake-history-chart');
    const ctx = canvas.getContext('2d');

    if (stakeHistoryChart) {
        stakeHistoryChart.destroy();
    }

    if (!buckets || buckets.length === 0) {
        container.innerHTML = '<div class="flex items-center justify-center h-full"><p class="text-gray-500">No daily data available for this timeframe.</p></div>';
        return;
    }

    const labels = buckets.map(bucket => new Date(bucket.date * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    const data = buckets.map(bucket => parseFloat(convertWeiToData(bucket.valueWithoutEarnings)));

    stakeHistoryChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Total Stake (DATA)',
                data: data,
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                borderColor: 'rgba(59, 130, 246, 1)',
                borderWidth: 2,
                pointBackgroundColor: 'rgba(59, 130, 246, 1)',
                tension: 0.1,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: '#1E1E1E',
                    titleColor: '#E5E7EB',
                    bodyColor: '#D1D5DB',
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += formatBigNumber(Math.round(context.parsed.y).toString()) + ' DATA';
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.7)',
                        maxRotation: 45,
                        minRotation: 45,
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                y: {
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.7)',
                        callback: function (value) {
                            if (value >= 1000000) return (value / 1000000) + 'M';
                            if (value >= 1000) return (value / 1000) + 'K';
                            return value;
                        }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                }
            }
        }
    });
}


export function renderOperatorDetails(data, globalState) {
    const { operator: op, selfDelegation: selfDelegationData, flagsAgainst, flagsAsFlagger, slashingEvents } = data;
    if (!op) {
        detailContent.innerHTML = '<p class="text-gray-500">Operator not found.</p>';
        return;
    }

    const { name, description, imageUrl } = parseOperatorMetadata(op.metadataJsonString);
    const safeOperatorName = escapeHtml(name || op.id);
    const placeholderUrl = 'https://placehold.co/80x80/1E1E1E/a3a3a3?text=OP';

    let redundancyFactor = '1 (Default)';
    try {
        if (op.metadataJsonString) {
            const meta = JSON.parse(op.metadataJsonString);
            if (meta && meta.redundancyFactor !== undefined) {
                redundancyFactor = meta.redundancyFactor;
            }
        }
    } catch (e) { console.error("Could not parse redundancy factor from metadata", e); }


    const apy = calculateWeightedApy(op.stakes);
    const ownersCutPercent = (BigInt(op.operatorsCutFraction) * 100n) / BigInt('1000000000000000000');

    const headerStatsHtml = `
        <div class="detail-section px-6 pt-6 pb-2">
            <div class="flex items-center gap-6">
                <img src="${imageUrl || placeholderUrl}" onerror="this.src='${placeholderUrl}';" alt="Operator Avatar" class="w-20 h-20 rounded-full border-2 border-[#333333] flex-shrink-0 object-cover" ${description ? `data-tooltip-content="${escapeHtml(description)}"` : ''}>
                <div class="flex-1 min-w-0">
                    <div class="flex items-start md:items-center justify-between flex-col md:flex-row gap-4">
                        <div class="min-w-0">
                            <h2 class="text-3xl font-bold text-white break-words" ${description ? `data-tooltip-content="${escapeHtml(description)}"` : ''}>${safeOperatorName}</h2>
                            ${name ? `<div class="font-mono text-sm text-gray-400 mt-1 break-words">${createAddressLink(op.id)}</div>` : ''}
                        </div>
                        <div class="flex-shrink-0 text-right"><p class="text-sm text-gray-400 font-semibold mb-1">APY</p><p class="text-4xl font-extrabold text-green-400 whitespace-nowrap mb-4">${Math.round(apy * 100)}%</p></div>
                    </div>
                </div>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-6 mt-6">
                <div><p class="text-sm text-gray-400">Stake (DATA)</p><p id="header-stat-stake" class="text-2xl font-semibold text-white"></p></div>
                <div><p class="text-sm text-gray-400">Total Earnings (DATA)</p><p id="header-stat-earnings" class="text-2xl font-semibold text-white"></p></div>
                <div><p class="text-sm text-gray-400">% Owner's Cut</p><p id="header-stat-cut" class="text-2xl font-semibold text-white"></p></div>
                <div><p class="text-sm text-gray-400">Nodes</p><p id="active-nodes-stats-value" class="text-2xl font-semibold text-white">0</p></div>
            </div>
            <div id="extended-stats" class="hidden mt-6">
                <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
                    <div><p class="text-sm text-gray-400">Total Distributed (DATA)</p><p id="extended-stat-distributed" class="text-2xl font-semibold text-white"></p></div>
                    <div><p class="text-sm text-gray-400">Owner's Earnings from Cut (DATA)</p><p id="extended-stat-owner-cut" class="text-2xl font-semibold text-white"></p></div>
                    <div><p class="text-sm text-gray-400">Deployed Stake (DATA)</p><p id="extended-stat-deployed" class="text-2xl font-semibold text-white"></p></div>
                    <div><p class="text-sm text-gray-400">% Owner's Stake</p><p id="extended-stat-owner-stake" class="text-2xl font-semibold text-white"></p></div>
                </div>
            </div>
            <div class="mt-4 text-center"><button id="toggle-stats-btn" class="text-gray-400 hover:text-white transition"><svg id="stats-arrow" class="w-6 h-6 mx-auto transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 9l-7 7-7-7"></path></svg></button></div>
        </div>
        
        <div class="detail-section p-6 mt-8">
            <div class="flex justify-between items-center mb-4 flex-wrap gap-2">
                <h3 class="text-xl font-semibold text-white">Stake</h3>
                <div id="chart-timeframe-buttons" class="flex items-center gap-1 bg-[#2C2C2C] p-1 rounded-lg">
                    <button data-days="30" class="px-3 py-1 text-xs font-bold rounded-md hover:bg-[#444444] transition">30D</button>
                    <button data-days="90" class="px-3 py-1 text-xs font-bold rounded-md hover:bg-[#444444] transition">90D</button>
                    <button data-days="365" class="px-3 py-1 text-xs font-bold rounded-md hover:bg-[#444444] transition">1Y</button>
                    <button data-days="all" class="px-3 py-1 text-xs font-bold rounded-md hover:bg-[#444444] transition">All</button>
                </div>
            </div>
            <div id="stake-chart-container" class="h-64">
                <canvas id="stake-history-chart"></canvas>
            </div>
        </div>

        <div id="my-stake-section" class="detail-section p-6 hidden">
             <h3 class="text-xl font-semibold text-white mb-4">Your Stake</h3>
             <div class="flex items-center justify-between">
                 <div><p class="text-3xl font-semibold text-white" id="my-stake-value" data-tooltip-value="0">Loading...</p></div>
                 <div class="flex gap-4">
                     <button id="delegate-btn" class="bg-blue-800 hover:bg-blue-900 text-white font-bold py-2 px-6 rounded-lg transition-colors">Delegate</button>
                     <button id="undelegate-btn" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">Undelegate</button>
                 </div>
             </div>
        </div>`;

    const isAgent = globalState.myRealAddress && op.controllers?.some(agent => agent.toLowerCase() === globalState.myRealAddress.toLowerCase());

    const sponsorshipsHtml = op.stakes?.length > 0 ? op.stakes.map(stake => {
        const sp = stake.sponsorship;
        if (!sp) return '';
        const sponsorshipUrl = `https://streamr.network/hub/network/sponsorships/${sp.id}`;
        const sponsorshipDisplayText = escapeHtml(sp.stream?.id || sp.id);
        const editStakeLink = isAgent
            ? `<a href="#" class="block px-4 py-2 text-sm text-gray-200 hover:bg-[#444444] edit-stake-link" data-sponsorship-id="${sp.id}" data-current-stake="${stake.amountWei}">Edit Stake</a>`
            : `<span class="block px-4 py-2 text-sm text-gray-500 opacity-50 cursor-not-allowed" data-tooltip-content="You must be an agent for this operator to edit stake.">Edit Stake</span>`;

        return `
            <li class="relative flex justify-between items-center py-3 border-b border-[#333333]">
                <div class="flex-1 min-w-0">
                    <a href="${sponsorshipUrl}" target="_blank" rel="noopener noreferrer" class="font-mono text-xs text-gray-300 hover:text-white transition-colors truncate block" title="${sponsorshipDisplayText}">${sponsorshipDisplayText}</a>
                    <div class="text-xs mt-2 space-y-1">
                        <div class="flex justify-between items-center"><span class="text-gray-400">Staked:</span><strong class="text-white font-mono" data-tooltip-value="${convertWeiToData(stake.amountWei)}">${formatBigNumber(convertWeiToData(stake.amountWei))} DATA</strong></div>
                        <div class="flex justify-between items-center"><span class="text-gray-400">APY:</span><strong class="text-green-400 font-mono">${Math.round(Number(sp.spotAPY) * 100)}%</strong></div>
                        <div class="flex justify-between items-center"><span class="text-gray-400">Status:</span><strong class="${sp.isRunning ? 'text-green-400' : 'text-red-400'} font-semibold">${sp.isRunning ? 'Active' : 'Inactive'}</strong></div>
                    </div>
                </div>
                <div class="flex-shrink-0 ml-4">
                        <button class="text-gray-400 hover:text-white p-1 toggle-sponsorship-menu-btn" data-sponsorship-id="${sp.id}"><svg class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path d="M7 10l5 5 5-5H7z"/></svg></button>
                    <div id="sponsorship-menu-${sp.id}" class="hidden absolute right-0 w-48 bg-[#2C2C2C] border border-[#333333] rounded-md shadow-lg z-20">
                        ${editStakeLink}
                        <a href="#" class="block px-4 py-2 text-sm text-gray-200 hover:bg-[#444444] collect-earnings-link" data-sponsorship-id="${sp.id}">Collect Earnings</a>
                    </div>
                </div>
            </li>`;
    }).join('') : '<li class="text-gray-500 text-sm">Not participating in any sponsorships.</li>';

    const slashesHtml = slashingEvents.length > 0 ? slashingEvents.map(slash => {
        const sp = slash.sponsorship;
        let sponsorshipHtml = '<p class="text-xs text-gray-400">Sponsorship: Unknown</p>';
        if (sp) {
            const sponsorshipUrl = `https://streamr.network/hub/network/sponsorships/${sp.id}`;
            const sponsorshipDisplayText = escapeHtml(sp.stream?.id || sp.id);
            sponsorshipHtml = `<p class="text-xs text-gray-400 truncate">Sponsorship: <a href="${sponsorshipUrl}" target="_blank" rel="noopener noreferrer" class="text-gray-300 hover:text-white transition-colors" title="${sponsorshipDisplayText}">${sponsorshipDisplayText}</a></p>`;
        }

        return `
            <li class="py-2 border-b border-[#333333]">
                <p class="font-mono text-xs text-red-400 font-semibold" data-tooltip-value="${convertWeiToData(slash.amount)}">${formatBigNumber(convertWeiToData(slash.amount))} DATA</p>
                <div class="text-xs mt-1 text-gray-400">
                    <p>Date: ${new Date(slash.date * 1000).toLocaleDateString()}</p>
                    ${sponsorshipHtml}
                </div>
            </li>`;
        }).join('') : '<li class="text-gray-500 text-sm">No slashing events recorded.</li>';

    const agentsHtml = op.controllers?.length > 0 ? op.controllers.map(agent => `
        <li class="flex justify-between items-center py-2 border-b border-[#333333]">
            <div class="font-mono text-xs text-gray-300 truncate">${createAddressLink(agent)}</div>
            <div class="flex items-center gap-2">
                <span id="agent-balance-${agent}" class="font-mono text-xs text-gray-300 text-right" title="POL Balance">...</span>
                ${op.owner && agent.toLowerCase() === op.owner.toLowerCase() ? `<div class="flex items-center" title="Owner"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd" /></svg></div>` : ''}
            </div>
        </li>`).join('') : '<li class="text-gray-500 text-sm">No agents assigned.</li>';

    const nodesHtml = op.nodes?.length > 0 ? op.nodes.map(nodeId => `
        <li class="flex justify-between items-center py-2 border-b border-[#333333]">
            <div class="font-mono text-xs text-gray-300 truncate">${createAddressLink(nodeId)}</div>
            <span id="node-balance-${nodeId}" class="font-mono text-xs text-gray-300 text-right" title="POL Balance">...</span>
        </li>`).join('') : '<li class="text-gray-500 text-sm">No nodes running.</li>';

    const queueHtml = op.queueEntries?.length > 0 ? op.queueEntries.map(entry => `
            <li class="py-2 border-b border-[#333333]">
            <div class="flex justify-between items-center">
                <div class="font-mono text-xs text-gray-300 truncate">${createAddressLink(entry.delegator.id)}</div>
                <p class="font-mono text-xs text-orange-400 font-semibold" data-tooltip-value="${convertWeiToData(entry.amount)}">${formatBigNumber(convertWeiToData(entry.amount))} DATA</p>
            </div>
            <div class="text-xs mt-1 text-gray-400"><p>Queued: ${new Date(entry.date * 1000).toLocaleString()}</p></div>
        </li>`).join('') : '<li class="text-gray-500 text-sm">The undelegation queue is empty.</li>';

    const createFlagHtml = (flag, isTarget) => {
        const sponsorshipUrl = `https://streamr.network/hub/network/sponsorships/${flag.sponsorship.id}`;
        const sponsorshipDisplayText = escapeHtml(flag.sponsorship.stream?.id || flag.sponsorship.id);
        const votesHtml = flag.votes.map(vote => `
            <li class="flex justify-between items-center text-xs py-1">
                <span>${createEntityLink(vote.voter)}</span>
                <div class="flex items-center gap-2">
                    <span class="font-mono" data-tooltip-value="${convertWeiToData(vote.voterWeight)}">${formatBigNumber(convertWeiToData(vote.voterWeight))}</span>
                    <span class="${vote.votedKick ? 'text-red-400' : 'text-green-400'} font-semibold">${vote.votedKick ? 'Kick' : 'Keep'}</span>
                </div>
            </li>
        `).join('');

        let resultText = flag.result || 'Pending';
        if (resultText.toUpperCase() === 'FAILED' || resultText.toUpperCase() === 'VOTE_FAILED') {
            resultText = 'False Flag';
        }

        const flagPartyText = isTarget
            ? `Flagged by: ${createEntityLink(flag.flagger)}`
            : `Flagged: ${createEntityLink(flag.target)}`;

        return `
            <div class="flex justify-between items-center">
                <div>
                    <p class="text-xs text-gray-400">${flagPartyText}</p>
                    <p class="text-xs text-gray-400 truncate">Sponsorship: <a href="${sponsorshipUrl}" target="_blank" rel="noopener noreferrer" class="text-gray-300 hover:text-white transition-colors" title="${sponsorshipDisplayText}">${sponsorshipDisplayText}</a></p>
                        <p class="text-xs text-gray-400">Result: <span class="font-semibold">${resultText}</span></p>
                </div>
                <button class="text-gray-400 hover:text-white p-1 toggle-vote-list-btn" data-flag-id="${flag.id}"><svg class="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"></path></svg></button>
            </div>
            <ul id="votes-${flag.id}" class="hidden mt-2 pl-4 border-l-2 border-gray-700">${votesHtml || '<li class="text-xs text-gray-500">No votes.</li>'}</ul>`;
    };

    const flagsAgainstHtml = flagsAgainst?.length > 0 ? flagsAgainst.map(flag => `<li class="py-2 border-b border-[#333333]">${createFlagHtml(flag, true)}</li>`).join('') : '<li class="text-gray-500 text-sm">No flags recorded against this operator.</li>';
    const flagsByHtml = flagsAsFlagger?.length > 0 ? flagsAsFlagger.map(flag => `<li class="py-2 border-b border-[#333333]">${createFlagHtml(flag, false)}</li>`).join('') : '<li class="text-gray-500 text-sm">This operator has not flagged anyone.</li>';

    const listsHtml = `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
            <div class="detail-section p-6">
                <div class="flex justify-between items-center mb-4">
                    <h3 id="delegator-queue-title" class="text-xl font-semibold text-white">Delegators</h3>
                    <button id="toggle-delegator-view-btn" title="Switch View" class="text-gray-400 hover:text-white p-1"><svg class="h-5 w-5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg></button>
                </div>
                <div id="delegators-content"><ul id="delegators-list" class="max-h-96 overflow-y-auto pr-2"></ul><div id="delegators-footer" class="mt-4"></div></div>
                <div id="queue-content" class="hidden">
                    ${op.queueEntries?.length > 0 ? `<button id="process-queue-btn" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg text-sm mb-4">Process Queue</button>` : ''}
                    <ul class="max-h-96 overflow-y-auto pr-2">${queueHtml}</ul>
                </div>
            </div>
            <div class="detail-section p-6">
                <div class="flex justify-between items-center mb-4">
                    <h3 id="sponsorships-title" class="text-xl font-semibold text-white">Sponsorships (${op.stakes?.length || 0})</h3>
                    <div class="flex items-center gap-2">
                        <button id="toggle-sponsorship-view-btn" title="Switch View" class="text-gray-400 hover:text-white p-1"><svg class="h-5 w-5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg></button>
                    </div>
                </div>
                <div id="sponsorships-list-content">
                    <ul class="max-h-96 overflow-y-auto pr-2">${sponsorshipsHtml}</ul>
                    <div class="mt-4">
                        ${op.stakes?.length > 0 ? `<button id="collect-all-earnings-btn" class="w-full bg-blue-800 hover:bg-blue-900 text-white font-bold py-2 px-4 rounded-lg text-sm">Collect All</button>` : ''}
                    </div>
                </div>
                <div id="sponsorships-history-content" class="hidden">
                    <ul id="sponsorships-history-list" class="max-h-96 overflow-y-auto pr-2"></ul>
                </div>
            </div>
            <div class="detail-section p-6 lg:col-span-2">
                <div class="flex justify-between items-center mb-4">
                    <h3 id="reputation-title" class="text-xl font-semibold text-white">Slashing Events</h3>
                    <button id="toggle-reputation-view-btn" title="Switch View" class="text-gray-400 hover:text-white p-1"><svg class="h-5 w-5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg></button>
                </div>
                <div id="reputation-content-wrapper" 
                    data-slashes-count="${slashingEvents.length}" 
                    data-flags-against-count="${flagsAgainst?.length || 0}" 
                    data-flags-by-count="${flagsAsFlagger?.length || 0}">
                    <div id="slashing-content"><ul class="max-h-96 overflow-y-auto pr-2">${slashesHtml}</ul></div>
                    <div id="flags-against-content" class="hidden"><ul class="max-h-96 overflow-y-auto pr-2">${flagsAgainstHtml}</ul></div>
                    <div id="flags-by-content" class="hidden"><ul class="max-h-96 overflow-y-auto pr-2">${flagsByHtml}</ul></div>
                </div>
            </div>
            <div class="detail-section p-6 lg:col-span-2">
                <div class="flex justify-between items-center mb-4">
                    <h3 id="wallets-title" class="text-xl font-semibold text-white">Agents</h3>
                    <button id="toggle-wallets-view-btn" title="Switch View" class="text-gray-400 hover:text-white p-1"><svg class="h-5 w-5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg></button>
                </div>
                <div id="agents-content" data-agents-count="${op.controllers?.length || 0}"><ul class="max-h-96 overflow-y-auto pr-2">${agentsHtml}</ul></div>
                <div id="nodes-content" class="hidden" data-nodes-count="${op.nodes?.length || 0}"><ul class="max-h-96 overflow-y-auto pr-2">${nodesHtml}</ul></div>
            </div>
        </div>`;

    const streamHtml = `
        <div class="detail-section p-6 mt-8">
            <div class="flex items-center justify-between mb-4 flex-wrap gap-y-2">
                <h3 class="text-xl font-semibold text-white">Coordination Stream</h3>
                <div class="flex items-center gap-2 text-sm">
                    <div class="flex items-center gap-2" title="Awaiting connection..."><div id="stream-status-indicator" class="w-3 h-3 rounded-full bg-gray-500"></div></div>
                    <div class="bg-[#2C2C2C] text-gray-200 font-semibold px-3 py-1 rounded-lg">Active Nodes: <span id="active-nodes-count-value" class="text-white font-bold">0</span></div>
                    <div id="unreachable-nodes-container" class="hidden bg-[#2C2C2C] text-gray-200 font-semibold px-3 py-1 rounded-lg" title="Nodes that are active but may not be reachable by all peers.">Unreachable: <span id="unreachable-nodes-count-value" class="text-orange-400 font-bold">0</span></div>
                    <div class="bg-[#2C2C2C] text-gray-200 font-semibold px-3 py-1 rounded-lg">Redundancy: <span class="text-white font-bold">${escapeHtml(String(redundancyFactor))}</span></div>
                </div>
            </div>
            <div id="stream-messages-container" class="max-h-96 overflow-y-auto pr-2 bg-black/50 p-2"><div class="text-gray-500 text-sm text-center py-4">Live messages will appear here.</div></div>
        </div>`;


    detailContent.innerHTML = headerStatsHtml + listsHtml + streamHtml;

    // call update and restore states
    updateOperatorDetails(data, globalState);
    updateDelegatorsSection(globalState.currentDelegations, globalState.totalDelegatorCount);

    toggleStatsPanel(true, globalState.uiState);
    if (!globalState.uiState.isDelegatorViewActive) {
        toggleDelegatorQueueView(op, globalState.uiState);
    }
    toggleReputationView(true, globalState.uiState);
    toggleWalletsView(true, globalState.uiState);
    toggleSponsorshipsView(globalState.uiState, op, true);
}


export function updateOperatorDetails(data, globalState) {
    const { operator: op, selfDelegation: selfDelegationData } = data;
    if (!op) return;

    const selfDelegation = selfDelegationData?.[0];

    // --- CALCULATION LOGIC ---

    // 1. Get direct values from The Graph
    const totalStakeWei = BigInt(op.valueWithoutEarnings);
    const totalEarningsWei = BigInt(op.cumulativeEarningsWei);
    const ownerCutWei = BigInt(op.cumulativeOperatorsCutWei);
    const operatorsOwnStakeWei = selfDelegation ? BigInt(selfDelegation._valueDataWei) : 0n;

    // 2. Calculate "Total Distributed" the correct and simple way
    // Total Distributed = Total Earnings - Owner's Earnings from Cut
    const distributedToDelegatorsWei = totalEarningsWei - ownerCutWei;

    // 3. Other calculations (remain the same)
    const ownersCutPercent = (BigInt(op.operatorsCutFraction) * 100n) / BigInt('1000000000000000000');
    const ownersStakePercent = totalStakeWei > 0n ? Number((operatorsOwnStakeWei * 10000n) / totalStakeWei) / 100 : 0;
    const deployedStakeWei = op.stakes?.reduce((sum, stake) => sum + BigInt(stake.amountWei), 0n) || 0n;

    // Convert to DATA for display
    const totalStakeData = convertWeiToData(op.valueWithoutEarnings);
    const totalEarningsData = convertWeiToData(op.cumulativeEarningsWei);
    const ownerCutData = convertWeiToData(op.cumulativeOperatorsCutWei);
    const distributedData = convertWeiToData(distributedToDelegatorsWei.toString());
    const deployedData = convertWeiToData(deployedStakeWei.toString());
    const ownerStakeData = convertWeiToData(operatorsOwnStakeWei.toString());


    // --- UPDATE UI WITH VALUES ---

    // Update Header Stats
    const headerStakeEl = document.getElementById('header-stat-stake');
    if (headerStakeEl) {
        headerStakeEl.textContent = formatBigNumber(totalStakeData);
        headerStakeEl.setAttribute('data-tooltip-value', totalStakeData);
    }

    const headerEarningsEl = document.getElementById('header-stat-earnings');
    if (headerEarningsEl) {
        headerEarningsEl.textContent = formatBigNumber(totalEarningsData);
        headerEarningsEl.setAttribute('data-tooltip-value', totalEarningsData);
    }

    const headerCutEl = document.getElementById('header-stat-cut');
    if (headerCutEl) {
        headerCutEl.textContent = `${ownersCutPercent}%`;
    }

    // Update Extended Stats
    const distributedEl = document.getElementById('extended-stat-distributed');
    if (distributedEl) {
        // Display calculated value
        distributedEl.textContent = formatBigNumber(distributedData);
        distributedEl.setAttribute('data-tooltip-value', distributedData);
    }

    const ownerCutEl = document.getElementById('extended-stat-owner-cut');
    if (ownerCutEl) {
        ownerCutEl.textContent = formatBigNumber(ownerCutData);
        ownerCutEl.setAttribute('data-tooltip-value', ownerCutData);
    }

    const deployedEl = document.getElementById('extended-stat-deployed');
    if (deployedEl) {
        deployedEl.textContent = formatBigNumber(deployedData);
        deployedEl.setAttribute('data-tooltip-value', deployedData);
    }

    const ownerStakeEl = document.getElementById('extended-stat-owner-stake');
    if (ownerStakeEl) {
        ownerStakeEl.textContent = `${Math.round(ownersStakePercent)}%`;
        ownerStakeEl.setAttribute('data-tooltip-content', `${formatBigNumber(ownerStakeData)} DATA`);
    }
}

// --- UI Toggles ---
export function toggleStatsPanel(isRefresh, uiState) {
    if (!isRefresh) {
        uiState.isStatsPanelExpanded = !uiState.isStatsPanelExpanded;
    }

    const extendedStats = document.getElementById('extended-stats');
    const arrow = document.getElementById('stats-arrow');

    if (extendedStats && arrow) {
        if (uiState.isStatsPanelExpanded) {
            extendedStats.classList.remove('hidden');
            arrow.classList.add('rotate-180');
        } else {
            extendedStats.classList.add('hidden');
            arrow.classList.remove('rotate-180');
        }
    }
}

export function toggleDelegatorQueueView(operatorData, uiState) {
    uiState.isDelegatorViewActive = !uiState.isDelegatorViewActive;
    const delegatorsContent = document.getElementById('delegators-content');
    const queueContent = document.getElementById('queue-content');
    const title = document.getElementById('delegator-queue-title');
    if (!operatorData) return;

    delegatorsContent.classList.toggle('hidden');
    queueContent.classList.toggle('hidden');
    title.textContent = uiState.isDelegatorViewActive
        ? `Delegators (${operatorData.delegatorCount > 0 ? operatorData.delegatorCount - 1 : 0})`
        : `Undelegation Queue (${operatorData.queueEntries?.length || 0})`;
}

export function toggleVoteList(flagId) {
    document.getElementById(`votes-${flagId}`)?.classList.toggle('hidden');
}

export function toggleReputationView(isRefresh, uiState) {
    if (!isRefresh) uiState.reputationViewIndex = (uiState.reputationViewIndex + 1) % 3;
    const wrapper = document.getElementById('reputation-content-wrapper');
    if (!wrapper) return;

    const titleEl = document.getElementById('reputation-title');
    const { slashesCount, flagsAgainstCount, flagsByCount } = wrapper.dataset;

    Object.values(wrapper.children).forEach(child => child.classList.add('hidden'));

    if (uiState.reputationViewIndex === 0) {
        titleEl.textContent = `Slashing Events (${slashesCount})`;
        wrapper.children[0].classList.remove('hidden');
    } else if (uiState.reputationViewIndex === 1) {
        titleEl.textContent = `Flags Against Operator (${flagsAgainstCount})`;
        wrapper.children[1].classList.remove('hidden');
    } else {
        titleEl.textContent = `Flags Initiated by Operator (${flagsByCount})`;
        wrapper.children[2].classList.remove('hidden');
    }
}

export function toggleWalletsView(isRefresh, uiState) {
    if (!isRefresh) uiState.walletViewIndex = (uiState.walletViewIndex + 1) % 2;
    const agentsContent = document.getElementById('agents-content');
    const nodesContent = document.getElementById('nodes-content');
    if (!agentsContent || !nodesContent) return;

    const titleEl = document.getElementById('wallets-title');
    const { agentsCount } = agentsContent.dataset;
    const { nodesCount } = nodesContent.dataset;

    agentsContent.classList.add('hidden');
    nodesContent.classList.add('hidden');

    if (uiState.walletViewIndex === 0) {
        titleEl.textContent = `Agents (${agentsCount})`;
        agentsContent.classList.remove('hidden');
    } else {
        titleEl.textContent = `Node Wallets (${nodesCount})`;
        nodesContent.classList.remove('hidden');
    }
}

export function toggleSponsorshipsView(uiState, operatorData, isRefresh = false) {
    if (!isRefresh) {
        uiState.isSponsorshipsListViewActive = !uiState.isSponsorshipsListViewActive;
    }
    const listContent = document.getElementById('sponsorships-list-content');
    const historyContent = document.getElementById('sponsorships-history-content');
    const title = document.getElementById('sponsorships-title');

    if (!listContent || !historyContent || !title || !operatorData) return;

    listContent.classList.toggle('hidden', !uiState.isSponsorshipsListViewActive);
    historyContent.classList.toggle('hidden', uiState.isSponsorshipsListViewActive);

    title.textContent = uiState.isSponsorshipsListViewActive
        ? `Sponsorships (${operatorData.stakes?.length || 0})`
        : 'History';
}

export function updateChartTimeframeButtons(days) {
    const buttons = document.querySelectorAll('#chart-timeframe-buttons button');
    buttons.forEach(button => {
        if (button.dataset.days === String(days)) {
            button.classList.add('bg-blue-800', 'text-white');
            button.classList.remove('hover:bg-[#444444]');
        } else {
            button.classList.remove('bg-blue-800', 'text-white');
            button.classList.add('hover:bg-[#444444]');
        }
    });
}


export function addStreamMessageToUI(message, activeNodes, unreachableNodes) {
    const messagesContainerEl = document.getElementById('stream-messages-container');
    if (!messagesContainerEl) return;

    if (message?.msgType === 'heartbeat' && message?.peerDescriptor?.nodeId) {
        const nodeId = message.peerDescriptor.nodeId;
        if (!activeNodes.has(nodeId)) {
            activeNodes.add(nodeId);
            document.getElementById('active-nodes-count-value').textContent = activeNodes.size;
            document.getElementById('active-nodes-stats-value').textContent = activeNodes.size;
        }
        if (message.peerDescriptor?.websocket?.tls === false && !unreachableNodes.has(nodeId)) {
            unreachableNodes.add(nodeId);
            const unreachableContainer = document.getElementById('unreachable-nodes-container');
            unreachableContainer.querySelector('span').textContent = unreachableNodes.size;
            unreachableContainer.classList.remove('hidden');
        }
    }

    const placeholder = messagesContainerEl.querySelector('.text-gray-500');
    if (placeholder) placeholder.remove();

    const messageWrapper = document.createElement('div');
    messageWrapper.className = 'stream-message-entry py-2 border-t border-[#333333]/50 first:border-t-0';
    messageWrapper.innerHTML = `
        <div class="flex justify-between items-center text-xs text-gray-400 mb-1">
            <span class="font-mono">${new Date().toLocaleTimeString()}</span>
        </div>
        <pre class="whitespace-pre-wrap break-all text-xs text-gray-400"><code>${escapeHtml(JSON.stringify(message, null, 2))}</code></pre>`;

    messagesContainerEl.prepend(messageWrapper);
    while (messagesContainerEl.children.length > 20) { // MAX_STREAM_MESSAGES
        messagesContainerEl.removeChild(messagesContainerEl.lastChild);
    }
}





