// Regenerates the extra weapon/gear GLBs and all weapon icons.
// Requires Playwright with Chromium (not a project dependency): node scripts/build-weapon-assets.mjs
import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
import { WEAPONS, GEAR } from '../src/catalog.js';

const playwrightPath = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(playwrightPath);
const server = await createServer({ root: process.cwd(), server: { port: 5199 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto('http://localhost:5199/scripts/weapon-assets.html');
  await page.waitForFunction(() => document.title === 'ready', null, { timeout: 60000 });
  const save = async (dict, dir, ext) => {
    for (const [name, b64] of Object.entries(dict)) {
      await writeFile(`public/${dir}/${name}.${ext}`, Buffer.from(b64, 'base64'));
      console.log('wrote', dir, name);
    }
  };
  if (!process.argv.includes('--icons-only')) {
    await save(
      await page.evaluate(
        (pairs) => window.extract(pairs),
        [
          ['Knife_1', 'knife'],
          ['Knife_2', 'dagger'],
          ['Shovel', 'shovel'],
          ['Revolver', 'revolver'],
          ['Revolver_Small', 'handcannon'],
          ['GrenadeLauncher', 'grenadelauncher'],
          ['Sniper_2', 'marksman'],
        ],
      ),
      'models',
      'glb',
    );
    await save(
      await page.evaluate((n) => window.procedural(n), ['katana', 'crossbow', 'minigun', 'jetpack', 'glider']),
      'models',
      'glb',
    );
  }
  const list = [
    ...WEAPONS.map((w) => ({ name: w.model, rot: w.iconRot || [0, 0, 0] })),
    ...GEAR.map((g) => ({ name: g.model, rot: g.iconRot || [0, 0, 0] })),
  ];
  await save(await page.evaluate((l) => window.icons(l), list), 'icons', 'png');
} finally {
  await browser.close();
  await server.close();
}
