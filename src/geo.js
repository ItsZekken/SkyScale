// src/geo.js
// Procedural rasterization of Natural Earth 50m data & Felzenszwalb-Huttenlocher EDT
// Generates exact Signed Distance Fields (SDF) and river channels without canvas

import * as THREE from 'three';

// 1D Felzenszwalb-Huttenlocher Euclidean Distance Transform
export function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -1e20;
  z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dx = q - v[k];
    d[q] = dx * dx + f[v[k]];
  }
}

// 2D Exact Euclidean Distance Transform Squared: O(W * H)
export function edt2d(mask, w, h) {
  const INF = 1e12;
  const f = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    f[i] = mask[i] ? 0 : INF;
  }
  const g = new Float32Array(w * h);
  const maxDim = Math.max(w, h);
  const colIn = new Float32Array(h);
  const colOut = new Float32Array(h);
  const rowIn = new Float32Array(w);
  const rowOut = new Float32Array(w);
  const v = new Int32Array(maxDim);
  const z = new Float32Array(maxDim + 1);

  // Column pass
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) colIn[y] = f[y * w + x];
    edt1d(colIn, h, colOut, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = colOut[y];
  }

  // Row pass
  const res = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) rowIn[x] = g[rowOffset + x];
    edt1d(rowIn, w, rowOut, v, z);
    for (let x = 0; x < w; x++) res[rowOffset + x] = rowOut[x];
  }
  return res;
}

// Custom scanline even-odd polygon rasterizer (strictly without HTML Canvas)
export function rasterizeLand(w, h, bbox, geojson) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const lonSpan = maxLon - minLon;
  const latSpan = maxLat - minLat;
  const mask = new Uint8Array(w * h);

  function processRing(ring) {
    const pts = [];
    let rMinY = 1e9, rMaxY = -1e9;
    for (let i = 0; i < ring.length; i++) {
      const [lon, lat] = ring[i];
      const px = ((lon - minLon) / lonSpan) * w - 0.5;
      const py = ((lat - minLat) / latSpan) * h - 0.5;
      pts.push([px, py]);
      if (py < rMinY) rMinY = py;
      if (py > rMaxY) rMaxY = py;
    }
    const startY = Math.max(0, Math.floor(rMinY));
    const endY = Math.min(h - 1, Math.ceil(rMaxY));

    for (let y = startY; y <= endY; y++) {
      const intersections = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i];
        const p2 = pts[i + 1];
        if ((p1[1] <= y && p2[1] > y) || (p2[1] <= y && p1[1] > y)) {
          const t = (y - p1[1]) / (p2[1] - p1[1]);
          intersections.push(p1[0] + t * (p2[0] - p1[0]));
        }
      }
      if (intersections.length < 2) continue;
      intersections.sort((a, b) => a - b);
      for (let k = 0; k < intersections.length - 1; k += 2) {
        const xStart = Math.max(0, Math.ceil(intersections[k]));
        const xEnd = Math.min(w - 1, Math.floor(intersections[k + 1]));
        const rowOffset = y * w;
        for (let x = xStart; x <= xEnd; x++) {
          mask[rowOffset + x] ^= 1; // XOR toggles outer ring on, holes off
        }
      }
    }
  }

  for (const f of geojson.features || []) {
    const geom = f.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon') {
      for (const ring of geom.coordinates) processRing(ring);
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        for (const ring of poly) processRing(ring);
      }
    }
  }
  return mask;
}

// Rasterize river vectors into a grayscale mask (0.0 to 1.0)
export function rasterizeRivers(w, h, bbox, riversGeoJson) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const lonSpan = maxLon - minLon;
  const latSpan = maxLat - minLat;
  const mask = new Float32Array(w * h);

  function drawSegment(x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist * 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = Math.round(x0 + t * dx);
      const py = Math.round(y0 + t * dy);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const rx = px + ox;
          const ry = py + oy;
          if (rx >= 0 && rx < w && ry >= 0 && ry < h) {
            const d = Math.hypot(ox, oy);
            const val = Math.max(0, 1.0 - d * 0.45);
            const idx = ry * w + rx;
            if (val > mask[idx]) mask[idx] = val;
          }
        }
      }
    }
  }

  function processLine(coords) {
    for (let i = 0; i < coords.length - 1; i++) {
      const [lon0, lat0] = coords[i];
      const [lon1, lat1] = coords[i + 1];
      const px0 = ((lon0 - minLon) / lonSpan) * w - 0.5;
      const py0 = ((lat0 - minLat) / latSpan) * h - 0.5;
      const px1 = ((lon1 - minLon) / lonSpan) * w - 0.5;
      const py1 = ((lat1 - minLat) / latSpan) * h - 0.5;
      drawSegment(px0, py0, px1, py1);
    }
  }

  for (const f of riversGeoJson.features || []) {
    const geom = f.geometry;
    if (!geom) continue;
    if (geom.type === 'LineString') {
      processLine(geom.coordinates);
    } else if (geom.type === 'MultiLineString') {
      for (const line of geom.coordinates) processLine(line);
    }
  }
  return mask;
}

// Signed Distance Field computation (+ in water, - in land)
export function computeSignedDistanceKm(landMask, w, h, kmPerPx) {
  const waterMask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    waterMask[i] = landMask[i] ? 0 : 1;
  }
  const edtToWater = edt2d(waterMask, w, h);
  const edtToLand = edt2d(landMask, w, h);
  const sdf = new Float32Array(w * h);

  for (let i = 0; i < w * h; i++) {
    const dLand = Math.sqrt(edtToLand[i]);
    const dWater = Math.sqrt(edtToWater[i]);
    const val = (dLand - dWater) * kmPerPx;
    sdf[i] = Math.max(-3000, Math.min(3000, val));
  }
  return sdf;
}

// Build CPU DataTexture with R=SDF and A=Rivers
export function buildRawGeoDataTexture(sdf, rivers, w, h) {
  const total = w * h;
  const data = new Uint16Array(total * 4);
  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    data[idx + 0] = THREE.DataUtils.toHalfFloat(sdf[i]);
    data[idx + 1] = THREE.DataUtils.toHalfFloat(0.0);
    data[idx + 2] = THREE.DataUtils.toHalfFloat(0.0);
    data[idx + 3] = THREE.DataUtils.toHalfFloat(rivers ? rivers[i] : 0.0);
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
