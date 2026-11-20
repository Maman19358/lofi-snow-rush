// World: sunset sky dome, low sun, snowy valley, pine trees, falling snow,
// and the factories for coins / obstacles / shield crystals.
// Everything is procedural three.js geometry — no external assets.
import * as THREE from 'three';

export const LANES = [-2.2, 0, 2.2];
export const TRACK_HALF = 3.4;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createWorld(scene, seed = 1) {
  const rand = mulberry32(seed);
  const disposables = [];

  // ---------- sunset sky dome (gradient shader, BackSide sphere) ----------
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x5b6fb8) },     // dusk blue-violet
      mid: { value: new THREE.Color(0xe8935c) },     // warm orange band
      low: { value: new THREE.Color(0xffc98a) },     // golden horizon
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vPos;
      uniform vec3 top; uniform vec3 mid; uniform vec3 low;
      void main() {
        float h = normalize(vPos).y;               // -1..1
        vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.65, h))
                          : mix(low, mid, smoothstep(-0.08, 0.12, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(320, 24, 16), skyMat);
  scene.add(sky);
  disposables.push(skyMat);

  // ---------- low sun disc + halo ----------
  const sunGroup = new THREE.Group();
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(14, 32),
    new THREE.MeshBasicMaterial({ color: 0xffe9b0, fog: false }),
  );
  sunGroup.add(sunDisc);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffb36b, transparent: true, opacity: 0.35, fog: false, depthWrite: false,
  });
  const halo = new THREE.Mesh(new THREE.CircleGeometry(26, 32), haloMat);
  halo.position.z = -1;
  sunGroup.add(halo);
  sunGroup.position.set(18, 26, -260);
  sunGroup.lookAt(0, 8, 0);
  scene.add(sunGroup);

  // ---------- lighting ----------
  // Brightened 20 Nov 2026 (user's phone screenshot: the ground/track read
  // nearly black while the sky stayed bright). The sunset look is kept —
  // the sky shader is untouched — but the play surface now gets much more
  // light: stronger sun + hemisphere + fill, softer shadows (shadowed
  // ground keeps ~45% of direct light instead of going fully dark — on
  // mobile GPUs large shadowed areas were reading as black), and a
  // lighter packed-track texture so the lanes stay readable on a phone.
  const sun = new THREE.DirectionalLight(0xffb36b, 2.6);
  sun.position.set(28, 42, 18);
  sun.castShadow = true;
  sun.shadow.intensity = 0.55;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
  sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near = 5; sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.002;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8fa8d8, 0xe8eef7, 1.6));
  const fill = new THREE.DirectionalLight(0x9db8ff, 1.0);
  fill.position.set(-20, 18, 30);
  scene.add(fill);

  // ---------- ground: 3D snowy mountain slope (not a flat plane) ----------
  // Procedural snow texture: soft blue-white blotches + sparkle specks,
  // used as map + bump so the snow reads as textured, not flat white.
  function snowTexture(base, blotch, sparkle, size = 256) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, size, size);
    for (let i = 0; i < 140; i++) {
      const r = 8 + rand() * 30;
      const x = rand() * size, y = rand() * size;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, blotch);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 500; i++) {
      g.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.85)' : sparkle;
      const s = rand() < 0.85 ? 1 : 2;
      g.fillRect(rand() * size, rand() * size, s, s);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
  const snowTex = snowTexture('#e9f1f8', 'rgba(190,214,240,0.35)', 'rgba(207,228,255,0.7)');
  snowTex.repeat.set(10, 36);
  const snowMat = new THREE.MeshStandardMaterial({ map: snowTex, bumpMap: snowTex, bumpScale: 0.25, roughness: 0.92 });

  // The running surface stays EXACTLY flat (|x| < 4.2) so lanes, jumps and
  // collisions never change; the terrain rises into drifts and mounds only
  // outside the track, ramping up smoothly from the track edge.
  function groundH(x, y) {
    const edge = Math.max(0, Math.abs(x) - 4.2);
    if (edge <= 0) return 0;
    const ramp = Math.min(1, edge / 7);
    return ramp * (Math.sin(x * 0.55 + y * 0.08) * 0.55
      + Math.cos(y * 0.13 + x * 0.3) * 0.45
      + Math.sin((x + y) * 0.21) * 0.35
      + Math.sin(y * 0.045) * 0.5);
  }
  const groundGeo = new THREE.PlaneGeometry(90, 320, 72, 160);
  {
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, groundH(pos.getX(i), pos.getY(i)));
    }
    groundGeo.computeVertexNormals();
  }
  const ground = new THREE.Mesh(groundGeo, snowMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -120);
  ground.receiveShadow = true;
  scene.add(ground);

  // packed track strip (lighter than before — 20 Nov 2026: the old
  // blue-grey base read as nearly black on the user's phone)
  const trackTex = snowTexture('#dbe7f6', 'rgba(178,198,226,0.35)', 'rgba(255,255,255,0.6)');
  trackTex.repeat.set(2, 40);
  const trackMat = new THREE.MeshStandardMaterial({ map: trackTex, bumpMap: trackTex, bumpScale: 0.2, roughness: 0.95 });
  const track = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_HALF * 2 + 1.2, 320), trackMat);
  track.rotation.x = -Math.PI / 2;
  track.position.set(0, 0.015, -120);
  track.receiveShadow = true;
  scene.add(track);
  for (const x of [-1.1, 1.1]) {
    const groove = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14, 320),
      new THREE.MeshStandardMaterial({ color: 0xb9cde9, roughness: 1 }),
    );
    groove.rotation.x = -Math.PI / 2;
    groove.position.set(x, 0.03, -120);
    scene.add(groove);
  }

  // groomed snow berms flanking the run — long ridged banks, bumpy along
  // their length, so the track reads as a carved groove in the mountain.
  const bermMat = new THREE.MeshStandardMaterial({ map: snowTex, bumpMap: snowTex, bumpScale: 0.3, roughness: 0.95 });
  for (const s of [-1, 1]) {
    const bermGeo = new THREE.PlaneGeometry(1.6, 320, 4, 96);
    const pos = bermGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i), v = pos.getY(i);
      const profile = Math.max(0, 1 - (u / 0.8) * (u / 0.8));
      pos.setZ(i, 0.3 * profile + 0.08 * Math.sin(v * 0.5 + s) * profile + 0.05 * Math.sin(v * 1.3) * profile);
    }
    bermGeo.computeVertexNormals();
    const berm = new THREE.Mesh(bermGeo, bermMat);
    berm.rotation.x = -Math.PI / 2;
    berm.position.set(s * 4.7, 0.02, -120);
    berm.receiveShadow = true;
    scene.add(berm);
  }

  // snow drifts (flattened mounds) + half-buried rocks along the track edges
  const driftGeo = new THREE.SphereGeometry(1, 12, 8);
  const drifts = [];
  for (let i = 0; i < 22; i++) {
    const d = new THREE.Mesh(driftGeo, snowMat);
    const side = rand() < 0.5 ? -1 : 1;
    const sx = 1 + rand() * 2.2;
    d.scale.set(sx, sx * (0.25 + rand() * 0.2), sx * (0.7 + rand() * 0.6));
    d.position.set(side * (5.5 + rand() * 14), 0.02, -260 + rand() * 290);
    d.receiveShadow = true;
    scene.add(d);
    drifts.push({ mesh: d, baseX: d.position.x });
  }
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8fa3b8, roughness: 1, flatShading: true });
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rocks = [];
  for (let i = 0; i < 9; i++) {
    const r = 0.3 + rand() * 0.55;
    const side = rand() < 0.5 ? -1 : 1;
    const gx = side * (5 + rand() * 11);
    const gz = -240 + rand() * 260;
    // one group per rock so its snow cap travels with it when scrolling
    const g = new THREE.Group();
    g.position.set(gx, 0, gz);
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.scale.set(r, r * 0.55, r * (0.8 + rand() * 0.4));
    rock.position.set(0, r * 0.2, 0);
    rock.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    rock.castShadow = true; rock.receiveShadow = true;
    g.add(rock);
    // snow cap on some rocks
    if (i % 2 === 0) {
      const cap = new THREE.Mesh(driftGeo, snowMat);
      cap.scale.set(r * 0.9, r * 0.3, r * 0.8);
      cap.position.set(0, r * 0.45, 0);
      g.add(cap);
    }
    scene.add(g);
    rocks.push({ mesh: g, baseX: gx });
  }

  // valley side slopes (angled planes rising away from the track)
  const slopeMat = new THREE.MeshStandardMaterial({ color: 0xdde8f4, roughness: 0.95, flatShading: true });
  for (const s of [-1, 1]) {
    const slope = new THREE.Mesh(new THREE.PlaneGeometry(60, 320, 1, 24), slopeMat);
    slope.rotation.x = -Math.PI / 2;
    slope.rotation.z = s * 0.5;
    slope.position.set(s * 26, 8, -120);
    // add gentle undulation via vertex displacement
    const pos = slope.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i);
      pos.setZ(i, Math.sin(px * 0.35 + py * 0.05) * 1.6 + Math.cos(py * 0.11) * 1.2);
    }
    slope.geometry.computeVertexNormals();
    slope.receiveShadow = true;
    scene.add(slope);
  }

  // ---------- distant mountains (snow-capped cones) ----------
  // Darker blue-violet so the fog (which lightens with distance) leaves
  // them visibly purple, not washed-out beige.
  const mountainMat = new THREE.MeshStandardMaterial({ color: 0x6d81b3, roughness: 1, flatShading: true });
  const capMat = new THREE.MeshStandardMaterial({ color: 0xf4f8fd, roughness: 0.95, flatShading: true });
  const mountains = [];
  const mSpots = [
    [-70, -240, 55, 90], [-28, -260, 70, 110], [30, -250, 62, 100], [75, -235, 48, 80],
    [-95, -180, 60, 85], [95, -170, 58, 82], [-60, -140, 40, 60], [62, -145, 42, 64],
  ];
  for (const [x, z, h0, r] of mSpots) {
    const h = h0 * (0.75 + rand() * 0.55); // vary heights so the ridge is not a sawtooth wall
    const m = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 0.62, h, 7), mountainMat);
    cone.position.y = h / 2 - 4;
    m.add(cone);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.62 * 0.45, h * 0.42, 7), capMat);
    cap.position.y = h - 4 - h * 0.21;
    m.add(cap);
    m.position.set(x, 0, z);
    scene.add(m);
    mountains.push(m);
  }

  // ---------- pine trees (recycled pool, placed on the slopes) ----------
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1 });
  const pineMat = new THREE.MeshStandardMaterial({ color: 0x2e5d43, roughness: 1, flatShading: true });
  const pineSnowMat = new THREE.MeshStandardMaterial({ color: 0xeaf2f8, roughness: 1, flatShading: true });

  function makeTree(scale) {
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.7, 6), trunkMat);
    trunk.position.y = 0.35;
    t.add(trunk);
    const tiers = 3;
    for (let i = 0; i < tiers; i++) {
      const r = 0.85 - i * 0.24;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 0.9, 8), pineMat);
      cone.position.y = 0.9 + i * 0.62;
      cone.castShadow = true;
      t.add(cone);
      const snow = new THREE.Mesh(new THREE.ConeGeometry(r * 0.55, 0.32, 8), pineSnowMat);
      snow.position.y = 1.28 + i * 0.62;
      t.add(snow);
    }
    t.scale.setScalar(scale);
    return t;
  }
  const trees = [];
  for (let i = 0; i < 88; i++) {
    const t = makeTree(0.7 + rand() * 1.9);
    const side = rand() < 0.5 ? -1 : 1;
    const x = side * (5.0 + rand() * 24);
    const z = -10 - rand() * 220;
    t.position.set(x, 0, z);
    t.rotation.y = rand() * Math.PI * 2;
    scene.add(t);
    trees.push({ mesh: t, baseX: x });
  }

  // ---------- falling snow (Points, recycled in a box around the camera) ----------
  const SNOW_N = 700;
  const snowGeo = new THREE.BufferGeometry();
  const snowPos = new Float32Array(SNOW_N * 3);
  const snowVel = new Float32Array(SNOW_N);
  for (let i = 0; i < SNOW_N; i++) {
    snowPos[i * 3] = (rand() - 0.5) * 60;
    snowPos[i * 3 + 1] = rand() * 22;
    snowPos[i * 3 + 2] = -130 + rand() * 140;
    snowVel[i] = 1.2 + rand() * 2.2;
  }
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 0.14, transparent: true, opacity: 0.9, sizeAttenuation: true,
  }));
  scene.add(snow);

  // ---------- obstacle / coin / crystal factories ----------
  const iceMat = new THREE.MeshStandardMaterial({ color: 0x7cc4ee, roughness: 0.25, metalness: 0.05, flatShading: true, transparent: true, opacity: 0.96 });
  const iceEdgeMat = new THREE.MeshStandardMaterial({ color: 0xd8f1ff, roughness: 0.15, flatShading: true });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xffc93c, roughness: 0.25, metalness: 0.85, emissive: 0x6b4a00, emissiveIntensity: 0.5 });
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0x7fd8ff, roughness: 0.1, metalness: 0.2, emissive: 0x2b8fd6, emissiveIntensity: 0.9, transparent: true, opacity: 0.95 });

  function makeIceBlock() {
    const m = new THREE.Group();
    const w = 1.7 + rand() * 0.5;
    const block = new THREE.Mesh(new THREE.BoxGeometry(w, 1.05, 0.9), iceMat);
    block.position.y = 0.55;
    block.castShadow = true;
    m.add(block);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, 0.16, 0.82), iceEdgeMat);
    cap.position.y = 1.12;
    m.add(cap);
    // a couple of shards on top so it reads as ice, not a plain box
    const shard = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 5), iceEdgeMat);
    shard.position.set(-w * 0.25, 1.35, 0);
    shard.rotation.z = 0.25;
    m.add(shard);
    return m;
  }

  function makeCrevasse() {
    // dark gap strip across one lane + jagged ice lips on both sides
    const m = new THREE.Group();
    const gap = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, 1.5),
      new THREE.MeshStandardMaterial({ color: 0x0d1a2e, roughness: 1 }),
    );
    gap.rotation.x = -Math.PI / 2;
    gap.position.y = 0.02;
    m.add(gap);
    for (const s of [-1, 1]) {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.28, 0.35), iceEdgeMat);
      lip.position.set(0, 0.14, s * 0.85);
      lip.castShadow = true;
      m.add(lip);
    }
    return m;
  }

  function makeBranch() {
    // low-hanging pine branch to slide under: trunk posts + drooping foliage bar
    const m = new THREE.Group();
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 1.7, 6), trunkMat);
      post.position.set(s * 1.05, 0.85, 0);
      post.castShadow = true;
      m.add(post);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.6), pineMat);
    bar.position.y = 1.55;
    bar.castShadow = true;
    m.add(bar);
    const snowBar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.14, 0.62), pineSnowMat);
    snowBar.position.y = 1.84;
    m.add(snowBar);
    // hanging icicles
    for (let i = 0; i < 3; i++) {
      const ic = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.4, 5), iceEdgeMat);
      ic.rotation.x = Math.PI;
      ic.position.set(-0.7 + i * 0.7, 1.1, 0.1);
      m.add(ic);
    }
    return m;
  }

  function makeIceRock() {
    // batu es: bongkahan es runcing — lompat untuk melewatinya
    const m = new THREE.Group();
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.65, 0), iceMat);
    rock.scale.set(1, 1.1, 0.8);
    rock.position.y = 0.65;
    rock.rotation.set(0.2, rand() * 3, 0.15);
    rock.castShadow = true;
    m.add(rock);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.45, 6), iceEdgeMat);
    cap.position.set(0.1, 1.35, 0);
    m.add(cap);
    const shard = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.45, 5), iceEdgeMat);
    shard.position.set(-0.45, 1.15, 0.2);
    shard.rotation.z = -0.3;
    m.add(shard);
    return m;
  }

  function makeSnowman() {
    // manusia salju (topi + wortel + tangan ranting) — lompat untuk melewatinya
    const m = new THREE.Group();
    const snowMat2 = new THREE.MeshStandardMaterial({ color: 0xf6fafd, roughness: 0.9, flatShading: true });
    const coal = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.4 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), snowMat2);
    body.position.y = 0.55;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 10), snowMat2);
    head.position.y = 1.35;
    head.castShadow = true;
    m.add(body, head);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.45, 8),
      new THREE.MeshStandardMaterial({ color: 0xe86a1c, roughness: 0.6 }));
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 1.32, 0.45);
    m.add(nose);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), coal);
      eye.position.set(0.15 * s, 1.45, 0.34);
      m.add(eye);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.7, 5), trunkMat);
      arm.position.set(0.62 * s, 0.75, 0);
      arm.rotation.z = s * 0.9;
      m.add(arm);
    }
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.3, 10), coal);
    hat.position.y = 1.78;
    m.add(hat);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.05, 12), coal);
    brim.position.y = 1.64;
    m.add(brim);
    return m;
  }

  function makeIceSpikes() {
    // paku es: deretan duri es rendah — harus dilompati
    const m = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.18, 0.9), iceMat);
    base.position.y = 0.09;
    m.add(base);
    for (let i = 0; i < 4; i++) {
      const h = 0.45 + rand() * 0.25;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.16, h, 5), iceEdgeMat);
      spike.position.set(-0.75 + i * 0.5, 0.18 + h / 2, (i % 2 === 0 ? -0.15 : 0.15));
      spike.castShadow = true;
      m.add(spike);
    }
    return m;
  }

  // "S" face for SUI coins — drawn once on a canvas (generated at runtime,
  // no external asset) and used as the cap texture of the coin core.
  const sTexture = (() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#e9a91f';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#7a4d00';
    g.font = 'bold 88px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('S', 64, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const sFaceMat = new THREE.MeshStandardMaterial({ map: sTexture, roughness: 0.35, metalness: 0.5 });

  function makeCoin() {
    const m = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.08, 10, 20), goldMat);
    m.add(ring);
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.23, 0.23, 0.08, 20),
      [goldMat, sFaceMat, sFaceMat],
    );
    core.rotation.x = Math.PI / 2;
    m.add(core);
    return m;
  }

  function makeCrystal() {
    const m = new THREE.Group();
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), crystalMat);
    c.position.y = 1.0;
    c.castShadow = true;
    m.add(c);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    glow.position.y = 1.0;
    m.add(glow);
    return m;
  }

  return {
    rand,
    update(dt, speed, camZ) {
      // snowfall drifts down and slightly sideways, recycling above the camera
      const p = snowGeo.attributes.position;
      for (let i = 0; i < SNOW_N; i++) {
        let y = p.getY(i) - snowVel[i] * dt;
        let x = p.getX(i) + Math.sin(i * 1.7 + performance.now() * 0.0004) * dt * 0.35;
        let z = p.getZ(i);
        if (y < 0) { y = 20 + rand() * 2; x = (rand() - 0.5) * 60; z = camZ - 130 + rand() * 140; }
        if (z > camZ + 12) z -= 140;
        p.setXYZ(i, x, y, z);
      }
      p.needsUpdate = true;
      // Side scenery scrolls toward the camera at exactly the track speed
      // and recycles ahead. Previously trees/drifts/rocks were never moved
      // at all, so the recycle checks below could never fire (dead code) and
      // the trees looked frozen while coins/obstacles streamed past.
      const dz = speed * dt;
      for (const t of trees) {
        t.mesh.position.z += dz;
        if (t.mesh.position.z > camZ + 14) {
          t.mesh.position.z -= 230;
          t.mesh.position.x = t.baseX * (0.9 + rand() * 0.25);
        }
      }
      for (const d of drifts) {
        d.mesh.position.z += dz;
        if (d.mesh.position.z > camZ + 14) {
          d.mesh.position.z -= 290;
          d.mesh.position.x = d.baseX * (0.9 + rand() * 0.25);
        }
      }
      for (const r of rocks) {
        r.mesh.position.z += dz;
        if (r.mesh.position.z > camZ + 14) {
          r.mesh.position.z -= 260;
          r.mesh.position.x = r.baseX * (0.9 + rand() * 0.25);
        }
      }
      // sun halo pulse (subtle)
      haloMat.opacity = 0.32 + Math.sin(performance.now() * 0.0006) * 0.05;
    },
    makeIceBlock, makeCrevasse, makeBranch, makeIceRock, makeSnowman, makeIceSpikes, makeCoin, makeCrystal,
  };
}
