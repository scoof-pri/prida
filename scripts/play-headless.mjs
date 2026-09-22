import {chromium} from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const [,, script, w=1280, h=720, touch] = process.argv;
const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const ctx = await b.newContext({viewport:{width:+w,height:+h}, hasTouch: !!touch, isMobile: !!touch});
await ctx.addInitScript((q) => { try { localStorage.setItem('blockyard-quality', q); } catch {} window.AudioContext = undefined; window.webkitAudioContext = undefined; }, process.env.Q || 'fast');
const page = await ctx.newPage();
page.setDefaultTimeout(90000);
const errors = [];
page.on('console', m => { if (m.type()==='error' || m.type()==='warning') { errors.push(m.type()+': '+m.text()); console.log('CONSOLE', m.type(), m.text().slice(0, 300)); } });
page.on('crash', () => console.log('PAGE CRASH'));
page.on('pageerror', e => errors.push('pageerror: '+e.message));
const steps = (await import(script)).default;
try { await steps(page); } catch (e) { console.log('STEP ERROR', e.message); }
console.log(errors.slice(0,20).join('\n'));
await b.close();
