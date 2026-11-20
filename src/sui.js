// Sui integration — hooks for the CLAY Hackathon III entry.
// The game is FULLY playable without a wallet. The Move leaderboard contract
// is DEPLOYED on Sui testnet (19 Nov 2026):
//   Package ID:  0x743c045df0051a564be60b35b37d2a2936acc0a5d8e1843c144a3ac98deda280
//   Leaderboard: 0x6052e73abaa237e3ee7ec50961755a49bd3b95dfe23d723974cd6cb542fa95cb (shared)
//   Publish tx:  5Zhn9kgQWErv6h2HcT1H7DdZq5hERhHWroRhwP4ug8Vd
// submitScoreToChain() sends a real moveCall (leaderboard::submit_score)
// when a wallet is connected, and always keeps the local top-10 fallback.
//
// The Snow Rush Badge NFT contract is DEPLOYED on Sui testnet (20 Nov 2026):
//   Package ID:  0xa2faf1fd27657b479024eda996f8fa7ca9a3ce7ba7020ac68f55b39d4d8787f6
//   Publish tx:  7Ra88SFF8R6iYz1FaNvF7iWwyoh6EoRrMP894yE7V3GX
//   Display V2:  HKpiDz47Bik4QqAFhYZPuNMmXEcHjVnFqktKtYMrprPQ (register_display)
//   Publisher:   0x9bb6b186b7442e3e35fcf2846268826e9f4a9d09bed70983f17fbf3211a8ada5
//   UpgradeCap:  0xf519968a101490dd903c06a424f3385745e099db1bdeb12ffe03afc0b02d3089
//   Proof mint:  6V1cMnGgJ5m6xngjpGneKxyi6tMnqaRuTHSLjRZAkyut (score 22358, badge
//                0x1afb094fb8d6e7676728228fa9e5330df09498ab34a854a4caa77a2aca5ec1ef)
// mintBadge() sends a real moveCall (badge::mint) when a wallet is connected.
// The badge holds minter + score + epoch + art URL (game keyart).
//
// Wallet connect (fixed 19 Nov 2026): modern Slush no longer injects the
// legacy `window.sui` object — it registers through the Wallet Standard.
// connect() therefore detects wallets with @mysten/wallet-standard's
// getWallets() (dynamic import from esm.sh, ONLY when the user taps
// "Connect Sui Wallet" — no wallet code runs at page load), connects via the
// wallet's `standard:connect` feature, and signs via `sui:signAndExecuteTransaction`
// (with automatic fallback to the deprecated `sui:signAndExecuteTransactionBlock`
// feature). The legacy `window.sui` path is kept as a fallback for old wallets.
// If several wallets are present and none is Slush, connect() returns
// { reason: 'pick', wallets: [...] } and the caller shows a picker, then
// re-calls connect({ walletName }) with the player's choice.
export const SUI = {
  LEADERBOARD_PACKAGE_ID: '0x743c045df0051a564be60b35b37d2a2936acc0a5d8e1843c144a3ac98deda280',
  LEADERBOARD_OBJECT_ID: '0x6052e73abaa237e3ee7ec50961755a49bd3b95dfe23d723974cd6cb542fa95cb',
  BADGE_PACKAGE_ID: '0xa2faf1fd27657b479024eda996f8fa7ca9a3ce7ba7020ac68f55b39d4d8787f6',
  connected: false,
  address: null,
  _wallet: null,
  _account: null,
  _via: null,
  _detected: null,

  // Detect Wallet Standard wallets. Waits briefly for late registration
  // (wallets register on the 'wallet-standard:app-ready' event that
  // getWallets() dispatches, or later via a 'register' event).
  async _detectStandardWallets() {
    if (this._detected && this._detected.length) return this._detected;
    let found = [];
    try {
      const { getWallets } = await import('https://esm.sh/@mysten/wallet-standard@0.21.38');
      const api = getWallets();
      found = api.get();
      if (!found.length) {
        await new Promise((resolve) => {
          const timer = setTimeout(() => { off(); resolve(); }, 1500);
          const off = api.on('register', () => { clearTimeout(timer); off(); resolve(); });
        });
        found = api.get();
      }
    } catch (e) { console.warn('[sui] wallet-standard load failed', e); }
    if (found.length) this._detected = found;
    return found;
  },

  async connect(opts = {}) {
    if (this.connected) return { ok: true, address: this.address };
    // 1) Legacy injected wallet (window.sui) — kept as a fallback for old wallets.
    try {
      const injected = window.sui;
      if (injected && typeof injected.connect === 'function') {
        const res = await injected.connect();
        const addr = res?.address || injected.address || null;
        if (addr) {
          this.connected = true;
          this.address = addr;
          this._via = 'injected';
          return { ok: true, address: addr, via: 'injected' };
        }
      }
    } catch (e) { console.warn('[sui] injected wallet failed', e); }
    // 2) Wallet Standard (how modern Slush registers).
    const wallets = await this._detectStandardWallets();
    const suiWallets = wallets.filter((w) => {
      const f = w.features || {};
      return 'standard:connect' in f
        && ('sui:signAndExecuteTransaction' in f || 'sui:signAndExecuteTransactionBlock' in f);
    });
    if (!suiWallets.length) {
      return { ok: false, reason: 'no-wallet', detail: 'No Sui wallet found. Install the Slush wallet extension, or play without connecting — scores are saved on this device.' };
    }
    let wallet = null;
    if (opts.walletName) {
      wallet = suiWallets.find((w) => w.name === opts.walletName) || null;
      if (!wallet) {
        return { ok: false, reason: 'no-wallet', detail: 'No Sui wallet found. Install the Slush wallet extension, or play without connecting — scores are saved on this device.' };
      }
    } else if (suiWallets.length === 1) {
      wallet = suiWallets[0];
    } else {
      const slush = suiWallets.find((w) => /slush/i.test(w.name));
      if (slush) {
        wallet = slush;
      } else {
        return { ok: false, reason: 'pick', wallets: suiWallets.map((w) => w.name) };
      }
    }
    try {
      const { accounts } = await wallet.features['standard:connect'].connect();
      const list = accounts || [];
      const account = list.find((a) => (a.chains || []).includes('sui:testnet')) || list[0];
      if (!account) throw new Error('wallet returned no account');
      this._wallet = wallet;
      this._account = account;
      this.connected = true;
      this.address = account.address;
      this._via = 'standard';
      return { ok: true, address: account.address, via: 'standard', wallet: wallet.name };
    } catch (e) {
      console.warn('[sui] standard connect failed', e);
      return { ok: false, reason: 'connect-failed', detail: 'Wallet connection failed or was declined in the wallet. (Score saved on this device.)' };
    }
  },

  disconnect() {
    this.connected = false;
    this.address = null;
    this._wallet = null;
    this._account = null;
    this._via = null;
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
      if (this.address) tx.setSender(this.address);
      tx.moveCall({
        target: `${this.LEADERBOARD_PACKAGE_ID}::leaderboard::submit_score`,
        arguments: [tx.object(this.LEADERBOARD_OBJECT_ID), tx.pure.u64(Math.floor(score))],
      });
      let res;
      if (this._wallet) {
        // Wallet Standard path (modern Slush). The helper falls back to the
        // deprecated sui:signAndExecuteTransactionBlock feature if needed.
        const { signAndExecuteTransaction } = await import('https://esm.sh/@mysten/wallet-standard@0.21.38');
        res = await signAndExecuteTransaction(this._wallet, {
          transaction: tx,
          account: this._account,
          chain: 'sui:testnet',
        });
      } else {
        // Legacy window.sui path.
        const wallet = window.sui;
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

  // Called from the game-over screen AFTER a successful on-chain score
  // submit. Mints a Snow Rush Badge NFT (badge::mint) holding the run's
  // score + minter + epoch + keyart URL. The signing path intentionally
  // mirrors submitScoreToChain() (duplicated, not refactored) so the proven
  // submit flow stays untouched.
  async mintBadge(score) {
    if (!this.BADGE_PACKAGE_ID) {
      return { ok: false, onChain: false, message: 'Badge contract not deployed yet.' };
    }
    if (!this.connected) {
      return { ok: false, onChain: false, message: 'Connect a Sui wallet first to mint a badge.' };
    }
    try {
      const { Transaction } = await import('https://esm.sh/@mysten/sui@2.39.1/transactions');
      const tx = new Transaction();
      if (this.address) tx.setSender(this.address);
      tx.moveCall({
        target: `${this.BADGE_PACKAGE_ID}::badge::mint`,
        arguments: [tx.pure.u64(Math.floor(score))],
      });
      let res;
      if (this._wallet) {
        const { signAndExecuteTransaction } = await import('https://esm.sh/@mysten/wallet-standard@0.21.38');
        res = await signAndExecuteTransaction(this._wallet, {
          transaction: tx,
          account: this._account,
          chain: 'sui:testnet',
        });
      } else {
        const wallet = window.sui;
        if (wallet && typeof wallet.signAndExecuteTransaction === 'function') {
          res = await wallet.signAndExecuteTransaction({ transaction: tx });
        } else if (wallet && typeof wallet.signAndExecuteTransactionBlock === 'function') {
          res = await wallet.signAndExecuteTransactionBlock({ transactionBlock: tx });
        } else {
          return {
            ok: false, onChain: false,
            message: 'Wallet does not support signing this transaction.',
          };
        }
      }
      const digest = res?.digest || res?.transaction?.digest || '';
      return {
        ok: true, onChain: true, digest,
        message: `Badge minted on-chain!${digest ? ` Tx: ${digest.slice(0, 12)}…` : ''} (Score ${Math.floor(score)}.)`,
      };
    } catch (e) {
      console.warn('[sui] badge mint failed', e);
      return {
        ok: false, onChain: false,
        message: `Badge mint failed (${e?.message || e}).`,
      };
    }
  },

  localTopScores() {
    try {
      return JSON.parse(localStorage.getItem('lofi-snow-rush-local-scores') || '[]');
    } catch { return []; }
  },
};
