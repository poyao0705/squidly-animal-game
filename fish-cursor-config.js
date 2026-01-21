/**
 * @fileoverview WebGL Fish Cursor Configuration
 * 
 * This module provides default configuration values for the WebGLFishCursor class.
 * All visual appearance, animation parameters, and game settings are defined here.
 * 
 * ## Configuration Categories
 * 
 * 1. **Fish Appearance** - Colors, scale, animation parameters
 * 2. **Speed-based Color Transitions** - Dynamic color interpolation
 * 3. **Particle System** - Background particle settings
 * 4. **Speed Effects** - Movement and smoothing parameters
 * 5. **Star System** - Collectible star settings
 * 
 * @module FishCursorConfig
 */

/**
 * Default configuration object for WebGLFishCursor.
 * 
 * This object contains all default values used by the fish cursor system.
 * Values can be overridden when creating a WebGLFishCursor instance.
 * 
 * @type {Object}
 * @property {number} FISH_COLOR - Default fish body color (hex)
 * @property {number} EYE_COLOR - Fish eye color (hex)
 * @property {number} FOLLOW_EASE - Easing factor for fish following pointer (0-1)
 * @property {number} PULSE_SPEED - Speed of breathing/pulse animation
 * @property {number} PULSE_AMPLITUDE - Intensity of pulse animation
 * @property {number} FIN_WIGGLE - Amplitude of fin wiggle
 * @property {number} SCALE - Overall fish scale (0.8 = 80% of base size)
 * @property {Object} COLOR_SLOW - RGB values for fish color when moving slowly {r, g, b}
 * @property {Object} COLOR_FAST - RGB values for fish color when moving fast {r, g, b}
 * @property {number} PARTICLE_SPAWN_RATE - Background particles spawned per second
 * @property {number} PARTICLE_MAX_Z - Max depth for particles
 * @property {string[]} PARTICLE_COLORS - Array of hex color strings for particles
 * @property {number} SPEED_SCALE_FACTOR - How much speed affects fish stretch
 * @property {number} MIN_SPEED_THRESHOLD - Minimum speed to register movement
 * @property {number} MAX_SPEED - Maximum tracked speed
 * @property {number} SMOOTHING - Movement smoothing (higher = smoother)
 * @property {number} STAR_COUNT - Default number of stars (single-player)
 * @property {number} STAR_GRID_SIZE - Grid dimension for star placement (1-4, creates NxN grid)
 * @property {number} STAR_UI_LEFT_RATIO - Left margin as ratio of viewport width (0.2 = 20%)
 * @property {number} STAR_SIZE_MIN - Minimum star scale
 * @property {number} STAR_SIZE_MAX - Maximum star scale
 * @property {number} STAR_FLOAT_RADIUS - Radius of star floating animation
 * @property {number} STAR_FLOAT_SPEED_MIN - Min float animation speed
 * @property {number} STAR_FLOAT_SPEED_MAX - Max float animation speed
 * @property {number} STAR_DEPTH_RANGE - Z-axis wobble range
 * @property {number} STAR_SPIN_SPEED_MIN - Min rotation speed
 * @property {number} STAR_SPIN_SPEED_MAX - Max rotation speed
 * @property {string[]} STAR_COLORS - Array of hex color strings for stars
 */
export const DEFAULT_CONFIG = {
    // === Fish Appearance ===
    FISH_COLOR: 0xffadc0,          // Default pink body color
    EYE_COLOR: 0x111111,           // Dark eye color
    FOLLOW_EASE: 0.1,              // How quickly fish follows pointer
    PULSE_SPEED: 4,                // Speed of breathing/pulse animation
    PULSE_AMPLITUDE: 0.1,          // Intensity of pulse animation
    FIN_WIGGLE: 0.5,               // Amplitude of fin wiggle
    SCALE: 0.8,                     // Overall fish scale (1.0 = 100px base)

    // === Speed-based Color Transitions ===
    // Fish color interpolates between these based on movement speed
    COLOR_SLOW: { r: 0, g: 207, b: 255 },   // Cyan when still/slow
    COLOR_FAST: { r: 255, g: 0, b: 224 },   // Magenta when moving fast

    // === Particle System ===
    PARTICLE_SPAWN_RATE: 8,        // Particles per second
    PARTICLE_MAX_Z: 30,            // Max depth for particles
    PARTICLE_COLORS: ['#dff69e', '#00ceff', '#002bca', '#ff00e0', '#3f159f', '#71b583', '#00a2ff'],

    // === Speed Effects ===
    SPEED_SCALE_FACTOR: 0.3,       // How much speed affects fish stretch
    MIN_SPEED_THRESHOLD: 0.001,    // Minimum speed to register movement
    MAX_SPEED: 2.0,                // Maximum tracked speed
    SMOOTHING: 10,                 // Movement smoothing (higher = smoother)

    // === Star System ===
    STAR_COUNT: 5,                 // Default number of stars (single-player)
    STAR_GRID_SIZE: 4,             // NxN grid for star positions (1-4)
    STAR_UI_LEFT_RATIO: 0.2,       // Left margin as ratio of viewport (20% = 1/5)
    STAR_SIZE_MIN: 0.12,           // Minimum star scale
    STAR_SIZE_MAX: 0.3,            // Maximum star scale
    STAR_FLOAT_RADIUS: 0.35,       // Radius of floating animation
    STAR_FLOAT_SPEED_MIN: 0.6,     // Min float animation speed
    STAR_FLOAT_SPEED_MAX: 1.4,     // Max float animation speed
    STAR_DEPTH_RANGE: 1.2,         // Z-axis wobble range
    STAR_SPIN_SPEED_MIN: 0.3,      // Min rotation speed
    STAR_SPIN_SPEED_MAX: 1.1,      // Max rotation speed
    STAR_COLORS: ['#ffea00', '#ffd54a', '#ffcc2a', '#fff3a0']  // Gold/yellow palette
};

/**
 * Creates a configuration object by merging default values with provided overrides.
 * 
 * Uses shallow merge - nested objects (like COLOR_SLOW, COLOR_FAST) are replaced entirely,
 * not merged recursively. This is intentional to allow complete replacement of color objects.
 * 
 * @param {Object} [overrides={}] - Configuration overrides to apply
 * @returns {Object} Merged configuration object
 * @example
 * // Use all defaults
 * const config = createConfig();
 * 
 * @example
 * // Override specific values
 * const config = createConfig({
 *   SCALE: 1.0,
 *   STAR_GRID_SIZE: 2
 * });
 */
export function createConfig(overrides = {}) {
    return Object.assign({}, DEFAULT_CONFIG, overrides);
}
