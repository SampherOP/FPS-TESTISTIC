// FOUNDRY: an original three-lane, 72 x 64 metre training compound.
const box = (id,x,z,w,d,h,kind='concrete',y=0) => ({id,x,y,z,w,d,h,kind});
export const MAP = Object.freeze({
  id:'foundry', name:'FOUNDRY', subtitle:'URBAN TRAINING COMPLEX', width:72, depth:64,
  obstacles:[
    box('west-workshop',-26,-17,16,14,7.6,'building'),
    box('east-workshop',26,17,16,14,7.6,'building'),
    box('west-office',-27,18,14,14,6.2,'building'),
    box('east-office',27,-18,14,14,6.2,'building'),
    box('west-relay',-15,0,6,13,4.3,'relay'),
    box('east-relay',15,0,6,13,4.3,'relay'),
    box('cargo-north',-6,-14,4,9,2.7,'cargo'),
    box('cargo-south',6,14,4,9,2.7,'cargo'),
    box('cargo-west',-27,0,4.6,5.6,2.6,'cargo-dark'),
    box('cargo-east',27,0,4.6,5.6,2.6,'cargo-dark'),
    box('plaza-core',0,0,3.4,3.4,1.25,'plinth'),
    box('north-barricade',6,-5,6.2,1,1.12,'barrier'),
    box('south-barricade',-6,5,6.2,1,1.12,'barrier'),
    box('west-barricade',-9,14,1,5,1.15,'barrier'),
    box('east-barricade',9,-14,1,5,1.15,'barrier'),
    box('north-cover',6,-22,4,1,1.22,'barrier'),
    box('south-cover',-6,22,4,1,1.22,'barrier'),
    box('north-cache',-13,-26,3,3,1.6,'crate'),
    box('south-cache',13,26,3,3,1.6,'crate'),
    box('west-stair',-18,4,1.2,2.8,0.55,'crate'),
    box('east-stair',18,-4,1.2,2.8,0.55,'crate'),
    box('west-boundary',-36.5,0,1,66,4.5,'boundary'),
    box('east-boundary',36.5,0,1,66,4.5,'boundary'),
    box('north-boundary',0,-32.5,74,1,4.5,'boundary'),
    box('south-boundary',0,32.5,74,1,4.5,'boundary')
  ],
  spawns:[
    {x:0,z:28,team:0,yaw:0},{x:-9,z:28,team:0,yaw:0},{x:9,z:29,team:0,yaw:0},{x:-16,z:26,team:0,yaw:0},
    {x:0,z:-28,team:1,yaw:Math.PI},{x:9,z:-28,team:1,yaw:Math.PI},{x:-9,z:-29,team:1,yaw:Math.PI},{x:16,z:-26,team:1,yaw:Math.PI},
    {x:-32,z:7,team:2,yaw:Math.PI/2},{x:32,z:-7,team:2,yaw:-Math.PI/2},{x:-5,z:9,team:2,yaw:Math.PI},{x:5,z:-9,team:2,yaw:0}
  ],
  objectives:[{id:'A',x:0,z:23,radius:4.5},{id:'B',x:0,z:0,radius:5.6},{id:'C',x:0,z:-23,radius:4.5}],
  supplies:[{x:-22,z:7},{x:22,z:-7},{x:0,z:14},{x:0,z:-14}]
});
export function bounds(b) {
  return {minX:b.x-b.w/2,maxX:b.x+b.w/2,minY:b.y,maxY:b.y+b.h,minZ:b.z-b.d/2,maxZ:b.z+b.d/2};
}
export const COLLIDERS = MAP.obstacles.map(bounds);
