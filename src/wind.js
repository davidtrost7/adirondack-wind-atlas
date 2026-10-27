import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const COLORS=['#74dcf5','#80e0bf','#eee085','#f4a772','#f16d77'];
const STOPS=[0,3,7,12,20];
const COLOR_STOPS=COLORS.map(c=>new THREE.Color(c));
export function windColor(speed,out=new THREE.Color()){
  for(let i=0;i<STOPS.length-1;i++)if(speed<=STOPS[i+1])
    return out.copy(COLOR_STOPS[i]).lerp(COLOR_STOPS[i+1],clamp((speed-STOPS[i])/(STOPS[i+1]-STOPS[i]),0,1));
  return out.copy(COLOR_STOPS.at(-1));
}

// Model vectors are *predictions*, not a CFD simulation. A one-cell fallback is
// presented explicitly as uniform wind; it must not be mistaken for a 3 km grid.
export async function fetchWind(world,{signal,onProgress,quick=false,refine=false}={}){
  let lastError;
  for(const N of (quick?[1]:refine?[5,3]:[5,3,1])){
    const points=[];
    for(let j=0;j<N;j++)for(let i=0;i<N;i++){
      const x=N===1?0:(i/(N-1)-.5)*world.width;
      const z=N===1?0:(j/(N-1)-.5)*world.depth;
      points.push(world.fromScene(x,z));
    }
    for(const [endpoint,model] of [
      ['https://api.open-meteo.com/v1/gfs','hrrr_conus'],
      ['https://api.open-meteo.com/v1/forecast',null],
    ]){
      try{
        const rows=[];
        onProgress?.(`WIND · ${model?'HRRR':'BEST MATCH'} · ${N===1?'SINGLE LOCATION':N+'×'+N+' GRID'}`);
        for(let start=0;start<points.length;start+=8){
          const group=points.slice(start,start+8);
          const url=new URL(endpoint);
          for(const [key,value] of Object.entries({
            latitude:group.map(p=>p.lat.toFixed(5)).join(','),
            longitude:group.map(p=>p.lon.toFixed(5)).join(','),
            hourly:'wind_speed_10m,wind_direction_10m,wind_speed_80m,wind_direction_80m',
            wind_speed_unit:'ms',timezone:'GMT',forecast_hours:'18',
          }))url.searchParams.set(key,value);
          if(model)url.searchParams.set('models',model);
          const response=await fetch(url,{signal});
          if(!response.ok)throw Error(`Forecast HTTP ${response.status}`);
          const data=await response.json();
          if(data.error)throw Error(data.reason||'Forecast API error');
          const list=Array.isArray(data)?data:[data];
          if(list.length!==group.length)throw Error(`Expected ${group.length} forecast cells; got ${list.length}`);
          rows.push(...list);
          onProgress?.(`WIND · ${rows.length}/${points.length} LOCATIONS`);
        }
        const times=rows[0]?.hourly?.time;
        if(!Array.isArray(times)||!times.length)throw Error('No hourly forecast data');
        const levels={10:[],80:[]};
        for(const level of [10,80])for(let t=0;t<times.length;t++){
          const u=new Float32Array(points.length),v=new Float32Array(points.length);
          let valid=0;
          for(let p=0;p<rows.length;p++){
            const h=rows[p].hourly;
            if(h?.time?.[t]!==times[t])throw Error('Mismatched forecast time');
            const speed=h[`wind_speed_${level}m`]?.[t],direction=h[`wind_direction_${level}m`]?.[t];
            if(!Number.isFinite(speed)||!Number.isFinite(direction)){u[p]=NaN;v[p]=NaN;continue;}
            const angle=direction*Math.PI/180;
            // Meteorological direction is the direction wind comes FROM.
            // Scene +X = east, scene +Z = south.
            u[p]=-speed*Math.sin(angle);v[p]=speed*Math.cos(angle);valid++;
          }
          if(t===0 && valid===0)throw Error(`No ${level} m wind vectors`);
          levels[level].push({u,v});
        }
        return {N,points,pts:points,levels,times,
          model:model?'NOAA HRRR':'OPEN-METEO BEST MATCH',
          modelResolution:model?'~3 km native':'model-dependent',
          sampled:points.length,uniform:N===1};
      }catch(error){if(signal?.aborted)throw error;lastError=error;}
    }
  }
  throw Error(`No live forecast could be retrieved: ${lastError?.message||'network unavailable'}`);
}

/** Continuous, terrain-draped streamlines with animated directional dashes.
 * Geometry follows the interpolated horizontal vector field; its curvature is
 * not a forecast of microscopic ridge or valley flow. Line width is in *pixels*.
 */
export function makeWindLayer(terrain,forecast,{
  height=10, vertical=1,timeIndex=0,
  density=150,width=4.5, viewportWidth=400,viewportHeight=750,
}={}){
  const root=new THREE.Group(), world=terrain.world, N=forecast.N;
  let layerHeight=height, exaggeration=vertical, index=timeIndex;
  let active=forecast.levels[layerHeight][index];
  let mode='streamlines',playing=true, speedMean=0,speedMax=0;
  let lineDensity=density,lineWidth=width;
  let track=null,flow=null,arrows=null;
  const tColor=new THREE.Color();
  let rng=37733;
  const rand=()=>((rng=(1664525*rng+1013904223)>>>0)/4294967296);

  function fieldAt(x,z){
    if(N===1){
      const u=active.u[0],v=active.v[0];
      return Number.isFinite(u)&&Number.isFinite(v)?{u,v,speed:Math.hypot(u,v),missing:false}:
        {u:0,v:0,speed:0,missing:true};
    }
    const fx=clamp((x/world.width+.5)*(N-1),0,N-1);
    const fz=clamp((z/world.depth+.5)*(N-1),0,N-1);
    const ix=Math.min(N-2,Math.floor(fx)),iz=Math.min(N-2,Math.floor(fz));
    const dx=fx-ix,dz=fz-iz,i=iz*N+ix;
    const ids=[i,i+1,i+N,i+N+1];
    const weights=[(1-dx)*(1-dz),dx*(1-dz),(1-dx)*dz,dx*dz];
    let u=0,v=0,sum=0;
    for(let k=0;k<4;k++){
      const a=ids[k];if(!Number.isFinite(active.u[a])||!Number.isFinite(active.v[a]))continue;
      u+=active.u[a]*weights[k];v+=active.v[a]*weights[k];sum+=weights[k];
    }
    return sum>0?{u:u/sum,v:v/sum,speed:Math.hypot(u/sum,v/sum),missing:false}:
      {u:0,v:0,speed:0,missing:true};
  }
  const inside=(x,z)=>Math.abs(x)<world.width*.5&&Math.abs(z)<world.depth*.5;
  function point(x,z){return [x,(terrain.heightAt(x,z)+layerHeight+30)*exaggeration,z];}
  function trace(x,z,sign,step,steps){
    const out=[];
    for(let k=0;k<steps;k++){
      const a=fieldAt(x,z);
      if(a.missing||a.speed<.15)break;
      const midX=x+sign*a.u/a.speed*step*.5,midZ=z+sign*a.v/a.speed*step*.5;
      if(!inside(midX,midZ))break;
      const mid=fieldAt(midX,midZ);
      if(mid.missing||mid.speed<.15)break;
      const nx=x+sign*mid.u/mid.speed*step,nz=z+sign*mid.v/mid.speed*step;
      if(!inside(nx,nz))break;
      out.push({x:nx,z:nz,speed:mid.speed});x=nx;z=nz;
    }
    return out;
  }
  function remove(line){
    if(!line)return;
    root.remove(line);line.geometry.dispose();line.material.dispose();
  }
  function createLine(positions,colors,material){
    if(!positions.length)return null;
    const geo=new LineSegmentsGeometry();geo.setPositions(positions);geo.setColors(colors);
    const line=new LineSegments2(geo,material);
    line.frustumCulled=false;line.renderOrder=8;root.add(line);return line;
  }
  function rebuild(){
    remove(track);remove(flow);remove(arrows);track=flow=arrows=null;
    const seg=[],colors=[],arr=[],ac=[];
    const step=Math.min(world.width,world.depth)/130;
    const gridX=Math.max(3,Math.round(Math.sqrt(lineDensity*world.width/world.depth)));
    const gridZ=Math.max(3,Math.round(lineDensity/gridX));
    const limit=Math.max(14,Math.min(44,Math.floor(4300/step)));
    rng=37733;
    for(let iz=0;iz<gridZ;iz++)for(let ix=0;ix<gridX;ix++){
      const x=((ix+.2+rand()*.6)/gridX-.5)*world.width;
      const z=((iz+.2+rand()*.6)/gridZ-.5)*world.depth;
      const f=fieldAt(x,z);if(f.missing||f.speed<.2)continue;
      const negative=trace(x,z,-1,step,Math.floor(limit*.42)).reverse();
      const positive=trace(x,z,1,step,Math.ceil(limit*.58));
      const path=[...negative,{x,z,speed:f.speed},...positive];
      for(let j=1;j<path.length;j++){
        const a=path[j-1],b=path[j];
        seg.push(...point(a.x,a.z),...point(b.x,b.z));
        windColor(a.speed,tColor);colors.push(tColor.r,tColor.g,tColor.b);
        windColor(b.speed,tColor);colors.push(tColor.r,tColor.g,tColor.b);
      }
    }
    const baseMat=new LineMaterial({vertexColors:true,linewidth:Math.max(1,lineWidth*.46),
      transparent:true,opacity:.4,depthTest:false,depthWrite:false});
    const flowMat=new LineMaterial({vertexColors:true,linewidth:lineWidth,
      transparent:true,opacity:.96,depthTest:false,depthWrite:false,
      dashed:true,dashSize:step*.68,gapSize:step*.62,dashScale:1});
    baseMat.resolution.set(viewportWidth,viewportHeight);
    flowMat.resolution.set(viewportWidth,viewportHeight);
    track=createLine(seg,colors,baseMat);
    flow=createLine(seg,colors,flowMat);
    flow?.computeLineDistances();
    if(!track)baseMat.dispose();if(!flow)flowMat.dispose();
    const count=11,length=Math.min(world.width,world.depth)/27;
    for(let j=0;j<count;j++)for(let i=0;i<count;i++){
      const x=((i+.5)/count-.5)*world.width,z=((j+.5)/count-.5)*world.depth;
      const w=fieldAt(x,z);if(w.speed<.2||w.missing)continue;
      const dx=w.u/w.speed,dz=w.v/w.speed;
      const len=length*(.8+Math.min(w.speed/11,1.5));
      const tail={x:x-dx*len*.5,z:z-dz*len*.5};
      const tip={x:x+dx*len*.5,z:z+dz*len*.5};
      const blade=len*.26;
      const left={x:tip.x-dx*blade-dz*blade*.5,z:tip.z-dz*blade+dx*blade*.5};
      const right={x:tip.x-dx*blade+dz*blade*.5,z:tip.z-dz*blade-dx*blade*.5};
      for(const [a,b] of [[tail,tip],[tip,left],[tip,right]]){
        const ax=clamp(a.x,-world.width*.5,world.width*.5),az=clamp(a.z,-world.depth*.5,world.depth*.5);
        const bx=clamp(b.x,-world.width*.5,world.width*.5),bz=clamp(b.z,-world.depth*.5,world.depth*.5);
        arr.push(...point(ax,az),...point(bx,bz));
        windColor(w.speed,tColor);ac.push(tColor.r,tColor.g,tColor.b,tColor.r,tColor.g,tColor.b);
      }
    }
    const arrowMat=new LineMaterial({vertexColors:true,linewidth:lineWidth*.9,
      transparent:true,opacity:.95,depthTest:false,depthWrite:false});
    arrowMat.resolution.set(viewportWidth,viewportHeight);
    arrows=createLine(arr,ac,arrowMat);if(!arrows)arrowMat.dispose();
    updateVisibility();
  }
  function updateVisibility(){
    if(track)track.visible=mode==='streamlines'||mode==='both';
    if(flow)flow.visible=mode==='streamlines'||mode==='both';
    if(arrows)arrows.visible=mode==='arrows'||mode==='both';
  }
  function updateFrame(next){
    index=clamp(next,0,forecast.times.length-1);
    active=forecast.levels[layerHeight][index];
    let n=0,sum=0;speedMax=0;
    for(let i=0;i<active.u.length;i++){
      const s=Math.hypot(active.u[i],active.v[i]);
      if(Number.isFinite(s)){sum+=s;n++;speedMax=Math.max(speedMax,s);}
    }
    speedMean=n?sum/n:0;rebuild();
    return {mean:speedMean,max:speedMax,valid:n};
  }
  updateFrame(index);
  return {
    group:root,fieldAt,updateFrame,
    tick(dt,speedup){
      if(!playing||!flow?.visible)return;
      const size=Math.min(world.width,world.depth)/130;
      // Dash animation is deliberately a display device, not fluid dynamics.
      flow.material.dashOffset-=Math.min(dt,.07)*speedMean*speedup;
      if(Math.abs(flow.material.dashOffset)>size*300)
        flow.material.dashOffset%=size*1.3;
    },
    setMode(v){mode=v;updateVisibility();},
    setPlaying(v){playing=v;},
    setHeight(v){layerHeight=v;updateFrame(index);},
    setVertical(v){exaggeration=v;rebuild();},
    setWidth(v){lineWidth=v;rebuild();},
    setDensity(v){lineDensity=v;rebuild();},
    resize(w,h){viewportWidth=w;viewportHeight=h;
      for(const line of [track,flow,arrows])line?.material.resolution.set(w,h);},
    get statistics(){return {mean:speedMean,max:speedMax};},
    dispose(){remove(track);remove(flow);remove(arrows);},
  };
}
