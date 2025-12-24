/**
 * WebGL Squid Cursor - Ball Version
 * 
 * Design:
 * - Body: Full sphere (Ball).
 * - Orientation: Top of head (+Y) points at cursor; Tentacles (-Y) point away.
 * - Face (+Z) looks at user/camera.
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
      SCALE: 0.8
    }, configOverrides);

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

  _createSquidMesh(color) {
    const group = new this.THREE.Group();
    const mainColor = color || this.config.SQUID_COLOR;
    const mat = new this.THREE.MeshStandardMaterial({ color: mainColor, roughness: 0.3 });
    const itemMat = new this.THREE.MeshStandardMaterial({ color: this.config.EYE_COLOR, roughness: 0.1 });

    const visuals = new this.THREE.Group();
    group.add(visuals);

    // Body (Full Ball)
    const ballGeom = new this.THREE.SphereGeometry(1, 48, 48);
    const body = new this.THREE.Mesh(ballGeom, mat);
    visuals.add(body);

    // Face (on +Z side)
    const eyeGeom = new this.THREE.SphereGeometry(0.18, 16, 16);
    const leftEye = new this.THREE.Mesh(eyeGeom, itemMat);
    leftEye.position.set(0.4, 0.2, 0.88);
    visuals.add(leftEye);

    const rightEye = new this.THREE.Mesh(eyeGeom, itemMat);
    rightEye.position.set(-0.4, 0.2, 0.88);
    visuals.add(rightEye);

    const smileGeom = new this.THREE.TorusGeometry(0.15, 0.03, 8, 12, Math.PI);
    const smile = new this.THREE.Mesh(smileGeom, itemMat);
    smile.position.set(0, 0, 0.95);
    smile.rotation.x = -Math.PI / 2;
    visuals.add(smile);

    // Tentacles (attached to sphere surface)
    const tentacles = [];
    const tentacleCount = 6;
    const sphereRadius = 1.0;
    const bottomAngle = Math.PI * 0.85;

    // Calculate first segment dimensions for proper inset
    const firstSize = 0.22 * (1 - 0 / 4) + 0.1;
    const firstHeight = firstSize * 1.2;

    for (let i = 0; i < tentacleCount; i++) {
      const tentacleRoot = new this.THREE.Group();

      const angle = (i / tentacleCount) * Math.PI * 2;

      // Surface normal
      const normal = new this.THREE.Vector3(
        Math.sin(bottomAngle) * Math.cos(angle),
        Math.cos(bottomAngle),
        Math.sin(bottomAngle) * Math.sin(angle)
      ).normalize();

      // Attach to sphere surface with inset to eliminate gap
      // Inset by half the first segment height so it overlaps the body
      tentacleRoot.position.copy(normal).multiplyScalar(
        sphereRadius - firstHeight * 0.5
      );

      // Rotate so local -Y points outward
      const quat = new this.THREE.Quaternion().setFromUnitVectors(
        new this.THREE.Vector3(0, -1, 0),
        normal
      );
      tentacleRoot.quaternion.copy(quat);

      let parent = tentacleRoot;
      const segments = [];

      for (let j = 0; j < 4; j++) {
        const size = 0.22 * (1 - j / 4) + 0.1;
        const geom = new this.THREE.BoxGeometry(size, size * 1.2, size);
        const mesh = new this.THREE.Mesh(geom, mat);

        mesh.position.y = -size * 1.2; // grow downward
        parent.add(mesh);
        parent = mesh;
        segments.push(mesh);
      }

      visuals.add(tentacleRoot);
      tentacles.push(segments);
    }

    group.scale.setScalar(this.config.SCALE);
    this.scene.add(group);

    return { group, visuals, tentacles };
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

    activePointers.forEach(pointer => {
      let squid = this.squids.get(pointer.userId);
      if (!squid) {
        squid = this._createSquidMesh(pointer.color);
        squid.targetPos = new this.THREE.Vector3();
        this.squids.set(pointer.userId, squid);
      }

      const w = window.innerWidth;
      const h = window.innerHeight;
      this.mouseNdc.set((pointer.x / w) * 2 - 1, -(pointer.y / h) * 2 + 1);
      this.raycaster.setFromCamera(this.mouseNdc, this.camera);
      if (this.raycaster.ray.intersectPlane(this.plane, this.planeHit)) {
        squid.targetPos.copy(this.planeHit);
      }

      this._updateSquid(squid, dt, time);
    });

    this.renderer.render(this.scene, this.camera);
  }

  _updateSquid(squid, dt, time) {
    const { group, visuals, tentacles } = squid;
    const { FOLLOW_EASE, PULSE_SPEED, PULSE_AMPLITUDE, TENTACLE_WIGGLE } = this.config;

    const prevPos = group.position.clone();
    group.position.lerp(squid.targetPos, FOLLOW_EASE);

    const velocity = group.position.clone().sub(prevPos);
    if (velocity.lengthSq() > 0.00001) {
      // Align local +Y (front) with velocity direction using quaternions
      const dir = velocity.clone().normalize();
      const targetQuat = new this.THREE.Quaternion().setFromUnitVectors(
        new this.THREE.Vector3(0, 1, 0), // local +Y (front)
        dir
      );
      group.quaternion.slerp(targetQuat, 0.15);
    }

    // Animation: Pulse
    const pulse = Math.sin(time * PULSE_SPEED) * PULSE_AMPLITUDE;
    visuals.scale.set(1 + pulse, 1 + pulse, 1 - pulse * 0.5);

    // Animation: Tentacle wiggle
    tentacles.forEach((segments, i) => {
      segments.forEach((seg, j) => {
        const shift = i * 0.5 + j * 0.4;
        const wiggle = Math.sin(time * PULSE_SPEED - shift) * TENTACLE_WIGGLE;
        // Apply wiggle with slight drag for subtle inertia
        seg.rotation.x = this.THREE.MathUtils.lerp(seg.rotation.x, wiggle, 0.9);
      });
    });
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
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
    this.squids.forEach(squid => this.scene.remove(squid.group));
    this.squids.clear();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

export default WebGLSquidCursor;
export { WebGLSquidCursor };
