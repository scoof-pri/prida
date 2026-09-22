// Development tool. Usage (dev server on :5173):
//   SHOTS='[{"name":"a","x":0,"z":0,"a":0,"p":0,"y":null}]' scripts/safe-run.sh ./shots.mjs 1280 720 shots.log
// Stops the game's rAF loop, renders frames by hand and reads the WebGL frame back with readPixels (page
// screenshots of a SwiftShader canvas need gigabytes and crash the headless browser). No HUD in the images.
// Take one shot per browser session: SwiftShader keeps every compiled shader, and memory grows with each view.
// Shot fields: x, z (metres), y (null = ground), a (yaw), p (pitch), slot, bots (false parks them far away),
// frames, dt, setup (JS run first with P, sim, view). MODE picks the lobby mode (classic, royale, city, ...).
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
const OUT = process.env.OUT || new URL('../shots/', import.meta.url).pathname;
// Minimal PNG writer (RGBA, rows flipped: WebGL reads bottom-up).
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, (h - 1 - y) * w * 4, (h - y) * w * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4),
      crc = Buffer.alloc(4),
      td = Buffer.concat([Buffer.from(type), data]);
    len.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export default async (page) => {
  const t0 = Date.now();
  await page.goto(process.env.URL || 'http://127.0.0.1:5173/');
  await page.waitForSelector('#menu:not(.hidden)', { timeout: 180000 });
  console.log('menu', Date.now() - t0);
  const mode = process.env.MODE || 'classic';
  await page.evaluate(() => {
    window.__raf = window.requestAnimationFrame;
    window.requestAnimationFrame = () => 0;
  });
  if (mode !== 'menu')
    await page.evaluate((mode) => {
      document.querySelector('#gameMode').value = mode;
      document.querySelector('#gameMode').dispatchEvent(new Event('change'));
      document.querySelector('#train').click();
    }, mode);
  await page.waitForTimeout(300);
  console.log('started', Date.now() - t0);
  const shots = JSON.parse(process.env.SHOTS || '[]');
  for (const s of shots) {
    const t1 = Date.now();
    const res = await page.evaluate(async (s) => {
      const P = window.__prida,
        sim = P.sim,
        view = P.view;
      if (s.setup) await new Function('P', 'sim', 'view', s.setup)(P, sim, view);
      const me = sim.players.find((p) => p.id === 'you');
      let state;
      if (me) {
        me.cheats.god = true;
        if (s.bots === false) for (const p of sim.players) if (p.bot) sim.place(p, 9999, 9999);
        sim.place(me, s.x, s.z, s.y ?? null);
        if (s.slot !== undefined) P.selectSlot(s.slot);
        P.setLook(s.a, s.p || 0);
        me.angle = s.a;
        for (let i = 0; i < (s.steps ?? 2); i++) sim.step();
        sim.place(me, s.x, s.z, s.y ?? null);
        state = sim.snapshot();
      } else state = P.state;
      const times = [];
      view.renderer.info.autoReset = false;
      let pixels = null,
        w = 0,
        h = 0;
      for (let i = 0; i < (s.frames ?? 1); i++) {
        const a = performance.now();
        view.renderer.info.reset();
        view.update(state, 'you', s.dt ?? 0.016, !!s.menu, { angle: s.a, pitch: s.p || 0, aim: !!s.aim });
        const gl = view.renderer.getContext();
        w = gl.drawingBufferWidth;
        h = gl.drawingBufferHeight;
        pixels = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        times.push(Math.round(performance.now() - a));
      }
      // base64 in chunks (String.fromCharCode has an argument limit)
      let bin = '';
      for (let i = 0; i < pixels.length; i += 0x8000) bin += String.fromCharCode.apply(null, pixels.subarray(i, i + 0x8000));
      const info = view.renderer.info;
      return { times, calls: info.render.calls, tris: info.render.triangles, geos: info.memory.geometries, tex: info.memory.textures, w, h, data: btoa(bin) };
    }, s);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(OUT + s.name + '.png', png(res.w, res.h, Buffer.from(res.data, 'base64')));
    delete res.data;
    console.log('SHOT', s.name, JSON.stringify(res), 'wall', Date.now() - t1);
  }
  if (process.env.EVAL) console.log('EVAL', JSON.stringify(await page.evaluate(process.env.EVAL)));
};
