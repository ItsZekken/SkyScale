// scripts/test-geo.mjs
import fs from 'node:fs';
import { rasterizeLand, computeSignedDistanceKm } from '../src/geo.js';

console.log('[test-geo] Starting geographical validation test suite...');

const landJsonPath = 'src/data/land50.json';
if (!fs.existsSync(landJsonPath)) {
  console.error(`[test-geo] Missing ${landJsonPath}. Run node scripts/prepare-geo.mjs first.`);
  process.exit(1);
}

const landJson = JSON.parse(fs.readFileSync(landJsonPath, 'utf8'));

// 1. Regional Grid (1024x768, bbox [-84, 4, -66, 18], kmPerPx = 0.98)
const regBBox = [-84, 4, -66, 18];
const regW = 1024, regH = 768, regKm = 0.98;
console.log('[test-geo] Rasterizing regional grid (1024x768)...');
const regMask = rasterizeLand(regW, regH, regBBox, landJson);
const regSDF = computeSignedDistanceKm(regMask, regW, regH, regKm);

function sampleReg(lat, lon) {
  const x = Math.round(((lon - regBBox[0]) / (regBBox[2] - regBBox[0])) * regW - 0.5);
  const y = Math.round(((lat - regBBox[1]) / (regBBox[3] - regBBox[1])) * regH - 0.5);
  const cx = Math.max(0, Math.min(regW - 1, x));
  const cy = Math.max(0, Math.min(regH - 1, y));
  return regSDF[cy * regW + cx];
}

// 2. Global Grid (1024x512, bbox [-180, -90, 180, 90], kmPerPx = 25.0)
const globBBox = [-180, -90, 180, 90];
const globW = 1024, globH = 512, globKm = 25.0;
console.log('[test-geo] Rasterizing global grid (1024x512)...');
const globMask = rasterizeLand(globW, globH, globBBox, landJson);
const globSDF = computeSignedDistanceKm(globMask, globW, globH, globKm);

function sampleGlob(lat, lon) {
  const x = Math.round(((lon - globBBox[0]) / (globBBox[2] - globBBox[0])) * globW - 0.5);
  const y = Math.round(((lat - globBBox[1]) / (globBBox[3] - globBBox[1])) * globH - 0.5);
  const cx = Math.max(0, Math.min(globW - 1, x));
  const cy = Math.max(0, Math.min(globH - 1, y));
  return globSDF[cy * globW + cx];
}

let hasError = false;

// Check Water Points: MUST HAVE SDF > 0 (Water)
const waterPoints = [
  [11.60, -74.90],
  [12.30, -76.00],
  [13.50, -75.00],
  [11.30, -75.80],
  [14.00, -70.00]
];

console.log('\n--- 1. Testing Water Points (SDF > 0 expected) ---');
for (const [lat, lon] of waterPoints) {
  const val = sampleReg(lat, lon);
  const pass = val > 0;
  console.log(`Water point (${lat.toFixed(2)}°N, ${lon.toFixed(2)}°W): SDF = ${val.toFixed(1)} km [${pass ? 'PASS' : 'FAIL'}]`);
  if (!pass) hasError = true;
}

// Check Land Points: MUST HAVE SDF < 0 (Land)
// Regional check: Bogota, Maracaibo, Caracas, Panama
const regionalLand = [
  ['Bogota', 4.71, -74.07],
  ['Maracaibo', 10.64, -71.64],
  ['Caracas', 10.50, -66.90],
  ['Panama City', 8.98, -79.52]
];

console.log('\n--- 2. Testing Regional Land Points (SDF < 0 expected) ---');
for (const [name, lat, lon] of regionalLand) {
  const val = sampleReg(lat, lon);
  const pass = val < 0;
  console.log(`${name} (${lat.toFixed(2)}°N, ${lon.toFixed(2)}°W): SDF = ${val.toFixed(1)} km [${pass ? 'PASS' : 'FAIL'}]`);
  if (!pass) hasError = true;
}

// Global check: Santo Domingo, La Habana
const globalLand = [
  ['Santo Domingo', 18.49, -69.93],
  ['La Habana', 23.11, -82.37]
];

console.log('\n--- 3. Testing Global Land Points (SDF < 0 expected) ---');
for (const [name, lat, lon] of globalLand) {
  const val = sampleGlob(lat, lon);
  const pass = val < 0;
  console.log(`${name} (${lat.toFixed(2)}°N, ${lon.toFixed(2)}°W): SDF = ${val.toFixed(1)} km [${pass ? 'PASS' : 'FAIL'}]`);
  if (!pass) hasError = true;
}

if (hasError) {
  console.error('\n[test-geo] FAILED: One or more geographic validation points failed.');
  process.exit(1);
} else {
  console.log('\n[test-geo] ALL GEOGRAPHICAL VALIDATION CHECKS PASSED (Exit Code 0).');
  process.exit(0);
}
