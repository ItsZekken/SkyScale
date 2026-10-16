// src/clouds.js
// 100% Volumetric 3D Raymarching Cloud Engine (Zero Billboards)
// - Realistic Cumulonimbus capillatus incus Supercell with tilted updraft core,
//   5 flanking congestus towers, overshooting top, flared glaciated anvil with mammatus, and arcus base
// - 360° Regional Cloud Field (Cumulus humilis/mediocris, Stratocumulus, Altocumulus) driven by Weather Map
// - 4-step light march with Beer-Powder multiple scattering, dual-lobe Henyey-Greenstein (Silver Lining),
//   and internal lightning flash illumination
// - IGN (Interleaved Gradient Noise) sub-pixel ray jittering for 60 FPS performance without banding

import * as THREE from 'three';
import { createRng, NOISE_GLSL } from './noise.js';
import {
  ATMOSPHERE_CONSTANTS_GLSL,
  ATMOSPHERE_GLSL,
  atmosphereUniforms
} from './atmosphere.js';
import { getEarthPosition } from './planet.js';
import { generateVolumetricCloudTexture, generateCirrusTexture } from './textures.js';

export const EARTH_RADIUS = 6371.0;

export function createRealisticClouds(initialDistKm = 130, bakes = null) {
  const group = new THREE.Group();
  group.name = 'photorealistic-clouds-system';

  const texAtlas = (bakes && bakes.cloudAtlas) ? bakes.cloudAtlas : generateVolumetricCloudTexture();
  const texCirrus = (bakes && bakes.cirrus) ? bakes.cirrus : generateCirrusTexture();

  const flashPositions = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3()
  ];
  const flashIntensities = [0.0, 0.0, 0.0, 0.0];

  const cloudUniforms = {
    ...atmosphereUniforms,
    uAtlas: { value: texAtlas },
    uCirrus: { value: texCirrus },
    uSunPosition: atmosphereUniforms.uSunDir,
    uStormDistKm: { value: initialDistKm },
    uStormFlash: { value: 0.0 },
    uTimeOfDay: { value: 1.0 },
    uTime: { value: 0.0 },
    uFlashPos: { value: flashPositions },
    uFlashInt: { value: flashIntensities }
  };

  // =========================================================================
  // 1. VOLUMETRIC 3D CLOUD SHELL (RAYMARCHING ENGINE)
  // =========================================================================
  const shellGeo = new THREE.SphereGeometry(EARTH_RADIUS + 18.5, 96, 64);

  const cloudMat = new THREE.ShaderMaterial({
    uniforms: cloudUniforms,
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>

      varying vec3 vWorldPos;
      varying vec3 vRayDir;

      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vRayDir = vWorldPos - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>

      #ifndef PI
      #define PI 3.141592653589793
      #endif

      uniform sampler2D uAtlas;
      uniform sampler2D uCirrus;
      uniform float uStormDistKm;
      uniform float uStormFlash;
      uniform float uTime;
      uniform vec3 uFlashPos[4];
      uniform float uFlashInt[4];

      varying vec3 vWorldPos;
      varying vec3 vRayDir;

      ${ATMOSPHERE_CONSTANTS_GLSL}
      ${ATMOSPHERE_GLSL}

      const float R_BASE = 6371.0 + 1.25;  // Cloud layer base: 1250 m
      const float R_TOP  = 6371.0 + 17.5;  // Cloud layer top: 17500 m

      // Fast Interleaved Gradient Noise for sub-pixel ray jittering (eliminates banding)
      float ign(vec2 p) {
        vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
        return fract(magic.z * fract(dot(p, magic.xy)));
      }

      // Fast 3D Value Noise for cloud cauliflower billow sculpting
      float hash13(vec3 p3) {
        p3 = fract(p3 * 0.1031);
        p3 += dot(p3, p3.zyx + 31.32);
        return fract((p3.x + p3.y) * p3.z);
      }

      float vnoise3(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        vec3 u = f * f * (3.0 - 2.0 * f);
        float n000 = hash13(i);
        float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
        float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
        float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
        float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
        float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
        float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
        float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
        return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
                   mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
      }

      // Analytical Ray-Sphere intersection
      vec2 intersectSphere(vec3 p0, vec3 rd, float R) {
        float b = dot(p0, rd);
        float c = dot(p0, p0) - R * R;
        float d = b * b - c;
        if (d < 0.0) return vec2(-1.0);
        float s = sqrt(d);
        return vec2(-b - s, -b + s);
      }

      // 1. Organic Multi-Lobe Cumulonimbus Supercell Macro Geometry
      float evalSupercell(float dx, float dz, float h) {
        // Main updraft complex: multiple interpenetrating convective domes
        float ax = 0.05 * pow(max(0.0, h - 3.0), 1.55);
        
        // Updraft Core 1: Central convective column
        float r1 = length(vec2(dx - ax, dz));
        float rTower1 = mix(8.8, 5.0, clamp((h - 2.2) / 11.0, 0.0, 1.0));
        float d1 = clamp(1.0 - (r1 - rTower1) / 3.4, 0.0, 1.0)
                 * smoothstep(1.5, 2.4, h) * smoothstep(15.0, 13.0, h);

        // Updraft Core 2: Forward convective lobe
        float r2 = length(vec2(dx - ax + 4.2, dz - 3.8));
        float rTower2 = mix(7.2, 4.0, clamp((h - 2.2) / 9.8, 0.0, 1.0));
        float d2 = clamp(1.0 - (r2 - rTower2) / 2.8, 0.0, 1.0)
                 * smoothstep(1.6, 2.4, h) * smoothstep(13.8, 12.0, h);

        // Updraft Core 3: Rear convective flank
        float r3 = length(vec2(dx - ax - 4.8, dz + 3.6));
        float rTower3 = mix(6.8, 3.8, clamp((h - 2.2) / 8.8, 0.0, 1.0));
        float d3 = clamp(1.0 - (r3 - rTower3) / 2.7, 0.0, 1.0)
                 * smoothstep(1.6, 2.4, h) * smoothstep(13.0, 11.4, h);

        // Updraft Core 4: Eastern bubbling dome
        float r4 = length(vec2(dx - ax + 7.2, dz + 1.4));
        float rTower4 = mix(6.0, 3.4, clamp((h - 2.2) / 7.8, 0.0, 1.0));
        float d4 = clamp(1.0 - (r4 - rTower4) / 2.6, 0.0, 1.0)
                 * smoothstep(1.6, 2.4, h) * smoothstep(12.2, 10.5, h);

        float densTowers = max(d1, max(d2, max(d3, d4)));

        // 5 Flanking Feeder Towers (Cumulus congestus staircase)
        float densFeeders = 0.0;
        {
          float rf = length(vec2(dx - (-16.0), dz - 3.0));
          float rLim = mix(5.0, 2.5, clamp((h - 2.2) / 7.0, 0.0, 1.0));
          float d = clamp(1.0 - (rf - rLim) / 2.2, 0.0, 1.0) * smoothstep(1.6, 2.4, h) * smoothstep(10.0, 9.0, h);
          densFeeders = max(densFeeders, d);
        }
        {
          float rf = length(vec2(dx - (-23.0), dz - (-2.0)));
          float rLim = mix(4.5, 2.2, clamp((h - 2.2) / 5.0, 0.0, 1.0));
          float d = clamp(1.0 - (rf - rLim) / 2.0, 0.0, 1.0) * smoothstep(1.6, 2.3, h) * smoothstep(8.0, 7.0, h);
          densFeeders = max(densFeeders, d);
        }
        {
          float rf = length(vec2(dx - (-30.0), dz - 4.0));
          float rLim = mix(4.0, 2.0, clamp((h - 2.2) / 3.2, 0.0, 1.0));
          float d = clamp(1.0 - (rf - rLim) / 1.8, 0.0, 1.0) * smoothstep(1.6, 2.2, h) * smoothstep(6.0, 5.2, h);
          densFeeders = max(densFeeders, d);
        }
        {
          float rf = length(vec2(dx - 15.0, dz - (-2.0)));
          float rLim = mix(4.6, 2.3, clamp((h - 2.2) / 6.2, 0.0, 1.0));
          float d = clamp(1.0 - (rf - rLim) / 2.0, 0.0, 1.0) * smoothstep(1.6, 2.3, h) * smoothstep(9.0, 8.0, h);
          densFeeders = max(densFeeders, d);
        }
        {
          float rf = length(vec2(dx - 22.0, dz - 2.0));
          float rLim = mix(4.2, 2.0, clamp((h - 2.2) / 3.6, 0.0, 1.0));
          float d = clamp(1.0 - (rf - rLim) / 1.8, 0.0, 1.0) * smoothstep(1.6, 2.2, h) * smoothstep(6.5, 5.4, h);
          densFeeders = max(densFeeders, d);
        }

        // Overshooting Top Dome (14.2 -> 16.8 km)
        vec3 otPos = vec3((dx - ax) / 4.4, (h - 14.5) / 2.4, dz / 4.4);
        float otDist = length(otPos) - 1.0;
        float densOT = clamp(1.0 - otDist * 1.8, 0.0, 1.0) * smoothstep(13.8, 14.6, h);

        // Organic Glaciated Anvil Canopy (Incus: 11.5 - 15.6 km)
        vec2 anvilCenter = vec2(10.0, 1.0);
        vec2 dAnvil = vec2(dx, dz) - anvilCenter;
        float rAnvil = length(vec2(dAnvil.x / 36.0, dAnvil.y / (20.0 * (1.0 + 0.12 * dAnvil.x / 36.0))));
        
        float hTop = mix(15.2, 13.2, smoothstep(0.1, 1.1, rAnvil));
        float hBot = mix(11.8, 12.4, smoothstep(0.1, 1.1, rAnvil));
        float vertAnvil = smoothstep(hBot - 0.8, hBot + 0.8, h) * smoothstep(hTop + 0.8, hTop - 0.8, h);
        float horizAnvil = smoothstep(1.25, 0.35, rAnvil);
        
        // Mammatus pouch sagging on underside (11.2 - 12.5 km)
        float mammatus = 0.0;
        if (h >= 11.0 && h <= 12.6 && rAnvil < 0.85) {
          float sag = sin(dx * 0.75) * sin(dz * 0.75) * 0.5 + 0.5;
          mammatus = sag * smoothstep(12.6, 11.8, h) * smoothstep(11.0, 11.8, h) * 0.35;
        }
        float densAnvil = (vertAnvil + mammatus) * horizAnvil * smoothstep(11.0, 12.2, h);

        // Arcus Shelf & Storm Base (1.7 - 2.9 km)
        float rBase = length(vec2(dx / 25.0, dz / 16.0));
        float densBase = clamp(1.0 - rBase, 0.0, 1.0) * smoothstep(1.5, 1.9, h) * smoothstep(3.2, 2.4, h);

        return max(densTowers, max(densFeeders, max(densOT, max(densAnvil, densBase))));
      }

      // 2. Regional 360° Cloud Layer from Weather Map
      float evalRegional(vec3 pos, float h) {
        vec2 uv = pos.xz * 0.0032 + vec2(0.5, 0.5);
        vec4 weather = texture2D(uAtlas, uv);
        float coverage = weather.r;
        float baseAlt = weather.g * 10.0;
        float topAlt  = weather.b * 10.0;
        
        if (h < baseAlt - 0.2 || h > topAlt + 0.3 || coverage < 0.12) return 0.0;

        float hNorm = (h - baseAlt) / max(0.2, topAlt - baseAlt);
        float vertProfile = smoothstep(0.0, 0.18, hNorm) * smoothstep(1.0, 0.68, hNorm);
        
        return clamp((coverage - 0.22) / 0.78, 0.0, 1.0) * vertProfile;
      }

      // 3. Complete Cloud Density with 3D Cauliflower Noise Modulation
      float evalCloudDensity(vec3 pos) {
        vec3 earthCenter = vec3(0.0, -R_EARTH, 0.0);
        float r = length(pos - earthCenter);
        float h = r - R_EARTH;
        if (h < 1.15 || h > 17.2) return 0.0;

        float theta = atan(-pos.z, pos.y + R_EARTH);
        float theta0 = uStormDistKm / R_EARTH;
        float dz = R_EARTH * (theta - theta0);
        float dx = pos.x;

        float dHoriz = sqrt(dx * dx + dz * dz);
        float macroStorm = (dHoriz < 58.0) ? evalSupercell(dx, dz, h) : 0.0;
        float macroRegional = evalRegional(pos, h);

        float macro = max(macroStorm, macroRegional);
        if (macro < 0.015) return 0.0;

        // Smooth base condensation fade (eliminates sharp bottom shelf)
        float baseFade = smoothstep(1.15, 1.85, h);
        macro *= baseFade;

        // Cauliflower billow noise (1.0 - abs(noise * 2.0 - 1.0))
        vec3 pNoise = pos * 0.26 + vec3(uTime * 0.008, 0.0, uTime * 0.004);
        if (h > 11.5) {
          // Sheared fibrous streaks for upper glaciated ice crystals
          pNoise = vec3(pos.x * 0.12, pos.y * 0.9, pos.z * 0.12 + pos.y * 0.25) + vec3(uTime * 0.025, 0.0, 0.0);
        }

        float n1 = vnoise3(pNoise);
        float n2 = vnoise3(pNoise * 2.2 + vec3(5.1, 2.3, 3.7));
        float billow1 = 1.0 - abs(n1 * 2.0 - 1.0);
        float billow2 = 1.0 - abs(n2 * 2.0 - 1.0);
        float billow = billow1 * 0.70 + billow2 * 0.30;

        float density = clamp((macro - (1.0 - billow) * 0.45) / 0.55, 0.0, 1.0);

        if (h > 12.0) {
          vec2 cirrusUv = pos.xz * 0.012;
          float cirrusVal = texture2D(uCirrus, cirrusUv).a;
          density = mix(density, density * (0.35 + 0.65 * cirrusVal), smoothstep(12.5, 15.0, h));
        }

        return density;
      }

      // 4. Optical Thickness March toward celestial light
      float lightMarch(vec3 pos, vec3 lightDir) {
        float tau = 0.0;
        tau += evalCloudDensity(pos + lightDir * 1.5) * 1.5;
        tau += evalCloudDensity(pos + lightDir * 4.2) * 2.7;
        tau += evalCloudDensity(pos + lightDir * 9.5) * 5.3;
        tau += evalCloudDensity(pos + lightDir * 21.0) * 11.5;
        return tau;
      }

      // Dual-lobe Henyey-Greenstein phase function for Silver Lining & backscatter
      float hg(float cosT, float g) {
        float g2 = g * g;
        return (1.0 - g2) / (4.0 * PI * pow(max(1e-4, 1.0 + g2 - 2.0 * g * cosT), 1.5));
      }

      void main() {
        #include <logdepthbuf_fragment>

        vec3 earthCenter = vec3(0.0, -R_EARTH, 0.0);
        vec3 p0 = cameraPosition - earthCenter;
        float camR = length(p0);

        // Discard opposing shell faces so raymarching executes exactly once per pixel
        bool isOutside = camR > R_TOP;
        if (isOutside && !gl_FrontFacing) discard;
        if (!isOutside && gl_FrontFacing) discard;

        vec3 rd = normalize(vRayDir);

        vec2 hit1 = intersectSphere(p0, rd, R_BASE);
        vec2 hit2 = intersectSphere(p0, rd, R_TOP);
        vec2 hitEarth = intersectSphere(p0, rd, R_EARTH);

        float tNear = 0.0;
        float tFar  = 0.0;

        if (camR < R_BASE) {
          // Coastal ground observer (POV at 25m)
          if (hit1.y <= 0.0) discard;
          tNear = max(0.0, hit1.y);
          tFar  = hit2.y;
        } else if (camR > R_TOP) {
          // Space or orbital observer (> 17.5 km)
          if (hit2.x <= 0.0 && hit2.y <= 0.0) discard;
          tNear = max(0.0, hit2.x);
          if (hitEarth.x > 0.0) {
            tFar = hitEarth.x;
          } else {
            tFar = hit2.y;
          }
        } else {
          // Inside cloud layer (1.2 to 17.5 km)
          tNear = 0.0;
          tFar  = hit2.y;
          if (hitEarth.x > 0.0) {
            tFar = min(tFar, hitEarth.x);
          }
        }

        if (tFar <= tNear || tNear < 0.0) discard;
        tFar = min(tFar, tNear + 140.0);

        // Raymarching setup with 44 steps and Interleaved Gradient Noise spatial jittering
        const int NUM_STEPS = 44;
        float dt = (tFar - tNear) / float(NUM_STEPS);
        float jitter = ign(gl_FragCoord.xy);
        float t = tNear + dt * jitter;

        vec3 lightDir = normalize(uSunDir);
        vec3 lightCol = uSunTint * (uSunIrradiance / PI);
        if (dot(uSunDir, vec3(0.0, 1.0, 0.0)) < -0.10) {
          lightDir = normalize(uMoonDir);
          lightCol = uMoonTint * (uMoonIrradiance / PI);
        }

        float cosTheta = dot(rd, lightDir);
        // Phase function scaled by 4*PI so isotropic average is 1.0 (matching direct irradiance)
        float phase = mix(hg(cosTheta, 0.72), hg(cosTheta, -0.25), 0.35) * (4.0 * PI);

        vec3 skyAmbient = vec3(0.52, 0.68, 0.88) * 0.45;
        vec3 groundAmbient = vec3(0.18, 0.28, 0.38) * 0.30;

        vec3 accumCol = vec3(0.0);
        float accumTransmittance = 1.0;
        float firstHitDist = -1.0;

        for (int i = 0; i < NUM_STEPS; i++) {
          if (t >= tFar) break;
          vec3 p = cameraPosition + rd * t;
          float density = evalCloudDensity(p);

          if (density > 0.003) {
            if (firstHitDist < 0.0) {
              firstHitDist = t;
            }

            // Light march with physical Beer-Lambert and multiple scattering
            float tau = lightMarch(p, lightDir);
            float beer = exp(-tau * 0.28);
            float shadow = max(beer, exp(-tau * 0.08) * 0.32);

            // Internal lightning flash illumination
            vec3 flashCol = vec3(0.0);
            if (uStormFlash > 0.01) {
              for (int k = 0; k < 4; k++) {
                if (uFlashInt[k] > 0.05) {
                  vec3 toFlash = uFlashPos[k] - p;
                  float d2 = dot(toFlash, toFlash);
                  flashCol += vec3(0.70, 0.84, 1.0) * (uFlashInt[k] / (d2 + 9.0)) * 2.2;
                }
              }
            }

            vec3 upVec = normalize(p - earthCenter);
            float ambFactor = clamp(dot(upVec, lightDir) * 0.5 + 0.5, 0.0, 1.0);
            vec3 amb = mix(groundAmbient, skyAmbient, ambFactor);

            vec3 stepLight = lightCol * shadow * phase + amb * (0.35 + 0.65 * beer) + flashCol;
            float stepExtinction = density * 0.28;
            float stepTrans = exp(-stepExtinction * dt);

            vec3 integLight = stepLight * (1.0 - stepTrans);
            accumCol += integLight * accumTransmittance;
            accumTransmittance *= stepTrans;

            if (accumTransmittance < 0.01) {
              break;
            }
          }

          t += dt;
        }

        float accumAlpha = 1.0 - accumTransmittance;
        if (accumAlpha < 0.004) discard;

        // Aerial perspective in-scattering & transmittance
        vec3 localSunDir = getSunDirAt(uCamPos);
        Atmo atmo = atmosphereMarch(uCamAlt, uCamUp, rd, localSunDir, firstHitDist > 0.0 ? firstHitDist : tNear, 4);
        vec3 finalCol = accumCol * atmo.transmittance + atmo.inscatter * accumAlpha;

        // Soft HDR compression to prevent glare
        finalCol = finalCol / (1.0 + finalCol * 0.28);

        gl_FragColor = vec4(finalCol, accumAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide
  });

  const cloudShellMesh = new THREE.Mesh(shellGeo, cloudMat);
  cloudShellMesh.position.set(0, -EARTH_RADIUS, 0);
  cloudShellMesh.frustumCulled = false;
  cloudShellMesh.renderOrder = 10;
  group.add(cloudShellMesh);

  // =========================================================================
  // 2. RAIN VIRGA CURTAINS UNDER SUPERCELL BASE (0.0 - 2.15 KM)
  // =========================================================================
  const rngRain = createRng(5512);
  const SHAFT_COUNT = 20;
  const rainShafts = [];
  for (let i = 0; i < SHAFT_COUNT; i++) {
    const ang = rngRain() * Math.PI * 2;
    const rad = Math.pow(rngRain(), 0.7) * 7.5;
    rainShafts.push({
      x: Math.cos(ang) * rad,
      z: Math.sin(ang) * rad * 0.85,
      width: 1.9 + rngRain() * 2.2,
      height: 2.15,
      seed: rngRain() * 100.0,
      slant: 0.32 + rngRain() * 0.65
    });
  }

  const rBaseAttr = new Float32Array(SHAFT_COUNT * 4 * 3);
  const rCornerAttr = new Float32Array(SHAFT_COUNT * 4 * 2);
  const rParamsAttr = new Float32Array(SHAFT_COUNT * 4 * 4);
  const rIndices = [];

  for (let i = 0; i < SHAFT_COUNT; i++) {
    const s = rainShafts[i];
    const wp = getEarthPosition(initialDistKm + s.z, 0.0, s.x);
    const vIdx = i * 4;
    const corners = [[-1, 0], [1, 0], [1, 1], [-1, 1]];
    for (let k = 0; k < 4; k++) {
      const vk = vIdx + k;
      rBaseAttr[vk * 3 + 0] = wp.x;
      rBaseAttr[vk * 3 + 1] = wp.y;
      rBaseAttr[vk * 3 + 2] = wp.z;
      rCornerAttr[vk * 2 + 0] = corners[k][0];
      rCornerAttr[vk * 2 + 1] = corners[k][1];
      rParamsAttr[vk * 4 + 0] = s.width;
      rParamsAttr[vk * 4 + 1] = s.height;
      rParamsAttr[vk * 4 + 2] = s.seed;
      rParamsAttr[vk * 4 + 3] = s.slant;
    }
    rIndices.push(vIdx, vIdx + 1, vIdx + 2, vIdx, vIdx + 2, vIdx + 3);
  }

  const rainGeo = new THREE.BufferGeometry();
  const rainBaseBuffer = new THREE.BufferAttribute(rBaseAttr, 3);
  rainGeo.setAttribute('position', rainBaseBuffer);
  rainGeo.setAttribute('aBase', rainBaseBuffer);
  rainGeo.setAttribute('aCorner', new THREE.BufferAttribute(rCornerAttr, 2));
  rainGeo.setAttribute('aParams', new THREE.BufferAttribute(rParamsAttr, 4));
  rainGeo.setIndex(rIndices);

  const rainMat = new THREE.ShaderMaterial({
    uniforms: cloudUniforms,
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      ${ATMOSPHERE_CONSTANTS_GLSL}
      ${ATMOSPHERE_GLSL}

      attribute vec3 aBase;
      attribute vec2 aCorner;
      attribute vec4 aParams;

      varying vec2 vC;
      varying float vSeed;
      varying vec3 vWorldPos;
      varying vec3 vTransmittance, vInscatter, vSky, vDirectCol, vPrimaryDir;

      void main(){
        vec3 up = normalize(vec3(aBase.x, aBase.y + 6371.0, aBase.z));
        vec3 right = normalize(cross(up, cameraPosition - aBase));
        vec3 wind = normalize(vec3(1.0, 0.0, 0.0) - up * up.x);

        float v = aCorner.y;
        vec3 p = aBase + up * (v * aParams.y)
               + right * (aCorner.x * aParams.x * 0.5 * (0.65 + 0.35 * v))
               + wind * aParams.w * (1.0 - v);

        vC = vec2(aCorner.x, v);
        vSeed = aParams.z;
        vWorldPos = p;

        float alt = max(0.0, altitudeAboveSea(p));
        vec3 localSun = getSunDirAt(p);
        vSky = atmosphereMarch(alt, up, up, localSun, 1e9, 3).inscatter * 0.50;
        vec3 primDir;
        vDirectCol = evalDirectCelestialLight(alt, up, p, primDir);
        vPrimaryDir = primDir;

        vec3 d = p - cameraPosition;
        float dist = length(d);
        Atmo a = atmosphereMarch(uCamAlt, uCamUp, d / max(dist, 1e-4), localSun, dist, 4);
        vTransmittance = a.transmittance;
        vInscatter = a.inscatter;

        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${NOISE_GLSL}
      #ifndef PI
      #define PI 3.141592653589793
      #endif

      uniform float uTime;
      uniform float uStormFlash;
      varying vec2 vC;
      varying float vSeed;
      varying vec3 vWorldPos;
      varying vec3 vTransmittance, vInscatter, vSky, vDirectCol, vPrimaryDir;

      void main(){
        #include <logdepthbuf_fragment>
        float u = vC.x, v = vC.y;
        float n1 = fbm2(vec2(u * 11.0 + vSeed, v * 2.2 + uTime * 0.9), 4) * 0.5 + 0.5;
        float n2 = fbm2(vec2(u * 27.0 + vSeed * 2.0, v * 4.0 + uTime * 1.5), 3) * 0.5 + 0.5;
        float dens = smoothstep(0.30, 0.85, n1 * 0.6 + n2 * 0.4);
        float a = 0.46 * dens * (1.0 - smoothstep(0.35, 1.0, abs(u))) * smoothstep(1.0, 0.88, v) * smoothstep(0.0, 0.08, v);
        if (a < 0.004) discard;

        vec3 V = normalize(cameraPosition - vWorldPos);
        float fwd = pow(max(0.0, dot(-V, vPrimaryDir)), 3.2);
        vec3 col = vSky + (vDirectCol / PI) * (0.08 + 0.35 * fwd);
        col = mix(col, vSky * 0.35, v * 0.65);
        col += vec3(0.65, 0.80, 1.0) * uStormFlash * 0.25;
        col = col / (1.0 + col * 0.4);

        gl_FragColor = vec4(col * vTransmittance + vInscatter, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide
  });

  const rainMesh = new THREE.Mesh(rainGeo, rainMat);
  rainMesh.frustumCulled = false;
  group.add(rainMesh);

  // =========================================================================
  // 3. LIGHTNING FLASH & ILLUMINATION SYSTEM
  // =========================================================================
  const flashLight = new THREE.PointLight(0xdbeafe, 0, 220);
  flashLight.position.copy(getEarthPosition(initialDistKm, 7.5, 0));
  group.add(flashLight);

  let currentDist = initialDistKm;
  let flashSlotIdx = 0;

  function addFlash(worldPos, intensity = 6.0) {
    flashPositions[flashSlotIdx].copy(worldPos);
    flashIntensities[flashSlotIdx] = Math.min(intensity, 8.0);
    flashSlotIdx = (flashSlotIdx + 1) % 4;
  }

  function setDistance(distKm) {
    currentDist = distKm;
    cloudUniforms.uStormDistKm.value = distKm;

    for (let i = 0; i < SHAFT_COUNT; i++) {
      const s = rainShafts[i];
      const wp = getEarthPosition(distKm + s.z, 0.0, s.x);
      const vIdx = i * 4;
      for (let k = 0; k < 4; k++) {
        rainBaseBuffer.setXYZ(vIdx + k, wp.x, wp.y, wp.z);
      }
    }
    rainBaseBuffer.needsUpdate = true;
    flashLight.position.copy(getEarthPosition(distKm, 7.5, 0));
  }

  let flashTimer = 0;
  let flashStep = 0;

  function update(delta) {
    cloudUniforms.uTime.value += delta;
    for (let i = 0; i < 4; i++) {
      flashIntensities[i] *= Math.exp(-delta / 0.09);
    }

    flashTimer += delta;
    if (flashStep === 0 && flashTimer > 4.5 + Math.random() * 4.0) {
      flashStep = 1;
      flashTimer = 0;
      flashLight.intensity = 90;
      cloudUniforms.uStormFlash.value = 0.65;
      addFlash(getEarthPosition(currentDist, 7.0 + Math.random() * 5.0, (Math.random() - 0.5) * 14.0), 5.5);
    } else if (flashStep === 1 && flashTimer > 0.06) {
      flashLight.intensity = 25;
      cloudUniforms.uStormFlash.value = 0.18;
      flashStep = 2;
    } else if (flashStep === 2 && flashTimer > 0.14) {
      flashLight.intensity = 110;
      cloudUniforms.uStormFlash.value = 0.80;
      addFlash(getEarthPosition(currentDist, 11.0 + Math.random() * 3.0, (Math.random() - 0.5) * 20.0), 6.5);
      flashStep = 3;
    } else if (flashStep === 3 && flashTimer > 0.25) {
      flashLight.intensity = 0;
      cloudUniforms.uStormFlash.value = 0.0;
      flashStep = 0;
      flashTimer = 0;
    }
  }

  function setTimeOfDay() {
    // Shader dynamically accesses atmosphereUniforms every frame
  }

  const stats = {
    widthKm: 72.0,
    depthKm: 42.0,
    topKm: 16.8,
    volumeKm3: 5680,
    waterTons: 5680000
  };

  return {
    group,
    update,
    setTimeOfDay,
    setDistance,
    addFlash,
    stats,
    flashLight,
    cloudUniforms
  };
}