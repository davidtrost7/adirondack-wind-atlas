// OSM natural=peak nodes provide a richer set of summit names than nine hand-
// picked mountains. Offline fallback names are retained by the caller.
export function overpassQuery(bounds){
  const {south,west,north,east}=bounds;
  return `[out:json][timeout:25];node["natural"="peak"]["name"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});out body;`;
}
export function parsePeaks(data,bounds){
  if(!Array.isArray(data?.elements))throw Error('Invalid OpenStreetMap peak response');
  const seen=new Set(),out=[];
  for(const p of data.elements){
    const name=String(p.tags?.name||'').trim();
    if(!name||!Number.isFinite(p.lat)||!Number.isFinite(p.lon))continue;
    if(p.lat<bounds.south||p.lat>bounds.north||p.lon<bounds.west||p.lon>bounds.east)continue;
    const key=`${name.toLowerCase()}-${p.lat.toFixed(3)}-${p.lon.toFixed(3)}`;
    if(seen.has(key))continue;seen.add(key);
    out.push({name:name.toUpperCase(),lat:p.lat,lon:p.lon,elevation:Number.parseFloat(p.tags.ele)||null,
      importance: /^(mount|mt\.?|.*mountain|.*peak)$/i.test(name)?1:0});
  }
  return out.slice(0,1200);
}
export async function loadPeaks(bounds,{signal}={}){
  // Large extents can include thousands of features; require zoomed-in study area.
  if((bounds.north-bounds.south)>.6||(bounds.east-bounds.west)>.85)return {peaks:[],limited:true};
  const query=overpassQuery(bounds);
  let err;
  for(const host of ['https://overpass.private.coffee/api/interpreter','https://overpass-api.de/api/interpreter']){
    try{
      const url=`${host}?data=${encodeURIComponent(query)}`;
      const r=await fetch(url,{signal});
      if(!r.ok)throw Error(`HTTP ${r.status}`);
      return {peaks:parsePeaks(await r.json(),bounds),limited:false};
    }catch(e){if(signal?.aborted)throw e;err=e;}
  }
  throw Error(`OSM summit query unavailable: ${err?.message}`);
}
