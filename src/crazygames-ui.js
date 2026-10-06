import { portal, portalMode } from './sdk.js';
import { REWARD_OFFERS, RewardController } from './portal-rewards.js';
const css = `
body.prida-cg #accountOut,body.prida-cg #accountIn,body.prida-cg #accountStore,
body.prida-cg #codesBtn,body.prida-cg #developer-settings033,body.prida-cg [data-developer-only],body.prida-cg #nickname{display:none!important}
.prida-cg-panel [hidden]{display:none!important}
.prida-cg-panel{display:grid;gap:14px;text-align:left;padding:8px 0;color:#eeeade}
.prida-cg-profile{display:flex;align-items:center;gap:12px}.prida-cg-profile img{width:48px;height:48px;border-radius:50%;object-fit:cover}
.prida-cg-profile strong{display:block;font-size:19px}.prida-cg-profile small{display:block;opacity:.8;margin-top:4px}
.prida-cg-note{font-size:13px;line-height:1.5;margin:0;opacity:.85}
.prida-cg-offers{display:grid;gap:9px}.prida-cg-offers button{width:100%;min-height:56px;padding:10px 14px;text-align:left}
.prida-cg-offers button small{display:block;font-size:11px;line-height:1.4;letter-spacing:0;margin-top:5px}
#pridaAdBlocker{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:#121e20dc;color:white;font:600 18px system-ui;text-align:center}
#pridaAdBlocker[hidden]{display:none!important}.prida-cg-status{min-height:1.5em;font-size:13px;line-height:1.5;color:#e7cb8e}
`;
function node(tag, text, parent) { const el = document.createElement(tag); if (text) el.textContent = text; parent?.append(el); return el; }
export function createPortalUI({ getProfile, writeProfile, isLobby, onIdentityChange, mute, clearInput, releaseMouse }) {
  if (!portalMode()) return null;
  document.body.classList.add('prida-cg');
  const style=node('style'); style.textContent=css; document.head.append(style);
  const host = document.querySelector('#accountPanel .modal-card');
  if (!host) throw new Error('The existing account panel is missing.');
  const root=node('section',null,host); root.className='prida-cg-panel';
  const row=node('div',null,root); row.className='prida-cg-profile';
  const image=node('img',null,row); image.alt='CrazyGames avatar'; image.referrerPolicy='no-referrer';
  const names=node('div',null,row), name=node('strong',null,names), subtitle=node('small',null,names);
  const login=node('button','LOG IN WITH CRAZYGAMES',root); login.type='button';
  const note=node('p','Guest play is always available. Your progress is saved with CrazyGames Data. Coins and these cosmetics are also earnable by playing.',root); note.className='prida-cg-note';
  const offers=node('div',null,root); offers.className='prida-cg-offers';
  const status=node('p',null,root); status.className='prida-cg-status'; status.setAttribute('role','status');
  const retry=node('button','RETRY SAVING REWARD',root); retry.hidden=true;
  const blocker=node('div','Preparing your ad…',document.body); blocker.id='pridaAdBlocker'; blocker.hidden=true;
  blocker.setAttribute('role','status'); blocker.setAttribute('aria-live','polite');
  const controls = new RewardController({ portal, getProfile, writeProfile });
  let loginBusy=false;
  const isAllowed=()=>isLobby() && getProfile()?.matches>0;
  const present=result=>{
    retry.hidden=!result.retry;
    status.textContent=result.ok?'Reward saved.':result.retry?'The ad finished, but saving failed. Retry saving; no second ad is required.':
      result.reason==='owned'?'You already own this reward.':result.reason==='demo'?'SDK demo only. No real reward was granted.':
      result.reason==='not-ready'?'Finish a match first, return to the lobby and wait for the cooldown.':'No reward: the ad did not complete or is unavailable. You can continue playing.';
    render();
  };
  const buttons=REWARD_OFFERS.map(offer=>{
    const button=node('button',null,offers); button.type='button';
    node('strong','WATCH AD · '+offer.title,button); node('small',offer.detail,button);
    button.onclick=async()=>{status.textContent=''; try {present(await controls.request(offer.id,isAllowed()));}catch {status.textContent='Unable to request an ad. You can continue playing.';render();}};
    return {offer,button};
  });
  const skip=node('button',null,offers);skip.type='button';
  node('strong','CONTINUE WITHOUT AN AD',skip);node('small','Close this panel. Your progress is kept.',skip);
  skip.onclick=()=>document.querySelector('[data-close="accountPanel"]')?.click();
  retry.onclick=()=>present(controls.commit());
  login.onclick=async()=>{
    if(loginBusy)return;loginBusy=true;render();releaseMouse();
    try{await portal.login();status.textContent='Signed in with CrazyGames.';}catch(e){status.textContent=e?.code==='userCancelled'?'You can keep playing as a guest.':'Sign-in was not completed. Guest play is available.';}
    finally{loginBusy=false;render();}
  };
  portal.setHooks({
    block(on){ blocker.hidden=!on; clearInput(); if(on)releaseMouse(); render(); },
    mute(on){ mute(on); },
  });
  const offUser=portal.onUser((user,changed)=>{ render(); if(changed)onIdentityChange(user); });
  const timer=setInterval(()=>{if(!document.getElementById('accountPanel')?.classList.contains('hidden'))render();},1000);
  function render(){
    const user=portal.user, profile=getProfile();
    name.textContent=user?.username||'GUEST'; subtitle.textContent=user?'Connected with your CrazyGames account':'No registration needed';
    const src=user?.profilePictureUrl;
    let safe=''; try {const u=new URL(src);if(u.protocol==='https:'&&u.hostname==='images.crazygames.com')safe=u.href;}catch{}
    image.hidden=!safe;if(safe && image.src!==safe)image.src=safe;
    login.hidden=!!user||!portal.accountsAvailable;login.disabled=loginBusy||portal.busy;
    const top=document.getElementById('accountBtn');if(top)top.textContent=user?.username||'CRAZYGAMES ACCOUNT';
    const nickname=document.getElementById('nickname');if(nickname){nickname.value=user?.username||'Guest';nickname.readOnly=true;const label=nickname.closest('label');if(label)label.style.display='none';}
    offers.hidden=!portal.adsAvailable||!isAllowed();skip.disabled=portal.busy||controls.inFlight;
    for(const {offer,button}of buttons){const owned=!!offer.cosmetic&&profile?.owned?.includes(offer.cosmetic);
      button.hidden=owned;button.disabled=portal.busy||controls.inFlight||!!controls.pending||controls.remaining()>0;}
    if(!portal.fullAds)note.textContent='Guest play is always available. Progress uses CrazyGames Data. Ads are disabled in this Basic Launch build.';
    else if(!isAllowed())note.textContent='Guest play is always available. Finish a match, then return to the lobby for optional cosmetic rewards.';
    else if(controls.remaining()>0)note.textContent='Next optional reward in '+Math.ceil(controls.remaining()/1000)+'s. Coins and these cosmetics can also be earned by playing.';
    else note.textContent='Choose one optional reward. One completed ad grants the displayed reward. No purchase is needed.';
  }
  render();
  return { render, dispose(){clearInterval(timer);offUser();portal.setHooks({});root.remove();style.remove();blocker.remove();} };
}
// Self-hosted creator tools only. These archives are generated by the normal Render build command.
export function mountPortalExportLinks(){
  if(portalMode()||document.getElementById('cg-export035'))return;
  const host=document.querySelector('[data-pane="info"]');if(!host)return;
  const box=node('section',null,host);box.id='cg-export035';box.setAttribute('data-developer-only','');
  node('h3','CRAZYGAMES EXPORT',box);
  node('p','Download only after this build is live. Basic Launch has no ads. Full Launch requires platform approval and a separate approved build.',box);
  for(const [label,name]of [['DOWNLOAD ALL GAME SOURCES + ASSETS','PRIDA-0.38-FULL-GAME.zip'],['DOWNLOAD BASIC BUILD','PRIDA-CrazyGames-basic.zip'],['DOWNLOAD FULL BUILD (IF ENABLED)','PRIDA-CrazyGames-full.zip'],['BUILD AUDIT','crazygames-build-audit.json'],['GAMEPLAY CAPTURE DESK','creator-capture.html']]){
    const a=node('a',label,box);a.href='./'+name;if(!name.endsWith('.html'))a.download=name;else{a.target='_blank';a.rel='noopener';}a.style.display='block';a.style.margin='8px 0';
  }
}
