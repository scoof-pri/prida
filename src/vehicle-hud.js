import { ARMOUR_FACES, armourProfile } from './tank-armour.js';
// A single compact vehicle panel; on-foot HUD returns immediately on exit.
import { VEHICLE_ASSET_STATUS } from './vehicle-models.js';
import { VEHICLES, vehicleSpec } from './vehicle-specs.js';
import { ROCKETS, rocketSpec } from './vehicle-rockets.js';
export const vehicleTouch={alt:false,rocket:false,brake:false,up:false,down:false};
let panel,reticle,locationLabel,lastRegion='',built=false;
const fieldCache=new Map();
function putField(k,value){let c=fieldCache.get(k);if(!c){c={el:panel.querySelector('[data-v="'+k+'"]')};fieldCache.set(k,c);}if(c.value!==value){c.value=value;c.el.textContent=value;}}
function bootHUD() {
  if(built)return;built=true;
  const style=document.createElement('style');style.textContent=`
#vehicleHud{position:fixed;z-index:10;bottom:max(20px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);width:min(510px,94vw);background:#142a30e8;border:1px solid #dbddc644;border-radius:7px;padding:12px 15px;color:#f6eddb;pointer-events:none;font:12px Arial;box-shadow:0 7px 20px #0004}
#vehicleHud[hidden],#vehicleReticle[hidden],#vehiclePlace[hidden]{display:none!important}
#vehicleHud header{display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;letter-spacing:1.5px}#vehicleHud header b{font-size:17px}#vehicleHud .vehicle-bars{display:grid;grid-template-columns:1fr 1fr;gap:8px}#vehicleHud label{font-size:9px;letter-spacing:.8px}#vehicleHud progress{width:100%;display:block;accent-color:#8bcda7;height:9px;margin-top:3px}#vehicleHud .vehicle-ammo{display:flex;flex-wrap:wrap;gap:6px 14px;margin:10px 0 6px;font-size:11px}#vehicleHud .vehicle-help{font-size:10px;line-height:1.6;color:#c1d3c6}#vehicleHud .vehicle-warning{color:#ffbf88;font-size:11px;min-height:14px;margin-top:4px}
#vehicleHud .vehicle-touch{display:none;gap:5px;margin-top:8px;pointer-events:auto}body.touch #vehicleHud .vehicle-touch{display:flex;flex-wrap:wrap}#vehicleHud button{background:#3f6061;border:1px solid #bdd4be55;border-radius:4px;padding:8px;color:#fff;font:bold 10px Arial;touch-action:none;user-select:none}
body.vehicle-driving #weaponBar,body.vehicle-driving .ammo,body.vehicle-driving .vitals,body.vehicle-driving #stamina,body.vehicle-driving #gearStatus,body.vehicle-driving #relicHud,body.vehicle-driving #armorLabel,body.vehicle-driving #crosshair{display:none!important}
body.vehicle-driving #jumpBtn,body.vehicle-driving #sprintBtn,body.vehicle-driving #touchReload,body.vehicle-driving #aimBtn,body.vehicle-driving #ability1Btn,body.vehicle-driving #ability2Btn,body.vehicle-driving #emoteBtn,body.vehicle-driving #dashBtn,body.vehicle-driving #flyDown,body.vehicle-driving #interactBtn{display:none!important}
#vehicleReticle{position:fixed;z-index:5;pointer-events:none;width:24px;height:24px;border:2px solid #ffdeb0;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 0 1px #14333988}#vehicleReticle:after{content:'';position:absolute;inset:8px;border-radius:50%;background:#fff3da}
#vehicleHud .vehicle-armour{font:10px Arial;line-height:1.5;color:#a8daee;margin:4px 0;overflow-wrap:anywhere}#vehiclePlace{position:fixed;left:50%;top:75px;transform:translateX(-50%);z-index:5;pointer-events:none;font:bold 12px Arial;letter-spacing:2px;background:#213c40bb;padding:7px 13px;border-radius:3px;color:#f4e7ce}
@media(max-width:700px){#vehicleHud{bottom:165px;width:min(410px,90vw);padding:8px 10px}#vehiclePlace{top:107px;font-size:10px}#vehicleHud header b{font-size:13px}#vehicleHud .vehicle-help{display:none}#vehicleHud .vehicle-ammo{font-size:9px}}
@media(max-height:520px){#vehicleHud{bottom:4px;width:min(370px,calc(100vw - 270px));padding:6px 10px}#vehicleHud .vehicle-help{display:none}#vehicleHud .vehicle-touch{position:fixed;right:-110px;bottom:110px;width:100px}#vehiclePlace{top:53px}}
`;document.head.append(style);
  panel=document.createElement('section');panel.id='vehicleHud';panel.hidden=true;panel.setAttribute('aria-label','Vehicle status');panel.innerHTML=`<header><b data-v="name"></b><span data-v="speed"></span></header><div class="vehicle-bars"><label>HULL <span data-v="hp"></span><progress data-v="hull" max="1"></progress></label><label>FUEL <span data-v="fuelText"></span><progress data-v="fuel" max="1"></progress></label></div><div class="vehicle-ammo"><span data-v="cannon"></span><span data-v="mg"></span><span data-v="heat"></span><span data-v="rocket"></span><strong data-v="lock" aria-live="polite"></strong></div><div class="vehicle-armour" data-v="armour"></div><small data-v="model"></small><div class="vehicle-help" data-v="help"></div><div class="vehicle-warning" data-v="warning"></div><div class="vehicle-touch"><button data-hold="alt">MG</button><button data-hold="rocket" aria-label="Launch rockets">ROCKET</button><button data-hold="brake">BRAKE</button><button data-hold="up">CLIMB</button><button data-hold="down">DESCEND</button><button data-action="service">SERVICE</button><button data-action="use">EXIT</button></div>`;
  reticle=document.createElement('div');reticle.id='vehicleReticle';reticle.hidden=true;
  locationLabel=document.createElement('div');locationLabel.id='vehiclePlace';locationLabel.hidden=true;
  document.body.append(panel,reticle,locationLabel);
  for(const button of panel.querySelectorAll('[data-hold]')) {
    const key=button.dataset.hold;
    button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);vehicleTouch[key]=true;});
    for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,()=>vehicleTouch[key]=false);
  }
  for(const button of panel.querySelectorAll('[data-action]'))button.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('prida-vehicle-action',{detail:button.dataset.action})));
  for(const name of ['blur','pagehide'])window.addEventListener(name,()=>Object.keys(vehicleTouch).forEach(k=>vehicleTouch[k]=false));
}
export function updateVehicleHUD(state,p,view,menu=false,paused=false) {
  bootHUD();const v=!menu&&p?.vehicle?(state.vehicles||[]).find(v=>v.id===p.vehicle):null;
  panel.hidden=!v;reticle.hidden=!v||v.kind==='car'||paused;document.body.classList.toggle('vehicle-driving',!!v);
  if(!v){for(const k of Object.keys(vehicleTouch))vehicleTouch[k]=false;}
  if(v){const s=vehicleSpec(v),put=putField;
    put('name',s.name+' / '+v.kind.toUpperCase());put('speed',Math.round(Math.abs(v.speed)*3.6)+' KM/H');
    put('hp',Math.round(v.hp)+' / '+s.hp);panel.querySelector('[data-v="hull"]').value=v.hp/s.hp;
    put('fuelText',Math.round(v.fuel/s.fuel*100)+' %');panel.querySelector('[data-v="fuel"]').value=v.fuel/s.fuel;
    put('cannon',s.cannon?'CANNON '+(s.infiniteAmmo?'∞':v.ammo)+(v.primaryCd>0?' · '+v.primaryCd.toFixed(1)+' s':''):(v.variant==='sam'?'AIR-DEFENCE LAUNCHER':'CIVILIAN VEHICLE'));
    put('mg',s.mg?'MG '+(s.infiniteAmmo?'∞':v.mgAmmo):'');put('heat',s.mg?'HEAT '+Math.round(v.heat*100)+' %':'');
    const rocket=rocketSpec(v);
    put('rocket',rocket?'ROCKETS '+(rocket.infinite?'∞':(v.rocketAmmo??0))+(v.rocketReserve>0?' + '+v.rocketReserve:'')+(v.rocketReload>0?' · RELOAD '+v.rocketReload.toFixed(1)+' s':v.rocketCd>0?' · '+v.rocketCd.toFixed(1)+' s':v.rocketAmmo>0?' · READY':' · EMPTY'):'');
    const plates=armourProfile(v);
    put('armour',plates?'ARMOUR · '+ARMOUR_FACES.map(k=>({front:'F',left:'L',right:'R',rear:'BACK',top:'TOP'}[k])+' '+Math.ceil((v.armour?.[k]??plates[k])/plates[k]*100)+'%').join(' / '):'');
    put('lock',v.variant==='sam'?(v.lockTarget?(v.lockProgress>=1?'LOCKED · ':'ACQUIRING '+Math.round(v.lockProgress*100)+'% · ')+v.lockRange+' M':'AIM AT AN AIRBORNE ENEMY'): '');
    reticle.style.borderColor=v.variant==='sam'?(v.lockProgress>=1?'#95ffc4':'#ffd58d'):'#ffdeb0';
    put('model',v.variant?'MODEL: ORIGINAL / ANIMATED':v.kind==='car'?'':VEHICLE_ASSET_STATUS[v.kind]==='built-in fallback'?'MODEL: BUILT-IN FALLBACK':'MODEL: CC0 / 3DASSETS.DEV');
    put('help',v.variant==='sam'?'WASD DRIVE · MOUSE AIM · HOLD TARGET 1 s · LMB / Q GUIDED MISSILE · E EXIT':v.kind==='plane'?'HOLD W + LOOK UP TO TAKE OFF · MOUSE FLIGHT · S SLOW · A/D TURN · LMB CANNON · RMB MG · HOLD Q ROCKETS · E BAIL OUT':'WASD DRIVE · SPACE BRAKE · E EXIT'+(v.kind==='tank'?' · MOUSE TURRET · LMB CANNON · RMB MG · Q ROCKETS / HYDRA: 6-ROUND BURST · RAM COVER':''));
    put('warning',v.hp<=0?'WRECKED':v.repair>0?'SERVICING '+Math.ceil(3-v.repair)+' s':v.overheated?'MG OVERHEATED':v.fuel<=0?'OUT OF FUEL':v.kind==='plane'&&v.airborne&&v.speed<s.stall?'STALL · HOLD W':v.kind==='plane'&&!v.airborne?'HOLD W, THEN LOOK UP AFTER THE TAKEOFF RUN':'R: REPAIR / REARM AT SERVICE PAD');
    for(const button of panel.querySelectorAll('[data-hold="up"],[data-hold="down"]'))button.hidden=v.kind!=='plane';
    panel.querySelector('[data-hold="alt"]').hidden=!s.mg;
    const rocketButton=panel.querySelector('[data-hold="rocket"]');rocketButton.hidden=!rocket;
    rocketButton.textContent=v.variant==='sam'&&v.lockProgress<1?'LOCK TARGET':v.rocketReload>0?'RELOADING':v.rocketAmmo>0?'ROCKET':'EMPTY';
    if(paused||!rocket||v.hp<=0)vehicleTouch.rocket=false;
    const aim=view.vehicleAim||{x:.5,y:.5};reticle.style.left=(aim.x*innerWidth)+'px';reticle.style.top=(aim.y*innerHeight)+'px';
  }
  const exp=view?.map?.expansion;let region='';
  if(p&&!menu&&exp){if(Math.abs(p.x-exp.base.x)<exp.base.w/2&&Math.abs(p.z-exp.base.z)<exp.base.d/2)region=exp.base.name;
    for(const villa of exp.villas)if(Math.abs(p.x-villa.x)<villa.w/2&&Math.abs(p.z-villa.z)<villa.d/2)region=villa.name;}
  locationLabel.hidden=!region;locationLabel.textContent=region;lastRegion=region;
}
