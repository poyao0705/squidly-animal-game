/**
 * @fileoverview Game UI Manager
 * 
 * Manages all DOM-related UI elements for the Fish Game:
 * - Score display
 * - Sidebar icons
 * - Star control grid
 */

import "https://v3.squidly.com.au/src/Utilities/Buttons/access-buttons.js";

export class GameUI {
  constructor() {
    this._scoreElement = null;
    this._starGridElement = null;
    this._starCells = [];
    this._swapButtonKey = null;
  }

  /**
   * Initialize static UI elements like score.
   * @param {number} initialScore 
   */
  init(initialScore = 0) {
    this._createScoreDisplay(initialScore);
  }

  /**
   * Updates the displayed score.
   * @param {number} score 
   */
  updateScore(score) {
    if (this._scoreElement) {
      this._scoreElement.textContent = score;
    }
  }

  /**
   * Sets up sidebar icons for Grid control.
   * @param {Object} callbacks - { onGridIncrease, onGridDecrease }
   */
  setupGridControls({ onGridIncrease, onGridDecrease }) {
    // Grid +
    SquidlyAPI.setIcon(1, 0, {
      symbol: "add",
      displayValue: "Grid +",
      type: "action",
    }, onGridIncrease);

    // Grid -
    SquidlyAPI.setIcon(2, 0, {
      symbol: "minus",
      displayValue: "Grid -",
      type: "action",
    }, onGridDecrease);
  }

  /**
   * Updates the visibility of the swap button.
   * @param {boolean} isMultiplayerMode
   * @param {Function} onSwapClick
   */
  updateSwapButton(isMultiplayerMode, onSwapClick) {
    // Remove existing
    if (this._swapButtonKey) {
      SquidlyAPI.removeIcon(this._swapButtonKey);
      this._swapButtonKey = null;
    }

    if (isMultiplayerMode) {
      this._swapButtonKey = SquidlyAPI.setIcon(3, 0, {
        symbol: "switch",
        displayValue: "Switch Mode",
        type: "action",
      }, onSwapClick);
    }
  }

  /**
   * Creates or destroys the star control grid based on mode/host status.
   * @param {boolean} shouldShow - Whether the grid should be visible
   * @param {number} gridSize - Size of grid
   * @param {Array} stars - Current stars array
   * @param {Function} onCellClick - Callback(row, col)
   */
  updateStarControlGrid(shouldShow, gridSize, stars, onCellClick) {
    if (!shouldShow) {
      this._destroyStarControlGrid();
      return;
    }

    // If grid needs to be created or recreated (size change check could be added for opt, 
    // but destroying/creating is safer for simplicity unless perf is issue)
    // Here we can check if we already have a grid and if it matches size.
    // For now, let's keep it robust: destroy and recreate if it doesn't match or to ensure cleanness.
    // Optimisation: check if grid exists and size matches.
    
    // Simple approach: Always recreate if showing to ensure correct state, 
    // or checks. Let's replicate original logic:
    // Original logic called destroy then create.
    this._destroyStarControlGrid();
    
    // Create grid container
    const grid = document.createElement("div");
    grid.className = "star-control-grid";
    grid.id = "star-control-grid";
    grid.style.gridTemplateColumns = `repeat(${gridSize}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${gridSize}, 1fr)`;

    this._starCells = [];

    let cellIndex = 0;
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const cell = document.createElement("access-button");
        cell.className = "star-control-cell";
        cell.dataset.row = row;
        cell.dataset.col = col;
        
        cell.setAttribute("access-group", "star-grid");
        cell.setAttribute("access-order", cellIndex);

        const starIcon = document.createElement("span");
        starIcon.className = "star-icon";
        starIcon.textContent = "\u2B50";
        cell.appendChild(starIcon);

        cell.addEventListener("access-click", () => {
          onCellClick(row, col);
        });

        grid.appendChild(cell);
        this._starCells.push({ row, col, element: cell });
        cellIndex++;
      }
    }

    document.body.appendChild(grid);
    this._starGridElement = grid;

    // Apply initial states
    this.updateStarCellStates(stars);
  }

  /**
   * Updates visual state of star cells.
   * @param {Array} stars 
   */
  updateStarCellStates(stars) {
    if (!this._starGridElement || !this._starCells.length) return;

    this._starCells.forEach(({ row, col, element }) => {
      const hasStar = stars.some(s => s.row === row && s.col === col);
      if (hasStar) {
        element.classList.add("has-star");
      } else {
        element.classList.remove("has-star");
      }
    });
  }

  _destroyStarControlGrid() {
    if (this._starGridElement) {
      this._starGridElement.remove();
      this._starGridElement = null;
    }
    this._starCells = [];
  }

  _createScoreDisplay(initialScore) {
    if (this._scoreElement) return;

    const container = document.createElement("div");
    container.id = "score-container";

    const starIcon = document.createElement("span");
    starIcon.className = "score-icon";
    starIcon.textContent = "\u2B50";

    this._scoreElement = document.createElement("span");
    this._scoreElement.className = "score-value";
    this._scoreElement.textContent = initialScore;

    container.appendChild(starIcon);
    container.appendChild(this._scoreElement);
    document.body.appendChild(container);
  }
}
