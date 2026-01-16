/**
 * WebGL Squid Cursor - Mighty Fish Effects Version
 * 
 * Design:
 * - Body: Full sphere (Ball).
 * - Orientation: Top of head (+Y) points at cursor; Tentacles (-Y) point away.
 * - Face (+Z) looks at user/camera.
 * - Features: Speed-based color transitions, particle system, dynamic animations
 */

import InputManager from './input-manager.js';

const threeCdn = "https://cdn.jsdelivr.net/npm/three@0.179.1/build/three.module.js";

class WebGLSquidCursor {
  constructor({ configOverrides = {}, autoMouseEvents = false } = {}) {
    this.THREE = null;
    this.ready = false;
    this.squids = new Map();

    this.inputManager = new InputManager(this, {
      cursorType: 'ballpit',
      useBallAssignment: false,
      inactiveTimeout: 5000
    });

    this.config = Object.assign({
      SQUID_COLOR: 0xffadc0,
      EYE_COLOR: 0x111111,
      FOLLOW_EASE: 0.1,
      PULSE_SPEED: 4,
      PULSE_AMPLITUDE: 0.1,
      TENTACLE_WIGGLE: 0.5,
      SCALE: 0.8,
      // Speed-based color transitions (matching fish example)
      COLOR_SLOW: { r: 0, g: 207, b: 255 }, // 0x00cfff cyan
      COLOR_FAST: { r: 255, g: 0, b: 224 }, // 0xff00e0 magenta
      // Particle system
      PARTICLE_SPAWN_RATE: 14, // particles per second (every ~70ms)
      PARTICLE_MAX_Z: 30,
      PARTICLE_COLORS: ['#dff69e', '#00ceff', '#002bca', '#ff00e0', '#3f159f', '#71b583', '#00a2ff'],
      // Speed effects
      SPEED_SCALE_FACTOR: 0.3,
      MIN_SPEED_THRESHOLD: 0.001,
      MAX_SPEED: 2.0,
      SMOOTHING: 10
    }, configOverrides);

    // Particle system
    this.flyingParticles = [];
    this.waitingParticles = [];
    this._particleSpawnTimer = 0;
    this._xLimit = 0;
    this._yLimit = 0;

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
    this._autoMouse = autoMouseEvents;

    this._init().catch(err => console.error("[Squid] failed to init:", err));
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

    this.raycaster = new this.THREE.Raycaster();
    this.mouseNdc = new this.THREE.Vector2(-10, -10);
    this.plane = new this.THREE.Plane(new this.THREE.Vector3(0, 0, 1), 0);
    this.planeHit = new this.THREE.Vector3();

    this._onResize();
    window.addEventListener("resize", this._onResize);
    document.addEventListener("visibilitychange", this._onVisibility);

    this._lastT = performance.now();
    this.ready = true;
    this._loop();
  }

  _calculateViewLimits() {
    if (!this.camera) return;
    const fieldOfView = 45;
    const ang = (fieldOfView / 2) * Math.PI / 180;
    // Calculate limits based on camera position and field of view
    // Particles spawn at z=0 (the plane), so use camera position for calculation
    this._yLimit = this.camera.position.z * Math.tan(ang);
    this._xLimit = this._yLimit * (this.camera.aspect || 1);
  }

  _createSquidMesh(color) {
    const group = new this.THREE.Group();
    const halfPI = Math.PI / 2;

    // Body
    const bodyGeom = new this.THREE.BoxGeometry(120, 120, 120);
    const bodyMat = new this.THREE.MeshLambertMaterial({
      color: 0x80f5fe,
      flatShading: true
    });
    const bodyFish = new this.THREE.Mesh(bodyGeom, bodyMat);
    group.add(bodyFish);

    // Tail
    const tailGeom = new this.THREE.CylinderGeometry(0, 60, 60, 4, 1, false);
    const tailMat = new this.THREE.MeshLambertMaterial({
      color: 0xff00dc,
      flatShading: true
    });
    // Create pivot at attachment point
    const tailPivot = new this.THREE.Object3D();
    tailPivot.position.set(-60, 0, 0);
    const tailFish = new this.THREE.Mesh(tailGeom, tailMat);
    tailFish.scale.set(0.8, 1, 0.1);
    tailFish.rotation.z = -halfPI;
    // Offset mesh by half-length so pivot sits at base (cylinder height = 60, half = 30)
    tailFish.position.x = -30;
    tailPivot.add(tailFish);
    group.add(tailPivot);

    // Lips
    const lipsGeom = new this.THREE.BoxGeometry(25, 10, 120);
    const lipsMat = new this.THREE.MeshLambertMaterial({
      color: 0x80f5fe,
      flatShading: true
    });
    const lipsFish = new this.THREE.Mesh(lipsGeom, lipsMat);
    lipsFish.position.x = 65;
    lipsFish.position.y = -47;
    lipsFish.rotation.z = halfPI;
    group.add(lipsFish);

    // Fins
    // Top fin with pivot - positioned to fit within body (body spans -60 to +60 in X)
    // In main.js, fin is at x=-20, y=60, rotating around its center
    // To fit within body, fin should extend from attachment point toward center
    const topFinPivot = new this.THREE.Object3D();
    topFinPivot.position.set(-20, 60, 0);
    const topFish = new this.THREE.Mesh(tailGeom, tailMat);
    topFish.scale.set(0.8, 1, 0.1);
    topFish.rotation.z = -halfPI;
    // Offset mesh so fin extends from attachment point (x=-20) toward center
    // Cylinder is 60 units, half is 30. To fit in body (-60 to +60), position mesh at +10
    // so fin extends from -20 to +40 (fits within -60 to +60)
    topFish.position.x = 10;
    topFinPivot.add(topFish);
    group.add(topFinPivot);

    // Right side fin - matching main.js exactly (no pivot, rotates around center)
    const sideRightFish = new this.THREE.Mesh(tailGeom, tailMat);
    sideRightFish.scale.set(0.8, 1, 0.1);
    sideRightFish.rotation.x = halfPI;
    sideRightFish.rotation.z = -halfPI;
    sideRightFish.position.x = 0;
    sideRightFish.position.y = -50;
    sideRightFish.position.z = -60;
    group.add(sideRightFish);

    // Left side fin - matching main.js exactly (no pivot, rotates around center)
    const sideLeftFish = new this.THREE.Mesh(tailGeom, tailMat);
    sideLeftFish.scale.set(0.8, 1, 0.1);
    sideLeftFish.rotation.x = halfPI;
    sideLeftFish.rotation.z = -halfPI;
    sideLeftFish.position.x = 0;
    sideLeftFish.position.y = -50;
    sideLeftFish.position.z = 60;
    group.add(sideLeftFish);

    // Eyes
    const eyeGeom = new this.THREE.BoxGeometry(40, 40, 5);
    const eyeMat = new this.THREE.MeshLambertMaterial({
      color: 0xffffff,
      flatShading: true
    });

    const rightEye = new this.THREE.Mesh(eyeGeom, eyeMat);
    rightEye.position.z = -60;
    rightEye.position.x = 25;
    rightEye.position.y = -10;
    group.add(rightEye);

    const irisGeom = new this.THREE.BoxGeometry(10, 10, 3);
    const irisMat = new this.THREE.MeshLambertMaterial({
      color: 0x330000,
      flatShading: true
    });

    const rightIris = new this.THREE.Mesh(irisGeom, irisMat);
    rightIris.position.z = -65;
    rightIris.position.x = 35;
    rightIris.position.y = -10;
    group.add(rightIris);

    const leftEye = new this.THREE.Mesh(eyeGeom, eyeMat);
    leftEye.position.z = 60;
    leftEye.position.x = 25;
    leftEye.position.y = -10;
    group.add(leftEye);

    const leftIris = new this.THREE.Mesh(irisGeom, irisMat);
    leftIris.position.z = 65;
    leftIris.position.x = 35;
    leftIris.position.y = -10;
    group.add(leftIris);

    // Teeth
    const toothGeom = new this.THREE.BoxGeometry(20, 4, 20);
    const toothMat = new this.THREE.MeshLambertMaterial({
      color: 0xffffff,
      flatShading: true
    });

    const tooth1 = new this.THREE.Mesh(toothGeom, toothMat);
    tooth1.position.x = 65;
    tooth1.position.y = -35;
    tooth1.position.z = -50;
    tooth1.rotation.z = halfPI;
    tooth1.rotation.x = -halfPI;
    group.add(tooth1);

    const tooth2 = new this.THREE.Mesh(toothGeom, toothMat);
    tooth2.position.x = 65;
    tooth2.position.y = -30;
    tooth2.position.z = -25;
    tooth2.rotation.z = halfPI;
    tooth2.rotation.x = -Math.PI / 12;
    group.add(tooth2);

    const tooth3 = new this.THREE.Mesh(toothGeom, toothMat);
    tooth3.position.x = 65;
    tooth3.position.y = -25;
    tooth3.position.z = 0;
    tooth3.rotation.z = halfPI;
    group.add(tooth3);

    const tooth4 = new this.THREE.Mesh(toothGeom, toothMat);
    tooth4.position.x = 65;
    tooth4.position.y = -30;
    tooth4.position.z = 25;
    tooth4.rotation.z = halfPI;
    tooth4.rotation.x = Math.PI / 12;
    group.add(tooth4);

    const tooth5 = new this.THREE.Mesh(toothGeom, toothMat);
    tooth5.position.x = 65;
    tooth5.position.y = -35;
    tooth5.position.z = 50;
    tooth5.rotation.z = halfPI;
    tooth5.rotation.x = Math.PI / 8;
    group.add(tooth5);

    group.rotation.y = -Math.PI / 4;
    group.scale.setScalar(this.config.SCALE / 100); // Scale down from 120 units to match cursor size
    this.scene.add(group);

    // Store materials for color updates
    const materials = { body: bodyMat, lips: lipsMat };

    // Initialize velocity tracking (still used for particles)
    const velocity = new this.THREE.Vector3();
    const prevPos = group.position.clone();
    const speed = { x: 0, y: 0 }; // Position-based speed matching sample
    const angleFin = 0; // For tail wagging animation

    return {
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
      materials,
      velocity,
      prevPos,
      speed,
      angleFin
    };
  }

  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    if (!this.ready) return;

    const now = performance.now();
    const dt = (now - this._lastT) / 1000;
    this._lastT = now;
    const time = now * 0.001;

    const activePointers = this.inputManager.getActivePointers();
    const activeUserIds = new Set(activePointers.map(p => p.userId));

    for (const [userId, squid] of this.squids.entries()) {
      if (!activeUserIds.has(userId)) {
        this.scene.remove(squid.group);
        this.squids.delete(userId);
      }
    }

    // Spawn particles globally (matching main.js - setInterval every 70ms)
    this._particleSpawnTimer += dt;
    const spawnInterval = 1.0 / this.config.PARTICLE_SPAWN_RATE; // ~70ms
    if (this._particleSpawnTimer >= spawnInterval) {
      this._particleSpawnTimer = 0;
      this._spawnParticle(); // Spawn globally, not per-squid
    }

    activePointers.forEach(pointer => {
      let squid = this.squids.get(pointer.userId);
      if (!squid) {
        squid = this._createSquidMesh(pointer.color);
        squid.targetPos = new this.THREE.Vector3(0, 0, 0); // Initialize at center
        squid.particleTimer = 0;
        // Initialize position at center
        squid.group.position.set(0, 0, 0);
        // Initialize pointer positions to center of screen to prevent NaN
        const w = window.innerWidth;
        const h = window.innerHeight;
        squid.pointerX = (typeof pointer.x === 'number' && !isNaN(pointer.x)) ? pointer.x : w / 2;
        squid.pointerY = (typeof pointer.y === 'number' && !isNaN(pointer.y)) ? pointer.y : h / 2;
        this.squids.set(pointer.userId, squid);
      }

      // Store pointer position for speed calculation (with validation)
      squid.pointerX = (typeof pointer.x === 'number' && !isNaN(pointer.x)) ? pointer.x : squid.pointerX;
      squid.pointerY = (typeof pointer.y === 'number' && !isNaN(pointer.y)) ? pointer.y : squid.pointerY;

      const w = window.innerWidth;
      const h = window.innerHeight;
      this.mouseNdc.set((pointer.x / w) * 2 - 1, -(pointer.y / h) * 2 + 1);
      this.raycaster.setFromCamera(this.mouseNdc, this.camera);
      if (this.raycaster.ray.intersectPlane(this.plane, this.planeHit)) {
        squid.targetPos.copy(this.planeHit);
      }

      this._updateSquid(squid, dt, time);
    });

    // Update all particles
    this._updateParticles(dt);

    this.renderer.render(this.scene, this.camera);
  }

  _calculateSpeed(squid, dt) {
    const { group } = squid;

    // Calculate velocity from position change
    squid.velocity.copy(group.position).sub(squid.prevPos);

    // Calculate speed magnitude
    squid.speed = squid.velocity.length() / (dt || 0.016); // normalize by dt

    // Normalize speed to 0-1 range
    squid.normalizedSpeed = Math.min(squid.speed / this.config.MAX_SPEED, 1.0);

    // Update previous position
    squid.prevPos.copy(group.position);
  }

  _updateSquidColor(squid, normalizedSpeed) {
    const { materials } = squid;
    const { COLOR_SLOW, COLOR_FAST } = this.config;

    // Interpolate RGB values based on speed
    const r = (COLOR_SLOW.r + (COLOR_FAST.r - COLOR_SLOW.r) * normalizedSpeed) / 255;
    const g = (COLOR_SLOW.g + (COLOR_FAST.g - COLOR_SLOW.g) * normalizedSpeed) / 255;
    const b = (COLOR_SLOW.b + (COLOR_FAST.b - COLOR_SLOW.b) * normalizedSpeed) / 255;

    // Apply color to body and tentacle materials
    if (materials.body) {
      materials.body.color.setRGB(r, g, b);
    }
    if (materials.tentacles) {
      materials.tentacles.color.setRGB(r, g, b);
    }
  }

  _updateSquid(squid, dt, time) {
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
    } = squid;
    const { SMOOTHING } = this.config;

    // Calculate speed from pointer position (matching sample folder)
    const w = Math.max(1, window.innerWidth); // Prevent division by zero
    const h = Math.max(1, window.innerHeight); // Prevent division by zero
    const windowHalfX = w / 2;
    const windowHalfY = h / 2;

    // Safety check: ensure pointerX and pointerY are valid numbers
    const pointerX = (typeof squid.pointerX === 'number' && !isNaN(squid.pointerX) && isFinite(squid.pointerX))
      ? squid.pointerX
      : windowHalfX;
    const pointerY = (typeof squid.pointerY === 'number' && !isNaN(squid.pointerY) && isFinite(squid.pointerY))
      ? squid.pointerY
      : windowHalfY;

    // Calculate speed with additional safety checks
    squid.speed.x = Math.max(0, Math.min(100, (pointerX / w) * 100));
    squid.speed.y = (pointerY - windowHalfY) / 10;

    // Ensure speed values are finite
    if (!isFinite(squid.speed.x)) squid.speed.x = 0;
    if (!isFinite(squid.speed.y)) squid.speed.y = 0;

    // Update velocity for particles (still needed for particle spawning direction)
    squid.velocity.copy(group.position).sub(squid.prevPos);
    squid.prevPos.copy(group.position);

    // Calculate normalized speed values (matching fish example)
    // Ensure speed values are valid numbers to prevent NaN
    const speedX = (isFinite(squid.speed.x) && !isNaN(squid.speed.x))
      ? Math.max(0, Math.min(squid.speed.x, 100))
      : 0;
    const speedY = (isFinite(squid.speed.y) && !isNaN(squid.speed.y))
      ? squid.speed.y
      : 0;
    let s2 = speedX / 100; // used for wagging speed and color (0-1)
    let s3 = speedX / 300; // used for scale

    // Final safety check: ensure s2 and s3 are finite
    if (!isFinite(s2) || isNaN(s2)) s2 = 0;
    if (!isFinite(s3) || isNaN(s3)) s3 = 0;

    // Update position with smoothing formula (matching sample)
    // X position: use targetPos calculated in _loop (already converted to 3D space)
    // If targetPos wasn't set (raycaster failed), keep current position
    const targetX = (squid.targetPos && isFinite(squid.targetPos.x))
      ? squid.targetPos.x
      : (isFinite(group.position.x) ? group.position.x : 0);
    const currentX = isFinite(group.position.x) ? group.position.x : 0;
    const newX = currentX + (targetX - currentX) / SMOOTHING;
    if (isFinite(newX)) group.position.x = newX;

    // Y position: use speed.y like sample
    // Scale down Y movement sensitivity (camera at z=15 vs sample's z=1000)
    // Camera distance ratio: 15/1000 = 0.015
    // Sample uses speed.y * 10, we need much smaller multiplier for our coordinate system
    // Using 0.15 (15% of original) to match the camera distance ratio
    const currentY = isFinite(group.position.y) ? group.position.y : 0;
    const newY = currentY + ((-speedY * 0.15) - currentY) / SMOOTHING;
    if (isFinite(newY)) group.position.y = newY;

    // Make fish swing according to mouse direction (matching sample)
    const swingZ = -speedY / 50;
    if (isFinite(swingZ)) {
      const currentRotZ = isFinite(group.rotation.z) ? group.rotation.z : 0;
      const currentRotX = isFinite(group.rotation.x) ? group.rotation.x : 0;
      const currentRotY = isFinite(group.rotation.y) ? group.rotation.y : 0;

      const newRotZ = currentRotZ + (swingZ - currentRotZ) / SMOOTHING;
      const newRotX = currentRotX + (swingZ - currentRotX) / SMOOTHING;
      const newRotY = currentRotY + (swingZ - currentRotY) / SMOOTHING;

      if (isFinite(newRotZ)) group.rotation.z = newRotZ;
      if (isFinite(newRotX)) group.rotation.x = newRotX;
      if (isFinite(newRotY)) group.rotation.y = newRotY;
    }

    // Tail and fin wagging animation
    // Ensure angleFin is initialized and finite
    if (typeof squid.angleFin !== 'number' || !isFinite(squid.angleFin)) {
      squid.angleFin = 0;
    }
    squid.angleFin += s2;
    // Ensure angleFin stays finite
    if (!isFinite(squid.angleFin)) squid.angleFin = 0;
    const backTailCycle = Math.cos(squid.angleFin);
    const sideFinsCycle = Math.sin(squid.angleFin / 5);

    tailPivot.rotation.y = backTailCycle * 0.5;
    topFinPivot.rotation.x = sideFinsCycle * 0.5;
    // Side fins rotate around their center (matching main.js exactly)
    const halfPI = Math.PI / 2;
    sideRightFish.rotation.x = halfPI + sideFinsCycle * 0.2;
    sideLeftFish.rotation.x = halfPI + sideFinsCycle * 0.2;

    // Update color based on speed (matching fish example)
    const rvalue = (this.config.COLOR_SLOW.r + (this.config.COLOR_FAST.r - this.config.COLOR_SLOW.r) * s2) / 255;
    const gvalue = (this.config.COLOR_SLOW.g + (this.config.COLOR_FAST.g - this.config.COLOR_SLOW.g) * s2) / 255;
    const bvalue = (this.config.COLOR_SLOW.b + (this.config.COLOR_FAST.b - this.config.COLOR_SLOW.b) * s2) / 255;

    // Ensure color values are finite before setting
    if (isFinite(rvalue) && isFinite(gvalue) && isFinite(bvalue)) {
      if (materials.body) {
        materials.body.color.setRGB(rvalue, gvalue, bvalue);
      }
      if (materials.lips) {
        materials.lips.color.setRGB(rvalue, gvalue, bvalue);
      }
    }

    // Scale update depending on speed (struggling effect)
    const baseScale = (this.config.SCALE && isFinite(this.config.SCALE)) ? this.config.SCALE / 100 : 0.008;
    const scaleX = baseScale * (1 + (isFinite(s3) ? s3 : 0));
    const scaleY = baseScale * (1 - (isFinite(s3) ? s3 : 0));
    const scaleZ = baseScale * (1 - (isFinite(s3) ? s3 : 0));

    // Ensure all scale values are finite before setting
    if (isFinite(scaleX) && isFinite(scaleY) && isFinite(scaleZ)) {
      group.scale.set(scaleX, scaleY, scaleZ);
    }

    // Eye tracking (matching sample - uses speed.y for vertical mouse offset)
    if (rightEye && leftEye) {
      rightEye.rotation.z = leftEye.rotation.z = -speedY / 150;

      // Speed-based eye narrowing (matching fish example - uses speed.x)
      const eyeScaleY = 1 - (speedX / 150);
      rightEye.scale.set(1, Math.max(eyeScaleY, 0.3), 1); // Clamp to prevent too narrow
      leftEye.scale.set(1, Math.max(eyeScaleY, 0.3), 1);
    }

    // Iris positioning (matching sample - uses speed.y)
    if (rightIris && leftIris) {
      rightIris.position.x = 35 - speedY / 2;
      rightIris.position.y = -10 - speedY / 2;
      leftIris.position.x = 35 - speedY / 2;
      leftIris.position.y = -10 - speedY / 2;
    }
  }

  _createParticle() {
    const rnd = Math.random();
    let geometryCore;

    // Random geometric shape (using original sizes that work with our coordinate system)
    // Keep sizes similar to original to ensure visibility
    if (rnd < 0.33) {
      // Box
      const w = 0.1 + Math.random() * 0.3;
      const h = 0.1 + Math.random() * 0.3;
      const d = 0.1 + Math.random() * 0.3;
      geometryCore = new this.THREE.BoxGeometry(w, h, d);
    } else if (rnd < 0.66) {
      // Tetrahedron
      const ray = 0.1 + Math.random() * 0.2;
      geometryCore = new this.THREE.TetrahedronGeometry(ray);
    } else {
      // Sphere
      const ray = 0.05 + Math.random() * 0.3;
      const sh = 2 + Math.floor(Math.random() * 2);
      const sv = 2 + Math.floor(Math.random() * 2);
      geometryCore = new this.THREE.SphereGeometry(ray, sh, sv);
    }

    const color = this._getRandomColor();
    const materialCore = new this.THREE.MeshLambertMaterial({
      color: color,
      flatShading: true
    });

    return new this.THREE.Mesh(geometryCore, materialCore);
  }

  _getRandomColor() {
    const hex = this.config.PARTICLE_COLORS[
      Math.floor(Math.random() * this.config.PARTICLE_COLORS.length)
    ];
    // Convert hex to RGB like main.js does
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
      const r = parseInt(result[1], 16);
      const g = parseInt(result[2], 16);
      const b = parseInt(result[3], 16);
      return new this.THREE.Color(`rgb(${r}, ${g}, ${b})`);
    }
    return new this.THREE.Color(hex);
  }

  _getParticle() {
    if (this.waitingParticles.length) {
      return this.waitingParticles.pop();
    } else {
      return this._createParticle();
    }
  }

  _spawnParticle() {
    // Spawn particles globally like main.js (not per-squid)
    // Particles spawn at right edge of screen (xLimit) and move left
    const particle = this._getParticle();

    // Set particle position at right edge of view (matching main.js)
    // main.js: particle.position.x = xLimit
    // main.js: particle.position.y = -yLimit + Math.random() * yLimit * 2
    // main.js: particle.position.z = Math.random() * maxParticlesZ
    // In our system, particles should be at z=0 (the plane where fish is)
    // Add slight z variation for depth (but keep near the plane)
    particle.position.x = this._xLimit;
    particle.position.y = -this._yLimit + Math.random() * this._yLimit * 2;
    particle.position.z = (Math.random() - 0.5) * 2; // Small z variation around 0

    // Random scale (matching main.js)
    const s = 0.1 + Math.random();
    particle.scale.set(s, s, s);

    // No initial rotation (matching main.js - rotation is only updated in movement)

    this.flyingParticles.push(particle);
    this.scene.add(particle);
  }

  _updateParticles(dt) {
    const { PARTICLE_MAX_Z } = this.config;

    // Get speed from first active squid (or use default)
    // In main.js, speed is global, but we have per-squid speeds
    // We'll use the first squid's speed, or average if multiple
    let speedX = 0;
    let speedY = 0;
    if (this.squids.size > 0) {
      const firstSquid = this.squids.values().next().value;
      speedX = (isFinite(firstSquid.speed.x) && !isNaN(firstSquid.speed.x)) ? firstSquid.speed.x : 0;
      speedY = (isFinite(firstSquid.speed.y) && !isNaN(firstSquid.speed.y)) ? firstSquid.speed.y : 0;
    }

    // Scale speed to match main.js coordinate system
    // main.js uses speed.x (0-100) and speed.y (relative to center)
    // Our speed.x is already 0-100, speed.y needs scaling
    const scaledSpeedX = speedX; // Already 0-100 like main.js
    const scaledSpeedY = speedY; // Already scaled in _updateSquid

    for (let i = this.flyingParticles.length - 1; i >= 0; i--) {
      const particle = this.flyingParticles[i];

      // Update rotation (matching main.js exactly)
      const rotSpeed = (1 / particle.scale.x) * 0.05;
      particle.rotation.y += rotSpeed;
      particle.rotation.x += rotSpeed;
      particle.rotation.z += rotSpeed;

      // Move particle - direction is always left, but velocity changes with speed
      // Particles move fast when cursor is on right (high speed.x), slow when cursor is on left (low speed.x)
      // No Y movement to keep direction constant
      const baseSpeed = -0.2; // Base movement speed when cursor is on left (always negative = left)
      // speed.x ranges from 0 (left) to 100 (right)
      // When cursor is right (speed.x = 100): particles move fast
      // When cursor is left (speed.x = 0): particles move slow
      const speedMultiplier = 0.5 + (scaledSpeedX / 100) * 1.5; // Range: 0.5x (left) to 2.0x (right)
      particle.position.x += baseSpeed * speedMultiplier; // Velocity changes, direction stays left

      // Check if particle is out of view (matching main.js)
      // main.js: if (particle.position.x < -xLimit - 80)
      // Scale 80 to match our coordinate system (same ratio as camera distance)
      const threshold = 1.2; // Scaled threshold for our coordinate system
      if (particle.position.x < -this._xLimit - threshold) {
        this.scene.remove(particle);
        this.waitingParticles.push(this.flyingParticles.splice(i, 1)[0]);
      }
    }
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._calculateViewLimits();
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

    // Clean up squids
    this.squids.forEach(squid => this.scene.remove(squid.group));
    this.squids.clear();

    // Clean up particles
    this.flyingParticles.forEach(particle => this.scene.remove(particle));
    this.flyingParticles = [];
    this.waitingParticles = [];

    this.renderer.dispose();
    this.canvas.remove();
  }
}

export default WebGLSquidCursor;
export { WebGLSquidCursor };
