// Procedural engine and mechanical reports. One shared engine voice; no external audio downloads.
const voices=new WeakMap();
export function engineSound(context,v,on) {
  if(!context)return;let voice=voices.get(context);
  if(!voice){const gain=context.createGain(),filter=context.createBiquadFilter(),a=context.createOscillator(),b=context.createOscillator();
    filter.type='lowpass';filter.frequency.value=650;gain.gain.value=0;a.type='sawtooth';b.type='triangle';a.connect(filter);b.connect(filter);filter.connect(gain).connect(context.destination);a.start();b.start();voice={gain,filter,a,b};voices.set(context,voice);}
  const level=on&&v?.hp>0?Math.min(.024,.006+(v.engine||0)*.016):0,t=context.currentTime;
  const f=v?.kind==='plane'?62+(v.engine||0)*105:v?.kind==='tank'?34+Math.abs(v.speed||0)*2:42+Math.abs(v?.speed||0)*4.5;
  // Bound the audio automation timeline and update at 20 Hz, not every rendering frame.
  if((voice.level>0)===(level>0) && t-(voice.lastAt||0)<.05)return;
  voice.lastAt=t;voice.level=level;
  for(const param of [voice.a.frequency,voice.b.frequency,voice.gain.gain,voice.filter.frequency])param.cancelScheduledValues(t);
  voice.a.frequency.setTargetAtTime(f,t,.13);voice.b.frequency.setTargetAtTime(f*1.012,t,.13);voice.gain.gain.setTargetAtTime(level,t,.14);
  voice.filter.frequency.setTargetAtTime(v?.kind==='plane'?1250:v?.kind==='tank'?370:650,t,.15);
}
export function vehicleReport(context,e,p,on) {
  if(!context||!on||!p||e.type!=='vehicle-shot')return;
  const distance=Math.hypot(e.x-p.x,e.y-p.y,e.z-p.z);if(distance>90)return;
  if(e.kind==='rocket'){rocketReport(context,distance);return;}
  const t=context.currentTime,o=context.createOscillator(),filter=context.createBiquadFilter(),gain=context.createGain(),heavy=e.kind==='cannon';
  o.type=heavy?'sawtooth':'triangle';o.frequency.setValueAtTime(heavy?94:230,t);o.frequency.exponentialRampToValueAtTime(heavy?28:70,t+.12);
  filter.type='lowpass';filter.frequency.value=heavy?650:1900;
  gain.gain.setValueAtTime(.001,t);gain.gain.exponentialRampToValueAtTime((heavy?.08:.025)/(1+distance*.06),t+.006);gain.gain.exponentialRampToValueAtTime(.0001,t+(heavy?.34:.09));
  o.connect(filter).connect(gain).connect(context.destination);o.start(t);o.stop(t+.45);o.onended=()=>{o.disconnect();filter.disconnect();gain.disconnect();};
}

// Short filtered motor hiss; releases audio nodes on completion and limits overlapping launch voices.
const missileVoices=new WeakMap();
function rocketReport(context,distance) {
  const active=missileVoices.get(context)||0;if(active>=8)return;missileVoices.set(context,active+1);
  const t=context.currentTime,o=context.createOscillator(),filter=context.createBiquadFilter(),gain=context.createGain();
  o.type='sawtooth';o.frequency.setValueAtTime(165,t);o.frequency.exponentialRampToValueAtTime(48,t+.34);
  filter.type='bandpass';filter.Q.value=.5;filter.frequency.setValueAtTime(1600,t);filter.frequency.exponentialRampToValueAtTime(240,t+.36);
  gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(.055/(1+distance*.06),t+.018);gain.gain.exponentialRampToValueAtTime(.0001,t+.42);
  o.connect(filter).connect(gain).connect(context.destination);o.onended=()=>{o.disconnect();filter.disconnect();gain.disconnect();missileVoices.set(context,Math.max(0,(missileVoices.get(context)||1)-1));};
  o.start(t);o.stop(t+.44);
}
