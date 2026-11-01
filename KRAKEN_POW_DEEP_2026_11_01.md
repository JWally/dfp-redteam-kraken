# Kraken PoW — deep pass (2026-11-01)

**Goal:** go deeper than the static assessment — recover the *exact* PoW
semantics, build a faithful solver, and determine whether the challenge can
ever be captured/verified without a session.

## 1. Recovered solver semantics (from `frontend.js`)

The client-side PoW module (`getPowChallenge`, `module: proofOfWork`,
`route: /pow`, `basePath: /api/internal`) is applied to exactly **one**
request in the app: **sign-out** inside the TFA-promotion dialog. Recovered
verbatim:

```js
// challenge from server: e = { data: hexString, randomness: bytes, difficulty: int }
const i = hexToBytes(e.data);              // challenge.data -> bytes
const n = new Uint8Array(e.randomness);    // nonce buffer, length = randomness len
const s = new Uint8Array(i.length + n.length);
s.set(i);                                  // s = data ‖ nonce
let o = 1;
do {
  crypto.getRandomValues(n);               // fresh random nonce each try
  s.set(n, i.length);
  r = new DataView(await doubleSHA256(s));
  o++;
} while (r.getUint32(0) >> (32 - e.difficulty) != 0);
// solution = hex(nonce)  -> sent as header  "x-pow": <hex nonce>
```

- **Candidate** = `challenge.data ‖ nonce` (data from server, nonce client-random).
- **Hash** = double SHA-256 (same as Bitcoin-style double hash).
- **Difficulty** = number of leading zero bits of the hash's first 32 bits;
  expected attempts ≈ `2^difficulty`.
- **Solution** = hex of the nonce; transported as the `x-pow` request header.

## 2. Faithful solver + self-verification (proven)

`scripts/krk-pow-solver.mjs` reimplements this exactly (node crypto) and
self-verifies with the server-side check (recompute double-SHA256 of
`data‖solution`, confirm leading-zero bits):

| difficulty | expected | actual attempts | server-verify |
|---|---|---|---|
| 10 | ~1,024 | 88 | **PASS** |
| 12 | ~4,096 | 4,263 | **PASS** |
| 14 | ~16,384 | 8,558 | **PASS** |

Solve/verify loop is sound: a valid nonce is cheap for a real client and
impossible to fake without the work — exactly the property Kraken wants.

## 3. Challenge issuance gate (the real boundary)

Re-tested live (2026-11-01, clean Chrome + curl):

- `GET /api/internal/pow` → **401 `No session`** (even with
  `preferred_asset_name`, even from the app origin).
- `GET /api/internal/pow` on pro.kraken.com / api.kraken.com hosts → 302/404.
- No `/pow` request ever fires during the unauthenticated login flow; no
  `x-pow` headers on any unauthenticated request.
- No Cloudflare Turnstile / `cf_chl` / `cf_clearance` challenge on the app —
  `__cf_bm` bot-management cookie only (edge transport, not a JS gate).

**Conclusion:** the PoW challenge is **server-gated**: the server decides when
to issue it (session + risk), so an unauthenticated attacker cannot obtain a
live challenge, and cannot replay one (each challenge carries fresh server
`randomness`). This is the same "server-decided" pattern as hCaptcha /
Fingerprint Pro identity — the client solver is real, but the *issuance* is
the boundary.

## 4. Why this is the good design (vs Kasada)

| | Kraken `x-pow` | Kasada `x-kpsdk-cd` |
|---|---|---|
| Issued by | server, per-session, fresh randomness | server (but ct cleared on asset GET) |
| Client proof | real double-SHA256 nonce search | plaintext JSON, garbage accepted |
| Server verifies | re-hash + leading-zero check | presence-checked only (200 + token anyway) |
| Replay | blocked (fresh randomness) | trivial (replay works) |
| Verdict | **the work is the proof** | the work is decorative |

## 5. Honest boundaries

- No live challenge captured: issuance requires a session (401 without one).
- The solver is verified against synthetic challenges of the same format —
  not against a live Kraken-issued challenge.
- No account, no auth, nothing forwarded; all observation/self-verification
  only.

## 6. Artifacts

- `scripts/krk-pow-solver.mjs` — faithful solver + self-verify (run: `node scripts/krk-pow-solver.mjs`)
- `artifacts/deep-flow.json` — the clean-browser flow capture (no /pow, iapi calls listed)
- `assets/frontend.js` — source (solver at ~3.43M offset, getPowChallenge at ~2.15M)
