#!/usr/bin/env node
/** kr-probe.mjs — load kraken.com, capture all scripts/requests + any
 *  challenge/fingerprint/proof-of-work code that actually runs. */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const b = await chromium.launch({ headless:true });
const ctx = await b.newContext({ viewport:{width:1280,height:900}, userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36' });
const page = await ctx.newPage();
const log = { requests:[], bundles:{}, errors:[] };
page.on('request', req => {
  const u = req.url();
  if (/kraken|cloudflare|turnstile|captcha|challenge|risk|pow|proof|fingerprint|\._static/.test(u)) {
    log.requests.push({ method: req.method(), type: req.resourceType(), url: u.slice(0,160) });
  }
});
page.on('response', async r => {
  const u = r.url();
  if (/\.js($|\?)/.test(u) && /kraken|cloudflare|challenge/.test(u)) {
    try { const body = await r.text(); if (body.length > 5000) log.bundles[u] = body; } catch(_){}
  }
});
page.on('pageerror', e => log.errors.push(String(e).slice(0,120)));
await page.goto('https://www.kraken.com/', { waitUntil:'load', timeout:60000 }).catch(()=>{});
await page.waitForTimeout(15000);
const state = await page.evaluate(() => ({
  title: document.title,
  cf: typeof window.turnstile !== 'undefined' || !!document.querySelector('.cf-turnstile, [data-sitekey]'),
  fpGlobals: Object.keys(window).filter(k=>/turnstile|challenge|captcha|risk|pow|fingerprint|webgl|kraken/i.test(k)).slice(0,30),
  cookies: document.cookie.split(';').map(c=>c.trim().split('=')[0]).filter(c=>/cf|turnstile|kraken|risk|challenge/i.test(c)),
})).catch(e=>({err:String(e).slice(0,150)}));
console.log('requests:', log.requests.length, '| bundles:', Object.keys(log.bundles).length);
console.log('\nstate:', JSON.stringify(state,null,1).slice(0,900));
const hosts = {};
for (const r of log.requests) { try { const h=new URL(r.url).host; hosts[h]=(hosts[h]||0)+1; } catch(_){} }
console.log('\n=== hosts ===');
for (const [h,n] of Object.entries(hosts).sort((a,b)=>b[1]-a[1])) console.log(`  ${n}  ${h}`);
console.log('\nerrors:', log.errors.slice(0,3));
writeFileSync('/tmp/opencode/kr/probe1.json', JSON.stringify({state, requests:log.requests.slice(0,60)},null,2));
await b.close();
