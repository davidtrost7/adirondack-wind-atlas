// OSM natural=peak nodes provide a richer set of summit names than nine hand-
// picked mountains. Offline fallback names are retained by the caller.
export function overpassQuery(bounds){
  const {south,west,north,east}=bounds;
  const box=`(${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)})`;
  return `[out:json][timeout:25];(node["natural"~"peak|hill"]["name"]${box};way["natural"~"peak|hill"]["name"]${box};);out center;`;
}
export function parsePeaks(data,bounds){
  if(!Array.isArray(data?.elements))throw Error('Invalid OpenStreetMap peak response');
  const seen=new Set(),out=[];
  for(const p of data.elements){
    const name=String(p.tags?.name||'').trim();
    const lat=p.lat??p.center?.lat,lon=p.lon??p.center?.lon;
    if(!name||!Number.isFinite(lat)||!Number.isFinite(lon))continue;
    if(lat<bounds.south||lat>bounds.north||lon<bounds.west||lon>bounds.east)continue;
    const key=`${name.toLowerCase()}-${lat.toFixed(3)}-${lon.toFixed(3)}`;
    if(seen.has(key))continue;seen.add(key);
    out.push({name:name.toUpperCase(),lat,lon,elevation:Number.parseFloat(p.tags.ele)||null,
      importance: /^(mount|mt\.?|.*mountain|.*peak)$/i.test(name)?1:0});
  }
  return out.slice(0,1200);
}
export async function loadPeaks(bounds,{signal}={}){
  // Large extents can include thousands of features; require zoomed-in study area.
  if((bounds.north-bounds.south)>.6||(bounds.east-bounds.west)>.85)return {peaks:[],limited:true};
  const query=overpassQuery(bounds);
  let err;
  for(const host of ['https://overpass.private.coffee/api/interpreter','https://lz4.overpass-api.de/api/interpreter','https://overpass-api.de/api/interpreter']){
    try{
      const url=`${host}?data=${encodeURIComponent(query)}`;
      const r=await fetch(url,{signal});
      if(!r.ok)throw Error(`HTTP ${r.status}`);
      return {peaks:parsePeaks(await r.json(),bounds),limited:false};
    }catch(e){if(signal?.aborted)throw e;err=e;}
  }
  throw Error(`OSM summit query unavailable: ${err?.message}`);
}
