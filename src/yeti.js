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
  const fb = {}; // primitive-fallback part refs (eyes, body) for blink/breathe
  // Blend weights so nothing about the jump snaps in one frame (see
  // JUMP_FIX.md): runWeight 1 = full stride amp / spine straighten
  // (Run clip), 0 = raw clip pose; airWeight 1 = fully airborne lean.
  let runWeight = 1;
  let airWeight = 0;
  let airTime = 0;    // seconds since takeoff (while airborne)
  let landTimer = -1; // >= 0 while the Jump_Land clip is playing
  let landSquash = 0; // 1 right after touchdown, decays in ~0.22 s (landing squash)
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
  // Straighten the Run clip's hunch: the brute's run cycle bends the spine
  // far forward (user: "terlalu membungkuk"). Attenuate the clip-driven
  // bend on the torso bones so the yeti runs noticeably more upright —
  // same phase-locked multiply as STRIDE_AMP, so it can never fight the
  // clip. Run clip only: the Duck slide stays crouched on purpose.
  const SPINE_STRAIGHTEN = [
    ['Abdomen', 0.4], ['Torso', 0.45], ['Neck', 0.7],
  ];
  // Proportion pass (19 Nov touch-up): the LONG ARMS stay — they are
  // Lofi's signature. The rest is rebalanced: slightly longer legs,
  // slightly slimmer torso, slightly bigger head, so the whole figure
  // reads balanced from the front and the back. legLift raises the model
  // so the lengthened feet still touch the snow.
  const PROPORTION = {
    legY: 1.07,
    torsoXZ: 0.94,
    head: 1.08,
    legLift: 0.08,
  };

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
      // Jump phase tracking: the pack ships Jump (takeoff) + Jump_Idle
      // (air hold) + Jump_Land (recovery) as separate clips. Chaining
      // them is what makes the jump read as one motion: the old code
      // looped the 0.367 s Jump clip over a 0.74 s airtime, so it
      // snapped back to its start pose mid-air.
      const airborne = !!opts.airborne;
      if (airborne && !wasAirborne) { airTime = 0; landTimer = -1; }
      if (airborne) airTime += dt;
      if (!airborne && wasAirborne) {
        landTimer = 0;
        landSquash = 1; // landing squash + snow burst at the feet
        for (let i = 0; i < 4; i++) {
          const p = puffs[i];
          p.age = 0;
          p.mesh.position.set(-0.3 + i * 0.2, 0.05, -0.4);
          p.mesh.visible = true;
        }
      }
      if (landTimer >= 0) {
        landTimer += dt;
        if (landTimer > 0.30) landTimer = -1;
      }
      if (landSquash > 0) landSquash = Math.max(0, landSquash - dt / 0.22);

      const run = opts.running ? Math.max(0.4, Math.min(1, opts.speedNorm || 0)) : 0;
      // choose clip: slide -> Duck, takeoff -> Jump, air -> Jump_Idle,
      // landing -> Jump_Land, running -> Run, else Idle
      let want = 'Idle';
      if (opts.sliding) want = 'Duck';
      else if (airborne && airTime < 0.34) want = 'Jump';
      else if (airborne) want = 'Jump_Idle';
      else if (landTimer >= 0) want = 'Jump_Land';
      else if (opts.running) want = 'Run';
      if (want !== currentClip) playClip(want);

      // Blend the stride amp / spine straighten in and out instead of
      // toggling them with the clip: they used to snap off the frame
      // the Run clip left (and snap back on at landing), which read as
      // a jerk. 0.22 s ramp, in step with the 0.18 s clip crossfade.
      const wTarget = currentClip === 'Run' ? 1 : 0;
      runWeight += Math.max(-dt / 0.12, Math.min(dt / 0.12, wTarget - runWeight));
      if (mixer) {
        for (const [name, f] of STRIDE_AMP) {
          const b = bones[name];
          if (b) b.rotation.x *= 1 + (f - 1) * runWeight;
        }
        for (const [name, f] of SPINE_STRAIGHTEN) {
          const b = bones[name];
          if (b) b.rotation.x *= 1 + (f - 1) * runWeight;
        }
        const hips = bones['Hips'];
        if (hips && hipsBaseY !== null) {
          hips.position.y = hipsBaseY + (hips.position.y - hipsBaseY) * (1 + 0.6 * runWeight);
        }
        // Proportion pass (19 Nov): long arms untouched — they are Lofi's
        // signature. Longer legs, slimmer torso, bigger head, so the figure
        // reads balanced from the front and the back.
        for (const n of ['UpperLeg.L', 'UpperLeg.R', 'LowerLeg.L', 'LowerLeg.R']) {
          const b = bones[n];
          if (b) b.scale.y = PROPORTION.legY;
        }
        for (const n of ['Abdomen', 'Torso']) {
          const b = bones[n];
          if (b) { b.scale.x = PROPORTION.torsoXZ; b.scale.z = PROPORTION.torsoXZ; }
        }
        const hd = bones['Head'];
        if (hd) hd.scale.setScalar(PROPORTION.head);
        // Idle head look-around (title screen): the mixer overwrites the
        // neck rotation every frame, so this is a one-frame offset — the
        // same pattern as the stride amp above, it can never fight the clip.
        if (bones['Neck'] && !opts.running && !airborne) {
          bones['Neck'].rotation.y += Math.sin(t * 0.55) * 0.28;
        }
      }

      // Airborne lean + squash ease in/out instead of snapping on the
      // takeoff/landing frame (same for the slide squash: lerp the
      // group scale toward its target instead of setting it).
      const aTarget = airborne ? 1 : 0;
      airWeight += Math.max(-dt / 0.08, Math.min(dt / 0.08, aTarget - airWeight));
      let sc = opts.sliding ? [1.06, 0.82, 1.06] : airborne ? [0.98, 1.04, 0.98] : [1, 1, 1];
      if (landSquash > 0) sc = [1 + 0.10 * landSquash, 1 - 0.22 * landSquash, 1 + 0.10 * landSquash];
      else if (airborne && airTime < 0.25) sc = [0.97, 1.07, 0.97]; // takeoff stretch
      const sk = Math.min(1, dt * 20);
      g.scale.x += (sc[0] - g.scale.x) * sk;
      g.scale.y += (sc[1] - g.scale.y) * sk;
      g.scale.z += (sc[2] - g.scale.z) * sk;
      g.rotation.z = (opts.laneLean || 0) * 0.22;
      // forward lean while running (the model faces local +z = forward)
      // plus a slight side sway, so the body never reads as standing still.
      // Kept small: the Run clip already hunches the brute forward, and the
      // spine straightening above handles the rest — the yeti must run
      // upright, never bent double, and never leaning backwards.
      modelRoot.rotation.x = 0.02 * run + 0.02 * airWeight;
      modelRoot.rotation.z = Math.sin(t * 11) * 0.02 * run;
      // Idle breathing (title screen): slow chest rise/fall.
      const breath = opts.running ? 0 : Math.sin(t * 2.1) * 0.012;
      modelRoot.scale.set(MODEL_SCALE, MODEL_SCALE * (1 + breath), MODEL_SCALE);
      // the Run clip already bobs; add a bit more so the stride reads.
      // The bob fades out with the stride amp during takeoff instead of
      // vanishing the frame the yeti leaves the ground.
      g.position.y = opts.baseY + (airborne ? 0 : Math.abs(Math.sin(t * 11)) * (0.035 + 0.02 * run) * run * runWeight);
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
      if (!mixer) {
        // Primitive fallback: blink + breathing (the GLB path has clips).
        const blink = (t % 3.4) < 0.12 ? 0.15 : 1;
        if (fb.eyeL) { fb.eyeL.scale.y = blink; fb.eyeR.scale.y = blink; }
        if (fb.body) fb.body.scale.y = 1.08 * (1 + (opts.running ? 0 : Math.sin(t * 2.1) * 0.02));
      }
      wasAirborne = !!opts.airborne;
      wasSliding = !!opts.sliding;
    },
  };

  function playClip(name) {
    if (!mixer || !actions[name]) return;
    if (currentClip === name) return;
    const next = actions[name];
    if (currentClip && actions[currentClip]) actions[currentClip].fadeOut(0.10);
    next.reset().fadeIn(0.10).play();
    currentClip = name;
  }

  function buildFallback() {
    // Compact primitive yeti — only used if the GLB cannot load.
    const fur = new THREE.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 1 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x3f8cff, roughness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a2433, roughness: 0.4 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 14), fur);
    body.scale.set(0.94, 1.08, 0.9); body.position.y = 0.95; body.castShadow = true;
    fb.body = body;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.47, 20, 14), fur);
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
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.3, 4, 10), fur);
      leg.position.set(0.26 * s, 0.32, 0);
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
      eye.position.set(0.17 * s, 1.86, 0.4);
      if (s < 0) fb.eyeL = eye; else fb.eyeR = eye;
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
      model.position.set(0, 0.01 + PROPORTION.legLift, -0.09);
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
      // Jump / Jump_Land are one-shot phases, never loops: a looped
      // 0.367 s Jump over a 0.74 s airtime snapped back to its start
      // pose mid-air. Clamp at the end pose instead, so a timing slip
      // can only hold the pose, never snap it.
      for (const n of ['Jump', 'Jump_Land']) {
        if (actions[n]) { actions[n].setLoop(THREE.LoopOnce, 1); actions[n].clampWhenFinished = true; }
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
