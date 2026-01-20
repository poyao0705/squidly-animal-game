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

// Detect session info for mode switching
const hasSessionInfo = typeof session_info !== "undefined" && session_info != null;
const isHost = hasSessionInfo ? session_info?.user === "host" : true;
const participantActive = hasSessionInfo ? session_info?.participantActive === true : false;
const isMultiplayerMode = participantActive;

console.log("[AnimalGame] Mode detection:", { hasSessionInfo, isHost, participantActive, isMultiplayerMode });

// Initialize default animal type
firebaseSet("animal-game/currentType", "animal-game/fish");

// Initialize default grid size
firebaseSet("animal-game/gridSize", 4);

// Initialize score to 0 on startup
firebaseSet("animal-game/score", 0);

// Initialize stars array in Firebase (only host initializes in multiplayer mode)
if (isMultiplayerMode && isHost) {
  firebaseSet("animal-game/stars", []);
}

// Debug logging (throttled to avoid spam)
let lastHostLog = 0;
let lastParticipantLog = 0;
const LOG_THROTTLE_MS = 500;

window.animalGame = {
  currentType: null,
  currentCursor: null,
  switching: false,
  syncingFromParent: false,
  gridSize: 4,
  score: 0,
  _scoreEl: null,
  _starGridEl: null,
  _starCells: [],
  
  // Mode flags
  isHost: isHost,
  isMultiplayerMode: isMultiplayerMode,
  
  // Current stars in Firebase (multiplayer mode)
  firebaseStars: [],

  incrementScore: function () {
    this.score++;
    firebaseSet("animal-game/score", this.score);
    this._updateScoreDisplay();
  },

  _updateScoreDisplay: function () {
    if (this._scoreEl) {
      this._scoreEl.textContent = this.score;
    }
  },

  _createScoreDisplay: function () {
    if (this._scoreEl) return;

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

    this._scoreEl = document.createElement("span");
    Object.assign(this._scoreEl.style, {
      fontSize: "32px",
      fontWeight: "bold",
      color: "#333",
      textShadow: "1px 1px 2px rgba(255, 255, 255, 0.8)",
    });
    this._scoreEl.textContent = this.score;

    container.appendChild(starIcon);
    container.appendChild(this._scoreEl);
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
    this._starGridEl = grid;
    
    // Update cell states based on current stars
    this._updateStarCellStates();
    
    console.log("[AnimalGame] Star control grid created for host");
  },

  _destroyStarControlGrid: function () {
    if (this._starGridEl) {
      this._starGridEl.remove();
      this._starGridEl = null;
    }
    this._starCells = [];
  },

  _updateStarControlGrid: function () {
    if (!this.isMultiplayerMode || !this.isHost) return;
    this._createStarControlGrid();
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
    
    // Sync stars to the cursor (in multiplayer mode)
    if (this.isMultiplayerMode && this.currentCursor) {
      this.currentCursor.syncStarsFromFirebase(this.firebaseStars);
    }
  },

  /**
   * Called when a star is collected (by collision with fish).
   * In multiplayer mode, update Firebase. In host-only mode, just increment score.
   */
  onStarCollected: function (starId) {
    this.incrementScore();
    
    if (this.isMultiplayerMode && starId) {
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
      if (!this.syncingFromParent) {
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
  // In host-only mode: host controls fish
  // In multiplayer mode: host mouse is still tracked but fish ignores it
  document.addEventListener("mousemove", (e) => {
    window.animalGame.updatePointerPosition(e.clientX, e.clientY, null, false);
  });

  // Sync with Firebase
  firebaseOnValue("animal-game/currentType", (value) => {
    if (value !== window.animalGame.currentType) {
      const methodName = ANIMAL_TYPE_METHODS[value];
      if (methodName && typeof window.animalGame[methodName] === "function") {
        window.animalGame.syncingFromParent = true;
        window.animalGame[methodName]();
        window.animalGame.syncingFromParent = false;
      }
    }
  });

  // Sync grid size with Firebase
  firebaseOnValue("animal-game/gridSize", (value) => {
    const size = Number(value);
    if (Number.isFinite(size) && size >= 1 && size <= 4) {
      window.animalGame.gridSize = size;
      if (window.animalGame.currentCursor) {
        window.animalGame.currentCursor.setStarGrid(size);
      }
      // Update star control grid when grid size changes
      window.animalGame._updateStarControlGrid();
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

  // In multiplayer mode, sync stars with Firebase
  if (isMultiplayerMode) {
    firebaseOnValue("animal-game/stars", (value) => {
      window.animalGame._onFirebaseStarsUpdate(value);
    });
    
    // Create star control grid for host
    if (isHost) {
      window.animalGame._createStarControlGrid();
    }
  }

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
});
