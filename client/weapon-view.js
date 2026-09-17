// Pure per-weapon camera/placement calculation, shared by production and tests.
// At settled ADS, the authored sight point is exactly on the camera centre ray.
export function weaponViewPose({weapon,metadata,scale=.82,ads=0,kick=0,reload=0,sprint=false,sway=0,bob=0,baseFov=80}){
 const pistol=weapon.category==='Pistol',knife=weapon.category==='Melee';
 // A knife has neither sights nor a reloadable firearm mechanism.
 const aim=knife?0:Math.max(0,Math.min(1,ads)),curve=knife?0:Math.sin(Math.max(0,Math.min(1,reload))*Math.PI);
 const x=(pistol?.205:knife?.26:.255)*(1-aim)-(metadata.sightX??0)*scale*aim+sway;
 const y=-(pistol?.19:.225)*(1-aim)-(metadata.sightHeight??.1)*scale*aim-bob*.6-curve*(pistol?.14:.18);
 const z=(pistol?-.57:knife?-.60:-.64)+kick*.65;
 const target=Math.min(baseFov,Math.max(20,weapon.adsFov??baseFov-18));
 return {position:[x,y,z],rotation:[kick*.5+curve*.38+(sprint?.2:0),curve*.15+(sprint?-.18:0),-.022*(1-aim)-curve*(pistol?.65:1)+(sprint?-.25:0)],worldFov:baseFov+(target-baseFov)*aim,viewFov:72-12*aim,scoped:weapon.category==='Sniper rifle'&&aim>.85};
}
