// Sui integration — hooks for the CLAY Hackathon III entry.
// The game is FULLY playable without a wallet. The Move leaderboard contract
// is DEPLOYED on Sui testnet (19 Nov 2026):
//   Package ID:  0x743c045df0051a564be60b35b37d2a2936acc0a5d8e1843c144a3ac98deda280
//   Leaderboard: 0x6052e73abaa237e3ee7ec50961755a49bd3b95dfe23d723974cd6cb542fa95cb (shared)
//   Publish tx:  5Zhn9kgQWErv6h2HcT1H7DdZq5hERhHWroRhwP4ug8Vd
// submitScoreToChain() sends a real moveCall (leaderboard::submit_score)
// when a wallet is connected, and always keeps the local top-10 fallback.
//
// Wallet connect: the Sui dApp Kit is loaded lazily from a CDN ONLY when the
// user taps "Connect Sui Wallet" (dynamic import, try/catch). If the CDN or
// the wallet is unavailable, the button reports that plainly and the game
// keeps working. No wallet code runs at page load.
export const SUI = {
  LEADERBOARD_PACKAGE_ID: '0x743c045df0051a564be60b35b37d2a2936acc0a5d8e1843c144a3ac98deda280',
  LEADERBOARD_OBJECT_ID: '0x6052e73abaa237e3ee7ec50961755a49bd3b95dfe23d723974cd6cb542fa95cb',
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

  // Called from the game-over screen. The score is ALWAYS saved locally
  // first (local top 10), then — if the leaderboard is deployed and a wallet
  // is connected — submitted on-chain via leaderboard::submit_score.
  async submitScoreToChain(score) {
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
        message: 'Connect a Sui wallet first to submit your score on-chain. (Score saved on this device.)',
      };
    }
    try {
      const { Transaction } = await import('https://esm.sh/@mysten/sui@2.39.1/transactions');
      const tx = new Transaction();
      tx.moveCall({
        target: `${this.LEADERBOARD_PACKAGE_ID}::leaderboard::submit_score`,
        arguments: [tx.object(this.LEADERBOARD_OBJECT_ID), tx.pure.u64(Math.floor(score))],
      });
      const wallet = window.sui;
      let res;
      if (wallet && typeof wallet.signAndExecuteTransaction === 'function') {
        res = await wallet.signAndExecuteTransaction({ transaction: tx });
      } else if (wallet && typeof wallet.signAndExecuteTransactionBlock === 'function') {
        res = await wallet.signAndExecuteTransactionBlock({ transactionBlock: tx });
      } else {
        return {
          ok: false, onChain: false,
          message: 'Wallet does not support signing this transaction. (Score saved on this device.)',
        };
      }
      const digest = res?.digest || res?.transaction?.digest || '';
      return {
        ok: true, onChain: true, digest,
        message: `Score ${score} submitted on-chain!${digest ? ` Tx: ${digest.slice(0, 12)}…` : ''} (Also saved on this device.)`,
      };
    } catch (e) {
      console.warn('[sui] on-chain submit failed', e);
      return {
        ok: false, onChain: false,
        message: `On-chain submit failed (${e?.message || e}). Score saved on this device.`,
      };
    }
  },

  localTopScores() {
    try {
      return JSON.parse(localStorage.getItem('lofi-snow-rush-local-scores') || '[]');
    } catch { return []; }
  },
};
