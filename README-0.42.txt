PRIDA 0.42.0 — FPV ITEMS / AIRCRAFT / SUIT COMBAT

Complete expanded source and compact runtime assets.
Read README.md and docs/UPDATE-0.42.md for behavior and verification.

Node.js 22+: npm ci; npm run build; npm start.
Open http://localhost:8080. Frontend development: npm run dev.

FPV: select its item and fire; N quick-launches or ends the link.
Backspace drops the held item/stack. Inventory has a touch drop button.
AEGIS: hold Space to take off; Shift boosts; C descends; LMB palm pulse;
hold RMB for chest beam; R launches one of six shoulder rockets.
Aircraft: W throttle and look up to take off; lower the nose to recover a stall.

Optional cumulative updater: node prida-update.mjs.
It runs staged tests and builds before installing prepared source files.
Expanded sources do not automatically reapply it on dev/start/build.
After edits: node scripts/build-update.mjs; npm run verify:release.

Large original FBX uploads are not required to run the game. Both character
GLBs include 30 supplied motions; source hashes and conversion instructions
are included. Live WebGL presentation and device FPS were not verified here.
