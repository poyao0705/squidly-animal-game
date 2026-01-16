/**
 * WebGL Fish Cursor - Mighty Fish Effects Version
 * 
 * Design:
 * - Body: Full sphere (Ball).
 * - Orientation: Top of head (+Y) points at cursor; tail (-Y) points away.
 * - Face (+Z) looks at user/camera.
 * - Features: Speed-based color transitions, particle system, dynamic animations
 */

import InputManager from './input-manager.js';

const threeCdn = "https://cdn.jsdelivr.net/npm/three@0.179.1/build/three.module.js";

// Timeout (ms) after which participant is considered inactive and host takes over
const PARTICIPANT_INACTIVE_MS = 2000;

// Debug logging throttle
let lastControllerLog = 0;
let lastController = null;
const CONTROLLER_LOG_THROTTLE_MS = 1000;

class WebGLFishCursor {
    constructor({ configOverrides = {}, autoMouseEvents = false } = {}) {
        this.THREE = null;
        this.ready = false;

        // Single fish instance (created on init)
        this.fish = null;

        this.inputManager = new InputManager(this, {
            inactiveTimeout: 5000
        });

        this.config = Object.assign({
            FISH_COLOR: 0xffadc0,
            EYE_COLOR: 0x111111,
            FOLLOW_EASE: 0.1,
            PULSE_SPEED: 4,
            PULSE_AMPLITUDE: 0.1,
            FIN_WIGGLE: 0.5,
            SCALE: 0.8,
            // Speed-based color transitions
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

        this._init().catch(err => console.error("[Fish] failed to init:", err));
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

        // Create the single fish on init
        this.fish = this._createFishMesh();
        this.fish.targetPos = new this.THREE.Vector3(0, 0, 0);
        this.fish.particleTimer = 0;
        this.fish.group.position.set(0, 0, 0);
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.fish.pointerX = w / 2;
        this.fish.pointerY = h / 2;

        this._lastT = performance.now();
        this.ready = true;
        this._loop();
    }

    _calculateViewLimits() {
        if (!this.camera) return;
        const fieldOfView = 45;
        const ang = (fieldOfView / 2) * Math.PI / 180;
        this._yLimit = this.camera.position.z * Math.tan(ang);
        this._xLimit = this._yLimit * (this.camera.aspect || 1);
    }

    _createFishMesh(color) {
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
        const tailPivot = new this.THREE.Object3D();
        tailPivot.position.set(-60, 0, 0);
        const tailFish = new this.THREE.Mesh(tailGeom, tailMat);
        tailFish.scale.set(0.8, 1, 0.1);
        tailFish.rotation.z = -halfPI;
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
        const topFinPivot = new this.THREE.Object3D();
        topFinPivot.position.set(-20, 60, 0);
        const topFish = new this.THREE.Mesh(tailGeom, tailMat);
        topFish.scale.set(0.8, 1, 0.1);
        topFish.rotation.z = -halfPI;
        topFish.position.x = 10;
        topFinPivot.add(topFish);
        group.add(topFinPivot);

        // Right side fin
        const sideRightFish = new this.THREE.Mesh(tailGeom, tailMat);
        sideRightFish.scale.set(0.8, 1, 0.1);
        sideRightFish.rotation.x = halfPI;
        sideRightFish.rotation.z = -halfPI;
        sideRightFish.position.x = 0;
        sideRightFish.position.y = -50;
        sideRightFish.position.z = -60;
        group.add(sideRightFish);

        // Left side fin
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
        group.scale.setScalar(this.config.SCALE / 100);
        this.scene.add(group);

        const materials = { body: bodyMat, lips: lipsMat };
        const velocity = new this.THREE.Vector3();
        const prevPos = group.position.clone();
        const speed = { x: 0, y: 0 };
        const angleFin = 0;

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
        if (!this.ready || !this.fish) return;

        const now = performance.now();
        const dt = (now - this._lastT) / 1000;
        this._lastT = now;
        const time = now * 0.001;

        // Get both host and participant pointers
        const participantPointer = this.inputManager.getPointer("participant");
        const hostPointer = this.inputManager.getPointer("host");

        // Determine active pointer: participant has priority if recently active
        let activePointer = null;
        let currentController = null;
        if (participantPointer && (now - participantPointer.lastSeen) < PARTICIPANT_INACTIVE_MS) {
            activePointer = participantPointer;
            currentController = "participant";
        } else if (hostPointer) {
            activePointer = hostPointer;
            currentController = "host";
        }

        // Log controller changes or periodically
        if (currentController !== lastController || (now - lastControllerLog > CONTROLLER_LOG_THROTTLE_MS)) {
            if (currentController !== lastController) {
                console.log(`[Fish] Controller changed: ${lastController} -> ${currentController}`);
            }
            if (activePointer) {
                console.log(`[Fish] Active: ${currentController}, x=${Math.round(activePointer.x)}, y=${Math.round(activePointer.y)}, lastSeen=${Math.round(now - activePointer.lastSeen)}ms ago`);
            }
            lastController = currentController;
            lastControllerLog = now;
        }

        // Spawn particles globally
        this._particleSpawnTimer += dt;
        const spawnInterval = 1.0 / this.config.PARTICLE_SPAWN_RATE;
        if (this._particleSpawnTimer >= spawnInterval) {
            this._particleSpawnTimer = 0;
            this._spawnParticle();
        }

        // Update the single fish with the active pointer's position
        if (activePointer) {
            const fish = this.fish;
            const pointer = activePointer;

            fish.pointerX = (typeof pointer.x === 'number' && !isNaN(pointer.x)) ? pointer.x : fish.pointerX;
            fish.pointerY = (typeof pointer.y === 'number' && !isNaN(pointer.y)) ? pointer.y : fish.pointerY;

            const w = window.innerWidth;
            const h = window.innerHeight;
            this.mouseNdc.set((pointer.x / w) * 2 - 1, -(pointer.y / h) * 2 + 1);
            this.raycaster.setFromCamera(this.mouseNdc, this.camera);
            if (this.raycaster.ray.intersectPlane(this.plane, this.planeHit)) {
                fish.targetPos.copy(this.planeHit);
            }

            this._updateFish(fish, dt, time);
        }

        this._updateParticles(dt);
        this.renderer.render(this.scene, this.camera);
    }

    _updateFish(fish, dt, time) {
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

        const w = Math.max(1, window.innerWidth);
        const h = Math.max(1, window.innerHeight);
        const windowHalfX = w / 2;
        const windowHalfY = h / 2;

        const pointerX = (typeof fish.pointerX === 'number' && !isNaN(fish.pointerX) && isFinite(fish.pointerX))
            ? fish.pointerX
            : windowHalfX;
        const pointerY = (typeof fish.pointerY === 'number' && !isNaN(fish.pointerY) && isFinite(fish.pointerY))
            ? fish.pointerY
            : windowHalfY;

        fish.speed.x = Math.max(0, Math.min(100, (pointerX / w) * 100));
        fish.speed.y = (pointerY - windowHalfY) / 10;

        if (!isFinite(fish.speed.x)) fish.speed.x = 0;
        if (!isFinite(fish.speed.y)) fish.speed.y = 0;

        fish.velocity.copy(group.position).sub(fish.prevPos);
        fish.prevPos.copy(group.position);

        const speedX = (isFinite(fish.speed.x) && !isNaN(fish.speed.x))
            ? Math.max(0, Math.min(fish.speed.x, 100))
            : 0;
        const speedY = (isFinite(fish.speed.y) && !isNaN(fish.speed.y))
            ? fish.speed.y
            : 0;
        let s2 = speedX / 100;
        let s3 = speedX / 300;

        if (!isFinite(s2) || isNaN(s2)) s2 = 0;
        if (!isFinite(s3) || isNaN(s3)) s3 = 0;

        const targetX = (fish.targetPos && isFinite(fish.targetPos.x))
            ? fish.targetPos.x
            : (isFinite(group.position.x) ? group.position.x : 0);
        const currentX = isFinite(group.position.x) ? group.position.x : 0;
        const newX = currentX + (targetX - currentX) / SMOOTHING;
        if (isFinite(newX)) group.position.x = newX;

        const currentY = isFinite(group.position.y) ? group.position.y : 0;
        const newY = currentY + ((-speedY * 0.15) - currentY) / SMOOTHING;
        if (isFinite(newY)) group.position.y = newY;

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

        if (typeof fish.angleFin !== 'number' || !isFinite(fish.angleFin)) {
            fish.angleFin = 0;
        }
        fish.angleFin += s2;
        if (!isFinite(fish.angleFin)) fish.angleFin = 0;
        const backTailCycle = Math.cos(fish.angleFin);
        const sideFinsCycle = Math.sin(fish.angleFin / 5);

        tailPivot.rotation.y = backTailCycle * 0.5;
        topFinPivot.rotation.x = sideFinsCycle * 0.5;
        const halfPI = Math.PI / 2;
        sideRightFish.rotation.x = halfPI + sideFinsCycle * 0.2;
        sideLeftFish.rotation.x = halfPI + sideFinsCycle * 0.2;

        const rvalue = (this.config.COLOR_SLOW.r + (this.config.COLOR_FAST.r - this.config.COLOR_SLOW.r) * s2) / 255;
        const gvalue = (this.config.COLOR_SLOW.g + (this.config.COLOR_FAST.g - this.config.COLOR_SLOW.g) * s2) / 255;
        const bvalue = (this.config.COLOR_SLOW.b + (this.config.COLOR_FAST.b - this.config.COLOR_SLOW.b) * s2) / 255;

        if (isFinite(rvalue) && isFinite(gvalue) && isFinite(bvalue)) {
            if (materials.body) {
                materials.body.color.setRGB(rvalue, gvalue, bvalue);
            }
            if (materials.lips) {
                materials.lips.color.setRGB(rvalue, gvalue, bvalue);
            }
        }

        const baseScale = (this.config.SCALE && isFinite(this.config.SCALE)) ? this.config.SCALE / 100 : 0.008;
        const scaleX = baseScale * (1 + (isFinite(s3) ? s3 : 0));
        const scaleY = baseScale * (1 - (isFinite(s3) ? s3 : 0));
        const scaleZ = baseScale * (1 - (isFinite(s3) ? s3 : 0));

        if (isFinite(scaleX) && isFinite(scaleY) && isFinite(scaleZ)) {
            group.scale.set(scaleX, scaleY, scaleZ);
        }

        if (rightEye && leftEye) {
            rightEye.rotation.z = leftEye.rotation.z = -speedY / 150;
            const eyeScaleY = 1 - (speedX / 150);
            rightEye.scale.set(1, Math.max(eyeScaleY, 0.3), 1);
            leftEye.scale.set(1, Math.max(eyeScaleY, 0.3), 1);
        }

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

        if (rnd < 0.33) {
            const w = 0.1 + Math.random() * 0.3;
            const h = 0.1 + Math.random() * 0.3;
            const d = 0.1 + Math.random() * 0.3;
            geometryCore = new this.THREE.BoxGeometry(w, h, d);
        } else if (rnd < 0.66) {
            const ray = 0.1 + Math.random() * 0.2;
            geometryCore = new this.THREE.TetrahedronGeometry(ray);
        } else {
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
        const particle = this._getParticle();

        particle.position.x = this._xLimit;
        particle.position.y = -this._yLimit + Math.random() * this._yLimit * 2;
        particle.position.z = (Math.random() - 0.5) * 2;

        const s = 0.1 + Math.random();
        particle.scale.set(s, s, s);

        this.flyingParticles.push(particle);
        this.scene.add(particle);
    }

    _updateParticles(dt) {
        let speedX = 0;
        let speedY = 0;
        if (this.fish) {
            speedX = (isFinite(this.fish.speed.x) && !isNaN(this.fish.speed.x)) ? this.fish.speed.x : 0;
            speedY = (isFinite(this.fish.speed.y) && !isNaN(this.fish.speed.y)) ? this.fish.speed.y : 0;
        }

        const scaledSpeedX = speedX;

        for (let i = this.flyingParticles.length - 1; i >= 0; i--) {
            const particle = this.flyingParticles[i];

            const rotSpeed = (1 / particle.scale.x) * 0.05;
            particle.rotation.y += rotSpeed;
            particle.rotation.x += rotSpeed;
            particle.rotation.z += rotSpeed;

            const baseSpeed = -0.2;
            const speedMultiplier = 0.5 + (scaledSpeedX / 100) * 1.5;
            particle.position.x += baseSpeed * speedMultiplier;

            const threshold = 1.2;
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

        if (this.fish) {
            this.scene.remove(this.fish.group);
            this.fish = null;
        }

        this.flyingParticles.forEach(particle => this.scene.remove(particle));
        this.flyingParticles = [];
        this.waitingParticles = [];

        this.renderer.dispose();
        this.canvas.remove();
    }
}

export default WebGLFishCursor;
export { WebGLFishCursor };
