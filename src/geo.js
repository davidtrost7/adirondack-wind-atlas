// WGS84 / UTM zone 18N (EPSG:32618). Distances are in actual metres.
// The Adirondacks lie entirely within zone 18N.
const A = 6378137;
const E2 = 0.0066943799901413165;
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;
const LON0 = -75 * Math.PI / 180;
const R = Math.PI / 180;

export function toUTM(lat, lon) {
  const p = lat * R, l = lon * R;
  const s = Math.sin(p), c = Math.cos(p), t = Math.tan(p);
  const n = A / Math.sqrt(1 - E2 * s * s);
  const T = t * t, C = EP2 * c * c, aa = c * (l - LON0);
  const m = A * ((1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * p
    - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * p)
    + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * p)
    - (35 * E2 ** 3 / 3072) * Math.sin(6 * p));
  const east = 500000 + K0 * n * (aa + (1 - T + C) * aa ** 3 / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * aa ** 5 / 120);
  const north = K0 * (m + n * t * (aa ** 2 / 2 + (5 - T + 9 * C + 4 * C * C) * aa ** 4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * aa ** 6 / 720));
  return { east, north };
}

export function fromUTM(east, north) {
  const x = east - 500000, y = north;
  const m = y / K0;
  const mu = m / (A * (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + 151 * e1 ** 3 / 96 * Math.sin(6 * mu)
    + 1097 * e1 ** 4 / 512 * Math.sin(8 * mu);
  const s = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1);
  const n1 = A / Math.sqrt(1 - E2 * s * s);
  const r1 = A * (1 - E2) / (1 - E2 * s * s) ** 1.5;
  const T = t * t, C = EP2 * c * c, d = x / (n1 * K0);
  const lat = p1 - (n1 * t / r1) * (d ** 2 / 2 - (5 + 3 * T + 10 * C - 4 * C ** 2 - 9 * EP2) * d ** 4 / 24
    + (61 + 90 * T + 298 * C + 45 * T ** 2 - 252 * EP2 - 3 * C ** 2) * d ** 6 / 720);
  const lon = LON0 + (d - (1 + 2 * T + C) * d ** 3 / 6
    + (5 - 2 * C + 28 * T - 3 * C ** 2 + 8 * EP2 + 24 * T ** 2) * d ** 5 / 120) / c;
  return { lat: lat / R, lon: lon / R };
}

export function boundsToWorld(bounds) {
  const corners = [
    toUTM(bounds.south, bounds.west), toUTM(bounds.south, bounds.east),
    toUTM(bounds.north, bounds.west), toUTM(bounds.north, bounds.east),
  ];
  const eMin = Math.min(...corners.map(p => p.east));
  const eMax = Math.max(...corners.map(p => p.east));
  const nMin = Math.min(...corners.map(p => p.north));
  const nMax = Math.max(...corners.map(p => p.north));
  const centerEast = (eMin + eMax) / 2;
  const centerNorth = (nMin + nMax) / 2;
  const width = eMax - eMin, depth = nMax - nMin;
  return {
    ...bounds, eMin, eMax, nMin, nMax, centerEast, centerNorth, width, depth,
    toScene(lat, lon) {
      const p = toUTM(lat, lon);
      return { x: p.east - centerEast, z: centerNorth - p.north };
    },
    fromScene(x, z) { return fromUTM(centerEast + x, centerNorth - z); },
  };
}

export function niceDistance(metres) {
  if (metres >= 1000) return `${(metres / 1000).toFixed(metres % 1000 === 0 ? 0 : 1)} km`;
  return `${Math.round(metres)} m`;
}

export function compassFrom(degrees) {
  return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(((degrees % 360) + 360) % 360 / 22.5) % 16];
}
