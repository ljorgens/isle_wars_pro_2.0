// Drives the game in headless Chrome and captures verification screenshots.
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1380, height: 880 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text());
});

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/ti-title.png' });

// Start a game at Gale pace so banners clear fast.
await page.click('.seg[data-name="speed"] button[data-v="0.45"]');
await page.click('#btn-sail');
await page.waitForTimeout(4500); // setup + "your turn" banner
await page.screenshot({ path: '/tmp/ti-game.png' });

// Try placing armies: click first pickable country, confirm amount.
const pickable = page.locator('.country.pickable').first();
if (await pickable.count()) {
  await pickable.click({ force: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/ti-amount.png' });
  const confirm = page.locator('#controls .btn.primary');
  if (await confirm.count()) {
    await confirm.click();
    await page.waitForTimeout(400);
  }
}
await page.screenshot({ path: '/tmp/ti-after-place.png' });
console.log('screenshots written');
await browser.close();
