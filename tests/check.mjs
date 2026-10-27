import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {toUTM,fromUTM,boundsToWorld} from '../src/geo.js';

const locations=[ [44.1126,-73.9237],[44.3659,-73.9027],[42.92,-73.255],[45.045,-75.57] ];
for(const [lat,lon] of locations){
  const p=toUTM(lat,lon), q=fromUTM(p.east,p.north);
  assert.ok(Math.abs(q.lat-lat)<1e-7 && Math.abs(q.lon-lon)<1e-7, 'WGS84/UTM round-trip failed');
}
const world=boundsToWorld({south:43.975,north:44.295,west:-74.205,east:-73.650});
assert.ok(world.width>44000&&world.width<47000,'High Peaks width should be ~45 km');
assert.ok(world.depth>35000&&world.depth<38000,'High Peaks length should be ~36 km');
const testPt=world.toScene(44.1126,-73.9237);
const unprojected=world.fromScene(testPt.x,testPt.z);
assert.ok(Math.abs(unprojected.lat-44.1126)<1e-7);

// Wind parsing tests use a minimal Three.js Color stub. The rendering addons
// are deliberately excluded from the data-only unit test.
class Color {constructor(v){this.value=v;}copy(v){this.value=v.value;return this;}lerp(){return this;}set(v){this.value=v;return this;}}
globalThis.THREE_TEST={Color};
const source=(await readFile(new URL('../src/wind.js',import.meta.url),'utf8'))
  .replace(/^import .* from 'three.*';$/gm,'');
const {fetchWind}=await import('data:text/javascript,'+encodeURIComponent('const THREE=globalThis.THREE_TEST;\n'+source));
const when=['2026-10-27T13:00','2026-10-27T14:00'];
const hourly={time:when, wind_speed_10m:[6,6],wind_direction_10m:[270,270],
              wind_speed_80m:[10,10],wind_direction_80m:[180,180]};
let calls=0;
globalThis.fetch=async url=>{
  calls++;
  const count=new URL(url).searchParams.get('latitude').split(',').length;
  return {ok:true,json:async()=>count===1?{hourly}:Array.from({length:count},()=>({hourly}))};
};
const result=await fetchWind(world);
assert.equal(result.model,'NOAA HRRR');
assert.equal(result.sampled,25);
assert.equal(result.N,5);
assert.equal(result.levels[10].length,2);
assert.ok(Math.abs(result.levels[10][0].u[0]-6)<0.0001);
assert.ok(Math.abs(result.levels[10][0].v[0])<0.0001);
assert.ok(Math.abs(result.levels[80][0].u[0])<0.0001);
assert.ok(Math.abs(result.levels[80][0].v[0]+10)<0.0001);
assert.ok(calls>=4);
const quick=await fetchWind(world,{quick:true});
assert.equal(quick.N,1);
assert.equal(quick.uniform,true);
const spatial=await fetchWind(world,{refine:true});
assert.equal(spatial.N,5);
// If the multi-point calls fail, an explicit single-point fallback is allowed;
// it must be labelled uniform, not misrepresented as a gridded forecast.
globalThis.fetch=async url=>{
  const count=new URL(url).searchParams.get('latitude').split(',').length;
  if(count>1)return {ok:false,status:429,json:async()=>({})};
  return {ok:true,json:async()=>({hourly})};
};
const fallback=await fetchWind(world);
assert.equal(fallback.N,1);
assert.equal(fallback.uniform,true);
assert.equal(fallback.sampled,1);
console.log('PASS: WGS84/UTM scale, HRRR vectors, batched samples and honest single-point fallback');
