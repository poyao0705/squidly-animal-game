/**
 * @fileoverview Squidly Fish Game - Main Application Controller
 * 
 * This module manages the game state, Firebase synchronization, and UI for the
 * fish star-collecting game. It serves as the bridge between the WebGL renderer
 * (fish-cursor.js) and the Squidly platform APIs (Firebase, cursor listeners).
 * 
 * ## Architecture Overview
 * 
 * ```
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                        app.js (this file)                       │
 * │                                                                 │
 * │  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐  │
 * │  │   FishGame      │  │  Firebase Sync  │  │   UI Elements  │  │
 * │  │   (Class)       │◄─┤  (Multiplayer)  │  │ (Score, Grid)  │  │
 * │  └────────┬────────┘  └────────┬────────┘  └───────┬────────┘  │
 * │           │                    │                   │           │
 * └───────────┼────────────────────┼───────────────────┼───────────┘
 *             │                    │                   │
 *             ▼                    ▼                   ▼
 *     ┌───────────────┐    ┌─────────────┐    ┌──────────────┐
 *     │ WebGLFishCursor│    │   Firebase  │    │     DOM      │
 *     │ (fish-cursor.js)│    │   Database  │    │   (HTML)     │
 *     └───────────────┘    └─────────────┘    └──────────────┘
 * ```
 * 
 * ## Game Modes
 * 
 * ### Single-Player Mode (default)
 * - Host controls the fish with their mouse/eye tracker
 * - Stars are randomly generated when collected
 * - Good for solo play or demos
 * 
 * ### Multiplayer Mode
 * - **Host**: Cannot control fish, instead uses grid UI to place stars
 * - **Participant**: Controls fish with their input, collects stars
 * - Stars sync via Firebase so both see the same state
 * - Score syncs via Firebase for shared display
 * 
 * ## External Dependencies (provided by Squidly platform)
 * 
 * These globals are injected by the Squidly platform:
 * - `session_info` - Object with { user: "host"|"participant" }
 * - `firebaseSet(path, value)` - Write to Firebase Realtime Database
 * - `firebaseOnValue(path, callback, options)` - Subscribe to Firebase changes
 * - `addCursorListener(callback)` - Receive cursor/eye-tracking data
 * - `setIcon(row, col, config, onClick)` - Add UI icons to sidebar
 * 
 * ## Firebase Data Structure
 * 
 * ```
 * fish-game/
 * ├── gridSize: 4                          // Star grid dimension (1-4)
 * ├── score: 0                             // Current score
 * ├── gameMode: "single-player"|"multiplayer"
 * └── stars: [                             // Array of star objects
 *       { id: "star_0_1_123...", row: 0, col: 1 },
 *       { id: "star_2_3_456...", row: 2, col: 3 },
 *       ...
 *     ]
 * ```
 * 
 * @module FishGame
 * @requires WebGLFishCursor from ./index.js
 */

import { WebGLFishCursor } from "./index.js";
import GameService from "./game-service.js";

/**
 * FishGame - Main game controller class
 * 
 * Manages all game state, Firebase synchronization, and UI for the fish
 * star-collecting game. Exposed as `window.fishGame` for platform access.
 * 
 * @class
 * @example
 * // Create and start the game
 * const game = new FishGame();
 * document.addEventListener("DOMContentLoaded", () => game.start());
 */
class FishGame {
  /**
   * Creates a new FishGame instance.
   * 
   * Initializes all game state but does NOT start the game.
   * Call start() after DOMContentLoaded to begin.
   * 
   * @constructor
   */
  constructor() {
    // ========================================================================
    // HOST DETECTION
    // ========================================================================

    /**
     * Whether session_info is available from the Squidly platform.
     * @type {boolean}
     * @private
     */
    const hasSessionInfo = typeof session_info !== "undefined" && session_info != null;

    /**
     * Whether this client is the host (vs participant).
     * Determined at startup from session_info.
     * 
     * Host responsibilities:
     * - Initialize Firebase default values
     * - Place stars in multiplayer mode
     * - Cannot control fish in multiplayer mode
     * @type {boolean}
     */
    this.isHost = hasSessionInfo ? session_info?.user === "host" : true;

    console.log("[FishGame] Session info:", { hasSessionInfo, isHost: this.isHost });

    // ========================================================================
    // CORE STATE
    // ========================================================================

    /**
     * Reference to the active WebGLFishCursor instance.
     * Provides access to the 3D renderer and its methods.
     * @type {WebGLFishCursor|null}
     */
    this.currentCursor = null;

    /**
     * Flag to prevent Firebase write loops during sync.
     * When true, local changes won't trigger Firebase writes.
     * @type {boolean}
     * @private
     */
    this._isSyncingFromRemote = false;

    // ========================================================================
    // GAME SETTINGS
    // ========================================================================

    /**
     * Star grid dimension (1-4). Creates an NxN grid for star placement.
     * - 1: Single star position
     * - 4: 4x4 = 16 possible positions (default)
     * @type {number}
     */
    this.gridSize = 4;

    /**
     * Current game score (stars collected).
     * Synced with Firebase for shared display.
     * @type {number}
     */
    this.score = 0;

    // ========================================================================
    // UI ELEMENT REFERENCES
    // ========================================================================

    /**
     * Reference to the score number span element.
     * Updated when score changes.
     * @type {HTMLElement|null}
     * @private
     */
    this._scoreElement = null;

    /**
     * Reference to the star control grid container (host only, multiplayer).
     * @type {HTMLElement|null}
     * @private
     */
    this._starGridElement = null;

    /**
     * Array of star cell UI elements with their grid positions.
     * Format: [{ row, col, element }, ...]
     * @type {Array<{row: number, col: number, element: HTMLElement}>}
     * @private
     */
    this._starCells = [];

    // ========================================================================
    // MODE FLAGS
    // ========================================================================

    /**
     * Whether multiplayer mode is active.
     * - false: Single-player (host controls fish, random stars)
     * - true: Multiplayer (participant controls fish, host places stars)
     * @type {boolean}
     */
    this.isMultiplayerMode = false;

    // ========================================================================
    // FIREBASE SYNC STATE
    // ========================================================================

    /**
     * Local cache of star data from Firebase.
     * Array of { id, row, col } objects representing current stars.
     * @type {Array<{id: string, row: number, col: number}>}
     */
    this.firebaseStars = [];

    /**
     * Whether Firebase star listener has been set up.
     * Prevents duplicate listeners.
     * @type {boolean}
     * @private
     */
    this._firebaseStarsSyncInitialized = false;

    // ========================================================================
    // GAME SERVICE
    // ========================================================================

    /**
     * Pure game logic service layer.
     * @type {GameService}
     * @private
     */
    this._gameService = new GameService();
  }

  // ==========================================================================
  // INITIALIZATION METHODS
  // ==========================================================================

  /**
   * Starts the game after DOM is ready.
   * 
   * This method should be called once after DOMContentLoaded.
   * It initializes:
   * 1. Host defaults in Firebase (if host)
   * 2. WebGL fish cursor
   * 3. Event listeners
   * 4. Firebase subscriptions
   * 5. Sidebar icons
   * 
   * @memberof FishGame
   */
  start() {
    // Initialize host defaults first (only runs for host)
    this._initializeHostDefaults();

    // Initialize the WebGL fish cursor
    this.init();

    // Set up event listeners (mouse, cursor API)
    this._setupEventListeners();

    // Set up Firebase subscriptions
    this._setupFirebaseSubscriptions();

    // Set up sidebar icons
    this._setupSidebarIcons();
  }

  /**
   * Initializes the fish cursor.
   * 
   * Process:
   * 1. Create new WebGLFishCursor with current settings
   * 2. Configure grid size and sync stars
   * 
   * @memberof FishGame
   */
  init() {
    // Create new fish cursor with current mode settings
    this.currentCursor = new WebGLFishCursor({
      isMultiplayerMode: this.isMultiplayerMode,
      isHost: this.isHost,
      onStarCollected: (starId) => {
        this.onStarCollected(starId);
      },
    });

    // Apply current grid size
    this.currentCursor.setStarGrid(this.gridSize);

    // Sync existing stars from Firebase
    if (this.isMultiplayerMode) {
      this.currentCursor.syncStarsFromFirebase(this.firebaseStars);
    }
  }

  /**
   * Initializes Firebase default values for host.
   * 
   * Only the host initializes defaults to prevent race conditions
   * and avoid resetting values (especially score) when participants join.
   * 
   * @memberof FishGame
   * @private
   */
  _initializeHostDefaults() {
    if (!this.isHost) return;

    // Use firebaseOnValue to check if values exist before setting defaults
    // This prevents overwriting existing game state on page reload
    firebaseOnValue("fish-game/gridSize", (value) => {
      if (value === null || value === undefined) {
        firebaseSet("fish-game/gridSize", 4);
      }
    }, { onlyOnce: true });

    firebaseOnValue("fish-game/score", (value) => {
      if (value === null || value === undefined) {
        firebaseSet("fish-game/score", 0);
      }
    }, { onlyOnce: true });

    firebaseOnValue("fish-game/gameMode", (value) => {
      if (value === null || value === undefined) {
        firebaseSet("fish-game/gameMode", "single-player");
      }
    }, { onlyOnce: true });
  }

  /**
   * Sets up event listeners for input.
   * 
   * @memberof FishGame
   * @private
   */
  _setupEventListeners() {
    // Local mouse input
    // Provides direct control from this browser window's mouse.
    // Tagged as "host" or "participant" based on session_info.
    // In multiplayer mode, only participant input affects the fish.
    document.addEventListener("mousemove", (e) => {
      this.updatePointerPosition(e.clientX, e.clientY, null, !this.isHost);
    });

    // Squidly cursor API listener
    // Receives cursor/eye-tracking data from the Squidly platform.
    // This is the primary input method for the game - supports:
    // - Mouse tracking
    // - Eye tracking
    // - Both host and participant inputs
    // 
    // data.user values:
    // - "host-eyes" / "host-mouse" - Input from the host
    // - "participant-eyes" / "participant-mouse" - Input from participant
    addCursorListener((data) => {
      const isParticipant = data.user.includes("participant");
      this.updatePointerPosition(data.x, data.y, null, isParticipant);
    });
  }

  /**
   * Sets up Firebase subscriptions for game state sync.
   * 
   * @memberof FishGame
   * @private
   */
  _setupFirebaseSubscriptions() {
    // Grid size sync
    // When size changes: update cursor, recreate control grid, regenerate stars
    firebaseOnValue("fish-game/gridSize", (value) => {
      // Use GameService to validate grid size (pure logic)
      const validatedSize = this._gameService.validateGridSize(value);
      const sizeChanged = this.gridSize !== validatedSize;

      if (sizeChanged) {
        // Update service and local state
        this._gameService.setGridSize(validatedSize);
        this.gridSize = validatedSize;

        // Update WebGL cursor's star grid
        if (this.currentCursor) {
          this.currentCursor.setStarGrid(validatedSize);
        }

        // Recreate host control grid with new dimensions
        this._createStarControlGrid();

        // In single-player: new grid size means regenerate stars
        if (!this.isMultiplayerMode && this.isHost) {
          this._generateRandomStarsToFirebase();
        }
      }
    });

    // Create score display UI
    this._createScoreDisplay();

    // Score sync - updates display when any client collects stars
    firebaseOnValue("fish-game/score", (value) => {
      const score = Number(value);
      if (Number.isFinite(score) && score >= 0) {
        // Sync to service and local state
        this._gameService.setScore(score);
        this.score = score;
        this._updateScoreDisplay();
      }
    });

    // Initialize Firebase star sync (both host and participant need this)
    // This subscription handles the core multiplayer star synchronization
    this._initializeFirebaseStarsSync();

    // Game mode sync - switches between single-player and multiplayer
    firebaseOnValue("fish-game/gameMode", (value) => {
      this._setGameMode(value);
    });
  }

  /**
   * Sets up sidebar control icons.
   * 
   * @memberof FishGame
   * @private
   */
  _setupSidebarIcons() {
    // Grid size INCREASE button (+)
    // Increases grid from current size up to max of 4
    setIcon(
      1,    // Row 1
      0,    // Column 0
      {
        symbol: "add",
        displayValue: "Grid +",
        type: "action",
      },
      () => {
        const newSize = Math.min(4, this.gridSize + 1);
        if (newSize !== this.gridSize) {
          firebaseSet("fish-game/gridSize", newSize);
        }
      }
    );

    // Grid size DECREASE button (-)
    // Decreases grid from current size down to min of 1
    setIcon(
      2,    // Row 2
      0,    // Column 0
      {
        symbol: "minus",
        displayValue: "Grid -",
        type: "action",
      },
      () => {
        const newSize = Math.max(1, this.gridSize - 1);
        if (newSize !== this.gridSize) {
          firebaseSet("fish-game/gridSize", newSize);
        }
      }
    );

    // Game mode TOGGLE button
    // Shows what clicking will switch TO (not current mode)
    // Initial state: shows "Multiplayer" (click to switch to multiplayer)
    setIcon(
      3,    // Row 3
      0,    // Column 0
      {
        symbol: "group",           // Group icon (will switch to multiplayer)
        displayValue: "Multiplayer",
        type: "action",
      },
      () => {
        // Toggle between modes
        const newMode = this.isMultiplayerMode ? "single-player" : "multiplayer";
        firebaseSet("fish-game/gameMode", newMode);
      }
    );
  }

  // ==========================================================================
  // GAME MODE MANAGEMENT
  // ==========================================================================

  /**
   * Sets the game mode and updates all dependent systems.
   * 
   * ## Mode Differences
   * 
   * | Feature          | Single-Player      | Multiplayer           |
   * |------------------|--------------------|-----------------------|
   * | Fish Control     | Host               | Participant only      |
   * | Star Generation  | Automatic (random) | Manual (host grid UI) |
   * | Star Grid UI     | Hidden             | Visible (host only)   |
   * 
   * ## What This Method Does
   * 1. Uses GameService to determine mode change actions
   * 2. Updates UI based on mode (grid visibility)
   * 3. Clears or generates stars based on mode
   * 4. Updates WebGLFishCursor mode
   * 5. Updates mode toggle icon
   * 
   * @param {string} mode - "single-player" or "multiplayer"
   * @memberof FishGame
   * @private
   */
  _setGameMode(mode) {
    // Use GameService to determine mode change actions (pure logic)
    const modeResult = this._gameService.setGameMode(mode, this.isMultiplayerMode);

    // Skip if no change
    if (!modeResult.changed) return;

    // Update local and service state
    this.isMultiplayerMode = modeResult.isMultiplayer;
    this._gameService.isMultiplayerMode = modeResult.isMultiplayer;
    console.log("[FishGame] Game mode set to:", mode);

    // Handle star clearing/generation based on service logic
    if (modeResult.shouldClearStars) {
      // MULTIPLAYER MODE: Clear all stars (host will place them manually)
      firebaseSet("fish-game/stars", []);
      this.firebaseStars = [];
      this._gameService.setStars([]);
      if (this.isHost) {
        this._createStarControlGrid();
      }
    } else if (modeResult.shouldGenerateStars) {
      // SINGLE-PLAYER MODE: Hide manual grid UI and auto-generate random stars
      this._destroyStarControlGrid();
      if (this.isHost) {
        this._generateRandomStarsToFirebase();
      }
    }

    // Update cursor's internal mode (affects control logic)
    if (this.currentCursor && this.currentCursor.setMultiplayerMode) {
      this.currentCursor.setMultiplayerMode(modeResult.isMultiplayer);
    }

    // Update the sidebar icon to show what mode we'll switch TO
    this._updateModeIcon();
  }

  /**
   * Updates the mode toggle icon in the Squidly sidebar.
   * 
   * The icon shows the mode it will switch TO (opposite of current):
   * - In single-player: shows "group" icon / "Multiplayer" text
   * - In multiplayer: shows "person" icon / "Single-Player" text
   * 
   * Clicking the icon triggers a Firebase write that all clients receive.
   * 
   * @memberof FishGame
   * @private
   */
  _updateModeIcon() {
    // Icon shows the TARGET mode (what clicking will switch to)
    const symbol = this.isMultiplayerMode ? "person" : "group";
    const displayValue = this.isMultiplayerMode ? "Single-Player" : "Multiplayer";

    setIcon(
      3,    // Row 3
      0,    // Column 0
      {
        symbol: symbol,
        displayValue: displayValue,
        type: "action",
      },
      () => {
        // Toggle mode via Firebase (syncs to all clients)
        const newMode = this.isMultiplayerMode ? "single-player" : "multiplayer";
        firebaseSet("fish-game/gameMode", newMode);
      }
    );
  }

  // ==========================================================================
  // FIREBASE SYNC METHODS
  // ==========================================================================

  /**
   * Initializes the Firebase listener for star data.
   * 
   * Called once at startup for both host and participant.
   * The listener triggers _onFirebaseStarsUpdate whenever star data changes.
   * 
   * This is the foundation of multiplayer sync - any client changing stars
   * writes to Firebase, and all clients receive the update through this listener.
   * 
   * @memberof FishGame
   * @private
   */
  _initializeFirebaseStarsSync() {
    if (this._firebaseStarsSyncInitialized) return;

    this._firebaseStarsSyncInitialized = true;

    // Subscribe to star changes
    firebaseOnValue("fish-game/stars", (value) => {
      this._onFirebaseStarsUpdate(value);
    });
  }

  /**
   * Generates random star positions and writes them to Firebase.
   * 
   * Called by host in single-player mode when:
   * - Game first starts
   * - All stars are collected
   * - Grid size changes
   * 
   * Uses GameService for pure star generation logic, then syncs to Firebase.
   * 
   * @memberof FishGame
   * @private
   */
  _generateRandomStarsToFirebase() {
    // Only host should generate stars
    if (!this.isHost) return;

    // Use GameService to generate stars (pure logic)
    const stars = this._gameService.generateRandomStars(this.gridSize);

    // Update service state
    this._gameService.setStars(stars);
    this.firebaseStars = stars;

    // Write to Firebase - this triggers sync to all clients
    firebaseSet("fish-game/stars", stars);
  }

  /**
   * Increments the score by 1 and syncs to Firebase.
   * Called when a star is collected.
   * 
   * Uses GameService for score calculation, then syncs to Firebase and updates UI.
   * 
   * @memberof FishGame
   */
  incrementScore() {
    // Use GameService to increment score (pure logic)
    const newScore = this._gameService.incrementScore();

    // Update local state
    this.score = newScore;

    // Sync to Firebase and update UI (controller responsibilities)
    firebaseSet("fish-game/score", newScore);
    this._updateScoreDisplay();
  }

  /**
   * Updates the score display element with current score.
   * 
   * @memberof FishGame
   * @private
   */
  _updateScoreDisplay() {
    if (this._scoreElement) {
      this._scoreElement.textContent = this.score;
    }
  }

  /**
   * Firebase listener callback - called when star data changes.
   * 
   * This is the central sync point for star state:
   * 1. Updates local cache (firebaseStars)
   * 2. Updates grid UI cell states (host only, multiplayer)
   * 3. Syncs to WebGLFishCursor for rendering
   * 4. Triggers star regeneration if empty (single-player, host only)
   * 
   * @param {Array|null} stars - Star data from Firebase
   * @memberof FishGame
   * @private
   */
  _onFirebaseStarsUpdate(stars) {
    // Update local cache and service state
    this.firebaseStars = Array.isArray(stars) ? stars : [];
    this._gameService.setStars(this.firebaseStars);

    // Update grid UI to show which cells have stars (host multiplayer only)
    this._updateStarCellStates();

    // Sync to WebGL renderer
    if (this.currentCursor) {
      this.currentCursor.syncStarsFromFirebase(this.firebaseStars);
    }

    // AUTO-REGENERATION (single-player mode only)
    // Use GameService to determine if regeneration should happen
    if (this.isHost && this._firebaseStarsSyncInitialized &&
      this._gameService.shouldRegenerateStars(this.firebaseStars, this.isMultiplayerMode)) {
      // Small delay to avoid race conditions on initial load
      setTimeout(() => {
        if (this._gameService.shouldRegenerateStars(this.firebaseStars, this.isMultiplayerMode)) {
          this._generateRandomStarsToFirebase();
        }
      }, 500);
    }
  }

  /**
   * Callback from WebGLFishCursor when fish collides with a star.
   * 
   * This method:
   * 1. Uses GameService to collect star and increment score
   * 2. Syncs updated state to Firebase
   * 
   * Note: Only the client controlling the fish calls this (collision authority).
   * This prevents double-counting when both clients see the same collision.
   * 
   * @param {string} starId - Unique identifier of the collected star
   * @memberof FishGame
   */
  onStarCollected(starId) {
    if (!starId) return;

    // Use GameService to collect star (pure logic: removes star, increments score)
    const result = this._gameService.collectStar(starId);

    // Update local state
    this.score = result.newScore;
    this.firebaseStars = result.remainingStars;

    // Sync to Firebase (triggers sync to all clients)
    firebaseSet("fish-game/score", result.newScore);
    firebaseSet("fish-game/stars", result.remainingStars);
    this._updateScoreDisplay();
    console.log(`[FishGame] Star collected and removed from Firebase: ${starId}`);
  }

  // ==========================================================================
  // UI CREATION METHODS
  // ==========================================================================

  /**
   * Creates the score display overlay in the top-right corner.
   * 
   * The display shows:
   * - Star emoji icon
   * - Current score number
   * 
   * Styled with a golden gradient background to match the star theme.
   * Uses pointer-events: none so it doesn't interfere with gameplay.
   * 
   * @memberof FishGame
   * @private
   */
  _createScoreDisplay() {
    // Only create once
    if (this._scoreElement) return;

    // Container with golden gradient background
    const container = document.createElement("div");
    container.id = "score-container";
    Object.assign(container.style, {
      position: "fixed",
      top: "20px",
      right: "20px",
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "12px 20px",
      background: "linear-gradient(135deg, rgba(255, 234, 0, 0.9), rgba(255, 180, 0, 0.9))",
      borderRadius: "16px",
      boxShadow: "0 4px 20px rgba(255, 200, 0, 0.4)",
      zIndex: "9999",
      fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
      pointerEvents: "none",  // Don't block clicks
    });

    // Star emoji
    const starIcon = document.createElement("span");
    starIcon.textContent = "\u2B50";  // ⭐
    starIcon.style.fontSize = "28px";

    // Score number
    this._scoreElement = document.createElement("span");
    Object.assign(this._scoreElement.style, {
      fontSize: "32px",
      fontWeight: "bold",
      color: "#333",
      textShadow: "1px 1px 2px rgba(255, 255, 255, 0.8)",
    });
    this._scoreElement.textContent = this.score;

    container.appendChild(starIcon);
    container.appendChild(this._scoreElement);
    document.body.appendChild(container);
  }

  /**
   * Creates the star control grid UI for host in multiplayer mode.
   * 
   * The grid allows the host to manually place/remove stars by clicking cells.
   * Each cell displays a star emoji that's highlighted when a star exists there.
   * 
   * ## Grid Layout
   * ```
   * ┌─────┬─────┬─────┬─────┐
   * │(0,0)│(0,1)│(0,2)│(0,3)│
   * ├─────┼─────┼─────┼─────┤
   * │(1,0)│(1,1)│(1,2)│(1,3)│
   * ├─────┼─────┼─────┼─────┤
   * │(2,0)│(2,1)│(2,2)│(2,3)│
   * ├─────┼─────┼─────┼─────┤
   * │(3,0)│(3,1)│(3,2)│(3,3)│
   * └─────┴─────┴─────┴─────┘
   * ```
   * 
   * The grid size is determined by this.gridSize (1-4).
   * Grid styling is defined in style.css via .star-control-grid and .star-control-cell classes.
   * 
   * @memberof FishGame
   * @private
   */
  _createStarControlGrid() {
    // Only create for host in multiplayer mode
    if (!this.isMultiplayerMode || !this.isHost) return;

    // Remove existing grid if any
    this._destroyStarControlGrid();

    // Create grid container
    const grid = document.createElement("div");
    grid.className = "star-control-grid";
    grid.id = "star-control-grid";
    // Set CSS grid dimensions
    grid.style.gridTemplateColumns = `repeat(${this.gridSize}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${this.gridSize}, 1fr)`;

    this._starCells = [];

    // Create cells for each grid position
    for (let row = 0; row < this.gridSize; row++) {
      for (let col = 0; col < this.gridSize; col++) {
        const cell = document.createElement("div");
        cell.className = "star-control-cell";
        cell.dataset.row = row;
        cell.dataset.col = col;

        // Star emoji inside cell
        const starIcon = document.createElement("span");
        starIcon.className = "star-icon";
        starIcon.textContent = "\u2B50";  // ⭐
        cell.appendChild(starIcon);

        // Click handler for toggling star
        cell.addEventListener("click", () => {
          this._onStarCellClick(row, col, cell);
        });

        grid.appendChild(cell);
        this._starCells.push({ row, col, element: cell });
      }
    }

    document.body.appendChild(grid);
    this._starGridElement = grid;

    // Apply initial cell states based on current Firebase stars
    this._updateStarCellStates();
  }

  /**
   * Removes the star control grid from the DOM.
   * Called when switching to single-player mode or cleaning up.
   * 
   * @memberof FishGame
   * @private
   */
  _destroyStarControlGrid() {
    if (this._starGridElement) {
      this._starGridElement.remove();
      this._starGridElement = null;
    }
    this._starCells = [];
  }

  /**
   * Updates the visual state of grid cells to show which have stars.
   * 
   * Cells with stars get the "has-star" CSS class, which typically:
   * - Highlights the star emoji
   * - Changes background color
   * - Adds visual emphasis
   * 
   * Called whenever Firebase star data changes.
   * 
   * @memberof FishGame
   * @private
   */
  _updateStarCellStates() {
    if (!this._starCells.length) return;

    this._starCells.forEach(({ row, col, element }) => {
      // Check if Firebase has a star at this position
      const hasStar = this.firebaseStars.some(
        (s) => s.row === row && s.col === col
      );

      // Toggle CSS class
      if (hasStar) {
        element.classList.add("has-star");
      } else {
        element.classList.remove("has-star");
      }
    });
  }

  /**
   * Handles click on a star grid cell - toggles star at that position.
   * 
   * - If star exists at (row, col): removes it from Firebase
   * - If no star exists: creates new star with unique ID and adds to Firebase
   * 
   * Uses GameService for toggle logic, then syncs to Firebase.
   * All changes go through Firebase, which triggers sync to all clients
   * (including this one, updating the WebGL renderer).
   * 
   * @param {number} row - Grid row (0-indexed from top)
   * @param {number} col - Grid column (0-indexed from left)
   * @param {HTMLElement} cellElement - The clicked cell element (unused but available)
   * @memberof FishGame
   * @private
   */
  _onStarCellClick(row, col, cellElement) {
    // Ensure service has current stars state
    this._gameService.setStars(this.firebaseStars);

    // Use GameService to toggle star (pure logic)
    const newStars = this._gameService.toggleStarAtPosition(row, col);

    // Update local state
    this.firebaseStars = newStars;

    // Sync to Firebase (triggers sync to all clients)
    firebaseSet("fish-game/stars", newStars);
  }

  // ==========================================================================
  // INPUT HANDLING
  // ==========================================================================

  /**
   * Updates pointer position in the WebGL cursor.
   * 
   * Routes pointer data to the InputManager with the appropriate ID.
   * The cursor uses this to determine which pointer controls the fish.
   * 
   * @param {number} x - Pointer X coordinate (screen pixels)
   * @param {number} y - Pointer Y coordinate (screen pixels)
   * @param {string|null} color - Optional color for pointer visualization
   * @param {boolean} isParticipant - true if from participant, false if from host
   * @memberof FishGame
   */
  updatePointerPosition(x, y, color = null, isParticipant = false) {
    if (!this.currentCursor || !this.currentCursor.inputManager) return;

    // Tag pointer with appropriate ID for control logic
    const pointerId = isParticipant ? "participant" : "host";
    this.currentCursor.inputManager.updatePointerPosition(x, y, color, pointerId);
  }
}

// ============================================================================
// APPLICATION BOOTSTRAP
// ============================================================================

// Create game instance immediately (for platform access)
window.fishGame = new FishGame();

// Start the game after DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  window.fishGame.start();
});
