/**
 * Squidly Animal Game - Main Application
 *
 * Manages interactive animal-themed cursor effects.
 * 
 * Dual-mode operation:
 * - Host-only mode: Random star generation, host controls fish (original behavior)
 * - Multiplayer mode: Host spawns stars via grid UI, only participant controls fish
 */

import { WebGLFishCursor } from "./index.js";

const ANIMAL_TYPE_METHODS = {
  "animal-game/fish": "_switchToFish",
};

// Detect session info for host identification
const hasSessionInfo = typeof session_info !== "undefined" && session_info != null;
const isHost = hasSessionInfo ? session_info?.user === "host" : true;

console.log("[AnimalGame] Session info:", { hasSessionInfo, isHost });

// Only host initializes default Firebase values to prevent race conditions
// and avoid resetting values (especially score) when participants join
if (isHost) {
  // Use firebaseOnValue to check if values exist before setting defaults
  // This prevents overwriting existing game state on page reload
  firebaseOnValue("animal-game/currentType", (value) => {
    if (value === null || value === undefined) {
      firebaseSet("animal-game/currentType", "animal-game/fish");
    }
  }, { onlyOnce: true });

  firebaseOnValue("animal-game/gridSize", (value) => {
    if (value === null || value === undefined) {
      firebaseSet("animal-game/gridSize", 4);
    }
  }, { onlyOnce: true });

  firebaseOnValue("animal-game/score", (value) => {
    if (value === null || value === undefined) {
      firebaseSet("animal-game/score", 0);
    }
  }, { onlyOnce: true });

  firebaseOnValue("animal-game/gameMode", (value) => {
    if (value === null || value === undefined) {
      firebaseSet("animal-game/gameMode", "single-player");
    }
  }, { onlyOnce: true });
}

// Note: Stars are now always synced via Firebase
// Host will generate random stars when Firebase sync initializes and no stars exist

window.animalGame = {
  currentType: null,
  currentCursor: null,
  switching: false,
  _isSyncingFromRemote: false,
  gridSize: 4,
  score: 0,
  _scoreElement: null,
  _starGridElement: null,
  _starCells: [],

  // Mode flags
  isHost: isHost,
  isMultiplayerMode: false,

  // Current stars in Firebase (multiplayer mode)
  firebaseStars: [],

  // Track if Firebase star sync is initialized
  _firebaseStarsSyncInitialized: false,

  /**
   * Set the game mode explicitly.
   * @param {string} mode - "single-player" or "multiplayer"
   */
  _setGameMode: function (mode) {
    const isMultiplayer = mode === "multiplayer";

    // Skip if no change
    if (this.isMultiplayerMode === isMultiplayer) return;

    this.isMultiplayerMode = isMultiplayer;
    console.log("[AnimalGame] Game mode set to:", mode);

    if (isMultiplayer) {
      // Multiplayer: Clear auto-generated stars, show grid for manual placement
      firebaseSet("animal-game/stars", []);
      if (this.isHost) {
        this._createStarControlGrid();
      }
    } else {
      // Single-player: Hide grid, auto-generate stars
      this._destroyStarControlGrid();
      if (this.isHost) {
        this._generateRandomStarsToFirebase();
      }
    }

    // Update cursor mode without recreating it
    if (this.currentCursor && this.currentCursor.setMultiplayerMode) {
      this.currentCursor.setMultiplayerMode(isMultiplayer);
    }

    // Update the mode toggle icon display
    this._updateModeIcon();
  },

  /**
   * Update the mode toggle icon to reflect current mode.
   */
  _updateModeIcon: function () {
    // Show the mode it will switch TO (opposite of current)
    const symbol = this.isMultiplayerMode ? "person" : "group";
    const displayValue = this.isMultiplayerMode ? "Single-Player" : "Multiplayer";

    setIcon(
      3,
      0,
      {
        symbol: symbol,
        displayValue: displayValue,
        type: "action",
      },
      () => {
        const newMode = window.animalGame.isMultiplayerMode ? "single-player" : "multiplayer";
        firebaseSet("animal-game/gameMode", newMode);
      }
    );
  },

  /**
   * Initialize Firebase star sync listener.
   * This should be called on startup for both host and participant.
   */
  _initializeFirebaseStarsSync: function () {
    if (this._firebaseStarsSyncInitialized) return;

    this._firebaseStarsSyncInitialized = true;

    // Set up Firebase listener for stars
    firebaseOnValue("animal-game/stars", (value) => {
      window.animalGame._onFirebaseStarsUpdate(value);
    });

    console.log("[AnimalGame] Firebase star sync initialized");
  },

  /**
   * Generate random star positions and write to Firebase.
   * Called by host to initialize stars.
   */
  _generateRandomStarsToFirebase: function () {
    if (!this.isHost) return;

    const gridSize = this.gridSize;
    const totalCells = gridSize * gridSize;
    const starCount = Math.max(1, Math.ceil(totalCells / 2));

    // Generate all possible cells
    const allCells = [];
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        allCells.push({ row, col });
      }
    }

    // Shuffle and pick random cells
    for (let i = allCells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allCells[i], allCells[j]] = [allCells[j], allCells[i]];
    }

    const selectedCells = allCells.slice(0, starCount);

    // Create star objects with unique IDs
    const stars = selectedCells.map((cell) => ({
      id: `star_${cell.row}_${cell.col}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      row: cell.row,
      col: cell.col,
    }));

    // Write to Firebase
    firebaseSet("animal-game/stars", stars);
    console.log(`[AnimalGame] Generated ${stars.length} random stars and wrote to Firebase`);
  },

  incrementScore: function () {
    this.score++;
    firebaseSet("animal-game/score", this.score);
    this._updateScoreDisplay();
  },

  _updateScoreDisplay: function () {
    if (this._scoreElement) {
      this._scoreElement.textContent = this.score;
    }
  },

  _createScoreDisplay: function () {
    if (this._scoreElement) return;

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
      pointerEvents: "none",
    });

    const starIcon = document.createElement("span");
    starIcon.textContent = "\u2B50";
    starIcon.style.fontSize = "28px";

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
  },

  /**
   * Create the star control grid UI for host in multiplayer mode.
   * Each cell can be clicked to spawn a star at that position.
   */
  _createStarControlGrid: function () {
    // Only create for host in multiplayer mode
    if (!this.isMultiplayerMode || !this.isHost) return;

    // Remove existing grid if any
    this._destroyStarControlGrid();

    const grid = document.createElement("div");
    grid.className = "star-control-grid";
    grid.id = "star-control-grid";
    grid.style.gridTemplateColumns = `repeat(${this.gridSize}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${this.gridSize}, 1fr)`;

    this._starCells = [];

    for (let row = 0; row < this.gridSize; row++) {
      for (let col = 0; col < this.gridSize; col++) {
        const cell = document.createElement("div");
        cell.className = "star-control-cell";
        cell.dataset.row = row;
        cell.dataset.col = col;

        const starIcon = document.createElement("span");
        starIcon.className = "star-icon";
        starIcon.textContent = "\u2B50";
        cell.appendChild(starIcon);

        cell.addEventListener("click", () => {
          this._onStarCellClick(row, col, cell);
        });

        grid.appendChild(cell);
        this._starCells.push({ row, col, element: cell });
      }
    }

    document.body.appendChild(grid);
    this._starGridElement = grid;

    // Update cell states based on current stars
    this._updateStarCellStates();

    console.log("[AnimalGame] Star control grid created for host");
  },

  _destroyStarControlGrid: function () {
    if (this._starGridElement) {
      this._starGridElement.remove();
      this._starGridElement = null;
    }
    this._starCells = [];
  },

  /**
   * Update visual state of star cells based on which cells have stars.
   */
  _updateStarCellStates: function () {
    if (!this._starCells.length) return;

    this._starCells.forEach(({ row, col, element }) => {
      const hasStar = this.firebaseStars.some(
        (s) => s.row === row && s.col === col
      );
      if (hasStar) {
        element.classList.add("has-star");
      } else {
        element.classList.remove("has-star");
      }
    });
  },

  /**
   * Handle click on a star cell - toggle star at that position.
   */
  _onStarCellClick: function (row, col, cellElement) {
    // Check if star already exists at this position
    const existingIndex = this.firebaseStars.findIndex(
      (s) => s.row === row && s.col === col
    );

    if (existingIndex >= 0) {
      // Remove existing star
      const newStars = [...this.firebaseStars];
      newStars.splice(existingIndex, 1);
      firebaseSet("animal-game/stars", newStars);
      console.log(`[AnimalGame] Removed star at (${row}, ${col})`);
    } else {
      // Add new star
      const newStar = {
        id: `star_${row}_${col}_${Date.now()}`,
        row: row,
        col: col,
      };
      const newStars = [...this.firebaseStars, newStar];
      firebaseSet("animal-game/stars", newStars);
      console.log(`[AnimalGame] Added star at (${row}, ${col})`);
    }
  },

  /**
   * Called when Firebase stars data changes.
   */
  _onFirebaseStarsUpdate: function (stars) {
    this.firebaseStars = Array.isArray(stars) ? stars : [];
    console.log("[AnimalGame] Firebase stars updated:", this.firebaseStars.length, "stars");

    // Update cell visual states
    this._updateStarCellStates();

    // Always sync stars to the cursor from Firebase
    if (this.currentCursor) {
      this.currentCursor.syncStarsFromFirebase(this.firebaseStars);
    }

    // If host and no stars exist, generate random stars (only in host-only mode)
    // In multiplayer mode, host must manually place stars via the grid UI
    if (this.isHost && this.firebaseStars.length === 0 && this._firebaseStarsSyncInitialized && !this.isMultiplayerMode) {
      // Small delay to avoid race conditions on initial load
      setTimeout(() => {
        if (this.firebaseStars.length === 0 && !this.isMultiplayerMode) {
          this._generateRandomStarsToFirebase();
        }
      }, 500);
    }
  },

  /**
   * Called when a star is collected (by collision with fish).
   * Always update Firebase so both host and participant stay in sync.
   */
  onStarCollected: function (starId) {
    this.incrementScore();

    if (starId) {
      // Remove the collected star from Firebase
      const newStars = this.firebaseStars.filter((s) => s.id !== starId);
      firebaseSet("animal-game/stars", newStars);
      console.log(`[AnimalGame] Star collected and removed from Firebase: ${starId}`);
    }
  },

  setAppType: function (type) {
    if (this.currentType !== type) {
      this.currentType = type;
      document.body.setAttribute("app-type", type);
      if (!this._isSyncingFromRemote) {
        firebaseSet("animal-game/currentType", type);
      }
    }
  },

  requestSwitch: function (type) {
    if (type) {
      firebaseSet("animal-game/currentType", type);
    }
  },

  _switchToFish: function () {
    if (this.switching) return;
    this.switching = true;

    this.destroyCurrentCursor().then(() => {
      const self = this;
      this.currentCursor = new WebGLFishCursor({
        autoMouseEvents: false,
        isMultiplayerMode: this.isMultiplayerMode,
        isHost: this.isHost,
        onStarCollected: function (starId) {
          self.onStarCollected(starId);
        },
      });
      this.currentCursor.setStarGrid(this.gridSize);

      // In multiplayer mode, sync initial stars from Firebase
      if (this.isMultiplayerMode) {
        this.currentCursor.syncStarsFromFirebase(this.firebaseStars);
      }

      this.currentType = "animal-game/fish";
      document.body.setAttribute("app-type", "animal-game/fish");
      this.switching = false;
    });
  },

  destroyCurrentCursor: function () {
    if (this.currentCursor && this.currentCursor.destroy) {
      this.currentCursor.destroy();
      this.currentCursor = null;
    }
    return Promise.resolve();
  },

  /**
   * Update pointer position for host or participant.
   * In multiplayer mode, host pointer is ignored for fish control.
   */
  updatePointerPosition: function (x, y, color = null, isParticipant = false) {
    if (!this.currentCursor || !this.currentCursor.inputManager) return;

    const pointerId = isParticipant ? "participant" : "host";

    this.currentCursor.inputManager.updatePointerPosition(x, y, color, pointerId);
  },
};


document.addEventListener("DOMContentLoaded", () => {
  // Initialize with fish
  window.animalGame._switchToFish();

  // Local mouse for direct control
  // On host side: registered as "host" pointer
  // On participant side: registered as "participant" pointer
  document.addEventListener("mousemove", (e) => {
    window.animalGame.updatePointerPosition(e.clientX, e.clientY, null, !isHost);
  });

  // Sync with Firebase
  firebaseOnValue("animal-game/currentType", (value) => {
    if (value !== window.animalGame.currentType) {
      const methodName = ANIMAL_TYPE_METHODS[value];
      if (methodName && typeof window.animalGame[methodName] === "function") {
        window.animalGame._isSyncingFromRemote = true;
        window.animalGame[methodName]();
        window.animalGame._isSyncingFromRemote = false;
      }
    }
  });

  // Sync grid size with Firebase
  firebaseOnValue("animal-game/gridSize", (value) => {
    const size = Number(value);
    if (Number.isFinite(size) && size >= 1 && size <= 4) {
      const sizeChanged = window.animalGame.gridSize !== size;
      window.animalGame.gridSize = size;
      if (window.animalGame.currentCursor) {
        window.animalGame.currentCursor.setStarGrid(size);
      }
      // Update star control grid when grid size changes
      window.animalGame._createStarControlGrid();

      // In single-player mode, regenerate stars when grid size changes
      if (sizeChanged && !window.animalGame.isMultiplayerMode && window.animalGame.isHost) {
        window.animalGame._generateRandomStarsToFirebase();
      }
    }
  });

  // Create score display
  window.animalGame._createScoreDisplay();

  // Sync score with Firebase
  firebaseOnValue("animal-game/score", (value) => {
    const score = Number(value);
    if (Number.isFinite(score) && score >= 0) {
      window.animalGame.score = score;
      window.animalGame._updateScoreDisplay();
    }
  });

  // Always initialize Firebase star sync for both host and participant
  // This ensures stars are synced across all clients
  window.animalGame._initializeFirebaseStarsSync();

  // Sync game mode with Firebase
  firebaseOnValue("animal-game/gameMode", (value) => {
    window.animalGame._setGameMode(value);
  });

  // All cursor input comes from main Squidly app via addCursorListener
  // data.user can be: "host-eyes", "host-mouse", "participant-eyes", "participant-mouse"
  addCursorListener((data) => {
    const isParticipant = data.user.includes("participant");
    console.log(`[CursorListener] user=${data.user}, isParticipant=${isParticipant}, x=${Math.round(data.x)}, y=${Math.round(data.y)}, source=${data.source}`);

    window.animalGame.updatePointerPosition(data.x, data.y, null, isParticipant);
  });

  // Grid size up icon
  setIcon(
    1,
    0,
    {
      symbol: "add",
      displayValue: "Grid +",
      type: "action",
    },
    () => {
      const newSize = Math.min(4, window.animalGame.gridSize + 1);
      if (newSize !== window.animalGame.gridSize) {
        firebaseSet("animal-game/gridSize", newSize);
      }
    }
  );

  // Grid size down icon
  setIcon(
    2,
    0,
    {
      symbol: "minus",
      displayValue: "Grid -",
      type: "action",
    },
    () => {
      const newSize = Math.max(1, window.animalGame.gridSize - 1);
      if (newSize !== window.animalGame.gridSize) {
        firebaseSet("animal-game/gridSize", newSize);
      }
    }
  );

  // Game mode toggle - shows the mode it will switch TO
  setIcon(
    3,
    0,
    {
      symbol: "group",
      displayValue: "Multiplayer",
      type: "action",
    },
    () => {
      const newMode = window.animalGame.isMultiplayerMode ? "single-player" : "multiplayer";
      firebaseSet("animal-game/gameMode", newMode);
    }
  );
});
