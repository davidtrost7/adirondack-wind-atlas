// New York DEC hiking-trail geometry. Decoded coordinates are converted to the
// atlas's WGS84 / UTM 18N metre frame, then clipped to the displayed scene.
// Features are MAPPED SEGMENTS, not verified itineraries or closure notices.

const PRIMARY = 'https://gisservices.dec.ny.gov/arcgis/rest/services/dil/dil_trails/MapServer/2/query';
const FALLBACK = 'https://services6.arcgis.com/DZHaqZm9cxOD4CWM/ArcGIS/rest/services/DEC_Trails/FeatureServer/1/query';
const METRES_PER_MILE = 1609.344;
const MAX_TRAILS = 6000;
const PAGE_SIZE = 700;

function clipSegment(a, b, halfWidth, halfDepth) {
  // Liang-Barsky clip in the X/Z projected plane.
  const dx = b.x-a.x, dz = b.z-a.z;
  const p = [-dx, dx, -dz, dz];
  const q = [a.x+halfWidth, halfWidth-a.x, a.z+halfDepth, halfDepth-a.z];
  let t0 = 0, t1 = 1;
  for (let i=0;i<4;i++) {
    if(Math.abs(p[i]) < 1e-12) { if(q[i]<0)return null;continue; }
    const t=q[i]/p[i];
    if(p[i]<0)t0=Math.max(t0,t);else t1=Math.min(t1,t);
    if(t0>t1)return null;
  }
  return [{x:a.x+dx*t0,z:a.z+dz*t0},{x:a.x+dx*t1,z:a.z+dz*t1}];
}

function normalizedMarker(value) {
  const s=String(value || '').toLowerCase();
  if(s.includes('blue'))return 'blue';
  if(s.includes('red'))return 'red';
  if(s.includes('yellow'))return 'yellow';
  return 'unmarked';
}

export function parseDECTrails(collection, world) {
  if(collection?.type!=='FeatureCollection'||!Array.isArray(collection.features))throw Error('Unexpected DEC GeoJSON payload');
  const trails=[];
  const maxX=world.width/2, maxZ=world.depth/2;
  for(const feature of collection.features) {
    const geometry=feature.geometry;
    const lines=geometry?.type==='LineString'?[geometry.coordinates]:geometry?.type==='MultiLineString'?geometry.coordinates:[];
    if(!Array.isArray(lines)||!lines.length)continue;
    const props=feature.properties || {};
    const paths=[];
    let distance=0;
    for(const line of lines) {
      if(!Array.isArray(line)||line.length<2)continue;
      let path=[];
      let prev=null;
      for(const coordinate of line) {
        if(!Array.isArray(coordinate)||!Number.isFinite(coordinate[0])||!Number.isFinite(coordinate[1])){prev=null;continue;}
        const point=world.toScene(coordinate[1],coordinate[0]);
        if(prev) {
          const clipped=clipSegment(prev,point,maxX,maxZ);
          if(clipped) {
            const [start,end]=clipped;
            const len=Math.hypot(end.x-start.x,end.z-start.z);
            if(len>.001){
              if(path.length && Math.hypot(path.at(-1).x-start.x,path.at(-1).z-start.z)>.5){paths.push(path);path=[];}
              if(!path.length)path.push(start);
              path.push(end);
              distance+=len;
            }
          } else if(path.length){ paths.push(path);path=[]; }
        }
        prev=point;
      }
      if(path.length>1)paths.push(path);
    }
    if(!paths.length)continue;
    const name=[props.SLT_NAME,props.NAME,props.FACILITY]
      .map(v=>String(v||'').trim()).find(s=>s && !/^(null|unknown|n\/a|unnamed)$/i.test(s)) || 'Unnamed DEC trail';
    const id=String(props.OBJECTID ?? feature.id ?? trails.length);
    const marker=normalizedMarker(props.MARKER);
    trails.push({id,name,marker,paths,distance,sourceMiles:Number(props.MILES)||null});
  }
  return trails;
}

function buildQuery(world, offset) {
  return new URLSearchParams({
    f:'geojson',where:'1=1',
    geometry:JSON.stringify({xmin:world.eMin-10,ymin:world.nMin-10,xmax:world.eMax+10,ymax:world.nMax+10,spatialReference:{wkid:26918}}),
    geometryType:'esriGeometryEnvelope',inSR:'26918',outSR:'4326',
    spatialRel:'esriSpatialRelIntersects',
    outFields:'OBJECTID,NAME,SLT_NAME,FACILITY,MARKER,MILES',
    returnGeometry:'true',orderByFields:'OBJECTID ASC',
    resultOffset:String(offset),resultRecordCount:String(PAGE_SIZE),
    geometryPrecision:'6',
  });
}

export async function loadDECTrails(world,{signal,onProgress}={}) {
  // Do not download the entire state's recreation dataset for a regional view.
  if(world.width>125000||world.depth>125000) {
    return {trails:[],source:'DEC',limited:true,note:'Zoom to a smaller region to load individual trails.'};
  }
  let error;
  for(const endpoint of [PRIMARY,FALLBACK]) {
    try {
      const collected=[];
      const seen=new Set();
      for(let offset=0;offset<MAX_TRAILS;offset+=PAGE_SIZE) {
        if(signal?.aborted)throw new DOMException('Aborted','AbortError');
        onProgress?.(`Loading DEC trails · ${offset} records checked`);
        const response=await fetch(`${endpoint}?${buildQuery(world,offset)}`,{signal});
        if(!response.ok)throw Error(`DEC trail request HTTP ${response.status}`);
        const payload=await response.json();
        if(payload.error)throw Error(payload.error.message||'DEC trail service error');
        if(payload.type!=='FeatureCollection')throw Error('DEC endpoint did not return GeoJSON');
        for(const trail of parseDECTrails(payload,world)) {
          if(!seen.has(trail.id)) {seen.add(trail.id);collected.push(trail);}
        }
        const count=payload.features.length;
        if(count<PAGE_SIZE) {
          onProgress?.(`${collected.length} mapped DEC trail segments`);
          return {trails:collected,source:'NYS DEC',limited:false};
        }
      }
      return {trails:collected,source:'NYS DEC',limited:true,note:`More than ${MAX_TRAILS} DEC records intersect this view. Narrow the region for complete trails.`};
    } catch(e) {
      if(signal?.aborted)throw e;
      error=e;
    }
  }
  throw Error(`DEC trail data unavailable: ${error?.message||'network error'}`);
}

export function trailDistanceText(metres,unit='mi') {
  return unit==='km'?`${(metres/1000).toFixed(2)} km`:`${(metres/METRES_PER_MILE).toFixed(2)} mi`;
}

// DEM-based profile is an approximation for the DISPLAYED TRAIL FRAGMENT only.
// Elevation samples depend on the terrain mesh's effective grid resolution.
export function trailProfile(trail,terrain,{sampleSpacing=45}={}) {
  let min=Infinity,max=-Infinity,gain=0,loss=0,points=[];
  for(const path of trail.paths) {
    if(path.length<2)continue;
    const samples=[];
    for(let i=1;i<path.length;i++) {
      const a=path[i-1],b=path[i];
      const d=Math.hypot(b.x-a.x,b.z-a.z);
      const steps=Math.max(1,Math.ceil(d/sampleSpacing));
      for(let k=(i===1?0:1);k<=steps;k++) {
        const x=a.x+(b.x-a.x)*k/steps,z=a.z+(b.z-a.z)*k/steps;
        samples.push(terrain.heightAt(x,z));
      }
    }
    if(!samples.length)continue;
    const smooth=samples.map((_,i)=>(samples[Math.max(0,i-1)]+samples[i]+samples[Math.min(samples.length-1,i+1)])/3);
    for(let i=0;i<smooth.length;i++) {
      const h=smooth[i];
      min=Math.min(min,h);max=Math.max(max,h);
      if(i){const delta=h-smooth[i-1];if(delta>1.5)gain+=delta;else if(delta< -1.5)loss-=delta;}
    }
    points.push(...smooth);
  }
  return {min:Number.isFinite(min)?min:0,max:Number.isFinite(max)?max:0,gain,loss,sampleCount:points.length};
}

export function nearestTrail(trails,x,z,maxDistance) {
  let best=null, distance=maxDistance;
  for(const trail of trails)for(const path of trail.paths)for(let i=1;i<path.length;i++) {
    const a=path[i-1],b=path[i];
    // Segment AABB distance is a cheap rejection for most of the map.
    if(x<Math.min(a.x,b.x)-distance||x>Math.max(a.x,b.x)+distance||
       z<Math.min(a.z,b.z)-distance||z>Math.max(a.z,b.z)+distance)continue;
    const dx=b.x-a.x,dz=b.z-a.z,len2=dx*dx+dz*dz;
    const t=len2?Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/len2)):0;
    const d=Math.hypot(x-a.x-dx*t,z-a.z-dz*t);
    if(d<distance) {best=trail;distance=d;}
  }
  return best;
}

export function trailGPX(trail,world) {
  const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  let xml='<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Adirondack Wind Atlas" xmlns="http://www.topografix.com/GPX/1/1">\n';
  xml+=`<metadata><name>${esc(trail.name)} — DEC mapped segment</name><desc>Mapped DEC trail fragment. Not a verified route; check closures and conditions.</desc></metadata>\n`;
  for(const path of trail.paths) {
    xml+=`<trk><name>${esc(trail.name)}</name><trkseg>\n`;
    for(const pt of path) {
      const {lat,lon}=world.fromScene(pt.x,pt.z);
      xml+=`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"/>\n`;
    }
    xml+='</trkseg></trk>\n';
  }
  return xml+'</gpx>\n';
}

// DEC trailheads are separate point features from the trail lines. They do not
// necessarily identify parking, public vehicle access, or permitted entry.
export async function loadTrailheads(world,{signal}={}) {
  if(world.width>125000||world.depth>125000)return [];
  const endpoint='https://gisservices.dec.ny.gov/arcgis/rest/services/dec_backcountry_features/MapServer/2/query';
  const result=[];
  for(let offset=0;offset<2000;offset+=500){
    const params=new URLSearchParams({
      f:'geojson',where:'1=1',
      geometry:JSON.stringify({xmin:world.eMin,ymin:world.nMin,xmax:world.eMax,ymax:world.nMax,spatialReference:{wkid:26918}}),
      geometryType:'esriGeometryEnvelope',inSR:'26918',outSR:'4326',
      spatialRel:'esriSpatialRelIntersects',outFields:'OBJECTID,FACILITY,DESCRIPTION,PUBLIC_USE',
      returnGeometry:'true',orderByFields:'OBJECTID ASC',resultOffset:String(offset),resultRecordCount:'500',
    });
    const response=await fetch(`${endpoint}?${params}`,{signal});
    if(!response.ok)throw Error(`DEC trailhead request HTTP ${response.status}`);
    const payload=await response.json();
    if(payload.error)throw Error(payload.error.message||'Trailhead GIS service error');
    if(payload.type!=='FeatureCollection'||!Array.isArray(payload.features))throw Error('Invalid DEC trailhead GeoJSON');
    for(const feature of payload.features){
      const p=feature.geometry?.coordinates;
      if(feature.geometry?.type!=='Point'||!Array.isArray(p)||!Number.isFinite(p[0])||!Number.isFinite(p[1]))continue;
      const pos=world.toScene(p[1],p[0]);
      if(Math.abs(pos.x)>world.width/2||Math.abs(pos.z)>world.depth/2)continue;
      result.push({id:String(feature.properties?.OBJECTID??result.length),name:String(feature.properties?.FACILITY||'DEC mapped trailhead'),
        description:feature.properties?.DESCRIPTION||'',lat:p[1],lon:p[0],x:pos.x,z:pos.z});
    }
    if(payload.features.length<500)break;
  }
  return result;
}
