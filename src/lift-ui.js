// Small floor selector using the application's existing modal/pause/focus handling.
export function buildLiftPanel(lift,onChoose,onClose) {
  let panel=document.getElementById('liftPanel033');
  if(!panel) {
    const style=document.createElement('style');style.textContent='#liftPanel033{z-index:65;padding:12px}#liftPanel033>.modal-card{width:min(420px,94vw);max-height:86dvh;overflow:auto;padding:20px;touch-action:pan-y}#liftPanel033 header{display:flex;align-items:center;justify-content:space-between;gap:12px}#liftPanel033 h2{font-size:26px;margin:8px 0}#liftClose033{min-width:42px;min-height:42px;background:#365451;border-radius:4px;font-size:22px}#liftFloorGrid033{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:18px 0}#liftFloorGrid033 button{min-height:58px;margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:22px}#liftFloorGrid033 button small{font-size:9px;letter-spacing:1px}#liftFloorGrid033 button[aria-current="true"]{outline:2px solid #a5dac4}#liftNote033{font-size:12px;line-height:1.5;color:#c4d1ce}';document.head.append(style);
    panel=document.createElement('section');panel.id='liftPanel033';panel.className='modal hidden';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','liftTitle033');
    panel.innerHTML='<div class="modal-card"><header><div><span>BUILDING / LIFT</span><h2 id="liftTitle033">SELECT FLOOR</h2></div><button id="liftClose033" type="button" aria-label="Close floor selector">×</button></header><div id="liftFloorGrid033"></div><p id="liftNote033">Stand fully inside the cabin. The doors will not close while someone is in the doorway.</p></div>';document.body.append(panel);
  }
  panel.querySelector('#liftClose033').onclick=onClose;
  const grid=panel.querySelector('#liftFloorGrid033');grid.replaceChildren();
  for(let k=0;k<lift.stops.length;k++) {
    const button=document.createElement('button');button.type='button';button.className='secondary';button.setAttribute('aria-current',String(k===lift.floor));
    const text=document.createElement('b');text.textContent=k===0?'G':String(k);const note=document.createElement('small');note.textContent=k===lift.floor?'CURRENT':'FLOOR';button.append(text,note);
    button.onclick=()=>onChoose(k);grid.append(button);
  }
  return panel;
}
