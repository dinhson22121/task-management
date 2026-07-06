import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const photoPath = path.join(import.meta.dirname, '..', 'assets', 'avatar.jpg');

const photoUrl = `data:image/jpeg;base64,${fs.readFileSync(photoPath).toString('base64')}`;

async function render(html, outPath, size) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.waitForTimeout(150);
  await page.screenshot({ path: outPath, omitBackground: true });
  await browser.close();
  console.log('rendered', outPath);
}

const iconHtml = (size) => `<!doctype html><html><head><style>
  html,body{margin:0;padding:0;background:transparent;}
  img{width:${size}px;height:${size}px;object-fit:cover;object-position:50% 12%;border-radius:${Math.round(size * 0.22)}px;display:block;}
</style></head><body><img src="${photoUrl}"></body></html>`;

const trayHtml = (size) => `<!doctype html><html><head><style>
  html,body{margin:0;padding:0;background:transparent;}
  img{width:${size}px;height:${size}px;object-fit:cover;object-position:50% 12%;border-radius:50%;display:block;}
</style></head><body><img src="${photoUrl}"></body></html>`;

await render(iconHtml(1024), path.join(import.meta.dirname, 'icon-1024.png'), 1024);
await render(trayHtml(20), path.join(import.meta.dirname, 'tray-icon.png'), 20);
await render(trayHtml(40), path.join(import.meta.dirname, 'tray-icon@2x.png'), 40);
