// src/planet.js
// Seamless Multi-Scale Spherical Earth & Barranquilla/Sabanilla Coastal POV
// - Fixes seaward normal orientation so the Malecón, railing, and cliff sit directly in front of the POV at (0, 0.025, 0)
// - Eliminates the view-dependent moving glow on the ocean by re-projecting sphere points & anchoring scattering to solar incidence
// - Keeps the northern Caribbean horizon 100% clear of false terrain ridges

import * as THREE from 'three';
import { createNoise, NOISE_GLSL } from './noise.js';
import {
  ATMOSPHERE_CONSTANTS_GLSL,
  ATMOSPHERE_GLSL,
  atmosphereUniforms,
  updateAtmosphereCamera
} from './atmosphere.js';

export const EARTH_RADIUS = 6371.0; // km

export function getEarthPosition(distanceKm, altitudeKm = 0, offsetXKm = 0) {
  const angleZ = distanceKm / EARTH_RADIUS;
  const angleX = offsetXKm / EARTH_RADIUS;
  const r = EARTH_RADIUS + altitudeKm;

  const x = r * Math.sin(angleX);
  const z = -r * Math.sin(angleZ) * Math.cos(angleX);
  const y = -EARTH_RADIUS + r * Math.cos(angleZ) * Math.cos(angleX);

  return new THREE.Vector3(x, y, z);
}

export function getEarthNormal(distanceKm, offsetXKm = 0) {
  const p = getEarthPosition(distanceKm, 0, offsetXKm);
  const center = new THREE.Vector3(0, -EARTH_RADIUS, 0);
  return new THREE.Vector3().subVectors(p, center).normalize();
}

export function calculateHiddenHeightMeters(distKm, hObsKm) {
  const dHorizon = Math.sqrt(2 * EARTH_RADIUS * hObsKm);
  if (distKm <= dHorizon) return 0;
  const dBeyond = distKm - dHorizon;
  const hiddenKm = (dBeyond * dBeyond) / (2 * EARTH_RADIUS);
  return Math.round(hiddenKm * 1000);
}

function generateAsphaltTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1e2126';
  ctx.fillRect(0, 0, size, size);
  const imgData = ctx.getImageData(0, 0, size, size);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = Math.random();
    const grain = (n - 0.5) * 22;
    data[i]     = Math.min(255, Math.max(0, 30 + grain));
    data[i + 1] = Math.min(255, Math.max(0, 32 + grain));
    data[i + 2] = Math.min(255, Math.max(0, 36 + grain));
    if (n > 0.988) {
      data[i] = 125; data[i + 1] = 128; data[i + 2] = 135;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 18);
  return tex;
}

function generatePaverTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#68707a';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#474d56';
  ctx.lineWidth = 2.5;
  const step = 64;
  for (let x = 0; x <= size; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
  }
  for (let y = 0; y <= size; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 24);
  return tex;
}

function generateCliffTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3a3630';
  ctx.fillRect(0, 0, size, size);
  const imgData = ctx.getImageData(0, 0, size, size);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = Math.random();
    const grain = (n - 0.5) * 34;
    data[i]     = Math.min(255, Math.max(0, 58 + grain));
    data[i + 1] = Math.min(255, Math.max(0, 52 + grain));
    data[i + 2] = Math.min(255, Math.max(0, 44 + grain));
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 18);
  return tex;
}

// Local shoreline profile running West (-X) to East (+X).
// At x = 0, the road center is at z = +0.0055 km (5.5 m behind the camera at z = 0),
// so the seaside promenade & balcony sit right under the camera at (0, 0.0233, 0) looking North (-Z) over the sea!
function getShorelineZ(x) {
  return 0.0055 + Math.sin(x * 1.8) * 0.008 - 0.012 * (x * x);
}

function getCoastalRoadPoint(x) {
  const z = getShorelineZ(x);
  const edgeT = Math.min(1.0, Math.abs(x) / 0.42);
  const smoothBell = Math.cos(edgeT * Math.PI * 0.5);
  const y = 0.0233 * (smoothBell * smoothBell);
  const r2 = x * x + z * z;
  const curveDrop = Math.sqrt(Math.max(0, EARTH_RADIUS * EARTH_RADIUS - r2)) - EARTH_RADIUS;
  return new THREE.Vector3(x, y + curveDrop, z);
}

// Correct seaward unit vector in XZ plane: points strictly North (-Z) towards the Caribbean Sea!
function getSeawardNormal(x, xStart = -0.42, xEnd = 0.42) {
  const xNext = Math.min(xEnd, x + 0.008);
  const xPrev = Math.max(xStart, x - 0.008);
  const tangent = new THREE.Vector3().subVectors(
    getCoastalRoadPoint(xNext),
    getCoastalRoadPoint(xPrev)
  ).normalize();
  // Since tangent.x > 0 (West to East), (tangent.z, 0, -tangent.x) points strictly towards -Z (North / Sea)
  return new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
}

export function createPlanetCapGeometry() {
  const R = EARTH_RADIUS;
  const rings = [0, 0.002, 0.005, 0.012, 0.028, 0.06, 0.14, 0.32, 0.7, 1.4];
  let s = 1.4;
  while (s < Math.PI * R - 1e-6) {
    const step = s < 6 ? 0.45 : (s < 240 ? s * 0.065 : 32.0);
    s = Math.min(s + step, Math.PI * R);
    rings.push(s);
  }

  const AZ = 320;
  const numVerts = (rings.length - 1) * AZ + 1;
  const positions = new Float32Array(numVerts * 3);
  const uvs = new Float32Array(numVerts * 2);

  positions[0] = 0.0; positions[1] = 0.0; positions[2] = 0.0;
  uvs[0] = 0.5; uvs[1] = 0.5;

  let vIdx = 1;
  for (let r = 1; r < rings.length; r++) {
    const distS = rings[r];
    const theta = distS / R;
    const sinTheta = Math.sin(theta);
    const sinHalf = Math.sin(theta * 0.5);
    const y = -2.0 * R * sinHalf * sinHalf;

    for (let a = 0; a < AZ; a++) {
      const phi = (a / AZ) * Math.PI * 2.0;
      const x = R * sinTheta * Math.cos(phi);
      const z = R * sinTheta * Math.sin(phi);

      const offset = vIdx * 3;
      positions[offset + 0] = x;
      positions[offset + 1] = y;
      positions[offset + 2] = z;

      const uvOffset = vIdx * 2;
      uvs[uvOffset + 0] = 0.5 + 0.5 * sinTheta * Math.cos(phi);
      uvs[uvOffset + 1] = 0.5 + 0.5 * sinTheta * Math.sin(phi);
      vIdx++;
    }
  }

  const indices = [];
  for (let a = 0; a < AZ; a++) {
    const nextA = (a + 1) % AZ;
    indices.push(0, 1 + nextA, 1 + a);
  }

  for (let r = 1; r < rings.length - 1; r++) {
    const rowStart = 1 + (r - 1) * AZ;
    const nextRowStart = 1 + r * AZ;
    for (let a = 0; a < AZ; a++) {
      const nextA = (a + 1) % AZ;
      const i0 = rowStart + a;
      const i1 = rowStart + nextA;
      const i2 = nextRowStart + a;
      const i3 = nextRowStart + nextA;
      indices.push(i0, i1, i2, i1, i3, i2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

export function createBarranquillaGeoMatrix() {
  const latRad = 11.01 * (Math.PI / 180.0);
  const lonRad = -74.89 * (Math.PI / 180.0);

  const up = new THREE.Vector3(
    Math.cos(latRad) * Math.sin(lonRad),
    Math.sin(latRad),
    -Math.cos(latRad) * Math.cos(lonRad)
  );
  const north = new THREE.Vector3(
    -Math.sin(latRad) * Math.sin(lonRad),
    Math.cos(latRad),
    Math.sin(latRad) * Math.cos(lonRad)
  );
  const east = new THREE.Vector3(
    Math.cos(lonRad),
    0.0,
    Math.sin(lonRad)
  );

  const mat = new THREE.Matrix3();
  mat.set(
    east.x, up.x, -north.x,
    east.y, up.y, -north.y,
    east.z, up.z, -north.z
  );
  return mat;
}

let aerialProgId = 0;
export function injectAerialPerspective(material, lampUniforms = null) {
  const id = ++aerialProgId;
  material.customProgramCacheKey = () => `aerial_persp_pov_v3_${id}`;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      /* glsl */`
        #include <common>
        varying vec3 vWorldPos;
        varying vec3 vAtmoTrans;
        varying vec3 vAtmoInscat;
        ${ATMOSPHERE_CONSTANTS_GLSL}
        ${ATMOSPHERE_GLSL}
      `
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      /* glsl */`
        #include <worldpos_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vec3 dCam = vWorldPos - cameraPosition;
        float distC = length(dCam);
        vec3 localSun = getSunDirAt(vWorldPos);
        Atmo aV = atmosphereMarch(uCamAlt, uCamUp, dCam / max(distC, 1e-4), localSun, distC, 4);
        vAtmoTrans = aV.transmittance;
        vAtmoInscat = aV.inscatter;
      `
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      /* glsl */`
        #include <common>
        varying vec3 vWorldPos;
        varying vec3 vAtmoTrans;
        varying vec3 vAtmoInscat;
        uniform float uNightFactor;
        uniform float uPovFade;
        uniform vec3 uLampPos[10];
        ${ATMOSPHERE_CONSTANTS_GLSL}
      `
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      /* glsl */`
        #include <dithering_fragment>
        if (uNightFactor > 0.05) {
          vec3 lampPool = vec3(0.0);
          for (int i = 0; i < 10; i++) {
            vec3 dL = vWorldPos - uLampPos[i];
            lampPool += vec3(1.0, 0.58, 0.20) / (1.0 + dot(dL, dL) / (0.0032 * 0.0032)) * 0.36;
          }
          gl_FragColor.rgb += lampPool * uNightFactor;
        }
        gl_FragColor.rgb = gl_FragColor.rgb * vAtmoTrans + vAtmoInscat;
        gl_FragColor.a *= uPovFade;
      `
    );

    for (const [k, v] of Object.entries(atmosphereUniforms)) {
      shader.uniforms[k] = v;
    }
    if (lampUniforms) {
      shader.uniforms.uNightFactor = lampUniforms.uNightFactor;
      shader.uniforms.uPovFade = lampUniforms.uPovFade;
      shader.uniforms.uLampPos = lampUniforms.uLampPos;
    } else {
      shader.uniforms.uNightFactor = { value: 0.0 };
      shader.uniforms.uPovFade = { value: 1.0 };
      shader.uniforms.uLampPos = { value: Array.from({ length: 10 }, () => new THREE.Vector3()) };
    }
  };
}

export function createPlanet(bakes = {}) {
  const group = new THREE.Group();
  group.name = 'living-planet-landscape';

  const geoMatrix = createBarranquillaGeoMatrix();
  const asphaltTex = generateAsphaltTexture();
  const paverTex = generatePaverTexture();
  const cliffTex = generateCliffTexture();
  const satelliteTex = bakes.terrain || null;

  // Real-scale POV corridor dimensions:
  // Road center is at z = +0.0055 km (5.5m behind camera).
  // Road half-width = 3.5m -> sea-side edge of road is at z = +0.0020 km (2.0m behind camera).
  // Promenade width = 4.2m extending seaward (-Z) -> from z = +0.0020 km to z = -0.0022 km (2.2m in front of camera!).
  // Balcony juts out an extra 2.4m seaward at x = 0 -> railing is at z = -0.0046 km right in front of the viewer!
  const roadHalfWidth = 0.0035;
  const promWidth = 0.0042;

  const lampXPositions = [-0.22, -0.17, -0.12, -0.075, -0.032, 0.032, 0.075, 0.12, 0.17, 0.22];
  const lampWorldPositions = lampXPositions.map(xPos => {
    const pRoad = getCoastalRoadPoint(xPos);
    const seaward = getSeawardNormal(xPos);
    // Place lamppost on the divider between promenade and road (never in the sea!)
    const pPole = pRoad.clone().addScaledVector(seaward, roadHalfWidth + 0.0003);
    pPole.y += 0.0058;
    return pPole;
  });

  const lampShared = {
    uNightFactor: { value: 0.0 },
    uPovFade: { value: 1.0 },
    uLampPos: { value: lampWorldPositions }
  };

  // =========================================================================
  // 1. CONTINUOUS SPHERICAL PLANET (STABILIZED SPACE SCATTERING & OROGRAPHY)
  // =========================================================================
  const capGeo = createPlanetCapGeometry();

  const oceanUniforms = {
    ...atmosphereUniforms,
    uEarthRadius: { value: EARTH_RADIUS },
    uGeoGlobal: { value: bakes.earthGlobal || null },
    uGeoRegional: { value: bakes.earthRegional || null },
    uPlanetaryClouds: { value: bakes.planetaryClouds || null },
    uRegion: { value: new THREE.Vector4(-84.0, 4.0, -66.0, 18.0) },
    uCityLightsMap: { value: bakes.cityLights || null },
    uOceanNormalMap: { value: bakes.oceanNormal || null },
    uGeoMatrix: { value: geoMatrix },
    uNightFactor: lampShared.uNightFactor,
    uTime: { value: 0.0 },
    uCameraPos: { value: new THREE.Vector3(0, 0.025, 0) },
    uWaterColor: { value: new THREE.Color(0x0284c7) },
    uRiverColor: { value: new THREE.Color(0x091614) }
  };

  const oceanMat = new THREE.ShaderMaterial({
    uniforms: oceanUniforms,
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>

      uniform float uEarthRadius;
      uniform sampler2D uGeoGlobal;
      uniform sampler2D uGeoRegional;
      uniform vec4 uRegion;
      uniform mat3 uGeoMatrix;

      varying vec3 vWorldPosition;
      varying vec3 vSphereNormal;
      varying float vVertexElev;

      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 N = normalize(wp.xyz - vec3(0.0, -uEarthRadius, 0.0));
        vSphereNormal = N;

        vec3 g = normalize(uGeoMatrix * N);
        float lat = asin(clamp(g.y, -1.0, 1.0));
        float lon = atan(g.x, -g.z);
        vec2 uvG = vec2(lon / 6.2831853 + 0.5, lat / 3.14159265 + 0.5);
        vec2 uvR = (vec2(degrees(lon), degrees(lat)) - uRegion.xy) / (uRegion.zw - uRegion.xy);
        vec2 e = min(uvR, 1.0 - uvR);
        float wR = smoothstep(0.0, 0.04, min(e.x, e.y));
        vec4 geoSample = mix(texture2D(uGeoGlobal, uvG), texture2D(uGeoRegional, clamp(uvR, 0.0, 1.0)), wR);

        float distOrigin = length(wp.xz);
        float notNorthSea = smoothstep(-2.0, 8.0, wp.z + abs(wp.x) * 0.35);
        float dispMask = smoothstep(22.0, 42.0, distOrigin) * smoothstep(-3.0, -12.0, geoSample.r) * notNorthSea;
        float elevKm = max(0.0, geoSample.g) * dispMask;

        wp.xyz += N * elevKm;
        vWorldPosition = wp.xyz;
        vVertexElev = elevKm;

        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>

      uniform float uEarthRadius;
      uniform sampler2D uGeoGlobal;
      uniform sampler2D uGeoRegional;
      uniform sampler2D uPlanetaryClouds;
      uniform vec4 uRegion;
      uniform sampler2D uCityLightsMap;
      uniform sampler2D uOceanNormalMap;
      uniform mat3 uGeoMatrix;
      uniform float uNightFactor;
      uniform float uTime;
      uniform vec3 uCameraPos;
      uniform vec3 uRiverColor;

      varying vec3 vWorldPosition;
      varying vec3 vSphereNormal;
      varying float vVertexElev;

      ${NOISE_GLSL}
      ${ATMOSPHERE_CONSTANTS_GLSL}
      ${ATMOSPHERE_GLSL}

      vec3 landAlbedo(float h, float moist, float slope, vec3 P){
        float nMacro = fbm3(P / 45.0, 3) * 0.5 + 0.5;
        float nMid   = fbm3(P /  8.5, 3) * 0.5 + 0.5;
        float nFine  = fbm3(P /  1.4, 2) * 0.5 + 0.5;
        float nMix   = nMacro * 0.50 + nMid * 0.35 + nFine * 0.15;

        vec3 rain  = mix(vec3(0.016, 0.048, 0.018), vec3(0.032, 0.078, 0.026), nMix);
        vec3 sav   = mix(vec3(0.068, 0.088, 0.034), vec3(0.115, 0.105, 0.052), nMix);
        vec3 arid  = mix(vec3(0.185, 0.138, 0.082), vec3(0.245, 0.188, 0.118), nMix);
        vec3 veg   = mix(arid, mix(sav, rain, smoothstep(0.52, 0.82, moist)), smoothstep(0.16, 0.52, moist));

        vec3 rock  = mix(vec3(0.110, 0.102, 0.095), vec3(0.195, 0.178, 0.162), nMid);
        float rockMask = clamp(smoothstep(1.6, 3.3, h + (nMid - 0.5) * 0.45) + (1.0 - smoothstep(0.62, 0.86, slope)) * 0.75, 0.0, 1.0);
        vec3 col = mix(veg, rock, rockMask);

        float snowMask = smoothstep(4.45, 4.95, h + (nFine - 0.5) * 0.25) * smoothstep(0.45, 0.72, slope);
        return mix(col, vec3(0.82, 0.86, 0.92), snowMask);
      }

      void main() {
        #include <logdepthbuf_fragment>

        vec3 N = normalize(vSphereNormal);
        vec3 exactWorldPos = vec3(0.0, -uEarthRadius, 0.0) + N * (uEarthRadius + max(0.0, vVertexElev));

        vec3 g = normalize(uGeoMatrix * N);
        float lat = asin(clamp(g.y, -1.0, 1.0));
        float lon = atan(g.x, -g.z);

        vec2 uvG = vec2(lon / 6.2831853 + 0.5, lat / 3.14159265 + 0.5);
        vec2 uvR = (vec2(degrees(lon), degrees(lat)) - uRegion.xy) / (uRegion.zw - uRegion.xy);
        vec2 e = min(uvR, 1.0 - uvR);
        float wR = smoothstep(0.0, 0.04, min(e.x, e.y));
        vec4 f = mix(texture2D(uGeoGlobal, uvG), texture2D(uGeoRegional, clamp(uvR, 0.0, 1.0)), wR);

        vec3 P = N * R_EARTH;
        float pixKm = max(length(fwidth(P)), 1e-4);
        float coast = f.r;

        if (abs(coast) < 28.0) {
          coast += 9.5 * fbm3(P / 52.0, 3) * smoothstep(pixKm * 2.0, pixKm * 8.0, 52.0);
          coast += 2.0 * fbm3(P /  7.5, 3) * smoothstep(pixKm * 2.0, pixKm * 8.0,  7.5);
          coast += 0.35 * fbm3(P / 1.2, 2) * smoothstep(pixKm * 2.0, pixKm * 8.0,  1.2);
        }

        vec2 xz = exactWorldPos.xz;
        float distFromOrigin = length(xz);
        float localBlend = 1.0 - smoothstep(12.0, 32.0, distFromOrigin);
        if (localBlend > 0.001) {
          float shoreZ = 0.0055 + sin(xz.x * 1.8) * 0.008 - 0.012 * clamp(xz.x * xz.x, 0.0, 1.0) - 0.036;
          shoreZ += 0.22 * xz.x * smoothstep(0.5, 6.0, abs(xz.x));
          float localSdf = (shoreZ - xz.y) * 2.0;
          coast = mix(coast, localSdf, localBlend);
        }

        float dN = -xz.y;
        float fN = smoothstep(0.05, 18.0, dN);
        float fW = 1.0 - smoothstep(0.95, 1.65, abs(xz.x) / max(dN, 0.5));
        float fD = 1.0 - smoothstep(300.0, 450.0, distFromOrigin);
        float forcedSea = clamp(fN * fW * fD, 0.0, 1.0);
        coast = max(coast, mix(coast, 25.0, forcedSea));

        float aa = max(pixKm, 0.012);
        float land = (1.0 - smoothstep(-aa, aa, coast)) * (1.0 - forcedSea);

        vec3 localSunDir  = getSunDirAt(exactWorldPos);
        vec3 localMoonDir = getMoonDirAt(exactWorldPos);
        float muS = dot(N, localSunDir);
        float muM = dot(N, localMoonDir);

        vec3 sunCol  = sunTransmittance(0.15, max(muS, 0.08)) * uSunIrradiance * uSunTint;
        vec3 moonCol = sunTransmittance(0.15, max(muM, 0.08)) * uMoonIrradiance * uMoonTint;
        float sunElev  = max(0.0, muS);
        float moonElev = max(0.0, muM);

        float dayMask = smoothstep(-0.05, 0.04, muS);
        float goldenHour = exp(-pow((muS - 0.02) / 0.065, 2.0));

        vec3 daySkyAmb    = mix(vec3(0.11, 0.24, 0.48), vec3(0.16, 0.36, 0.68), clamp(sunElev * 2.2, 0.0, 1.0));
        vec3 goldenSkyAmb = vec3(0.28, 0.16, 0.10);
        vec3 nightSkyAmb  = vec3(0.005, 0.011, 0.026) + moonCol * 0.22;

        vec3 skyAmb = mix(
          nightSkyAmb,
          mix(daySkyAmb, goldenSkyAmb, goldenHour * 0.72) * (uSunIrradiance / 20.0),
          dayMask
        ) * PI;

        float grazingSun = smoothstep(-0.02, 0.06, muS) * (0.14 + 0.86 * sunElev);

        vec3 surf = vec3(0.0);
        vec3 V = normalize(uCameraPos - exactWorldPos);

        if (land < 0.999) {
          float shelf = exp(-max(coast, 0.0) / 8.5);
          vec3 abyssal = vec3(0.004, 0.026, 0.075);
          vec3 coastal = vec3(0.014, 0.190, 0.260);
          vec3 shoal   = vec3(0.038, 0.130, 0.108);
          vec3 waterBase = mix(abyssal, mix(coastal, shoal, smoothstep(0.78, 1.0, shelf)), shelf);

          waterBase = mix(waterBase, vec3(0.072, 0.092, 0.052), clamp(f.a, 0.0, 1.0) * 0.65 * (1.0 - land));
          vec3 waterSubsurface = (waterBase / PI) * (sunCol * grazingSun + moonCol * moonElev + skyAmb * 0.82);

          float distCam = length(exactWorldPos - uCameraPos);
          vec2 uvMicro = exactWorldPos.xz * 520.0 + vec2(uTime * 0.26, uTime * 0.18);
          vec2 uvFine  = exactWorldPos.xz * 95.0  + vec2(-uTime * 0.11, uTime * 0.14);
          vec2 uvBroad = exactWorldPos.xz * 3.8   + vec2(uTime * 0.008, uTime * 0.010);

          float microW = clamp(1.0 - distCam / 2.2, 0.0, 1.0);
          float fineW  = clamp(1.0 - distCam / 25.0, 0.0, 1.0);
          float broadW = clamp(1.0 - distCam / 180.0, 0.0, 1.0);

          vec3 nMicro = (texture2D(uOceanNormalMap, uvMicro).rgb * 2.0 - 1.0) * microW;
          vec3 nFine  = (texture2D(uOceanNormalMap, uvFine).rgb  * 2.0 - 1.0) * fineW;
          vec3 nBroad = (texture2D(uOceanNormalMap, uvBroad).rgb * 2.0 - 1.0) * broadW;
          vec3 nPerturb = nBroad * 0.30 + nFine * 0.60 + nMicro * 0.85;

          vec3 upRef = (abs(N.y) > 0.999) ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
          vec3 T = normalize(cross(upRef, N));
          vec3 B = cross(N, T);
          vec3 waveN = normalize(N + (nPerturb.x * T + nPerturb.y * B) * 0.10);

          float nearSurfaceWeight = exp(-uCamAlt / 16.0);
          float VdotN = clamp(dot(V, waveN), 0.02, 1.0);
          float fresnel = (0.02 + 0.78 * pow(1.0 - VdotN, 4.2)) * nearSurfaceWeight;

          vec3 dayRefl    = vec3(0.12, 0.28, 0.54);
          vec3 sunsetRefl = vec3(0.58, 0.28, 0.12);
          vec3 skyRefl    = mix(dayRefl, sunsetRefl, goldenHour) * (uSunIrradiance / 20.0) * dayMask
                          + vec3(0.008, 0.018, 0.042) + moonCol * 0.18;

          vec3 H_sun = normalize(V + localSunDir);
          float NdotH_s = max(0.0, dot(waveN, H_sun));
          float NdotL_s = smoothstep(-0.02, 0.08, dot(waveN, localSunDir));
          float sunGlitter = (pow(NdotH_s, 240.0) * 0.85 + pow(NdotH_s, 45.0) * 0.18) * NdotL_s * (0.05 + 0.35 * nearSurfaceWeight);

          vec3 H_moon = normalize(V + localMoonDir);
          float NdotH_m = max(0.0, dot(waveN, H_moon));
          float NdotL_m = max(0.0, dot(waveN, localMoonDir));
          float moonGlitter = (pow(NdotH_m, 220.0) * 1.0 + pow(NdotH_m, 45.0) * 0.20) * NdotL_m * (0.05 + 0.25 * nearSurfaceWeight);

          surf = mix(waterSubsurface, skyRefl, fresnel)
               + min(sunCol * 0.045 * sunGlitter, vec3(0.85))
               + min(moonCol * 0.30 * moonGlitter, vec3(0.40));
        }

        if (land > 0.001) {
          float detailScale = smoothstep(pixKm * 2.0, pixKm * 10.0, 28.0);
          float ridMacro = ridged3(P / 28.0, 4) * detailScale;
          float ridFine  = ridged3(P /  5.5, 3) * smoothstep(pixKm * 2.0, pixKm * 10.0, 5.5);

          float elev = f.g + (ridMacro * 0.42 + ridFine * 0.14) * smoothstep(0.0, 0.35, f.g)
                           + ridMacro * 0.08 * smoothstep(2.0, 18.0, -coast);

          vec3 dPdx = dFdx(exactWorldPos);
          vec3 dPdy = dFdy(exactWorldPos);
          float dHdx = dFdx(elev);
          float dHdy = dFdy(elev);
          vec3 surfGrad = (dPdx * dHdx + dPdy * dHdy) / max(dot(dPdx, dPdx) + dot(dPdy, dPdy), 1e-6);
          vec3 N_land = normalize(N - surfGrad * 2.2);

          float slope = clamp(dot(N_land, N), 0.0, 1.0);
          vec3 alb = landAlbedo(elev, f.b, slope, P);

          float diffSun  = max(grazingSun * 0.65, dot(N_land, localSunDir));
          float diffMoon = max(0.0, dot(N_land, localMoonDir));
          float valleyAO = 0.68 + 0.32 * smoothstep(0.0, 1.2, elev + 0.4);

          vec3 landColor = (alb / PI) * (
            sunCol * max(0.0, diffSun) +
            moonCol * diffMoon +
            skyAmb * valleyAO * (0.58 + 0.42 * slope)
          );

          if (f.a > 0.04) {
            float rMask = clamp(f.a * 1.25, 0.0, 0.88);
            vec3 riverIllum = (uRiverColor / PI) * (sunCol * grazingSun + skyAmb) + skyAmb * 0.06;
            landColor = mix(landColor, riverIllum, rMask);
          }

          float localNight = max(uNightFactor, smoothstep(0.03, -0.05, muS));
          float cityMask = smoothstep(0.4, 2.8, -coast) * land;
          landColor += texture2D(uCityLightsMap, uvG).rgb * vec3(1.0, 0.64, 0.24) * cityMask * localNight * 1.65;

          surf = mix(surf, landColor, land);
        }

        // Pre-baked Scientific Planetary Cloud Layer (ITCZ, Coriolis Cyclones, Curl Advection & Orographic Clouds)
        // Smoothly takes over outside the local 3D raymarcher domain (r > 135..205 km) and when ascending to space (alt > 45..86 km)
        float planetaryMask = mix(smoothstep(135.0, 205.0, distFromOrigin), 1.0, smoothstep(45.0, 86.0, uCamAlt));
        if (planetaryMask > 0.001) {
          vec3 eastG  = normalize(vec3(-g.z, 0.0, -g.x) + vec3(1e-6, 0.0, 0.0));
          vec3 northG = normalize(cross(g, eastG));
          vec3 sunG   = uGeoMatrix * localSunDir;
          vec2 sunHoriz = vec2(dot(sunG, eastG), dot(sunG, northG));

          // 1. Cast physical cloud shadows onto ocean & continents
          vec2 shadowUv = uvG + sunHoriz * vec2(0.0015, 0.0026) * clamp(1.0 / max(muS, 0.22), 1.0, 3.2);
          float cShadow = texture2D(uPlanetaryClouds, shadowUv).r * planetaryMask * smoothstep(0.01, 0.22, muS);
          surf *= (1.0 - cShadow * 0.68);

          // 2. Sample pre-computed planetary cloud density (R), top altitude (G), and optical gradients (B, A)
          vec4 pc = texture2D(uPlanetaryClouds, uvG);
          float subDetail = (fbm3(P / 13.5, 2) * 0.5 + 0.5) * smoothstep(pixKm * 1.5, pixKm * 8.0, 13.5) + 0.5 * (1.0 - smoothstep(pixKm * 1.5, pixKm * 8.0, 13.5));
          float cDens = smoothstep(0.05, 0.86, pc.r * (0.80 + 0.34 * subDetail)) * planetaryMask;

          if (cDens > 0.002) {
            vec2 cGrad = (pc.ba - 0.5) * 2.0;
            float sunSlope = -(cGrad.x * sunHoriz.x + cGrad.y * sunHoriz.y);
            float selfShadow = clamp(0.58 + sunSlope * 0.78, 0.14, 1.22);

            float cTopKm = mix(2.2, 15.0, pc.g);
            vec3 cSunLight = sunTransmittance(cTopKm, max(muS, -0.05)) * uSunIrradiance * uSunTint * smoothstep(-0.07, 0.08, muS);
            float VdotS = max(0.0, dot(-V, localSunDir));
            float rimSilver = pow(VdotS, 6.0) * cDens * (1.0 - cDens * 0.82) * 1.45;

            vec3 cLit = (vec3(0.95, 0.96, 0.98) / PI) * (
              cSunLight * (selfShadow + rimSilver) +
              moonCol * max(0.0, muM) * 0.85 +
              skyAmb * (0.45 + 0.42 * pc.g)
            );
            // Soft HDR shoulder so planetary clouds never trigger bloom
            cLit = cLit / (1.0 + cLit * 0.62);

            float cAlpha = clamp(1.0 - exp(-cDens * 3.5), 0.0, 0.98);
            surf = mix(surf, cLit, cAlpha);
          }
        }

        float orbitBlend = smoothstep(12.0, 65.0, uCamAlt);
        vec3 finalCol = surf;

        if (orbitBlend < 0.999) {
          vec3 dCam = exactWorldPos - uCameraPos;
          float distC = length(dCam);
          Atmo atmo = atmosphereMarch(uCamAlt, uCamUp, dCam / max(distC, 1e-4), localSunDir, distC, 4);
          finalCol = surf * atmo.transmittance + atmo.inscatter;
        }

        if (orbitBlend > 0.001) {
          float sunFactor = smoothstep(-0.04, 0.06, muS);
          float twilightRim = exp(-pow((muS - 0.005) / 0.038, 2.0)) * smoothstep(-0.07, 0.03, muS);
          vec3 spaceAtmoInscat = (
            vec3(0.032, 0.098, 0.245) * sunFactor +
            vec3(0.26, 0.10, 0.03) * twilightRim * 0.55
          ) * (uSunIrradiance / 20.0);
          vec3 spaceTrans = mix(vec3(1.0), vec3(0.88, 0.92, 0.96), sunFactor);
          vec3 orbitalCol = surf * spaceTrans + spaceAtmoInscat;
          finalCol = mix(finalCol, orbitalCol, orbitBlend);
        }

        gl_FragColor = vec4(finalCol, 1.0);
      }
    `
  });
  oceanMat.color = oceanUniforms.uWaterColor.value;

  const earthMesh = new THREE.Mesh(capGeo, oceanMat);
  earthMesh.position.set(0, 0, 0);
  earthMesh.frustumCulled = false;
  group.add(earthMesh);

  // =========================================================================
  // 2. WATERTIGHT REAL-SCALE POV MIRADOR & MALECON (840 m SPAN, AUTO-LOD)
  // =========================================================================
  const miradorGroup = new THREE.Group();
  miradorGroup.name = 'coastal-highway-mirador';

  const roadSteps = 110;
  const xStart = -0.42; // 420 meters West of POV
  const xEnd   =  0.42; // 420 meters East of POV
  const roadVerts = [];
  const roadUvs = [];
  const roadIndices = [];

  for (let i = 0; i <= roadSteps; i++) {
    const t = i / roadSteps;
    const x = xStart + t * (xEnd - xStart);
    const pCenter = getCoastalRoadPoint(x);
    const seaward = getSeawardNormal(x, xStart, xEnd);

    const pSeaSide  = pCenter.clone().addScaledVector(seaward, roadHalfWidth);
    const pLandSide = pCenter.clone().addScaledVector(seaward, -roadHalfWidth);

    roadVerts.push(pSeaSide.x, pSeaSide.y + 0.00012, pSeaSide.z);
    roadVerts.push(pLandSide.x, pLandSide.y + 0.00012, pLandSide.z);

    const vCoord = (x - xStart) * 55.0;
    roadUvs.push(0.0, vCoord, 1.0, vCoord);

    if (i < roadSteps) {
      const b = i * 2;
      roadIndices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }

  const roadRibbonGeo = new THREE.BufferGeometry();
  roadRibbonGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadVerts, 3));
  roadRibbonGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
  roadRibbonGeo.setIndex(roadIndices);
  roadRibbonGeo.computeVertexNormals();

  const roadShaderMat = new THREE.ShaderMaterial({
    uniforms: {
      ...atmosphereUniforms,
      uAsphaltTex: { value: asphaltTex },
      uNightFactor: lampShared.uNightFactor,
      uPovFade: lampShared.uPovFade,
      uLampPos: lampShared.uLampPos
    },
    transparent: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      ${ATMOSPHERE_CONSTANTS_GLSL}
      ${ATMOSPHERE_GLSL}
      varying vec3 vWorldPos;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vAtmoTrans;
      varying vec3 vAtmoInscat;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);

        vec3 dCam = wp.xyz - cameraPosition;
        float distC = length(dCam);
        vec3 localSun = getSunDirAt(wp.xyz);
        Atmo aV = atmosphereMarch(uCamAlt, uCamUp, dCam / max(distC, 1e-4), localSun, distC, 4);
        vAtmoTrans = aV.transmittance;
        vAtmoInscat = aV.inscatter;

        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D uAsphaltTex;
      uniform float uNightFactor;
      uniform float uPovFade;
      uniform vec3 uLampPos[10];
      varying vec3 vWorldPos;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vAtmoTrans;
      varying vec3 vAtmoInscat;
      ${ATMOSPHERE_CONSTANTS_GLSL}
      ${ATMOSPHERE_GLSL}

      void main() {
        #include <logdepthbuf_fragment>
        vec3 asphalt = texture2D(uAsphaltTex, vUv).rgb * 0.22;
        float uCoord = vUv.x;
        float vCoord = vUv.y;

        float edgeWhite = smoothstep(0.035, 0.045, uCoord) * smoothstep(0.08, 0.07, uCoord) +
                          smoothstep(0.92, 0.93, uCoord) * smoothstep(0.965, 0.955, uCoord);
        float centerDist = abs(uCoord - 0.5);
        float centerYellow = smoothstep(0.016, 0.012, centerDist) * step(0.42, fract(vCoord * 0.18));

        vec3 alb = mix(asphalt, vec3(0.55, 0.58, 0.62), edgeWhite * 0.9);
        alb = mix(alb, vec3(0.65, 0.48, 0.05), centerYellow * 0.9);

        vec3 N = normalize(vNormal);
        vec3 upLocal = normalize(vec3(vWorldPos.x, vWorldPos.y + R_EARTH, vWorldPos.z));
        vec3 primDir;
        vec3 directRad = evalDirectCelestialLight(0.025, upLocal, vWorldPos, primDir);
        vec3 skyAmb = vec3(0.10, 0.22, 0.42) * (uSunIrradiance / 20.0 * max(0.02, dot(upLocal, uSunDir) * 0.5 + 0.5)) * PI;
        vec3 col = (alb / PI) * (directRad * max(0.0, abs(dot(N, primDir))) + skyAmb);

        if (uNightFactor > 0.05) {
          vec3 pool = vec3(0.0);
          for (int i = 0; i < 10; i++) {
            vec3 dL = vWorldPos - uLampPos[i];
            pool += vec3(1.0, 0.55, 0.18) / (1.0 + dot(dL, dL) / (0.0032 * 0.0032)) * 0.95;
          }
          col += alb * pool * uNightFactor;
        }

        float endFade = 1.0 - smoothstep(0.32, 0.42, abs(vWorldPos.x));
        gl_FragColor = vec4(col * vAtmoTrans + vAtmoInscat, uPovFade * endFade);
      }
    `
  });

  const roadMesh = new THREE.Mesh(roadRibbonGeo, roadShaderMat);
  miradorGroup.add(roadMesh);

  // =========================================================================
  // 3. WATERTIGHT SEA CLIFF & RIPRAP EMBANKMENT (IN FRONT OF PROMENADE, -Z)
  // =========================================================================
  const noise = createNoise(77);
  const cliffSteps = 120;
  const cliffCols = 8;
  const cliffWidth = 0.036; // 36 meters slope down to the Caribbean surf
  const cliffVerts = [];
  const cliffUvs = [];
  const cliffIndices = [];

  for (let i = 0; i <= cliffSteps; i++) {
    const t = i / cliffSteps;
    const x = xStart + t * (xEnd - xStart);
    const pCenter = getCoastalRoadPoint(x);
    const seaward = getSeawardNormal(x, xStart, xEnd);

    const inPromenade = Math.abs(x) <= 0.32;
    const innerOffset = roadHalfWidth + (inPromenade ? promWidth : 0.0);

    for (let c = 0; c <= cliffCols; c++) {
      const u = c / cliffCols;
      const latOffset = innerOffset + u * cliffWidth;
      const pt = pCenter.clone().addScaledVector(seaward, latOffset);

      const r2 = pt.x * pt.x + pt.z * pt.z;
      const curveDrop = Math.sqrt(Math.max(0, EARTH_RADIUS * EARTH_RADIUS - r2)) - EARTH_RADIUS;
      const baseTopY = pCenter.y;
      const baseBotY = -0.010 + curveDrop;
      let y = THREE.MathUtils.lerp(baseTopY, baseBotY, Math.pow(u, 0.85));

      const edgeMask = Math.sin(u * Math.PI);
      const w = noise.worley(x * 480.0, u * 16.0);
      const riprap = (0.0008 * (1.0 - Math.min(1.0, w.f1 * 1.35)) + 0.00035 * noise.fbm(x * 280.0, u * 10.0)) * edgeMask;
      y += riprap;

      cliffVerts.push(pt.x, y, pt.z);
      cliffUvs.push(u, (x - xStart) * 28.0);
    }

    if (i < cliffSteps) {
      const rowStride = cliffCols + 1;
      const baseIdx = i * rowStride;
      for (let c = 0; c < cliffCols; c++) {
        const i0 = baseIdx + c;
        const i1 = baseIdx + c + 1;
        const i2 = baseIdx + rowStride + c;
        const i3 = baseIdx + rowStride + c + 1;
        cliffIndices.push(i0, i1, i2, i1, i3, i2);
      }
    }
  }

  const cliffGeo = new THREE.BufferGeometry();
  cliffGeo.setAttribute('position', new THREE.Float32BufferAttribute(cliffVerts, 3));
  cliffGeo.setAttribute('uv', new THREE.Float32BufferAttribute(cliffUvs, 2));
  cliffGeo.setIndex(cliffIndices);
  cliffGeo.computeVertexNormals();

  const cliffMat = new THREE.MeshStandardMaterial({
    map: cliffTex,
    roughness: 0.92,
    metalness: 0.04,
    transparent: true,
    side: THREE.DoubleSide
  });
  injectAerialPerspective(cliffMat, lampShared);
  const cliffMesh = new THREE.Mesh(cliffGeo, cliffMat);
  miradorGroup.add(cliffMesh);

  // Shore Surf Foam Ribbon at the toe of the cliff
  const foamSteps = 100;
  const foamWidth = 0.010;
  const foamVerts = [];
  const foamUvs = [];
  const foamIndices = [];

  for (let i = 0; i <= foamSteps; i++) {
    const t = i / foamSteps;
    const x = xStart + t * (xEnd - xStart);
    const pCenter = getCoastalRoadPoint(x);
    const seaward = getSeawardNormal(x, xStart, xEnd);

    const inPromenade = Math.abs(x) <= 0.32;
    const waterEdgeOffset = roadHalfWidth + (inPromenade ? promWidth : 0.0) + cliffWidth * 0.68;
    const pIn  = pCenter.clone().addScaledVector(seaward, waterEdgeOffset);
    const pOut = pCenter.clone().addScaledVector(seaward, waterEdgeOffset + foamWidth);

    const r2In = pIn.x * pIn.x + pIn.z * pIn.z;
    const r2Out = pOut.x * pOut.x + pOut.z * pOut.z;
    pIn.y  = 0.00025 + Math.sqrt(Math.max(0, EARTH_RADIUS * EARTH_RADIUS - r2In)) - EARTH_RADIUS;
    pOut.y = 0.00025 + Math.sqrt(Math.max(0, EARTH_RADIUS * EARTH_RADIUS - r2Out)) - EARTH_RADIUS;

    foamVerts.push(pIn.x, pIn.y, pIn.z, pOut.x, pOut.y, pOut.z);
    foamUvs.push(0.0, x, 1.0, x);

    if (i < foamSteps) {
      const b = i * 2;
      foamIndices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }

  const foamGeo = new THREE.BufferGeometry();
  foamGeo.setAttribute('position', new THREE.Float32BufferAttribute(foamVerts, 3));
  foamGeo.setAttribute('uv', new THREE.Float32BufferAttribute(foamUvs, 2));
  foamGeo.setIndex(foamIndices);

  const foamMat = new THREE.ShaderMaterial({
    uniforms: {
      ...atmosphereUniforms,
      uTime: oceanUniforms.uTime,
      uPovFade: lampShared.uPovFade
    },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv;
      varying vec3 vWorldPos;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uTime;
      uniform float uSunIrradiance;
      uniform float uPovFade;
      varying vec2 vUv;
      varying vec3 vWorldPos;
      ${NOISE_GLSL}
      void main(){
        #include <logdepthbuf_fragment>
        float v = vUv.x;
        float x = vUv.y;
        float f = fbm2(vec2(x * 750.0 - uTime * 0.35, v * 14.0), 3) * 0.5 + 0.5;
        float wave = sin(x * 160.0 - uTime * 1.6);
        float foam = smoothstep(0.55, 0.80, f + 0.35 * wave);
        float endFade = 1.0 - smoothstep(0.30, 0.42, abs(x));
        float alpha = foam * pow(1.0 - v, 1.5) * 0.72 * endFade * uPovFade;
        if (alpha < 0.01) discard;
        vec3 foamBase = vec3(0.68, 0.78, 0.88);
        gl_FragColor = vec4(foamBase, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const foamMesh = new THREE.Mesh(foamGeo, foamMat);
  miradorGroup.add(foamMesh);

  // =========================================================================
  // 4. MALECON PROMENADE, CURVED BALCONY RAILING & BINOCULARS RIGHT IN FRONT OF POV
  // =========================================================================
  const promSteps = 84;
  const promXStart = -0.32;
  const promXEnd   =  0.32;
  const promVerts = [];
  const promUvs = [];
  const promIndices = [];
  const railingPoints = [];

  for (let i = 0; i <= promSteps; i++) {
    const t = i / promSteps;
    const x = promXStart + t * (promXEnd - promXStart);
    const pCenter = getCoastalRoadPoint(x);
    const seaward = getSeawardNormal(x, xStart, xEnd);

    // Smooth semicircular observation bay protrusion at x = 0 so the railing wraps around the camera at (0, 0.025, 0)
    const balconyOut = 0.0024 * Math.exp(-(x * x) / (0.0065 * 0.0065));

    const pInner = pCenter.clone().addScaledVector(seaward, roadHalfWidth);
    const pOuter = pCenter.clone().addScaledVector(seaward, roadHalfWidth + promWidth + balconyOut);

    promVerts.push(pOuter.x, pOuter.y + 0.00022, pOuter.z);
    promVerts.push(pInner.x, pInner.y + 0.00022, pInner.z);
    railingPoints.push(pOuter);

    const vCoord = (x - promXStart) * 75.0;
    promUvs.push(0.0, vCoord, 1.0, vCoord);

    if (i < promSteps) {
      const b = i * 2;
      promIndices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }

  const promGeo = new THREE.BufferGeometry();
  promGeo.setAttribute('position', new THREE.Float32BufferAttribute(promVerts, 3));
  promGeo.setAttribute('uv', new THREE.Float32BufferAttribute(promUvs, 2));
  promGeo.setIndex(promIndices);
  promGeo.computeVertexNormals();

  const promenadeMat = new THREE.MeshStandardMaterial({
    map: paverTex,
    roughness: 0.86,
    metalness: 0.05,
    transparent: true,
    side: THREE.DoubleSide
  });
  injectAerialPerspective(promenadeMat, lampShared);
  const promenadeMesh = new THREE.Mesh(promGeo, promenadeMat);
  miradorGroup.add(promenadeMesh);

  const railMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    roughness: 0.58,
    metalness: 0.35,
    transparent: true
  });
  injectAerialPerspective(railMat, lampShared);

  // Top handrail (1.10m above deck) and mid-rail (0.60m above deck) directly visible in POV
  const handrailCurve = new THREE.CatmullRomCurve3(
    railingPoints.map(p => new THREE.Vector3(p.x, p.y + 0.00115, p.z))
  );
  miradorGroup.add(new THREE.Mesh(new THREE.TubeGeometry(handrailCurve, 120, 0.000038, 8, false), railMat));

  const midCableCurve = new THREE.CatmullRomCurve3(
    railingPoints.map(p => new THREE.Vector3(p.x, p.y + 0.00062, p.z))
  );
  miradorGroup.add(new THREE.Mesh(new THREE.TubeGeometry(midCableCurve, 120, 0.000024, 6, false), railMat));

  const postGeo = new THREE.CylinderGeometry(0.000030, 0.000030, 0.00115, 6);
  const postCount = 140;
  const railingPosts = new THREE.InstancedMesh(postGeo, railMat, postCount);
  const dummyPost = new THREE.Object3D();
  for (let i = 0; i < postCount; i++) {
    const u = i / (postCount - 1);
    const pt = handrailCurve.getPointAt(u);
    dummyPost.position.set(pt.x, pt.y - 0.00055, pt.z);
    dummyPost.updateMatrix();
    railingPosts.setMatrixAt(i, dummyPost.matrix);
  }
  railingPosts.instanceMatrix.needsUpdate = true;
  miradorGroup.add(railingPosts);

  // Concrete pier under the central observation bay at (0, 0.0233, -0.001)
  const pBalconyRoad = getCoastalRoadPoint(0.0);
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.9, transparent: true });
  injectAerialPerspective(pierMat, lampShared);
  const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0028, 0.028, 16), pierMat);
  pier.position.set(0.0, pBalconyRoad.y - 0.014, -0.0015);
  miradorGroup.add(pier);

  // Tourist coin-operated binoculars at the front-right edge of the balcony (visible in POV!)
  const pedestalMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.45, metalness: 0.6, transparent: true });
  injectAerialPerspective(pedestalMat, lampShared);
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.00009, 0.00013, 0.00125, 10), pedestalMat);
  pedestal.position.set(0.0016, pBalconyRoad.y + 0.00082, -0.0034);
  const binocHead = new THREE.Mesh(new THREE.BoxGeometry(0.00022, 0.00015, 0.00030), pedestalMat);
  binocHead.position.set(0.0016, pBalconyRoad.y + 0.00148, -0.0034);
  binocHead.rotation.y = 0.22;
  miradorGroup.add(pedestal, binocHead);

  // Streetlights along the promenade/road divider
  const poleGroup = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.45, metalness: 0.65, transparent: true });
  injectAerialPerspective(poleMat, lampShared);
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xffedd5,
    emissive: 0xfbbf24,
    emissiveIntensity: 0.0,
    roughness: 0.2,
    transparent: true
  });

  const poleHeightKm = 0.0058;
  const mastGeo = new THREE.CylinderGeometry(0.000055, 0.00009, poleHeightKm, 8);
  const armGeo = new THREE.CylinderGeometry(0.00004, 0.00004, 0.0014, 6);
  armGeo.rotateX(-Math.PI / 3);
  const lampHeadGeo = new THREE.BoxGeometry(0.00030, 0.00011, 0.00050);

  lampXPositions.forEach(xPos => {
    const pRoad = getCoastalRoadPoint(xPos);
    const seaward = getSeawardNormal(xPos, xStart, xEnd);
    const pPole = pRoad.clone().addScaledVector(seaward, roadHalfWidth + 0.0003);

    const singlePole = new THREE.Group();
    const mast = new THREE.Mesh(mastGeo, poleMat);
    mast.position.set(0, poleHeightKm * 0.5, 0);
    singlePole.add(mast);

    const arm = new THREE.Mesh(armGeo, poleMat);
    arm.position.set(0, poleHeightKm - 0.00032, 0.00050);
    singlePole.add(arm);

    const lampHead = new THREE.Mesh(lampHeadGeo, lampMat);
    lampHead.position.set(0, poleHeightKm - 0.00060, 0.00105);
    singlePole.add(lampHead);

    singlePole.position.copy(pPole);
    poleGroup.add(singlePole);
  });

  miradorGroup.add(poleGroup);

  // =========================================================================
  // 5. WATERTIGHT INLAND BLUFF SKIRT (BEHIND THE ROAD, ZERO Z-FIGHTING)
  // =========================================================================
  const inlandWidth  = 0.84; // 840 m matching the road span
  const inlandLength = 0.28; // 280 m inland behind the road (+Z)
  const terrainGeo = new THREE.PlaneGeometry(inlandWidth, inlandLength, 72, 32);
  terrainGeo.rotateX(-Math.PI / 2);

  const pos = terrainGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const lz = pos.getZ(i);
    const uInland = (lz + inlandLength * 0.5) / inlandLength; // 0 at landward edge of road, 1 inland (+Z)

    const roadPt = getCoastalRoadPoint(lx);
    const seaward = getSeawardNormal(lx, xStart, xEnd);
    const distInland = uInland * inlandLength;

    // Start 1.2m behind the landward edge of the asphalt road so it NEVER overlaps or Z-fights with the road!
    const pt = roadPt.clone().addScaledVector(seaward, -(roadHalfWidth + 0.0012 + distInland));

    const r2Road = roadPt.x * roadPt.x + roadPt.z * roadPt.z;
    const roadCurveDrop = Math.sqrt(Math.max(0, EARTH_RADIUS * EARTH_RADIUS - r2Road)) - EARTH_RADIUS;
    const baseRoadH = roadPt.y - roadCurveDrop - 0.00035;

    const microRelief = (
      noise.ridged(pt.x * 8.0, pt.z * 8.0, 3) * 0.0040 +
      noise.fbm(pt.x * 18.0, pt.z * 18.0, 2) * 0.0015
    ) * Math.sin(uInland * Math.PI);

    const normX = Math.abs(lx) / (inlandWidth * 0.5);
    const skirtFade = Math.cos(Math.min(1.0, Math.max(normX, uInland)) * Math.PI * 0.5);
    const h = (baseRoadH + microRelief) * (skirtFade * skirtFade) - (1.0 - skirtFade) * 0.008;

    const r2 = pt.x * pt.x + pt.z * pt.z;
    const curveDrop = Math.sqrt(Math.max(0, EARTH_RADIUS * EARTH_RADIUS - r2)) - EARTH_RADIUS;

    pos.setX(i, pt.x);
    pos.setY(i, h + curveDrop);
    pos.setZ(i, pt.z);
  }
  terrainGeo.computeVertexNormals();

  const terrainMat = new THREE.MeshStandardMaterial({
    map: satelliteTex,
    color: 0xd6d3cd,
    roughness: 0.92,
    metalness: 0.02,
    side: THREE.DoubleSide
  });
  injectAerialPerspective(terrainMat, lampShared);
  const coastalTerrain = new THREE.Mesh(terrainGeo, terrainMat);
  miradorGroup.add(coastalTerrain);

  // Force opaque depth-buffered rendering on solid POV meshes so hardware Z-buffer sorts them cleanly
  roadShaderMat.transparent = false;
  promenadeMat.transparent = false;
  cliffMat.transparent = false;
  railMat.transparent = false;
  pierMat.transparent = false;
  pedestalMat.transparent = false;
  poleMat.transparent = false;
  lampMat.transparent = false;

  group.add(miradorGroup);

  let elapsed = 0.0;
  function update(deltaOrTime, cameraOrTimeOfDay, nightFactor = 0.0) {
    if (deltaOrTime < 1.0) {
      elapsed += deltaOrTime;
    } else {
      elapsed = deltaOrTime;
    }
    oceanUniforms.uTime.value = elapsed;

    let targetNight = 0.0;
    if (typeof cameraOrTimeOfDay === 'string') {
      targetNight = (cameraOrTimeOfDay === 'midnight') ? 1.0 : (cameraOrTimeOfDay === 'sunset' ? 0.35 : 0.0);
    } else if (typeof nightFactor === 'number') {
      targetNight = nightFactor;
    }
    lampShared.uNightFactor.value += (targetNight - lampShared.uNightFactor.value) * 0.08;
    lampMat.emissiveIntensity = lampShared.uNightFactor.value * 3.0;

    if (cameraOrTimeOfDay && typeof cameraOrTimeOfDay === 'object' && cameraOrTimeOfDay.position) {
      const camPos = cameraOrTimeOfDay.position;
      oceanUniforms.uCameraPos.value.copy(camPos);
      updateAtmosphereCamera(cameraOrTimeOfDay);

      // Submerge mirador smoothly into the crust above 1.2 km distance and hide completely above 3.5 km
      const distFromPov = camPos.length();
      const hideT = THREE.MathUtils.smoothstep(distFromPov, 1.2, 3.5);
      miradorGroup.position.y = -0.028 * hideT;
      miradorGroup.visible = hideT < 0.995;
      lampShared.uPovFade.value = 1.0 - hideT;
    }
  }

  return {
    group,
    earthMesh,
    oceanMat,
    cliffMesh,
    roadMesh,
    foamMesh,
    terrainMat,
    update,
    calculateHiddenHeightMeters
  };
}