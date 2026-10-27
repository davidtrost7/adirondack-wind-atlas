import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { boundsToWorld, niceDistance, compassFrom } from './geo.js';
import { createTerrain } from './terrain.js';
import { fetchWind, makeWindLayer } from './wind.js';
import { loadDECTrails, trailProfile, trailDistanceText, nearestTrail, trailGPX, loadTrailheads } from './trails.js';
import { makeTrailLayer } from './trail-visual.js';
import { loadImagery, setTerrainImagery } from './imagery.js';
import { loadPeaks } from './peaks.js';

const REGIONS = {
  summit: {name:'Mount Marcy · summit close-up',south:44.076,north:44.161,west:-73.982,east:-73.867},
  pass: {name:'Avalanche Pass · close-up',south:44.111,north:44.175,west:-74.009,east:-73.929},
  marcy: { name: 'Mount Marcy + Lake Colden', south: 44.035, north: 44.225, west: -74.065, east: -73.805 },
  great: { name: 'Great Range + Keene Valley', south: 44.045, north: 44.245, west: -73.965, east: -73.690 },
  peaks: { name: 'High Peaks Wilderness', south: 43.975, north: 44.295, west: -74.205, east: -73.650 },
  northern: { name: 'Northern High Peaks', south: 44.015, north: 44.515, west: -74.345, east: -73.560 },
  park: { name: 'Adirondack Region', south: 42.920, north: 45.045, west: -75.570, east: -73.255 },
};
const SUMMITS = [
  { name: 'MOUNT MARCY', lat: 44.1126, lon: -73.9237 },
  { name: 'ALGONQUIN', lat: 44.1438, lon: -73.9867 },
  { name: 'HAYSTACK', lat: 44.1058, lon: -73.9002 },
  { name: 'GIANT', lat: 44.1613, lon: -73.7205 },
  { name: 'COLDEN', lat: 44.1269, lon: -73.9671 },
  { name: 'SKYLIGHT', lat: 44.0996, lon: -73.9300 },
  { name: 'WHITEFACE', lat: 44.3659, lon: -73.9027 },
  { name: 'CASCADE', lat: 44.2186, lon: -73.8596 },
  { name: 'GOTHICS', lat: 44.1276, lon: -73.8580 },
];
const $ = id => document.getElementById(id);
const host = $('canvas-host');
const mobileQuery = window.matchMedia('(max-width: 700px)');
// Favor a smooth, readable default on phones; full quality remains user-selectable.
if (mobileQuery.matches) $('quality').value = 'high';
$('wind-style').value = 'streamlines';
const toggleControls = $('toggle-controls');
const controlsPanel = $('controls-panel');
let activeTab='map';
function setMobileControls(open) {
  controlsPanel.classList.toggle('is-open',open);
  toggleControls.setAttribute('aria-expanded',String(open));
  toggleControls.setAttribute('aria-label',open?'Close map controls':'Open map controls');
  toggleControls.innerHTML = open ? 'CLOSE <span aria-hidden="true">×</span>' : 'CONTROLS <span aria-hidden="true">☰</span>';
  document.querySelectorAll('[data-dock]').forEach(button=>{
    const chosen=open&&button.dataset.dock===activeTab;
    button.classList.toggle('active',chosen);
    button.setAttribute('aria-pressed',String(chosen));
  });
}
function selectTab(tab,open=true){
  activeTab=tab;
  document.querySelectorAll('[data-panel]').forEach(el=>el.hidden=el.dataset.panel!==tab);
  document.querySelectorAll('.panel-tabs [data-tab]').forEach(button=>{
    const chosen=button.dataset.tab===tab;
    button.classList.toggle('active',chosen);
    button.setAttribute('aria-selected',String(chosen));
  });
  if(mobileQuery.matches)setMobileControls(open);
}
for(const button of document.querySelectorAll('.panel-tabs [data-tab]'))
  button.addEventListener('click',()=>selectTab(button.dataset.tab));
for(const button of document.querySelectorAll('[data-dock]'))
  button.addEventListener('click',()=>selectTab(button.dataset.dock,
    !(activeTab===button.dataset.dock&&controlsPanel.classList.contains('is-open'))));
selectTab('map',false);
toggleControls.addEventListener('click',()=>setMobileControls(!controlsPanel.classList.contains('is-open')));
window.addEventListener('keydown',event=>{if(event.key==='Escape')setMobileControls(false);});
mobileQuery.addEventListener('change',()=>setMobileControls(false));
const renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobileQuery.matches ? 1.45 : 2));
renderer.setSize(host.clientWidth, host.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.65;
host.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b171c');
const perspectiveCamera = new THREE.PerspectiveCamera(43, 1, 10, 1000000);
const overheadCamera = new THREE.OrthographicCamera(-10000,10000,10000,-10000,1,1000000);
overheadCamera.up.set(0,0,-1);
let camera=perspectiveCamera, controls;
let overhead=false, overheadSpan=25000, savedPerspective=null;
function installControls() {
  controls?.dispose();
  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;controls.dampingFactor=.075;
  controls.minPolarAngle=.05;controls.maxPolarAngle=Math.PI/2.012;
  controls.screenSpacePanning=true;controls.rotateSpeed=.65;
  controls.zoomSpeed=.9;controls.panSpeed=.9;
  controls.minDistance=25;
  if(overhead) {
    controls.enableRotate=false;
    controls.mouseButtons.LEFT=THREE.MOUSE.PAN;
    controls.touches.ONE=THREE.TOUCH.PAN;
    controls.touches.TWO=THREE.TOUCH.DOLLY_PAN;
  }
}
installControls();
function updateOverheadFrustum(){
  const aspect=Math.max(.1,host.clientWidth/Math.max(1,host.clientHeight));
  overheadCamera.left=-overheadSpan*aspect/2;overheadCamera.right=overheadSpan*aspect/2;
  overheadCamera.top=overheadSpan/2;overheadCamera.bottom=-overheadSpan/2;
  overheadCamera.updateProjectionMatrix();
}
function setOverhead(next){
  if(next===overhead || !terrain)return;
  if(next){savedPerspective={pos:camera.position.clone(),target:controls.target.clone()};}
  overhead=next;
  camera=overhead?overheadCamera:perspectiveCamera;
  installControls();
  if(overhead){
    camera.zoom=1;
    overheadSpan=Math.max(world.width,world.depth)*1.15;
    updateOverheadFrustum();
    const y=terrain.heightAt(0,0)*exaggeration;
    camera.up.set(0,0,-1);
    camera.position.set(0,Math.max(world.width,world.depth)*2,0);
    controls.target.set(0,y,0);
  }else if(savedPerspective){
    camera.position.copy(savedPerspective.pos);controls.target.copy(savedPerspective.target);
  }else resetView();
  camera.lookAt(controls.target);controls.update();
  $('toggle-2d').textContent=overhead?'3D VIEW':'2D VIEW';
  $('toggle-2d').classList.toggle('active',overhead);
  updateScale();
}
$('toggle-2d').addEventListener('click',()=>setOverhead(!overhead));
$('compass-reset').addEventListener('click',()=>{
  if(!terrain)return;
  if(!overhead){
    const offset=camera.position.clone().sub(controls.target);
    const radius=Math.max(25,Math.hypot(offset.x,offset.z));
    camera.position.set(controls.target.x,controls.target.y+offset.y,controls.target.z+radius);
  }else camera.up.set(0,0,-1);
  camera.lookAt(controls.target);controls.update();
  updateCompass();updatePeaks();updateContourLabels();
});
function adjustZoom(factor){
  if(!terrain)return;
  if(overhead){
    camera.zoom=THREE.MathUtils.clamp(camera.zoom*factor,.6,140);
    camera.updateProjectionMatrix();
  }else{
    const offset=camera.position.clone().sub(controls.target);
    const distance=THREE.MathUtils.clamp(offset.length()/factor,25,Math.max(world.width,world.depth)*4);
    camera.position.copy(controls.target).add(offset.normalize().multiplyScalar(distance));
  }
  controls.update();updateScale();updatePeaks();updateContourLabels();updateTrailheads();
}
$('zoom-in').addEventListener('click',()=>adjustZoom(1.7));
$('zoom-out').addEventListener('click',()=>adjustZoom(1/1.7));
const hemi = new THREE.HemisphereLight(0xcce7e5, 0x162e2d, 2.65);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffebcd, 3.0);
sun.position.set(-50000, 95000, 56000);
scene.add(sun);
const fill = new THREE.DirectionalLight(0x85bdc4, .75);
fill.position.set(40000, 33000, -24000);
scene.add(fill);
const raycaster = new THREE.Raycaster();
let terrain = null, wind = null, weather = null, world = null;
let trailLayer=null, trailRecords=[], selectedTrail=null, locationOverlay=null;
let imagery=null, peakData=SUMMITS, contourEls=[];
let regionKey = 'marcy', abort = null, rebuildSerial = 0;
let windRefreshSerial=0, windAbort=null;
let exaggeration = 1, windHeight = 10, windSpeedup = 80;
let frameIndex = 0, playingTimeline = false, timelineClock = 0;
const REFRESH_INTERVAL_MS=30*60*1000;
let lastWindSuccessAt=0, lastWindAttemptAt=0, windRefreshInProgress=false;
let unitMode='imperial';
const toFeet=m=>m*3.280839895, toMiles=m=>m/1609.344;
function elevationText(m){return unitMode==='imperial'
  ? Math.round(toFeet(m)).toLocaleString()+' ft'
  : Math.round(m).toLocaleString()+' m';}
function distanceText(m){
  if(unitMode!=='imperial')return niceDistance(m);
  if(m>=804.672)return toMiles(m).toFixed(m>=16093.44?0:1)+' mi';
  return Math.round(toFeet(m)).toLocaleString()+' ft';
}
function trailLengthText(m){return unitMode==='imperial'
  ? (toMiles(m)<.1?toMiles(m).toFixed(2):toMiles(m).toFixed(1))+' mi'
  : trailDistanceText(m);}
function windSpeedText(s){return (unitMode==='imperial'?s*2.236936292:s).toFixed(1);}
function formatClock(ms){return new Intl.DateTimeFormat('en-US',
  {timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}).format(new Date(ms));}
function updateFreshness(){
  const el=$('last-updated');
  if(!lastWindSuccessAt){el.textContent='No wind forecast loaded';return;}
  const age=Date.now()-lastWindSuccessAt;
  const next=Math.max(0,Math.ceil((REFRESH_INTERVAL_MS-(Date.now()-lastWindAttemptAt))/60000));
  el.textContent=`Fetched ${formatClock(lastWindSuccessAt)} ET · ${age>REFRESH_INTERVAL_MS*1.5?'STALE · ':''}refresh ${next?'in '+next+' min':'due'}`;
}
function updateSelectedTrailStats(){
  if(!selectedTrail||!terrain)return;
  $('trail-distance').textContent=trailLengthText(selectedTrail.distance);
  const profile=trailProfile(selectedTrail,terrain);
  $('trail-gain').textContent='~'+elevationText(profile.gain);
  $('trail-elevation').textContent=elevationText(profile.min)+' – '+elevationText(profile.max);
}
function updateUnitDisplays(){
  if(world){$('extent-width').textContent=distanceText(world.width);$('extent-depth').textContent=distanceText(world.depth);}
  for(const el of contourEls)el.textContent=elevationText(Number(el.dataset.elevation));
  $('wind-unit-mean').textContent=unitMode==='imperial'?'mph':'m/s';
  $('wind-unit-max').textContent=unitMode==='imperial'?'mph':'m/s';
  const numbers=unitMode==='imperial'?['0','7','16','27','45+ mph']:['0','3','7','12','20+ m/s'];
  [...$('wind-legend').children].forEach((el,i)=>el.textContent=numbers[i]);
  for(const button of document.querySelectorAll('[data-height]'))button.textContent=
    unitMode==='imperial'?Math.round(Number(button.dataset.height)*3.28084)+' ft':button.dataset.height+' m';
  if(weather&&wind)updateTimeUI();
  if(selectedTrail&&terrain)updateSelectedTrailStats();
  if(terrain){updateScale();updateContourLabels();}
  renderTrailSearch();
}
$('units').addEventListener('change',()=>{unitMode=$('units').value;updateUnitDisplays();});
let selected = null, peakEls = [], trailheadEls=[];
let lastScaleUpdate = 0, lastMarkerUpdate=0;

function setStatus(message, kind='loading') {
  $('status').textContent = message;
  $('status-indicator').className = `dot ${kind}`;
}
function setLoading(message, visible=true) {
  $('loading-detail').textContent = message;
  $('loading-overlay').hidden = !visible;
}
function errorText(error) {return error instanceof Error ? error.message : String(error);}
function syncSize() {
  const width = host.clientWidth, height = host.clientHeight;
  if (width < 1 || height < 1) return;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobileQuery.matches ? 1.45 : 2));
  perspectiveCamera.aspect = width/height;
  perspectiveCamera.updateProjectionMatrix();
  updateOverheadFrustum();
  trailLayer?.resize(width,height);
  wind?.resize(width,height);
  renderer.setSize(width,height,false);
}
new ResizeObserver(syncSize).observe(host);
window.addEventListener('resize', syncSize);
syncSize();
function resetView() {
  if (!terrain) return;
  const span = Math.max(world.width,world.depth);
  controls.target.set(0,terrain.heightAt(0,0)*exaggeration,0);
  controls.minDistance=25;controls.maxDistance=span*4.7;
  if(overhead){
    camera.zoom=1;overheadSpan=span*1.15;
    updateOverheadFrustum();
    camera.position.set(0,span*2,0);
    camera.up.set(0,0,-1);
    camera.lookAt(controls.target);
  }else{
    camera.position.set(-world.width*.68,span*.77,world.depth*.95);
    camera.near=Math.max(.5,span/250000);
    camera.far=span*12;
    camera.updateProjectionMatrix();
  }
  controls.update();
  updateScale();
}
function releaseObjects() {
  clearPeaks();
  clearContourLabels();
  clearTrailheads();
  if(imagery){imagery.dispose();imagery=null;}
  if(trailLayer){scene.remove(trailLayer.group);trailLayer.dispose();trailLayer=null;}
  trailRecords=[];selectedTrail=null;
  $('trail-card').hidden=true;
  $('trail-results').replaceChildren();
  $('trail-count').textContent='Loading official DEC trail geometry…';
  if(locationOverlay){scene.remove(locationOverlay);disposeLocationOverlay();}

  if (wind) {scene.remove(wind.group);wind.dispose();wind=null;}
  if (terrain) {
    scene.remove(terrain.mesh,terrain.contours);
    terrain.dispose();terrain=null;
  }
  weather=null;
  $('time').disabled = true;
  $('mean-speed').textContent='—';
  $('max-speed').textContent='—';
  $('forecast-time').textContent='—';
  $('model-tag').textContent='AWAITING FORECAST';
  $('inspect').hidden=true;
  selected=null;
}
async function buildRegion() {
  const serial = ++rebuildSerial;
  abort?.abort();windAbort?.abort();
  windRefreshSerial++;
  abort = new AbortController();
  const signal = abort.signal;
  releaseObjects();
  regionKey=$('region').value;
  world=boundsToWorld(REGIONS[regionKey]);
  $('extent-width').textContent=distanceText(world.width);
  $('extent-depth').textContent=distanceText(world.depth);
  lastWindAttemptAt=Date.now();updateFreshness();
  setStatus('LOADING ELEVATION','loading');
  setLoading('Retrieving elevation tiles…');
  scene.fog = new THREE.FogExp2('#0b171c', 0.16/Math.max(world.width,world.depth));
  // Launch both operations, but do not block terrain rendering on the weather service.
  const imageryPromise=loadImagery(world,{mobile:mobileQuery.matches,signal}).then(value=>({value}),error=>({error}));
  const peaksPromise=loadPeaks(REGIONS[regionKey],{signal}).then(value=>({value}),error=>({error}));
  const trailheadsPromise=loadTrailheads(world,{signal}).then(value=>({value}),error=>({error}));
  const trailsPromise=loadDECTrails(world,{
    signal,onProgress:message=>{if(serial===rebuildSerial)$('trail-count').textContent=message;},
  }).then(value=>({value}),error=>({error}));
  const windToken=windRefreshSerial;
  const weatherPromise=fetchWind(world,{signal,quick:true,onProgress: m => {
    if(serial===rebuildSerial) $('model-tag').textContent=m;
  }}).then(value=>({value}),error=>({error}));
  try {
    const result=await createTerrain(world,{
      quality:$('quality').value,mobile:mobileQuery.matches,signal,onProgress:m=>{
        if(serial===rebuildSerial)setLoading(m);
      },
    });
    if(serial!==rebuildSerial){result.dispose();return;}
    terrain=result;
    scene.add(terrain.mesh, terrain.contours);
    terrain.setVerticalScale(exaggeration);
    terrain.contours.visible=$('contours').checked;
    peakData=SUMMITS;makePeaks();makeContourLabels();updateUnitDisplays();
    resetView();
    imageryPromise.then(outcome=>{
      if(serial!==rebuildSerial||!terrain){outcome.value?.dispose();return;}
      if(outcome.value){imagery=outcome.value;setTerrainImagery(terrain,imagery,$('basemap').value);
        $('imagery-status').textContent=`Satellite z${imagery.plan.zoom} · ${imagery.plan.count} image tiles`;
      }else $('imagery-status').textContent=`Aerial imagery unavailable · ${errorText(outcome.error)}`;
    });
    peaksPromise.then(outcome=>{
      if(serial!==rebuildSerial||!terrain)return;
      if(outcome.value?.peaks?.length){peakData=outcome.value.peaks;makePeaks();
        $('peak-status').textContent=`${peakData.length} named OSM summits in extent`;}
      else $('peak-status').textContent='Offline fallback · limited summit names';
    });
    $('model-tag').textContent=`DEM z${terrain.demZoom} · ${terrain.nx}×${terrain.nz} GRID`;
    trailheadsPromise.then(outcome=>{if(serial===rebuildSerial&&terrain&&outcome.value)makeTrailheads(outcome.value);});
    trailsPromise.then(outcome=>{
      if(serial!==rebuildSerial||!terrain)return;
      if(outcome.error){
        $('trail-count').textContent=`Trail service unavailable · ${errorText(outcome.error)}`;
        $('trail-results').replaceChildren();
      }else initializeTrails(outcome.value);
    });
    setLoading('',false);
    setStatus('TERRAIN READY · WIND LOADING','loading');
    const outcome=await weatherPromise;
    if(serial!==rebuildSerial||windToken!==windRefreshSerial)return;
    if(outcome.error) {
      setStatus('TERRAIN READY · WIND UNAVAILABLE','error');
      $('model-tag').textContent='DATA REQUEST FAILED';
      $('wind-disclaimer').textContent=`Quick forecast unavailable: ${errorText(outcome.error)}. Trying the regional grid…`;
      refineWind(serial,windToken,signal);
      return;
    }
    initializeWind(outcome.value);
    // Upgrade the quick single-location display with spatial samples when
    // available. A failed refinement leaves the labelled coarse wind visible.
    refineWind(serial,windToken,signal);
  } catch(e) {
    if(serial!==rebuildSerial || signal.aborted)return;
    setLoading('',false);
    setStatus('TERRAIN SERVICE UNAVAILABLE','error');
    $('wind-disclaimer').textContent=`Elevation download failed: ${errorText(e)}. Check connectivity, then use Refresh data.`;
    $('model-tag').textContent='DEM DOWNLOAD FAILED';
    // Avoid fabricating a terrain mesh if the source is unreachable.
  }
}
async function refineWind(regionSerial,windToken,signal){
  try{
    const refined=await fetchWind(world,{signal,refine:true,onProgress:message=>{
      if(regionSerial===rebuildSerial&&windToken===windRefreshSerial&&!wind)
        $('model-tag').textContent=message;
    }});
    if(regionSerial!==rebuildSerial||windToken!==windRefreshSerial||!terrain)return;
    if(!weather || refined.sampled>weather.sampled)initializeWind(refined);
  }catch(error){
    if(regionSerial!==rebuildSerial||windToken!==windRefreshSerial||wind)return;
    setStatus('WIND UNAVAILABLE','error');
    $('wind-disclaimer').textContent=`Wind unavailable: ${errorText(error)}. Data services may be rate-limited; try Refresh data.`;
  }
}
function initializeWind(data) {
  if(wind){scene.remove(wind.group);wind.dispose();wind=null;}
  weather=data;
  lastWindSuccessAt=Date.now();updateFreshness();
  const now=Date.now();
  frameIndex=Math.max(0,data.times.reduce((best,t,i)=>
    Math.abs(Date.parse(t+'Z')-now)<Math.abs(Date.parse(data.times[best]+'Z')-now)?i:best,0));
  wind=makeWindLayer(terrain,data,{height:windHeight,vertical:exaggeration,timeIndex:frameIndex,
    density:Number($('wind-density').value),width:Number($('wind-width').value),
    viewportWidth:host.clientWidth,viewportHeight:host.clientHeight});
  scene.add(wind.group);
  applyWindStyle();
  $('time').disabled=false;
  $('time').max=String(data.times.length-1);
  $('time').value=String(frameIndex);
  $('time-start').textContent=formatTime(data.times[0],true);
  $('time-end').textContent=formatTime(data.times.at(-1),true);
  $('model-tag').textContent=`${data.model} · ${data.N===1?'ONE FORECAST LOCATION':data.N+'×'+data.N+' LOCATIONS'}`;
  $('wind-disclaimer').textContent=data.uniform
    ? 'Uniform display from ONE forecast location; no local wind variability is resolved. Flow lines are illustrative, not ridge-scale predictions.'
    : `Forecast wind interpolated between ${data.sampled} API locations. Flow lines are illustrative; not a terrain-scale wind simulation.`;
  setStatus(data.uniform?'WIND ONLINE · COARSE PREVIEW':'TERRAIN + WIND ONLINE','online');
  updateTimeUI();
}
function formatTime(value,short=false) {
  const date=new Date(value+'Z');
  return new Intl.DateTimeFormat('en-US',{
    timeZone:'America/New_York',weekday:short?undefined:'short',
    month:short?undefined:'short',day:short?undefined:'numeric',
    hour:'numeric',minute:'2-digit',hour12:true,
  }).format(date);
}
function updateTimeUI() {
  if(!wind||!weather)return;
  wind.updateFrame(frameIndex);
  $('time').value=String(frameIndex);
  $('forecast-time').textContent=formatTime(weather.times[frameIndex]);
  $('mean-speed').textContent=windSpeedText(wind.statistics.mean);
  $('max-speed').textContent=windSpeedText(wind.statistics.max);
  updateInspection();
}
function applyWindStyle() {
  if(!wind)return;
  const v=$('wind-style').value;
  wind.setMode(v);
  wind.group.visible=v!=='none';
}
function setHeight(value) {
  windHeight=value;
  for(const button of document.querySelectorAll('[data-height]')){
    button.classList.toggle('active',Number(button.dataset.height)===value);
  }
  if(wind){wind.setHeight(value);updateTimeUI();}
}
for(const button of document.querySelectorAll('[data-height]'))
  button.addEventListener('click',()=>setHeight(Number(button.dataset.height)));
$('region').addEventListener('change',buildRegion);
$('quality').addEventListener('change',buildRegion);
$('reload-data').addEventListener('click',()=>{
  if(!terrain){buildRegion();return;}
  refreshWeather();
});
async function refreshWeather(){
  const regionSerial=rebuildSerial;
  const token=++windRefreshSerial;
  windAbort?.abort();windAbort=new AbortController();
  setStatus('REFRESHING WIND','loading');
  $('model-tag').textContent='REQUESTING WIND MODEL';
  try{
    const data=await fetchWind(world,{signal:windAbort.signal,quick:true,
      onProgress:message=>{if(regionSerial===rebuildSerial&&token===windRefreshSerial)$('model-tag').textContent=message;}});
    if(regionSerial!==rebuildSerial||token!==windRefreshSerial)return;
    initializeWind(data);
    refineWind(regionSerial,token,windAbort.signal);
  }catch(error){
    if(regionSerial!==rebuildSerial||token!==windRefreshSerial)return;
    setStatus(wind?'FORECAST STALE · REFRESH FAILED':'WIND UNAVAILABLE','error');
    $('model-tag').textContent=errorText(error);
  }
}
$('wind-style').addEventListener('change',applyWindStyle);
$('wind-width').addEventListener('input',()=>{
  $('wind-width-label').textContent=`${Number($('wind-width').value).toFixed(1)} px`;
  wind?.setWidth(Number($('wind-width').value));
});
$('wind-density').addEventListener('input',()=>{
  $('wind-density-label').textContent=$('wind-density').value+' paths';
  wind?.setDensity(Number($('wind-density').value));
});
$('basemap').addEventListener('change',()=>{
  if(terrain)setTerrainImagery(terrain,imagery,$('basemap').value);
});
$('vertical').addEventListener('input',()=>{
  exaggeration=Number($('vertical').value);
  $('vertical-label').textContent=exaggeration===1?'1.00× · TRUE SCALE':`${exaggeration.toFixed(2)}× · EXAGGERATED`;
  document.querySelector('.projection').textContent=`EPSG:32618 · VERTICAL ${exaggeration.toFixed(2)}×`;
  terrain?.setVerticalScale(exaggeration);
  wind?.setVertical(exaggeration);
  updatePeaks();updateContourLabels();
  trailLayer?.setVertical(exaggeration);
  updateLocationOverlay();
});
$('animation').addEventListener('input',()=>{
  windSpeedup=Number($('animation').value);
  $('animation-label').textContent=`${windSpeedup}×`;
});
$('contours').addEventListener('change',()=>{if(terrain)terrain.contours.visible=$('contours').checked;updateContourLabels();});
$('peaks').addEventListener('change',()=>updatePeaks());
$('show-trails').addEventListener('change',()=>trailLayer?.setVisible($('show-trails').checked));
$('trail-search').addEventListener('input',renderTrailSearch);
$('show-trailheads').addEventListener('change',updateTrailheads);
$('time').addEventListener('input',()=>{
  frameIndex=Number($('time').value);
  timelineClock=0;
  updateTimeUI();
});
$('play').addEventListener('click',()=>{
  playingTimeline=!playingTimeline;
  $('play').textContent=playingTimeline?'Ⅱ':'▶';
  $('play').setAttribute('aria-label',playingTimeline?'Pause forecast playback':'Play forecast playback');
});
$('reset-view').addEventListener('click',resetView);
$('close-inspect').addEventListener('click',()=>{selected=null;$('inspect').hidden=true;});

function clearPeaks() {for(const el of peakEls)el.remove();peakEls=[];}
function makePeaks() {
  clearPeaks();
  for(const summit of peakData) {
    const xy=world.toScene(summit.lat,summit.lon);
    if(Math.abs(xy.x)>world.width*.5||Math.abs(xy.z)>world.depth*.5)continue;
    const marker=document.createElement('div');
    marker.className='peak-marker';
    const dot=document.createElement('div');dot.className='peak-dot';
    const title=document.createElement('span');title.textContent=summit.name;
    marker.append(dot,title);host.append(marker);
    peakEls.push(marker);
    marker.dataset.x=String(xy.x);
    marker.dataset.z=String(xy.z);
    marker.dataset.importance=String(summit.importance||0);
  }
  updatePeaks();
}
function updatePeaks(){
  if(!terrain)return;
  const visible=$('peaks').checked;
  const rect=host.getBoundingClientRect();
  const shown=[];
  const candidates=[];
  for(const el of peakEls){
    const x=Number(el.dataset.x),z=Number(el.dataset.z);
    const p=new THREE.Vector3(x,terrain.heightAt(x,z)*exaggeration+45,z).project(camera);
    const sx=(p.x*.5+.5)*rect.width,sy=(-p.y*.5+.5)*rect.height;
    el.hidden=true;
    if(visible&&p.z>=-1&&p.z<=1&&sx>12&&sx<rect.width-12&&sy>12&&sy<rect.height-12)
      candidates.push({el,sx,sy,priority:Number(el.dataset.importance)});
  }
  candidates.sort((a,b)=>b.priority-a.priority);
  for(const c of candidates){
    // Actual labels are compact. Cull overlapping TEXT, not whole 100 px cells.
    const textWidth=Math.min(140,15+c.el.textContent.length*5.7);
    const r={l:c.sx-5,t:c.sy-10,r:c.sx+textWidth,b:c.sy+10};
    if(shown.some(q=>r.l<q.r+3&&r.r>q.l-3&&r.t<q.b+2&&r.b>q.t-2))continue;
    shown.push(r);c.el.hidden=false;
    c.el.style.left=`${c.sx}px`;c.el.style.top=`${c.sy}px`;
  }
}
function clearContourLabels(){for(const el of contourEls)el.remove();contourEls=[];}
function makeContourLabels(){
  clearContourLabels();
  const source=terrain?.contourLabels||[];
  const stride=Math.max(1,Math.ceil(source.length/550));
  for(let i=0;i<source.length;i+=stride){
    const label=source[i];
    const el=document.createElement('div');el.className='contour-label';
    el.textContent=elevationText(label.elevation);
    el.dataset.elevation=String(label.elevation);
    el.dataset.x=String(label.x);el.dataset.z=String(label.z);
    host.append(el);contourEls.push(el);
  }
  updateContourLabels();
}
function updateContourLabels(){
  if(!terrain)return;
  const visible=$('contours').checked;
  const rect=host.getBoundingClientRect();
  const occupied=new Set();
  for(const el of contourEls){
    el.hidden=true;
    if(!visible)continue;
    const x=Number(el.dataset.x),z=Number(el.dataset.z);
    const p=new THREE.Vector3(x,terrain.heightAt(x,z)*exaggeration+12,z).project(camera);
    if(p.z<-.99||p.z>1)continue;
    const sx=(p.x*.5+.5)*rect.width,sy=(-p.y*.5+.5)*rect.height;
    if(sx<30||sx>rect.width-40||sy<60||sy>rect.height-38)continue;
    const bx=Math.floor(sx/108),by=Math.floor(sy/65),key=`${bx}:${by}`;
    if(occupied.has(key))continue;
    occupied.add(key);el.hidden=false;
    el.style.left=`${sx}px`;el.style.top=`${sy}px`;
  }
}
const down={x:0,y:0};
renderer.domElement.addEventListener('pointerdown',e=>{down.x=e.clientX;down.y=e.clientY;});
renderer.domElement.addEventListener('pointerup',e=>{
  if(Math.hypot(e.clientX-down.x,e.clientY-down.y)>9||(e.pointerType==='mouse'&&e.button!==0)||!terrain)return;
  const rect=renderer.domElement.getBoundingClientRect();
  const nx=(e.clientX-rect.left)/rect.width*2-1;
  const ny=-(e.clientY-rect.top)/rect.height*2+1;
  const hit=pick(nx,ny);
  if(!hit)return;
  const metresPerPixel=camera.isOrthographicCamera?
    (camera.top-camera.bottom)/(rect.height*camera.zoom):
    (2*Math.tan(camera.fov*Math.PI/360)*hit.distance)/rect.height;
  const nearest=$('show-trails').checked?nearestTrail(trailRecords,hit.point.x,hit.point.z,
    Math.min(360,Math.max(12,metresPerPixel*17))):null;
  if(nearest){chooseTrail(nearest);return;}
  selected={x:hit.point.x,z:hit.point.z};
  $('inspect').hidden=false;
  updateInspection();
});
function pick(nx,ny) {
  raycaster.setFromCamera(new THREE.Vector2(nx,ny),camera);
  return raycaster.intersectObject(terrain.mesh,false)[0];
}
function updateInspection() {
  if(!selected||!terrain)return;
  const {x,z}=selected;
  const coords=world.fromScene(x,z);
  $('inspect-name').textContent=selected.name||'Terrain sample';
  $('inspect-lat').textContent=`${coords.lat.toFixed(5)}° N`;
  $('inspect-lon').textContent=`${Math.abs(coords.lon).toFixed(5)}° W`;
  $('inspect-elev').textContent=elevationText(terrain.heightAt(x,z));
  if(!wind){$('inspect-wind').textContent='Unavailable';return;}
  const v=wind.fieldAt(x,z);
  const from=(Math.atan2(-v.u,v.v)*180/Math.PI+360)%360;
  $('inspect-wind').textContent=v.missing?'Unavailable':`${windSpeedText(v.speed)} ${unitMode==='imperial'?'mph':'m/s'} · from ${compassFrom(from)}`;
}
function updateCompass() {
  if(!terrain)return;
  const level=terrain.heightAt(0,0)*exaggeration;
  const length=Math.max(1000,world.depth*.12);
  const base=new THREE.Vector3(0,level,0).project(camera);
  const north=new THREE.Vector3(0,level,-length).project(camera);
  const angle=Math.atan2(north.x-base.x,north.y-base.y)*180/Math.PI;
  if(Number.isFinite(angle))$('compass-arrow').style.transform=`rotate(${angle}deg)`;
}
function updateScale() {
  if(!terrain)return;
  const pixelSpan=Math.min(160,host.clientWidth*.33);
  const w=host.clientWidth,h=host.clientHeight;
  if(!w||!h)return;
  const screenY=-.06;
  // Intersect the two screen rays with a local horizontal plane. This avoids
  // hundreds of thousands of triangle tests every time the scale refreshes.
  const h0=terrain.heightAt(controls.target.x,controls.target.z)*exaggeration;
  const plane=new THREE.Plane(new THREE.Vector3(0,1,0),-h0);
  const projectToPlane=sx=>{
    raycaster.setFromCamera(new THREE.Vector2(sx,screenY),camera);
    return raycaster.ray.intersectPlane(plane,new THREE.Vector3());
  };
  const a=projectToPlane(-pixelSpan/w),b=projectToPlane(pixelSpan/w);
  if(!a||!b){$('scale-text').textContent='Perspective scale unavailable';return;}
  const span=Math.hypot(b.x-a.x,b.z-a.z);
  if(!(span>0))return;
  const order=10**Math.floor(Math.log10(span));
  const choices=[1,2,5,10].map(v=>v*order);
  const nearest=choices.reduce((best,c)=>Math.abs(c-span)<Math.abs(best-span)?c:best,choices[0]);
  $('scale-line').style.width=`${Math.max(50,Math.min(250,(2*pixelSpan)*nearest/span))}px`;
  $('scale-text').textContent=distanceText(nearest)+' · at map center';
}
let prevTime=performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt=Math.min((now-prevTime)/1000,.08);
  prevTime=now;
  if(wind)wind.tick(dt,windSpeedup);
  if(weather&&playingTimeline&&weather.times.length>1) {
    timelineClock+=dt;
    if(timelineClock>=2.8){timelineClock=0;frameIndex=(frameIndex+1)%weather.times.length;updateTimeUI();}
  }
  const moved=controls.update();
  if(terrain) {
    if(moved||now-lastMarkerUpdate>900){
      updatePeaks();updateTrailheads();updateContourLabels();updateCompass();lastMarkerUpdate=now;
    }
    if(now-lastScaleUpdate>1100){updateScale();lastScaleUpdate=now;}
  }
  renderer.render(scene,camera);
}
requestAnimationFrame(animate);
buildRegion();


// Trail data are loaded asynchronously from NYS DEC's GIS service and remain
// interactive even when the weather forecast API is unavailable.
function initializeTrails(result) {
  trailRecords=result.trails||[];
  if(trailLayer){scene.remove(trailLayer.group);trailLayer.dispose();}
  if(!result.limited||trailRecords.length){
    trailLayer=makeTrailLayer(terrain,trailRecords,host.clientWidth,host.clientHeight,exaggeration);
    trailLayer.setVisible($('show-trails').checked);
    scene.add(trailLayer.group);
  }
  $('trail-count').textContent=result.limited ?
    `${trailRecords.length.toLocaleString()} segments · ${result.note}` :
    `${trailRecords.length.toLocaleString()} DEC segments in this map · select to inspect`;
  renderTrailSearch();
}
function renderTrailSearch() {
  const list=$('trail-results');list.replaceChildren();
  const query=$('trail-search').value.trim().toLocaleLowerCase();
  let matches=trailRecords.filter(item=>(item.name.toLocaleLowerCase().includes(query)));
  matches.sort((a,b)=>(a.name==='Unnamed DEC trail')-(b.name==='Unnamed DEC trail') || a.name.localeCompare(b.name) || b.distance-a.distance);
  const shown=matches.slice(0,35);
  if(!shown.length){const empty=document.createElement('div');empty.className='trail-empty';
    empty.textContent=trailRecords.length?'No matching mapped trail segments.':'No trails available for this extent.';list.append(empty);return;}
  for(const rec of shown){
    const button=document.createElement('button');button.type='button';button.className='trail-result';
    button.classList.toggle('selected',selectedTrail?.id===rec.id);
    const blaze=document.createElement('i');blaze.className=`blaze ${rec.marker}`;blaze.setAttribute('aria-label',`${rec.marker} marker`);
    const name=document.createElement('span');name.className='trail-result-name';name.textContent=rec.name;
    const distance=document.createElement('span');distance.className='trail-result-distance';distance.textContent=trailLengthText(rec.distance);
    button.append(blaze,name,distance);
    button.addEventListener('click',()=>chooseTrail(rec,true));
    list.append(button);
  }
  if(matches.length>shown.length){const extra=document.createElement('div');extra.className='trail-empty';
    extra.textContent=`Showing ${shown.length} of ${matches.length} matches. Refine search for more.`;list.append(extra);}
}
function chooseTrail(rec,focus=false){
  if(!rec||!terrain)return;
  selectedTrail=rec;
  selected=null;$('inspect').hidden=true;
  trailLayer?.selectTrail(rec);
  $('trail-card').hidden=false;
  $('trail-name').textContent=rec.name;
  updateSelectedTrailStats();
  renderTrailSearch();
  if(focus)focusOnTrail(rec);
  if(mobileQuery.matches)setMobileControls(false);
}
function focusOnTrail(rec) {
  if(!terrain||!rec)return;
  let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
  for(const path of rec.paths)for(const p of path){x0=Math.min(x0,p.x);x1=Math.max(x1,p.x);z0=Math.min(z0,p.z);z1=Math.max(z1,p.z);}
  if(!Number.isFinite(x0))return;
  const x=(x0+x1)/2,z=(z0+z1)/2,y=terrain.heightAt(x,z)*exaggeration;
  const span=Math.max(750,(x1-x0)*1.75,(z1-z0)*1.75);
  controls.target.set(x,y,z);
  if(overhead){camera.zoom=1;overheadSpan=span;updateOverheadFrustum();camera.position.set(x,y+Math.max(world.width,world.depth)*2,z);camera.lookAt(controls.target);}
  else{camera.position.set(x-span*.65,y+span*.85,z+span*.95);camera.lookAt(controls.target);}
  controls.update();
  updateScale();
}
$('focus-trail').addEventListener('click',()=>focusOnTrail(selectedTrail));
$('close-trail').addEventListener('click',()=>{
  selectedTrail=null;trailLayer?.selectTrail(null);
  $('trail-card').hidden=true;renderTrailSearch();
});
$('quick-trails').addEventListener('click',()=>{
  selectTab('trails');
  setMobileControls(true);
  $('trail-section').scrollIntoView({block:'start',behavior:'smooth'});
  $('trail-search').focus({preventScroll:true});
});
$('download-gpx').addEventListener('click',()=>{
  if(!selectedTrail)return;
  const contents=trailGPX(selectedTrail,world);
  const blob=new Blob([contents],{type:'application/gpx+xml'});
  const url=URL.createObjectURL(blob);
  const element=document.createElement('a');element.href=url;
  element.download=(selectedTrail.name.replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'').slice(0,60)||'dec-trail')+'.gpx';
  document.body.append(element);element.click();element.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
});

// GPS is opt-in, a single position fix, and requires HTTPS in Safari.
function disposeLocationOverlay(){
  if(!locationOverlay)return;
  for(const child of locationOverlay.children){child.geometry?.dispose();child.material?.dispose();}
  locationOverlay=null;
}
function updateLocationOverlay(){
  if(!locationOverlay||!terrain)return;
  const x=locationOverlay.userData.x,z=locationOverlay.userData.z;
  const y=terrain.heightAt(x,z)*exaggeration+14;
  locationOverlay.position.set(x,y,z);
}
function showLocation(lat,lon,accuracy){
  const loc=world.toScene(lat,lon);
  const status=$('location-status');status.hidden=false;
  if(Math.abs(loc.x)>world.width/2||Math.abs(loc.z)>world.depth/2){
    status.textContent=`Location is outside ${REGIONS[regionKey].name}. GPS markers only appear when you are inside the mapped area.`;
    return;
  }
  if(locationOverlay){scene.remove(locationOverlay);disposeLocationOverlay();}
  locationOverlay=new THREE.Group();locationOverlay.userData={x:loc.x,z:loc.z};
  const sphere=new THREE.Mesh(new THREE.SphereGeometry(24,16,12),new THREE.MeshBasicMaterial({color:0x5dd2ff,depthTest:false}));
  sphere.renderOrder=12;locationOverlay.add(sphere);
  const radius=Math.max(28,Math.min(accuracy,1500));
  const ring=new THREE.Mesh(new THREE.RingGeometry(Math.max(1,radius-8),radius,64),new THREE.MeshBasicMaterial({color:0x5dd2ff,transparent:true,opacity:.47,depthWrite:false,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2;ring.renderOrder=10;locationOverlay.add(ring);
  scene.add(locationOverlay);updateLocationOverlay();
  status.textContent=`GPS location · reported accuracy ±${Math.round(accuracy)} m · one-time fix`;
  const y=terrain.heightAt(loc.x,loc.z)*exaggeration;
  controls.target.set(loc.x,y,loc.z);
  if(overhead){camera.position.set(loc.x,y+Math.max(world.width,world.depth)*2,loc.z);overheadSpan=Math.min(overheadSpan,6500);updateOverheadFrustum();camera.lookAt(controls.target);}
  else{camera.position.set(loc.x-1900,y+2500,loc.z+2300);}
  controls.update();
}
$('locate').addEventListener('click',()=>{
  const status=$('location-status');status.hidden=false;
  if(!navigator.geolocation){status.textContent='This browser does not support GPS location.';return;}
  if(!window.isSecureContext){status.textContent='GPS requires HTTPS. Open the published GitHub Pages site.';return;}
  status.textContent='Requesting one-time device location…';
  navigator.geolocation.getCurrentPosition(
    position=>{if(!terrain){status.textContent='Terrain is still loading.';return;}
      showLocation(position.coords.latitude,position.coords.longitude,position.coords.accuracy);},
    error=>{status.textContent=`Location unavailable: ${error.message}`;},
    {enableHighAccuracy:true,timeout:16000,maximumAge:0},
  );
});


function clearTrailheads(){for(const el of trailheadEls)el.remove();trailheadEls=[];}
function makeTrailheads(records){
  clearTrailheads();
  for(const item of records){
    const marker=document.createElement('button');marker.className='trailhead-pin';marker.type='button';
    marker.title=item.name;marker.setAttribute('aria-label',`DEC mapped trailhead: ${item.name}`);
    marker.textContent='T';
    marker.dataset.x=String(item.x);marker.dataset.z=String(item.z);
    marker.addEventListener('click',()=>{
      selected={x:item.x,z:item.z,name:item.name};
      $('inspect').hidden=false;updateInspection();
    });
    host.append(marker);trailheadEls.push(marker);
  }
  updateTrailheads();
}
function updateTrailheads(){
  if(!terrain)return;
  const visible=$('show-trailheads').checked;
  const rect=host.getBoundingClientRect();
  for(const el of trailheadEls){
    const x=Number(el.dataset.x),z=Number(el.dataset.z);
    const point=new THREE.Vector3(x,terrain.heightAt(x,z)*exaggeration+22,z).project(camera);
    const inView=visible&&point.z>=-1&&point.z<=1&&Math.abs(point.x)<.97&&Math.abs(point.y)<.97;
    el.hidden=!inView;
    if(inView){el.style.left=`${(point.x*.5+.5)*rect.width}px`;el.style.top=`${(-point.y*.5+.5)*rect.height}px`;}
  }
}
