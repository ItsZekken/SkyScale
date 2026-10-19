// scripts/generate-planetary-clouds.mjs
// Offline Scientific Planetary & Mesoscale Cloud Generator
// - Uses real Natural Earth land50.json geography + 2D Euclidean Distance Transform (EDT)
// - Simulates 3D spherical atmospheric fluid dynamics:
//   * Intertropical Convergence Zone (ITCZ) convective clusters over Colombia/Caribbean
//   * Coriolis cyclonic/anticyclonic spiral vortices (extratropical fronts & tropical waves)
//   * 3D Curl-Noise fluid advection & cellular Worley-Billow marine stratocumulus/cumulus
//   * Orographic condensation over the Andes, Sierra Nevada de Santa Marta, and coastlines
// - Outputs static pre-computed PNG assets in public/:
//   1. public/planetary-clouds.png (2048x1024 RGBA: R=Density, G=TopAlt, B=dTau/dX, A=dTau/dY)
//   2. public/regional-weather.png (1024x1024 RGBA: R=Coverage, G=BaseAlt, B=TopAlt, A=BillowDetail)

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// 1. PURE-JS PNG ENCODER (ZLIB + CRC32, ZERO EXTERNAL DEPENDENCIES)
// ---------------------------------------------------------------------------
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodeRGBAtoPNG(width, height, rgbaUint8) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Flip Y so row 0 in buffer (v=0, South) matches WebGL TextureLoader (flipY=true default)
  // In Three.js TextureLoader, flipY is true by default, so image top row (y=0 in PNG) becomes v=1 (North)!
  const stride = width * 4;
  const rawData = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y; // top of PNG = v=1 (North)
    const dstOffset = y * (stride + 1);
    rawData[dstOffset] = 0; // Filter type 0 (None)
    Buffer.from(rgbaUint8.buffer, rgbaUint8.byteOffset + srcRow * stride, stride).copy(rawData, dstOffset + 1);
  }

  const compressed = zlib.deflateSync(rawData, { level: 6 });
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', iend)
  ]);
}

// ---------------------------------------------------------------------------
// 2. SEEDED 3D SIMPLEX, WORLEY & CURL FLUID NOISE ENGINE
// ---------------------------------------------------------------------------
function createRng(seed = 2026) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createNoise3D(seed = 4096) {
  const rng = createRng(seed);
  const p = new Uint8Array(256);
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }

  const grad3 = new Float32Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
  ]);

  const F3 = 1.0 / 3.0;
  const G3 = 1.0 / 6.0;

  function simplex3(xin, yin, zin) {
    let n0, n1, n2, n3;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const X0 = i - t;
    const Y0 = j - t;
    const Z0 = k - t;
    const x0 = xin - X0;
    const y0 = yin - Y0;
    const z0 = zin - Z0;

    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2.0 * G3;
    const y2 = y0 - j2 + 2.0 * G3;
    const z2 = z0 - k2 + 2.0 * G3;
    const x3 = x0 - 1.0 + 3.0 * G3;
    const y3 = y0 - 1.0 + 3.0 * G3;
    const z3 = z0 - 1.0 + 3.0 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;

    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 < 0) n0 = 0.0;
    else {
      const gi0 = permMod12[ii + perm[jj + perm[kk]]] * 3;
      t0 *= t0;
      n0 = t0 * t0 * (grad3[gi0] * x0 + grad3[gi0 + 1] * y0 + grad3[gi0 + 2] * z0);
    }

    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 < 0) n1 = 0.0;
    else {
      const gi1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
      t1 *= t1;
      n1 = t1 * t1 * (grad3[gi1] * x1 + grad3[gi1 + 1] * y1 + grad3[gi1 + 2] * z1);
    }

    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 < 0) n2 = 0.0;
    else {
      const gi2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
      t2 *= t2;
      n2 = t2 * t2 * (grad3[gi2] * x2 + grad3[gi2 + 1] * y2 + grad3[gi2 + 2] * z2);
    }

    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 < 0) n3 = 0.0;
    else {
      const gi3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
      t3 *= t3;
      n3 = t3 * t3 * (grad3[gi3] * x3 + grad3[gi3 + 1] * y3 + grad3[gi3 + 2] * z3);
    }

    return 32.0 * (n0 + n1 + n2 + n3);
  }

  function fbm3(x, y, z, octaves = 5, lacunarity = 2.05, gain = 0.5) {
    let sum = 0.0;
    let amp = 0.5;
    let freq = 1.0;
    let norm = 0.0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * simplex3(x * freq, y * freq, z * freq);
      norm += amp;
      freq *= lacunarity;
      amp *= gain;
    }
    return sum / norm;
  }

  function billow3(x, y, z, octaves = 4) {
    let sum = 0.0;
    let amp = 0.5;
    let freq = 1.0;
    let norm = 0.0;
    for (let i = 0; i < octaves; i++) {
      const n = 1.0 - Math.abs(simplex3(x * freq, y * freq, z * freq));
      sum += amp * (n * n);
      norm += amp;
      freq *= 2.12;
      amp *= 0.48;
    }
    return sum / norm;
  }

  function ridged3(x, y, z, octaves = 4) {
    let sum = 0.0;
    let amp = 0.5;
    let freq = 1.0;
    let weight = 1.0;
    for (let i = 0; i < octaves; i++) {
      let n = 1.0 - Math.abs(simplex3(x * freq, y * freq, z * freq));
      n = n * n * weight;
      weight = Math.max(0.0, Math.min(1.0, n * 2.0));
      sum += n * amp;
      freq *= 2.08;
      amp *= 0.5;
    }
    return sum;
  }

  return { simplex3, fbm3, billow3, ridged3 };
}

// ---------------------------------------------------------------------------
// 3. GEOGRAPHY RASTERIZER & EDT (NATURAL EARTH land50.json)
// ---------------------------------------------------------------------------
function edt1d(f, n, d, v, z) {
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

function edt2d(mask, w, h) {
  const INF = 1e12;
  const f = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) f[i] = mask[i] ? 0 : INF;
  const g = new Float32Array(w * h);
  const maxDim = Math.max(w, h);
  const colIn = new Float32Array(h);
  const colOut = new Float32Array(h);
  const rowIn = new Float32Array(w);
  const rowOut = new Float32Array(w);
  const v = new Int32Array(maxDim);
  const z = new Float32Array(maxDim + 1);

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) colIn[y] = f[y * w + x];
    edt1d(colIn, h, colOut, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = colOut[y];
  }
  const res = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) rowIn[x] = g[rowOffset + x];
    edt1d(rowIn, w, rowOut, v, z);
    for (let x = 0; x < w; x++) res[rowOffset + x] = rowOut[x];
  }
  return res;
}

function rasterizeLand(w, h, bbox, geojson) {
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
        for (let x = xStart; x <= xEnd; x++) {
          mask[y * w + x] ^= 1;
        }
      }
    }
  }

  if (Array.isArray(geojson)) {
    for (const ring of geojson) processRing(ring);
  } else {
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
  }
  return mask;
}

function computeSignedDistanceKm(mask, w, h, kmPerPixel) {
  const invMask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) invMask[i] = mask[i] ? 0 : 1;
  const dOut2 = edt2d(mask, w, h);
  const dIn2 = edt2d(invMask, w, h);
  const sdf = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const distPx = mask[i] ? -(Math.sqrt(dIn2[i]) - 0.5) : (Math.sqrt(dOut2[i]) - 0.5);
    sdf[i] = distPx * kmPerPixel;
  }
  return sdf;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0.0, Math.min(1.0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3.0 - 2.0 * t);
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// 4. METEOROLOGICAL SIMULATION & CLOUD FIELD EVALUATION
// ---------------------------------------------------------------------------
console.log('1/4 Loading Natural Earth land50.json & computing geodesic SDF...');
const landRings = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'src/data/land50.json'), 'utf8'));
const GW = 2048;
const GH = 1024;
const landMask = rasterizeLand(GW, GH, [-180, -90, 180, 90], landRings);
const globalSdf = computeSignedDistanceKm(landMask, GW, GH, 40075.0 / GW);

const noise = createNoise3D(202604);

// Synoptic Cyclone & Anticyclone Systems (latDeg, lonDeg, radiusRad, swirlStrength, isTropical)
const CYCLONES = [
  // North Atlantic Extratropical Cyclone (Icelandic / Azores frontal wave)
  { lat: 46.0, lon: -38.0, rad: 0.42, swirl:  2.85, comma: 1.0 },
  // North-West Atlantic / Gulf Stream Frontal System
  { lat: 36.5, lon: -64.0, rad: 0.30, swirl:  2.20, comma: 0.85 },
  // North Pacific Extratropical Super-Cyclone
  { lat: 48.0, lon: -158.0, rad: 0.46, swirl: 3.10, comma: 1.0 },
  // Western Pacific Typhoon / Tropical Cyclone
  { lat: 19.5, lon: 134.0, rad: 0.16, swirl:  4.20, comma: 0.95 },
  // Eastern Pacific Tropical Wave (off Mexico/Central America)
  { lat: 13.5, lon: -104.0, rad: 0.18, swirl: 2.60, comma: 0.75 },
  // Southern Ocean Roaring Forties Cyclones (Clockwise rotation in S. Hemisphere!)
  { lat: -48.0, lon: -42.0, rad: 0.44, swirl: -2.95, comma: 1.0 },
  { lat: -52.0, lon:  35.0, rad: 0.45, swirl: -3.05, comma: 1.0 },
  { lat: -46.0, lon: 118.0, rad: 0.42, swirl: -2.80, comma: 0.95 },
  { lat: -50.0, lon: -135.0, rad: 0.46, swirl: -3.00, comma: 1.0 },
  // South Atlantic Subtropical Wave
  { lat: -28.0, lon: -18.0, rad: 0.32, swirl: -1.90, comma: 0.70 }
];

// Precompute 3D unit vectors and tangent frames for cyclones
for (const c of CYCLONES) {
  const phi = (c.lat * Math.PI) / 180.0;
  const lam = (c.lon * Math.PI) / 180.0;
  c.cx = Math.cos(phi) * Math.cos(lam);
  c.cy = Math.sin(phi);
  c.cz = Math.cos(phi) * Math.sin(lam);
}

// Evaluate global meteorological cloud density & top altitude at (lonDeg, latDeg, sdfKm)
function evaluatePlanetaryCloudAt(lonDeg, latDeg, sdfKm) {
  const latRad = (latDeg * Math.PI) / 180.0;
  const lonRad = (lonDeg * Math.PI) / 180.0;
  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);

  // 3D unit sphere coordinate (zero seams at +-180 deg or poles!)
  let sx = cosLat * Math.cos(lonRad);
  let sy = sinLat;
  let sz = cosLat * Math.sin(lonRad);

  // 1. Synoptic Coriolis Vortex Warping & Comma-Cloud Frontal Bands
  let frontalBoost = 0.0;
  let cycloneTopBoost = 0.0;

  for (let i = 0; i < CYCLONES.length; i++) {
    const c = CYCLONES[i];
    const dot = sx * c.cx + sy * c.cy + sz * c.cz;
    if (dot > 0.65) {
      const angDist = Math.acos(Math.min(1.0, dot));
      const rNorm = angDist / c.rad;
      if (rNorm < 2.2) {
        // Rotate (sx, sy, sz) around cyclone axis (cx, cy, cz) by vortex swirl angle
        const falloff = Math.exp(-rNorm * rNorm * 1.15);
        const theta = c.swirl * falloff * (1.0 - 0.15 * Math.log(rNorm + 0.08));
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        // Rodrigues' rotation formula around c.(cx, cy, cz)
        const crossX = c.cy * sz - c.cz * sy;
        const crossY = c.cz * sx - c.cx * sz;
        const crossZ = c.cx * sy - c.cy * sx;
        sx = sx * cosT + crossX * sinT + c.cx * dot * (1.0 - cosT);
        sy = sy * cosT + crossY * sinT + c.cy * dot * (1.0 - cosT);
        sz = sz * cosT + crossZ * sinT + c.cz * dot * (1.0 - cosT);

        // Comma-shaped frontal condensation spiral arm
        const eyeHole = smoothstep(0.03, 0.14, rNorm);
        frontalBoost += c.comma * falloff * eyeHole * 0.58;
        cycloneTopBoost = Math.max(cycloneTopBoost, falloff * eyeHole * 0.65);
      }
    }
  }

  // 2. 3D Atmospheric Curl-Warp (Fluid Advection)
  const w1x = noise.fbm3(sx * 2.8 + 1.3, sy * 2.8 - 2.1, sz * 2.8 + 0.7, 3);
  const w1y = noise.fbm3(sx * 2.8 - 4.2, sy * 2.8 + 1.8, sz * 2.8 - 1.5, 3);
  const w1z = noise.fbm3(sx * 2.8 + 2.9, sy * 2.8 + 3.4, sz * 2.8 - 2.8, 3);

  const wx = sx + w1x * 0.24;
  const wy = sy + w1y * 0.24;
  const wz = sz + w1z * 0.24;

  // 3. Climatological Envelope:
  // A) ITCZ (Intertropical Convergence Zone) meandering around 6..11 deg N (passes over Colombia/Caribbean!)
  const itczCenterLat = 7.2 + 4.5 * noise.simplex3(sx * 2.2, sy * 2.2, sz * 2.2);
  const distItcz = Math.abs(latDeg - itczCenterLat);
  const itczBand = Math.exp(-(distItcz * distItcz) / (2.0 * 7.8 * 7.8));

  // B) Mid-Latitude Storm Tracks (35..62 deg N & S)
  const absLat = Math.abs(latDeg);
  const stormTrack = Math.exp(-Math.pow((absLat - 48.0) / 14.5, 2.0));

  // C) Subtropical High-Pressure Dry Zones (Sahara, Arabia, Atacama, Leeward Guajira)
  let dryMask = 0.0;
  // Sahara & Arabian Desert clearing
  if (latDeg > 14 && latDeg < 34 && lonDeg > -15 && lonDeg < 58 && sdfKm < 0) {
    dryMask += 0.65 * smoothstep(0, -180, sdfKm);
  }
  // Guajira / Falcon leeward dry clearing (NE of Santa Marta)
  const dGuajira = Math.hypot((lonDeg - (-71.5)) * 111.0, (latDeg - 12.2) * 111.0);
  dryMask += 0.45 * Math.exp(-(dGuajira * dGuajira) / (2.0 * 160.0 * 160.0));

  // D) Orographic Condensation along Andes, Sierra Nevada de Santa Marta, Central America & Coastal Margins
  let orographic = 0.0;
  if (sdfKm <= 30.0 && sdfKm >= -350.0) {
    const coastalBelt = Math.exp(-Math.pow((sdfKm + 35.0) / 65.0, 2.0));
    orographic += coastalBelt * 0.22;
  }
  // Colombian / South American Andes & Chocó convergence
  const dChoco = Math.hypot((lonDeg - (-76.8)) * 111.0, (latDeg - 5.5) * 111.0);
  orographic += 0.42 * Math.exp(-(dChoco * dChoco) / (2.0 * 240.0 * 240.0));
  const dSantaMarta = Math.hypot((lonDeg - (-73.7)) * 111.0, (latDeg - 10.8) * 111.0);
  orographic += 0.35 * Math.exp(-(dSantaMarta * dSantaMarta) / (2.0 * 65.0 * 65.0));

  // 4. Multi-Scale Cloud Structure (Macro Synoptic + Mesoscale Cellular Billows + Micro Cumulus)
  const synoptic = noise.fbm3(wx * 3.4, wy * 3.4, wz * 3.4, 4) * 0.5 + 0.5;
  const filaments = noise.ridged3(wx * 5.6 + 3.1, wy * 5.6 - 1.4, wz * 5.6 + 2.2, 4);
  const cellular = noise.billow3(wx * 14.5, wy * 14.5, wz * 14.5, 4);
  const finePuffs = noise.billow3(sx * 38.0 + w1x * 1.8, sy * 38.0 + w1y * 1.8, sz * 38.0 + w1z * 1.8, 3);

  // Combine climatological drivers with turbulent fluid textures
  const baseClim = 0.22 + 0.38 * itczBand + 0.36 * stormTrack + frontalBoost + orographic - dryMask;
  const rawCloud = synoptic * 0.48 + filaments * 0.26 + cellular * 0.26 + (baseClim - 0.42);

  // Sculpt crisp, realistic cloud clusters with clear sky gaps between systems
  let density = smoothstep(0.34, 0.76, rawCloud);
  // Carve cellular cumulus and fibrous edges
  density *= mix(0.55, 1.08, finePuffs * 0.65 + cellular * 0.35);
  density = clamp(density, 0.0, 1.0);

  // 5. Anchor the Barranquilla / Sabanilla Supercell (130 km North of 11.01N, -74.89W -> approx 12.18N, -74.89W)
  // So from space, the planetary map has the exact same Supercell anvil at the exact same location!
  const stormLat = 12.18;
  const stormLon = -74.89;
  const dxStormKm = (lonDeg - stormLon) * 111.32 * cosLat;
  const dzStormKm = (latDeg - stormLat) * 111.32;
  const rAnvil = Math.hypot((dxStormKm - 8.0) / 42.0, dzStormKm / 26.0);
  if (rAnvil < 1.35) {
    const anvilShield = smoothstep(1.30, 0.25, rAnvil);
    density = Math.max(density, anvilShield * 0.95);
  }

  // Cloud top altitude normalized [0..1] (maps to 1.8 km .. 16.0 km)
  const topNorm = clamp(
    0.15 + density * 0.45 + itczBand * 0.22 + cycloneTopBoost * 0.25 + (rAnvil < 1.2 ? smoothstep(1.2, 0.2, rAnvil) * 0.45 : 0.0),
    0.0,
    1.0
  );

  return { density, topNorm };
}

console.log('2/4 Generating Global Planetary Cloud Map (2048x1024)...');
const globalDensity = new Float32Array(GW * GH);
const globalTop = new Float32Array(GW * GH);

for (let y = 0; y < GH; y++) {
  const latDeg = ((y + 0.5) / GH) * 180.0 - 90.0;
  for (let x = 0; x < GW; x++) {
    const lonDeg = ((x + 0.5) / GW) * 360.0 - 180.0;
    const idx = y * GW + x;
    const sdfKm = globalSdf[idx];
    const { density, topNorm } = evaluatePlanetaryCloudAt(lonDeg, latDeg, sdfKm);
    globalDensity[idx] = density;
    globalTop[idx] = topNorm;
  }
}

// Compute spatial optical gradients (dTau/dX, dTau/dY) for instant 3D self-shadowing in 1 texture read
const globalRGBA = new Uint8Array(GW * GH * 4);
for (let y = 0; y < GH; y++) {
  const yUp = Math.min(GH - 1, y + 1);
  const yDn = Math.max(0, y - 1);
  for (let x = 0; x < GW; x++) {
    const xRt = (x + 1) % GW;
    const xLt = (x - 1 + GW) % GW;
    const idx = y * GW + x;

    const d = globalDensity[idx];
    const h = globalTop[idx];

    // Effective optical relief = density * (0.4 + 0.6 * topNorm)
    const rRt = globalDensity[y * GW + xRt] * (0.4 + 0.6 * globalTop[y * GW + xRt]);
    const rLt = globalDensity[y * GW + xLt] * (0.4 + 0.6 * globalTop[y * GW + xLt]);
    const rUp = globalDensity[yUp * GW + x] * (0.4 + 0.6 * globalTop[yUp * GW + x]);
    const rDn = globalDensity[yDn * GW + x] * (0.4 + 0.6 * globalTop[yDn * GW + x]);

    const gradX = clamp((rRt - rLt) * 2.2, -1.0, 1.0);
    const gradY = clamp((rUp - rDn) * 2.2, -1.0, 1.0);

    const pIdx = idx * 4;
    globalRGBA[pIdx + 0] = Math.round(clamp(d, 0.0, 1.0) * 255);
    globalRGBA[pIdx + 1] = Math.round(clamp(h, 0.0, 1.0) * 255);
    globalRGBA[pIdx + 2] = Math.round((gradX * 0.5 + 0.5) * 255);
    globalRGBA[pIdx + 3] = Math.round((gradY * 0.5 + 0.5) * 255);
  }
}

// ---------------------------------------------------------------------------
// 5. REGIONAL CARIBBEAN MESOSCALE WEATHER & DETAIL MAP (1024x1024, 500x500 km)
// ---------------------------------------------------------------------------
console.log('3/4 Generating Regional Caribbean Mesoscale Weather Map (1024x1024)...');
const RW = 1024;
const RH = 1024;
const DOMAIN_KM = 500.0; // -250 km to +250 km around Barranquilla (11.01N, -74.89W)
const ORIGIN_LAT = 11.01;
const ORIGIN_LON = -74.89;
const COS_ORIGIN = Math.cos((ORIGIN_LAT * Math.PI) / 180.0);

const regionalRGBA = new Uint8Array(RW * RH * 4);

for (let y = 0; y < RH; y++) {
  const v = (y + 0.5) / RH; // 0..1
  // In world coordinates: u maps to X (-250..+250 km East), v maps to Z (-250..+250 km South)
  const worldZ = (v - 0.5) * DOMAIN_KM;
  const latDeg = ORIGIN_LAT - (worldZ / 111.32); // -Z is North (+lat), +Z is South (-lat)

  for (let x = 0; x < RW; x++) {
    const u = (x + 0.5) / RW;
    const worldX = (u - 0.5) * DOMAIN_KM;
    const lonDeg = ORIGIN_LON + worldX / (111.32 * COS_ORIGIN);

    // 1. Sample global planetary cloud at this exact (lon, lat) for 100% seamless outer transition
    const gx = Math.floor(((lonDeg + 180.0) / 360.0) * GW) & (GW - 1);
    const gy = Math.max(0, Math.min(GH - 1, Math.floor(((latDeg + 90.0) / 180.0) * GH)));
    const gIdx = gy * GW + gx;
    const planetaryCov = globalDensity[gIdx];

    // 2. Mesoscale Caribbean Trade-Wind Cumulus Clusters (ZERO sin() waves! Pure Curl + Cellular Billow)
    const nx = worldX * 0.014;
    const nz = worldZ * 0.014;
    const warpX = noise.fbm3(nx + 4.1, nz - 2.3, 1.7, 3) * 1.4;
    const warpZ = noise.fbm3(nx - 3.7, nz + 5.2, -1.9, 3) * 1.4;

    // Trade-wind directional shear (NE to SW: ~28 deg) without any periodic sine waves
    const tx = (nx + warpX) * 0.88 - (nz + warpZ) * 0.47;
    const tz = (nx + warpX) * 0.47 + (nz + warpZ) * 0.88;

    const macroCluster = noise.fbm3(tx * 0.65, tz * 1.15, 0.5, 4) * 0.5 + 0.5;
    const cellPuffs = noise.billow3(nx * 2.8 + warpX * 0.5, nz * 2.8 + warpZ * 0.5, 2.3, 4);
    const microBillow = noise.billow3(worldX * 0.085, worldZ * 0.085, 5.1, 3);

    let localCov = smoothstep(0.38, 0.78, macroCluster * 0.62 + cellPuffs * 0.38) * 0.72;

    // Keep a natural clear viewing corridor immediately in front of the coastal balcony (r < 18 km)
    const distOrigin = Math.hypot(worldX, worldZ);
    const clearBalcony = smoothstep(8.0, 26.0, distOrigin);
    localCov *= clearBalcony;

    // Seamless blend into the planetary cloud field between 135 km and 210 km
    const outerBlend = smoothstep(135.0, 210.0, distOrigin);
    const finalCov = clamp(mix(localCov, planetaryCov, outerBlend), 0.0, 1.0);

    // Cloud Base Altitude: 1.75 km to 2.25 km (encoded as baseAlt / 10.0)
    const baseAltKm = 1.75 + 0.35 * (noise.simplex3(nx * 0.8, nz * 0.8, 9.2) * 0.5 + 0.5);
    // Cloud Top Altitude: 2.6 km for humilis up to 5.2 km for mediocris/congestus (encoded as topAlt / 10.0)
    const topAltKm = baseAltKm + 0.85 + finalCov * 3.1;

    const pIdx = (y * RW + x) * 4;
    regionalRGBA[pIdx + 0] = Math.round(finalCov * 255);
    regionalRGBA[pIdx + 1] = Math.round(clamp(baseAltKm / 10.0, 0.0, 1.0) * 255);
    regionalRGBA[pIdx + 2] = Math.round(clamp(topAltKm / 10.0, 0.0, 1.0) * 255);
    regionalRGBA[pIdx + 3] = Math.round(clamp(microBillow, 0.0, 1.0) * 255);
  }
}

console.log('4/4 Encoding and saving static PNG assets to public/...');
const publicDir = path.join(ROOT_DIR, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const planetaryPng = encodeRGBAtoPNG(GW, GH, globalRGBA);
const planetaryPath = path.join(publicDir, 'planetary-clouds.png');
fs.writeFileSync(planetaryPath, planetaryPng);

const regionalPng = encodeRGBAtoPNG(RW, RH, regionalRGBA);
const regionalPath = path.join(publicDir, 'regional-weather.png');
fs.writeFileSync(regionalPath, regionalPng);

console.log(`Done! Saved:
  - ${planetaryPath} (${(planetaryPng.length / 1024).toFixed(1)} KB)
  - ${regionalPath} (${(regionalPng.length / 1024).toFixed(1)} KB)`);
