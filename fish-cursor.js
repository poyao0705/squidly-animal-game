/**
 * @fileoverview WebGL Fish Cursor - Interactive 3D Fish Game Engine
 * 
 * This module provides a WebGL-based 3D fish cursor that follows the user's pointer
 * and collects floating stars. Built on Three.js for rendering.
 * 
 * ## Architecture Overview
 * 
 * The system consists of three main components:
 * 1. **Fish Mesh** - A 3D blocky fish with animated fins, tail, and expressive eyes
 * 2. **Particle System** - Background particles that drift across the screen
 * 3. **Star System** - Collectible stars that float and twinkle, synced via Firebase
 * 
 * ## Fish Design
 * - Body: Box geometry with flat shading for a "low-poly" aesthetic
 * - Orientation: Fish faces right (+X direction), with mouth pointing toward movement
 * - Features: Speed-based color transitions (cyan to magenta), fin wiggle, tail swing
 * - Eyes track movement with squinting based on speed
 * 
 * ## Multiplayer Support
 * - Single-player mode: Host controls fish, random star generation
 * - Multiplayer mode: Only participant controls fish, host manages star placement
 * - Collision authority: Only the controlling client reports star collection
 * 
 * ## Rendering Pipeline
 * 1. `_init()` - Sets up Three.js scene, camera, lighting, and creates fish mesh
 * 2. `_loop()` - Main animation loop (requestAnimationFrame)
 *    - Determines active pointer (host vs participant based on mode)
 *    - Updates fish position/animation via `_updateFish()`
 *    - Spawns and updates particles
 *    - Updates stars and checks collisions
 * 3. `renderer.render()` - Draws frame to canvas
 * 
 * @module WebGLFishCursor
 * @requires three.js (loaded from CDN)
 * @requires InputManager
 */

import InputManager from './input-manager.js';
import { createConfig } from './fish-cursor-config.js';

const threeCdn = "https://cdn.jsdelivr.net/npm/three@0.179.1/build/three.module.js";

// Timeout (ms) after which a pointer is considered inactive
const INACTIVE_TIMEOUT_MS = 2000;

// Debug logging throttle
let lastControllerLog = 0;
let lastController = null;
const CONTROLLER_LOG_THROTTLE_MS = 1000;

/**
 * WebGLFishCursor - Main class for the 3D fish cursor game engine.
 * 
 * Creates a full-screen transparent WebGL canvas overlay with a 3D fish
 * that follows pointer input and collects floating stars.
 * 
 * @class
 * @example
 * // Basic usage (single-player)
 * const fishCursor = new WebGLFishCursor({
 *   onStarCollected: (starId) => console.log('Collected:', starId)
 * });
 * 
 * @example
 * // Multiplayer usage (participant client)
 * const fishCursor = new WebGLFishCursor({
 *   isMultiplayerMode: true,
 *   isHost: false,
 *   onStarCollected: (starId) => updateFirebaseScore(starId)
 * });
 */
class WebGLFishCursor {
    /**
     * Creates a new WebGLFishCursor instance.
     * 
     * @constructor
     * @param {Object} options - Configuration options
     * @param {Object} [options.configOverrides={}] - Override default config values. See {@link module:FishCursorConfig} for all available options.
     * @param {Function|null} [options.onStarCollected=null] - Callback when a star is collected. Receives starId as argument.
     * @param {boolean} [options.isMultiplayerMode=false] - Enable multiplayer mode (participant controls fish, host places stars)
     * @param {boolean} [options.isHost=true] - Whether this client is the host (affects collision authority)
     * 
     * @property {Object} config - Configuration object. See {@link module:FishCursorConfig} for all available properties.
     */
    constructor({ configOverrides = {}, onStarCollected = null, isMultiplayerMode = false, isHost = true } = {}) {
        /** @type {Object|null} Three.js module reference, loaded asynchronously */
        this.THREE = null;

        /** @type {boolean} Whether initialization is complete and rendering can begin */
        this.ready = false;

        /** 
         * Callback fired when fish collides with a star.
         * Only called by the client that has collision authority (the one controlling the fish).
         * @type {Function|null}
         */
        this.onStarCollected = onStarCollected;

        /**
         * Multiplayer mode flag - changes control and collision behavior:
         * - false (single-player): Host controls fish, random star generation
         * - true (multiplayer): Only participant controls fish, host places stars manually
         * @type {boolean}
         */
        this.isMultiplayerMode = isMultiplayerMode;

        /** 
         * Whether this client instance is the host.
         * Used to determine collision authority in different modes.
         * @type {boolean}
         */
        this.isHost = isHost;

        /** 
         * Runtime flag: true if this client is currently controlling the fish.
         * Only the controlling client should report star collisions to prevent double-counting.
         * @type {boolean}
         * @private
         */
        this._isControllingFish = false;

        /** 
         * The single fish instance containing mesh and animation state.
         * Created during initialization.
         * @type {Object|null}
         */
        this.fish = null;

        /**
         * Manages pointer input from multiple sources (host, participant).
         * Tracks position and activity state for each pointer.
         */
        this.inputManager = new InputManager(this, {
            inactiveTimeout: 5000
        });

        /**
         * Configuration object - merges defaults with provided overrides.
         * Controls visual appearance, animation parameters, and game settings.
         * 
         * @see {@link module:FishCursorConfig} for all available configuration options.
         */
        this.config = createConfig(configOverrides);

        // Particle system
        this.flyingParticles = [];
        this.waitingParticles = [];
        this._particleSpawnTimer = 0;
        this._viewBoundsX = 0;
        this._viewBoundsY = 0;

        // Starfield
        this.stars = [];
        this._starCells = [];
        this._starGlowTex = null;
        this._pendingFirebaseStars = null; // Queue for stars received before init completes

        this.canvas = document.createElement("canvas");
        Object.assign(this.canvas.style, {
            position: "fixed",
            inset: "0",
            width: "100vw",
            height: "100vh",
            pointerEvents: "none",
            zIndex: "9998",
            background: "transparent"
        });
        document.body.appendChild(this.canvas);

        this._onResize = this._debounce(() => this._resize(), 100);
        this._onVisibility = () => (document.hidden ? cancelAnimationFrame(this._raf) : this._loop());

        this._init().catch(err => console.error("[Fish] failed to init:", err));
    }

    /**
     * Return val if it's a valid finite number, otherwise return fallback.
     * @param {*} val - Value to check
     * @param {number} fallback - Fallback value if val is invalid
     * @returns {number}
     */
    _safeNumber(val, fallback = 0) {
        return (typeof val === 'number' && isFinite(val)) ? val : fallback;
    }

    async _init() {
        this.THREE = await import(threeCdn);

        this.renderer = new this.THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true,
            powerPreference: "high-performance"
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

        this.scene = new this.THREE.Scene();
        this.camera = new this.THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 0, 15);

        const ambient = new this.THREE.AmbientLight(0xffffff, 1.0);
        this.scene.add(ambient);

        const direct = new this.THREE.DirectionalLight(0xffffff, 0.5);
        direct.position.set(0, 5, 10);
        this.scene.add(direct);

        // Extra shiny key light near the camera (helps specular highlights)
        const starKey = new this.THREE.PointLight(0xffffff, 1.2, 80);
        starKey.position.set(0, 0, 15);
        this.scene.add(starKey);

        // Tone mapping helps glows feel nicer
        this.renderer.toneMapping = this.THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.15;

        this.raycaster = new this.THREE.Raycaster();
        this.mouseNdc = new this.THREE.Vector2(-10, -10);
        this.plane = new this.THREE.Plane(new this.THREE.Vector3(0, 0, 1), 0);
        this.planeHit = new this.THREE.Vector3();

        this._onResize();
        window.addEventListener("resize", this._onResize);
        document.addEventListener("visibilitychange", this._onVisibility);

        // Create the single fish on init
        this.fish = this._createFishMesh();
        this.fish.targetPos = new this.THREE.Vector3(0, 0, 0);
        this.fish.particleTimer = 0;
        this.fish.group.position.set(0, 0, 0);
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.fish.pointerX = w / 2;
        this.fish.pointerY = h / 2;

        this._initStars();

        this._lastT = performance.now();
        this._collisionEnabledAt = performance.now() + 1000; // Enable collision after 1 second
        this.ready = true;

        // Process any pending Firebase stars that arrived before init completed
        if (this._pendingFirebaseStars !== null) {
            this.syncStarsFromFirebase(this._pendingFirebaseStars);
            this._pendingFirebaseStars = null;
        }

        this._loop();
    }

    _calculateViewLimits() {
        if (!this.camera) return;
        const fieldOfView = 45;
        const ang = (fieldOfView / 2) * Math.PI / 180;
        this._viewBoundsY = this.camera.position.z * Math.tan(ang);
        this._viewBoundsX = this._viewBoundsY * (this.camera.aspect || 1);
    }

    _getStarGridSize() {
        const n = Number(this.config.STAR_GRID_SIZE);
        return Math.max(1, Math.min(4, Number.isFinite(n) ? Math.round(n) : 4));
    }

    setStarGrid(size) {
        const n = Number(size);
        if (!Number.isFinite(n)) return;

        const clamped = Math.max(1, Math.min(4, Math.round(n)));
        if (this.config.STAR_GRID_SIZE === clamped) return;

        this.config.STAR_GRID_SIZE = clamped;

        // Update positions of existing stars when grid size changes
        // Star regeneration is handled by app.js
        if (this.scene) {
            this._updateStarGridPositions();
        }
    }

    /**
     * Update multiplayer mode without recreating the cursor.
     * @param {boolean} isMultiplayer - Whether multiplayer mode is enabled
     */
    setMultiplayerMode(isMultiplayer) {
        if (this.isMultiplayerMode === isMultiplayer) return;

        this.isMultiplayerMode = isMultiplayer;
    }

    /**
     * Creates the 3D fish mesh with all its components.
     * 
     * ## Fish Anatomy (all measurements in Three.js units, scaled by config.SCALE)
     * 
     * ```
     *                    [Top Fin] - pivots for swimming animation
     *                        |
     *     [Tail] ←── [  BODY  ] ──→ [Lips/Mouth]
     *       |            |               |
     *   (pivots)    [Side Fins]    [Eyes + Irises]
     *                    |           [Teeth x5]
     *               (both sides)
     * ```
     * 
     * ## Coordinate System
     * - +X: Forward (mouth direction)
     * - -X: Backward (tail direction)  
     * - +Y: Up (top fin)
     * - -Y: Down (bottom)
     * - +Z/-Z: Left/Right sides (eyes, side fins)
     * 
     * ## Materials
     * - Body/Lips: Cyan (0x80f5fe), changes color based on speed
     * - Tail/Fins: Magenta (0xff00dc), static color
     * - Eyes: White with dark brown irises
     * - Teeth: White
     * 
     * All materials use MeshLambertMaterial with flatShading for a low-poly look.
     * 
     * @returns {Object} Fish object containing:
     * @returns {THREE.Group} .group - Root group containing all meshes
     * @returns {THREE.Mesh} .bodyFish - Main body mesh
     * @returns {THREE.Mesh} .tailFish - Tail fin mesh
     * @returns {THREE.Object3D} .tailPivot - Tail pivot point for animation
     * @returns {THREE.Mesh} .topFish - Top/dorsal fin mesh
     * @returns {THREE.Object3D} .topFinPivot - Top fin pivot for animation
     * @returns {THREE.Mesh} .sideRightFish - Right pectoral fin
     * @returns {THREE.Mesh} .sideLeftFish - Left pectoral fin
     * @returns {THREE.Mesh} .rightEye - Right eye white
     * @returns {THREE.Mesh} .rightIris - Right eye pupil
     * @returns {THREE.Mesh} .leftEye - Left eye white
     * @returns {THREE.Mesh} .leftIris - Left eye pupil
     * @returns {THREE.Mesh} .lipsFish - Mouth/lips mesh
     * @returns {Object} .materials - { body, lips } for runtime color changes
     * @returns {THREE.Vector3} .velocity - Current movement velocity
     * @returns {THREE.Vector3} .prevPos - Previous frame position (for velocity calc)
     * @returns {Object} .speed - { x, y } normalized speed values
     * @returns {number} .finPhase - Animation phase for fin wiggle
     * @private
     */
    _createFishMesh() {
        // Create root group to hold all fish parts
        const group = new this.THREE.Group();
        const halfPI = Math.PI / 2;

        // ============================================================
        // BODY - Main cubic body of the fish
        // ============================================================
        const bodyGeom = new this.THREE.BoxGeometry(120, 120, 120);
        const bodyMat = new this.THREE.MeshLambertMaterial({
            color: 0x80f5fe,    // Cyan base color (changes with speed)
            flatShading: true   // Low-poly aesthetic
        });
        const bodyFish = new this.THREE.Mesh(bodyGeom, bodyMat);
        group.add(bodyFish);

        // ============================================================
        // TAIL - Cone shape that wiggles during movement
        // Uses a pivot point so rotation happens at the base
        // ============================================================
        const tailGeom = new this.THREE.CylinderGeometry(0, 60, 60, 4, 1, false);
        const tailMat = new this.THREE.MeshLambertMaterial({
            color: 0xff00dc,    // Magenta accent color
            flatShading: true
        });
        // Pivot positioned at back of body (-X direction)
        const tailPivot = new this.THREE.Object3D();
        tailPivot.position.set(-60, 0, 0);
        const tailFish = new this.THREE.Mesh(tailGeom, tailMat);
        tailFish.scale.set(0.8, 1, 0.1);  // Flattened for 2D tail appearance
        tailFish.rotation.z = -halfPI;     // Rotate to point backward
        tailFish.position.x = -30;         // Offset from pivot
        tailPivot.add(tailFish);
        group.add(tailPivot);

        // ============================================================
        // LIPS/MOUTH - Protrusion at front of fish
        // ============================================================
        const lipsGeom = new this.THREE.BoxGeometry(25, 10, 120);
        const lipsMat = new this.THREE.MeshLambertMaterial({
            color: 0x80f5fe,    // Matches body color
            flatShading: true
        });
        const lipsFish = new this.THREE.Mesh(lipsGeom, lipsMat);
        lipsFish.position.x = 65;   // Front of fish
        lipsFish.position.y = -47;  // Lower part (mouth area)
        lipsFish.rotation.z = halfPI;
        group.add(lipsFish);

        // ============================================================
        // TOP/DORSAL FIN - Pivots for swimming animation
        // ============================================================
        const topFinPivot = new this.THREE.Object3D();
        topFinPivot.position.set(-20, 60, 0);  // Top of body, slightly back
        const topFish = new this.THREE.Mesh(tailGeom, tailMat);
        topFish.scale.set(0.8, 1, 0.1);
        topFish.rotation.z = -halfPI;
        topFish.position.x = 10;
        topFinPivot.add(topFish);
        group.add(topFinPivot);

        // ============================================================
        // SIDE FINS (Pectoral fins) - One on each side
        // ============================================================
        // Right side fin (-Z direction)
        const sideRightFish = new this.THREE.Mesh(tailGeom, tailMat);
        sideRightFish.scale.set(0.8, 1, 0.1);
        sideRightFish.rotation.x = halfPI;
        sideRightFish.rotation.z = -halfPI;
        sideRightFish.position.x = 0;
        sideRightFish.position.y = -50;
        sideRightFish.position.z = -60;
        group.add(sideRightFish);

        // Left side fin (+Z direction)
        const sideLeftFish = new this.THREE.Mesh(tailGeom, tailMat);
        sideLeftFish.scale.set(0.8, 1, 0.1);
        sideLeftFish.rotation.x = halfPI;
        sideLeftFish.rotation.z = -halfPI;
        sideLeftFish.position.x = 0;
        sideLeftFish.position.y = -50;
        sideLeftFish.position.z = 60;
        group.add(sideLeftFish);

        // ============================================================
        // EYES - White sclera with dark iris/pupil
        // Eyes squint based on movement speed
        // ============================================================
        const eyeGeom = new this.THREE.BoxGeometry(40, 40, 5);
        const eyeMat = new this.THREE.MeshLambertMaterial({
            color: 0xffffff,
            flatShading: true
        });

        // Right eye (viewer's left when fish faces right)
        const rightEye = new this.THREE.Mesh(eyeGeom, eyeMat);
        rightEye.position.z = -60;  // Right side of fish
        rightEye.position.x = 25;   // Front of body
        rightEye.position.y = -10;
        group.add(rightEye);

        // Iris geometry (small dark square)
        const irisGeom = new this.THREE.BoxGeometry(10, 10, 3);
        const irisMat = new this.THREE.MeshLambertMaterial({
            color: 0x330000,  // Dark brown
            flatShading: true
        });

        // Right iris - moves based on fish movement
        const rightIris = new this.THREE.Mesh(irisGeom, irisMat);
        rightIris.position.z = -65;
        rightIris.position.x = 35;
        rightIris.position.y = -10;
        group.add(rightIris);

        // Left eye
        const leftEye = new this.THREE.Mesh(eyeGeom, eyeMat);
        leftEye.position.z = 60;
        leftEye.position.x = 25;
        leftEye.position.y = -10;
        group.add(leftEye);

        // Left iris
        const leftIris = new this.THREE.Mesh(irisGeom, irisMat);
        leftIris.position.z = 65;
        leftIris.position.x = 35;
        leftIris.position.y = -10;
        group.add(leftIris);

        // ============================================================
        // TEETH - 5 white teeth along the mouth
        // Slightly angled outward for character
        // ============================================================
        const toothGeom = new this.THREE.BoxGeometry(20, 4, 20);
        const toothMat = new this.THREE.MeshLambertMaterial({
            color: 0xffffff,
            flatShading: true
        });

        // Tooth 1 (rightmost)
        const tooth1 = new this.THREE.Mesh(toothGeom, toothMat);
        tooth1.position.x = 65;
        tooth1.position.y = -35;
        tooth1.position.z = -50;
        tooth1.rotation.z = halfPI;
        tooth1.rotation.x = -halfPI;
        group.add(tooth1);

        // Tooth 2
        const tooth2 = new this.THREE.Mesh(toothGeom, toothMat);
        tooth2.position.x = 65;
        tooth2.position.y = -30;
        tooth2.position.z = -25;
        tooth2.rotation.z = halfPI;
        tooth2.rotation.x = -Math.PI / 12;  // Slight angle
        group.add(tooth2);

        // Tooth 3 (center)
        const tooth3 = new this.THREE.Mesh(toothGeom, toothMat);
        tooth3.position.x = 65;
        tooth3.position.y = -25;
        tooth3.position.z = 0;
        tooth3.rotation.z = halfPI;
        group.add(tooth3);

        // Tooth 4
        const tooth4 = new this.THREE.Mesh(toothGeom, toothMat);
        tooth4.position.x = 65;
        tooth4.position.y = -30;
        tooth4.position.z = 25;
        tooth4.rotation.z = halfPI;
        tooth4.rotation.x = Math.PI / 12;
        group.add(tooth4);

        // Tooth 5 (leftmost)
        const tooth5 = new this.THREE.Mesh(toothGeom, toothMat);
        tooth5.position.x = 65;
        tooth5.position.y = -35;
        tooth5.position.z = 50;
        tooth5.rotation.z = halfPI;
        tooth5.rotation.x = Math.PI / 8;
        group.add(tooth5);

        // ============================================================
        // FINAL SETUP - Position, scale, and add to scene
        // ============================================================
        group.rotation.y = -Math.PI / 4;  // Angle fish toward viewer
        group.scale.setScalar(this.config.SCALE / 100);  // Apply config scale
        this.scene.add(group);

        // Store references to materials that change at runtime
        const materials = { body: bodyMat, lips: lipsMat };

        // Initialize animation state
        const velocity = new this.THREE.Vector3();
        const prevPos = group.position.clone();
        const speed = { x: 0, y: 0 };
        const finPhase = 0;

        // Return object with all fish components and state
        return {
            group,           // Root container
            bodyFish,        // Body mesh
            tailFish,        // Tail mesh
            tailPivot,       // Tail animation pivot
            topFish,         // Dorsal fin mesh
            topFinPivot,     // Dorsal fin pivot
            sideRightFish,   // Right pectoral fin
            sideLeftFish,    // Left pectoral fin
            rightEye,        // Right eye white
            rightIris,       // Right eye pupil
            leftEye,         // Left eye white
            leftIris,        // Left eye pupil
            lipsFish,        // Mouth mesh
            materials,       // Mutable materials { body, lips }
            velocity,        // Movement velocity vector
            prevPos,         // Previous position for velocity calc
            speed,           // Normalized speed { x, y }
            finPhase         // Animation phase counter
        };
    }

    /**
     * Main animation loop - called every frame via requestAnimationFrame.
     * 
     * ## Loop Flow
     * 1. Calculate delta time since last frame
     * 2. Determine which pointer (host/participant) controls the fish
     * 3. Set collision authority based on mode and controller
     * 4. Spawn background particles on timer
     * 5. Convert pointer screen coords to 3D world position
     * 6. Update fish position and animation
     * 7. Update particle positions
     * 8. Update star animations and check collisions
     * 9. Render the scene
     * 
     * ## Pointer Control Logic
     * 
     * **Single-player mode:**
     * - Participant pointer has priority if active (within INACTIVE_TIMEOUT_MS)
     * - Falls back to host pointer if participant is inactive
     * - Whoever is controlling handles collision detection
     * 
     * **Multiplayer mode:**
     * - ONLY participant can control the fish
     * - Host pointer is ignored for fish movement
     * - Fish stays in place if no active participant
     * - Only participant client reports star collisions
     * 
     * @private
     */
    _loop() {
        // Schedule next frame
        this._raf = requestAnimationFrame(() => this._loop());

        // Skip if not initialized
        if (!this.ready || !this.fish) return;

        // ============================================================
        // TIME CALCULATION
        // ============================================================
        const now = performance.now();
        const dt = (now - this._lastT) / 1000;  // Delta time in seconds
        this._lastT = now;
        const time = now * 0.001;  // Total time in seconds (for animations)

        // ============================================================
        // POINTER CONTROL - Determine who controls the fish
        // ============================================================
        const participantPointer = this.inputManager.getPointer("participant");
        const hostPointer = this.inputManager.getPointer("host");

        let activePointer = null;
        let currentController = null;

        if (this.isMultiplayerMode) {
            // MULTIPLAYER MODE: Only participant controls fish
            // Host manages star spawning via grid UI instead
            if (participantPointer && (now - participantPointer.lastSeen) < INACTIVE_TIMEOUT_MS) {
                activePointer = participantPointer;
                currentController = "participant";
            }
            // No host fallback - fish stays still without active participant
        } else {
            // SINGLE-PLAYER MODE: Participant priority, host fallback
            if (participantPointer && (now - participantPointer.lastSeen) < INACTIVE_TIMEOUT_MS) {
                activePointer = participantPointer;
                currentController = "participant";
            } else if (hostPointer) {
                activePointer = hostPointer;
                currentController = "host";
            }
        }

        // ============================================================
        // COLLISION AUTHORITY - Prevent double-counting star collection
        // Only the client controlling the fish should report collisions
        // ============================================================
        if (this.isMultiplayerMode) {
            // Multiplayer: participant client handles collisions when controlling
            this._isControllingFish = !this.isHost && currentController === "participant";
        } else {
            // Single-player: whoever is controlling handles collisions
            this._isControllingFish = (this.isHost && currentController === "host") ||
                (!this.isHost && currentController === "participant");
        }

        // Debug logging (throttled)
        if (currentController !== lastController || (now - lastControllerLog > CONTROLLER_LOG_THROTTLE_MS)) {
            if (currentController !== lastController) {
                console.log(`[Fish] Controller changed: ${lastController} -> ${currentController} (multiplayer: ${this.isMultiplayerMode})`);
            }
            lastController = currentController;
            lastControllerLog = now;
        }

        // ============================================================
        // PARTICLE SPAWNING - Background visual effect
        // ============================================================
        this._particleSpawnTimer += dt;
        const spawnInterval = 1.0 / this.config.PARTICLE_SPAWN_RATE;
        if (this._particleSpawnTimer >= spawnInterval) {
            this._particleSpawnTimer = 0;
            this._spawnParticle();
        }

        // ============================================================
        // FISH UPDATE - Only if there's an active controller
        // ============================================================
        if (activePointer) {
            const fish = this.fish;

            // Store pointer position on fish for animation calculations
            fish.pointerX = this._safeNumber(activePointer.x, fish.pointerX);
            fish.pointerY = this._safeNumber(activePointer.y, fish.pointerY);

            // Convert screen coordinates to normalized device coordinates (-1 to 1)
            const w = window.innerWidth;
            const h = window.innerHeight;
            this.mouseNdc.set((activePointer.x / w) * 2 - 1, -(activePointer.y / h) * 2 + 1);

            // Raycast from camera through pointer to find 3D world position
            this.raycaster.setFromCamera(this.mouseNdc, this.camera);
            if (this.raycaster.ray.intersectPlane(this.plane, this.planeHit)) {
                fish.targetPos.copy(this.planeHit);
            }

            // Update fish position, rotation, and animations
            this._updateFish(fish, dt, time);
        }

        // ============================================================
        // UPDATE OTHER SYSTEMS
        // ============================================================
        this._updateParticles(dt);
        this._updateStars(dt, time);

        // Render final frame
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Updates fish position, rotation, and animations for a single frame.
     * 
     * ## Animation Systems
     * 
     * 1. **Position Smoothing**
     *    - Fish smoothly follows target position using linear interpolation
     *    - Horizontal (X): Follows pointer X mapped to world coordinates
     *    - Vertical (Y): Based on pointer Y offset from center
     * 
     * 2. **Rotation/Tilt**
     *    - Fish tilts based on vertical movement (speedY)
     *    - Creates natural "banking" effect during movement
     * 
     * 3. **Fin Animation**
     *    - finPhase accumulates based on speed (faster = faster wiggle)
     *    - Tail: cosine wave rotation around Y axis
     *    - Top fin: sine wave rotation around X axis (slower cycle)
     *    - Side fins: follow top fin with reduced amplitude
     * 
     * 4. **Speed-based Color**
     *    - Body/lips color interpolates between COLOR_SLOW and COLOR_FAST
     *    - Based on normalized horizontal speed (0-1)
     * 
     * 5. **Speed-based Scale (Stretch)**
     *    - Fish stretches horizontally when moving fast
     *    - Compresses vertically/depth for "squash and stretch" effect
     * 
     * 6. **Eye Animation**
     *    - Eyes rotate based on vertical movement
     *    - Eyes squint (scale Y) based on horizontal speed
     *    - Irises shift position based on movement direction
     * 
     * @param {Object} fish - Fish object from _createFishMesh()
     * @param {number} dt - Delta time in seconds since last frame
     * @param {number} time - Total elapsed time in seconds
     * @private
     */
    _updateFish(fish, dt, time) {
        // Destructure fish components
        const {
            group,
            bodyFish,
            tailFish,
            tailPivot,
            topFish,
            topFinPivot,
            sideRightFish,
            sideLeftFish,
            rightEye,
            rightIris,
            leftEye,
            leftIris,
            lipsFish,
            materials
        } = fish;
        const { SMOOTHING } = this.config;

        // ============================================================
        // CALCULATE SPEED VALUES
        // ============================================================
        const w = Math.max(1, window.innerWidth);
        const h = Math.max(1, window.innerHeight);
        const windowHalfX = w / 2;
        const windowHalfY = h / 2;

        const pointerX = this._safeNumber(fish.pointerX, windowHalfX);
        const pointerY = this._safeNumber(fish.pointerY, windowHalfY);

        // speedX: 0-100 based on horizontal position (left=0, right=100)
        fish.speed.x = this._safeNumber(Math.max(0, Math.min(100, (pointerX / w) * 100)), 0);
        // speedY: Vertical offset from center, scaled down
        fish.speed.y = this._safeNumber((pointerY - windowHalfY) / 10, 0);

        // Track velocity for potential future use
        fish.velocity.copy(group.position).sub(fish.prevPos);
        fish.prevPos.copy(group.position);

        // Normalized values for animations
        const speedX = Math.max(0, Math.min(this._safeNumber(fish.speed.x, 0), 100));
        const speedY = this._safeNumber(fish.speed.y, 0);
        const speedNormalized = this._safeNumber(speedX / 100, 0);  // 0-1
        const speedScale = this._safeNumber(speedX / 300, 0);       // For stretch effect

        // ============================================================
        // POSITION - Smooth movement toward target
        // ============================================================
        const targetX = this._safeNumber(fish.targetPos?.x, this._safeNumber(group.position.x, 0));
        const currentX = this._safeNumber(group.position.x, 0);
        const newX = currentX + (targetX - currentX) / SMOOTHING;
        group.position.x = this._safeNumber(newX, currentX);

        // Y position based on vertical pointer offset
        const currentY = this._safeNumber(group.position.y, 0);
        const newY = currentY + ((-speedY * 0.15) - currentY) / SMOOTHING;
        group.position.y = this._safeNumber(newY, currentY);

        // ============================================================
        // ROTATION - Tilt based on movement
        // ============================================================
        const swingZ = this._safeNumber(-speedY / 50, 0);  // Banking angle
        const currentRotZ = this._safeNumber(group.rotation.z, 0);
        const currentRotX = this._safeNumber(group.rotation.x, 0);
        const currentRotY = this._safeNumber(group.rotation.y, 0);

        // Smooth rotation transitions
        group.rotation.z = this._safeNumber(currentRotZ + (swingZ - currentRotZ) / SMOOTHING, currentRotZ);
        group.rotation.x = this._safeNumber(currentRotX + (swingZ - currentRotX) / SMOOTHING, currentRotX);
        group.rotation.y = this._safeNumber(currentRotY + (swingZ - currentRotY) / SMOOTHING, currentRotY);

        // ============================================================
        // FIN ANIMATION - Speed-based wiggle
        // ============================================================
        // finPhase increases faster when moving faster
        fish.finPhase = this._safeNumber(fish.finPhase, 0) + speedNormalized;
        fish.finPhase = this._safeNumber(fish.finPhase, 0);

        // Different cycles for natural movement
        const backTailCycle = Math.cos(fish.finPhase);      // Tail wagging
        const sideFinsCycle = Math.sin(fish.finPhase / 5);  // Slower fin movement

        // Apply rotations to fin pivots
        tailPivot.rotation.y = backTailCycle * 0.5;         // Tail swings left/right
        topFinPivot.rotation.x = sideFinsCycle * 0.5;       // Top fin waves
        const halfPI = Math.PI / 2;
        sideRightFish.rotation.x = halfPI + sideFinsCycle * 0.2;  // Side fins flap
        sideLeftFish.rotation.x = halfPI + sideFinsCycle * 0.2;

        // ============================================================
        // COLOR - Interpolate between slow/fast colors based on speed
        // ============================================================
        const r = (this.config.COLOR_SLOW.r + (this.config.COLOR_FAST.r - this.config.COLOR_SLOW.r) * speedNormalized) / 255;
        const g = (this.config.COLOR_SLOW.g + (this.config.COLOR_FAST.g - this.config.COLOR_SLOW.g) * speedNormalized) / 255;
        const b = (this.config.COLOR_SLOW.b + (this.config.COLOR_FAST.b - this.config.COLOR_SLOW.b) * speedNormalized) / 255;

        if (isFinite(r) && isFinite(g) && isFinite(b)) {
            if (materials.body) materials.body.color.setRGB(r, g, b);
            if (materials.lips) materials.lips.color.setRGB(r, g, b);
        }

        // ============================================================
        // SCALE - Squash and stretch based on speed
        // ============================================================
        const baseScale = this._safeNumber(this.config.SCALE, 0.8) / 100;
        const scaleX = baseScale * (1 + speedScale);   // Stretch horizontally
        const scaleY = baseScale * (1 - speedScale);   // Compress vertically
        const scaleZ = baseScale * (1 - speedScale);   // Compress depth

        if (isFinite(scaleX) && isFinite(scaleY) && isFinite(scaleZ)) {
            group.scale.set(scaleX, scaleY, scaleZ);
        }

        // ============================================================
        // EYE ANIMATION - Tracking and squinting
        // ============================================================
        if (rightEye && leftEye) {
            // Eyes rotate based on vertical movement
            rightEye.rotation.z = leftEye.rotation.z = -speedY / 150;

            // Eyes squint when moving fast (reduce Y scale)
            const eyeScaleY = 1 - (speedX / 150);
            rightEye.scale.set(1, Math.max(eyeScaleY, 0.3), 1);  // Min 30% height
            leftEye.scale.set(1, Math.max(eyeScaleY, 0.3), 1);
        }

        // Irises shift based on movement direction
        if (rightIris && leftIris) {
            rightIris.position.x = 35 - speedY / 2;
            rightIris.position.y = -10 - speedY / 2;
            leftIris.position.x = 35 - speedY / 2;
            leftIris.position.y = -10 - speedY / 2;
        }
    }

    // ========================================================================
    // PARTICLE SYSTEM
    // 
    // Creates floating background particles that drift across the screen
    // from right to left. Particles are recycled via an object pool for
    // performance. The speed of particles is affected by fish movement.
    // ========================================================================

    /**
     * Creates a new particle mesh with random geometry and color.
     * 
     * Particles come in three shapes (equal probability):
     * - Box: Random dimensions 0.08-0.28 units
     * - Tetrahedron: Radius 0.08-0.23 units
     * - Sphere: Radius 0.05-0.25 units, low-poly (2-4 segments)
     * 
     * @returns {THREE.Mesh} A new particle mesh with random shape and color
     * @private
     */
    _createParticle() {
        const rnd = Math.random();
        let geometryCore;

        if (rnd < 0.33) {
            // Box particle - random dimensions
            const w = 0.08 + Math.random() * 0.2;
            const h = 0.08 + Math.random() * 0.2;
            const d = 0.08 + Math.random() * 0.2;
            geometryCore = new this.THREE.BoxGeometry(w, h, d);
        } else if (rnd < 0.66) {
            // Tetrahedron particle - pyramid shape
            const ray = 0.08 + Math.random() * 0.15;
            geometryCore = new this.THREE.TetrahedronGeometry(ray);
        } else {
            // Sphere particle - low-poly ball
            const ray = 0.05 + Math.random() * 0.2;
            const sh = 2 + Math.floor(Math.random() * 2);  // 2-3 horizontal segments
            const sv = 2 + Math.floor(Math.random() * 2);  // 2-3 vertical segments
            geometryCore = new this.THREE.SphereGeometry(ray, sh, sv);
        }

        const color = this._getRandomColor();
        const materialCore = new this.THREE.MeshLambertMaterial({
            color: color,
            flatShading: true  // Low-poly aesthetic
        });

        return new this.THREE.Mesh(geometryCore, materialCore);
    }

    /**
     * Gets a random color from the PARTICLE_COLORS config array.
     * Parses hex color strings and converts to THREE.Color.
     * 
     * @returns {THREE.Color} Random color from the particle palette
     * @private
     */
    _getRandomColor() {
        const hex = this.config.PARTICLE_COLORS[
            Math.floor(Math.random() * this.config.PARTICLE_COLORS.length)
        ];
        // Parse hex string (supports #RRGGBB format)
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (result) {
            const r = parseInt(result[1], 16);
            const g = parseInt(result[2], 16);
            const b = parseInt(result[3], 16);
            return new this.THREE.Color(`rgb(${r}, ${g}, ${b})`);
        }
        return new this.THREE.Color(hex);
    }

    /**
     * Gets a particle from the object pool, or creates a new one if pool is empty.
     * Object pooling prevents garbage collection pauses from constantly
     * creating/destroying particles.
     * 
     * @returns {THREE.Mesh} Particle mesh ready for use
     * @private
     */
    _getParticle() {
        if (this.waitingParticles.length) {
            return this.waitingParticles.pop();  // Reuse from pool
        } else {
            return this._createParticle();       // Create new
        }
    }

    /**
     * Spawns a new particle at the right edge of the screen.
     * Particles spawn at random Y positions and drift leftward.
     * 
     * Spawn position:
     * - X: Right edge of visible area
     * - Y: Random within visible bounds
     * - Z: Random -1 to 1 (slight depth variation)
     * 
     * @private
     */
    _spawnParticle() {
        const particle = this._getParticle();

        // Position at right edge, random height
        particle.position.x = this._viewBoundsX;
        particle.position.y = -this._viewBoundsY + Math.random() * this._viewBoundsY * 2;
        particle.position.z = (Math.random() - 0.5) * 2;

        // Random scale 0.15 - 0.75
        const s = 0.15 + Math.random() * 0.6;
        particle.scale.set(s, s, s);

        // Add to active list and scene
        this.flyingParticles.push(particle);
        this.scene.add(particle);
    }

    /**
     * Updates all active particles each frame.
     * 
     * Particle behavior:
     * - Rotate continuously (smaller = faster rotation)
     * - Drift leftward at speed affected by fish movement
     * - Recycle to pool when past left edge
     * 
     * @param {number} dt - Delta time in seconds (unused, constant speed)
     * @private
     */
    _updateParticles(dt) {
        // Fish speed affects particle drift speed (creates parallax effect)
        const speedX = this.fish ? this._safeNumber(this.fish.speed.x, 0) : 0;

        // Iterate backwards for safe removal during loop
        for (let i = this.flyingParticles.length - 1; i >= 0; i--) {
            const particle = this.flyingParticles[i];

            // Rotate particle (smaller particles spin faster)
            const rotSpeed = (1 / particle.scale.x) * 0.05;
            particle.rotation.y += rotSpeed;
            particle.rotation.x += rotSpeed;
            particle.rotation.z += rotSpeed;

            // Move leftward - faster when fish is moving right
            const baseSpeed = -0.08;
            const speedMultiplier = 0.4 + (speedX / 100) * 0.8;  // 0.4 - 1.2x
            particle.position.x += baseSpeed * speedMultiplier;

            // Recycle particle when past left edge
            const threshold = 1.2;  // Buffer zone past visible area
            if (particle.position.x < -this._viewBoundsX - threshold) {
                this.scene.remove(particle);
                // Return to pool for reuse
                this.waitingParticles.push(this.flyingParticles.splice(i, 1)[0]);
            }
        }
    }

    // ========================================================================
    // STAR SYSTEM
    // 
    // Collectible stars that float and twinkle on screen. Stars are positioned
    // on a grid system and synced via Firebase for multiplayer. When the fish
    // collides with a star, it's collected and the score increases.
    // 
    // Grid System: Stars are placed in an NxN grid (config.STAR_GRID_SIZE).
    // Each cell maps to a world position, with padding to avoid screen edges
    // and the left UI area.
    // ========================================================================

    /**
     * Returns a random number between min and max (inclusive).
     * 
     * @param {number} min - Minimum value
     * @param {number} max - Maximum value
     * @returns {number} Random value in range [min, max]
     * @private
     */
    _randBetween(min, max) {
        return min + Math.random() * (max - min);
    }

    /**
     * Converts a grid cell (row, col) to world coordinates.
     * 
     * The grid maps to screen space with:
     * - Left padding for UI elements (config.STAR_UI_LEFT_PX)
     * - Padding around edges to keep stars visible
     * - Cell centers positioned evenly across available space
     * 
     * ```
     * ┌─────────────────────────────┐
     * │ UI    │ (0,0) │ (0,1) │ ... │
     * │ Area  ├───────┼───────┤     │
     * │       │ (1,0) │ (1,1) │ ... │
     * │       ├───────┼───────┤     │
     * │       │  ...  │  ...  │     │
     * └─────────────────────────────┘
     * ```
     * 
     * @param {number} row - Grid row (0 = top)
     * @param {number} col - Grid column (0 = left, after UI)
     * @returns {THREE.Vector3} World position for cell center
     * @private
     */
    _gridCellToWorld(row, col) {
        const n = this._getStarGridSize();

        if (!this._viewBoundsX || !this._viewBoundsY) {
            return new this.THREE.Vector3(0, 0, 0);
        }

        // Calculate left margin for UI in world units (percentage-based)
        const uiRatio = this.config.STAR_UI_LEFT_RATIO || 0.2;
        const uiLeftWorldWidth = (this._viewBoundsX * 2) * uiRatio;

        // Add padding around edges
        const padX = Math.min(0.6, (this._viewBoundsX * 2 - uiLeftWorldWidth) * 0.08);
        const padY = Math.min(0.6, this._viewBoundsY * 0.12);

        // Calculate usable bounds
        const left = -this._viewBoundsX + uiLeftWorldWidth + padX;
        const right = this._viewBoundsX - padX;
        const top = this._viewBoundsY - padY;
        const bottom = -this._viewBoundsY + padY;

        // Map cell to normalized coordinates (0-1), centered in cell
        const u = (col + 0.5) / n;
        const v = (row + 0.5) / n;

        // Map to world coordinates
        const x = left + (right - left) * u;
        const y = top + (bottom - top) * v;

        return new this.THREE.Vector3(x, y, 0);
    }

    /**
     * Gets a random color from the STAR_COLORS palette.
     * 
     * @returns {THREE.Color} Random star color (gold/yellow tones)
     * @private
     */
    _getRandomStarColor() {
        const { STAR_COLORS } = this.config;
        const hex = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)];
        return new this.THREE.Color(hex);
    }

    /**
     * Creates or returns the cached glow texture for star sprites.
     * Uses canvas to draw a radial gradient from white center to transparent edge.
     * 
     * @returns {THREE.CanvasTexture} Glow texture
     * @private
     */
    _getStarGlowTexture() {
        if (this._starGlowTex) return this._starGlowTex;

        // Create canvas with radial gradient
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 128;
        const ctx = c.getContext('2d');

        const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0.00, 'rgba(255,255,255,1.0)');    // White center
        g.addColorStop(0.15, 'rgba(255,245,180,0.9)');    // Warm yellow
        g.addColorStop(0.45, 'rgba(255,210,60,0.45)');    // Gold
        g.addColorStop(1.00, 'rgba(255,210,60,0.0)');     // Transparent edge

        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);

        const tex = new this.THREE.CanvasTexture(c);
        tex.needsUpdate = true;
        this._starGlowTex = tex;
        return tex;
    }

    /**
     * Creates the geometry for a 5-pointed star shape.
     * 
     * Uses a Catmull-Rom curve to smooth the classic star outline,
     * then extrudes with bevel for a "puffy cartoon" 3D look.
     * 
     * @param {number} [points=5] - Number of star points
     * @param {number} [outerR=1] - Outer radius (point tips)
     * @param {number} [innerR=0.55] - Inner radius (valleys between points)
     * @param {number} [depth=0.25] - Extrusion depth
     * @returns {THREE.ExtrudeGeometry} Star geometry
     * @private
     */
    _createStarGeometry(points = 5, outerR = 1, innerR = 0.55, depth = 0.25) {
        // Build classic star vertices (alternating outer/inner points)
        const verts = [];
        const step = Math.PI / points;

        for (let i = 0; i < points * 2; i++) {
            const r = (i % 2 === 0) ? outerR : innerR;
            const a = i * step - Math.PI / 2;  // Start at top
            verts.push(new this.THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
        }

        // Smooth the polygon into a rounded star outline
        const tension = 0.55;   // Higher = rounder, bouncier look
        const samples = 140;    // More = smoother outline
        const curve = new this.THREE.CatmullRomCurve3(verts, true, "catmullrom", tension);
        const pts2 = curve.getPoints(samples).map(p => new this.THREE.Vector2(p.x, p.y));
        const shape = new this.THREE.Shape(pts2);

        // Extrude with chunky bevel for "puffy cartoon" look
        const geometry = new this.THREE.ExtrudeGeometry(shape, {
            depth,
            steps: 1,
            bevelEnabled: true,
            bevelThickness: depth * 0.8,
            bevelSize: outerR * 0.22,
            bevelSegments: 6,
            curveSegments: 24
        });

        geometry.center();
        geometry.computeVertexNormals();
        return geometry;
    }

    /**
     * Creates a complete star mesh with core, outline, glint, and glow.
     * 
     * Star composition (back to front):
     * 1. **Glow** - Sprite behind star with radial gradient
     * 2. **Outline** - Slightly larger black mesh for cartoon outline effect
     * 3. **Core** - Main star mesh with shiny physical material
     * 4. **Glint** - Small white circle for specular highlight
     * 
     * The core uses MeshPhysicalMaterial for a shiny "toy" appearance
     * with clearcoat and emissive properties for the twinkle effect.
     * 
     * @returns {THREE.Group} Star mesh group with all components
     * @private
     */
    _createStarMesh() {
        const size = this.config.STAR_SIZE_MAX;
        const geometry = this._createStarGeometry(5, size, size * 0.55, size * 0.28);
        const color = this._getRandomStarColor();

        // Core mesh - shiny physical material for "toy" appearance
        const coreMat = new this.THREE.MeshPhysicalMaterial({
            color,
            emissive: color.clone().multiplyScalar(0.4),  // Self-illumination
            emissiveIntensity: 0.6,
            roughness: 0.08,        // Very smooth/shiny
            metalness: 0.0,
            clearcoat: 1.0,         // Extra glossy layer
            clearcoatRoughness: 0.05,
            ior: 1.45               // Index of refraction
        });

        const core = new this.THREE.Mesh(geometry, coreMat);

        // Outline - larger black mesh behind for cartoon effect
        const outline = new this.THREE.Mesh(
            geometry.clone(),
            new this.THREE.MeshBasicMaterial({
                color: 0x000000,
                side: this.THREE.BackSide,  // Only visible from behind
                transparent: true,
                opacity: 0.22
            })
        );
        outline.scale.setScalar(1.08);  // Slightly larger than core

        // Glint - white highlight circle
        const glint = new this.THREE.Mesh(
            new this.THREE.CircleGeometry(size * 0.22, 24),
            new this.THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.75,
                blending: this.THREE.AdditiveBlending,
                depthWrite: false
            })
        );
        glint.position.set(size * 0.18, size * 0.22, size * 0.35);
        glint.rotation.z = Math.random() * Math.PI;

        // Glow sprite - soft halo behind star
        const glow = new this.THREE.Sprite(new this.THREE.SpriteMaterial({
            map: this._getStarGlowTexture(),
            color: color.clone(),
            transparent: true,
            opacity: 0.25,
            blending: this.THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false
        }));
        glow.scale.set(size * 3.0, size * 3.0, 1);
        glow.position.set(0, 0, -0.25);

        // Assemble into group
        const group = new this.THREE.Group();
        group.add(glow);      // Back layer
        group.add(outline);   // Outline layer
        group.add(core);      // Main star
        group.add(glint);     // Front highlight

        group.rotation.set(0, 0, 0);

        // Store references for twinkle animation
        group.userData.baseEmissive = coreMat.emissiveIntensity;
        group.userData.glint = glint;
        group.userData.glow = glow;

        return group;
    }

    /**
     * Initializes the star system.
     * Clears existing stars and waits for Firebase to provide star data.
     * Stars are always managed via Firebase for consistent multiplayer sync.
     * 
     * @private
     */
    _initStars() {
        this._clearStars();
    }

    /**
     * Spawns a single star at the given grid cell position.
     * Creates the mesh and initializes animation parameters.
     * 
     * Each star has randomized:
     * - Float radius (how far it wobbles from base position)
     * - Float speed (animation cycle speed)
     * - Spin speed (rotation rate)
     * - Phase offset (so stars don't animate in sync)
     * 
     * @param {Object} cell - Grid cell { row, col }
     * @param {string} id - Unique identifier for this star (from Firebase)
     * @private
     */
    _spawnStarAtCell(cell, id) {
        const mesh = this._createStarMesh();
        const basePosition = this._gridCellToWorld(cell.row, cell.col);

        // Randomize animation parameters
        const radius = this._randBetween(0.1, this.config.STAR_FLOAT_RADIUS);
        const speed = this._randBetween(this.config.STAR_FLOAT_SPEED_MIN, this.config.STAR_FLOAT_SPEED_MAX);
        const depth = this._randBetween(0.2, this.config.STAR_DEPTH_RANGE);
        const spinSpeed = this._randBetween(this.config.STAR_SPIN_SPEED_MIN, this.config.STAR_SPIN_SPEED_MAX);
        const phase = Math.random() * Math.PI * 2;  // Random start phase

        mesh.position.copy(basePosition);
        this.scene.add(mesh);

        // Store star data
        this.stars.push({
            id,           // Firebase ID for sync
            mesh,         // THREE.Group
            cell,         // { row, col } grid position
            basePosition, // Center of float animation
            radius,       // Float wobble radius
            speed,        // Float animation speed
            depth,        // Z-axis wobble (unused, kept at 0)
            spinSpeed,    // Rotation speed
            phase         // Animation phase offset
        });
        this._starCells.push(cell);
    }

    /**
     * Synchronizes local stars with Firebase data.
     * 
     * This is the main method for multiplayer star sync:
     * 1. Removes any local stars not in Firebase
     * 2. Creates any stars in Firebase that don't exist locally
     * 3. Adds a brief collision delay to prevent instant collection
     * 
     * Called whenever Firebase star data changes (from host placing stars
     * or from a star being collected).
     * 
     * @param {Array<{id: string, row: number, col: number}>} firebaseStars - Star data from Firebase
     * @public
     */
    syncStarsFromFirebase(firebaseStars) {
        if (!Array.isArray(firebaseStars)) firebaseStars = [];

        // Queue stars if not ready yet (will process in _init)
        if (!this.ready || !this.THREE) {
            this._pendingFirebaseStars = firebaseStars;
            return;
        }

        // Build ID sets for comparison
        const currentIds = new Set(this.stars.map(s => s.id));
        const newIds = new Set(firebaseStars.map(s => s.id));

        // Remove stars that are no longer in Firebase
        for (let i = this.stars.length - 1; i >= 0; i--) {
            if (!newIds.has(this.stars[i].id)) {
                this._removeStarByIndex(i);
            }
        }

        // Add stars that are new in Firebase
        firebaseStars.forEach(starData => {
            if (!currentIds.has(starData.id)) {
                this._spawnStarAtCell({ row: starData.row, col: starData.col }, starData.id);
            }
        });

        // Brief delay before collision detection to prevent instant collection
        this._collisionEnabledAt = performance.now() + 500;
    }

    /**
     * Removes a star by its array index.
     * Disposes the mesh and removes from tracking arrays.
     * 
     * @param {number} index - Index in this.stars array
     * @private
     */
    _removeStarByIndex(index) {
        if (index < 0 || index >= this.stars.length) return;

        const star = this.stars[index];
        this._disposeStarMesh(star.mesh);

        // Remove from tracking arrays
        this.stars.splice(index, 1);
        this._starCells.splice(index, 1);
    }

    /**
     * Updates world positions of all stars based on current grid size.
     * Called when window resizes or grid size changes.
     * 
     * @private
     */
    _updateStarGridPositions() {
        if (!this.stars.length) return;
        this.stars.forEach((star) => {
            star.basePosition.copy(this._gridCellToWorld(star.cell.row, star.cell.col));
        });
    }

    /**
     * Disposes a star mesh and frees GPU resources.
     * Traverses the group and disposes all geometries and materials.
     * 
     * @param {THREE.Group} mesh - Star mesh group to dispose
     * @private
     */
    _disposeStarMesh(mesh) {
        this.scene.remove(mesh);
        mesh.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach((mat) => mat.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
    }

    /**
     * Updates all stars each frame - handles animation and collision detection.
     * 
     * ## Animation
     * Each star floats in a Lissajous-like pattern around its base position:
     * - X: cos(t) * radius
     * - Y: sin(t * 1.3) * radius (slightly faster for figure-8 feel)
     * - Z: Fixed at 0 (same plane as fish)
     * 
     * Stars also:
     * - Spin around Z axis
     * - Twinkle (emissive intensity and glow opacity pulse)
     * 
     * ## Collision
     * Simple distance check between fish and star positions.
     * Only triggers collection after initial delay (_collisionEnabledAt).
     * 
     * @param {number} dt - Delta time in seconds
     * @param {number} time - Total elapsed time in seconds
     * @private
     */
    _updateStars(dt, time) {
        if (!this.stars.length) return;

        // Collision radius accounts for fish size + star size
        const collisionRadius = 0.7;

        // Iterate backwards for safe removal during collision
        for (let i = this.stars.length - 1; i >= 0; i--) {
            const star = this.stars[i];

            // Calculate float animation offset
            const t = time * star.speed + star.phase;
            const xOffset = Math.cos(t) * star.radius;
            const yOffset = Math.sin(t * 1.3) * star.radius;  // Slightly faster Y cycle

            // Update position (base + float offset)
            star.mesh.position.set(
                star.basePosition.x + xOffset,
                star.basePosition.y + yOffset,
                0  // Same z-layer as fish for collision
            );

            // Spin animation
            star.mesh.rotation.z += star.spinSpeed * dt;

            // Twinkle effect (pulsing brightness)
            const twinkle = 0.15 + 0.15 * Math.sin(time * 5 + star.phase);

            // Apply twinkle to emissive materials
            star.mesh.traverse((obj) => {
                const mat = obj.material;
                if (mat && mat.emissiveIntensity !== undefined) {
                    mat.emissiveIntensity = star.mesh.userData.baseEmissive + twinkle;
                }
            });

            // Update glint and glow opacity
            if (star.mesh.userData.glint) {
                star.mesh.userData.glint.material.opacity = 0.5 + twinkle;
            }
            if (star.mesh.userData.glow) {
                star.mesh.userData.glow.material.opacity = 0.15 + twinkle * 0.5;
            }

            // Collision detection (after initial delay)
            if (this.fish && performance.now() > this._collisionEnabledAt) {
                const fishPos = this.fish.group.position;
                const dist = fishPos.distanceTo(star.mesh.position);
                if (dist < collisionRadius) {
                    this._collectStar(i);
                }
            }
        }
    }

    /**
     * Handles star collection when fish collides with a star.
     * 
     * Process:
     * 1. Dispose the star mesh
     * 2. Remove from tracking arrays
     * 3. Call onStarCollected callback (only if this client has collision authority)
     * 
     * Collision authority prevents double-counting in multiplayer:
     * - Only the client controlling the fish calls the callback
     * - That client then updates Firebase, which syncs to all clients
     * 
     * @param {number} index - Index of collected star in this.stars array
     * @private
     */
    _collectStar(index) {
        if (index < 0 || index >= this.stars.length) return;

        const star = this.stars[index];
        const starId = star.id;

        // Remove visual representation
        this._disposeStarMesh(star.mesh);

        // Remove from tracking arrays
        this.stars.splice(index, 1);
        this._starCells.splice(index, 1);

        // Only the controlling client handles scoring to prevent double-counting
        // This client will update Firebase, which syncs the removal to other clients
        if (this._isControllingFish && typeof this.onStarCollected === 'function') {
            this.onStarCollected(starId);
        }

        // Note: Star regeneration is handled by app.js via Firebase
        // When all stars are collected, host will regenerate them
    }

    /**
     * Removes all stars and clears tracking arrays.
     * Called during reinitialization or cleanup.
     * 
     * @private
     */
    _clearStars() {
        if (!this.stars.length) return;
        this.stars.forEach((star) => this._disposeStarMesh(star.mesh));
        this.stars = [];
        this._starCells = [];
    }

    _resize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.renderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this._calculateViewLimits();
        this._updateStarGridPositions();
    }

    _debounce(fn, ms) {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), ms);
        };
    }

    destroy() {
        this.ready = false;
        cancelAnimationFrame(this._raf);
        window.removeEventListener("resize", this._onResize);
        document.removeEventListener("visibilitychange", this._onVisibility);

        if (this.fish) {
            this.scene.remove(this.fish.group);
            this.fish = null;
        }

        this.flyingParticles.forEach(particle => this.scene.remove(particle));
        this.flyingParticles = [];
        this.waitingParticles = [];

        this._clearStars();

        this.renderer.dispose();
        this.canvas.remove();
    }
}

export default WebGLFishCursor;
export { WebGLFishCursor };
