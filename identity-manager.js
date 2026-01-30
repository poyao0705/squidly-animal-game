/**
 * @fileoverview Identity Manager
 * 
 * Manages the client's identity (Host vs Participant) and the logic for
 * swapping roles.
 */

export class IdentityManager {
  /**
   * @param {Object} sessionInfo - The session info object injected by Squidly
   */
  constructor(sessionInfo) {
    // Determine real host status from session info
    const hasSessionInfo = typeof sessionInfo !== "undefined" && sessionInfo != null;
    this._realIsHost = hasSessionInfo ? sessionInfo?.user === "host" : true;
    
    // Swap state
    this._isSwapped = false;
    
    // Debug log
    console.log("[IdentityManager] Initialized. Real IsHost:", this._realIsHost);
  }

  /**
   * Returns whether the current user is effectively the host.
   * Takes into account the real role and the swap state.
   * @returns {boolean}
   */
  get isHost() {
    return this._isSwapped ? !this._realIsHost : this._realIsHost;
  }

  /**
   * Returns the "Real" isHost value, ignoring swap.
   * @returns {boolean}
   */
  get realIsHost() {
    return this._realIsHost;
  }

  /**
   * Sets the swap state.
   * @param {boolean} isSwapped 
   */
  setSwapState(isSwapped) {
    if (this._isSwapped !== isSwapped) {
        this._isSwapped = isSwapped;
        console.log(`[IdentityManager] Swap state changed to: ${isSwapped}. Effective IsHost: ${this.isHost}`);
        return true; // Changed
    }
    return false; // Not changed
  }

  /**
   * Returns true if we are currently swapped.
   */
  get isSwapped() {
    return this._isSwapped;
  }
}
