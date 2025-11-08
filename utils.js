import { POLYGON_RPC_URL } from './constants.js';

/**
 * Escapes HTML special characters in a string.
 * @param {string} unsafe - The string to escape.
 * @returns {string} The escaped string.
 */
export function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') {
        return '';
    }
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

/**
 * Formats a big number string with spaces as thousands separators.
 * @param {string} numStr - The number string to format.
 * @returns {string} The formatted number string.
 */
export const formatBigNumber = (numStr) => {
    if (!numStr) return '0';
    const parts = numStr.toString().split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return parts.join('.');
};

/**
 * Converts a wei string to a DATA token string.
 * @param {string} weiStr - The amount in wei.
 * @param {boolean} [withDecimals=false] - Whether to include decimals in the output.
 * @returns {string} The amount in DATA.
 */
export const convertWeiToData = (weiStr, withDecimals = false) => {
    if (!weiStr || weiStr === '0') return '0';
    try {
        const weiBigInt = BigInt(weiStr);
        const dataDenominator = BigInt('1000000000000000000'); // 10^18
        if (!withDecimals) {
            return (weiBigInt / dataDenominator).toString();
        }
        const dataValue = weiBigInt / dataDenominator;
        const remainder = weiBigInt % dataDenominator;
        const decimals = (remainder * BigInt(100)) / dataDenominator;
        return `${dataValue.toString()}.${decimals.toString().padStart(2, '0')}`;
    } catch (e) {
        console.error("Could not convert wei to DATA:", weiStr, e);
        return 'N/A';
    }
};

/**
 * Calculates the USD value for a given DATA amount and price.
 * @param {string} dataAmountStr - The amount of DATA.
 * @param {number|null} dataPriceUSD - The current price of DATA in USD.
 * @returns {string} The formatted USD value.
 */
export const formatUsdForTooltip = (dataAmountStr, dataPriceUSD) => {
    if (dataPriceUSD === null || !dataAmountStr) return 'Not available';
    const numericDataAmount = parseFloat(dataAmountStr.replace(/ /g, '').replace(',', '.'));
    const usdValue = numericDataAmount * dataPriceUSD;
    return `~$${formatBigNumber(Math.round(usdValue))}`;
};

/**
 * Creates an HTML anchor tag for a Polygonscan link.
 * @param {string} address - The Ethereum address.
 * @param {string} [type='address'] - The type of link (e.g., 'address', 'tx').
 * @returns {string} The HTML string for the link.
 */
export const createAddressLink = (address, type = 'address') => {
    if (!address) return '';
    const abbreviated = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    const url = `https://polygonscan.com/${type}/${address}`;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-gray-300 hover:text-white transition-colors" title="${escapeHtml(address)}">${abbreviated}</a>`;
};

/**
 * Creates an internal app link to an operator's detail view.
 * @param {object} entity The entity object (e.g., operator, flagger) with id and metadata.
 * @returns {string} The HTML anchor tag.
 */
export function createEntityLink(entity) {
    if (!entity || !entity.id) return 'Unknown';
    const { name } = parseOperatorMetadata(entity.metadataJsonString);
    const address = entity.id;
    const abbreviated = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    const displayText = escapeHtml(name || abbreviated);
    const titleText = escapeHtml(name ? `${name} (${address})` : address);
    // Use a data attribute for the event listener in main.js to pick up
    return `<a href="#" class="text-gray-300 hover:text-white transition-colors operator-link" data-operator-id="${address}" title="${titleText}">${displayText}</a>`;
}

/**
 * Parses the operator's metadata JSON string.
 * @param {string} metadataJsonString The raw JSON string from The Graph.
 * @returns {{name: string|null, description: string|null, imageUrl: string|null}}
 */
export function parseOperatorMetadata(metadataJsonString) {
    try {
        if (metadataJsonString) {
            const metadata = JSON.parse(metadataJsonString);
            return {
                name: metadata.name || null,
                description: metadata.description || null,
                imageUrl: metadata.imageIpfsCid ? `https://ipfs.io/ipfs/${metadata.imageIpfsCid}` : null
            };
        }
    } catch (e) { /* ignore */ }
    return { name: null, description: null, imageUrl: null };
}

/**
 * Provides a user-friendly error message from a transaction error object.
 * @param {Error} error - The error object from ethers.js or wallet.
 * @returns {string} A user-friendly error message.
 */
export function getFriendlyErrorMessage(error) {
    if (error.code === 4001) {
        return 'Transaction rejected in your wallet.';
    }
    if (error.reason) {
        if (error.reason.toLowerCase().includes('slash')) {
            return 'Operation failed. The operator may have been slashed.';
        }
        if (error.reason.toLowerCase().includes('minimum')) {
            return 'Operation failed. The amount may be less than the required minimum.';
        }
         if (error.reason.toLowerCase().includes('capacity')) {
            return 'Operation failed. The operator may be at full capacity.';
        }
        return `Transaction failed: ${error.reason}`;
    }
    if (error.data && error.data.message) {
        return `Transaction failed: ${error.data.message}`;
    }
     if (error.message) {
        return error.message;
    }
    return 'An unknown error occurred.';
}

/**
 * Calculates the weighted APY for an operator based on their stakes.
 * @param {Array} stakes - The operator's stakes array from The Graph.
 * @returns {number} The calculated weighted APY.
 */
export function calculateWeightedApy(stakes) {
    if (!stakes || stakes.length === 0) return 0;
    let weightedApySum = 0;
    let totalStakeInSponsorships = 0;
    for (const stake of stakes) {
        if (stake.sponsorship?.spotAPY) {
            const stakeAmount = Number(stake.amountWei);
            const apy = Number(stake.sponsorship.spotAPY);
            weightedApySum += stakeAmount * apy;
            totalStakeInSponsorships += stakeAmount;
        }
    }
    return totalStakeInSponsorships > 0 ? weightedApySum / totalStakeInSponsorships : 0;
}

/**
 * Parses a non-standard date string from the CSV.
 * Format: "d/MM/yy HH:mm" (e.g., "4/11/25 16:14")
 * @param {string} dateString The date string from the CSV.
 * @returns {Date|null} The parsed Date object or null if invalid.
 */
export function parseDateFromCsv(dateString) {
    if (!dateString) return null;

    try {
        const parts = dateString.split(' '); // [ "4/11/25", "16:14" ]
        if (parts.length !== 2) return null;

        const dateParts = parts[0].split('/'); // [ "4", "11", "25" ]
        const timeParts = parts[1].split(':'); // [ "16", "14" ]

        if (dateParts.length !== 3 || timeParts.length !== 2) return null;

        const day = parseInt(dateParts[0], 10) -1;
        const month = parseInt(dateParts[1], 10) - 1; // JS months are 0-indexed
        const year = 2000 + parseInt(dateParts[2], 10); // "25" -> 2025
        const hour = parseInt(timeParts[0], 10);
        const minute = parseInt(timeParts[1], 10);

        if (isNaN(day) || isNaN(month) || isNaN(year) || isNaN(hour) || isNaN(minute)) {
            return null;
        }

        return new Date(year, month, day, hour, minute);
    } catch (e) {
        console.error("Failed to parse CSV date:", dateString, e);
        return null;
    }
}

/**
 * Fetches the MATIC balance for a given address using a public RPC.
 * @param {string} address - The address to check the balance of.
 * @returns {Promise<string>} The formatted MATIC balance or 'Error'.
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
        return balanceMatic.toFixed(2); // Format to 2 decimal places
    } catch (error) {
        console.error(`Failed to get MATIC balance for ${address}:`, error);
        return 'Error';
    }
}
