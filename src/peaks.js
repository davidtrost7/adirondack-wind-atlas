// The traditional 46 Adirondack High Peaks are always available, even when
// Overpass is offline. Names follow the Adirondack Forty-Sixers list.
// Approximate WGS84 summit waypoints: https://alavigne.net/Outdoors/FeatureReports/Adirondacks/?p=gps
// Official 46 list: https://adk46er.org/peaks/
// These points are for map labels, not navigation-grade summit coordinates.
const CATALOG = [
  ['MOUNT MARCY',44.113000,-73.924000],
  ['ALGONQUIN PEAK',44.144000,-73.987000],
  ['HAYSTACK',44.106000,-73.901000],
  ['SKYLIGHT',44.099000,-73.931000],
  ['WHITEFACE',44.366000,-73.903000],
  ['DIX',44.082400,-73.786700],
  ['GRAY PEAK',44.111000,-73.935000],
  ['IROQUOIS PEAK',44.137000,-73.999000],
  ['BASIN',44.121000,-73.887000],
  ['GOTHICS',44.128000,-73.858000],
  ['COLDEN',44.127000,-73.960000],
  ['GIANT',44.161300,-73.720400],
  ['NIPPLETOP',44.089000,-73.816000],
  ['SANTANONI',44.082000,-74.131000],
  ['REDFIELD',44.095000,-73.950000],
  ['WRIGHT PEAK',44.152000,-73.981000],
  ['SADDLEBACK',44.126000,-73.875000],
  ['PANTHER',44.098000,-74.133000],
  ['TABLETOP',44.140600,-73.916400],
  ['ROCKY PEAK RIDGE',44.154400,-73.705500],
  ['MACOMB',44.052000,-73.781000],
  ['ARMSTRONG',44.134600,-73.849700],
  ['HOUGH',44.069000,-73.778000],
  ['SEWARD',44.159800,-74.199300],
  ['MARSHALL',44.127600,-74.011800],
  ['ALLEN',44.070900,-73.939900],
  ['BIG SLIDE',44.182300,-73.870400],
  ['ESTHER',44.387200,-73.889900],
  ['UPPER WOLF JAW',44.140400,-73.845300],
  ['LOWER WOLF JAW',44.148400,-73.832600],
  ['STREET',44.179430,-74.026960],
  ['PHELPS',44.157000,-73.921000],
  ['DONALDSON',44.154000,-74.211600],
  ['SEYMOUR',44.158000,-74.172600],
  ['SAWTEETH',44.113900,-73.850400],
  ['CASCADE',44.218700,-73.860100],
  ['SOUTH DIX (CARSON)',44.060100,-73.774300],
  ['PORTER',44.212400,-73.853800],
  ['COLVIN',44.093900,-73.834300],
  ['EMMONS',44.143800,-74.214300],
  ['DIAL',44.105900,-73.796000],
  ['GRACE PEAK (EAST DIX)',44.065300,-73.757400],
  ['BLAKE PEAK',44.081300,-73.844500],
  ['CLIFF',44.103100,-73.975100],
  ['NYE',44.187200,-74.023840],
  ['COUCHSACHRAGA',44.095500,-74.160300],
];
export const HIGH_PEAKS = Object.freeze(CATALOG.map(([name,lat,lon],index)=>
  Object.freeze({name,lat,lon,importance:100-index,highPeak:true})));

export const inPeakBounds=(p,b)=>p.lat>=b.south&&p.lat<=b.north&&p.lon>=b.west&&p.lon<=b.east;
const normalized=name=>String(name).toUpperCase().replace(/\\b(MOUNT|MT|PEAK|MOUNTAIN)\\b/g,'').replace(/[^A-Z0-9]/g,'');

// Always include all of the 46er summits physically within the map footprint.
// Avoid doubling labels when OSM returns the same summit with a different spelling.
export function mergePeaks(bounds,osmPeaks=[]){
  const official=HIGH_PEAKS.filter(p=>inPeakBounds(p,bounds));
  const extras=(osmPeaks||[]).filter(p=>inPeakBounds(p,bounds)).filter(p=>
    !official.some(q=>(Math.abs(p.lat-q.lat)<0.005&&Math.abs(p.lon-q.lon)<0.005)||
      (normalized(p.name)===normalized(q.name)&&normalized(p.name)!=='')));
  return [...official,...extras];
}

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
      importance: /^(mount|mt\\.?|.*mountain|.*peak)$/i.test(name)?1:0});
  }
  return out.slice(0,1200);
}
export async function loadPeaks(bounds,{signal}={}){
  // Large extents can include thousands of features; use the verified local
  // catalog there rather than requesting an unbounded Overpass response.
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
