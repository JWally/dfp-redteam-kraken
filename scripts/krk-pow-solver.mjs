#!/usr/bin/env node
/** krk-pow-solver.mjs — faithful reimplementation of Kraken's client-side
 *  PoW (from frontend.js) + self-verification of the solve->verify loop.
 *
 *  Client semantics (recovered from the bundle):
 *    challenge = { data: hexString, randomness: bytes, difficulty: int }
 *    nonce n   = random bytes, same length as randomness
 *    candidate = data_bytes || nonce
 *    hash      = double-SHA256(candidate)
 *    valid     = (hash[0..3] as uint32 big-endian) >> (32 - difficulty) == 0
 *    solution  = hex(nonce)   -> sent as "x-pow" header
 */
import { createHash, randomBytes } from 'node:crypto';

const sha256 = (b) => createHash('sha256').update(b).digest();

// double SHA-256
function dsha256(buf) { return sha256(sha256(buf)); }

// challenge.data is a hex string
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i*2, 2), 16);
  return out;
}
function bytesToHex(u8) { let t=''; for (let i=0;i<u8.length;i++) t += u8[i].toString(16).padStart(2,'0'); return t; }

// faithful solver (mirrors the client's do/while + getRandomValues loop)
async function solve(challenge, {log=false}={}) {
  const data = hexToBytes(challenge.data);
  const randomnessLen = challenge.randomness.length; // length of the nonce
  const s = new Uint8Array(data.length + randomnessLen);
  s.set(data);
  let attempts = 1;
  const start = Date.now();
  for (;;) {
    const n = randomBytes(randomnessLen);
    s.set(n, data.length);
    const r = dsha256(s);
    const u32 = r.readUInt32BE(0);
    if ((u32 >>> (32 - challenge.difficulty)) === 0) {
      return { solution: bytesToHex(n), attempts, ms: Date.now()-start, hash: bytesToHex(r) };
    }
    attempts++;
  }
}

// verify (what the server does): recompute double-SHA256(data||nonce), check leading-zero bits
function verify(challenge, solutionHex) {
  const data = hexToBytes(challenge.data);
  const n = hexToBytes(solutionHex);
  const cand = Buffer.concat([Buffer.from(data), Buffer.from(n)]);
  const h = dsha256(cand);
  const u32 = h.readUInt32BE(0);
  return { ok: (u32 >>> (32 - challenge.difficulty)) === 0, hash: bytesToHex(h) };
}

// --- self-test: synthesize challenges like the server would ---
const tests = [
  { data: Buffer.from('synthetic-challenge-v1').toString('hex'), randomness: Buffer.from('a1b2c3d4e5f60718293a4b5c6d7e8f90','hex'), difficulty: 12 },
  { data: Buffer.from('auth-1793558480000').toString('hex'), randomness: randomBytes(16), difficulty: 14 },
  { data: Buffer.from('trade-88f2').toString('hex'), randomness: randomBytes(8), difficulty: 10 },
];

for (const ch of tests) {
  ch.randomness = Array.from(ch.randomness); // as the JSON would arrive
  const sol = await solve(ch, {log:false});
  const v = verify(ch, sol.solution);
  const expected = Math.pow(2, ch.difficulty);
  console.log(`difficulty=${ch.difficulty} (expected ~${expected} tries)`);
  console.log(`  solved in ${sol.ms}ms / ${sol.attempts} attempts (${(sol.attempts/expected).toFixed(2)}x expected)`);
  console.log(`  solution=${sol.solution.slice(0,24)}...  hash=${sol.hash.slice(0,16)}...`);
  console.log(`  server-verify: ${v.ok ? 'PASS' : 'FAIL'}  hash=${v.hash.slice(0,16)}...`);
  console.log('');
}
