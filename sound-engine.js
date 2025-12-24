/**
 * Fluid Sound Engine
 *
 * A real-time Web Audio API-based synthesizer that generates dynamic sound effects
 * based on cursor movement. Creates pitch-varying audio that responds to instantaneous
 * movement speed rather than distance from origin.
 *
 * Features:
 * - Three sound styles: "liquid", "chime", "synth"
 * - Pitch based on instantaneous movement speed (deltaX/deltaY per frame)
 * - Dynamic filtering and panning based on position
 * - Per-pointer voice management with throttling
 * - Impact sounds for clicks and splats
 *
 * @author Squidly Team
 * @version 1.0.0
 * @class FluidSoundEngine
 */
class FluidSoundEngine {
  constructor({
    style = "liquid", // "liquid" | "chime" | "synth"
    masterGain = 0.25, // overall volume
    minHz = 180,
    maxHz = 1600, // pitch clamp
    speedPitch = 2400, // Hz range contributed by speed
    attack = 0.005,
    release = 0.15, // envelope for continuous motion
    impactAtk = 0.002,
    impactRel = 0.25, // envelope for splats/clicks
    throttleMs = 24, // min time between motion updates per pointer
  } = {}) {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = masterGain;
    this.master.connect(this.ctx.destination);

    this.style = style;
    this.minHz = minHz;
    this.maxHz = maxHz;
    this.speedPitch = speedPitch;
    this.attack = attack;
    this.release = release;
    this.impactAtk = impactAtk;
    this.impactRel = impactRel;
    this.throttleMs = throttleMs;

    // Per-pointer voice state
    this.voices = new Map(); // key -> {osc, filt, pan, gain, lastT}
  }

  // Create a voice graph for a pointer if needed
  _getVoice(key, texX, texY) {
    let v = this.voices.get(key);
    if (v) return v;

    const t = this.ctx.currentTime;
    const pan = new StereoPannerNode(this.ctx, { pan: texX * 2 - 1 });
    const gain = new GainNode(this.ctx, { gain: 0.0 });
    const filter = new BiquadFilterNode(this.ctx, {
      type: "lowpass",
      frequency: 5000,
      Q: 0.5,
    });

    // Oscillator varies by style
    let osc = new OscillatorNode(this.ctx, {
      type:
        this.style === "synth"
          ? "sawtooth"
          : this.style === "chime"
          ? "triangle"
          : "sine",
      frequency: 440,
    });
    osc.connect(filter).connect(pan).connect(gain).connect(this.master);
    osc.start(t);

    // A subtle noise layer for texture (esp. "liquid")
    const noise = this._makeNoise();
    const nGain = new GainNode(this.ctx, {
      gain: this.style === "liquid" ? 0.12 : 0.06,
    });
    noise.connect(nGain).connect(filter);

    v = {
      osc,
      filter,
      pan,
      gain,
      noise,
      nGain,
      lastT: 0,
    };
    this.voices.set(key, v);
    return v;
  }

  _makeNoise() {
    const bufLen = 2 * this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start();
    return src;
  }

  // Convert movement characteristics into synth params and apply
  // Now based ONLY on instantaneous speed, not distance from origin
  updateMotion(
    key,
    {
      texX,
      texY,
      deltaX,
      deltaY, // normalized tex coords (0..1) and frame deltas
    }
  ) {
    const now = performance.now();
    const v = this._getVoice(key, texX, texY);

    // Throttle to avoid over-scheduling
    if (now - v.lastT < this.throttleMs) return;
    v.lastT = now;

    // Calculate instantaneous movement speed
    const sp = Math.hypot(deltaX, deltaY); // movement magnitude in texture space

    // Pitch from speed ONLY - using sqrt scaling for better dynamic range
    const fSpeed = this.speedPitch * Math.sqrt(sp); // sqrt allows full range
    let f = 220 + fSpeed; // base frequency
    f = Math.max(this.minHz, Math.min(this.maxHz, f));

    if (this.style === "chime") {
      // optional quantization to a pentatonic scale
      f = this._quantizePentatonic(f);
    }

    // Loudness & brightness based on speed
    const g = 0.04 + Math.min(sp * 2.5, 0.5); // 0.04..0.54
    const cutoff = 800 + Math.min(sp * 25000, 6000); // 0.8k..6.8k
    const pan = texX * 2 - 1;

    const t = this.ctx.currentTime;
    v.osc.frequency.exponentialRampToValueAtTime(Math.max(40, f), t + 0.03);
    v.filter.frequency.linearRampToValueAtTime(cutoff, t + 0.03);
    v.pan.pan.linearRampToValueAtTime(pan, t + 0.03);

    // Envelope for continuous motion
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.linearRampToValueAtTime(Math.max(0.0001, g), t + this.attack);
    v.gain.gain.linearRampToValueAtTime(0.0001, t + this.attack + this.release);

    // Style tweaks
    if (this.style === "synth") {
      v.filter.Q.value = 1.2;
      v.nGain.gain.setTargetAtTime(0.04, t, 0.02);
    } else if (this.style === "chime") {
      v.filter.Q.value = 8; // bell-ish
      v.nGain.gain.setTargetAtTime(0.02, t, 0.02);
    } else {
      // liquid
      v.filter.Q.value = 0.7;
      v.nGain.gain.setTargetAtTime(0.12, t, 0.02);
    }
  }

  // Short, punchy layer on click/splat
  impact(key, { texX, texY, velocityMag = 0.5 }) {
    const t = this.ctx.currentTime;
    const hit = this.ctx.createGain();
    hit.gain.value = 0;
    const pan = new StereoPannerNode(this.ctx, { pan: texX * 2 - 1 });
    const filt = new BiquadFilterNode(this.ctx, {
      type: "bandpass",
      frequency: 800 + velocityMag * 3000,
      Q: 1.2,
    });
    const noise = this._makeNoise();

    noise.connect(filt).connect(pan).connect(hit).connect(this.master);
    hit.gain.linearRampToValueAtTime(0.35, t + this.impactAtk);
    hit.gain.exponentialRampToValueAtTime(
      0.001,
      t + this.impactAtk + this.impactRel
    );

    // auto-stop
    setTimeout(() => {
      try {
        noise.stop();
      } catch (_) {}
      hit.disconnect();
      pan.disconnect();
      filt.disconnect();
    }, (this.impactAtk + this.impactRel + 0.05) * 1000);
  }

  setStyle(style) {
    this.style = style;
  }

  _quantizePentatonic(freq) {
    // A minor pentatonic: A C D E G
    const A4 = 440;
    const ratios = [1, 6 / 5, 4 / 3, 3 / 2, 9 / 5]; // approx
    // map freq to nearest ratio * 2^n * A4
    let best = freq,
      bestErr = Infinity;
    for (let n = -3; n <= 3; n++) {
      const base = A4 * Math.pow(2, n);
      for (const r of ratios) {
        const f = base * r;
        const err = Math.abs(f - freq);
        if (err < bestErr) {
          bestErr = err;
          best = f;
        }
      }
    }
    return best;
  }

  /**
   * Set the master volume
   * @param {number} volume - Volume level (0.0 to 1.0)
   * @public
   */
  setVolume(volume) {
    if (this.master && this.master.gain) {
      // Clamp between 0 and 1
      const v = Math.max(0, Math.min(1, volume));
      this.master.gain.setValueAtTime(v, this.ctx.currentTime);
    }
  }

  // Clean up all voices and audio context
  destroy() {
    this.voices.forEach((voice) => {
      try {
        voice.osc.stop();
        voice.noise.stop();
      } catch (_) {}
      // Disconnect all nodes
      voice.osc.disconnect();
      voice.noise.disconnect();
      voice.filter.disconnect();
      voice.pan.disconnect();
      voice.gain.disconnect();
    });
    this.voices.clear();

    if (this.ctx.state !== "closed") {
      this.ctx.close();
    }
  }
}

/**
 * Collision Sound Engine
 *
 * A Web Audio API-based sound system for collision effects.
 * Supports audio file playback for ballpit and metaballs cursors.
 * Can be used by any cursor that needs collision sound effects.
 *
 * Features:
 * - Custom audio file loading with fallback synthesis
 * - Intensity-based volume and pitch modulation
 * - Cooldown system to prevent audio spam
 * - Master gain control for volume management
 * - Automatic cleanup and resource management
 *
 * @author Squidly Team
 * @version 1.0.0
 * @class CollisionSoundEngine
 */
class CollisionSoundEngine {
  constructor({
    masterGain = 0.5,
    collisionSoundUrl = null,
    soundCooldown = 80,
    soundEnabled = true,
  } = {}) {
    this.masterGain = masterGain;
    this.collisionSoundUrl = collisionSoundUrl;
    this.soundCooldown = soundCooldown;
    this.soundEnabled = soundEnabled;

    this.audioContext = null;
    this.masterGainNode = null;
    this.audioBuffer = null;
    this.lastSoundTime = 0;

    this._initAudio();
  }

  /**
   * Initialize the Web Audio API context
   * @private
   */
  async _initAudio() {
    if (this.audioContext) return;

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContext();

      this.masterGainNode = this.audioContext.createGain();
      this.masterGainNode.gain.value = this.masterGain;
      this.masterGainNode.connect(this.audioContext.destination);

      if (this.collisionSoundUrl) {
        await this.loadCollisionSound(this.collisionSoundUrl);
      }
    } catch (e) {
      this.soundEnabled = false;
    }
  }

  /**
   * Load a custom collision sound from an audio file
   *
   * @param {string} audioUrl - URL to the audio file (mp3, wav, ogg, etc.)
   * @returns {Promise<boolean>} True if loaded successfully, false otherwise
   *
   * @example
   * await collisionSound.loadCollisionSound('./sounds/boop.mp3');
   *
   * @public
   */
  async loadCollisionSound(audioUrl) {
    if (!this.audioContext) {
      await this._initAudio();
    }

    try {
      const response = await fetch(audioUrl);
      const arrayBuffer = await response.arrayBuffer();
      this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.collisionSoundUrl = audioUrl;
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Play a collision sound effect
   * @param {number} intensity - Collision intensity (0-1)
   * @public
   */
  playCollision(intensity = 0.5) {
    if (!this.soundEnabled || !this.audioContext || !this.masterGainNode)
      return;

    const now = performance.now();
    if (now - this.lastSoundTime < this.soundCooldown) return;
    this.lastSoundTime = now;

    try {
      if (this.audioContext.state === "suspended") {
        this.audioContext.resume();
      }

      if (this.audioBuffer) {
        this._playBufferSound(intensity);
      } else {
        this._playSynthesizedSound(intensity);
      }
    } catch (e) {
      // Sound playback error
    }
  }

  /**
   * Play sound from loaded audio buffer
   * @param {number} intensity - Collision intensity (0-1)
   * @private
   */
  _playBufferSound(intensity) {
    const source = this.audioContext.createBufferSource();
    const gainNode = this.audioContext.createGain();

    source.buffer = this.audioBuffer;
    source.connect(gainNode);
    gainNode.connect(this.masterGainNode);

    source.playbackRate.value = 0.8 + intensity * 0.6;

    const volume = Math.min(0.3 + intensity * 0.5, 0.8);
    gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);

    const duration = this.audioBuffer.duration / source.playbackRate.value;
    if (duration > 0.1) {
      gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.01,
        this.audioContext.currentTime + duration
      );
    }

    source.start(this.audioContext.currentTime);
  }

  /**
   * Play synthesized sound (fallback)
   * @param {number} intensity - Collision intensity (0-1)
   * @private
   */
  _playSynthesizedSound(intensity) {
    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.masterGainNode);

    const baseFreq = 250 + intensity * 350;
    const volume = Math.min(0.08 + intensity * 0.12, 0.2);

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(
      baseFreq,
      this.audioContext.currentTime
    );
    oscillator.frequency.exponentialRampToValueAtTime(
      baseFreq * 0.5,
      this.audioContext.currentTime + 0.1
    );

    gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(
      volume,
      this.audioContext.currentTime + 0.005
    );
    gainNode.gain.exponentialRampToValueAtTime(
      0.001,
      this.audioContext.currentTime + 0.12
    );

    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + 0.13);
  }

  /**
   * Enable sound effects
   * @public
   */
  enableSound() {
    this.soundEnabled = true;
  }

  /**
   * Disable sound effects
   * @public
   */
  disableSound() {
    this.soundEnabled = false;
  }

  /**
   * Set the master volume
   * @param {number} volume - Volume level (0.0 to 1.0)
   * @public
   */
  setVolume(volume) {
    this.masterGain = Math.max(0, Math.min(1, volume));
    if (this.masterGainNode) {
      this.masterGainNode.gain.setValueAtTime(
        this.masterGain,
        this.audioContext ? this.audioContext.currentTime : 0
      );
    }
  }

  /**
   * Clean up audio context and resources
   * @public
   */
  destroy() {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
      this.masterGainNode = null;
    }
    this.audioBuffer = null;
  }
}

// Export for different module systems

export {
  FluidSoundEngine,
  CollisionSoundEngine,
  CollisionSoundEngine as BallpitSoundEngine,
};

// Keep hybrid compatibility (CommonJS + globals) if you still need it:
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FluidSoundEngine,
    CollisionSoundEngine,
    BallpitSoundEngine: CollisionSoundEngine,
  };
}

if (typeof window !== "undefined") {
  window.FluidSoundEngine = FluidSoundEngine;
  window.CollisionSoundEngine = CollisionSoundEngine;
  window.BallpitSoundEngine = CollisionSoundEngine; // alias
}
