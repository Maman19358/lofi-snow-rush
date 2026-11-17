// Sui integration — hooks for the CLAY Hackathon III entry.
// The game is FULLY playable without a wallet. The Move leaderboard contract
// is a LATER step (not deployed yet), so submitScoreToChain() is an honest
// stub: it records the score locally and reports exactly what it did.
//
// Wallet connect: the Sui dApp Kit is loaded lazily from a CDN ONLY when the
// user taps "Connect Sui Wallet" (dynamic import, try/catch). If the CDN or
// the wallet is unavailable, the button reports that plainly and the game
// keeps working. No wallet code runs at page load.
export const SUI = {
  LEADERBOARD_PACKAGE_ID: null, // set this once the Move leaderboard is deployed
  connected: false,
  address: null,
  _kit: null,
  _tried: false,

  async connect() {
    if (this.connected) return { ok: true, address: this.address };
    // 1) A Sui wallet extension (Slush / Sui Wallet) injects window.sui — try it first.
    try {
      const injected = window.sui;
      if (injected && typeof injected.connect === 'function') {
        const res = await injected.connect();
        const addr = res?.address || injected.address || null;
        if (addr) {
          this.connected = true;
          this.address = addr;
          return { ok: true, address: addr, via: 'injected' };
        }
      }
    } catch (e) { console.warn('[sui] injected wallet failed', e); }
    // 2) Fall back to the dApp Kit (CDN, loaded on demand only).
    try {
      const kit = await import('https://esm.sh/@mysten/dapp-kit@0.20.0');
      this._kit = kit;
      return { ok: false, reason: 'dapp-kit-loaded-no-ui', detail: 'DApp Kit loaded, but this build has no wallet modal wired yet. Install a Sui wallet extension (Slush) and tap Connect again.' };
    } catch (e) {
      console.warn('[sui] dapp-kit CDN failed', e);
      return { ok: false, reason: 'no-wallet', detail: 'No Sui wallet found. Install the Slush wallet extension, or play without connecting — scores are saved on this device.' };
    }
  },

  disconnect() {
    this.connected = false;
    this.address = null;
  },

  // Called from the game-over screen. Today: no contract is deployed, so the
  // score is stored locally and the caller is told so. Once
  // LEADERBOARD_PACKAGE_ID is set and a wallet is connected, this is where
  // the moveCall (leaderboard::submit_score) goes.
  submitScoreToChain(score) {
    const entry = { score, at: new Date().toISOString(), chain: false };
    try {
      const list = JSON.parse(localStorage.getItem('lofi-snow-rush-local-scores') || '[]');
      list.push(entry);
      list.sort((a, b) => b.score - a.score);
      localStorage.setItem('lofi-snow-rush-local-scores', JSON.stringify(list.slice(0, 10)));
    } catch { /* storage unavailable */ }
    if (!this.LEADERBOARD_PACKAGE_ID) {
      return {
        ok: false, onChain: false,
        message: 'Leaderboard contract not deployed yet — score saved on this device (local top 10).',
      };
    }
    if (!this.connected) {
      return {
        ok: false, onChain: false,
        message: 'Connect a Sui wallet first to submit your score on-chain.',
      };
    }
    // Placeholder for the real moveCall — reached only after the contract exists.
    return { ok: false, onChain: false, message: 'On-chain submit not wired yet (contract ID set, tx builder pending).' };
  },

  localTopScores() {
    try {
      return JSON.parse(localStorage.getItem('lofi-snow-rush-local-scores') || '[]');
    } catch { return []; }
  },
};
