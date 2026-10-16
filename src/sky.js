// src/sky.js
// True Infinite Celestial Vault, Milky Way Galactic Panorama, Astronomical Star Catalog,
// 1 AU Heliocentric Sun & Orbiting 3D Moon
// - Stars, Milky Way, Sun, and Moon remain 100% visible at any orbital distance from Earth
// - Includes real navigation stars (Sirius, Canopus, Orion, Southern Cross, Scorpius, etc.) + 9,000 galactic stars
// - Simulates realistic nocturnal atmosphere & coastal light pollution at midnight

import * as THREE from 'three';
import gsap from 'gsap';
import { createRng, NOISE_GLSL } from './noise.js';
import {
  AU_KM,
  MOON_ORBIT_KM,
  ATMOSPHERE_CONSTANTS_GLSL,
  ATMOSPHERE_GLSL,
  atmosphereUniforms,
  updateAtmosphereCamera,
  setAtmosphereSun,
  setAtmosphereMoon
} from './atmosphere.js';

export const EARTH_RADIUS = 6371.0; // km
export { AU_KM, MOON_ORBIT_KM };

export const TIME_PRESETS = {
  sunrise: {
    name: 'Amanecer',
    realSunDir: new THREE.Vector3(0.990, 0.044, -0.134).normalize(),
    moonDir: new THREE.Vector3(-0.84, 0.26, -0.47).normalize(),
    sunPos: new THREE.Vector3(0.990, 0.044, -0.134).normalize(),
    sunIrradiance: 20.0,
    sunDiskRadiance: 17.5,
    moonIrradiance: 0.025,
    exposure: 0.50,
    sunTint: new THREE.Vector3(1.0, 0.94, 0.86),
    hemiIntensity: 0.45,
    sunColor: 0xffd2a6,
    sunIntensity: 2.2,
    zenithColor: 0x1d3557,
    horizonColor: 0xfdbb74,
    groundHazeColor: 0x64748b,
    hemiSky: 0x93c5fd,
    hemiGround: 0x1e293b,
    waterColor: 0x183a54,
    starsOpacity: 0.18
  },
  noon: {
    name: 'Mediodía',
    realSunDir: new THREE.Vector3(0.16, 0.94, -0.30).normalize(),
    moonDir: new THREE.Vector3(-0.55, -0.68, 0.48).normalize(),
    sunPos: new THREE.Vector3(0.16, 0.94, -0.30).normalize(),
    sunIrradiance: 20.0,
    sunDiskRadiance: 18.0,
    moonIrradiance: 0.01,
    exposure: 0.45,
    sunTint: new THREE.Vector3(1.0, 1.0, 1.0),
    hemiIntensity: 0.55,
    sunColor: 0xfffdf5,
    sunIntensity: 2.6,
    zenithColor: 0x0284c7,
    horizonColor: 0xcbe3f7,
    groundHazeColor: 0x64748b,
    hemiSky: 0xdbeafe,
    hemiGround: 0x0c4a6e,
    waterColor: 0x0284c7,
    starsOpacity: 0.0
  },
  sunset: {
    name: 'Atardecer',
    realSunDir: new THREE.Vector3(-0.925, 0.036, -0.378).normalize(),
    moonDir: new THREE.Vector3(0.68, 0.48, -0.55).normalize(),
    sunPos: new THREE.Vector3(-0.925, 0.036, -0.378).normalize(),
    sunIrradiance: 20.0,
    sunDiskRadiance: 17.0,
    moonIrradiance: 0.045,
    exposure: 0.52,
    sunTint: new THREE.Vector3(1.0, 0.90, 0.78),
    hemiIntensity: 0.42,
    sunColor: 0xffb37a,
    sunIntensity: 2.0,
    zenithColor: 0x1e293b,
    horizonColor: 0xf97316,
    groundHazeColor: 0x334155,
    hemiSky: 0x7dd3fc,
    hemiGround: 0x0f172a,
    waterColor: 0x1e293b,
    starsOpacity: 0.35
  },
  midnight: {
    name: 'Medianoche',
    // True Heliocentric Midnight: Sun at full 1 AU power on the antipodal hemisphere (y = -0.95)
    realSunDir: new THREE.Vector3(0.14, -0.95, 0.28).normalize(),
    // Orbiting Moon illuminating the Caribbean night sky
    moonDir: new THREE.Vector3(-0.28, 0.76, -0.58).normalize(),
    sunPos: new THREE.Vector3(-0.28, 0.76, -0.58).normalize(),
    sunIrradiance: 20.0,
    sunDiskRadiance: 18.0,
    moonIrradiance: 0.11,
    exposure: 1.55,
    sunTint: new THREE.Vector3(1.0, 0.98, 0.95),
    hemiIntensity: 0.22,
    sunColor: 0x93c5fd,
    sunIntensity: 0.25,
    zenithColor: 0x040917,
    horizonColor: 0x0c1930,
    groundHazeColor: 0x060d1d,
    hemiSky: 0x1e293b,
    hemiGround: 0x040914,
    waterColor: 0x020a14,
    starsOpacity: 1.0
  }
};

// Real Bright Astronomical Star Catalog (RA hours, Dec degrees, Vmag, B-V color index)
// Includes Orion, Canis Major (Sirius), Carina (Canopus), Crux (Southern Cross), Centaurus, Scorpius, Lyra, Cygnus, Taurus, Ursa Major
const BRIGHT_STAR_CATALOG = [
  [6.752, -16.716, -1.46,  0.00], // Sirius (Alpha CMa)
  [6.399, -52.695, -0.74,  0.15], // Canopus (Alpha Car)
  [14.660, -60.834, -0.27, 0.71], // Alpha Centauri
  [14.261, 19.182, -0.05,  1.23], // Arcturus (Alpha Boo)
  [18.615, 38.783,  0.03,  0.00], // Vega (Alpha Lyr)
  [5.278,  45.998,  0.08,  0.80], // Capella (Alpha Aur)
  [5.242,  -8.201,  0.13, -0.03], // Rigel (Beta Ori)
  [7.655,   5.225,  0.34,  0.42], // Procyon (Alpha CMi)
  [1.628, -57.236,  0.46, -0.16], // Achernar (Alpha Eri)
  [5.919,   7.407,  0.50,  1.85], // Betelgeuse (Alpha Ori)
  [14.063, -60.373, 0.61, -0.23], // Hadar (Beta Cen)
  [19.846,  8.868,  0.76,  0.22], // Altair (Alpha Aql)
  [12.443, -63.099, 0.77, -0.24], // Acrux (Alpha Cru - Southern Cross)
  [4.598,  16.509,  0.86,  1.54], // Aldebaran (Alpha Tau)
  [16.490, -26.432, 0.96,  1.83], // Antares (Alpha Sco)
  [13.419, -11.161, 0.97, -0.23], // Spica (Alpha Vir)
  [7.755,  28.026,  1.14,  1.00], // Pollux (Beta Gem)
  [22.960, -29.622, 1.16,  0.09], // Fomalhaut (Alpha PsA)
  [20.690, 45.280,  1.25,  0.09], // Deneb (Alpha Cyg)
  [12.795, -59.688, 1.25, -0.23], // Mimosa (Beta Cru)
  [10.139, 11.967,  1.36, -0.11], // Regulus (Alpha Leo)
  [6.977, -28.972,  1.50, -0.21], // Adhara (Epsilon CMa)
  [7.576,  31.888,  1.58,  0.03], // Castor (Alpha Gem)
  [12.519, -57.113, 1.64,  1.59], // Gacrux (Gamma Cru)
  [17.560, -37.103, 1.62, -0.22], // Shaula (Lambda Sco)
  [5.418,   6.349,  1.64, -0.22], // Bellatrix (Gamma Ori)
  [5.438,  28.607,  1.65, -0.13], // Elnath (Beta Tau)
  [9.220, -69.717,  1.67,  0.00], // Miaplacidus (Beta Car)
  [5.603,  -1.201,  1.69, -0.18], // Alnilam (Epsilon Ori - Belt)
  [5.679,  -1.942,  1.77, -0.21], // Alnitak (Zeta Ori - Belt)
  [5.533,  -0.299,  2.23, -0.21], // Mintaka (Delta Ori - Belt)
  [5.796,  -9.669,  2.06, -0.18], // Saiph (Kappa Ori)
  [11.062, 61.751,  1.79,  1.07], // Dubhe (Alpha UMa)
  [12.900, 55.959,  1.77,  0.02], // Alioth (Epsilon UMa)
  [13.792, 49.313,  1.86, -0.19], // Alkaid (Eta UMa)
  [2.530,  89.264,  1.98,  0.60]  // Polaris (Alpha UMi)
];

function bvToRgb(bv) {
  // Ballesteros blackbody approximation from B-V index
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  let r = 1.0, g = 1.0, b = 1.0;
  if (t > 6600) {
    r = THREE.MathUtils.clamp(0.72 + 0.28 * (6600 / t), 0.68, 1.0);
    g = THREE.MathUtils.clamp(0.82 + 0.18 * (6600 / t), 0.78, 1.0);
    b = 1.0;
  } else {
    r = 1.0;
    g = THREE.MathUtils.clamp(0.45 + 0.55 * ((t - 2800) / 3800), 0.52, 1.0);
    b = THREE.MathUtils.clamp(0.20 + 0.80 * ((t - 3200) / 3400), 0.30, 1.0);
  }
  return [r, g, b];
}

export function createAtmosphericSky(bakes) {
  const transLUT = (bakes && bakes.transLUT) ? bakes.transLUT : bakes;
  if (transLUT) {
    atmosphereUniforms.uTransLUT.value = transLUT;
  }

  const group = new THREE.Group();
  group.name = 'atmospheric-sky';

  // Galactic coordinate basis (inclined 62.87° to celestial equator, galactic center in Sagittarius)
  const galX = new THREE.Vector3(-0.0548, -0.8734, -0.4838).normalize();
  const galY = new THREE.Vector3( 0.4941, -0.4448,  0.7470).normalize();
  const galZ = new THREE.Vector3(-0.8676, -0.1980,  0.4560).normalize();
  const galMat = new THREE.Matrix3().set(
    galX.x, galX.y, galX.z,
    galY.x, galY.y, galY.z,
    galZ.x, galZ.y, galZ.z
  );

  // 1. Infinite Celestial Vault & Milky Way Panorama + Atmospheric Scattering Dome
  const skyGeo = new THREE.SphereGeometry(500, 64, 40);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      ...atmosphereUniforms,
      uStarsOpacity: { value: 0.0 },
      uGalMat: { value: galMat }
    },
    vertexShader: /* glsl */`
      varying vec3 vRayDir;
      void main() {
        vRayDir = normalize(position);
        vec4 viewPos = viewMatrix * vec4(cameraPosition + position, 1.0);
        gl_Position = projectionMatrix * viewPos;
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      varying vec3 vRayDir;
      uniform float uStarsOpacity;
      uniform mat3 uGalMat;
      ${NOISE_GLSL}
      ${ATMOSPHERE_CONSTANTS_GLSL}
      ${ATMOSPHERE_GLSL}

      #define SKY_STEPS 10

      // Realistic Milky Way Galactic Band & Dark Dust Rifts
      vec3 evaluateMilkyWay(vec3 rd){
        vec3 g = normalize(uGalMat * rd);
        float galLat = asin(clamp(g.z, -1.0, 1.0));
        float galLon = atan(g.y, g.x);

        // Galactic plane concentration (sech^2 profile + bulge around galactic center galLon = 0)
        float band = exp(-abs(galLat) * 6.8) + 0.35 * exp(-abs(galLat) * 2.4);
        float coreBulge = exp(-(galLon * galLon) / 0.85) * exp(-(galLat * galLat) / 0.065);

        vec3 p = g * 3.8;
        float starClouds = fbm3(p, 4) * 0.5 + 0.5;
        float fineClouds = fbm3(g * 11.5, 3) * 0.5 + 0.5;

        // Great Rift dark interstellar dust lanes along the galactic equator
        float dustLane = smoothstep(0.38, 0.72, fbm3(g * 6.2 + vec3(2.4, -1.7, 0.9), 4) * 0.5 + 0.5)
                       * exp(-abs(galLat) * 18.0);

        float mwIntensity = (band * (0.35 + 0.85 * starClouds) + coreBulge * (0.65 + 0.65 * fineClouds))
                          * (1.0 - 0.72 * dustLane);

        vec3 coreGold = vec3(0.24, 0.19, 0.14);
        vec3 armBlue  = vec3(0.09, 0.14, 0.24);
        vec3 mwCol    = mix(armBlue, coreGold, clamp(coreBulge * 1.2 + starClouds * 0.3, 0.0, 1.0));
        return mwCol * mwIntensity * 0.42;
      }

      void main(){
        vec3 rd = normalize(vRayDir);
        vec3 localSunDir = getSunDirAt(uCamPos);
        Atmo a = atmosphereMarch(uCamAlt, uCamUp, rd, localSunDir, 1e9, SKY_STEPS);
        vec3 col = a.inscatter;

        float h = max(uCamAlt, 0.0);
        float r = R_EARTH + h;
        float mu = dot(uCamUp, rd);
        float rMu = r * mu;
        float cG = h * (2.0 * R_EARTH + h);
        float discE = rMu * rMu - cG;

        bool hitsEarth = (rMu < 0.0 && discE > 0.0);

        if (hitsEarth) {
          // Sub-horizon solid Earth proxy
          float tHit = -rMu - sqrt(discE);
          vec3 pWorld = uCamPos + rd * tHit;
          vec3 pN = normalize(uCamUp * r + rd * tHit);
          vec3 pSun = getSunDirAt(pWorld);
          vec3 sunCol = sunTransmittance(0.0, dot(pN, pSun)) * uSunIrradiance;
          vec3 water = (vec3(0.006, 0.032, 0.088) / PI) * (sunCol * max(dot(pN, pSun), 0.0) + col * 0.65);
          col = water * a.transmittance + a.inscatter;
        } else {
          // 1. Deep-Space Milky Way Panorama (visible at night AND in space outside Earth's disk!)
          float localSunElev = dot(uCamUp, localSunDir);
          float nightFactor = smoothstep(0.08, -0.10, localSunElev);
          float spaceFactor = smoothstep(14.0, 48.0, h);
          float skyDarkness = clamp(1.0 - dot(col, vec3(0.8, 0.9, 1.0)) * 2.2, 0.0, 1.0);
          float mwVis = max(max(uStarsOpacity, nightFactor), spaceFactor) * skyDarkness;

          vec3 T_space = spaceAwareTransmittance(h, uCamUp, rd);
          if (mwVis > 0.005) {
            col += evaluateMilkyWay(rd) * T_space * mwVis;
          }

          // 2. Astronomical 1 AU Solar Disk & Corona
          float cSun = max(0.0, dot(rd, localSunDir));
          vec3 TSun = spaceAwareTransmittance(h, uCamUp, localSunDir);
          vec3 sunCorona = uSunTint * TSun * (pow(cSun, 450.0) * 0.65 + pow(cSun, 45.0) * 0.06) * (uSunIrradiance / 20.0);
          col += sunDisk(rd) + sunCorona;

          // 3. Orbiting 3D Moon Disk (384,400 km) & Lunar Atmospheric Halo
          vec3 localMoonDir = getMoonDirAt(uCamPos);
          float cMoon = max(0.0, dot(rd, localMoonDir));
          vec3 TMoon = spaceAwareTransmittance(h, uCamUp, localMoonDir);
          float moonMask = 0.0;
          vec3 mDisk = moonDisk(rd, uCamPos, moonMask);
          float phase = 0.5 * (1.0 - dot(localSunDir, localMoonDir));
          vec3 moonCorona = uMoonTint * TMoon * (pow(cMoon, 600.0) * 0.22 + pow(cMoon, 55.0) * 0.028) * phase;
          col = col * (1.0 - moonMask * 0.88) + mDisk + moonCorona;
        }

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false
  });

  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyDome.frustumCulled = false;
  skyDome.renderOrder = -2;
  group.add(skyDome);

  // 2. Realistic Star Map: Catalog Navigation Stars + 9,000 Galactic-Distributed Stars
  const rng = createRng(1987);
  const procStarCount = 9000;
  const totalStars = BRIGHT_STAR_CATALOG.length + procStarCount;

  const starGeo = new THREE.BufferGeometry();
  const starDirs = new Float32Array(totalStars * 3);
  const starColors = new Float32Array(totalStars * 3);
  const starSizes = new Float32Array(totalStars);

  // 2A. Populate Real Bright Catalog Stars
  for (let i = 0; i < BRIGHT_STAR_CATALOG.length; i++) {
    const [raHours, decDeg, vMag, bv] = BRIGHT_STAR_CATALOG[i];
    const ra = (raHours / 24.0) * Math.PI * 2.0;
    const dec = (decDeg * Math.PI) / 180.0;

    const dx = Math.cos(dec) * Math.cos(ra);
    const dy = Math.sin(dec);
    const dz = -Math.cos(dec) * Math.sin(ra);

    starDirs[i * 3]     = dx * 500.0;
    starDirs[i * 3 + 1] = dy * 500.0;
    starDirs[i * 3 + 2] = dz * 500.0;

    // Apparent brightness from V magnitude
    const flux = Math.pow(10.0, -0.4 * (vMag - 0.5));
    const br = THREE.MathUtils.clamp(0.75 + 0.45 * flux, 0.8, 1.8);
    const [cr, cg, cb] = bvToRgb(bv);

    starColors[i * 3]     = cr * br;
    starColors[i * 3 + 1] = cg * br;
    starColors[i * 3 + 2] = cb * br;
    starSizes[i] = THREE.MathUtils.clamp(2.8 - vMag * 0.65, 2.0, 4.6);
  }

  // Inverse transpose of galMat to transform galactic coordinates back to world sky coordinates
  const invGalMat = galMat.clone().invert();
  const tmpVec = new THREE.Vector3();

  // 2B. Populate 9,000 Galactic-Plane + All-Sky Stars
  for (let k = 0; k < procStarCount; k++) {
    const i = BRIGHT_STAR_CATALOG.length + k;
    const galLon = rng() * Math.PI * 2.0;

    // 62% of stars concentrated near the Milky Way galactic plane, 38% isotropic all-sky
    let sinLat;
    if (rng() < 0.62) {
      const u = (rng() * 2.0 - 1.0);
      sinLat = Math.tanh(u * 1.8) * 0.38 * (rng() + 0.35);
      sinLat = THREE.MathUtils.clamp(sinLat, -1.0, 1.0);
    } else {
      sinLat = rng() * 2.0 - 1.0;
    }
    const cosLat = Math.sqrt(Math.max(0.0, 1.0 - sinLat * sinLat));

    tmpVec.set(
      cosLat * Math.cos(galLon),
      cosLat * Math.sin(galLon),
      sinLat
    ).applyMatrix3(invGalMat).normalize();

    starDirs[i * 3]     = tmpVec.x * 500.0;
    starDirs[i * 3 + 1] = tmpVec.y * 500.0;
    starDirs[i * 3 + 2] = tmpVec.z * 500.0;

    const mag = Math.pow(rng(), 2.8);
    starSizes[i] = 1.05 + mag * 2.65;

    // Realistic stellar population B-V color distribution
    const rSpec = rng();
    const bv = rSpec > 0.88 ? (1.1 + rng() * 0.6) : (rSpec > 0.55 ? (0.4 + rng() * 0.5) : (-0.2 + rng() * 0.4));
    const [cr, cg, cb] = bvToRgb(bv);
    const br = 0.40 + 0.60 * mag;

    starColors[i * 3]     = cr * br;
    starColors[i * 3 + 1] = cg * br;
    starColors[i * 3 + 2] = cb * br;
  }

  starGeo.setAttribute('position', new THREE.BufferAttribute(starDirs, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSizes, 1));

  const starMat = new THREE.ShaderMaterial({
    uniforms: {
      ...atmosphereUniforms,
      uStarsOpacity: { value: 0.0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) }
    },
    vertexShader: /* glsl */`
      attribute vec3 color;
      attribute float aSize;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying vec3 vRayDir;
      void main() {
        vColor = color;
        vRayDir = normalize(position);
        vec4 mvPosition = viewMatrix * vec4(cameraPosition + position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = aSize * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      uniform float uStarsOpacity;
      varying vec3 vColor;
      varying vec3 vRayDir;
      ${ATMOSPHERE_CONSTANTS_GLSL}
      ${ATMOSPHERE_GLSL}

      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r2 = dot(c, c);
        if (r2 > 0.25) discard;

        vec3 rd = normalize(vRayDir);
        float h = max(uCamAlt, 0.0);

        // 1. Space-aware Earth occlusion & atmospheric limb transmittance!
        // In deep space, any star outside the Earth's solid disk gets T = vec3(1.0) and is NEVER clipped!
        vec3 starTrans = spaceAwareTransmittance(h, uCamUp, rd);
        if (dot(starTrans, vec3(0.333)) <= 0.005) discard;

        // 2. Occlude stars behind the 1 AU Sun disk & orbiting Moon disk
        vec3 localSunDir  = getSunDirAt(uCamPos);
        vec3 localMoonDir = getMoonDirAt(uCamPos);
        if (dot(rd, localSunDir) > 0.9990) discard;
        if (dot(rd, localMoonDir) > 0.99995) discard;

        // 3. Stars are visible at night OR in the thin upper atmosphere/space (>14 km)
        float localSunElev = dot(uCamUp, localSunDir);
        float nightSkyFactor = smoothstep(0.08, -0.10, localSunElev);
        float spaceVis = smoothstep(12.0, 42.0, h);
        float vis = max(max(uStarsOpacity, nightSkyFactor), spaceVis);
        if (vis < 0.01) discard;

        float alpha = exp(-r2 * 13.5) * vis;
        gl_FragColor = vec4(vColor * starTrans * 1.65, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false
  });

  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -1;
  group.add(stars);

  const current = {
    realSunDir: TIME_PRESETS.noon.realSunDir.clone(),
    moonDir: TIME_PRESETS.noon.moonDir.clone(),
    sunPos: TIME_PRESETS.noon.sunPos.clone(),
    sunIrradiance: TIME_PRESETS.noon.sunIrradiance,
    sunDiskRadiance: TIME_PRESETS.noon.sunDiskRadiance,
    moonIrradiance: TIME_PRESETS.noon.moonIrradiance,
    exposure: TIME_PRESETS.noon.exposure,
    sunTint: TIME_PRESETS.noon.sunTint.clone(),
    hemiIntensity: TIME_PRESETS.noon.hemiIntensity,
    sunColor: new THREE.Color(TIME_PRESETS.noon.sunColor),
    zenithColor: new THREE.Color(TIME_PRESETS.noon.zenithColor),
    horizonColor: new THREE.Color(TIME_PRESETS.noon.horizonColor),
    groundHazeColor: new THREE.Color(TIME_PRESETS.noon.groundHazeColor),
    hemiSky: new THREE.Color(TIME_PRESETS.noon.hemiSky),
    hemiGround: new THREE.Color(TIME_PRESETS.noon.hemiGround),
    waterColor: new THREE.Color(TIME_PRESETS.noon.waterColor),
    sunIntensity: TIME_PRESETS.noon.sunIntensity,
    starsOpacity: TIME_PRESETS.noon.starsOpacity
  };

  let moonOrbitAngle = 0.0;
  let lastRenderTime = performance.now();
  const orbitAxis = new THREE.Vector3(0.12, 0.92, 0.37).normalize();
  const animatedMoonDir = new THREE.Vector3();

  skyDome.onBeforeRender = (renderer, scene, camera) => {
    const now = performance.now();
    const dt = Math.min((now - lastRenderTime) * 0.001, 0.1);
    lastRenderTime = now;

    moonOrbitAngle += dt * 0.0045;
    animatedMoonDir.copy(current.moonDir).applyAxisAngle(orbitAxis, moonOrbitAngle).normalize();

    const phase = 0.5 * (1.0 - current.realSunDir.dot(animatedMoonDir));
    const effectiveMoonIrr = current.moonIrradiance * (0.25 + 0.75 * phase);

    setAtmosphereMoon(animatedMoonDir, effectiveMoonIrr);
    updateAtmosphereCamera(camera);
    starMat.uniforms.uStarsOpacity.value = current.starsOpacity;
    skyMat.uniforms.uStarsOpacity.value = current.starsOpacity;
  };

  let activeTween = null;

  function transitionToTime(timeKey, duration = 2.0, onProgress = null) {
    const target = TIME_PRESETS[timeKey] || TIME_PRESETS.noon;
    if (activeTween) activeTween.kill();

    const startRealSun = current.realSunDir.clone();
    const endRealSun   = target.realSunDir.clone();
    const startMoon    = current.moonDir.clone();
    const endMoon      = target.moonDir.clone();
    const startPos     = current.sunPos.clone();
    const endPos       = target.sunPos.clone();

    const startIrr     = current.sunIrradiance;
    const endIrr       = target.sunIrradiance;
    const startDisk    = current.sunDiskRadiance;
    const endDisk      = target.sunDiskRadiance;
    const startMoonIrr = current.moonIrradiance;
    const endMoonIrr   = target.moonIrradiance;
    const startExp     = current.exposure;
    const endExp       = target.exposure;
    const startTint    = current.sunTint.clone();
    const endTint      = target.sunTint.clone();

    const startSunCol  = current.sunColor.clone();
    const endSunCol    = new THREE.Color(target.sunColor);
    const startHemiSky = current.hemiSky.clone();
    const endHemiSky   = new THREE.Color(target.hemiSky);
    const startHemiGnd = current.hemiGround.clone();
    const endHemiGnd   = new THREE.Color(target.hemiGround);
    const startWater   = current.waterColor.clone();
    const endWater     = new THREE.Color(target.waterColor);

    const startHemiInt = current.hemiIntensity;
    const startSunInt  = current.sunIntensity;
    const startStars   = current.starsOpacity;

    const animObj = { progress: 0 };
    activeTween = gsap.to(animObj, {
      progress: 1.0,
      duration,
      ease: 'power2.inOut',
      onUpdate: () => {
        const p = animObj.progress;

        current.realSunDir.copy(startRealSun).lerp(endRealSun, p);
        if (current.realSunDir.lengthSq() < 1e-4) {
          current.realSunDir.set(1.0, 0.0, 0.0);
        } else {
          current.realSunDir.normalize();
        }

        current.moonDir.copy(startMoon).lerp(endMoon, p).normalize();
        current.sunPos.copy(startPos).lerp(endPos, p).normalize();

        current.sunIrradiance   = THREE.MathUtils.lerp(startIrr, endIrr, p);
        current.sunDiskRadiance = THREE.MathUtils.lerp(startDisk, endDisk, p);
        current.moonIrradiance  = THREE.MathUtils.lerp(startMoonIrr, endMoonIrr, p);
        current.exposure        = THREE.MathUtils.lerp(startExp, endExp, p);
        current.sunTint.lerpVectors(startTint, endTint, p);
        current.hemiIntensity   = THREE.MathUtils.lerp(startHemiInt, target.hemiIntensity, p);
        current.sunIntensity    = THREE.MathUtils.lerp(startSunInt, target.sunIntensity, p);
        current.starsOpacity    = THREE.MathUtils.lerp(startStars, target.starsOpacity, p);

        setAtmosphereSun(current.realSunDir, current.sunIrradiance, current.sunDiskRadiance, current.sunTint);
        setAtmosphereMoon(current.moonDir, current.moonIrradiance);

        current.sunColor.copy(startSunCol).lerp(endSunCol, p);
        current.hemiSky.copy(startHemiSky).lerp(endHemiSky, p);
        current.hemiGround.copy(startHemiGnd).lerp(endHemiGnd, p);
        current.waterColor.copy(startWater).lerp(endWater, p);

        starMat.uniforms.uStarsOpacity.value = current.starsOpacity;
        skyMat.uniforms.uStarsOpacity.value = current.starsOpacity;

        if (onProgress) {
          onProgress(current, target.name);
        }
      }
    });

    return target;
  }

  setAtmosphereSun(current.realSunDir, current.sunIrradiance, current.sunDiskRadiance, current.sunTint);
  setAtmosphereMoon(current.moonDir, current.moonIrradiance);

  return {
    group,
    skyDome,
    skyMat,
    starMat,
    current,
    transitionToTime
  };
}