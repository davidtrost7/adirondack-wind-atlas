import assert from 'node:assert/strict';
import {boundsToWorld} from '../src/geo.js';
import {parseDECTrails, nearestTrail,trailGPX,trailDistanceText,trailProfile,loadDECTrails,loadTrailheads} from '../src/trails.js';

const world=boundsToWorld({south:44.035,north:44.225,west:-74.065,east:-73.805});
const insideA=[-73.940,44.112],insideB=[-73.929,44.123];
const sample={type:'FeatureCollection',features:[
  {type:'Feature',properties:{OBJECTID:42,NAME:'Mount Marcy Test Trail',MARKER:'Blue',MILES:4.0},geometry:{type:'LineString',coordinates:[insideA,insideB]}},
  {type:'Feature',properties:{OBJECTID:43,SLT_NAME:'Bounds Crossing',MARKER:'Yellow'},geometry:{type:'MultiLineString',coordinates:[[
    [-74.17,44.12],[-73.92,44.12],[-73.68,44.12]
  ]]}},
]};
const trails=parseDECTrails(sample,world);
assert.equal(trails.length,2);
assert.equal(trails[0].name,'Mount Marcy Test Trail');
assert.equal(trails[0].marker,'blue');
assert.ok(trails[0].distance>1000&&trails[0].distance<2000);
assert.ok(trails[1].paths.every(path=>path.every(p=>Math.abs(p.x)<=world.width/2+1&&Math.abs(p.z)<=world.depth/2+1)),'All trail coordinates clipped to UTM map');
const mid=trails[0].paths[0][0];
assert.equal(nearestTrail(trails,mid.x,mid.z,30)?.id,'42');
assert.equal(nearestTrail(trails,mid.x+100000,mid.z+100000,30),null);
const gpx=trailGPX(trails[0],world);
assert.ok(gpx.includes('lat="44.112')&&gpx.includes('lon="-73.940'));
assert.ok(gpx.includes('Mapped DEC trail fragment'));
assert.ok(trailDistanceText(1609.344).startsWith('1.00'));
const simpleTerrain={heightAt:(x,z)=>800+x/1000};
const profile=trailProfile(trails[0],simpleTerrain);
assert.ok(profile.max>profile.min);
assert.ok(profile.gain>=0&&profile.loss>=0);
const requested=[];
globalThis.fetch=async url=>{requested.push(String(url));return {ok:true,json:async()=>sample};};
const r=await loadDECTrails(world);
assert.equal(r.trails.length,2);
assert.ok(requested[0].includes('geometryType=esriGeometryEnvelope'));
assert.ok(requested[0].includes('outSR=4326'));
const headPayload={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:insideA},properties:{OBJECTID:6,FACILITY:'DEC Test Trailhead'}}]};
globalThis.fetch=async url=>({ok:true,json:async()=>headPayload});
const heads=await loadTrailheads(world);
assert.equal(heads.length,1);
assert.equal(heads[0].name,'DEC Test Trailhead');
assert.ok(Math.abs(heads[0].x)<world.width/2);
const park=boundsToWorld({south:42.920,north:45.045,west:-75.570,east:-73.255});
const limited=await loadDECTrails(park);
assert.equal(limited.limited,true);
console.log('PASS: DEC GeoJSON parsing, bounding clip, lengths, GPX, DEM profile, GIS queries, and regional budget');
