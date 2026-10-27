import * as THREE from 'three';

// Esri World Imagery in Web Mercator; imagery is a *visual* layer, not elevation.
// UVs are calculated per UTM terrain vertex so aerial pixels remain registered
// to DEC trails even though the map surface is in EPSG:32618.
export const tileX = (lon,z) => (lon+180)/360*2**z;
export const tileY = (lat,z) => (1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z;
export function imageryPlan(world,{mobile=false}={}) {
  const maxTiles=mobile?78:110;
  let zoom=15, x0,x1,y0,y1;
  for(;zoom>=7;zoom--) {
    x0=Math.floor(tileX(world.west,zoom));x1=Math.floor(tileX(world.east,zoom));
    y0=Math.floor(tileY(world.north,zoom));y1=Math.floor(tileY(world.south,zoom));
    if((x1-x0+1)*(y1-y0+1)<=maxTiles && x1-x0+1<=12 && y1-y0+1<=12) break;
  }
  return {zoom,x0,x1,y0,y1,width:(x1-x0+1)*256,height:(y1-y0+1)*256,
    count:(x1-x0+1)*(y1-y0+1)};
}
function loadImage(url,signal){
  return new Promise((resolve,reject)=>{
    const img=new Image();img.crossOrigin='anonymous';
    let settled=false;
    const cancel=()=>finish(new DOMException('Cancelled','AbortError'));
    function finish(error){if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);
      if(error){img.src='';reject(error);}else resolve(img);}
    if(signal?.aborted){cancel();return;}
    signal?.addEventListener('abort',cancel,{once:true});
    img.onload=()=>finish();img.onerror=()=>finish(new Error('Imagery tile was blocked or unavailable'));
    img.src=url;
  });
}
export async function loadImagery(world,{mobile=false,signal,onProgress}={}){
  const plan=imageryPlan(world,{mobile});
  const canvas=document.createElement('canvas');canvas.width=plan.width;canvas.height=plan.height;
  const ctx=canvas.getContext('2d',{alpha:false});
  ctx.fillStyle='#31443c';ctx.fillRect(0,0,plan.width,plan.height);
  const keys=[];
  for(let y=plan.y0;y<=plan.y1;y++)for(let x=plan.x0;x<=plan.x1;x++)keys.push([x,y]);
  let next=0,done=0,failed=0;
  async function worker(){
    while(next<keys.length){
      if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
      const [x,y]=keys[next++];
      const urls=[`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${plan.zoom}/${y}/${x}`,
       `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${plan.zoom}/${y}/${x}`];
      let ok=false;
      for(const url of urls)try{
        const img=await loadImage(url,signal);
        ctx.drawImage(img,(x-plan.x0)*256,(y-plan.y0)*256,256,256);
        ok=true;break;
      }catch(e){if(signal?.aborted)throw e;}
      if(!ok)failed++;
      onProgress?.(`Aerial imagery ${++done}/${keys.length}${failed?' · '+failed+' unavailable':''}`);
    }
  }
  await Promise.all(Array.from({length:Math.min(6,keys.length)},()=>worker()));
  if(failed>Math.floor(keys.length*.20))throw Error(`${failed} of ${keys.length} imagery tiles unavailable (CORS, network, or service)`);
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.anisotropy=4;
  texture.minFilter=THREE.LinearMipmapLinearFilter;
  return {texture,plan,missing:failed,dispose(){texture.dispose();}};
}
export function setTerrainImagery(terrain,imagery,mode){
  if(!terrain)return;
  const geom=terrain.mesh.geometry;
  if(imagery && !geom.getAttribute('uv')){
    const positions=geom.getAttribute('position');
    const uv=new Float32Array(positions.count*2);
    const p=imagery.plan;
    for(let i=0;i<positions.count;i++){
      const {lat,lon}=terrain.world.fromScene(positions.getX(i),positions.getZ(i));
      uv[2*i]=(tileX(lon,p.zoom)-p.x0)*256/p.width;
      uv[2*i+1]=1-(tileY(lat,p.zoom)-p.y0)*256/p.height;
    }
    geom.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  }
  const original=terrain.mesh.material;
  if(!imagery||mode==='relief'){
    terrain.mesh.material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0,side:THREE.DoubleSide});
  }else{
    terrain.mesh.material=new THREE.MeshStandardMaterial({map:imagery.texture,vertexColors:mode==='hybrid',roughness:1,metalness:0,side:THREE.DoubleSide});
  }
  original.dispose();
  if(terrain.contours){
    terrain.contours.material.color.set(mode==='relief'||!imagery?0x183533:0xffe2a8);
    terrain.contours.material.opacity=mode==='relief'||!imagery?.50:.65;
  }
}
