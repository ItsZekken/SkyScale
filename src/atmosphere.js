// src/atmosphere.js
// Single source of truth for Heliocentric 1 AU Solar Scattering, Orbiting Lunar Scattering,
// Space-Aware Vacuum Transmittance, and Nocturnal Airglow + Urban Light Pollution

import * as THREE from 'three';

export const AU_KM = 149597870.7;
export const MOON_ORBIT_KM = 384400.0;

export const ATMOSPHERE_CONSTANTS_GLSL = /* glsl */`
#ifndef PI
#define PI 3.141592653589793
#endif
const float R_EARTH          = 6371.0;
const float H_ATM            = 100.0;
const float H_RAY            = 8.0;
const float H_MIE            = 1.2;
const float AU_KM            = 149597870.7;
const float INV_AU_KM        = 1.0 / 149597870.7;
const float MOON_ORBIT_KM    = 384400.0;
const float INV_MOON_ORBIT   = 1.0 / 384400.0;
const vec3  BETA_R           = vec3(5.802e-3, 13.558e-3, 33.100e-3);
const float BETA_M_SCA       = 3.996e-3;
const float BETA_M_EXT       = 4.440e-3;
const vec3  BETA_O           = vec3(0.650e-3, 1.881e-3, 0.085e-3);

vec3 extinctionAt(float alt){
  float dR = exp(-alt / H_RAY);
  float dM = exp(-alt / H_MIE);
  float dO = max(0.0, 1.0 - abs(alt - 25.0) / 15.0);
  return BETA_R * dR + vec3(BETA_M_EXT * dM) + BETA_O * dO;
}

float altitudeAboveSea(vec3 w){
  float q = w.x * w.x + w.z * w.z + w.y * (w.y + 2.0 * R_EARTH);
  float rt = sqrt(max(q + R_EARTH * R_EARTH, 1.0));
  return q / (rt + R_EARTH);
}
`;

export const ATMOSPHERE_GLSL = /* glsl */`
uniform sampler2D uTransLUT;
uniform float uCamAlt;
uniform vec3  uCamUp;
uniform vec3  uCamPos;
uniform vec3  uSunDir;
uniform float uSunIrradiance;
uniform float uSunDiskRadiance;
uniform vec3  uSunTint;
uniform vec3  uMoonDir;
uniform float uMoonIrradiance;
uniform vec3  uMoonTint;
uniform float uMSGain;
uniform float uSkyGain;

// Exact vector toward the physical Sun at 1 AU (149,597,870.7 km) from any world position P
vec3 getSunDirAt(vec3 worldPos){
  vec3 relEarthCenter = vec3(worldPos.x, worldPos.y + R_EARTH, worldPos.z);
  return normalize(uSunDir - relEarthCenter * INV_AU_KM);
}

// Exact vector toward the orbiting Moon at 384,400 km from any world position P
vec3 getMoonDirAt(vec3 worldPos){
  vec3 relEarthCenter = vec3(worldPos.x, worldPos.y + R_EARTH, worldPos.z);
  return normalize(uMoonDir - relEarthCenter * INV_MOON_ORBIT);
}

vec2 transUv(float alt, float muS){
  return vec2(0.5 + 0.5 * sign(muS) * sqrt(abs(muS)), sqrt(clamp(alt / H_ATM, 0.0, 1.0)));
}

vec3 sunTransmittance(float alt, float muS){
  return texture2D(uTransLUT, transUv(alt, muS)).rgb;
}

// Space-aware transmittance along ray 'dir' from any altitude (0 m up to 35,000+ km in deep space!)
// Fixes the bug where stars, Sun, and Moon disappeared when zooming out in space
vec3 spaceAwareTransmittance(float alt, vec3 up, vec3 dir){
  float h = max(alt, 0.0);
  float mu = dot(up, dir);
  if (h <= H_ATM) {
    return sunTransmittance(h, mu);
  }
  float r = R_EARTH + h;
  float rMu = r * mu;
  // If pointing away from Earth, ray is 100% in vacuum above the atmosphere
  if (rMu >= 0.0) return vec3(1.0);

  // Closest approach squared to Earth's center: rMin^2 = r^2 * (1 - mu^2)
  float sin2 = max(0.0, 1.0 - mu * mu);
  float rMin = r * sqrt(sin2);
  if (rMin < R_EARTH) return vec3(0.0); // Occluded by solid Earth
  if (rMin >= R_EARTH + H_ATM) return vec3(1.0); // Passes completely above atmosphere in vacuum

  // Ray grazes the atmospheric limb at tangent altitude hMin
  float hMin = max(0.0, rMin - R_EARTH);
  vec3 tHalf = sunTransmittance(hMin, 0.0);
  return tHalf * tHalf;
}

// Combined direct solar (1 AU) + lunar irradiance at altitude alt and surface normal/up vector
vec3 evalDirectCelestialLight(float alt, vec3 up, vec3 worldPos, out vec3 primaryLightDir){
  vec3 sDir = getSunDirAt(worldPos);
  vec3 mDir = getMoonDirAt(worldPos);
  float muS = dot(up, sDir);
  float muM = dot(up, mDir);
  vec3 sunRad  = sunTransmittance(alt, muS) * uSunIrradiance * uSunTint;
  vec3 moonRad = sunTransmittance(alt, muM) * uMoonIrradiance * uMoonTint;
  primaryLightDir = (dot(sunRad, vec3(0.333)) >= dot(moonRad, vec3(0.333))) ? sDir : mDir;
  return sunRad + moonRad;
}

float rayleighPhase(float c){
  return 3.0 / (16.0 * PI) * (1.0 + c * c);
}

float miePhase(float c, float g){
  float g2 = g * g;
  return 3.0 / (8.0 * PI) * (1.0 - g2) / (2.0 + g2) * (1.0 + c * c) / pow(max(1e-3, 1.0 + g2 - 2.0 * g * c), 1.5);
}

struct Atmo {
  vec3 inscatter;
  vec3 transmittance;
};

// Float32-stable spherical atmosphere integrator (works seamlessly from 25 m POV to 35,000 km orbit)
// Includes 1 AU Solar scattering, Orbiting Lunar scattering, Night Airglow & Urban Light Pollution
Atmo atmosphereMarch(float camAlt, vec3 camUp, vec3 rd, vec3 sunDir, float tMax, int steps){
  Atmo res;
  res.inscatter = vec3(0.0);
  res.transmittance = vec3(1.0);

  float h = max(camAlt, 0.0);
  float r = R_EARTH + h;
  float mu = dot(camUp, rd);
  float rMu = r * mu;
  float cG = h * (2.0 * R_EARTH + h);
  float cT = (h - H_ATM) * (2.0 * R_EARTH + h + H_ATM);

  float discT = rMu * rMu - cT;
  if (discT <= 0.0) return res;

  float sq = sqrt(discT);
  float t0 = max(0.0, -rMu - sq);
  float t1 = -rMu + sq;
  if (t1 <= 0.0) return res;

  // Only clip against analytical Earth sphere when marching to sky infinity (tMax > 1e6)
  // For surface meshes (tMax = distToSurface), tMax is already the exact surface hit!
  if (tMax > 1e6) {
    float discE = rMu * rMu - cG;
    if (rMu < 0.0 && discE > 0.0) {
      t1 = min(t1, -rMu - sqrt(discE));
    }
  }
  t1 = min(t1, tMax);
  if (t1 <= t0) return res;

  // Shift ray origin to t0 (entry point into the 100 km atmosphere shell)
  // This prevents float32 catastrophic cancellation when camera is 15,000+ km away in space!
  vec3 P0 = uCamUp * r + rd * t0;
  float r0 = length(P0);
  float h0 = max(0.0, r0 - R_EARTH);
  vec3 up0 = P0 / max(r0, 1.0);
  float r0Mu = r0 * dot(up0, rd);
  float cG0 = h0 * (2.0 * R_EARTH + h0);

  // Dampen the backscattering lobe when viewing the globe from space so no bright spot follows the camera
  float spaceDamp = 1.0 - 0.45 * smoothstep(15.0, 120.0, h);
  float cosS = dot(rd, sunDir);
  float phRS = 3.0 / (16.0 * PI) * (1.0 + cosS * cosS * spaceDamp);
  float phMS = min(miePhase(cosS, 0.62), 0.52);

  float cosM = dot(rd, uMoonDir);
  float phRM = 3.0 / (16.0 * PI) * (1.0 + cosM * cosM * spaceDamp);
  float phMM = min(miePhase(cosM, 0.62), 0.50);

  float L = t1 - t0;
  vec3 T = vec3(1.0);
  vec3 sumSunS  = vec3(0.0);
  vec3 sumSunMS = vec3(0.0);
  vec3 sumMoonS = vec3(0.0);
  vec3 sumNight = vec3(0.0);

  // Coastal urban light pollution factor (centered near Barranquilla/Sabanilla origin)
  float camDistOrigin = length(uCamPos.xz);
  float urbanProximity = exp(-(camDistOrigin * camDistOrigin) / (85.0 * 85.0));

  int effSteps = min(steps, 10);
  for (int i = 0; i < 10; i++) {
    if (i >= effSteps) break;
    // Uniform midpoint quadrature works equally well looking up from ground OR down from space
    float uMid = (float(i) + 0.5) / float(effSteps);
    float ds = L / float(effSteps);
    float s = uMid * L;

    float q = cG0 + 2.0 * r0Mu * s + s * s;
    float rt = sqrt(max(q + R_EARTH * R_EARTH, R_EARTH * R_EARTH));
    float alt = max(q / (rt + R_EARTH), 0.0);

    float dR = exp(-alt / H_RAY);
    float dM = exp(-alt / H_MIE);
    vec3 ext = extinctionAt(alt);
    vec3 Ts = exp(-ext * ds);
    vec3 inv = 1.0 / max(ext, vec3(1e-7));

    vec3 sampleUp = (P0 + rd * s) / rt;

    // 1. 1 AU Solar in-scattering
    float muSun = dot(sampleUp, sunDir);
    vec3 Tsun = sunTransmittance(alt, muSun);
    vec3 S_sun  = (BETA_R * dR * phRS + vec3(BETA_M_SCA * dM * phMS)) * Tsun * uSunIrradiance;
    vec3 Sm_sun = (BETA_R * dR + vec3(BETA_M_SCA * dM)) * (1.0 / (4.0 * PI)) * Tsun * uSunIrradiance;

    sumSunS  += T * (S_sun - S_sun * Ts) * inv;
    sumSunMS += T * (Sm_sun - Sm_sun * Ts) * inv;

    // 2. Orbiting Moon in-scattering
    if (uMoonIrradiance > 1e-4) {
      float muMoon = dot(sampleUp, uMoonDir);
      vec3 Tmoon = sunTransmittance(alt, muMoon);
      vec3 S_moon = (BETA_R * dR * phRM + vec3(BETA_M_SCA * dM * phMM)) * Tmoon * (uMoonIrradiance * 1.45);
      sumMoonS += T * (S_moon - S_moon * Ts) * inv;
    }

    // 3. Nocturnal Atmosphere: Night Sky Rayleigh + Upper Airglow + Barranquilla Urban Light Pollution
    float nightMask = smoothstep(0.12, -0.08, muSun);
    if (nightMask > 0.001) {
      // Natural nocturnal Rayleigh & starlight continuum
      vec3 nightRayleigh = BETA_R * dR * vec3(0.055, 0.105, 0.245);
      // Warm sodium/LED coastal urban light dome scattered in the lower 2.5 km aerosol layer
      float urbanHeight = exp(-alt / 2.2);
      vec3 lightPollution = (BETA_R * dR * 0.4 + vec3(BETA_M_SCA * dM * 1.25))
                          * urbanHeight * urbanProximity * vec3(0.115, 0.068, 0.032);
      // Subtle mesospheric airglow layer around 85 km
      float airglowLayer = exp(-pow((alt - 82.0) / 12.0, 2.0));
      vec3 airglow = vec3(0.00018, 0.00042, 0.00038) * airglowLayer;

      vec3 S_night = (nightRayleigh + lightPollution + airglow) * nightMask;
      sumNight += T * (S_night - S_night * Ts) * inv;
    }

    T *= Ts;
  }

  vec3 rawSolar = (sumSunS + uMSGain * sumSunMS) * uSunTint * uSkyGain;
  vec3 rawLunar = sumMoonS * uMoonTint * uSkyGain;
  vec3 rawInscatter = rawSolar + rawLunar + sumNight;

  // Controlled soft HDR shoulder prevents blinding white blowout near the solar disk
  res.inscatter = rawInscatter / (1.0 + rawInscatter * 0.28);
  res.transmittance = T;
  return res;
}

vec3 applyAerialPerspective(vec3 surfaceRadiance, vec3 camWorld, vec3 fragWorld, int steps){
  vec3 d = fragWorld - camWorld;
  float dist = length(d);
  vec3 rd = d / max(dist, 1e-5);
  vec3 localSunDir = getSunDirAt(fragWorld);
  Atmo a = atmosphereMarch(uCamAlt, uCamUp, rd, localSunDir, dist, min(steps, 5));
  return surfaceRadiance * a.transmittance + a.inscatter;
}

// Physical 1 AU Solar Disk (visible both from ground AND from deep space!)
vec3 sunDisk(vec3 rd){
  vec3 localSun = getSunDirAt(uCamPos);
  float c = dot(rd, localSun);
  // Angular radius 0.2666 deg (slightly widened anti-aliased edge so it never sub-pixel flickers in space)
  float x = (1.0 - c) / (1.0 - 0.999985);
  if (x >= 1.0) return vec3(0.0);
  float limb = 1.0 - 0.6 * (1.0 - sqrt(max(0.0, 1.0 - x)));
  vec3 T = spaceAwareTransmittance(uCamAlt, uCamUp, rd);
  return min(uSunDiskRadiance * limb * uSunTint * T, vec3(3.2));
}

float moonHash(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

float moonNoise(vec3 x){
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(moonHash(i + vec3(0,0,0)), moonHash(i + vec3(1,0,0)), f.x),
        mix(moonHash(i + vec3(0,1,0)), moonHash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(moonHash(i + vec3(0,0,1)), moonHash(i + vec3(1,0,1)), f.x),
        mix(moonHash(i + vec3(0,1,1)), moonHash(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

// Physical Orbiting Moon Disk (visible from ground AND from deep space!)
vec3 moonDisk(vec3 rd, vec3 camWorldPos, out float moonMask){
  moonMask = 0.0;
  vec3 mDir = getMoonDirAt(camWorldPos);
  const float cosMoonRadius = 0.999968;
  const float sinMoonRadius = 0.008000;

  float c = dot(rd, mDir);
  if (c <= cosMoonRadius) return vec3(0.0);

  float u2 = (1.0 - c * c) / (sinMoonRadius * sinMoonRadius);
  if (u2 >= 1.0) return vec3(0.0);

  // Check if Moon is occluded behind solid Earth
  vec3 T = spaceAwareTransmittance(uCamAlt, uCamUp, rd);
  if (dot(T, vec3(0.333)) <= 1e-4) return vec3(0.0);

  moonMask = smoothstep(1.0, 0.90, u2);
  float z = sqrt(max(0.0, 1.0 - u2));

  vec3 upRef = (abs(mDir.y) < 0.99) ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 right = normalize(cross(upRef, mDir));
  vec3 up    = cross(mDir, right);

  vec3 perp = rd - mDir * c;
  float px = dot(perp, right) / sinMoonRadius;
  float py = dot(perp, up)    / sinMoonRadius;

  vec3 nLocal = vec3(px, py, -z);
  vec3 nWorld = normalize(right * px + up * py - mDir * z);

  // Selenographic albedo: Highlands + Basaltic Maria
  float n1 = moonNoise(nLocal * 3.2) * 0.55 + moonNoise(nLocal * 7.5) * 0.30 + moonNoise(nLocal * 18.0) * 0.15;
  float mareBasins = smoothstep(0.46, 0.62, n1 + 0.12 * nLocal.x + 0.08 * nLocal.y);
  float craters = smoothstep(0.65, 0.85, moonNoise(nLocal * 28.0));
  vec3 highlands = vec3(0.78, 0.77, 0.74) + 0.12 * craters;
  vec3 maria     = vec3(0.30, 0.32, 0.36);
  vec3 albedo    = mix(highlands, maria, mareBasins * 0.78);

  vec3 nPerturbed = normalize(nWorld + (n1 - 0.5) * 0.14 * (right + up));

  // True 1 AU Solar illumination on the Moon sphere
  float ndotl = max(0.0, dot(nPerturbed, uSunDir));
  float ndotv = max(0.05, z);
  float lommel = ndotl / (ndotl + ndotv * 0.65 + 1e-4);
  float terminator = smoothstep(-0.02, 0.06, dot(nWorld, uSunDir));

  vec3 earthshine = vec3(0.045, 0.068, 0.115) * (1.0 - terminator);
  vec3 moonRad = albedo * (lommel * terminator * 1.75 * uSunTint + earthshine) * T * moonMask;
  return min(moonRad, vec3(1.90));
}
`;

export const TRANSMITTANCE_BAKE_FRAG = /* glsl */`
varying vec2 vUv;
${ATMOSPHERE_CONSTANTS_GLSL}
void main(){
  float alt = vUv.y * vUv.y * H_ATM;
  float s = vUv.x * 2.0 - 1.0;
  float muS = sign(s) * s * s;

  float h = alt;
  float r = R_EARTH + h;
  float rMu = r * muS;
  float cG = h * (2.0 * R_EARTH + h);
  float cT = (h - H_ATM) * (2.0 * R_EARTH + h + H_ATM);

  float discE = rMu * rMu - cG;
  if (rMu < 0.0 && discE > 0.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float t1 = -rMu + sqrt(max(rMu * rMu - cT, 0.0));
  float dt = t1 / 48.0;
  vec3 tau = vec3(0.0);
  for (int i = 0; i < 48; i++) {
    float tm = (float(i) + 0.5) * dt;
    float q = cG + 2.0 * rMu * tm + tm * tm;
    float rt = sqrt(q + R_EARTH * R_EARTH);
    tau += extinctionAt(max(q / (rt + R_EARTH), 0.0)) * dt;
  }
  gl_FragColor = vec4(exp(-tau), 1.0);
}
`;

export const atmosphereUniforms = {
  uTransLUT: { value: null },
  uCamAlt: { value: 0.025 },
  uCamUp: { value: new THREE.Vector3(0, 1, 0) },
  uCamPos: { value: new THREE.Vector3(0, 0.025, 0) },
  uSunDir: { value: new THREE.Vector3(0.16, 0.94, -0.30).normalize() },
  uSunIrradiance: { value: 20.0 },
  uSunDiskRadiance: { value: 15.0 },
  uSunTint: { value: new THREE.Vector3(1, 1, 1) },
  uMoonDir: { value: new THREE.Vector3(-0.26, 0.84, -0.48).normalize() },
  uMoonIrradiance: { value: 0.06 },
  uMoonTint: { value: new THREE.Vector3(0.68, 0.80, 1.0) },
  uMSGain: { value: 0.20 },
  uSkyGain: { value: 1.65 }
};

export function updateAtmosphereCamera(camera) {
  const R = 6371.0;
  const cx = camera.position.x;
  const cy = camera.position.y + R;
  const cz = camera.position.z;
  const len = Math.hypot(cx, cy, cz);
  atmosphereUniforms.uCamAlt.value = Math.max(0, len - R);
  atmosphereUniforms.uCamUp.value.set(cx / len, cy / len, cz / len);
  atmosphereUniforms.uCamPos.value.copy(camera.position);
}

export function setAtmosphereSun(sunDir, irradiance = 20.0, diskRadiance = 18.0, tint = new THREE.Vector3(1, 1, 1)) {
  atmosphereUniforms.uSunDir.value.copy(sunDir).normalize();
  atmosphereUniforms.uSunIrradiance.value = irradiance;
  atmosphereUniforms.uSunDiskRadiance.value = Math.min(diskRadiance, 24.0);
  atmosphereUniforms.uSunTint.value.copy(tint);
}

export function setAtmosphereMoon(moonDir, moonIrradiance = 0.06, tint = new THREE.Vector3(0.68, 0.80, 1.0)) {
  atmosphereUniforms.uMoonDir.value.copy(moonDir).normalize();
  atmosphereUniforms.uMoonIrradiance.value = moonIrradiance;
  atmosphereUniforms.uMoonTint.value.copy(tint);
}

export function sunTransmittanceJS(altKm, muS) {
  const R_EARTH = 6371.0;
  const H_ATM = 100.0;
  const H_RAY = 8.0;
  const H_MIE = 1.2;
  const BETA_R = [5.802e-3, 13.558e-3, 33.100e-3];
  const BETA_M_EXT = 4.440e-3;
  const BETA_O = [0.650e-3, 1.881e-3, 0.085e-3];

  const h = Math.max(0.0, altKm);
  const r = R_EARTH + h;
  const rMu = r * muS;
  const cG = h * (2.0 * R_EARTH + h);
  const cT = (h - H_ATM) * (2.0 * R_EARTH + h + H_ATM);

  const discE = rMu * rMu - cG;
  if (rMu < 0.0 && discE > 0.0) {
    return new THREE.Color(0.0, 0.0, 0.0);
  }

  const discT = rMu * rMu - cT;
  const t1 = -rMu + Math.sqrt(Math.max(0.0, discT));
  const dt = t1 / 48.0;

  let tauR = 0.0, tauG = 0.0, tauB = 0.0;
  for (let i = 0; i < 48; i++) {
    const tm = (i + 0.5) * dt;
    const q = cG + 2.0 * rMu * tm + tm * tm;
    const rt = Math.sqrt(q + R_EARTH * R_EARTH);
    const alt = Math.max(0.0, q / (rt + R_EARTH));

    const dR = Math.exp(-alt / H_RAY);
    const dM = Math.exp(-alt / H_MIE);
    const dO = Math.max(0.0, 1.0 - Math.abs(alt - 25.0) / 15.0);

    tauR += (BETA_R[0] * dR + BETA_M_EXT * dM + BETA_O[0] * dO) * dt;
    tauG += (BETA_R[1] * dR + BETA_M_EXT * dM + BETA_O[1] * dO) * dt;
    tauB += (BETA_R[2] * dR + BETA_M_EXT * dM + BETA_O[2] * dO) * dt;
  }

  return new THREE.Color(Math.exp(-tauR), Math.exp(-tauG), Math.exp(-tauB));
}