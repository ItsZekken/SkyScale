// scripts/test-noise.mjs
import { createNoise } from '../src/noise.js';

console.log('[test-noise] Starting noise test suite...');

// 1. Determinism
const noiseA = createNoise(12345);
const noiseB = createNoise(12345);
const noiseC = createNoise(54321);

for (let i = 0; i < 100; i++) {
  const x = (i * 0.137) % 10;
  const y = (i * 0.311) % 10;
  const vA = noiseA.simplex2(x, y);
  const vB = noiseB.simplex2(x, y);
  if (vA !== vB) {
    console.error(`[test-noise] Determinism FAIL at (${x}, ${y}): ${vA} !== ${vB}`);
    process.exit(1);
  }
}
console.log('✓ Determinism verified across independent instances with identical seed.');

// Different seeds should produce different outputs
let diffCount = 0;
for (let i = 0; i < 20; i++) {
  const x = i * 0.5 + 1.2;
  const y = i * 0.7 - 0.9;
  if (noiseA.simplex2(x, y) !== noiseC.simplex2(x, y)) {
    diffCount++;
  }
}
if (diffCount < 18) {
  console.error('[test-noise] Different seeds failed to produce divergent noise values.');
  process.exit(1);
}
console.log('✓ Seed divergence verified.');

// 2. Simplex2 range [-1, 1]
const testNoise = createNoise(42);
let minS = 1e9, maxS = -1e9;
for (let i = 0; i < 50000; i++) {
  const x = (i * 0.23) % 200 - 100;
  const y = (i * 0.47) % 200 - 100;
  const val = testNoise.simplex2(x, y);
  if (val < minS) minS = val;
  if (val > maxS) maxS = val;
  if (val < -1.0001 || val > 1.0001) {
    console.error(`[test-noise] Simplex2 out of bounds [-1, 1]: ${val} at (${x}, ${y})`);
    process.exit(1);
  }
}
console.log(`✓ Simplex2 range verified: [${minS.toFixed(4)}, ${maxS.toFixed(4)}] ∈ [-1, 1].`);

// 3. Ridged range [0, ~1.2]
let minR = 1e9, maxR = -1e9;
for (let i = 0; i < 50000; i++) {
  const x = (i * 0.19) % 200 - 100;
  const y = (i * 0.37) % 200 - 100;
  const val = testNoise.ridged(x, y);
  if (val < minR) minR = val;
  if (val > maxR) maxR = val;
  if (val < -1e-6 || val > 1.3) {
    console.error(`[test-noise] Ridged out of bounds [0, 1.3]: ${val} at (${x}, ${y})`);
    process.exit(1);
  }
}
console.log(`✓ Ridged range verified: [${minR.toFixed(4)}, ${maxR.toFixed(4)}] ∈ [0, 1.2].`);

// 4. Mean of FBM over 10^5 samples ∈ (-0.05, 0.05)
let sumFbm = 0;
const N_SAMPLES = 100000;
for (let i = 0; i < N_SAMPLES; i++) {
  const x = (i * 0.173) % 1000;
  const y = (i * 0.289) % 1000;
  sumFbm += testNoise.fbm(x, y);
}
const meanFbm = sumFbm / N_SAMPLES;
if (Math.abs(meanFbm) > 0.05) {
  console.error(`[test-noise] FBM mean outside (-0.05, 0.05): ${meanFbm}`);
  process.exit(1);
}
console.log(`✓ FBM 10^5 sample mean verified: ${meanFbm.toFixed(5)} ∈ (-0.05, 0.05).`);

// 5. Worley distance ordering f1 <= f2
for (let i = 0; i < 1000; i++) {
  const x = i * 0.31;
  const y = i * 0.77;
  const { f1, f2 } = testNoise.worley(x, y);
  if (f1 > f2) {
    console.error(`[test-noise] Worley f1 > f2: f1=${f1}, f2=${f2}`);
    process.exit(1);
  }
}
console.log('✓ Worley f1 <= f2 ordering verified.');

console.log('[test-noise] ALL NOISE TESTS PASSED SUCCESSFULLY (Exit Code 0).');
process.exit(0);
