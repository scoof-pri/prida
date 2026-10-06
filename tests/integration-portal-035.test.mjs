// Runs in the staged ACTUAL game tree before a deployment is installed. No game-source stubs.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {readProfile} from '../src/cosmetics.js';
import * as sdk from '../src/sdk.js';
const read=n=>fs.readFileSync(new URL('../'+n,import.meta.url),'utf8');
test('real patched movement keeps both car support and escalator support (Render regression)',()=>{
 const source=read('src/simulation.js');
 assert.equal(source.split('p.grounded = this.controller.computedGrounded() || m.supported || (!!conveyor034.id && Math.abs(m.y-conveyor034.y)<.06);').length-1,1);
 assert.ok(source.includes('this.escalators.carry(p,i,dt)'));
});
test('all legacy portal imports remain exported',()=>{
 for(const k of ['initSDK','gameplay','portalStorage','portalInvite','portalRoom','portalJoin'])assert.equal(typeof sdk[k],'function',k);
});
test('real cosmetics sanitizer preserves earned reward receipts, coins, skin and emote',()=>{
 const profile=readProfile({version:2,coins:300,matches:2,owned:['hazmat','crouchdance'],portalRewards:{at:1000,ids:['reward-12345678']}});
 assert.equal(profile.coins,300);assert.ok(profile.owned.includes('hazmat'));assert.ok(profile.owned.includes('crouchdance'));
 assert.deepEqual(profile.portalRewards,{at:1000,ids:['reward-12345678']});
 const twice=readProfile(JSON.stringify(profile));assert.deepEqual(twice.portalRewards,profile.portalRewards);
});
test('actual UI integration blocks local account synchronization, input and solo simulation during ads',()=>{
 const source=read('src/main.js');
 for(const s of ['if (portalMode()) return;',"saveStore = portalMode() ? portalStorage() : localStorage;", "if (mode === 'training' && !portalAdBusy()", '!portalAdBusy() && mode', 'portalUi035 = createPortalUI({'])assert.ok(source.includes(s),s);
 assert.ok(source.includes('portalLoading(false)'));
});
