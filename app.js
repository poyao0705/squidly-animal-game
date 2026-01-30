/**
 * @fileoverview Squidly Fish Game - Main Application Controller
 * 
 * This module manages the game state, Firebase synchronization, and coordinates
 * between the logic (GameService), Identity (IdentityManager), UI (GameUI),
 * and Renderer (WebGLFishCursor).
 */

import { WebGLFishCursor } from "./index.js";
import GameService from "./game-service.js";
import { IdentityManager } from "./identity-manager.js";
import { GameUI } from "./game-ui.js";

/**
 * FishGame - Main game controller class
 */
class FishGame {
  constructor() {
    // 1. Identity Management
    // ------------------------------------------------------------------------
    this._identityManager = new IdentityManager(
      typeof session_info !== "undefined" ? session_info : null
    );

    // 2. Core Logic Service
    // ------------------------------------------------------------------------
    this._gameService = new GameService();

    // 3. UI Manager
    // ------------------------------------------------------------------------
    this._ui = new GameUI();

    // 4. State
    // ------------------------------------------------------------------------
    this.currentCursor = null;
    this.gridSize = 4;
    this.score = 0;
    this.isMultiplayerMode = false;
    this.firebaseStars = [];
    
    // Sync flags
    this._firebaseStarsSyncInitialized = false;

    console.log("[FishGame] Initialized.");
  }

  // ==========================================================================
  // Getters Delegates
  // ==========================================================================
  
  get isHost() {
    return this._identityManager.isHost;
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  init() {
    this._initializeHostDefaults();
    this._initFishCursor();
    this._setupEventListeners();
    this._setupFirebaseSubscriptions();
    this._setupSidebarIcons();
    this._setupSessionListeners();
    
    // Initialize UI components
    this._ui.init(this.score);
  }

  _initFishCursor() {
    this.currentCursor = new WebGLFishCursor({
      isMultiplayerMode: this.isMultiplayerMode,
      isHost: this.isHost,
      onStarCollected: (starId) => this.onStarCollected(starId),
    });

    this.currentCursor.setStarGrid(this.gridSize);

    if (this.isMultiplayerMode) {
      this.currentCursor.syncStarsFromFirebase(this.firebaseStars);
    }
  }

  _initializeHostDefaults() {
    if (!this.isHost) return;

    const defaults = {
      gridSize: 4,
      score: 0,
      gameMode: "single-player",
      isSwapped: false
    };

    Object.entries(defaults).forEach(([key, val]) => {
      firebaseOnValue(`fish-game/${key}`, (snapshot) => {
        if (snapshot === null || snapshot === undefined) {
          firebaseSet(`fish-game/${key}`, val);
        }
      }, { onlyOnce: true });
    });
  }

  // ==========================================================================
  // SETUP & EVENT LISTENERS
  // ==========================================================================

  _setupEventListeners() {
    // Local mouse
    document.addEventListener("mousemove", (e) => {
      // In single player: host controls.
      // In multiplayer: participant controls.
      // But pointer validation happens in updatePointerPosition logic or renderer?
      // Original logic: updatePointerPosition(..., !this.isHost)
      // Wait, original: !this.isHost passed "isParticipant".
      // If I am Host, isParticipant = false. Correct.
      this.updatePointerPosition(e.clientX, e.clientY, null, !this.isHost);
    });

    // Squidly API
    addCursorListener((data) => {
        let isParticipant = data.user.includes("participant");
        
        // Swap logic logic handled here previously? 
        // Original: if (this._isSwapped) isParticipant = !isParticipant;
        // Let's use IdentityManager's isSwapped check.
        if (this._identityManager.isSwapped) {
            isParticipant = !isParticipant;
        }
        
        this.updatePointerPosition(data.x, data.y, null, isParticipant);
    });
  }

  _setupSidebarIcons() {
    this._ui.setupGridControls({
        onGridIncrease: () => {
            const newSize = Math.min(4, this.gridSize + 1);
            if (newSize !== this.gridSize) firebaseSet("fish-game/gridSize", newSize);
        },
        onGridDecrease: () => {
            const newSize = Math.max(1, this.gridSize - 1);
            if (newSize !== this.gridSize) firebaseSet("fish-game/gridSize", newSize);
        }
    });

    // Initial Swap Button Check
    this._updateSwapButton();
  }
  
  _setupSessionListeners() {
    addSessionInfoListener((info) => {
        if (!this.isHost) return; 
        
        const participantActive = info.participantActive === true;
        const targetMode = participantActive ? "multiplayer" : "single-player";

        if (
            (participantActive && !this.isMultiplayerMode) ||
            (!participantActive && this.isMultiplayerMode)
        ) {
            console.log(`[FishGame] Auto-switching to ${targetMode}`);
            firebaseSet("fish-game/gameMode", targetMode);
        }
    });
  }

  // ==========================================================================
  // FIREBASE SUBSCRIPTIONS & SYNC
  // ==========================================================================

  _setupFirebaseSubscriptions() {
    // 1. Grid Size
    firebaseOnValue("fish-game/gridSize", (value) => {
        const validated = this._gameService.validateGridSize(value);
        if (this.gridSize !== validated) {
            this.gridSize = this._gameService.setGridSize(validated);
            
            if (this.currentCursor) this.currentCursor.setStarGrid(validated);
            
            this._updateStarGridUI();
            
            if (!this.isMultiplayerMode && this.isHost) {
                this._generateRandomStarsToFirebase();
            }
        }
    });

    // 2. Score
    firebaseOnValue("fish-game/score", (value) => {
        const score = Number(value);
        if (Number.isFinite(score) && score >= 0) {
            this._gameService.setScore(score);
            this.score = score;
            this._ui.updateScore(score);
        }
    });

    // 3. Stars
    this._initializeFirebaseStarsSync();

    // 4. Game Mode
    firebaseOnValue("fish-game/gameMode", (value) => {
        this._setGameMode(value);
    });

    // 5. Swap State
    firebaseOnValue("fish-game/isSwapped", (value) => {
        const isSwapped = value === true;
        const changed = this._identityManager.setSwapState(isSwapped);
        
        if (changed) {
            if (this.currentCursor) {
                this.currentCursor.setIsHost(this.isHost);
            }
            
            // Re-evaluate UI that depends on role
            this._updateStarGridUI();
        }
    });
  }

  _initializeFirebaseStarsSync() {
    if (this._firebaseStarsSyncInitialized) return;
    this._firebaseStarsSyncInitialized = true;

    firebaseOnValue("fish-game/stars", (value) => {
        this._onFirebaseStarsUpdate(value);
    });
  }

  _onFirebaseStarsUpdate(stars) {
    this.firebaseStars = Array.isArray(stars) ? stars : [];
    this._gameService.setStars(this.firebaseStars);

    // Update UI
    this._ui.updateStarCellStates(this.firebaseStars);

    // Update Renderer
    if (this.currentCursor) {
        this.currentCursor.syncStarsFromFirebase(this.firebaseStars);
    }

    // Auto-Regen Logic
    if (this.isHost && 
        this._firebaseStarsSyncInitialized && 
        this._gameService.shouldRegenerateStars(this.firebaseStars, this.isMultiplayerMode)) {
            
        setTimeout(() => {
            if (this._gameService.shouldRegenerateStars(this.firebaseStars, this.isMultiplayerMode)) {
                this._generateRandomStarsToFirebase();
            }
        }, 500);
    }
  }

  // ==========================================================================
  // LOGIC & ACTIONS
  // ==========================================================================

  _setGameMode(mode) {
    const result = this._gameService.setGameMode(mode, this.isMultiplayerMode);
    if (!result.changed) return;

    this.isMultiplayerMode = result.isMultiplayer;
    this._gameService.isMultiplayerMode = result.isMultiplayer;
    console.log("[FishGame] Mode set to:", mode);

    if (result.shouldClearStars) {
        // Multiplayer: Clear stars
        this._setFirebaseStars([]);
        this._updateStarGridUI();
    } else if (result.shouldGenerateStars) {
        // Single Player: Reset swap, hide grid, generate stars
        if (this._identityManager.isSwapped) {
            firebaseSet("fish-game/isSwapped", false);
            // Optimistic update for immediate logic
            this._identityManager.setSwapState(false); 
            if (this.currentCursor) this.currentCursor.setIsHost(this.isHost);
        }

        this._updateStarGridUI();
        if (this.isHost) {
            this._generateRandomStarsToFirebase();
        }
    }

    if (this.currentCursor && this.currentCursor.setMultiplayerMode) {
        this.currentCursor.setMultiplayerMode(result.isMultiplayer);
    }

    this._updateSwapButton();
  }

  _updateSwapButton() {
    this._ui.updateSwapButton(this.isMultiplayerMode, () => {
        this.toggleIdentitySwap();
    });
  }

  toggleIdentitySwap() {
    if (!this.isMultiplayerMode) {
        console.warn("[FishGame] Cannot swap in single-player.");
        return;
    }
    firebaseSet("fish-game/isSwapped", !this._identityManager.isSwapped);
  }

  _updateStarGridUI() {
    // Only show grid if Multiplayer AND Host
    const shouldShow = this.isMultiplayerMode && this.isHost;
    
    this._ui.updateStarControlGrid(
        shouldShow, 
        this.gridSize, 
        this.firebaseStars, 
        (row, col) => this._onStarCellClick(row, col)
    );
  }

  _onStarCellClick(row, col) {
    // Ensure service is up to date
    this._gameService.setStars(this.firebaseStars);
    const newStars = this._gameService.toggleStarAtPosition(row, col);
    
    // Optimistic update
    this.firebaseStars = newStars; 
    
    // Sync
    this._setFirebaseStars(newStars);
  }

  _generateRandomStarsToFirebase() {
    if (!this.isHost) return;
    const stars = this._gameService.generateRandomStars(this.gridSize);
    this._gameService.setStars(stars);
    this.firebaseStars = stars;
    this._setFirebaseStars(stars);
  }

  _setFirebaseStars(stars) {
    firebaseSet("fish-game/stars", stars);
  }

  incrementScore() {
    const newScore = this._gameService.incrementScore();
    this.score = newScore;
    firebaseSet("fish-game/score", newScore);
    this._ui.updateScore(newScore);
  }

  onStarCollected(starId) {
    if (!starId) return;
    const result = this._gameService.collectStar(starId);
    
    this.score = result.newScore;
    this.firebaseStars = result.remainingStars;
    
    firebaseSet("fish-game/score", result.newScore);
    firebaseSet("fish-game/stars", result.remainingStars);
    
    this._ui.updateScore(result.newScore);
    console.log(`[FishGame] Star collected: ${starId}`);
  }

  updatePointerPosition(x, y, color = null, isParticipant = false) {
    if (!this.currentCursor || !this.currentCursor.inputManager) return;
    const pointerId = isParticipant ? "participant" : "host";
    this.currentCursor.inputManager.updatePointerPosition(x, y, color, pointerId);
  }
}

// Bootstrap
window.fishGame = new FishGame();
document.addEventListener("DOMContentLoaded", () => {
  window.fishGame.init();
});
