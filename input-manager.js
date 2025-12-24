/**
 * Unified Input Manager for WebGL Cursor Effects
 * 
 * This module provides a unified input management system for both WebGL-based cursor effects:
 * - Fluid Cursor: WebGL fluid simulation with pointer tracking
 * - Ballpit Cursor: Interactive ball physics with multi-user support
 * 
 * Features:
 * - Multi-pointer input handling (mouse, eye gaze, etc.)
 * - Dynamic ball assignment for multi-user scenarios
 * - Input prioritization (mouse over eye gaze)
 * - Automatic cleanup of inactive users
 * - Cross-cursor compatibility and unified API
 * 
 * @author Squidly Team
 * @version 1.0.0
 * @class InputManager
 */
class InputManager {
  /**
   * Create a new InputManager instance
   * 
   * @param {Object} owner - The cursor instance that owns this InputManager
   * @param {Object} [options={}] - Configuration options
   * @param {string} [options.cursorType='fluid'] - Type of cursor ('fluid' or 'ballpit')
   * @param {boolean} [options.useBallAssignment=false] - Whether to use ball assignment for eye gaze users
   * @param {number} [options.inactiveTimeout=5000] - Timeout for inactive users in milliseconds
   */
  constructor(owner, options = {}) {
    /** @type {Object} The cursor instance that owns this InputManager */
    this.owner = owner;
    
    /** @type {Object} Configuration options */
    this.options = {
      cursorType: options.cursorType || 'fluid',
      useBallAssignment: options.useBallAssignment || false,
      inactiveTimeout: options.inactiveTimeout || 5000,
      ...options
    };

    /** @type {Map<string, Object>} Internal pointer storage */
    this._pointers = new Map();
    
    /** @type {Map<string, number>} Ball assignment system for ballpit cursor */
    this._eyegazeBallIndices = new Map(); // userType -> ballIndex
    
    /** @type {number} Next available ball index (0 reserved for mouse) */
    this._nextAvailableBallIndex = 1;
    
    /** @type {Object} Performance and usage statistics */
    this._stats = {
      totalUpdates: 0,
      lastCleanup: performance.now()
    };
  }

  /**
   * Update pointer position for the specified user/pointer
   * 
   * This is the main entry point for all pointer input. It handles both fluid and ballpit
   * cursor types, manages pointer lifecycle, and delegates to appropriate handlers.
   * 
   * @param {number} x - X coordinate of the pointer
   * @param {number} y - Y coordinate of the pointer
   * @param {Array|string|null} [color=null] - Color for the pointer effect
   * @param {string} [id="default"] - Unique identifier for the pointer/user
   */
  updatePointerPosition(x, y, color = null, id = "default") {
    // Safety check for undefined coordinates
    if (x === undefined || y === undefined || x === null || y === null) {
      console.warn("InputManager: Invalid coordinates received:", x, y, "for user:", id);
      return;
    }
    
    const pointer = this._getOrCreatePointer(id, color);
    
    // Update pointer data
    pointer.x = x;
    pointer.y = y;
    pointer.lastSeen = performance.now();
    pointer.color = color || pointer.color;
    this._stats.totalUpdates++;

    // Handle based on cursor type
    if (this.options.cursorType === 'ballpit') {
      this._handleBallpitInput(pointer);
    } else {
      this._handleFluidInput(pointer);
    }

    // Trigger owner callback
    if (this.owner._onPointerInputChanged) {
      this.owner._onPointerInputChanged();
    }
  }

  /**
   * Handle input for ballpit cursor type
   * 
   * Processes pointer input for ballpit cursor. Handles ball assignment for eye gaze users
   * when ball assignment is enabled.
   * 
   * @param {Object} pointer - The pointer object to process
   * @private
   */
  _handleBallpitInput(pointer) {
    // For ballpit, we just update the pointer data
    // The owner will handle the actual ball physics
    // Assign balls to all non-mouse users (eye gaze, host-eye, etc.)
    if (this.options.useBallAssignment && pointer.id !== "mouse") {
      this._assignBallIndex(pointer.id);
    }
  }

  /**
   * Handle input for fluid cursor type
   * 
   * Processes pointer input for WebGL fluid simulation. Scales coordinates by pixel ratio,
   * updates pointer data, and ensures proper pointer management for fluid effects.
   * 
   * @param {Object} pointer - The pointer object to process
   * @private
   */
  _handleFluidInput(pointer) {
    // Safety check - ensure owner and canvas exist
    if (!this.owner || !this.owner.canvas) {
      console.warn("Owner or canvas is null in _handleFluidInput, skipping update");
      return;
    }
    
    if (this.owner._scaleByPixelRatio && this.owner._updatePointerMoveData && this.owner._getOrCreatePointer) {
      const posX = this.owner._scaleByPixelRatio(pointer.x);
      const posY = this.owner._scaleByPixelRatio(pointer.y);
      
      // make sure we're updating the cursor's pointer, not our internal clone
      const ownerPtr = this.owner._getOrCreatePointer(pointer.id || "default", pointer.color);
      this.owner._updatePointerMoveData(ownerPtr, posX, posY, pointer.color);
      ownerPtr.moved = true; // ensure a splat this frame
    }
  }

  /**
   * Get or create a pointer object for the specified ID
   * 
   * Creates a new pointer if one doesn't exist, or returns the existing one.
   * Handles color assignment and pointer initialization.
   * 
   * @param {string} id - Unique identifier for the pointer
   * @param {Array|string|null} [color=null] - Color for the pointer
   * @returns {Object} The pointer object
   * @private
   */
  _getOrCreatePointer(id, color = null) {
    if (!this._pointers.has(id)) {
      this._pointers.set(id, {
        id: id,
        x: 0,
        y: 0,
        lastSeen: 0,
        color: color,
        ballIndex: id === "mouse" ? 0 : null
      });
    }
    return this._pointers.get(id);
  }

  /**
   * Assign a unique ball index for eye gaze users
   * 
   * Assigns a unique ball index to eye gaze users for the ballpit cursor.
   * This allows multiple eye gaze users to have their own balls in the simulation.
   * 
   * @param {string} userType - The user type identifier
   * @private
   */
  _assignBallIndex(userType) {
    if (!this._eyegazeBallIndices.has(userType)) {
      const ballIndex = this._nextAvailableBallIndex++;
      this._eyegazeBallIndices.set(userType, ballIndex);
      const pointer = this._pointers.get(userType);
      if (pointer) pointer.ballIndex = ballIndex;
      console.log(`Assigned ball index ${ballIndex} to ${userType}`);
    }
    return this._eyegazeBallIndices.get(userType);
  }

  /**
   * Release ball index from user and clean up pointer
   * 
   * Removes the ball index assignment and deletes the pointer from storage.
   * Used when a user becomes inactive or disconnects.
   * 
   * @param {string} userType - The user type identifier to release
   * @private
   */
  _releaseBallIndex(userType) {
    if (this._eyegazeBallIndices.has(userType)) {
      const ballIndex = this._eyegazeBallIndices.get(userType);
      this._eyegazeBallIndices.delete(userType);
      this._pointers.delete(userType);
      console.log(`Released ball index ${ballIndex} from ${userType}`);
    }
  }

  // === Public API ===

  /**
   * Get all active pointers
   * 
   * Returns a copy of all currently active pointers with their current state.
   * Useful for debugging and external monitoring.
   * 
   * @returns {Array<Object>} Array of pointer objects with current state
   * @public
   */
  getActivePointers() {
    return Array.from(this._pointers.entries()).map(([id, pointer]) => ({
      id: pointer.id,
      x: pointer.x,
      y: pointer.y,
      lastSeen: pointer.lastSeen,
      color: pointer.color,
      ballIndex: pointer.ballIndex
    }));
  }

  /**
   * Get the target pointer with input prioritization
   * 
   * Returns the most appropriate pointer to use for cursor effects.
   * Prioritizes mouse input over eye gaze input.
   * 
   * @returns {Object|null} Target pointer object or null if no active pointers
   * @public
   */
  getTargetPointer() {
    // First try to use mouse input
    if (this._pointers.has("mouse")) {
      return this._pointers.get("mouse");
    } else {
      // Fallback to most recent eyegaze input
      let latest = null;
      let latestTime = -1;
      for (const [id, p] of this._pointers.entries()) {
        if (p.lastSeen > latestTime) {
          latestTime = p.lastSeen;
          latest = p;
        }
      }
      return latest;
    }
  }

  /**
   * Get eye gaze ball indices mapping
   * 
   * Returns a copy of the current ball index assignments for eye gaze users.
   * Useful for debugging and external monitoring of ball assignments.
   * 
   * @returns {Map<string, number>} Map of userType -> ballIndex
   * @public
   */
  getEyegazeBallIndices() {
    return new Map(this._eyegazeBallIndices);
  }

  /**
   * Get a specific pointer by its ID
   * 
   * Retrieves a pointer object by its unique identifier.
   * Returns null if the pointer doesn't exist.
   * 
   * @param {string} id - The unique pointer identifier
   * @returns {Object|null} Pointer object or null if not found
   * @public
   */
  getPointer(id) {
    return this._pointers.get(id) || null;
  }

  /**
   * Check if a pointer exists by its ID
   * 
   * @param {string} id - The unique pointer identifier to check
   * @returns {boolean} True if pointer exists, false otherwise
   * @public
   */
  hasPointer(id) {
    return this._pointers.has(id);
  }

  /**
   * Remove a specific pointer by its ID
   * 
   * Removes the pointer from storage and handles ball index cleanup if needed.
   * 
   * @param {string} id - The unique pointer identifier to remove
   * @returns {boolean} True if pointer was removed, false if it didn't exist
   * @public
   */
  removePointer(id) {
    if (this._pointers.has(id)) {
      if (this.options.useBallAssignment) {
        this._releaseBallIndex(id);
      } else {
        this._pointers.delete(id);
      }
      return true;
    }
    return false;
  }

  /**
   * Clean up inactive users based on timeout
   * 
   * Removes users who haven't been active for the specified timeout period.
   * Mouse users are never cleaned up automatically.
   * 
   * @param {number} [timeoutMs=null] - Timeout in milliseconds (uses default if null)
   * @returns {number} Number of users removed
   * @public
   */
  cleanupInactiveUsers(timeoutMs = null) {
    const timeout = timeoutMs || this.options.inactiveTimeout;
    const now = performance.now();
    let removed = 0;
    
    const toRemove = [];
    for (const [id, pointer] of this._pointers.entries()) {
      if (id !== "mouse" && (now - pointer.lastSeen) > timeout) {
        toRemove.push(id);
      }
    }
    
    toRemove.forEach(id => {
      if (this.options.useBallAssignment) {
        this._releaseBallIndex(id);
      } else {
        this._pointers.delete(id);
      }
      removed++;
    });
    
    if (removed > 0) {
      console.log(`Cleaned up ${removed} inactive users`);
    }
    
    return removed;
  }

  /**
   * Clear all non-mouse pointers
   * 
   * Removes all pointers except for the mouse pointer. Useful for cleanup
   * when switching contexts or resetting the input state.
   * 
   * @returns {number} Number of pointers removed
   * @public
   */
  clearNonMousePointers() {
    let removed = 0;
    const toRemove = [];
    
    for (const [id, pointer] of this._pointers.entries()) {
      if (id !== "mouse") {
        toRemove.push(id);
      }
    }
    
    toRemove.forEach(id => {
      if (this.options.useBallAssignment) {
        this._releaseBallIndex(id);
      } else {
        this._pointers.delete(id);
      }
      removed++;
    });
    
    return removed;
  }

  /**
   * Get usage statistics and performance metrics
   * 
   * Returns comprehensive statistics about the current state of the InputManager
   * including active pointers, performance metrics, and system health.
   * 
   * @returns {Object} Statistics object with current state information
   * @public
   */
  getStats() {
    const now = performance.now();
    const activePointers = this.getActivePointers();
    
    return {
      totalPointers: this._pointers.size,
      mouseActive: this._pointers.has("mouse"),
      eyegazeUsers: this._eyegazeBallIndices.size,
      activeBallIndices: Array.from(this._eyegazeBallIndices.values()),
      totalUpdates: this._stats.totalUpdates,
      lastCleanup: this._stats.lastCleanup,
      timeSinceLastCleanup: now - this._stats.lastCleanup,
      cursorType: this.options.cursorType,
      useBallAssignment: this.options.useBallAssignment
    };
  }

  /**
   * Update internal statistics timestamp
   * 
   * Updates the last cleanup timestamp for performance monitoring.
   * Called internally during cleanup operations.
   * 
   * @private
   */
  _updateStats() {
    this._stats.lastCleanup = performance.now();
  }

  /**
   * Reset all data and return to initial state
   * 
   * Clears all pointers, ball assignments, and statistics. Useful for
   * complete system reset or when switching contexts.
   * 
   * @public
   */
  reset() {
    this._pointers.clear();
    this._eyegazeBallIndices.clear();
    this._nextAvailableBallIndex = 1;
    this._stats = {
      totalUpdates: 0,
      lastCleanup: performance.now()
    };
  }

  /**
   * Set cursor type and reconfigure the InputManager
   * 
   * Updates the cursor type and automatically configures ball assignment
   * based on the cursor type (enabled for ballpit, disabled for fluid).
   * 
   * @param {string} type - The cursor type ('fluid' or 'ballpit')
   * @public
   */
  setCursorType(type) {
    this.options.cursorType = type;
    this.options.useBallAssignment = (type === 'ballpit');
  }
}

// Export for different module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = InputManager;
} else if (typeof define === 'function' && define.amd) {
  define([], function() {
    return InputManager;
  });
} else {
  // Make available globally
  window.InputManager = InputManager;
}

// ES6 module export
export default InputManager;
export { InputManager };
