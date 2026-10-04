// Local UI preference, NOT authentication and NOT permission to cheat in a hosted match.
const PUBLIC_PORTAL = import.meta.env?.VITE_CG_PORTAL === '1';
export const DEVELOPER_KEY='prida.developer.v1';
let cached;
export function developerMode() {
  if(PUBLIC_PORTAL)return false;
  if(cached!==undefined)return cached;
  try {cached=globalThis.localStorage?.getItem(DEVELOPER_KEY)==='1';}catch{cached=false;}
  return cached;
}
export function setDeveloperMode(value) {
  cached=!PUBLIC_PORTAL && value===true;try{globalThis.localStorage?.setItem(DEVELOPER_KEY,cached?'1':'0');}catch{}
  if(typeof document!=='undefined'){document.body.classList.toggle('prida-developer',cached);document.dispatchEvent(new CustomEvent('prida-developer-change',{detail:cached}));}
  return cached;
}
export function mountDeveloperSettings() {
  if(typeof document==='undefined')return;
  if(!document.getElementById('developer-style033')){
    const style=document.createElement('style');style.id='developer-style033';
    style.textContent='body:not(.prida-developer) [data-solo-mode="debug"],body:not(.prida-developer) #debugBtn,body:not(.prida-developer) #codesBtn,body:not(.prida-developer) #pauseCodes,body:not(.prida-developer) [data-developer-only]{display:none!important}#developer-settings033{padding:14px 0 4px;border-top:1px solid #ffffff25;margin-top:12px}#developer-settings033 label{display:flex;gap:10px;align-items:center;font-weight:700}#developer-settings033 input{width:18px;height:18px;flex-shrink:0}#developer-settings033 small{display:block;line-height:1.5;margin:6px 0;color:#c1cfcc}';document.head.append(style);
  }
  const sync=()=>{
    document.body.classList.toggle('prida-developer',developerMode());
    for(const o of document.querySelectorAll('#gameMode option'))if(o.value.includes('debug')){o.hidden=!developerMode();o.disabled=!developerMode();}
    const select=document.getElementById('gameMode');if(select?.value.includes('debug')&&!developerMode()){select.value='classic';select.dispatchEvent(new Event('change',{bubbles:true}));}
  };
  sync();
  const mount=()=>{
    if(document.getElementById('developer-settings033'))return true;
    if(PUBLIC_PORTAL)return true;
    const target=document.getElementById('lobbyGameSettings')||document.querySelector('.match-options details.settings');if(!target)return false;
    const row=document.createElement('section');row.id='developer-settings033';
    row.innerHTML='<label><input type="checkbox" id="developerMode033">DEVELOPER MODE</label><small>Show Solo Debug and cheat controls. Testing is local to this browser. Online cheats remain disabled. Used cheats disable match rewards.</small>';
    target.append(row);const input=row.querySelector('input');input.checked=developerMode();input.addEventListener('change',()=>{setDeveloperMode(input.checked);sync();});return true;
  };
  if(!mount()){const observer=new MutationObserver(()=>{if(mount()){sync();observer.disconnect();}});observer.observe(document.body,{childList:true,subtree:true});}
}
export function unlimitedDebugRockets(arena,player) {
  return arena?.mode==='debug' && arena.allowCheats===true && player?.hp>0 && !player.bot && player.cheats?.infinite===true;
}
