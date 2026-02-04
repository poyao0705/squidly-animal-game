/**
 * Input Manager for Fish Game
 * 
 * A minimal pointer storage system for tracking cursor positions.
 * Host/participant logic is handled by app.js for per-app customization.
 * 
 * @author Squidly Team
 * @version 3.0.0
 * @class InputManager
 */
class InputManager {
  /**
   * Create a new InputManager instance
   * 
   * @param {Object} owner - The cursor instance that owns this InputManager
   * @param {Object} [options={}] - Configuration options
   * @param {number} [options.inactiveTimeout=5000] - Timeout for inactive users in milliseconds
   */
  constructor(owner, options = {}) {
    this.owner = owner;
    this.options = {
      inactiveTimeout: options.inactiveTimeout || 5000,
      ...options
    };
    this._pointers = new Map();
  }

  /**
   * Update pointer position for the specified user/pointer
   * 
   * @param {number} x - X coordinate of the pointer
   * @param {number} y - Y coordinate of the pointer
   * @param {string} [id="default"] - Unique identifier for the pointer/user
   */
  updatePointerPosition(x, y, id = "default") {
    if (x === undefined || y === undefined || x === null || y === null) {
      console.log("InputManager: Invalid coordinates received:", x, y, "for user:", id);
      return;
    }

    const pointer = this._getOrCreatePointer(id);
    pointer.x = x;
    pointer.y = y;
    pointer.lastSeen = performance.now();
  }

  /**
   * Get or create a pointer object for the specified ID
   * @private
   */
  _getOrCreatePointer(id) {
    if (!this._pointers.has(id)) {
      this._pointers.set(id, {
        id: id,
        x: 0,
        y: 0,
        lastSeen: 0
      });
    }
    return this._pointers.get(id);
  }

  /**
   * Get all active pointers
   * @returns {Array<Object>} Array of pointer objects
   */
  getActivePointers() {
    return Array.from(this._pointers.values()).map(pointer => ({
      id: pointer.id,
      x: pointer.x,
      y: pointer.y,
      lastSeen: pointer.lastSeen
    }));
  }

  /**
   * Get a specific pointer by its ID
   * @param {string} id - The pointer identifier
   * @returns {Object|null} Pointer object or null if not found
   */
  getPointer(id) {
    return this._pointers.get(id) || null;
  }

  /**
   * Check if a pointer exists by its ID
   * @param {string} id - The pointer identifier
   * @returns {boolean} True if pointer exists
   */
  hasPointer(id) {
    return this._pointers.has(id);
  }

  /**
   * Remove a specific pointer by its ID
   * @param {string} id - The pointer identifier to remove
   * @returns {boolean} True if pointer was removed
   */
  removePointer(id) {
    return this._pointers.delete(id);
  }

  /**
   * Clean up inactive users based on timeout
   * @param {number} [timeoutMs=null] - Timeout in milliseconds
   * @returns {number} Number of users removed
   */
  cleanupInactiveUsers(timeoutMs = null) {
    const timeout = timeoutMs || this.options.inactiveTimeout;
    const now = performance.now();
    let removed = 0;

    for (const [id, pointer] of this._pointers.entries()) {
      if ((now - pointer.lastSeen) > timeout) {
        this._pointers.delete(id);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Reset all data
   */
  reset() {
    this._pointers.clear();
  }
}

// Export for different module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = InputManager;
} else if (typeof define === 'function' && define.amd) {
  define([], function () {
    return InputManager;
  });
} else {
  window.InputManager = InputManager;
}

export default InputManager;
export { InputManager };
