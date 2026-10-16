// scripts/test-atmo-values.mjs
import * as THREE from 'three';
import { sunTransmittanceJS } from '../src/atmosphere.js';

const R_EARTH = 6371.0;
const H_ATM = 100.0;
const H_RAY = 8.0;
const H_MIE = 1.2;
const BETA_R = [5.802e-3, 13.558e-3, 33.100e-3];
const BETA_M_SCA = 3.996e-3;
const BETA_M_EXT = 4.440e-3;
const BETA_O = [0.650e-3, 1.881e-3, 0.085e-3];

function extinctionAt(alt) {
  const dR = Math.exp(-alt / H_RAY);
  const dM = Math.exp(-alt / H_MIE);
  const dO = Math.max(0.0, 1.0 - Math.abs(alt - 25.0) / 15.0);
  return [
    BETA_R[0] * dR + BETA_M_EXT * dM + BETA_O[0] * dO,
    BETA_R[1] * dR + BETA_M_EXT * dM + BETA_O[1] * dO,
    BETA_R[2] * dR + BETA_M_EXT * dM + BETA_O[2] * dO
  ];
}

function rayleighPhase(c) {
  return (3.0 / (16.0 * Math.PI)) * (1.0 + c * c);
}

function miePhase(c, g = 0.8) {
  const g2 = g * g;
  return (3.0 / (8.0 * Math.PI)) * ((1.0 - g2) / (2.0 + g2)) * (1.0 + c * c) / Math.pow(1.0 + g2 - 2.0 * g * c, 1.5);
}

function march(camAlt, rd, sunDir, steps = 24, uSkyGain = 3.2, uSunIrradiance = 22.0) {
  const camUp = [0, 1, 0];
  const h = Math.max(camAlt, 0.0);
  const r = R_EARTH + h;
  const mu = rd[1]; // dot(camUp, rd)
  const rMu = r * mu;
  const cG = h * (2.0 * R_EARTH + h);
  const cT = (h - H_ATM) * (2.0 * R_EARTH + h + H_ATM);

  const discT = rMu * rMu - cT;
  if (discT <= 0) return { inscatter: [0, 0, 0] };
  const sq = Math.sqrt(discT);
  const t0 = Math.max(0.0, -rMu - sq);
  let t1 = -rMu + sq;

  const discE = rMu * rMu - cG;
  if (rMu < 0.0 && discE > 0.0) {
    t1 = Math.min(t1, -rMu - Math.sqrt(discE));
  }

  const L = t1 - t0;
  const cosS = rd[0]*sunDir[0] + rd[1]*sunDir[1] + rd[2]*sunDir[2];
  const phR = rayleighPhase(cosS);
  const phM = miePhase(cosS, 0.8);
  const camMuSun = sunDir[1];

  let T = [1, 1, 1];
  let sumS = [0, 0, 0];
  let sumMS = [0, 0, 0];

  for (let i = 0; i < steps; i++) {
    const u0 = i / steps;
    const u1 = (i + 1) / steps;
    const ta = t0 + L * u0 * u0;
    const tb = t0 + L * u1 * u1;
    const tm = 0.5 * (ta + tb);
    const ds = tb - ta;

    const q = cG + 2.0 * rMu * tm + tm * tm;
    const rt = Math.sqrt(q + R_EARTH * R_EARTH);
    const alt = Math.max(q / (rt + R_EARTH), 0.0);

    const dR = Math.exp(-alt / H_RAY);
    const dM = Math.exp(-alt / H_MIE);
    const ext = extinctionAt(alt);
    const Ts = [Math.exp(-ext[0] * ds), Math.exp(-ext[1] * ds), Math.exp(-ext[2] * ds)];

    const muSun = (r * camMuSun + tm * cosS) / rt;
    const Tsun = sunTransmittanceJS(alt, muSun);

    for (let c = 0; c < 3; c++) {
      const TsunC = c === 0 ? Tsun.r : (c === 1 ? Tsun.g : Tsun.b);
      const Sc = (BETA_R[c] * dR * phR + BETA_M_SCA * dM * phM) * TsunC * uSunIrradiance;
      const Smc = (BETA_R[c] * dR + BETA_M_SCA * dM) * (1.0 / (4.0 * Math.PI)) * TsunC * uSunIrradiance;
      const inv = 1.0 / Math.max(ext[c], 1e-7);

      sumS[c] += T[c] * (Sc - Sc * Ts[c]) * inv;
      sumMS[c] += T[c] * (Smc - Smc * Ts[c]) * inv;
      T[c] *= Ts[c];
    }
  }

  const uMSGain = 0.25;
  return {
    inscatter: [
      (sumS[0] + uMSGain * sumMS[0]) * uSkyGain,
      (sumS[1] + uMSGain * sumMS[1]) * uSkyGain,
      (sumS[2] + uMSGain * sumMS[2]) * uSkyGain
    ],
    transmittance: T
  };
}

const sunDir = new THREE.Vector3(800, 4200, -2400).normalize();
const sunDirArr = [sunDir.x, sunDir.y, sunDir.z];

console.log('--- RADIANCE AT uSkyGain = 3.2 ---');
console.log('Zenith [0, 1, 0]:', march(0.025, [0, 1, 0], sunDirArr, 24, 3.2).inscatter);
console.log('Horizon [0, 0, -1]:', march(0.025, [0, 0, -1], sunDirArr, 24, 3.2).inscatter);
console.log('45 deg [0, 0.707, -0.707]:', march(0.025, [0, 0.707, -0.707], sunDirArr, 24, 3.2).inscatter);

console.log('--- RADIANCE AT uSkyGain = 1.0 ---');
console.log('Zenith [0, 1, 0]:', march(0.025, [0, 1, 0], sunDirArr, 24, 1.0).inscatter);
console.log('Horizon [0, 0, -1]:', march(0.025, [0, 0, -1], sunDirArr, 24, 1.0).inscatter);
console.log('45 deg [0, 0.707, -0.707]:', march(0.025, [0, 0.707, -0.707], sunDirArr, 24, 1.0).inscatter);
