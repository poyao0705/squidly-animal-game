/**
 * Squidly Animal Game - Main Application
 *
 * Manages interactive animal-themed cursor effects.
 */

import { WebGLSquidCursor } from "./index.js";

const ANIMAL_TYPE_METHODS = {
  "animal-game/squid": "_switchToSquid",
};

// Initialize default animal type
firebaseSet("animal-game/currentType", "animal-game/squid");

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

  _switchToSquid: function () {
    if (this.switching) return;
    this.switching = true;

    this.destroyCurrentCursor().then(() => {
      this.currentCursor = new WebGLSquidCursor({
        autoMouseEvents: false,
      });

      this.currentType = "animal-game/squid";
      document.body.setAttribute("app-type", "animal-game/squid");
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

  updatePointerPosition: function (x, y, color = null, userId = null) {
    if (!this.currentCursor || !this.currentCursor.inputManager) return;
    this.currentCursor.inputManager.updatePointerPosition(
      x,
      y,
      color,
      userId || "mouse"
    );
  },
};

document.addEventListener("DOMContentLoaded", () => {
  // Initialize with squid
  window.animalGame._switchToSquid();

  // Local mouse movement
  document.addEventListener("mousemove", (e) => {
    window.animalGame.updatePointerPosition(
      e.clientX,
      e.clientY,
      null,
      "local-mouse"
    );
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

  // Multi-user updates
  addCursorListener((data) => {
    window.animalGame.updatePointerPosition(data.x, data.y, null, data.user);
  });

  // Grid icon for switching
  setIcon(
    1,
    0,
    {
      symbol: "change",
      displayValue: "Squid Mode",
      type: "action",
    },
    () => {
      console.log("Squid mode active");
    }
  );
});
