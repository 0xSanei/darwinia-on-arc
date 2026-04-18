/**
 * Record a Darwinia-on-Arc demo video against production Vercel using
 * Playwright (borrowed from D:/Sanei/arc-daily/node_modules).
 *
 * Output:
 *   slides/demo-output/demo-<timestamp>.webm  (raw recording)
 *   slides/demo-output/demo-<timestamp>.mp4   (re-encoded via ffmpeg)
 *
 * Run: node scripts/record-demo.mjs
 *
 * Note: production Vercel doesn't yet include the ERC-8183/8004 badge
 * + Bridge USDC button (those are in uncommitted changes). This recording
 * captures the deployed state. Re-run after `git push` for the full demo.
 */

import path from 'node:path';
import fs from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';

const PLAYWRIGHT_PATH = 'D:/Sanei/arc-daily/node_modules/playwright';
process.env.NODE_PATH = `${PLAYWRIGHT_PATH}/..`;
const { chromium } = await import(`file:///${PLAYWRIGHT_PATH}/index.mjs`);

const OUT_DIR = path.resolve('slides/demo-output');
fs.mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-dev-shm-usage'],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 800 } },
});

// Inject the production auth cookie exported from Chrome
const cookieFile = 'D:/Downloads/darwinia-prod-cookie.txt';
if (fs.existsSync(cookieFile)) {
  const raw = fs.readFileSync(cookieFile, 'utf8').trim();
  const cookies = raw.split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
    const eq = p.indexOf('=');
    return {
      name: p.slice(0, eq),
      value: p.slice(eq + 1),
      domain: 'darwinia-on-arc.vercel.app',
      path: '/',
      secure: true,
      sameSite: 'Lax',
    };
  });
  await context.addCookies(cookies);
  console.log(`✓ injected ${cookies.length} auth cookies`);
} else {
  console.warn('⚠ no cookie file — recording will hit landing page only');
}

const page = await context.newPage();

const BASE = 'https://darwinia-on-arc.vercel.app';

async function pause(ms) { await page.waitForTimeout(ms); }

async function smoothScroll(distance, steps = 12) {
  const stepDist = distance / steps;
  for (let i = 0; i < steps; i++) {
    await page.evaluate((d) => window.scrollBy({ top: d, behavior: 'instant' }), stepDist);
    await pause(60);
  }
}

console.log('▶ recording…');

// Scene 1: Landing page (3s)
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await pause(3000);

// Scene 2: Dashboard (3s)
await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
await pause(3500);

// Scene 3: Optimization Jobs list (3s)
await page.goto(BASE + '/dashboard/darwinia', { waitUntil: 'networkidle' });
await pause(3500);

// Scene 4: Job detail — Hackathon 60-gen Demo (10s, scroll down to see Champion DNA + iterations)
await page.goto(BASE + '/dashboard/darwinia/b6f2dc41-c9c8-4cb1-9930-59b8858bd6e6', { waitUntil: 'networkidle' });
await pause(2500);
await smoothScroll(600);
await pause(1500);
await smoothScroll(600);
await pause(1500);
await smoothScroll(800);
await pause(2500);

// Scene 5: Agent Leaderboard (3s)
await page.goto(BASE + '/dashboard/darwinia/leaderboard', { waitUntil: 'networkidle' });
await pause(3500);

// Scene 6: New Job page (3s)
await page.goto(BASE + '/dashboard/darwinia/new', { waitUntil: 'networkidle' });
await pause(3500);

await context.close();
await browser.close();

// Find the produced webm (Playwright auto-names)
const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.webm'));
if (files.length === 0) throw new Error('No webm produced');
const latest = files.map((f) => ({ f, m: fs.statSync(path.join(OUT_DIR, f)).mtimeMs })).sort((a, b) => b.m - a.m)[0].f;
const webmPath = path.join(OUT_DIR, latest);
const finalWebm = path.join(OUT_DIR, `demo-${stamp}.webm`);
const finalMp4 = path.join(OUT_DIR, `demo-${stamp}.mp4`);
fs.renameSync(webmPath, finalWebm);
console.log(`✓ webm: ${finalWebm}`);

// Encode to MP4 (H.264) — better viewer compatibility
console.log('▶ ffmpeg encoding to mp4…');
const enc = spawnSync('ffmpeg', [
  '-y', '-i', finalWebm,
  '-c:v', 'libx264', '-preset', 'fast', '-crf', '22',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  finalMp4,
], { stdio: 'inherit' });
if (enc.status !== 0) throw new Error('ffmpeg failed');
console.log(`✓ mp4 : ${finalMp4}`);

const { size } = fs.statSync(finalMp4);
console.log(`\n✅ demo recording complete (${(size / 1024 / 1024).toFixed(1)} MB)`);
