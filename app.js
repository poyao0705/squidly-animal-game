/**
 * Squidly Animal Game - Main Application
 *
 * Manages interactive animal-themed cursor effects.
 * 
 * Fish control priority:
 * - Participant controls fish when active
 * - Host controls fish when participant is inactive (handled in fish-cursor.js)
 */

import { WebGLFishCursor } from "./index.js";

const ANIMAL_TYPE_METHODS = {
  "animal-game/fish": "_switchToFish",
};

// Initialize default animal type
firebaseSet("animal-game/currentType", "animal-game/fish");

// Initialize default grid size
firebaseSet("animal-game/gridSize", 4);

// Initialize score to 0 on startup
firebaseSet("animal-game/score", 0);

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
        onStarCollected: function () {
          self.incrementScore();
        },
      });
      this.currentCursor.setStarGrid(this.gridSize);

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
   * Both are always tracked; fish-cursor.js decides which one controls the fish.
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

  // Local mouse for direct control (host fallback when participant not active)
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

  // All cursor input comes from main Squidly app via addCursorListener
  // data.user can be: "host-eyes", "host-mouse", "participant-eyes", "participant-mouse"
  addCursorListener((data) => {
    const isParticipant = data.user.includes("participant");
    console.log(`[CursorListener] user=${data.user}, isParticipant=${isParticipant}, x=${Math.round(data.x)}, y=${Math.round(data.y)}, source=${data.source}`);
    window.animalGame.updatePointerPosition(data.x, data.y, null, isParticipant);
  });

  // // Grid icon for switching
  // setIcon(
  //   1,
  //   0,
  //   {
  //     symbol: "change",
  //     displayValue: "Fish Mode",
  //     type: "action",
  //   },
  //   () => {
  //     console.log("Fish mode active");
  //   }
  // );

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

  // const hasSessionInfo = typeof session_info !== "undefined" && session_info != null;
  // console.log("session_info", hasSessionInfo ? session_info : null);
  // const isHostUser = hasSessionInfo ? session_info?.user === "host" : false;
  // const participantActive = hasSessionInfo ? session_info?.participantActive === true : false;
  // if (isHostUser && !participantActive) {
  //   placeStars();
  // } else {
  //   console.log("Skipping stars", { isHostUser, participantActive });
  // }
});
