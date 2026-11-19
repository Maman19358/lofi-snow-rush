// LOFI SNOW RUSH — 3D endless runner (three.js, no build step).
// States: title -> playing <-> paused -> over. Deterministic seeded spawns
// (?seed=) and ?shot= staging for screenshots (see bottom of file).
import * as THREE from 'three';
import { createYeti } from './yeti.js';
import { createWorld, LANES } from './world.js';
import { audio } from './audio.js';
import { SUI } from './sui.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');           // 'start' | 'play' | 'playb' | 'playc' | 'jumpa' | 'jumpb' | 'jumpc' | 'over' | null
const seed = Number.parseInt(params.get('seed') ?? '17', 10) || 17;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(seed);

// ---------- renderer / scene / camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Fog far enough that the mountains keep their blue-violet color instead of
// washing out to beige (they sit at z -140..-260).
scene.fog = new THREE.Fog(0xdf9f7d, 40, 260);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 4.6, 7.6);

const world = createWorld(scene, seed);
const yeti = createYeti();
scene.add(yeti.group);

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const hud = $('hud'), scoreEl = $('score-value'), coinEl = $('coin-value'),
  speedEl = $('speed-value'), livesEl = $('lives'), comboEl = $('combo'),
  shieldEl = $('shield-badge');

// ---------- game state ----------
const GRAV = -30;
const JUMP_V = 10.4;
const BASE_SPEED = 16, MAX_SPEED = 42, SPEED_RAMP = 0.6;
const SPAWN_Z = -130;

const state = {
  screen: 'title',           // title | playing | paused | over
  time: 0,                   // run clock (s)
  speed: BASE_SPEED,
  dist: 0,
  coins: 0,
  coinScore: 0,
  combo: 1,
  comboTimer: 0,
  bestCombo: 1,
  lives: 3,
  shield: false,
  lane: 1,                   // 0..2
  x: 0,                      // smoothed lateral position
  y: 0, vy: 0,               // jump height / velocity
  sliding: 0,                // slide timer
  invuln: 0,                 // post-hit grace timer
  shake: 0,
  best: 0,
  runId: 0,
};
try { state.best = Number(localStorage.getItem('lofi-snow-rush-best') || 0) || 0; } catch { /* ignore */ }

const entities = [];         // { mesh, kind, lane, z, y, hit, passed }
let nextSpawnDist = 30;
let shotReady = false;
let jumpStaged = false;     // scripted jump fired once (for ?shot=jump* captures)

function score() { return Math.floor(state.dist) + state.coinScore; }

// ---------- spawning ----------
function spawnRow() {
  const r = rand();
  const freeLane = () => Math.floor(rand() * 3);
  // pick 1-2 blocked lanes, always leaving a free lane
  const blocked = new Set();
  const nBlock = rand() < 0.55 ? 1 : 2;
  while (blocked.size < nBlock) blocked.add(Math.floor(rand() * 3));
  // '?shot=over' staging: force the center lane blocked so the no-input
  // yeti is guaranteed to hit obstacles and reach the game-over screen —
  // but never block all 3 lanes (one must stay passable).
  if (shot === 'over') {
    blocked.add(1);
    if (blocked.size === 3) blocked.delete(blocked.has(0) ? 0 : 2);
  }

  if (r < 0.26) {
    // coin line in one lane
    const lane = freeLane();
    const n = 5 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) addEntity('coin', lane, SPAWN_Z - i * 2.3, 1.0);
  } else if (r < 0.44) {
    // ice block(s) + coin arc over one of them
    for (const lane of blocked) addEntity('ice', lane, SPAWN_Z, 0);
    const arcLane = [...blocked][Math.floor(rand() * blocked.size)];
    const arcY = [0.9, 1.5, 1.95, 1.5, 0.9];
    arcY.forEach((y, i) => addEntity('coin', arcLane, SPAWN_Z - 4.4 + i * 2.2, y));
    // a few ground coins in a free lane
    const fl = [0, 1, 2].find((l) => !blocked.has(l));
    for (let i = 0; i < 3; i++) addEntity('coin', fl, SPAWN_Z - 8 - i * 2.3, 1.0);
  } else if (r < 0.56) {
    // crevasse + coins beside it
    for (const lane of blocked) addEntity('gap', lane, SPAWN_Z, 0);
    const fl = [0, 1, 2].find((l) => !blocked.has(l));
    for (let i = 0; i < 4; i++) addEntity('coin', fl, SPAWN_Z - i * 2.3, 1.0);
  } else if (r < 0.68) {
    // low branch to slide under + low coins
    for (const lane of blocked) addEntity('branch', lane, SPAWN_Z, 0);
    const fl = [0, 1, 2].find((l) => !blocked.has(l));
    for (let i = 0; i < 4; i++) addEntity('coin', fl, SPAWN_Z - i * 2.3, 0.7);
  } else if (r < 0.76) {
    // ice rock (jump over) + coins beside it
    for (const lane of blocked) addEntity('rock', lane, SPAWN_Z, 0);
    const fl = [0, 1, 2].find((l) => !blocked.has(l));
    for (let i = 0; i < 4; i++) addEntity('coin', fl, SPAWN_Z - i * 2.3, 1.0);
  } else if (r < 0.84) {
    // snowman (jump over) + coins beside it
    for (const lane of blocked) addEntity('snowman', lane, SPAWN_Z, 0);
    const fl = [0, 1, 2].find((l) => !blocked.has(l));
    for (let i = 0; i < 4; i++) addEntity('coin', fl, SPAWN_Z - i * 2.3, 1.0);
  } else if (r < 0.90) {
    // ice spikes (must jump) + coins beside them
    for (const lane of blocked) addEntity('spikes', lane, SPAWN_Z, 0);
    const fl = [0, 1, 2].find((l) => !blocked.has(l));
    for (let i = 0; i < 4; i++) addEntity('coin', fl, SPAWN_Z - i * 2.3, 1.0);
  } else if (r < 0.96) {
    // shield crystal with a coin trail leading to it
    const lane = freeLane();
    for (let i = 0; i < 3; i++) addEntity('coin', lane, SPAWN_Z - 6 - i * 2.3, 1.0);
    addEntity('crystal', lane, SPAWN_Z, 0);
  } else {
    // mixed: ice in one lane, branch in another
    const lanes = [...blocked];
    addEntity('ice', lanes[0], SPAWN_Z, 0);
    if (lanes[1] !== undefined) addEntity('branch', lanes[1], SPAWN_Z - 1.5, 0);
    const fl = [0, 1, 2].find((l) => !blocked.has(l));
    for (let i = 0; i < 3; i++) addEntity('coin', fl, SPAWN_Z - 6 - i * 2.3, 1.0);
  }
  // Row gap grows with speed so the reaction time between rows stays fair
  // even at the 42 m/s top speed (15 m at 42 m/s would be 0.36 s).
  nextSpawnDist = state.dist + 17 + state.speed * 0.28 + rand() * 9;
}

function addEntity(kind, lane, z, y) {
  let mesh;
  if (kind === 'coin') mesh = world.makeCoin();
  else if (kind === 'ice') mesh = world.makeIceBlock();
  else if (kind === 'gap') mesh = world.makeCrevasse();
  else if (kind === 'branch') mesh = world.makeBranch();
  else if (kind === 'rock') mesh = world.makeIceRock();
  else if (kind === 'snowman') mesh = world.makeSnowman();
  else if (kind === 'spikes') mesh = world.makeIceSpikes();
  else mesh = world.makeCrystal();
  mesh.position.set(LANES[lane], 0, z);
  scene.add(mesh);
  entities.push({ mesh, kind, lane, z, y, hit: false });
}

// ---------- player actions ----------
function moveLane(dir) {
  if (state.screen !== 'playing') return;
  const next = Math.max(0, Math.min(2, state.lane + dir));
  if (next !== state.lane) { state.lane = next; audio.unlock(); }
}
function jump() {
  if (state.screen !== 'playing' || state.y > 0.02) return;
  state.vy = JUMP_V;
  state.sliding = 0;
  audio.jump();
}
function slide() {
  if (state.screen !== 'playing' || state.y > 0.02) return;
  if (state.sliding <= 0) { state.sliding = 0.6; audio.slide(); }
}

// ---------- collisions / hits ----------
function onHit(ent) {
  ent.hit = true;
  if (state.invuln > 0) return;
  if (state.shield) {
    state.shield = false;
    yeti.setShield(false);
    state.invuln = 1.4;
    state.speed = Math.max(12, state.speed * 0.8);
    audio.shieldBreak();
    flashShield();
    return;
  }
  state.lives -= 1;
  state.invuln = 1.7;
  state.speed = Math.max(12, state.speed * 0.55);
  state.combo = 1;
  state.shake = 0.6;
  audio.hit();
  updateLives();
  if (state.lives <= 0) gameOver();
}

function onCoin(ent) {
  ent.hit = true;
  ent.gone = true;
  scene.remove(ent.mesh); // vanish at once — a collected coin must not drift
  state.coins += 1;       // past the camera at 1.6x scale
  if (state.comboTimer > 0) state.combo = Math.min(8, state.combo + 1);
  else state.combo = Math.max(1, state.combo);
  state.comboTimer = 2.5;
  state.bestCombo = Math.max(state.bestCombo, state.combo);
  state.coinScore += 10 * state.combo;
  audio.coin(state.combo);
  updateHud();
}

function onCrystal(ent) {
  ent.hit = true;
  ent.gone = true;
  scene.remove(ent.mesh);
  state.shield = true;
  yeti.setShield(true);
  audio.shield();
  updateHud();
}

function checkCollisions() {
  const px = LANES[state.lane];
  const centerY = 0.95 + state.y;
  for (const e of entities) {
    // Stop the pass once the run is over: without this, a coin later in the
    // same frame as the lethal hit still counts, leaving the game-over panel
    // one coin (20 pts) behind the HUD score.
    if (state.screen !== 'playing') break;
    if (e.hit || Math.abs(e.z) > 1.0) continue;
    if (Math.abs(LANES[e.lane] - px) > 1.0) continue;
    if (e.kind === 'coin') {
      if (Math.abs(centerY - e.y) < 1.15) onCoin(e);
    } else if (e.kind === 'crystal') {
      if (Math.abs(centerY - 1.0) < 1.3) onCrystal(e);
    } else if (e.kind === 'ice' || e.kind === 'rock' || e.kind === 'snowman') {
      if (state.y < 0.9) onHit(e);
    } else if (e.kind === 'gap' || e.kind === 'spikes') {
      if (state.y < 0.45) onHit(e);
    } else if (e.kind === 'branch') {
      if (state.sliding <= 0) onHit(e);
    }
  }
}

// ---------- HUD / overlays ----------
function updateHud() {
  scoreEl.textContent = String(score());
  coinEl.textContent = `◉ ${state.coins}`;
  speedEl.textContent = `${state.speed.toFixed(0)} m/s`;
  if (state.combo > 1 && state.comboTimer > 0) {
    comboEl.textContent = `KOMBO ×${state.combo}`;
    comboEl.classList.add('on');
  } else comboEl.classList.remove('on');
  shieldEl.hidden = !state.shield;
}
function updateLives() {
  livesEl.innerHTML = [0, 1, 2].map((i) =>
    `<span class="${i < state.lives ? '' : 'lost'}">❤️</span>`).join('');
}
function flashShield() {
  shieldEl.textContent = '🛡️ Perisai menahan serangan!';
  setTimeout(() => { shieldEl.textContent = '🛡️ Perisai aktif'; }, 700);
}
function show(id, on) { $(id).hidden = !on; }

function setScreen(s) {
  state.screen = s;
  hud.hidden = !(s === 'playing' || s === 'paused');
  show('start-overlay', s === 'title');
  show('pause-overlay', s === 'paused');
  show('over-overlay', s === 'over');
  if (s === 'title') $('best-start').textContent = String(state.best);
}

function startRun() {
  // clear entities
  for (const e of entities) scene.remove(e.mesh);
  entities.length = 0;
  Object.assign(state, {
    time: 0, speed: BASE_SPEED, dist: 0, coins: 0, coinScore: 0,
    combo: 1, comboTimer: 0, bestCombo: 1, lives: 3, shield: false,
    lane: 1, x: 0, y: 0, vy: 0, sliding: 0, invuln: 0, shake: 0, runId: state.runId + 1,
  });
  yeti.setShield(false);
  nextSpawnDist = 26;
  updateLives();
  updateHud();
  setScreen('playing');
  audio.start();
}

function gameOver() {
  const final = score();
  const isBest = final > state.best;
  if (isBest) {
    state.best = final;
    try { localStorage.setItem('lofi-snow-rush-best', String(final)); } catch { /* ignore */ }
  }
  $('final-score').textContent = String(final);
  $('final-coins').textContent = String(state.coins);
  $('final-dist').textContent = `${Math.floor(state.dist)} m`;
  $('final-combo').textContent = `×${state.bestCombo}`;
  $('new-best').hidden = !isBest;
  $('submit-note').textContent = '';
  $('submit-note').className = '';
  setScreen('over');
  audio.gameOver();
}

function togglePause() {
  if (state.screen === 'playing') { setScreen('paused'); audio.click(); }
  else if (state.screen === 'paused') { setScreen('playing'); audio.click(); }
}

// ---------- input: keyboard ----------
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key;
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') { moveLane(-1); e.preventDefault(); }
  else if (k === 'ArrowRight' || k === 'd' || k === 'D') { moveLane(1); e.preventDefault(); }
  else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') { jump(); e.preventDefault(); }
  else if (k === 'ArrowDown' || k === 's' || k === 'S') { slide(); e.preventDefault(); }
  else if (k === 'p' || k === 'P' || k === 'Escape') togglePause();
  else if (k === 'm' || k === 'M') toggleMute();
  else if (k === 'Enter') {
    if (state.screen === 'title' || state.screen === 'over') startRun();
    else if (state.screen === 'paused') setScreen('playing');
  }
});

// ---------- input: touch swipe ----------
let touchStart = null;
renderer.domElement.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  touchStart = { x: t.clientX, y: t.clientY, time: performance.now() };
  audio.unlock();
}, { passive: true });
renderer.domElement.addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (Math.max(adx, ady) < 24) { touchStart = null; return; } // tap, not swipe
  if (adx > ady) moveLane(dx > 0 ? 1 : -1);
  else if (dy < 0) jump();
  else slide();
  touchStart = null;
}, { passive: true });

// ---------- buttons ----------
$('play-btn').addEventListener('click', () => { audio.unlock(); startRun(); });
$('again-btn').addEventListener('click', () => { audio.unlock(); startRun(); });
$('resume-btn').addEventListener('click', () => setScreen('playing'));
$('restart-btn').addEventListener('click', startRun);
$('quit-btn').addEventListener('click', () => setScreen('title'));
$('menu-btn').addEventListener('click', () => setScreen('title'));
$('pause-btn').addEventListener('click', togglePause);
function toggleMute() {
  audio.setMuted(!audio.isMuted());
  $('mute-btn').textContent = audio.isMuted() ? '🔇' : '🔊';
}
$('mute-btn').addEventListener('click', toggleMute);

// sui.js stays in English (do not edit it) — its known user-facing messages
// are translated to Indonesian here at the display site, so no English text
// ever reaches the player. Unknown messages pass through unchanged.
const SUI_ID = [
  [/^DApp Kit loaded, but this build has no wallet modal wired yet\. Install a Sui wallet extension \(Slush\) and tap Connect again\.$/, 'DApp Kit termuat, tapi build ini belum punya jendela dompet. Pasang ekstensi dompet Sui (Slush) lalu ketuk Hubungkan lagi.'],
  [/^No Sui wallet found\. Install the Slush wallet extension, or play without connecting — scores are saved on this device\.$/, 'Dompet Sui tidak ditemukan. Pasang ekstensi dompet Slush, atau main tanpa menghubungkan — skor tersimpan di perangkat ini.'],
  [/^Connect a Sui wallet first to submit your score on-chain\. \(Score saved on this device\.\)$/, 'Hubungkan dompet Sui dulu untuk mengirim skor on-chain. (Skor tersimpan di perangkat ini.)'],
  [/^Wallet does not support signing this transaction\. \(Score saved on this device\.\)$/, 'Dompet tidak mendukung penandatanganan transaksi ini. (Skor tersimpan di perangkat ini.)'],
  [/^Score (\d+) submitted on-chain! Tx: (.+) \(Also saved on this device\.\)$/, (_, s, tx) => `Skor ${s} terkirim on-chain! Tx: ${tx} (Juga tersimpan di perangkat ini.)`],
  [/^Score (\d+) submitted on-chain! \(Also saved on this device\.\)$/, (_, s) => `Skor ${s} terkirim on-chain! (Juga tersimpan di perangkat ini.)`],
  [/^On-chain submit failed \((.*)\)\. Score saved on this device\.$/, (_, e) => `Pengiriman on-chain gagal (${e}). Skor tersimpan di perangkat ini.`],
  [/^Leaderboard contract not deployed yet — score saved on this device \(local top 10\)\.$/, 'Kontrak papan peringkat belum di-deploy — skor tersimpan di perangkat ini (10 besar lokal).'],
];
function idText(s) {
  if (!s) return s;
  for (const [re, out] of SUI_ID) {
    const m = s.match(re);
    if (m) return typeof out === 'function' ? out(...m) : out;
  }
  return s;
}

$('wallet-btn').addEventListener('click', async () => {
  const btn = $('wallet-btn');
  const status = $('wallet-status');
  btn.disabled = true;
  status.textContent = 'Menghubungkan…';
  status.className = '';
  const res = await SUI.connect();
  btn.disabled = false;
  if (res.ok) {
    btn.textContent = `Terhubung: ${res.address.slice(0, 6)}…${res.address.slice(-4)}`;
    status.textContent = 'Dompet terhubung. Skor kini bisa dikirim on-chain ke papan peringkat Sui.';
    status.className = 'ok';
  } else {
    status.textContent = idText(res.detail) || 'Dompet tidak tersedia.';
    status.className = 'err';
  }
});

$('submit-btn').addEventListener('click', async () => {
  const note = $('submit-note');
  note.textContent = 'Mengirim…';
  note.className = '';
  const res = await SUI.submitScoreToChain(score());
  note.textContent = idText(res.message);
  note.className = res.onChain ? 'ok' : '';
});

// auto-pause when the tab is hidden (mobile friendly)
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.screen === 'playing') setScreen('paused');
});

// ---------- autopilot (used by ?shot=play screenshots) ----------
function autopilot() {
  // nearest obstacle in current lane
  let threat = null, threatD = Infinity;
  let coinLane = -1, coinD = Infinity;
  for (const e of entities) {
    if (e.hit || e.z > 2 || e.z < -30) continue;
    const d = -e.z;
    if ((e.kind === 'ice' || e.kind === 'gap' || e.kind === 'branch' || e.kind === 'rock' || e.kind === 'snowman' || e.kind === 'spikes') && e.lane === state.lane && d < threatD) {
      threat = e; threatD = d;
    }
    if (e.kind === 'coin' && d < coinD) { coinLane = e.lane; coinD = d; }
  }
  if (coinLane >= 0 && coinLane !== state.lane && (!threat || threatD > 9)) {
    moveLane(coinLane > state.lane ? 1 : -1);
  }
  if (threat && threatD < 8.5) {
    if (threat.kind === 'branch') slide();
    else if (state.y <= 0.02) jump();
  }
}

// ---------- main loop ----------
let last = performance.now();
let runClock = 0;

function update(dt) {
  state.time += dt;
  runClock += dt;
  const playing = state.screen === 'playing';

  if (playing) {
    // speed ramp + distance
    state.speed = Math.min(MAX_SPEED, state.speed + SPEED_RAMP * dt);
    state.dist += state.speed * dt;
    if (state.dist >= nextSpawnDist) spawnRow();

    // combo decay
    if (state.comboTimer > 0) {
      state.comboTimer -= dt;
      if (state.comboTimer <= 0) state.combo = 1;
    }
    if (state.invuln > 0) state.invuln -= dt;
    if (state.sliding > 0) state.sliding -= dt;

    // jump physics
    if (state.y > 0 || state.vy !== 0) {
      state.vy += GRAV * dt;
      state.y += state.vy * dt;
      if (state.y <= 0) { state.y = 0; state.vy = 0; }
    }

    // lane smoothing (snappy: 18/s so a lane change reads instantly)
    const targetX = LANES[state.lane];
    state.x += (targetX - state.x) * Math.min(1, dt * 18);
    const laneLean = (targetX - state.x) * 0.3;

    // entities advance
    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      if (e.gone) { entities.splice(i, 1); continue; }
      e.z += state.speed * dt;
      e.mesh.position.z = e.z;
      if (e.kind === 'coin') {
        e.mesh.rotation.y += dt * 3;
        e.mesh.position.y = e.y + Math.sin(runClock * 2 + e.z) * 0.08;
        // shrink as the coin passes the yeti so it never looms over the camera
        const near = e.z > -1 ? Math.max(0.4, 1 - (e.z + 1) * 0.18) : 1;
        e.mesh.scale.setScalar(near);
      } else if (e.kind === 'crystal') {
        e.mesh.rotation.y += dt * 1.5;
        e.mesh.position.y = Math.sin(runClock * 1.5) * 0.12;
      }
      if (e.z > 6) {
        scene.remove(e.mesh);
        entities.splice(i, 1);
      }
    }
    checkCollisions();
    if (shot === 'play' || shot === 'playb' || shot === 'playc') autopilot();
    updateHud();

    // yeti pose
    yeti.group.position.set(state.x, state.y, 0);
    yeti.animate(runClock, {
      airborne: state.y > 0.05,
      sliding: state.sliding > 0,
      laneLean,
      speedNorm: (state.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED),
      baseY: state.y,
      running: true,
    });
    // invulnerability flashing
    yeti.group.visible = !(state.invuln > 0 && Math.floor(runClock * 12) % 2 === 0);
  } else {
    // idle scene behind overlays: slow camera drift + gentle yeti breathing
    yeti.group.position.set(0, 0, 0);
    yeti.animate(runClock, { airborne: false, sliding: false, laneLean: 0, speedNorm: 0, baseY: 0, running: false });
    yeti.group.visible = true;
  }

  // camera follow + shake
  if (state.shake > 0) state.shake -= dt;
  const sh = state.shake > 0 ? state.shake * 0.35 : 0;
  const camX = state.x * 0.55 + (Math.random() - 0.5) * sh;
  const camY = 4.6 + state.y * 0.25 + (Math.random() - 0.5) * sh;
  camera.position.set(camX, camY, 7.6);
  camera.lookAt(state.x * 0.7, 1.2, -8);
  // ?shot=front: camera in front of the yeti (title idle) to check proportions
  if (shot === 'front') {
    camera.position.set(0, 2.0, -7.5);
    camera.lookAt(0, 1.3, 0);
  }
}

function render(dt) {
  // Scenery scrolls only while actually playing: on the title screen the
  // yeti idles against a static backdrop, and on game-over the run is over.
  // (Paused passes dt=0, so nothing moves there either.)
  world.update(dt, state.screen === 'playing' ? state.speed : 0, 0);
  renderer.render(scene, camera);
}

function checkShotReady() {
  if (!shot || shotReady) return;
  if (!yeti.ready) return; // wait for the GLB yeti to load before staging
  if (shot === 'start' && state.time > 1.2) {
    shotReady = true; window.__shotReady = true;
  } else if (shot === 'front' && state.time > 1.2) {
    // title idle seen from the front — proportions check
    shotReady = true; window.__shotReady = true;
  } else if (shot === 'play' && state.screen === 'playing' && state.dist >= 130 && state.coins >= 5) {
    shotReady = true; window.__shotReady = true;
  } else if (shot === 'playb' && state.screen === 'playing' && state.dist >= 175 && state.coins >= 5) {
    // same run as 'play' but ~2 s later, so the run-cycle pose differs
    shotReady = true; window.__shotReady = true;
  } else if (shot === 'playc' && state.screen === 'playing' && state.dist >= 220 && state.coins >= 5) {
    // same run as 'play'/'playb' but ~2.5 s after 'playb' — the trees
    // proof shot: side scenery must be visibly further along than in 'play'
    shotReady = true; window.__shotReady = true;
  } else if (shot === 'over' && state.screen === 'over' && state.time > 0.8) {
    shotReady = true; window.__shotReady = true;
  } else if ((shot === 'jumpa' || shot === 'jumpb' || shot === 'jumpc') && state.screen === 'playing') {
    // scripted jump, fired once at dist 30 — before any entity spawned
    // at z=-130 can reach the player (~9 s away), so the staging jump
    // is never interrupted by a hit.
    if (!jumpStaged && state.dist >= 30) { jump(); jumpStaged = true; }
    if (jumpStaged) {
      if (shot === 'jumpa' && state.y > 0.05 && state.vy > 0 && state.y < 0.7) {
        // takeoff: just left the ground, still rising
        shotReady = true; window.__shotReady = true;
      } else if (shot === 'jumpb' && state.y > 1.5) {
        // mid-air: near the apex (max ~1.77 m)
        shotReady = true; window.__shotReady = true;
      } else if (shot === 'jumpc' && state.y < 0.6 && state.vy < 0) {
        // landing: descending, about to touch down
        shotReady = true; window.__shotReady = true;
      }
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  // Freeze the staged frame once ready: without this, the game keeps
  // playing in real time while the screenshot tool waits, and a jump
  // staged at takeoff would be mid-air or landed by capture time.
  if (shot && shotReady) { render(0); return; }
  if (state.screen === 'paused') { render(0); return; }
  if (shot && !shotReady) {
    // Don't burn the fast-forward while the GLB yeti is still loading —
    // otherwise the run overshoots the staging point by ~1500 m.
    if (!yeti.ready) { render(dt); return; }
    // Headless fast-forward: SwiftShader renders at a few fps and dt is
    // clamped, so real-time play would starve the game clock. Run fixed
    // 1/60s logic steps without rendering until the shot is staged.
    const FIXED = 1 / 60;
    for (let i = 0; i < 360 && !shotReady; i++) {
      update(FIXED);
      // keep the side scenery in sync with distance while staging — the
      // render() call below only advances it by one real frame, so without
      // this the trees would lag ~90 m behind the entities in screenshots.
      world.update(FIXED, state.speed, 0);
      checkShotReady();
    }
    render(dt);
    return;
  }
  update(dt);
  render(dt);
  checkShotReady();
}

// shot-mode auto start (no click needed in headless captures)
if (shot === 'play' || shot === 'playb' || shot === 'playc' || shot === 'over'
  || shot === 'jumpa' || shot === 'jumpb' || shot === 'jumpc') {
  setScreen('title');
  startRun();
  // 'over' shot: no input is given, so the yeti runs into obstacles until
  // all 3 lives are gone and the game-over screen appears.
} else {
  setScreen('title');
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// debug / test handle
window.__game = {
  get screen() { return state.screen; },
  get score() { return score(); },
  get dist() { return state.dist; },
  get coins() { return state.coins; },
  get lives() { return state.lives; },
  get y() { return state.y; },
  get vy() { return state.vy; },
  get entities() { return entities.map((e) => ({ kind: e.kind, lane: e.lane, z: +e.z.toFixed(1) })); },
  spawnRow, // debug: drive the spawn table directly (distribution checks)
  start: startRun,
};

requestAnimationFrame(frame);
