// Only accept external tank hierarchies that can actually aim both turret and barrel.
// A decorative mesh named "turret" is not sufficient: the gun must move WITH it.
export function tankPivots(root) {
  const nodes=[];root.traverse(o=>nodes.push(o));
  const turrets=nodes.filter(o=>/turret|tower.*pivot/i.test(o.name||'') && o.children?.length && !o.isSkinnedMesh);
  const candidates=turrets.sort((a,b)=>(/pivot|assembly/i.test(b.name)?1:0)-(/pivot|assembly/i.test(a.name)?1:0));
  for(const turret of candidates) {
    const descendants=[];turret.traverse(o=>{if(o!==turret)descendants.push(o);});
    const barrel=descendants.find(o=>/(cannon|gun|barrel).*(pivot|elevation)|mantlet/i.test(o.name||'') && o.children?.length)
      || descendants.find(o=>/^(cannon|main[-_ ]?gun|barrel)([-_ ]?(assembly|pivot|root))?$/i.test(o.name||'') && o.children?.length);
    if(!barrel||barrel.isSkinnedMesh)continue;
    let visibleGeometry=false;barrel.traverse(o=>{if(o.isMesh)visibleGeometry=true;});
    if(visibleGeometry)return {turret,barrelPivot:barrel};
  }
  return null;
}
export function poseTankRig(rig,worldYaw,hullYaw,elevation) {
  const yaw=Math.atan2(Math.sin(worldYaw-hullYaw),Math.cos(worldYaw-hullYaw));
  if(rig.turret)rig.turret.rotation.y=(rig.turretBase||0)+yaw;
  if(rig.barrelPivot)rig.barrelPivot.rotation.x=(rig.barrelBase||0)-elevation;
}
