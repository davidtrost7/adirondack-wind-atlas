import * as THREE from 'three';

const TILE_SIZE = 256;
const tileCache = new Map();
const toTileX = (lon, z) => (lon + 180) / 360 * 2 ** z;
const toTileY = (lat, z) => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

async function fetchTile(z, x, y, signal) {
  const key = `${z}/${x}/${y}`;
  if (tileCache.has(key)) {
    const existing=tileCache.get(key); tileCache.delete(key); tileCache.set(key,existing);
    return existing;
  }
  const urls = [
    `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`,
    `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${key}.png`,
  ];
  let lastError;
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`DEM tile HTTP ${res.status}`);
      const bmp = await createImageBitmap(await res.blob());
      const canvas = document.createElement('canvas');
      canvas.width = TILE_SIZE; canvas.height = TILE_SIZE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      const data = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
      const elevations = new Float32Array(TILE_SIZE * TILE_SIZE);
      for (let i = 0; i < elevations.length; i++) {
        const j = 4 * i;
        elevations[i] = data[j] * 256 + data[j + 1] + data[j + 2] / 256 - 32768;
      }
      tileCache.set(key, elevations);
      while(tileCache.size>160)tileCache.delete(tileCache.keys().next().value);
      return elevations;
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = err;
    }
  }
  throw new Error(`Terrain tile ${key}: ${lastError?.message || 'unavailable'}`);
}

function getTileSample(tiles, z, pixelX, pixelY) {
  const tx = Math.floor(pixelX / TILE_SIZE), ty = Math.floor(pixelY / TILE_SIZE);
  const arr = tiles.get(`${tx}/${ty}`);
  if (!arr) return null;
  const ix = clamp(Math.floor(pixelX - tx * TILE_SIZE), 0, 255);
  const iy = clamp(Math.floor(pixelY - ty * TILE_SIZE), 0, 255);
  return arr[iy * TILE_SIZE + ix];
}

function bilinearElevation(tiles, z, lat, lon) {
  // Pixel (0,0) samples are pixel *centres*: subtract 0.5 for bilinear interpolation.
  const px = toTileX(lon, z) * 256 - 0.5;
  const py = toTileY(lat, z) * 256 - 0.5;
  const i = Math.floor(px), j = Math.floor(py);
  const dx = px - i, dy = py - j;
  const a = getTileSample(tiles, z, i, j);
  const b = getTileSample(tiles, z, i + 1, j);
  const c = getTileSample(tiles, z, i, j + 1);
  const d = getTileSample(tiles, z, i + 1, j + 1);
  if ([a,b,c,d].some(v => v === null)) return a ?? b ?? c ?? d ?? 0;
  return (a * (1-dx) + b * dx) * (1-dy) + (c * (1-dx) + d * dx) * dy;
}

const elevationColors = [
  [0, '#1b3c3d'], [250, '#2c5047'], [500, '#456b57'],
  [750, '#6c8466'], [1050, '#9d9c78'], [1260, '#a5a18b'],
  [1440, '#b3afa2'], [1700, '#dad1bc'],
];
const tempA = new THREE.Color(), tempB = new THREE.Color();
function colorAt(height, out) {
  for (let i = 0; i < elevationColors.length - 1; i++) {
    const [lo, ca] = elevationColors[i], [hi, cb] = elevationColors[i + 1];
    if (height <= hi) {
      tempA.set(ca); tempB.set(cb);
      return out.copy(tempA).lerp(tempB, clamp((height - lo) / (hi - lo), 0, 1));
    }
  }
  return out.set(elevationColors.at(-1)[1]);
}

// All mesh vertices are spaced in true UTM metres. Elevation is metres above sea level.
export async function createTerrain(world, { quality = 'high', mobile=false, detailRegion=false, signal, onProgress } = {}) {
  // Higher DEM zooms only improve a LOCAL view; cap tile count on mobile devices.
  // Terrain samples are sourced elevations, not newly invented sub-pixel detail.
  // Full-detail mode intentionally loads up to 810 DEM tiles at z14, rather
  // than quietly substituting a low-resolution overview. This uses the same
  // elevation dataset as the close-ups; Ultra increases mesh sampling further.
  // Standard is an explicit lower-bandwidth alternative, never an automatic fallback.
  const fullDetail = detailRegion && quality!=='standard';
  const tileBudget = fullDetail ? 850 : quality==='ultra' ? 98 : quality==='high' ? 85 : 62;
  let z = fullDetail ? 14 : quality==='ultra' ? 14 : quality==='high' ? 13 : 11;
  const tileCount=level=>{
    const a=Math.floor(toTileX(world.west,level))-1,b=Math.floor(toTileX(world.east,level))+1;
    const c=Math.floor(toTileY(world.north,level))-1,d=Math.floor(toTileY(world.south,level))+1;
    return (b-a+1)*(d-c+1);
  };
  while(z>7&&tileCount(z)>tileBudget)z--;
  // Match or exceed the Marcy close-up's ground metres per mesh cell even
  // across the ~47 km full 46-peak footprint. No fake subdivision of a DEM.
  const density=fullDetail
    ? (mobile?(quality==='ultra'?1120:910):(quality==='ultra'?1260:1050))
    : mobile ? (quality==='ultra'?485:quality==='high'?390:245) : (quality==='ultra'?580:quality==='high'?465:285);
  const limit=fullDetail
    ? (mobile?(quality==='ultra'?1130:920):(quality==='ultra'?1270:1060))
    : mobile ? (quality==='ultra'?490:quality==='high'?395:250) : (quality==='ultra'?590:quality==='high'?475:300);
  const nx=Math.max(90,Math.min(limit,Math.round(density*world.width/Math.max(world.width,world.depth))));
  const nz=Math.max(90,Math.min(limit,Math.round(density*world.depth/Math.max(world.width,world.depth))));
  const tx0 = Math.floor(toTileX(world.west, z)) - 1;
  const tx1 = Math.floor(toTileX(world.east, z)) + 1;
  const ty0 = Math.floor(toTileY(world.north, z)) - 1;
  const ty1 = Math.floor(toTileY(world.south, z)) + 1;
  const keys = [];
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) keys.push([tx,ty]);
  const tiles = new Map();
  let done = 0, next = 0;
  async function worker() {
    while (next < keys.length) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const [tx, ty] = keys[next++];
      const elevations = await fetchTile(z, tx, ty, signal);
      tiles.set(`${tx}/${ty}`, elevations);
      done++;
      onProgress?.(`TERRAIN · ${done}/${keys.length} TILES`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(fullDetail?14:7, keys.length) }, () => worker()));

  const n = (nx + 1) * (nz + 1);
  const heights = new Float32Array(n);
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const color = new THREE.Color();
  let minHeight = Infinity, maxHeight = -Infinity;
  for (let iz = 0; iz <= nz; iz++) {
    const zScene = (iz / nz - 0.5) * world.depth;
    for (let ix = 0; ix <= nx; ix++) {
      const xScene = (ix / nx - 0.5) * world.width;
      const { lat, lon } = world.fromScene(xScene, zScene);
      const h = bilinearElevation(tiles, z, lat, lon);
      const i = iz * (nx + 1) + ix;
      heights[i] = h;
      positions[3*i] = xScene;
      positions[3*i+1] = h;
      positions[3*i+2] = zScene;
      minHeight = Math.min(minHeight, h);
      maxHeight = Math.max(maxHeight, h);
      colorAt(h, color);
      colors[3*i] = color.r;
      colors[3*i+1] = color.g;
      colors[3*i+2] = color.b;
    }
  }
  const indices = new Uint32Array(nx * nz * 6);
  let k = 0;
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const a = z * (nx+1) + x, b = a+1, c = a+(nx+1), d = c+1;
    indices[k++] = a; indices[k++] = c; indices[k++] = b;
    indices[k++] = b; indices[k++] = c; indices[k++] = d;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    vertexColors:true, roughness:1, metalness:0, side:THREE.DoubleSide,
  }));
  mesh.receiveShadow = true;
  // Contour elevations use exact 200/400/1000-foot intervals at increasing extents.
  // Underlying DEM values and every vertex remain in actual metres.
  const contourFeet=fullDetail ? 200 : world.width > 125000 ? 1000 : world.width < 28000 ? 200 : 400;
  const contourData = buildContours(nx, nz, heights, world, contourFeet / 3.280839895);
  const contour = contourData.geometry;
  const contours = new THREE.LineSegments(contour, new THREE.LineBasicMaterial({
    color:0x142f31, transparent:true, opacity:0.40, depthWrite:false,
  }));
  contours.visible = true;
  let exag = 1;
  function heightAt(x,z) {
    const u = clamp((x / world.width + .5) * nx, 0, nx);
    const v = clamp((z / world.depth + .5) * nz, 0, nz);
    const ix = Math.min(nx-1, Math.floor(u)), iz = Math.min(nz-1, Math.floor(v));
    const fu = u - ix, fv = v - iz, a = iz*(nx+1)+ix;
    return heights[a]*(1-fu)*(1-fv) + heights[a+1]*fu*(1-fv)
      + heights[a+nx+1]*(1-fu)*fv + heights[a+nx+2]*fu*fv;
  }
  function setVerticalScale(s) {
    exag = s;
    const p = geometry.getAttribute('position');
    for (let i = 0; i < n; i++) p.array[3*i+1] = heights[i]*s;
    p.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    contours.scale.y = s;
  }
  return { mesh, contours, contourLabels:contourData.labels, heights, nx, nz, demZoom:z, minHeight, maxHeight, world,
    heightAt, setVerticalScale, get verticalScale() { return exag; },
    dispose() { geometry.dispose(); mesh.material.dispose(); contour.dispose(); contours.material.dispose(); },
  };
}

function buildContours(nx, nz, h, w, step) {
  const verts = [];
  const labels=[];
  const spacing=Math.max(400,Math.min(w.width,w.depth)/14);
  const occupied=new Set();
  const dx = w.width / nx, dz = w.depth / nz;
  function crossing(ha, hb, xa, za, xb, zb, level) {
    if ((ha < level) === (hb < level)) return null;
    const f = (level - ha) / (hb - ha);
    return [xa + (xb-xa)*f, level+3, za+(zb-za)*f];
  }
  for (let iz=0; iz<nz; iz++) for (let ix=0; ix<nx; ix++) {
    const i = iz*(nx+1)+ix;
    const a=h[i], b=h[i+1], c=h[i+nx+1], d=h[i+nx+2];
    const lo = Math.ceil(Math.min(a,b,c,d)/step)*step;
    const hi = Math.floor(Math.max(a,b,c,d)/step)*step;
    const x0=ix*dx-w.width/2, x1=x0+dx, z0=iz*dz-w.depth/2, z1=z0+dz;
    for(let level=lo; level<=hi; level+=step) {
      const p = [crossing(a,b,x0,z0,x1,z0,level), crossing(b,d,x1,z0,x1,z1,level),
        crossing(d,c,x1,z1,x0,z1,level), crossing(c,a,x0,z1,x0,z0,level)].filter(Boolean);
      if (p.length === 2) verts.push(...p[0], ...p[1]);
      if (p.length === 4) verts.push(...p[0],...p[1],...p[2],...p[3]);
      // Candidate label on each contour level; rotate along this segment
      // after projecting its tangent into the user's camera view.
      if(p.length>=2) {
        const mx=(p[0][0]+p[1][0])/2,mz=(p[0][2]+p[1][2])/2;
        const bx=Math.floor((mx+w.width/2)/spacing),bz=Math.floor((mz+w.depth/2)/spacing);
        const key=`${level}:${bx}:${bz}`;
        if(!occupied.has(key)) {occupied.add(key);labels.push({x:mx,z:mz,elevation:level,dx:p[1][0]-p[0][0],dz:p[1][2]-p[0][2]});}
      }
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(verts,3));
  return {geometry:geom,labels};
}
