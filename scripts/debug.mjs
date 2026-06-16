import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1380, height: 880 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message, e.stack?.split('\n')[1] ?? ''));
page.on('dialog', (d) => { console.log('DIALOG:', d.type(), d.message()); d.dismiss(); });

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.click('.seg[data-name="speed"] button[data-v="0.45"]');
await page.click('#btn-sail');

for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1000);
  const state = await page.evaluate(() => ({
    titleHidden: document.querySelector('#title-screen').hidden,
    prompt: document.querySelector('#prompt')?.textContent,
    ticker: document.querySelector('#ticker')?.textContent,
    pickable: document.querySelectorAll('.country.pickable').length,
    buttons: [...document.querySelectorAll('#controls .btn')].map((b) => b.textContent),
    scroll: window.scrollY,
  }));
  console.log(i + 1 + 's', JSON.stringify(state));
  if (!state.titleHidden) break;
}
await browser.close();
