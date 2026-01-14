/**
 * Streams Feature Module
 * Handles the streams list view with Sponsored and Non-Sponsored streams tables
 */

import * as Utils from '../core/utils.js';
import * as UI from '../ui/ui.js';
import * as Services from '../core/services.js';
import { getOperatorProfile } from '../core/profile.js';

const { logger } = Utils;

// ============================================
// Constants
// ============================================

const STREAMS_PER_PAGE = 25;

// ============================================
// State Management
// ============================================

const state = {
    // Sponsored streams
    sponsoredStreams: [],
    sponsoredSkip: 0,
    hasMoreSponsored: true,
    sponsoredLoading: false,
    
    // Expired sponsorships
    expiredStreams: [],
    expiredSkip: 0,
    hasMoreExpired: true,
    expiredLoading: false,
    showExpired: false, // Toggle state for expired sponsorships
    
    // Non-sponsored streams
    nonSponsoredStreams: [],
    nonSponsoredSkip: 0,
    hasMoreNonSponsored: true,
    nonSponsoredLoading: false,
    
    // Shared state
    dataPriceUSD: null,
    
    // Active tab
    activeTab: 'sponsored',
};

// ============================================
// Data Fetching
// ============================================

/**
 * Fetch sponsored streams (streams with active sponsorships, ordered by Payout desc)
 */
async function fetchSponsoredStreams(skip = 0) {
    const query = `
        query GetSponsoredStreams {
            sponsorships(
                first: ${STREAMS_PER_PAGE},
                skip: ${skip},
                orderBy: totalPayoutWeiPerSec,
                orderDirection: desc,
                where: { isRunning: true, spotAPY_gt: "0" }
            ) {
                id
                spotAPY
                totalStakedWei
                remainingWei
                operatorCount
                isRunning
                totalPayoutWeiPerSec
                stream {
                    id
                    metadata
                }
                stakes(first: 100, orderBy: amountWei, orderDirection: desc) {
                    operator {
                        id
                        metadataJsonString
                    }
                    amountWei
                }
            }
        }
    `;
    
    const data = await Services.runQuery(query);
    return data.sponsorships || [];
}

/**
 * Fetch expired sponsorships (streams with expired sponsorships, ordered by totalPayoutWeiPerSec desc)
 */
async function fetchExpiredSponsorships(skip = 0) {
    const query = `
        query GetExpiredSponsorships {
            sponsorships(
                first: ${STREAMS_PER_PAGE},
                skip: ${skip},
                orderBy: totalPayoutWeiPerSec,
                orderDirection: desc,
                where: { isRunning: false }
            ) {
                id
                spotAPY
                totalStakedWei
                remainingWei
                operatorCount
                isRunning
                totalPayoutWeiPerSec
                stream {
                    id
                    metadata
                }
                stakes(first: 100, orderBy: amountWei, orderDirection: desc) {
                    operator {
                        id
                        metadataJsonString
                    }
                    amountWei
                }
            }
        }
    `;
    
    const data = await Services.runQuery(query);
    return data.sponsorships || [];
}

/**
 * Fetch non-sponsored streams (streams without ANY sponsorships, ordered by updatedAt desc)
 */
async function fetchNonSponsoredStreams(skip = 0) {
    // Get recent streams and filter out those with sponsorships
    const query = `
        query GetRecentStreams {
            streams(
                first: ${STREAMS_PER_PAGE * 3},
                skip: ${skip},
                orderBy: updatedAt,
                orderDirection: desc
            ) {
                id
                createdAt
                updatedAt
                metadata
                sponsorships(first: 1) {
                    id
                }
            }
        }
    `;
    
    try {
        const data = await Services.runQuery(query);
        // Filter out streams with ANY sponsorships (active or expired)
        const filtered = (data.streams || [])
            .filter(s => !s.sponsorships || s.sponsorships.length === 0)
            .slice(0, STREAMS_PER_PAGE);
        return filtered;
    } catch (error) {
        logger.error('Failed to fetch non-sponsored streams:', error);
        return [];
    }
}

// ============================================
// Stream Detail Data Fetching
// ============================================

// Detail view state
const detailState = {
    currentStreamId: null,
    currentSponsorshipId: null,
    isSponsored: false,
    subscription: null,
    subscriptions: [], // For subscribing to multiple partitions
    messageCount: 0,
    messageTimestamps: [],
    bytesReceived: 0,
    bytesTimestamps: [], // {timestamp, bytes} for KB/s calculation
    partitions: 1, // Number of partitions in the stream
    // Unified chart state
    chart: null,
    chartData: null,
    currentChartType: 'apy',
    currentViewMode: 'data',
    currentTimeframe: 'all'
};

/**
 * Fetch complete stream details including permissions
 */
async function fetchStreamDetails(streamId) {
    // Escape quotes in stream ID for safe interpolation
    const sanitizedId = streamId.replace(/"/g, '\\"');
    
    const query = `
        query GetStreamDetails {
            stream(id: "${sanitizedId}") {
                id
                metadata
                createdAt
                updatedAt
                permissions(first: 100) {
                    id
                    userAddress
                    canEdit
                    canDelete
                    publishExpiration
                    subscribeExpiration
                    canGrant
                }
                sponsorships(first: 10, orderBy: spotAPY, orderDirection: desc) {
                    id
                    spotAPY
                    totalStakedWei
                    remainingWei
                    cumulativeSponsoring
                    totalPayoutWeiPerSec
                    minimumStakingPeriodSeconds
                    projectedInsolvency
                    operatorCount
                    isRunning
                    stakes(first: 100, orderBy: amountWei, orderDirection: desc) {
                        operator {
                            id
                            metadataJsonString
                        }
                        amountWei
                    }
                    sponsoringEvents(first: 50, orderBy: date, orderDirection: desc) {
                        id
                        sponsor
                        amount
                        date
                    }
                }
            }
        }
    `;
    
    const data = await Services.runQuery(query);
    return data.stream;
}

/**
 * Fetch sponsorship daily buckets for charts
 */
async function fetchSponsorshipDailyData(sponsorshipId) {
    const query = `
        query GetSponsorshipDailyData {
            sponsorshipDailyBuckets(
                first: 90,
                orderBy: date,
                orderDirection: desc,
                where: { sponsorship: "${sponsorshipId}" }
            ) {
                id
                date
                spotAPY
                totalStakedWei
                operatorCount
            }
        }
    `;
    
    const data = await Services.runQuery(query);
    return (data.sponsorshipDailyBuckets || []).reverse();
}

/**
 * Determine access control type based on permissions
 * Returns: 'public-all', 'public-subscribe', 'private'
 */
function determineAccessControl(permissions) {
    if (!permissions || permissions.length === 0) {
        // No permissions set = default public subscribe
        return 'public-subscribe';
    }
    
    // Check for public permissions (address = 0x0000...)
    const publicPermission = permissions.find(p => 
        p.userAddress && p.userAddress.toLowerCase() === '0x0000000000000000000000000000000000000000'
    );
    
    if (publicPermission) {
        const hasPublicPublish = publicPermission.publishExpiration && 
            parseInt(publicPermission.publishExpiration) > Math.floor(Date.now() / 1000);
        const hasPublicSubscribe = publicPermission.subscribeExpiration && 
            parseInt(publicPermission.subscribeExpiration) > Math.floor(Date.now() / 1000);
        
        if (hasPublicPublish && hasPublicSubscribe) {
            return 'public-all';
        } else if (hasPublicSubscribe) {
            return 'public-subscribe';
        }
    }
    
    return 'private';
}

/**
 * Get access control badge HTML
 */
function getAccessControlBadge(accessType) {
    const configs = {
        'public-all': {
            text: 'Public (Publish & Subscribe)',
            icon: `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>`,
            classes: 'bg-green-500/20 text-green-400 border-green-500/30'
        },
        'public-subscribe': {
            text: 'Public (Subscribe Only)',
            icon: `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
            </svg>`,
            classes: 'bg-blue-500/20 text-blue-400 border-blue-500/30'
        },
        'private': {
            text: 'Private',
            icon: `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
            </svg>`,
            classes: 'bg-red-500/20 text-red-400 border-red-500/30'
        }
    };
    
    const config = configs[accessType] || configs['private'];
    return `<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${config.classes} text-sm font-medium">
        ${config.icon}
        ${config.text}
    </span>`;
}

// ============================================
// Rendering
// ============================================

/**
 * Create HTML for a sponsored stream row
 */
function createSponsoredStreamRowHtml(sponsorship, index) {
    const streamId = sponsorship.stream?.id || 'Unknown Stream';
    const displayStreamId = streamId.length > 50 ? streamId.substring(0, 47) + '...' : streamId;
    const apy = parseFloat(sponsorship.spotAPY || 0);
    const apyFormatted = Math.round(apy * 100);
    const totalStaked = Utils.convertWeiToData(sponsorship.totalStakedWei || '0');
    const operatorCount = sponsorship.operatorCount || 0;
    const isExpired = !sponsorship.isRunning;
    
    // Calculate payout rate in DATA/day
    const payoutWeiPerSec = BigInt(sponsorship.totalPayoutWeiPerSec || '0');
    const payoutWeiPerDay = payoutWeiPerSec * BigInt(86400);
    const payoutPerDay = Utils.convertWeiToData(payoutWeiPerDay.toString());
    const payoutPerDayFormatted = Utils.formatBigNumber(parseFloat(payoutPerDay));
    
    // Encode the stream ID for URL - preserve slashes but encode other special chars
    // Use encodeURI to keep slashes intact
    const encodedStreamId = streamId.split('/').map(part => encodeURIComponent(part)).join('/');
    const sponsorshipId = sponsorship.id;
    
    // Badge for expired sponsorships
    const expiredBadge = isExpired ? '<span class="ml-2 px-1.5 py-0.5 text-[10px] font-semibold bg-orange-500/20 text-orange-400 rounded">EXPIRED</span>' : '';
    
    // Row styling for expired
    const rowClasses = isExpired ? 'stream-row cursor-pointer hover:bg-white/5 transition-colors group opacity-70' : 'stream-row cursor-pointer hover:bg-white/5 transition-colors group';
    
    return `
        <tr class="${rowClasses}" 
            data-stream-id="${Utils.escapeHtml(streamId)}" 
            data-sponsorship-id="${sponsorshipId}"
            data-sponsored="true"
            data-expired="${isExpired}"
            onclick="event.preventDefault(); window.router.navigate('/stream/${encodedStreamId}?sponsored=true&sponsorshipId=${sponsorshipId}')">
            <td class="px-4 py-3">
                <span class="font-mono text-sm group-hover:text-blue-400 transition-colors" title="${Utils.escapeHtml(streamId)}">${Utils.escapeHtml(displayStreamId)}</span>${expiredBadge}
            </td>
            <td class="px-4 py-3 text-right font-mono text-gray-300 whitespace-nowrap">${payoutPerDayFormatted}</td>
            <td class="px-4 py-3 text-right font-mono text-gray-300 whitespace-nowrap">${apyFormatted}%</td>
            <td class="px-4 py-3 text-right font-mono text-gray-300 whitespace-nowrap">${Utils.formatBigNumber(totalStaked)}</td>
            <td class="px-4 py-3 text-right font-mono text-gray-300 whitespace-nowrap">${operatorCount}</td>
        </tr>
    `;
}

/**
 * Create HTML for a non-sponsored stream row
 */
function createNonSponsoredStreamRowHtml(stream, index) {
    const streamId = stream.id || 'Unknown Stream';
    const displayStreamId = streamId.length > 50 ? streamId.substring(0, 47) + '...' : streamId;
    const createdAt = stream.createdAt ? new Date(parseInt(stream.createdAt) * 1000).toLocaleDateString() : 'N/A';
    const updatedAt = stream.updatedAt ? new Date(parseInt(stream.updatedAt) * 1000).toLocaleDateString() : 'N/A';
    
    // Parse partitions from metadata
    let partitions = 1;
    try {
        if (stream.metadata) {
            const meta = JSON.parse(stream.metadata);
            partitions = meta.partitions || 1;
        }
    } catch (e) { /* ignore */ }
    
    // Encode the stream ID for URL - preserve slashes but encode other special chars
    const encodedStreamId = streamId.split('/').map(part => encodeURIComponent(part)).join('/');
    
    return `
        <tr class="stream-row cursor-pointer hover:bg-white/5 transition-colors group" 
            data-stream-id="${Utils.escapeHtml(streamId)}"
            data-sponsored="false"
            onclick="event.preventDefault(); window.router.navigate('/stream/${encodedStreamId}')">
            <td class="px-4 py-3">
                <span class="font-mono text-sm group-hover:text-blue-400 transition-colors" title="${Utils.escapeHtml(streamId)}">${Utils.escapeHtml(displayStreamId)}</span>
            </td>
            <td class="px-4 py-3 text-center text-gray-400 whitespace-nowrap">${partitions}</td>
            <td class="px-4 py-3 text-right text-gray-400 whitespace-nowrap">${createdAt}</td>
            <td class="px-4 py-3 text-right text-gray-400 whitespace-nowrap">${updatedAt}</td>
        </tr>
    `;
}

/**
 * Render sponsored streams table
 */
function renderSponsoredStreamsTable(streams, isAppend = false) {
    const tbody = document.getElementById('sponsored-streams-tbody');
    const loadMoreBtn = document.getElementById('load-more-sponsored-btn');
    const emptyState = document.getElementById('sponsored-streams-empty');
    
    if (!tbody) return;
    
    if (!isAppend) {
        tbody.innerHTML = '';
    }
    
    if (streams.length === 0 && !isAppend) {
        if (emptyState) emptyState.classList.remove('hidden');
        if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
        return;
    }
    
    if (emptyState) emptyState.classList.add('hidden');
    
    const startIndex = isAppend ? state.sponsoredStreams.length - streams.length : 0;
    const html = streams.map((s, i) => createSponsoredStreamRowHtml(s, startIndex + i)).join('');
    
    if (isAppend) {
        tbody.insertAdjacentHTML('beforeend', html);
    } else {
        tbody.innerHTML = html;
    }
    
    // Update load more button
    if (loadMoreBtn) {
        loadMoreBtn.classList.toggle('hidden', !state.hasMoreSponsored);
    }
}

/**
 * Render non-sponsored streams table
 */
function renderNonSponsoredStreamsTable(streams, isAppend = false) {
    const tbody = document.getElementById('nonsponsored-streams-tbody');
    const loadMoreBtn = document.getElementById('load-more-nonsponsored-btn');
    const emptyState = document.getElementById('nonsponsored-streams-empty');
    
    if (!tbody) return;
    
    if (!isAppend) {
        tbody.innerHTML = '';
    }
    
    if (streams.length === 0 && !isAppend) {
        if (emptyState) emptyState.classList.remove('hidden');
        if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
        return;
    }
    
    if (emptyState) emptyState.classList.add('hidden');
    
    const startIndex = isAppend ? state.nonSponsoredStreams.length - streams.length : 0;
    const html = streams.map((s, i) => createNonSponsoredStreamRowHtml(s, startIndex + i)).join('');
    
    if (isAppend) {
        tbody.insertAdjacentHTML('beforeend', html);
    } else {
        tbody.innerHTML = html;
    }
    
    // Update load more button
    if (loadMoreBtn) {
        loadMoreBtn.classList.toggle('hidden', !state.hasMoreNonSponsored);
    }
}

// ============================================
// Event Handlers
// ============================================

/**
 * Switch between tabs
 */
function switchTab(tab) {
    state.activeTab = tab;
    
    const sponsoredTab = document.getElementById('streams-tab-sponsored');
    const nonSponsoredTab = document.getElementById('streams-tab-nonsponsored');
    const sponsoredPanel = document.getElementById('streams-panel-sponsored');
    const nonSponsoredPanel = document.getElementById('streams-panel-nonsponsored');
    const sponsoredCount = document.getElementById('streams-tab-sponsored-count');
    const nonSponsoredCount = document.getElementById('streams-tab-nonsponsored-count');
    
    // Safety check - if elements don't exist yet, skip UI updates
    if (!sponsoredTab || !nonSponsoredTab || !sponsoredPanel || !nonSponsoredPanel) {
        return;
    }
    
    if (tab === 'sponsored') {
        // Update sponsored tab to active
        sponsoredTab.classList.remove('text-gray-400', 'border-transparent', 'hover:border-gray-600');
        sponsoredTab.classList.add('text-white', 'border-blue-500', 'bg-gradient-to-t', 'from-blue-500/10', 'to-transparent');
        if (sponsoredCount) {
            sponsoredCount.classList.remove('bg-gray-500/20', 'text-gray-400');
            sponsoredCount.classList.add('bg-green-500/20', 'text-green-400');
        }
        
        // Update non-sponsored tab to inactive
        nonSponsoredTab.classList.remove('text-white', 'border-blue-500', 'bg-gradient-to-t', 'from-blue-500/10', 'to-transparent');
        nonSponsoredTab.classList.add('text-gray-400', 'border-transparent', 'hover:border-gray-600');
        if (nonSponsoredCount) {
            nonSponsoredCount.classList.remove('bg-green-500/20', 'text-green-400');
            nonSponsoredCount.classList.add('bg-gray-500/20', 'text-gray-400');
        }
        
        // Show/hide panels
        sponsoredPanel.classList.remove('hidden');
        nonSponsoredPanel.classList.add('hidden');
    } else {
        // Update non-sponsored tab to active
        nonSponsoredTab.classList.remove('text-gray-400', 'border-transparent', 'hover:border-gray-600');
        nonSponsoredTab.classList.add('text-white', 'border-blue-500', 'bg-gradient-to-t', 'from-blue-500/10', 'to-transparent');
        if (nonSponsoredCount) {
            nonSponsoredCount.classList.remove('bg-gray-500/20', 'text-gray-400');
            nonSponsoredCount.classList.add('bg-green-500/20', 'text-green-400');
        }
        
        // Update sponsored tab to inactive
        sponsoredTab.classList.remove('text-white', 'border-blue-500', 'bg-gradient-to-t', 'from-blue-500/10', 'to-transparent');
        sponsoredTab.classList.add('text-gray-400', 'border-transparent', 'hover:border-gray-600');
        if (sponsoredCount) {
            sponsoredCount.classList.remove('bg-green-500/20', 'text-green-400');
            sponsoredCount.classList.add('bg-gray-500/20', 'text-gray-400');
        }
        
        // Show/hide panels
        nonSponsoredPanel.classList.remove('hidden');
        sponsoredPanel.classList.add('hidden');
    }
}

/**
 * Update tab counters
 */
function updateTabCounters() {
    const sponsoredCount = document.getElementById('streams-tab-sponsored-count');
    const nonSponsoredCount = document.getElementById('streams-tab-nonsponsored-count');
    
    if (sponsoredCount) {
        // Include expired count if toggle is on
        const totalSponsored = state.showExpired 
            ? state.sponsoredStreams.length + state.expiredStreams.length 
            : state.sponsoredStreams.length;
        const hasMore = state.showExpired 
            ? (state.hasMoreSponsored || state.hasMoreExpired) 
            : state.hasMoreSponsored;
        sponsoredCount.textContent = totalSponsored + (hasMore ? '+' : '');
    }
    if (nonSponsoredCount) {
        nonSponsoredCount.textContent = state.nonSponsoredStreams.length + (state.hasMoreNonSponsored ? '+' : '');
    }
}

/**
 * Handle load more sponsored streams
 */
async function handleLoadMoreSponsored() {
    // Check if we're in expired mode
    if (state.showExpired) {
        // In expired mode, we can load more if either has more
        if (state.sponsoredLoading || state.expiredLoading) return;
        if (!state.hasMoreSponsored && !state.hasMoreExpired) return;
    } else {
        if (state.sponsoredLoading || !state.hasMoreSponsored) return;
    }
    
    const btn = document.getElementById('load-more-sponsored-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<div class="w-4 h-4 border-2 border-white rounded-full border-t-transparent animate-spin inline-block mr-2"></div>Loading...';
    }
    
    state.sponsoredLoading = true;
    
    try {
        // Load more sponsored streams if available
        if (state.hasMoreSponsored) {
            const newStreams = await fetchSponsoredStreams(state.sponsoredSkip);
            
            if (newStreams.length < STREAMS_PER_PAGE) {
                state.hasMoreSponsored = false;
            }
            
            state.sponsoredStreams = [...state.sponsoredStreams, ...newStreams];
            state.sponsoredSkip += newStreams.length;
        }
        
        // In expired mode, also load more expired if available
        if (state.showExpired && state.hasMoreExpired) {
            state.expiredLoading = true;
            const newExpired = await fetchExpiredSponsorships(state.expiredSkip);
            
            if (newExpired.length < STREAMS_PER_PAGE) {
                state.hasMoreExpired = false;
            }
            
            state.expiredStreams = [...state.expiredStreams, ...newExpired];
            state.expiredSkip += newExpired.length;
            state.expiredLoading = false;
        }
        
        // Re-render the table
        if (state.showExpired) {
            const combined = [...state.sponsoredStreams, ...state.expiredStreams];
            renderSponsoredStreamsTable(combined, false);
            // Update button visibility
            if (btn) {
                btn.classList.toggle('hidden', !state.hasMoreSponsored && !state.hasMoreExpired);
            }
        } else {
            renderSponsoredStreamsTable(state.sponsoredStreams, false);
        }
        
        updateTabCounters();
    } catch (error) {
        logger.error('Failed to load more sponsored streams:', error);
        UI.showToast({ type: 'error', title: 'Error', message: 'Failed to load more streams' });
    } finally {
        state.sponsoredLoading = false;
        state.expiredLoading = false;
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Load More';
        }
    }
}

/**
 * Handle load more non-sponsored streams
 */
async function handleLoadMoreNonSponsored() {
    if (state.nonSponsoredLoading || !state.hasMoreNonSponsored) return;
    
    const btn = document.getElementById('load-more-nonsponsored-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<div class="w-4 h-4 border-2 border-white rounded-full border-t-transparent animate-spin inline-block mr-2"></div>Loading...';
    }
    
    state.nonSponsoredLoading = true;
    
    try {
        const newStreams = await fetchNonSponsoredStreams(state.nonSponsoredSkip);
        
        if (newStreams.length < STREAMS_PER_PAGE) {
            state.hasMoreNonSponsored = false;
        }
        
        state.nonSponsoredStreams = [...state.nonSponsoredStreams, ...newStreams];
        state.nonSponsoredSkip += newStreams.length;
        
        renderNonSponsoredStreamsTable(newStreams, true);
        updateTabCounters();
    } catch (error) {
        logger.error('Failed to load more non-sponsored streams:', error);
        UI.showToast({ type: 'error', title: 'Error', message: 'Failed to load more streams' });
    } finally {
        state.nonSponsoredLoading = false;
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Load More';
        }
    }
}

/**
 * Handle expired sponsorships toggle
 */
async function handleExpiredToggle(event) {
    state.showExpired = event.target.checked;
    
    const tbody = document.getElementById('sponsored-streams-tbody');
    const loadMoreBtn = document.getElementById('load-more-sponsored-btn');
    
    if (state.showExpired) {
        // Load expired sponsorships if not already loaded
        if (state.expiredStreams.length === 0) {
            UI.showLoader(true);
            try {
                const expired = await fetchExpiredSponsorships(0);
                state.expiredStreams = expired;
                state.expiredSkip = expired.length;
                state.hasMoreExpired = expired.length >= STREAMS_PER_PAGE;
            } catch (error) {
                logger.error('Failed to load expired sponsorships:', error);
                UI.showToast({ type: 'error', title: 'Error', message: 'Failed to load expired sponsorships' });
            } finally {
                UI.showLoader(false);
            }
        }
        
        // Combine active and expired sponsorships for rendering
        const combined = [...state.sponsoredStreams, ...state.expiredStreams];
        renderSponsoredStreamsTable(combined, false);
        
        // Update load more button logic
        if (loadMoreBtn) {
            loadMoreBtn.classList.toggle('hidden', !state.hasMoreSponsored && !state.hasMoreExpired);
        }
    } else {
        // Show only active sponsorships
        renderSponsoredStreamsTable(state.sponsoredStreams, false);
        
        if (loadMoreBtn) {
            loadMoreBtn.classList.toggle('hidden', !state.hasMoreSponsored);
        }
    }
    
    updateTabCounters();
}

// ============================================
// Public API
// ============================================

export const StreamsLogic = {
    /**
     * Get current state
     */
    getState() {
        return { ...state };
    },
    
    /**
     * Set shared state from main.js
     */
    setSharedState(sharedState) {
        if (sharedState.dataPriceUSD !== undefined) {
            state.dataPriceUSD = sharedState.dataPriceUSD;
        }
    },
    
    /**
     * Initialize the streams view
     */
    async init() {
        logger.log('StreamsLogic: Initializing...');
        
        // Reset state
        state.sponsoredStreams = [];
        state.nonSponsoredStreams = [];
        state.expiredStreams = [];
        state.sponsoredSkip = 0;
        state.nonSponsoredSkip = 0;
        state.expiredSkip = 0;
        state.hasMoreSponsored = true;
        state.hasMoreNonSponsored = true;
        state.hasMoreExpired = true;
        state.showExpired = false;
        state.sponsoredLoading = false;
        state.nonSponsoredLoading = false;
        state.expiredLoading = false;
        state.activeTab = 'sponsored';
        
        // Reset expired toggle UI
        const expiredToggle = document.getElementById('streams-show-expired-toggle');
        if (expiredToggle) {
            expiredToggle.checked = false;
        }
        
        // Reset UI to default tab
        switchTab('sponsored');
        
        // Show loading state
        UI.showLoader(true);
        
        try {
            // Fetch both lists in parallel
            const [sponsored, nonSponsored] = await Promise.all([
                fetchSponsoredStreams(0),
                fetchNonSponsoredStreams(0)
            ]);
            
            state.sponsoredStreams = sponsored;
            state.nonSponsoredStreams = nonSponsored;
            state.sponsoredSkip = sponsored.length;
            state.nonSponsoredSkip = nonSponsored.length;
            
            if (sponsored.length < STREAMS_PER_PAGE) {
                state.hasMoreSponsored = false;
            }
            if (nonSponsored.length < STREAMS_PER_PAGE) {
                state.hasMoreNonSponsored = false;
            }
            
            // Render tables
            renderSponsoredStreamsTable(sponsored, false);
            renderNonSponsoredStreamsTable(nonSponsored, false);
            
            // Update tab counters
            updateTabCounters();
            
            logger.log(`StreamsLogic: Loaded ${sponsored.length} sponsored, ${nonSponsored.length} non-sponsored streams`);
        } catch (error) {
            logger.error('StreamsLogic: Failed to initialize:', error);
            UI.showToast({ type: 'error', title: 'Error', message: 'Failed to load streams' });
        } finally {
            UI.showLoader(false);
        }
    },
    
    /**
     * Setup event listeners
     */
    setupEventListeners() {
        const loadMoreSponsoredBtn = document.getElementById('load-more-sponsored-btn');
        const loadMoreNonSponsoredBtn = document.getElementById('load-more-nonsponsored-btn');
        const sponsoredTab = document.getElementById('streams-tab-sponsored');
        const nonSponsoredTab = document.getElementById('streams-tab-nonsponsored');
        
        if (loadMoreSponsoredBtn) {
            loadMoreSponsoredBtn.addEventListener('click', handleLoadMoreSponsored);
        }
        
        if (loadMoreNonSponsoredBtn) {
            loadMoreNonSponsoredBtn.addEventListener('click', handleLoadMoreNonSponsored);
        }
        
        if (sponsoredTab) {
            sponsoredTab.addEventListener('click', () => switchTab('sponsored'));
        }
        
        if (nonSponsoredTab) {
            nonSponsoredTab.addEventListener('click', () => switchTab('nonsponsored'));
        }
        
        // Expired sponsorships toggle
        const expiredToggle = document.getElementById('streams-show-expired-toggle');
        if (expiredToggle) {
            expiredToggle.addEventListener('change', handleExpiredToggle);
        }
    },
    
    /**
     * Stop/cleanup module
     */
    stop() {
        logger.log('StreamsLogic: Stopping...');
        stopStreamPlayer();
        
        // Destroy chart if exists
        if (detailState.chart) {
            detailState.chart.destroy();
            detailState.chart = null;
        }
        detailState.chartData = null;
        
        // Reset listener flags for next time
        chartListenersSetup = false;
        playerListenersSetup = false;
        
        // Hide operator stake button
        const stakeActionContainer = document.getElementById('stream-operator-stake-action');
        if (stakeActionContainer) stakeActionContainer.classList.add('hidden');
        
        // Hide stake modal if open
        const stakeModal = document.getElementById('stakeModal');
        if (stakeModal) stakeModal.classList.add('hidden');
        
        // Clear stake modal state
        currentSponsorshipForStake = null;
    },
    
    /**
     * Load and display stream detail view
     */
    async loadStreamDetail(streamId, isSponsored = false, sponsorshipId = null) {
        logger.log(`StreamsLogic: Loading stream detail for ${streamId}`);
        
        detailState.currentStreamId = streamId;
        detailState.currentSponsorshipId = sponsorshipId;
        detailState.isSponsored = isSponsored;
        
        UI.showLoader(true);
        
        try {
            const stream = await fetchStreamDetails(streamId);
            
            if (!stream) {
                throw new Error('Stream not found');
            }
            
            // Render stream details
            renderStreamDetail(stream, isSponsored, sponsorshipId);
            
            // If sponsored, load charts data
            if (isSponsored && stream.sponsorships && stream.sponsorships.length > 0) {
                const targetSponsorship = sponsorshipId 
                    ? stream.sponsorships.find(s => s.id === sponsorshipId) || stream.sponsorships[0]
                    : stream.sponsorships[0];
                    
                const dailyData = await fetchSponsorshipDailyData(targetSponsorship.id);
                renderSponsorshipCharts(dailyData);
            }
            
        } catch (error) {
            logger.error('StreamsLogic: Failed to load stream detail:', error);
            UI.showToast({ type: 'error', title: 'Error', message: 'Failed to load stream details' });
        } finally {
            UI.showLoader(false);
        }
    },
    
    /**
     * Get detail state for external access
     */
    getDetailState() {
        return { ...detailState };
    }
};

// ============================================
// Stream Detail Rendering
// ============================================

/**
 * Render the stream detail view
 */
function renderStreamDetail(stream, isSponsored, sponsorshipId) {
    // Helper for safe text setting
    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };
    const setHtml = (id, html) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    };
    
    // Parse metadata
    let metadata = {};
    let partitions = 1;
    let description = '';
    
    try {
        if (stream.metadata) {
            metadata = JSON.parse(stream.metadata);
            partitions = metadata.partitions || 1;
            description = metadata.description || '';
        }
    } catch (e) { /* ignore */ }
    
    // Store partitions in state for player
    detailState.partitions = partitions;
    
    // Stream title/name
    const streamName = metadata.name || stream.id.split('/').pop() || 'Unknown Stream';
    setText('stream-detail-title', streamName);
    setText('stream-detail-id', stream.id);
    
    // Partitions
    setText('stream-partitions', partitions);
    
    // Initialize partition selector for Live Data Viewer
    initializePartitionSelector(partitions);
    
    // Created/Updated
    setText('stream-created', stream.createdAt 
        ? new Date(parseInt(stream.createdAt) * 1000).toLocaleDateString() 
        : 'N/A');
    setText('stream-updated', stream.updatedAt 
        ? new Date(parseInt(stream.updatedAt) * 1000).toLocaleDateString() 
        : 'N/A');
    
    // Access Control
    const accessType = determineAccessControl(stream.permissions);
    setHtml('stream-access-control', getAccessControlBadge(accessType));
    
    // Description
    const descPanel = document.getElementById('stream-description-panel');
    if (description) {
        descPanel.classList.remove('hidden');
        document.getElementById('stream-description').textContent = description;
    } else {
        descPanel.classList.add('hidden');
    }
    
    // Sponsorship panel and header APY
    const sponsorshipPanel = document.getElementById('stream-sponsorship-panel');
    const sponsoredBadge = document.getElementById('stream-sponsored-badge');
    const permissionsStandalone = document.getElementById('stream-permissions-panel-standalone');
    
    if (isSponsored && stream.sponsorships && stream.sponsorships.length > 0) {
        if (sponsorshipPanel) sponsorshipPanel.classList.remove('hidden');
        if (sponsoredBadge) sponsoredBadge.classList.remove('hidden');
        if (permissionsStandalone) permissionsStandalone.classList.add('hidden');
        
        const targetSponsorship = sponsorshipId 
            ? stream.sponsorships.find(s => s.id === sponsorshipId) || stream.sponsorships[0]
            : stream.sponsorships[0];
        
        // Update header APY
        const apy = parseFloat(targetSponsorship.spotAPY || 0);
        setText('stream-header-apy', (apy * 100).toFixed(0) + '%');
        
        renderSponsorshipDetails(targetSponsorship);
        setupChartEventListeners();
        
        // Setup operator stake button if user has operator profile
        setupOperatorStakeButton(targetSponsorship);
    } else {
        if (sponsorshipPanel) sponsorshipPanel.classList.add('hidden');
        if (sponsoredBadge) sponsoredBadge.classList.add('hidden');
        if (permissionsStandalone) permissionsStandalone.classList.remove('hidden');
        // Render permissions in standalone panel for non-sponsored streams
        renderPermissionsTable(stream.permissions, true);
    }
    
    // Also render permissions in the sponsored panel if sponsored
    if (isSponsored) {
        renderPermissionsTable(stream.permissions, false);
    }
    
    // Live data player (show for public streams)
    const playerPanel = document.getElementById('stream-player-panel');
    if (accessType === 'public-all' || accessType === 'public-subscribe') {
        if (playerPanel) playerPanel.classList.remove('hidden');
        setupStreamPlayerListeners();
    } else {
        if (playerPanel) playerPanel.classList.add('hidden');
    }
}

/**
 * Render permissions table
 * @param {Array} permissions - Permission entries
 * @param {boolean} standalone - If true, use standalone panel elements
 */
function renderPermissionsTable(permissions, standalone = false) {
    const suffix = standalone ? '-standalone' : '';
    const tbody = document.getElementById(`stream-permissions-tbody${suffix}`);
    const emptyState = document.getElementById(`stream-permissions-empty${suffix}`);
    const table = document.getElementById(`stream-permissions-table${suffix}`);
    
    if (!tbody || !table) return;
    
    if (!permissions || permissions.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
        table.classList.add('hidden');
        return;
    }
    
    if (emptyState) emptyState.classList.add('hidden');
    table.classList.remove('hidden');
    
    const now = Math.floor(Date.now() / 1000);
    
    const html = permissions.map(p => {
        const isPublicAddress = p.userAddress && p.userAddress.toLowerCase() === '0x0000000000000000000000000000000000000000';
        const displayAddress = isPublicAddress ? 'Public' : Utils.shortAddress(p.userAddress);
        const addressClass = isPublicAddress ? 'text-blue-400 font-medium' : 'font-mono text-gray-300';
        
        const hasPublish = p.publishExpiration && parseInt(p.publishExpiration) > now;
        const hasSubscribe = p.subscribeExpiration && parseInt(p.subscribeExpiration) > now;
        
        const checkIcon = `<svg class="w-4 h-4 text-green-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`;
        const xIcon = `<svg class="w-4 h-4 text-gray-600 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>`;
        
        return `
            <tr class="hover:bg-white/5">
                <td class="px-4 py-2 ${addressClass} text-xs" title="${p.userAddress}">${displayAddress}</td>
                <td class="px-4 py-2 text-center">${hasPublish ? checkIcon : xIcon}</td>
                <td class="px-4 py-2 text-center">${hasSubscribe ? checkIcon : xIcon}</td>
                <td class="px-4 py-2 text-center">${p.canEdit ? checkIcon : xIcon}</td>
                <td class="px-4 py-2 text-center">${p.canDelete ? checkIcon : xIcon}</td>
                <td class="px-4 py-2 text-center">${p.canGrant ? checkIcon : xIcon}</td>
            </tr>
        `;
    }).join('');
    
    tbody.innerHTML = html;
}

/**
 * Render sponsorship details
 */
function renderSponsorshipDetails(sponsorship) {
    const dataPriceUSD = state.dataPriceUSD || 0;
    
    // Helper function to set value with tooltip (safe)
    const setValueWithTooltip = (elementId, value, displayText) => {
        const el = document.getElementById(elementId);
        if (el) {
            el.textContent = displayText;
            el.setAttribute('data-tooltip-value', value.toString());
            // Add USD tooltip on hover
            if (dataPriceUSD) {
                const usdValue = value * dataPriceUSD;
                el.title = `≈ $${Utils.formatBigNumber(usdValue)} USD`;
            }
        }
    };
    
    // Helper function to safely set text content
    const setText = (elementId, text) => {
        const el = document.getElementById(elementId);
        if (el) el.textContent = text;
    };
    
    // Cumulative sponsored
    const totalSponsored = Utils.convertWeiToData(sponsorship.cumulativeSponsoring || '0');
    setValueWithTooltip('stream-total-sponsored', totalSponsored, Utils.formatBigNumber(totalSponsored) + ' DATA');
    
    // Remaining balance
    const remaining = Utils.convertWeiToData(sponsorship.remainingWei || '0');
    setValueWithTooltip('stream-remaining', remaining, Utils.formatBigNumber(remaining) + ' DATA');
    
    // Total staked
    const totalStaked = Utils.convertWeiToData(sponsorship.totalStakedWei || '0');
    setValueWithTooltip('stream-total-staked', totalStaked, Utils.formatBigNumber(totalStaked) + ' DATA');
    
    // Payout rate (DATA/day) - calculate in wei first to avoid precision loss
    const payoutWeiPerSec = BigInt(sponsorship.totalPayoutWeiPerSec || '0');
    const payoutWeiPerDay = payoutWeiPerSec * BigInt(86400);
    const payoutPerDay = Utils.convertWeiToData(payoutWeiPerDay.toString());
    setText('stream-payout-rate', Utils.formatBigNumber(parseFloat(payoutPerDay)));
    
    // Min stake duration
    const minStakeSecs = parseInt(sponsorship.minimumStakingPeriodSeconds || 0);
    const minStakeDays = Math.ceil(minStakeSecs / 86400);
    setText('stream-min-stake-duration', minStakeDays > 0 ? `${minStakeDays} days` : 'None');
    
    // Projected insolvency
    const insolvencyTs = parseInt(sponsorship.projectedInsolvency || 0);
    if (insolvencyTs > 0) {
        const insolvencyDate = new Date(insolvencyTs * 1000);
        const day = String(insolvencyDate.getDate()).padStart(2, '0');
        const month = String(insolvencyDate.getMonth() + 1).padStart(2, '0');
        const year = insolvencyDate.getFullYear();
        const hours = String(insolvencyDate.getHours()).padStart(2, '0');
        const minutes = String(insolvencyDate.getMinutes()).padStart(2, '0');
        setText('stream-insolvency', `${day}/${month}/${year} ${hours}:${minutes}`);
    } else {
        setText('stream-insolvency', 'N/A');
    }
    
    // Operators list
    renderOperatorsList(sponsorship.stakes);
    document.getElementById('stream-operators-count').textContent = `(${sponsorship.operatorCount || 0})`;
    
    // Funding history
    renderFundingHistory(sponsorship.sponsoringEvents);
    
    // Sync tile heights after DOM update
    requestAnimationFrame(() => {
        syncTileHeights();
    });
}

/**
 * Sync the height of Staked Operators tile to match Sponsorship Details tile
 */
function syncTileHeights() {
    const sponsorshipTile = document.getElementById('sponsorship-details-tile');
    const operatorsTile = document.getElementById('staked-operators-tile');
    
    if (sponsorshipTile && operatorsTile) {
        // Get the natural height of the sponsorship tile
        const height = sponsorshipTile.offsetHeight;
        // Apply it as max-height to the operators tile
        operatorsTile.style.maxHeight = `${height}px`;
        operatorsTile.style.height = `${height}px`;
    }
}

// Store current sponsorship for stake management
let currentSponsorshipForStake = null;

/**
 * Setup the operator stake button based on user's operator profile
 * @param {Object} sponsorship - The sponsorship data
 */
function setupOperatorStakeButton(sponsorship) {
    const actionContainer = document.getElementById('stream-operator-stake-action');
    const stakeBtn = document.getElementById('stream-stake-btn');
    const stakeBtnText = document.getElementById('stream-stake-btn-text');
    
    if (!actionContainer || !stakeBtn) return;
    
    // Check if user has an operator profile
    const operatorProfile = getOperatorProfile();
    if (!operatorProfile || !operatorProfile.id) {
        actionContainer.classList.add('hidden');
        return;
    }
    
    // Check if user's operator is already staked in this sponsorship
    const operatorId = operatorProfile.id.toLowerCase();
    const stakes = sponsorship.stakes || [];
    const operatorStake = stakes.find(s => s.operator?.id?.toLowerCase() === operatorId);
    const currentStakeWei = operatorStake ? operatorStake.amountWei : '0';
    
    // Store sponsorship info for modal
    currentSponsorshipForStake = {
        id: sponsorship.id,
        currentStakeWei: currentStakeWei,
        operatorId: operatorId,
        streamId: sponsorship.stream?.id || 'Unknown'
    };
    
    // Update button text and icon
    if (operatorStake && BigInt(currentStakeWei) > BigInt(0)) {
        stakeBtnText.textContent = 'Edit Stake';
        stakeBtn.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
            </svg>
            <span id="stream-stake-btn-text">Edit Stake</span>
        `;
    } else {
        stakeBtn.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
            </svg>
            <span id="stream-stake-btn-text">Join as Operator</span>
        `;
    }
    
    // Show the button
    actionContainer.classList.remove('hidden');
    
    // Remove old listener and add new one
    const newBtn = stakeBtn.cloneNode(true);
    stakeBtn.parentNode.replaceChild(newBtn, stakeBtn);
    
    newBtn.addEventListener('click', () => {
        // Check if wallet is connected
        if (!window.appSigner) {
            UI.showToast({
                type: 'warning',
                title: 'Wallet Required',
                message: 'Please connect your wallet.',
                duration: 5000
            });
            return;
        }
        openStakeModal(currentSponsorshipForStake);
    });
}

/**
 * Open the stake modal for joining/editing stake
 * @param {Object} sponsorshipInfo - Sponsorship info with id, currentStakeWei, operatorId
 */
async function openStakeModal(sponsorshipInfo) {
    const modal = document.getElementById('stakeModal');
    const titleEl = document.getElementById('stake-modal-title');
    const descriptionEl = document.getElementById('stake-modal-description');
    const amountInput = document.getElementById('stake-modal-amount');
    const currentStakeEl = document.getElementById('stake-modal-current-stake');
    const freeFundsEl = document.getElementById('stake-modal-free-funds');
    const confirmBtn = document.getElementById('stake-modal-confirm');
    const cancelBtn = document.getElementById('stake-modal-cancel');
    const maxBtn = document.getElementById('stake-modal-max-btn');
    
    if (!modal) return;
    
    const currentStakeData = Utils.convertWeiToData(sponsorshipInfo.currentStakeWei);
    const isJoining = BigInt(sponsorshipInfo.currentStakeWei) === BigInt(0);
    
    // Update modal title and description
    if (titleEl) {
        titleEl.textContent = isJoining ? 'Join Sponsorship' : 'Edit Stake';
    }
    if (descriptionEl) {
        descriptionEl.textContent = isJoining 
            ? 'Enter the amount to stake in this sponsorship.'
            : 'Enter the new total stake amount for this sponsorship.';
    }
    
    // Set current stake
    if (currentStakeEl) {
        currentStakeEl.textContent = `${Utils.formatBigNumber(currentStakeData)} DATA`;
    }
    
    // Set initial amount
    if (amountInput) {
        amountInput.value = isJoining ? '' : parseFloat(currentStakeData);
    }
    
    // Fetch free funds from operator contract
    if (freeFundsEl) {
        freeFundsEl.textContent = 'Loading...';
        try {
            const query = `{
                operator(id: "${sponsorshipInfo.operatorId}") {
                    valueWithoutEarnings
                    stakes { amountWei }
                }
            }`;
            const data = await Services.runQuery(query);
            if (data.operator) {
                const totalValue = BigInt(data.operator.valueWithoutEarnings || '0');
                const stakedAmount = data.operator.stakes.reduce(
                    (sum, s) => sum + BigInt(s.amountWei || '0'), 
                    BigInt(0)
                );
                const freeBalance = totalValue > stakedAmount ? totalValue - stakedAmount : BigInt(0);
                const freeBalanceData = Utils.convertWeiToData(freeBalance.toString());
                freeFundsEl.textContent = `${Utils.formatBigNumber(freeBalanceData)} DATA`;
                
                // Store for MAX button
                freeFundsEl.dataset.freeWei = freeBalance.toString();
                freeFundsEl.dataset.currentStakeWei = sponsorshipInfo.currentStakeWei;
            } else {
                freeFundsEl.textContent = 'N/A';
            }
        } catch (e) {
            logger.error('Failed to fetch operator free funds:', e);
            freeFundsEl.textContent = 'Error';
        }
    }
    
    // Show modal
    modal.classList.remove('hidden');
    
    // Setup MAX button
    if (maxBtn) {
        const newMaxBtn = maxBtn.cloneNode(true);
        maxBtn.parentNode.replaceChild(newMaxBtn, maxBtn);
        newMaxBtn.addEventListener('click', () => {
            const freeWei = BigInt(freeFundsEl?.dataset?.freeWei || '0');
            const currentWei = BigInt(freeFundsEl?.dataset?.currentStakeWei || '0');
            const maxWei = freeWei + currentWei;
            const maxData = Utils.convertWeiToData(maxWei.toString());
            if (amountInput) amountInput.value = parseFloat(maxData);
        });
    }
    
    // Setup Cancel button
    if (cancelBtn) {
        const newCancelBtn = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        newCancelBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });
    }
    
    // Setup Confirm button
    if (confirmBtn) {
        const newConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
        newConfirmBtn.disabled = false;
        newConfirmBtn.textContent = 'Confirm';
        
        newConfirmBtn.addEventListener('click', async () => {
            await handleStakeConfirm(sponsorshipInfo, amountInput, newConfirmBtn, modal);
        });
    }
}

/**
 * Handle stake confirmation
 */
async function handleStakeConfirm(sponsorshipInfo, amountInput, confirmBtn, modal) {
    const newAmountData = parseFloat(amountInput?.value || '0');
    if (isNaN(newAmountData) || newAmountData < 0) {
        UI.showToast({
            type: 'error',
            title: 'Invalid Amount',
            message: 'Please enter a valid amount.',
            duration: 3000
        });
        return;
    }
    
    // Get signer from main app
    const signer = window.appSigner;
    if (!signer) {
        UI.showToast({
            type: 'error',
            title: 'Wallet Not Connected',
            message: 'Please connect your wallet to manage stakes.',
            duration: 5000
        });
        return;
    }
    
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<div class="w-4 h-4 border-2 border-white rounded-full border-t-transparent animate-spin"></div>';
    
    try {
        const newAmountWei = ethers.utils.parseUnits(String(newAmountData), 18);
        const currentStakeWei = BigInt(sponsorshipInfo.currentStakeWei);
        const newAmountWeiBig = BigInt(newAmountWei.toString());
        
        // Get gas overrides for Polygon
        const gasOverrides = await Services.getGasOverrides(signer.provider);
        
        // Get operator contract
        const operatorContract = new ethers.Contract(
            sponsorshipInfo.operatorId,
            [
                'function stake(address sponsorship, uint256 amountWei) external',
                'function reduceStakeTo(address sponsorship, uint256 targetStakeWei) external',
                'function unstake(address sponsorship) external'
            ],
            signer
        );
        
        let tx;
        
        if (newAmountWeiBig === BigInt(0) && currentStakeWei > BigInt(0)) {
            // Unstake completely
            tx = await operatorContract.unstake(sponsorshipInfo.id, gasOverrides);
        } else if (newAmountWeiBig > currentStakeWei) {
            // Stake more
            const amountToStake = newAmountWeiBig - currentStakeWei;
            tx = await operatorContract.stake(sponsorshipInfo.id, amountToStake.toString(), gasOverrides);
        } else if (newAmountWeiBig < currentStakeWei) {
            // Reduce stake
            tx = await operatorContract.reduceStakeTo(sponsorshipInfo.id, newAmountWeiBig.toString(), gasOverrides);
        } else {
            // No change
            modal.classList.add('hidden');
            UI.showToast({
                type: 'info',
                title: 'No Change',
                message: 'Stake amount unchanged.',
                duration: 3000
            });
            return;
        }
        
        UI.showToast({
            type: 'info',
            title: 'Transaction Submitted',
            message: 'Waiting for confirmation...',
            duration: 5000
        });
        
        await tx.wait();
        
        modal.classList.add('hidden');
        
        UI.showToast({
            type: 'success',
            title: 'Stake Updated',
            message: 'Your stake has been updated successfully.',
            duration: 5000
        });
        
        // Reload the stream detail to show updated data
        if (detailState.currentStreamId) {
            StreamsLogic.loadStreamDetail(
                detailState.currentStreamId, 
                detailState.isSponsored, 
                detailState.currentSponsorshipId
            );
        }
        
    } catch (error) {
        logger.error('Stake transaction failed:', error);
        UI.showToast({
            type: 'error',
            title: 'Transaction Failed',
            message: error.reason || error.message || 'Failed to update stake.',
            duration: 5000
        });
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirm';
    }
}

/**
 * Render operators list
 */
function renderOperatorsList(stakes) {
    const container = document.getElementById('stream-operators-list');
    
    if (!stakes || stakes.length === 0) {
        container.innerHTML = `<div class="px-4 md:px-6 py-4 text-gray-500 text-center text-sm">No operators staked</div>`;
        return;
    }
    
    const html = stakes.map(stake => {
        const { name, imageUrl } = Utils.parseOperatorMetadata(stake.operator?.metadataJsonString);
        const fullName = name || Utils.shortAddress(stake.operator?.id);
        const opName = fullName.length > 20 ? fullName.slice(0, 20) + '...' : fullName;
        const stakeAmount = Utils.formatBigNumber(Utils.convertWeiToData(stake.amountWei));
        const rawStake = Utils.convertWeiToData(stake.amountWei);
        
        // Generate profile image or fallback avatar
        const profileImage = imageUrl 
            ? `<img src="${Utils.escapeHtml(imageUrl)}" alt="${Utils.escapeHtml(opName)}" class="w-7 h-7 rounded-full object-cover border border-[#444] flex-shrink-0" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><div class="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 items-center justify-center text-white text-xs font-bold flex-shrink-0 hidden">${opName.charAt(0).toUpperCase()}</div>`
            : `<div class="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">${opName.charAt(0).toUpperCase()}</div>`;
        
        return `
            <div class="flex justify-between items-center px-4 md:px-6 py-3 border-b border-[#333] last:border-b-0 hover:bg-white/5 transition-colors">
                <div class="flex items-center gap-3 min-w-0">
                    ${profileImage}
                    <a href="/operator/${stake.operator?.id}" onclick="event.preventDefault(); window.router.navigate('/operator/${stake.operator?.id}')" class="text-blue-400 hover:text-blue-300 font-medium text-sm truncate">${Utils.escapeHtml(opName)}</a>
                </div>
                <span class="text-gray-300 font-mono text-sm flex-shrink-0 ml-2" data-tooltip-value="${rawStake}">${stakeAmount} DATA</span>
            </div>
        `;
    }).join('');
    
    container.innerHTML = html;
}

/**
 * Render funding history
 */
function renderFundingHistory(events) {
    const container = document.getElementById('stream-funding-history');
    
    if (!events || events.length === 0) {
        container.innerHTML = `<div class="px-4 md:px-6 py-4 text-gray-500 text-center text-sm">No funding history</div>`;
        return;
    }
    
    const html = events.map(event => {
        const rawAmount = Utils.convertWeiToData(event.amount || '0');
        const amount = Utils.formatBigNumber(rawAmount);
        const date = new Date(parseInt(event.date) * 1000).toLocaleDateString();
        const sponsor = Utils.shortAddress(event.sponsor);
        
        return `
            <div class="flex justify-between items-center px-4 md:px-6 py-3 border-b border-[#333] last:border-b-0 hover:bg-white/5 transition-colors">
                <div class="flex items-center gap-2">
                    <svg class="w-4 h-4 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
                    </svg>
                    <span class="text-gray-400 text-xs">${date}</span>
                    <span class="text-gray-600 text-xs font-mono hidden sm:inline">${sponsor}</span>
                </div>
                <span class="text-green-400 font-semibold text-sm" data-tooltip-value="${rawAmount}">+${amount}</span>
            </div>
        `;
    }).join('');
    
    container.innerHTML = html;
}

/**
 * Render sponsorship charts - unified chart with pill toggles
 */
function renderSponsorshipCharts(dailyData) {
    if (!dailyData || dailyData.length === 0) {
        return;
    }
    
    // Store the chart data
    detailState.chartData = dailyData;
    detailState.currentChartType = 'apy';
    detailState.currentViewMode = 'data';
    detailState.currentTimeframe = 'all';
    
    // Initial render
    updateUnifiedChart();
}

/**
 * Update unified chart based on current state
 */
function updateUnifiedChart() {
    const dailyData = detailState.chartData;
    if (!dailyData || dailyData.length === 0) return;
    
    // Destroy existing chart
    if (detailState.chart) {
        detailState.chart.destroy();
        detailState.chart = null;
    }
    
    // Filter data by timeframe
    let filteredData = dailyData;
    if (detailState.currentTimeframe !== 'all') {
        const days = parseInt(detailState.currentTimeframe);
        const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
        filteredData = dailyData.filter(d => parseInt(d.date) * 1000 >= cutoff);
    }
    
    if (filteredData.length === 0) {
        filteredData = dailyData.slice(-7); // Fallback to last 7 days
    }
    
    const labels = filteredData.map(d => new Date(parseInt(d.date) * 1000).toLocaleDateString());
    const dataPriceUSD = state.dataPriceUSD || 0;
    const useUsd = detailState.currentViewMode === 'usd' && dataPriceUSD > 0;
    
    // Show/hide USD toggle based on chart type
    const viewButtons = document.getElementById('stream-chart-view-buttons');
    if (viewButtons) {
        viewButtons.classList.toggle('hidden', detailState.currentChartType !== 'stake');
    }
    
    // Prepare data based on chart type
    let chartData, chartColor, chartLabel, chartType, isStepped;
    
    switch (detailState.currentChartType) {
        case 'apy':
            chartData = filteredData.map(d => parseFloat(d.spotAPY || 0) * 100);
            chartColor = '#22c55e';
            chartLabel = 'APY (%)';
            chartType = 'line';
            isStepped = false;
            break;
        case 'stake':
            chartData = filteredData.map(d => {
                const val = Utils.convertWeiToData(d.totalStakedWei || '0');
                return useUsd ? val * dataPriceUSD : val;
            });
            chartColor = '#3b82f6';
            chartLabel = useUsd ? 'Staked (USD)' : 'Staked (DATA)';
            chartType = 'bar';
            isStepped = false;
            break;
        case 'operators':
            chartData = filteredData.map(d => parseInt(d.operatorCount || 0));
            chartColor = '#8b5cf6';
            chartLabel = 'Operators';
            chartType = 'line';
            isStepped = true;
            break;
    }
    
    const ctx = document.getElementById('stream-unified-chart')?.getContext('2d');
    if (!ctx) return;
    
    const chartConfig = {
        type: chartType,
        data: {
            labels,
            datasets: [{
                data: chartData,
                borderColor: chartColor,
                backgroundColor: chartType === 'bar' ? chartColor : `${chartColor}20`,
                fill: chartType === 'line',
                tension: 0.4,
                pointRadius: 0,
                borderWidth: 2,
                borderRadius: chartType === 'bar' ? 4 : 0,
                ...(isStepped ? { stepped: 'middle' } : {})
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1E1E1E',
                    borderColor: '#333',
                    borderWidth: 1,
                    titleColor: '#fff',
                    bodyColor: '#a3a3a3',
                    titleFont: { family: 'Inter, system-ui, sans-serif', size: 12 },
                    bodyFont: { family: 'Inter, system-ui, sans-serif', size: 11 },
                    padding: 10,
                    cornerRadius: 6,
                    callbacks: {
                        label: function(context) {
                            const value = context.raw;
                            if (detailState.currentChartType === 'apy') {
                                return `${value.toFixed(2)}%`;
                            } else if (detailState.currentChartType === 'stake') {
                                const prefix = useUsd ? '$' : '';
                                const suffix = useUsd ? '' : ' DATA';
                                return `${prefix}${Utils.formatBigNumber(value)}${suffix}`;
                            } else {
                                return `${value} operators`;
                            }
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    grid: { display: false },
                    ticks: { 
                        color: '#666', 
                        font: { size: 10, family: 'Inter, system-ui, sans-serif' },
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 8
                    }
                },
                y: {
                    grid: { color: '#333', drawBorder: false },
                    ticks: { 
                        color: '#666', 
                        font: { size: 10, family: 'Inter, system-ui, sans-serif' },
                        callback: function(value) {
                            if (detailState.currentChartType === 'apy') {
                                return value + '%';
                            } else if (detailState.currentChartType === 'stake') {
                                const prefix = useUsd ? '$' : '';
                                return prefix + Utils.formatBigNumber(value);
                            }
                            return value;
                        }
                    }
                }
            }
        }
    };
    
    detailState.chart = new Chart(ctx, chartConfig);
}

/**
 * Setup chart event listeners for pills
 */
let chartListenersSetup = false;

function setupChartEventListeners() {
    if (chartListenersSetup) return;
    chartListenersSetup = true;
    
    // Chart type pills
    const chartTypeTabs = document.getElementById('stream-chart-type-tabs');
    if (chartTypeTabs) {
        chartTypeTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-stream-chart-type]');
            if (!btn) return;
            
            const chartType = btn.getAttribute('data-stream-chart-type');
            detailState.currentChartType = chartType;
            
            // Update pill styling
            chartTypeTabs.querySelectorAll('button').forEach(b => {
                b.classList.remove('bg-blue-600', 'text-white');
                b.classList.add('text-gray-400');
            });
            btn.classList.add('bg-blue-600', 'text-white');
            btn.classList.remove('text-gray-400');
            
            updateUnifiedChart();
        });
    }
    
    // View mode pills (DATA/USD)
    const viewButtons = document.getElementById('stream-chart-view-buttons');
    if (viewButtons) {
        viewButtons.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-stream-view]');
            if (!btn) return;
            
            const viewMode = btn.getAttribute('data-stream-view');
            detailState.currentViewMode = viewMode;
            
            // Update pill styling
            viewButtons.querySelectorAll('button').forEach(b => {
                b.classList.remove('bg-blue-600', 'text-white');
                b.classList.add('text-gray-300');
            });
            btn.classList.add('bg-blue-600', 'text-white');
            btn.classList.remove('text-gray-300');
            
            updateUnifiedChart();
        });
    }
    
    // Timeframe pills
    const timeframeButtons = document.getElementById('stream-chart-timeframe-buttons');
    if (timeframeButtons) {
        timeframeButtons.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-stream-days]');
            if (!btn) return;
            
            const days = btn.getAttribute('data-stream-days');
            detailState.currentTimeframe = days;
            
            // Update pill styling
            timeframeButtons.querySelectorAll('button').forEach(b => {
                b.classList.remove('bg-blue-600', 'text-white', 'shadow-sm');
                b.classList.add('text-gray-300');
            });
            btn.classList.add('bg-blue-600', 'text-white', 'shadow-sm');
            btn.classList.remove('text-gray-300');
            
            updateUnifiedChart();
        });
    }
}

// ============================================
// Live Data Player
// ============================================

let playerListenersSetup = false;

/**
 * Initialize partition selector based on stream partitions
 */
function initializePartitionSelector(partitions) {
    const selectorContainer = document.getElementById('stream-partition-selector');
    const select = document.getElementById('stream-partition-select');
    const subscribeAllCheckbox = document.getElementById('stream-subscribe-all');
    
    if (!selectorContainer || !select) return;
    
    // Show selector only if more than 1 partition
    if (partitions > 1) {
        selectorContainer.classList.remove('hidden');
        selectorContainer.classList.add('flex');
        
        // Populate partition options
        select.innerHTML = '';
        for (let i = 0; i < partitions; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = `Partition ${i}`;
            select.appendChild(option);
        }
        
        // Reset checkbox
        if (subscribeAllCheckbox) {
            subscribeAllCheckbox.checked = false;
        }
    } else {
        selectorContainer.classList.add('hidden');
        selectorContainer.classList.remove('flex');
    }
}

function setupStreamPlayerListeners() {
    if (playerListenersSetup) return;
    playerListenersSetup = true;
    
    const playBtn = document.getElementById('stream-play-btn');
    const stopBtn = document.getElementById('stream-stop-btn');
    const clearBtn = document.getElementById('stream-clear-btn');
    
    if (playBtn) {
        playBtn.addEventListener('click', startStreamPlayer);
    }
    
    if (stopBtn) {
        stopBtn.addEventListener('click', stopStreamPlayer);
    }
    
    if (clearBtn) {
        clearBtn.addEventListener('click', clearStreamPlayerLog);
    }
}

async function startStreamPlayer() {
    if (detailState.subscription || detailState.subscriptions.length > 0) return;
    
    const streamId = detailState.currentStreamId;
    if (!streamId) return;
    
    const playBtn = document.getElementById('stream-play-btn');
    const stopBtn = document.getElementById('stream-stop-btn');
    const statusDot = document.getElementById('stream-player-status');
    const statusText = document.getElementById('stream-player-status-text');
    const logContainer = document.getElementById('stream-player-log');
    const subscribeAllCheckbox = document.getElementById('stream-subscribe-all');
    const partitionSelect = document.getElementById('stream-partition-select');
    
    statusText.textContent = 'Connecting...';
    statusDot.classList.remove('bg-gray-500', 'bg-green-500');
    statusDot.classList.add('bg-yellow-500');
    
    try {
        // Get the global Streamr client from Services
        const streamrClient = Services.getStreamrClient();
        if (!streamrClient) {
            throw new Error('Streamr client not initialized');
        }
        
        detailState.messageCount = 0;
        detailState.messageTimestamps = [];
        detailState.bytesReceived = 0;
        detailState.bytesTimestamps = [];
        logContainer.innerHTML = '';
        
        // Determine which partitions to subscribe to
        const subscribeToAll = subscribeAllCheckbox && subscribeAllCheckbox.checked;
        const partitions = detailState.partitions;
        
        if (subscribeToAll && partitions > 1) {
            // Subscribe to all partitions
            detailState.subscriptions = [];
            for (let i = 0; i < partitions; i++) {
                const sub = await streamrClient.subscribe(
                    { streamId, partition: i },
                    (content, metadata) => {
                        handleStreamMessage(content, metadata, i);
                    }
                );
                detailState.subscriptions.push(sub);
            }
            statusText.textContent = `Subscribed (All ${partitions} partitions)`;
        } else if (partitions > 1 && partitionSelect) {
            // Subscribe to selected partition
            const selectedPartition = parseInt(partitionSelect.value) || 0;
            detailState.subscription = await streamrClient.subscribe(
                { streamId, partition: selectedPartition },
                (content, metadata) => {
                    handleStreamMessage(content, metadata, selectedPartition);
                }
            );
            statusText.textContent = `Subscribed (Partition ${selectedPartition})`;
        } else {
            // Subscribe to stream (default partition 0)
            detailState.subscription = await streamrClient.subscribe(
                streamId,
                (content, metadata) => {
                    handleStreamMessage(content, metadata);
                }
            );
            statusText.textContent = 'Subscribed';
        }
        
        // Update UI
        playBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
        statusDot.classList.remove('bg-yellow-500');
        statusDot.classList.add('bg-green-500');
        
        // Start rate counter
        detailState.rateInterval = setInterval(updateMessageRate, 1000);
        
    } catch (error) {
        logger.error('Failed to subscribe to stream:', error);
        statusText.textContent = 'Error: ' + error.message;
        statusDot.classList.remove('bg-yellow-500');
        statusDot.classList.add('bg-red-500');
        UI.showToast({ type: 'error', title: 'Subscription Failed', message: error.message });
    }
}

function handleStreamMessage(content, metadata, partition = null) {
    detailState.messageCount++;
    const now = Date.now();
    detailState.messageTimestamps.push(now);
    
    // Calculate message size for KB/s
    const contentStr = typeof content === 'object' ? JSON.stringify(content) : String(content);
    const messageBytes = new Blob([contentStr]).size;
    detailState.bytesReceived += messageBytes;
    detailState.bytesTimestamps.push({ timestamp: now, bytes: messageBytes });
    
    // Update count
    const msgCountEl = document.getElementById('stream-player-msg-count');
    if (msgCountEl) msgCountEl.textContent = detailState.messageCount;
    
    // Add message to log
    const logContainer = document.getElementById('stream-player-log');
    if (!logContainer) return;
    
    const msgDiv = document.createElement('div');
    msgDiv.className = 'mb-2 pb-2 border-b border-[#333] last:border-b-0';
    
    const timestamp = new Date().toLocaleTimeString();
    const partitionBadge = partition !== null 
        ? `<span class="px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded text-[10px]">P${partition}</span>` 
        : '';
    
    msgDiv.innerHTML = `
        <div class="flex items-center gap-2 mb-1">
            <span class="text-gray-500">${timestamp}</span>
            <span class="text-gray-600">#${detailState.messageCount}</span>
            ${partitionBadge}
        </div>
        <pre class="text-green-400 whitespace-pre-wrap break-all">${Utils.escapeHtml(contentStr)}</pre>
    `;
    
    logContainer.appendChild(msgDiv);
    
    // Auto-scroll to bottom
    logContainer.scrollTop = logContainer.scrollHeight;
    
    // Limit messages displayed
    while (logContainer.children.length > 100) {
        logContainer.removeChild(logContainer.firstChild);
    }
}

function updateMessageRate() {
    const now = Date.now();
    const oneSecondAgo = now - 1000;
    
    // Count messages in last second
    detailState.messageTimestamps = detailState.messageTimestamps.filter(t => t > oneSecondAgo);
    const rate = detailState.messageTimestamps.length;
    
    const rateEl = document.getElementById('stream-player-rate');
    if (rateEl) rateEl.textContent = rate;
    
    // Calculate Kbps (kilobits per second)
    detailState.bytesTimestamps = detailState.bytesTimestamps.filter(b => b.timestamp > oneSecondAgo);
    const bytesInLastSecond = detailState.bytesTimestamps.reduce((sum, b) => sum + b.bytes, 0);
    const kbps = ((bytesInLastSecond * 8) / 1000).toFixed(2);
    
    const kbpsEl = document.getElementById('stream-player-kbps');
    if (kbpsEl) kbpsEl.textContent = kbps;
}

async function stopStreamPlayer() {
    // Stop single subscription
    if (detailState.subscription) {
        try {
            await detailState.subscription.unsubscribe();
        } catch (e) {
            logger.warn('Error unsubscribing:', e);
        }
        detailState.subscription = null;
    }
    
    // Stop multiple subscriptions
    for (const sub of detailState.subscriptions) {
        try {
            await sub.unsubscribe();
        } catch (e) {
            logger.warn('Error unsubscribing from partition:', e);
        }
    }
    detailState.subscriptions = [];
    
    if (detailState.rateInterval) {
        clearInterval(detailState.rateInterval);
        detailState.rateInterval = null;
    }
    
    const playBtn = document.getElementById('stream-play-btn');
    const stopBtn = document.getElementById('stream-stop-btn');
    const statusDot = document.getElementById('stream-player-status');
    const statusText = document.getElementById('stream-player-status-text');
    
    if (playBtn) playBtn.classList.remove('hidden');
    if (stopBtn) stopBtn.classList.add('hidden');
    if (statusText) statusText.textContent = 'Idle';
    if (statusDot) {
        statusDot.classList.remove('bg-green-500', 'bg-yellow-500', 'bg-red-500');
        statusDot.classList.add('bg-gray-500');
    }
    
    // Reset KB/s display
    const kbpsEl = document.getElementById('stream-player-kbps');
    if (kbpsEl) kbpsEl.textContent = '0';
}

function clearStreamPlayerLog() {
    const logContainer = document.getElementById('stream-player-log');
    if (logContainer) {
        logContainer.innerHTML = `<div class="text-gray-500 text-center py-8">Click "Subscribe" to start receiving live data</div>`;
    }
    detailState.messageCount = 0;
    detailState.bytesReceived = 0;
    detailState.bytesTimestamps = [];
    
    const msgCountEl = document.getElementById('stream-player-msg-count');
    if (msgCountEl) msgCountEl.textContent = '0';
    
    const kbpsEl = document.getElementById('stream-player-kbps');
    if (kbpsEl) kbpsEl.textContent = '0';
}

export default StreamsLogic;
