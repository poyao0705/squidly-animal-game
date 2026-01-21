/**
 * @fileoverview Game Service - Pure Game Logic Layer
 * 
 * This module contains all game business logic without any dependencies on
 * Firebase, DOM, or external APIs. It provides pure functions and state management
 * for the fish game.
 * 
 * ## Design Principles
 * - No Firebase calls
 * - No DOM manipulation
 * - No global state access
 * - Pure functions where possible
 * - Testable in isolation
 * 
 * @module GameService
 */

/**
 * GameService - Pure game logic service layer
 * 
 * Manages game state and provides methods for game operations:
 * - Star generation and management
 * - Score calculation
 * - Game mode rules
 * - Grid size validation
 * 
 * @class
 */
class GameService {
  /**
   * Creates a new GameService instance
   * 
   * @constructor
   * @param {Object} [initialState={}] - Initial game state
   * @param {number} [initialState.score=0] - Starting score
   * @param {number} [initialState.gridSize=4] - Grid dimension (1-4)
   * @param {boolean} [initialState.isMultiplayerMode=false] - Game mode
   * @param {Array} [initialState.stars=[]] - Initial stars array
   */
  constructor(initialState = {}) {
    /**
     * Current game score
     * @type {number}
     */
    this.score = initialState.score ?? 0;

    /**
     * Grid dimension (1-4)
     * @type {number}
     */
    this.gridSize = this.validateGridSize(initialState.gridSize ?? 4);

    /**
     * Whether multiplayer mode is active
     * @type {boolean}
     */
    this.isMultiplayerMode = initialState.isMultiplayerMode ?? false;

    /**
     * Current stars array
     * @type {Array<{id: string, row: number, col: number}>}
     */
    this.stars = initialState.stars ?? [];
  }

  /**
   * Validates and clamps grid size to valid range (1-4)
   * 
   * @param {number} size - Grid size to validate
   * @returns {number} Validated grid size (1-4)
   */
  validateGridSize(size) {
    const n = Number(size);
    if (!Number.isFinite(n)) return 4;
    return Math.max(1, Math.min(4, Math.round(n)));
  }

  /**
   * Calculates how many stars should be generated for a given grid size
   * Uses 50% of total cells as the star count
   * 
   * @param {number} gridSize - Grid dimension
   * @returns {number} Number of stars to generate
   */
  calculateStarCount(gridSize) {
    const validSize = this.validateGridSize(gridSize);
    const totalCells = validSize * validSize;
    return Math.max(1, Math.ceil(totalCells / 2));
  }

  /**
   * Creates a unique star ID
   * 
   * @param {number} row - Grid row
   * @param {number} col - Grid column
   * @returns {string} Unique star ID
   */
  createStarId(row, col) {
    return `star_${row}_${col}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generates random star positions using Fisher-Yates shuffle algorithm
   * 
   * Pure function that generates stars without side effects.
   * 
   * @param {number} gridSize - Grid dimension (1-4)
   * @returns {Array<{id: string, row: number, col: number}>} Array of star objects
   */
  generateRandomStars(gridSize) {
    const validSize = this.validateGridSize(gridSize);
    const starCount = this.calculateStarCount(validSize);

    // Generate all possible grid cells
    const allCells = [];
    for (let row = 0; row < validSize; row++) {
      for (let col = 0; col < validSize; col++) {
        allCells.push({ row, col });
      }
    }

    // Fisher-Yates shuffle for random selection
    for (let i = allCells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allCells[i], allCells[j]] = [allCells[j], allCells[i]];
    }

    const selectedCells = allCells.slice(0, starCount);

    // Create star objects with unique IDs
    const stars = selectedCells.map((cell) => ({
      id: this.createStarId(cell.row, cell.col),
      row: cell.row,
      col: cell.col,
    }));

    return stars;
  }

  /**
   * Increments the score by 1
   * 
   * @returns {number} New score value
   */
  incrementScore() {
    this.score++;
    return this.score;
  }

  /**
   * Collects a star (removes it from stars array) and increments score
   * 
   * @param {string} starId - ID of the star to collect
   * @returns {Object} Result object with newScore and remainingStars
   * @returns {number} result.newScore - Updated score
   * @returns {Array} result.remainingStars - Stars array with collected star removed
   */
  collectStar(starId) {
    const remainingStars = this.stars.filter((s) => s.id !== starId);
    const newScore = this.incrementScore();

    // Update internal state
    this.stars = remainingStars;
    this.score = newScore;

    return {
      newScore,
      remainingStars,
    };
  }

  /**
   * Toggles a star at the given grid position
   * If a star exists at (row, col), removes it. Otherwise, adds a new star.
   * 
   * @param {number} row - Grid row (0-indexed)
   * @param {number} col - Grid column (0-indexed)
   * @returns {Array<{id: string, row: number, col: number}>} Updated stars array
   */
  toggleStarAtPosition(row, col) {
    const existingIndex = this.stars.findIndex(
      (s) => s.row === row && s.col === col
    );

    if (existingIndex >= 0) {
      // Remove existing star
      const newStars = [...this.stars];
      newStars.splice(existingIndex, 1);
      this.stars = newStars;
      return newStars;
    } else {
      // Add new star
      const newStar = {
        id: this.createStarId(row, col),
        row: row,
        col: col,
      };
      const newStars = [...this.stars, newStar];
      this.stars = newStars;
      return newStars;
    }
  }

  /**
   * Determines if stars should be auto-regenerated
   * 
   * Stars should regenerate in single-player mode when all are collected.
   * In multiplayer mode, host must manually place stars.
   * 
   * @param {Array} stars - Current stars array
   * @param {boolean} isMultiplayerMode - Whether multiplayer mode is active
   * @returns {boolean} True if stars should be regenerated
   */
  shouldRegenerateStars(stars, isMultiplayerMode) {
    return !isMultiplayerMode && (!stars || stars.length === 0);
  }

  /**
   * Sets the game mode and returns actions to take
   * 
   * Pure logic for mode switching - returns what should happen,
   * but doesn't perform side effects.
   * 
   * @param {string} mode - "single-player" or "multiplayer"
   * @param {boolean} currentIsMultiplayer - Current multiplayer state
   * @returns {Object} Mode change result
   * @returns {boolean} result.isMultiplayer - New multiplayer state
   * @returns {boolean} result.shouldClearStars - Whether to clear stars
   * @returns {boolean} result.shouldGenerateStars - Whether to generate new stars
   */
  setGameMode(mode, currentIsMultiplayer) {
    const isMultiplayer = mode === "multiplayer";

    // Skip if no change
    if (currentIsMultiplayer === isMultiplayer) {
      return {
        isMultiplayer,
        shouldClearStars: false,
        shouldGenerateStars: false,
        changed: false,
      };
    }

    if (isMultiplayer) {
      // MULTIPLAYER MODE: Clear stars, host will place manually
      return {
        isMultiplayer: true,
        shouldClearStars: true,
        shouldGenerateStars: false,
        changed: true,
      };
    } else {
      // SINGLE-PLAYER MODE: Generate random stars
      return {
        isMultiplayer: false,
        shouldClearStars: false,
        shouldGenerateStars: true,
        changed: true,
      };
    }
  }

  /**
   * Sets the grid size (validates and updates internal state)
   * 
   * @param {number} size - New grid size
   * @returns {number} Validated grid size
   */
  setGridSize(size) {
    this.gridSize = this.validateGridSize(size);
    return this.gridSize;
  }

  /**
   * Sets the stars array (for syncing from external source)
   * 
   * @param {Array<{id: string, row: number, col: number}>} stars - Stars array
   */
  setStars(stars) {
    this.stars = Array.isArray(stars) ? stars : [];
  }

  /**
   * Sets the score (for syncing from external source)
   * 
   * @param {number} score - New score value
   */
  setScore(score) {
    const n = Number(score);
    if (Number.isFinite(n) && n >= 0) {
      this.score = n;
    }
  }

  /**
   * Gets current game state snapshot
   * 
   * @returns {Object} Current game state
   */
  getState() {
    return {
      score: this.score,
      gridSize: this.gridSize,
      isMultiplayerMode: this.isMultiplayerMode,
      stars: [...this.stars], // Return copy to prevent mutation
    };
  }
}

export default GameService;
export { GameService };
