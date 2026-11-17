// Lofi the Yeti — built entirely from three.js primitives.
// White fur (rough, matte), blue hands / feet / ears / horns, matching the key art.
// No textures, no external assets.
import * as THREE from 'three';

const FUR = 0xf4f7fb;        // white fur
const FUR_SHADOW = 0xdfe8f2; // slightly blue-grey fur in shadowed areas
const BLUE = 0x3f8cff;       // Lofi blue (hands, feet, ears, horns)
const BLUE_DARK = 0x2b6fd6;
const NOSE = 0x274b7a;

function std(color, roughness = 0.95, metalness = 0.0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: false });
}

// A small fur tuft: a squashed cone, slightly randomized tilt.
function tuft(mat, x, y, z, s, rx = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(0.09 * s, 0.22 * s, 6), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, 0, rz);
  m.castShadow = true;
  return m;
}

export function createYeti() {
  const g = new THREE.Group();
  const fur = std(FUR, 1.0);
  const fur2 = std(FUR_SHADOW, 1.0);
  const blue = std(BLUE, 0.55);
  const blueDark = std(BLUE_DARK, 0.55);
  const dark = std(0x1a2433, 0.4);

  // ---- body: big egg-shaped torso ----
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 18), fur);
  body.scale.set(1.0, 1.12, 0.92);
  body.position.y = 0.95;
  body.castShadow = true;
  g.add(body);

  // belly patch (lighter, slightly forward)
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), std(0xffffff, 1.0));
  belly.scale.set(0.85, 1.0, 0.55);
  belly.position.set(0, 0.88, 0.38);
  g.add(belly);

  // fur tufts on shoulders / chest
  g.add(tuft(fur2, -0.5, 1.35, 0.35, 1.1, 0.3, 0.5));
  g.add(tuft(fur2, 0.5, 1.35, 0.35, 1.1, 0.3, -0.5));
  g.add(tuft(fur2, 0, 1.15, 0.55, 0.9, 0.5, 0));
  g.add(tuft(fur2, -0.35, 1.5, 0.1, 0.9, -0.2, 0.4));
  g.add(tuft(fur2, 0.35, 1.5, 0.1, 0.9, -0.2, -0.4));

  // ---- head ----
  const head = new THREE.Group();
  head.position.y = 1.78;
  g.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.44, 24, 18), fur);
  skull.scale.set(1.0, 0.92, 0.94);
  skull.castShadow = true;
  head.add(skull);

  // face patch (light muzzle area)
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.26, 18, 12), std(0xffffff, 1.0));
  muzzle.scale.set(1.15, 0.8, 0.7);
  muzzle.position.set(0, -0.12, 0.3);
  head.add(muzzle);

  // nose
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), std(NOSE, 0.5));
  nose.position.set(0, -0.05, 0.52);
  head.add(nose);

  // smile: thin dark torus arc
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.016, 8, 16, Math.PI * 0.9), dark);
  smile.position.set(0, -0.13, 0.5);
  smile.rotation.set(0.15, 0, Math.PI * 1.05);
  head.add(smile);

  // eyes: dark spheres + white glints
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.062, 12, 10), dark);
    eye.position.set(0.17 * s, 0.08, 0.38);
    head.add(eye);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff }));
    glint.position.set(0.17 * s + 0.02, 0.11, 0.435);
    head.add(glint);
    // brow tuft above eye
    head.add(tuft(fur2, 0.17 * s, 0.2, 0.32, 0.7, 0.4, 0));
  }

  // blue ears (flattened spheres on the sides)
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), blue);
    ear.scale.set(0.45, 1.0, 0.8);
    ear.position.set(0.44 * s, 0.02, 0);
    ear.castShadow = true;
    head.add(ear);
  }

  // blue horns (curved look via two stacked cones, tilted outward)
  for (const s of [-1, 1]) {
    const horn = new THREE.Group();
    const base = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.3, 10), blueDark);
    base.position.y = 0.12;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 10), blue);
    tip.position.set(0.05 * s, 0.32, 0);
    tip.rotation.z = -0.35 * s;
    horn.add(base, tip);
    horn.position.set(0.2 * s, 0.36, 0);
    horn.rotation.z = -0.3 * s;
    horn.castShadow = true;
    head.add(horn);
  }
  // head top tuft
  head.add(tuft(fur, 0, 0.44, 0, 0.9, 0, 0));

  // ---- arms (groups so they can swing) ----
  function arm(side) {
    const a = new THREE.Group();
    a.position.set(0.58 * side, 1.28, 0);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.34, 6, 12), fur);
    upper.position.y = -0.22;
    upper.castShadow = true;
    a.add(upper);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), blue);
    hand.scale.set(1.0, 1.15, 1.0);
    hand.position.y = -0.5;
    hand.castShadow = true;
    a.add(hand);
    g.add(a);
    return a;
  }
  const armL = arm(-1);
  const armR = arm(1);

  // ---- legs (groups so they can alternate) ----
  function leg(side) {
    const l = new THREE.Group();
    l.position.set(0.26 * side, 0.42, 0);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.2, 6, 12), fur);
    thigh.position.y = -0.12;
    thigh.castShadow = true;
    l.add(thigh);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), blue);
    foot.scale.set(1.0, 0.55, 1.5);
    foot.position.set(0, -0.34, 0.08);
    foot.castShadow = true;
    l.add(foot);
    g.add(l);
    return l;
  }
  const legL = leg(-1);
  const legR = leg(1);

  // The yeti runs toward -z (away from the chase camera), so the face
  // (built on +z) must be turned around — otherwise it runs backwards.
  g.rotation.y = Math.PI;
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

  // ---- blob shadow ----
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 24),
    new THREE.MeshBasicMaterial({ color: 0x1c2f4a, transparent: true, opacity: 0.28, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  g.add(blob);

  // ---- animation state ----
  const api = {
    group: g,
    setShield(on) { shield.visible = on; },
    // t: seconds of running; opts: { airborne, sliding, laneLean, speedNorm }
    animate(t, opts) {
      const run = Math.min(1, opts.speedNorm || 0);
      const sw = Math.sin(t * 11) * 0.55 * run;
      const sw2 = Math.sin(t * 11 + Math.PI) * 0.55 * run;
      if (opts.sliding) {
        // crouch: squash body, arms back, legs forward
        g.scale.set(1.12, 0.62, 1.12);
        armL.rotation.x = 0.9; armR.rotation.x = 0.9;
        legL.rotation.x = -1.1; legR.rotation.x = -0.6;
        head.position.y = 1.62;
      } else if (opts.airborne) {
        g.scale.set(0.96, 1.06, 0.96);
        armL.rotation.x = -2.4; armR.rotation.x = -2.4; // arms up
        legL.rotation.x = 0.7; legR.rotation.x = -0.5;   // tucked
        head.position.y = 1.78;
      } else {
        g.scale.set(1, 1, 1);
        armL.rotation.x = sw; armR.rotation.x = sw2;
        legL.rotation.x = sw2 * 0.9; legR.rotation.x = sw * 0.9;
        head.position.y = 1.78 + Math.abs(Math.sin(t * 11)) * 0.04;
      }
      // lane-change lean (sign flipped: the group is rotated PI, so a
      // positive local z-rotation leans the other way on screen)
      g.rotation.z = (opts.laneLean || 0) * 0.22;
      // running bob
      g.position.y = opts.baseY + (opts.airborne ? 0 : Math.abs(Math.sin(t * 11)) * 0.07 * run);
      // shield pulse
      if (shield.visible) {
        const p = 1 + Math.sin(t * 5) * 0.03;
        shield.scale.set(p, p, p);
      }
      // blob shadow follows height (shrinks when airborne)
      const h = Math.max(0, g.position.y - (opts.baseY || 0));
      const bs = Math.max(0.55, 1 - h * 0.35);
      blob.scale.set(bs, bs, 1);
      blob.material.opacity = 0.28 * bs;
    },
  };
  return api;
}
