// Lofi the Yeti — real 3D model (Quaternius "Ultimate Monsters" Yeti, CC0)
// loaded from ./assets/Yeti.gltf with the vendored three r187 GLTFLoader.
// The model is rigged + animated: Run / Jump / Duck / Idle clips drive the
// run cycle; the wrapper keeps the exact API main.js expects
// ({ group, setShield, animate(t, opts), ready }).
// If the GLB fails to load, a compact primitive fallback appears instead
// so the game never shows an invisible character.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/loaders/GLTFLoader.js';

const MODEL_URL = './assets/Yeti.gltf';
// Model is 2.83 m tall in bind pose -> 0.85 scale lands at ~2.4 m,
// a touch bigger than the old primitive yeti so it reads clearly.
const MODEL_SCALE = 0.85;

export function createYeti() {
  const g = new THREE.Group();
  const modelRoot = new THREE.Group(); // holds the GLB (or the fallback)
  modelRoot.scale.setScalar(MODEL_SCALE);
  g.add(modelRoot);

  // The yeti runs toward -z (away from the chase camera); the model faces
  // +z, so the whole group is turned around — same convention as before.
  g.rotation.y = Math.PI;

  // ---- shield bubble (unchanged) ----
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(1.05, 20, 14),
    new THREE.MeshBasicMaterial({
      color: 0x7fd8ff, transparent: true, opacity: 0.22,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  shield.position.y = 1.05;
  shield.visible = false;
  g.add(shield);

  // ---- blob shadow (unchanged) ----
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 24),
    new THREE.MeshBasicMaterial({ color: 0x1c2f4a, transparent: true, opacity: 0.28, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  g.add(blob);

  // ---- snow kick-up puffs: visible proof the feet are working ----
  // Small white puffs spawn at the feet on each stride, drift backwards
  // (the world scrolls past the yeti) and fade out.
  const PUFF_N = 10;
  const PUFF_LIFE = 0.45;
  const puffs = [];
  const puffGeo = new THREE.SphereGeometry(0.12, 8, 6);
  for (let i = 0; i < PUFF_N; i++) {
    const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
    }));
    m.visible = false;
    g.add(m);
    puffs.push({ mesh: m, age: PUFF_LIFE + 1 });
  }
  let puffTimer = 0;
  let puffSide = 1;

  // ---- animation state ----
  let mixer = null;
  const actions = {};
  let currentClip = null;
  let lastT = null;
  let wasAirborne = false;
  let wasSliding = false;
  // bones for stride amplification (filled on GLB load)
  const bones = {};
  let hipsBaseY = null;
  // Amplify the Run clip's own swing so the stride reads from the chase
  // camera: scale the clip-driven rotation on each limb bone. This is
  // phase-locked (it multiplies what the clip is already doing), so it
  // can never fight the animation.
  const STRIDE_AMP = [
    ['UpperLeg.L', 1.9], ['UpperLeg.R', 1.9],
    ['LowerLeg.L', 1.5], ['LowerLeg.R', 1.5],
    ['UpperArm.L', 2.0], ['UpperArm.R', 2.0],
    ['LowerArm.L', 1.4], ['LowerArm.R', 1.4],
  ];

  const api = {
    group: g,
    ready: false,
    setShield(on) { shield.visible = on; },
    animate(t, opts) {
      // drive the mixer from the run clock (works in real time and in the
      // fixed-step fast-forward used by ?shot= captures)
      let dt = 0;
      if (lastT !== null) dt = Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      if (mixer) mixer.update(dt);
      // stride amplification while running (see STRIDE_AMP)
      if (mixer && currentClip === 'Run') {
        for (const [name, f] of STRIDE_AMP) {
          const b = bones[name];
          if (b) b.rotation.x *= f;
        }
        const hips = bones['Hips'];
        if (hips && hipsBaseY !== null) {
          hips.position.y = hipsBaseY + (hips.position.y - hipsBaseY) * 1.6;
        }
      }

      const run = opts.running ? Math.max(0.4, Math.min(1, opts.speedNorm || 0)) : 0;
      // choose clip: slide -> Duck, air -> Jump, running -> Run, else Idle
      let want = 'Idle';
      if (opts.sliding) want = 'Duck';
      else if (opts.airborne) want = 'Jump';
      else if (opts.running) want = 'Run';
      if (want !== currentClip) playClip(want);

      // pose: the clips carry the crouch/tuck; keep only a mild group squash
      // for the slide so it reads clearly at speed, plus the old lane lean.
      if (opts.sliding) {
        g.scale.set(1.06, 0.82, 1.06);
      } else if (opts.airborne) {
        g.scale.set(0.98, 1.04, 0.98);
      } else {
        g.scale.set(1, 1, 1);
      }
      g.rotation.z = (opts.laneLean || 0) * 0.22;
      // forward lean while running (the model faces local +z = forward)
      // plus a slight side sway, so the body never reads as standing still
      // (kept small — the Run clip already hunches the brute forward)
      modelRoot.rotation.x = 0.08 * run + (opts.airborne ? 0.05 : 0);
      modelRoot.rotation.z = Math.sin(t * 11) * 0.02 * run;
      // the Run clip already bobs; add a bit more so the stride reads
      g.position.y = opts.baseY + (opts.airborne ? 0 : Math.abs(Math.sin(t * 11)) * 0.035 * run);
      // snow kick-up: one puff per stride, alternating feet, only on the ground
      if (!opts.airborne && !opts.sliding && run > 0.05) {
        puffTimer -= dt;
        if (puffTimer <= 0) {
          puffTimer = 0.42 - 0.2 * run; // strides quicken with speed
          puffSide *= -1;
          const p = puffs.find((q) => q.age > PUFF_LIFE) || puffs[0];
          p.age = 0;
          p.mesh.position.set(0.22 * puffSide, 0.05, -0.45);
          p.mesh.visible = true;
        }
      }
      for (const p of puffs) {
        if (p.age > PUFF_LIFE) { p.mesh.visible = false; continue; }
        p.age += dt;
        const k = p.age / PUFF_LIFE;
        p.mesh.position.z -= (3.5 + 6 * run) * dt; // drift backwards (local -z = world +z)
        p.mesh.position.y = 0.05 + p.age * 0.55;
        const s = 1 + p.age * 2.0;
        p.mesh.scale.set(s, s * 0.8, s);
        p.mesh.material.opacity = 0.35 * (1 - k);
      }
      if (shield.visible) {
        const p = 1 + Math.sin(t * 5) * 0.03;
        shield.scale.set(p, p, p);
      }
      const h = Math.max(0, g.position.y - (opts.baseY || 0));
      const bs = Math.max(0.55, 1 - h * 0.35);
      blob.scale.set(bs, bs, 1);
      blob.material.opacity = 0.28 * bs;
      wasAirborne = !!opts.airborne;
      wasSliding = !!opts.sliding;
    },
  };

  function playClip(name) {
    if (!mixer || !actions[name]) return;
    if (currentClip === name) return;
    const next = actions[name];
    if (currentClip && actions[currentClip]) actions[currentClip].fadeOut(0.18);
    next.reset().fadeIn(0.18).play();
    currentClip = name;
  }

  function buildFallback() {
    // Compact primitive yeti — only used if the GLB cannot load.
    const fur = new THREE.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 1 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x3f8cff, roughness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a2433, roughness: 0.4 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 14), fur);
    body.scale.set(1, 1.12, 0.92); body.position.y = 0.95; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.44, 20, 14), fur);
    head.position.y = 1.78; head.castShadow = true;
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x274b7a, roughness: 0.5 }));
    nose.position.set(0, 1.73, 0.42);
    modelRoot.add(body, head, nose);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.34, 4, 10), fur);
      arm.position.set(0.58 * s, 1.06, 0); arm.castShadow = true;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), blue);
      hand.position.set(0.58 * s, 0.78, 0);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.2, 4, 10), fur);
      leg.position.set(0.26 * s, 0.3, 0);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), blue);
      foot.scale.set(1, 0.55, 1.5); foot.position.set(0.26 * s, 0.08, 0.08);
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), blue);
      ear.scale.set(0.45, 1, 0.8); ear.position.set(0.44 * s, 1.8, 0);
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.34, 8), blue);
      horn.position.set(0.2 * s, 2.14, 0); horn.rotation.z = -0.3 * s;
      modelRoot.add(arm, hand, leg, foot, ear, horn);
    }
    // eyes (front, +z — the group rotation turns them away from the camera)
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), dark);
      eye.position.set(0.17 * s, 1.86, 0.38);
      modelRoot.add(eye);
    }
  }

  // ---- load the real model ----
  new GLTFLoader().load(
    MODEL_URL,
    (gltf) => {
      const model = gltf.scene;
      // center the model on the group's origin (bind-pose bbox is
      // x -2.32..2.32, z -0.65..0.83, feet at y ~0)
      model.position.set(0, 0.01, -0.09);
      model.traverse((o) => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; }
        if (o.isBone) bones[o.name] = o;
        // The shared Quaternius palette atlas paints the fur a mid-grey,
        // which reads beige-grey under the sunset light. Brighten the
        // material (slight blue bias) so the fur reads white like the
        // key art; dark parts stay dark because the multiply is relative.
        if (o.isMesh && o.material && o.material.color) {
          o.material.color.setRGB(1.75, 1.8, 2.0);
        }
      });
      if (bones['Hips']) hipsBaseY = bones['Hips'].position.y;
      modelRoot.add(model);
      mixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations) {
        const a = mixer.clipAction(clip);
        a.setLoop(THREE.LoopRepeat, Infinity);
        actions[clip.name] = a;
      }
      // The Quaternius Yeti's fur texture is already white with cool-blue
      // shading; keep it untouched (a global tint would blue the whole body).
      api.ready = true;
      playClip('Idle');
      console.log('[yeti] GLB loaded:', gltf.animations.map((c) => c.name).join(', '));
    },
    undefined,
    (err) => {
      console.warn('[yeti] GLB failed to load, using primitive fallback:', err);
      buildFallback();
      api.ready = true;
    },
  );

  return api;
}
