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

// Debug logging (throttled to avoid spam)
let lastHostLog = 0;
let lastParticipantLog = 0;
const LOG_THROTTLE_MS = 500;

window.animalGame = {
  currentType: null,
  currentCursor: null,
  switching: false,
  syncingFromParent: false,

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
      this.currentCursor = new WebGLFishCursor({
        autoMouseEvents: false,
      });

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

    // Debug logging (throttled)
    const now = performance.now();
    if (isParticipant && now - lastParticipantLog > LOG_THROTTLE_MS) {
      console.log(`[Participant] x=${Math.round(x)}, y=${Math.round(y)}`);
      lastParticipantLog = now;
    } else if (!isParticipant && now - lastHostLog > LOG_THROTTLE_MS) {
      console.log(`[Host] x=${Math.round(x)}, y=${Math.round(y)}`);
      lastHostLog = now;
    }

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

  // All cursor input comes from main Squidly app via addCursorListener
  // data.user can be: "host-eyes", "host-mouse", "participant-eyes", "participant-mouse"
  addCursorListener((data) => {
    const isParticipant = data.user.includes("participant");
    console.log(`[CursorListener] user=${data.user}, isParticipant=${isParticipant}, x=${Math.round(data.x)}, y=${Math.round(data.y)}, source=${data.source}`);
    window.animalGame.updatePointerPosition(data.x, data.y, null, isParticipant);
  });

  // Grid icon for switching
  setIcon(
    1,
    0,
    {
      symbol: "change",
      displayValue: "Fish Mode",
      type: "action",
    },
    () => {
      console.log("Fish mode active");
    }
  );
});
