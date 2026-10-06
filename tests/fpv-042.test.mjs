import test from 'node:test';
import assert from 'node:assert/strict';
import { Arena, initPhysics } from '../src/simulation.js';
import { FPV_DRONE, FISTS, WEAPONS } from '../src/catalog.js';
import { makeItem, makeGear, startSlots, EXTRA_ITEMS } from '../src/items.js';
import { fpvCount, fpvSlot, receiveFPV, consumeFPV, MAX_CARRIED_FPV } from '../src/fpv-inventory.js';
import { NetFeed, Mirror } from '../src/netcode.js';
import { groundHeight } from '../src/terrain.js';

await initPhysics();
const worldAmmo = a => a.chests.filter(c=>c.kind==='drop'&&!c.opened&&c.loot?.w===FPV_DRONE).reduce((n,c)=>n+(c.ammo??1),0);
function arena(){return new Arena({seed:91726,mode:'debug',bots:0,allowCheats:true});}
function place(a,p,x=a.map.expansion.runway.x,z=a.map.expansion.runway.z+8,y=groundHeight(x,z,a.map)+.05){
  a.place(p,x,z,y);Object.assign(p,{angle:0,pitch:0,vy:0,grounded:true,dropping:false,gliding:false,inBus:false,shield:0,cooldown:0});a.physicsDirty=true;
}
function step(a,p,i={},count=1){for(let k=0;k<count;k++){a.input(p.id,{angle:p.angle||0,pitch:p.pitch||0,...i});a.step();}}
function give(p,n){for(let k=0;k<n;k++)assert.ok(receiveFPV(p).slot>0);}
function remote(a,p){
  const feed=new NetFeed(),packet=feed.packet(p.id,feed.frame(a.snapshot()));packet.commit();
  const payload=JSON.parse(packet.text),state=new Mirror().apply(payload.state);
  // Inventory is sent only to its owner in the private self envelope.
  state.players.find(q=>q.id===p.id).slots=payload.self.slots;return state;
}

test('FPV stacks occupy a real non-melee slot, cap at five, and ignore the retired counter',()=>{
  const p={slots:startSlots(),slot:0,fpvCharges:999},fists={...p.slots[0]};
  assert.equal(fpvCount(p),0);assert.equal(fpvSlot(p),-1);assert.equal(consumeFPV(p,1),false);
  give(p,MAX_CARRIED_FPV);assert.equal(fpvCount(p),5);assert.equal(p.slots.filter(s=>s?.w===FPV_DRONE).length,1);
  const before=structuredClone(p.slots);assert.equal(receiveFPV(p).full,true);assert.deepEqual(p.slots,before);assert.deepEqual(p.slots[0],fists);
  p.slot=fpvSlot(p);for(let n=4;n>=0;n--){assert.equal(consumeFPV(p,fpvSlot(p)),true);assert.equal(fpvCount(p),n);}
  assert.equal(p.slot,0);assert.equal(p.slots[0].w,FISTS);assert.equal(fpvSlot(p),-1);assert.equal(consumeFPV(p,1),false);
  assert.equal(WEAPONS[FPV_DRONE].consumable,true);assert.equal(WEAPONS[FPV_DRONE].drone,true);
  assert.equal(EXTRA_ITEMS.includes(FPV_DRONE),false,'base/NOVA drones do not enter random chest rolls');
});

test('malformed or fractional drone stacks cannot authorize a launch slot',()=>{
  for(const ammo of [0,-1,.5,6,999,Infinity,NaN]){
    const p={slots:[makeItem(FISTS),{...makeItem(FPV_DRONE),ammo},null,null,null],slot:1};
    assert.equal(fpvSlot(p),-1,'invalid ammo '+ammo);assert.equal(consumeFPV(p,1),false);
  }
});

test('military-base FPV pickup replaces a selected full slot and drops the complete displaced weapon',()=>{
  const a=arena();try{
    const p=a.addPlayer('pickup-fpv','PICKUP');p.slots=[makeItem(FISTS),makeItem(0),makeItem(1),makeItem(2),makeItem(3)];
    p.slot=2;p.slots[2].ammo=3;p.slots[2].reserve=17;a.syncHeld(p);const previous={...p.slots[2]};
    const it=a.technology.items.find(i=>i.kind==='fpv'&&i.supportKey);place(a,p,it.x,it.z-1.6,groundHeight(it.x,it.z-1.6,a.map)+.05);
    assert.equal(a.technology.pickup(p),true);assert.equal(it.available,false);assert.equal(p.slots[2].w,FPV_DRONE);assert.equal(fpvCount(p),1);
    const dropped=a.chests.find(c=>c.kind==='drop'&&c.by===p.id&&c.loot?.w===previous.w);assert.ok(dropped);
    assert.equal(dropped.ammo,previous.ammo);assert.equal(dropped.reserve,previous.reserve);assert.equal(dropped.loot.r,previous.r);
    assert.equal(p.slots[0].w,FISTS);assert.equal(p.weapon,FPV_DRONE);
  }finally{a.dispose();}
});

test('native N quick-launch consumes one stored item without selecting it, and a held key cannot spend twice',()=>{
  const a=arena();try{
    const p=a.addPlayer('quick-fpv','QUICK');place(a,p);give(p,3);assert.equal(p.slot,0);
    step(a,p,{droneToggle:true});const id=p.droneId;assert.ok(id);assert.equal(fpvCount(p),2);assert.equal(p.slot,0);
    step(a,p,{droneToggle:true},12);assert.equal(p.droneId,id);assert.equal(a.drones.list.length,1);assert.equal(fpvCount(p),2);
    const state=remote(a,p);assert.equal(fpvCount(state.players.find(q=>q.id===p.id)),2);assert.equal(state.drones.length,1);
    step(a,p,{droneToggle:false},2);step(a,p,{droneToggle:true});assert.equal(p.droneId,null);assert.equal(a.drones.list.length,0);assert.equal(fpvCount(p),2);
  }finally{a.dispose();}
});

test('sandbox give-item and infinite-ammo tools still respect finite FPV inventory',()=>{
  const a=arena();try{
    const p=a.addPlayer('debug-fpv','DEBUG');place(a,p);
    for(let n=0;n<8;n++)a.debugGive(p.id,{weapon:FPV_DRONE});
    assert.equal(fpvCount(p),5);p.slot=fpvSlot(p);a.syncHeld(p);p.cheats.infinite=true;
    assert.equal(a.drones.launch(p),true);step(a,p,{},4);
    assert.equal(fpvCount(p),4);
  }finally{a.dispose();}
});

test('selected FPV fires from LMB while wearing AEGIS; holding LMB and returning with N cannot launch another',()=>{
  const a=arena();try{
    const p=a.addPlayer('hand-fpv','HAND');place(a,p);give(p,3);p.gear=makeGear('aegis');p.slot=fpvSlot(p);a.syncHeld(p);step(a,p,{},12);
    step(a,p,{fire:true,suitAlt:true,suitRocket:true});const id=p.droneId;assert.ok(id);assert.equal(fpvCount(p),2);
    assert.equal(a.technology.rockets.length,0);assert.equal(p.gear.fuel,100);assert.equal(a.drainEvents().some(e=>e.type==='tech-shot'),false);
    step(a,p,{fire:true},85);assert.equal(p.droneId,id,'held launch trigger must not detonate the drone');assert.equal(fpvCount(p),2);
    step(a,p,{fire:true,droneToggle:true});assert.equal(p.droneId,null);assert.equal(a.drones.list.length,0);assert.equal(fpvCount(p),2,'return must not spend the next item');
    step(a,p,{fire:false,droneToggle:false});step(a,p,{fire:true});assert.ok(p.droneId);assert.equal(fpvCount(p),1);
  }finally{a.dispose();}
});

test('native blocked and ineligible launches preserve inventory, and a forged legacy counter creates no drone',()=>{
  const a=arena();try{
    const p=a.addPlayer('blocked-fpv','BLOCKED');place(a,p);p.fpvCharges=999;
    step(a,p,{droneToggle:true,fpvCharges:999,slots:[makeItem(FPV_DRONE)]});assert.equal(p.droneId,null);assert.equal(a.drones.list.length,0);assert.equal(fpvCount(p),0);
    give(p,2);step(a,p,{droneToggle:false});
    const wall={x:p.x,y:p.y+1.5,z:p.z+.7,w:4,h:3,d:.15,hp:500,part:'site',surface:'concrete'};a.addObs(wall);
    step(a,p,{droneToggle:true});assert.equal(p.droneId,null);assert.equal(fpvCount(p),2);assert.ok(a.drainEvents().some(e=>e.text==='LAUNCH SPACE BLOCKED'));
    a.removeObs(wall);
    for(const patch of [{grounded:false},{vehicle:'occupied'},{inBus:true},{suitFlight:true},{frozen:1},{hp:0},{dropping:true},{bot:true}]){
      const original=Object.fromEntries(Object.keys(patch).map(k=>[k,p[k]]));Object.assign(p,patch);
      assert.equal(a.drones.launch(p),false);assert.equal(fpvCount(p),2);Object.assign(p,original);
    }
    p.grounded=true;assert.equal(a.drones.launch(p),true);assert.equal(fpvCount(p),1);a.drones.cancel(p);
    assert.equal(a.drones.launch(p),false,'cooldown rejects an immediate repeat');assert.equal(fpvCount(p),1);
  }finally{a.dispose();}
});

test('dropping and picking up an FPV stack preserves its quantity and replicated item identity',()=>{
  const a=arena();try{
    const p=a.addPlayer('drop-fpv','DROP');place(a,p);give(p,3);p.slot=fpvSlot(p);a.syncHeld(p);
    step(a,p,{dropItem:true});assert.equal(fpvCount(p),0);assert.equal(p.slot,0);assert.equal(worldAmmo(a),3);
    step(a,p,{dropItem:true},3);assert.equal(worldAmmo(a),3,'holding drop cannot duplicate the stack');
    const drop=a.chests.find(c=>c.kind==='drop'&&!c.opened&&c.loot?.w===FPV_DRONE);assert.ok(drop);assert.equal(drop.ammo,3);
    const state=remote(a,p),visible=state.chests.find(c=>c.id===drop.id);assert.equal(visible.ammo,3);assert.equal(visible.loot.w,FPV_DRONE);
    assert.equal(a.openChest(p),true);assert.equal(fpvCount(p),3);assert.equal(worldAmmo(a),0);assert.equal(a.openChest(p),false);
  }finally{a.dispose();}
});

test('a dropped stack cannot push inventory past five or destroy the unaccepted remainder',()=>{
  const a=arena();try{
    const p=a.addPlayer('cap-fpv','CAP');place(a,p);give(p,4);
    const drop=a.dropLoot(p.x,p.z+.4,{loot:{...makeItem(FPV_DRONE),ammo:3}},'other-player');drop.y=p.y;
    for(let i=0;i<3;i++)a.openChest(p);
    assert.equal(fpvCount(p),MAX_CARRIED_FPV);assert.equal(drop.ammo,2);assert.equal(drop.opened,false);
    assert.equal(fpvCount(p)+worldAmmo(a),7,'accepted items plus ground remainder must be conserved');
  }finally{a.dispose();}
});

test('death cancels the active drone, spills only unused items, and respawn cannot copy them',()=>{
  const a=arena();try{
    const p=a.addPlayer('dead-fpv','DEAD'),q=a.addPlayer('recover-fpv','RECOVER');place(a,p);place(a,q,p.x+5,p.z);
    give(p,3);assert.equal(a.drones.launch(p),true);assert.equal(fpvCount(p),2);const live=p.droneId;
    a.damage(null,p,999);assert.equal(p.hp,0);assert.equal(a.drones.get(live),null);assert.equal(worldAmmo(a),2);
    a.damage(null,p,999);assert.equal(worldAmmo(a),2,'a second death notification cannot duplicate loot');
    const drop=a.chests.find(c=>c.kind==='drop'&&!c.opened&&c.loot?.w===FPV_DRONE);place(a,q,drop.x,drop.z,drop.y||p.y);
    assert.equal(a.openChest(q),true);assert.equal(fpvCount(q),2);assert.equal(worldAmmo(a),0);
    a.spawn(p);assert.equal(fpvCount(p),0);assert.equal(p.droneId,null);assert.equal(fpvCount(q),2);
  }finally{a.dispose();}
});
