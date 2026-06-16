// Plays a few full human turns headlessly: place, attack, battle, pass.
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1380, height: 880 } });
let errors = 0;
page.on('pageerror', (e) => { errors++; console.log('PAGE ERROR:', e.message); });
page.on('dialog', (d) => d.dismiss());

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.click('.seg[data-name="speed"] button[data-v="0.45"]');
await page.click('#btn-sail');

const text = (sel) => page.locator(sel).textContent();
const btn = (label) => page.locator('#controls .btn', { hasText: label }).first();

async function step(timeout = 25000) {
  // Wait until something is actionable.
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.locator('#modal-scrim:not([hidden])').count()) return 'modal';
    const labels = await page.locator('#controls .btn').allTextContents();
    if (labels.some((l) => l.includes('Confirm'))) return labels;
    if (await page.locator('.country.pickable').count()) return 'pick';
    if (labels.length) return labels;
    await page.waitForTimeout(250);
  }
  return 'timeout';
}

let actions = 0;
let attacks = 0;
let turnsPassed = 0;
while (actions < 120 && turnsPassed < 3) {
  const s = await step();
  actions++;
  if (s === 'timeout') { console.log('TIMEOUT waiting for actionable state'); break; }
  if (s === 'modal') {
    // close whatever modal appeared (trade/keep, discard, etc.)
    const keep = page.locator('#modal .btn', { hasText: /Keep|Close/ }).first();
    if (await keep.count()) await keep.click();
    else await page.locator('#modal .card-chip').first().click();
    continue;
  }
  if (s === 'pick') {
    await page.locator('.country.pickable').first().click({ force: true });
    await page.waitForTimeout(150);
    continue;
  }
  const labels = s;
  if (labels.some((l) => l.includes('Confirm'))) {
    await btn('Confirm').click();
  } else if (labels.some((l) => l === 'Attack') && labels.some((l) => l.includes('Quit'))) {
    attacks++;
    await btn(attacks % 4 === 0 ? 'Quit Attack' : 'Attack').click();
  } else if (labels.some((l) => l === 'Attack')) {
    if (attacks < 6) {
      await btn('Attack').click();
    } else {
      turnsPassed++;
      await btn('Pass').click();
    }
  } else if (labels.some((l) => l === 'Pass')) {
    turnsPassed++;
    await btn('Pass').click();
  } else if (labels.some((l) => l === 'Cancel')) {
    await btn('Cancel').click();
  } else {
    await page.locator('#controls .btn').first().click();
  }
  await page.waitForTimeout(150);
}

console.log(`done: ${actions} actions, ${attacks} attack clicks, ${turnsPassed} turns passed, ${errors} page errors`);
console.log('final prompt:', await text('#prompt'));
await page.screenshot({ path: '/tmp/ti-playtest.png' });
await browser.close();
process.exit(errors ? 1 : 0);
