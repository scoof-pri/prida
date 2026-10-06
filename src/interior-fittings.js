// Metre-based embellishments for the existing furniture. Decorative attachments inherit furniture lifetime.
export function furnitureFittings(d) {
  const rot=d.rot||0,c=Math.cos(rot),s=Math.sin(rot),out=[];
  const add=(kind,x,y,z,w,h,depth,angle=rot)=>out.push({kind,x:d.x+c*x+s*z,y:d.y+y,z:d.z-s*x+c*z,w,h,d:depth,rot:angle,decor:d.id,building:d.building,storey:d.storey||0});
  if(d.model==='desk') {
    add('keyboard',0,.798,.19,.46,.024,.16);
    for(let k=0;k<4;k++)add('keys',0,.813,.135+k*.035,.40,.008,.022);
    add('mouse',.38,.800,.19,.065,.033,.105);
    add('paper',-.49,.790,-.08,.21,.005,.26);
  } else if(d.model==='sink') {
    add('mirror',0,1.40,-.26,.55,.68,.015);
    for(const x of [-.285,.285])add('metal',x,1.325,-.25,.022,.85,.030);
    for(const y of [1.048,1.752])add('metal',0,y,-.25,.55,.022,.03);
    add('ceramic',.16,.905,.035,.065,.07,.065);
  } else if(d.model==='kitchen-cabinet') {
    add('ceramic',.13,.969,.04,.11,.088,.11);
    add('oak',-.18,.931,.08,.24,.010,.20);
  } else if(d.model==='side-table') {
    add('paper',.20,.561,0,.18,.020,.22);
  }
  return out;
}
