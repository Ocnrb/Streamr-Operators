/**
 * User Profile Module
 * Manages saved operator and delegator profiles for quick access shortcuts
 */

const OPERATOR_PROFILE_KEY = 'userOperatorProfile';
const DELEGATOR_PROFILE_KEY = 'userDelegatorProfile';

/**
 * @typedef {Object} Profile
 * @property {string} id - The address
 * @property {string} name - Display name
 * @property {string|null} imageUrl - Avatar URL (optional)
 * @property {number} savedAt - Timestamp when the profile was saved
 */

// ============================================
// Operator Profile Functions
// ============================================

/**
 * Save an operator as the user's profile
 * @param {string} operatorId - Operator address
 * @param {string} name - Operator display name
 * @param {string|null} imageUrl - Operator avatar URL
 * @returns {Profile} The saved profile
 */
export function saveOperatorProfile(operatorId, name, imageUrl = null) {
    const profile = {
        id: operatorId.toLowerCase(),
        operatorId: operatorId.toLowerCase(), // Keep for backwards compatibility
        name: name || operatorId,
        imageUrl: imageUrl,
        savedAt: Date.now()
    };
    
    try {
        localStorage.setItem(OPERATOR_PROFILE_KEY, JSON.stringify(profile));
    } catch (e) {
        console.error('Failed to save operator profile:', e);
    }
    
    return profile;
}

/**
 * Get the saved operator profile
 * @returns {Profile|null} The saved profile or null if none exists
 */
export function getOperatorProfile() {
    try {
        const stored = localStorage.getItem(OPERATOR_PROFILE_KEY);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (e) {
        console.error('Failed to get operator profile:', e);
    }
    return null;
}

/**
 * Remove the saved operator profile
 * @returns {boolean} True if profile was removed
 */
export function removeOperatorProfile() {
    try {
        localStorage.removeItem(OPERATOR_PROFILE_KEY);
        return true;
    } catch (e) {
        console.error('Failed to remove operator profile:', e);
        return false;
    }
}

/**
 * Check if there's a saved operator profile
 * @returns {boolean} True if a profile exists
 */
export function hasOperatorProfile() {
    return getOperatorProfile() !== null;
}

/**
 * Check if the given operator ID matches the saved profile
 * @param {string} operatorId - Operator address to check
 * @returns {boolean} True if this operator is the saved profile
 */
export function isOperatorSaved(operatorId) {
    const profile = getOperatorProfile();
    if (!profile || !operatorId) return false;
    const profileId = profile.id || profile.operatorId;
    return profileId.toLowerCase() === operatorId.toLowerCase();
}

// ============================================
// Delegator Profile Functions
// ============================================

/**
 * Save a delegator as the user's profile
 * @param {string} delegatorId - Delegator address
 * @param {string} name - Delegator display name
 * @param {string|null} imageUrl - Delegator avatar URL
 * @returns {Profile} The saved profile
 */
export function saveDelegatorProfile(delegatorId, name, imageUrl = null) {
    const profile = {
        id: delegatorId.toLowerCase(),
        name: name || delegatorId,
        imageUrl: imageUrl,
        savedAt: Date.now()
    };
    
    try {
        localStorage.setItem(DELEGATOR_PROFILE_KEY, JSON.stringify(profile));
    } catch (e) {
        console.error('Failed to save delegator profile:', e);
    }
    
    return profile;
}

/**
 * Get the saved delegator profile
 * @returns {Profile|null} The saved profile or null if none exists
 */
export function getDelegatorProfile() {
    try {
        const stored = localStorage.getItem(DELEGATOR_PROFILE_KEY);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (e) {
        console.error('Failed to get delegator profile:', e);
    }
    return null;
}

/**
 * Remove the saved delegator profile
 * @returns {boolean} True if profile was removed
 */
export function removeDelegatorProfile() {
    try {
        localStorage.removeItem(DELEGATOR_PROFILE_KEY);
        return true;
    } catch (e) {
        console.error('Failed to remove delegator profile:', e);
        return false;
    }
}

/**
 * Check if there's a saved delegator profile
 * @returns {boolean} True if a profile exists
 */
export function hasDelegatorProfile() {
    return getDelegatorProfile() !== null;
}

/**
 * Check if the given delegator ID matches the saved profile
 * @param {string} delegatorId - Delegator address to check
 * @returns {boolean} True if this delegator is the saved profile
 */
export function isDelegatorSaved(delegatorId) {
    const profile = getDelegatorProfile();
    if (!profile || !delegatorId) return false;
    return profile.id.toLowerCase() === delegatorId.toLowerCase();
}

export default {
    saveOperatorProfile,
    getOperatorProfile,
    removeOperatorProfile,
    hasOperatorProfile,
    isOperatorSaved,
    saveDelegatorProfile,
    getDelegatorProfile,
    removeDelegatorProfile,
    hasDelegatorProfile,
    isDelegatorSaved
};
