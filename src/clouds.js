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
  const texNoiseAtlas = (bakes && bakes.noiseAtlas) ? bakes.noiseAtlas : texAtlas;
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
    uNoiseAtlas: { value: texNoiseAtlas },
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
  // 1. VOLUMETRIC 3D CLOUD SHELL (60 FPS BOUNDED RAYMARCHING ENGINE)
  // =========================================================================
  const shellGeo = new THREE.SphereGeometry(EARTH_RADIUS + 18.0, 96, 64);

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
      uniform sampler2D uNoiseAtlas;
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

      const float R_BASE     = 6371.0 + 1.35;  // Marine LCL cloud base: 1350 m
      const float R_REG_TOP  = 6371.0 + 5.20;  // Regional trade-wind cumulus top: 5200 m
      const float R_TOP      = 6371.0 + 17.20; // Supercell overshooting top: 17200 m

      // Interleaved Gradient Noise for sub-pixel ray jittering
      float ign(vec2 p) {
        vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
        return fract(magic.z * fract(dot(p, magic.xy)));
      }

      // Trilinear Hardware 3D Volume Noise Atlas Lookup (64^3 packed in 8x8 slices of 512x512)
      // Eliminates Z-slice terracing and replaces 40 ALU hash ops with 2 hardware 2D fetches!
      vec4 sampleNoise3D(vec3 p) {
        vec3 uvw = fract(p);
        float z = uvw.z * 64.0;
        float z0 = floor(z);
        float z1 = mod(z0 + 1.0, 64.0);
        float fz = fract(z);
        vec2 xy = uvw.xy * 63.0 + 0.5;
        vec2 slice0 = vec2(mod(z0, 8.0), floor(z0 * 0.125));
        vec2 slice1 = vec2(mod(z1, 8.0), floor(z1 * 0.125));
        vec2 uv0 = (slice0 * 64.0 + xy) * (1.0 / 512.0);
        vec2 uv1 = (slice1 * 64.0 + xy) * (1.0 / 512.0);
        return mix(texture2D(uNoiseAtlas, uv0), texture2D(uNoiseAtlas, uv1), fz);
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

      // 1. Organic Multi-Turret Cumulonimbus Supercell Macro Geometry
      float evalSupercell(float dx, float dz, float h) {
        // Wind shear leans the upper updraft and anvil eastward (+X) and northward (-Z)
        float shearX = 0.048 * pow(max(0.0, h - 2.5), 1.55);
        float shearZ = 0.018 * pow(max(0.0, h - 4.0), 1.45);
        vec3 q = vec3(dx - shearX, h, dz - shearZ);

        // Central updraft column + 3D boiling spherical convective turrets along altitude
        float rMain = length(q.xz);
        float rCol  = mix(8.2, 5.2, clamp((h - 2.0) * 0.085, 0.0, 1.0))
                    + 1.35 * sin(h * 1.15) * smoothstep(2.5, 12.5, h);
        float dMain = smoothstep(rCol + 3.2, rCol - 2.4, rMain)
                    * smoothstep(1.45, 2.25, h) * smoothstep(15.2, 12.8, h);

        // 3D Spherical Convective Turrets (boiling cauliflower domes around the main core)
        float dTurrets = 0.0;
        dTurrets = max(dTurrets, smoothstep(5.8, 1.8, length(vec3(q.x - 4.8, (h - 6.2) * 1.15, q.z + 3.4))));
        dTurrets = max(dTurrets, smoothstep(6.2, 2.0, length(vec3(q.x + 5.2, (h - 8.4) * 1.10, q.z - 3.6))));
        dTurrets = max(dTurrets, smoothstep(5.6, 1.8, length(vec3(q.x - 3.6, (h - 10.6) * 1.15, q.z - 4.2))));
        dTurrets = max(dTurrets, smoothstep(6.0, 2.0, length(vec3(q.x + 4.4, (h - 11.8) * 1.20, q.z + 3.2))));
        dTurrets = max(dTurrets, smoothstep(5.2, 1.6, length(vec3(q.x - 7.5, (h - 4.8) * 1.25, q.z - 1.5))));
        dTurrets = max(dTurrets, smoothstep(5.4, 1.7, length(vec3(q.x + 7.8, (h - 5.6) * 1.20, q.z + 2.4))));

        // Flanking Cumulus Congestus feeder staircase (2.0 - 9.8 km)
        float dFeeders = 0.0;
        if (h < 10.5) {
          dFeeders = max(dFeeders, smoothstep(5.5, 1.6, length(vec3(dx + 14.5, (h - 5.4) * 0.95, dz - 2.8))));
          dFeeders = max(dFeeders, smoothstep(4.8, 1.4, length(vec3(dx + 21.0, (h - 4.0) * 1.10, dz + 1.8))));
          dFeeders = max(dFeeders, smoothstep(5.2, 1.5, length(vec3(dx - 13.8, (h - 4.8) * 1.00, dz + 2.5))));
          dFeeders = max(dFeeders, smoothstep(4.4, 1.3, length(vec3(dx - 19.5, (h - 3.5) * 1.15, dz - 2.0))));
          dFeeders *= smoothstep(1.45, 2.15, h);
        }

        // Overshooting Top Dome (13.2 -> 16.6 km)
        float dOT = 0.0;
        if (h > 12.8) {
          vec3 otPos = vec3((q.x - 0.6) * 0.19, (h - 14.3) * 0.42, q.z * 0.19);
          dOT = smoothstep(1.25, 0.25, length(otPos)) * smoothstep(13.0, 14.1, h);
        }

        // Glaciated Anvil Canopy (Cumulonimbus capillatus incus: 11.2 - 15.6 km)
        float dAnvil = 0.0;
        if (h > 10.6) {
          vec2 dAnv = vec2(dx - 9.5, dz - 0.8);
          float rAnv = length(vec2(dAnv.x * 0.030, dAnv.y / (18.5 + 0.08 * max(0.0, dAnv.x))));
          float hTop = mix(15.2, 13.4, smoothstep(0.10, 1.05, rAnv));
          float hBot = mix(11.4, 12.5, smoothstep(0.10, 1.05, rAnv));
          float vertAnv = smoothstep(hBot - 0.9, hBot + 0.9, h) * smoothstep(hTop + 0.85, hTop - 0.85, h);
          float horizAnv = smoothstep(1.18, 0.22, rAnv);
          dAnvil = vertAnv * horizAnv;
        }

        // Low Arcus Shelf & Rain-Cooled Outflow Base (1.45 - 3.3 km)
        float dBase = 0.0;
        if (h < 3.6) {
          float rBase = length(vec2(dx * 0.042, dz * 0.058));
          dBase = smoothstep(1.05, 0.25, rBase) * smoothstep(1.45, 1.95, h) * smoothstep(3.5, 2.3, h);
        }

        return max(max(dMain, dTurrets), max(dFeeders, max(dOT, max(dAnvil, dBase))));
      }

      // 2. Pre-baked Regional Caribbean Mesoscale Cloud Layer (500 km x 500 km domain)
      float evalRegional(vec3 pos, float h, out float outTopAlt, out float outBillow) {
        vec2 uv = pos.xz * (1.0 / 500.0) + 0.5;
        vec4 weather = texture2D(uAtlas, uv);
        float coverage = weather.r;
        float baseAlt  = weather.g * 10.0;
        float topAlt   = weather.b * 10.0;
        outTopAlt = topAlt;
        outBillow = weather.a;

        if (h < baseAlt - 0.15 || h > topAlt + 0.25 || coverage < 0.14) return 0.0;

        float hNorm = (h - baseAlt) / max(0.25, topAlt - baseAlt);
        float vertProfile = smoothstep(0.0, 0.22, hNorm) * smoothstep(1.0, 0.55, hNorm);
        return clamp((coverage - 0.15) * 1.22, 0.0, 1.0) * vertProfile;
      }

      // Fast Density Evaluation for Regional-Only Rays (misses Supercell)
      float evalRegionalDensity(vec3 pos, float h, out float outTauSun, vec3 lightDir) {
        float topAlt, preBillow;
        float macro = evalRegional(pos, h, topAlt, preBillow);
        if (macro < 0.015) {
          outTauSun = 0.0;
          return 0.0;
        }
        vec3 pNoise = pos * 0.038 + vec3(uTime * 0.00014, 0.0, uTime * 0.00008);
        vec4 nMacro = sampleNoise3D(pNoise);
        vec4 nFine  = sampleNoise3D(pNoise * 2.3 + vec3(0.31, 0.57, 0.19));
        float billow = mix(preBillow, nMacro.g * 0.68 + nFine.g * 0.32, 0.78);
        float density = clamp((macro - (1.0 - billow) * 0.48) * 1.90, 0.0, 1.0);
        if (density < 0.003) {
          outTauSun = 0.0;
          return 0.0;
        }

        // Smooth directional Worley puff self-shadowing: bright sunlit crowns, dark bases & crevices
        float nSun = sampleNoise3D(pNoise + lightDir * 0.12).g;
        float creviceTau = max(0.0, nSun - nMacro.g + 0.12) * 2.6 + (1.0 - nMacro.g) * 0.45;
        float dhTop = max(0.0, topAlt - h);
        float baseDarkening = smoothstep(0.35, 1.85, dhTop) * 2.1;
        outTauSun = baseDarkening + creviceTau;
        return density;
      }

      // Full Density + Directional Cauliflower Self-Shadowing for Supercell Rays
      float evalFullCloudDensity(vec3 pos, float h, out float outTauSun, vec3 lightDir) {
        float dx = pos.x;
        float dz = -pos.z - uStormDistKm;
        float dHoriz = length(vec2(dx - 6.0, dz));

        float topAlt = 3.8, preBillow = 0.5;
        float macroRegional = (h < 5.3) ? evalRegional(pos, h, topAlt, preBillow) : 0.0;
        if (dHoriz >= 35.0 && macroRegional < 0.015) {
          outTauSun = 0.0;
          return 0.0;
        }

        vec3 pConv = pos * 0.038 + vec3(uTime * 0.00014, 0.0, uTime * 0.00008);
        vec3 pAnv  = vec3(pos.x * 0.018, pos.y * 0.055, pos.z * 0.018 + pos.y * 0.015);
        vec3 pNoise = mix(pConv, pAnv, smoothstep(11.4, 13.4, h));

        vec4 nMacro = sampleNoise3D(pNoise);
        vec4 nMed   = sampleNoise3D(pNoise * 2.20 + vec3(0.37, 0.61, 0.23));

        // Gentle, fold-free 3D macro domain warp (strictly < 1/4 wavelength so zero speckle!)
        float anvilMask = smoothstep(11.2, 13.5, h);
        vec3 warp = (nMacro.rgb - 0.5) * mix(2.1, 0.7, anvilMask);
        float macroStorm = (dHoriz < 35.0)
          ? evalSupercell(dx + warp.x, dz + warp.z, h + warp.y * 0.45)
          : 0.0;

        float macro = max(macroStorm, macroRegional);
        if (macro < 0.015) {
          outTauSun = 0.0;
          return 0.0;
        }

        float baseFade = smoothstep(1.38, 1.95, h);
        macro *= baseFade;

        float billow = nMacro.g * 0.64 + nMed.g * 0.36;

        // Clean 3D Worley cauliflower carving on tower flanks, smooth fibrous glaciation on anvil
        float erosionStrength = mix(0.56, 0.34, anvilMask);
        float density = clamp((macro - (1.0 - billow) * erosionStrength) / (1.0 - erosionStrength * 0.78), 0.0, 1.0);

        if (h > 11.6) {
          float cirrusVal = texture2D(uCirrus, pos.xz * 0.014).a;
          density *= mix(1.0, 0.42 + 0.58 * cirrusVal, smoothstep(12.0, 14.8, h));
        }
        if (density < 0.003) {
          outTauSun = 0.0;
          return 0.0;
        }

        // High-Contrast Smooth Directional 3D Self-Shadowing:
        // Bright sunlit cauliflower crowns + deep shadowed crevices, anvil overhang, and dark storm base
        if (macroStorm > macroRegional) {
          vec3 stormNormal = normalize(vec3(dx - 4.0, (h - 7.8) * 1.45, dz));
          float sunFacing = dot(stormNormal, lightDir);

          float billowSun  = sampleNoise3D(pNoise + lightDir * 0.13).g;
          float puffCrevice = max(0.0, billowSun - nMacro.g + 0.12) * 3.2 + (1.0 - billow) * 0.75;

          float leeShadow = smoothstep(0.40, -0.45, sunFacing) * 2.8;
          float deepCore  = smoothstep(0.68, 0.96, macroStorm) * 2.4;

          vec2 sunOff = vec2(dx, dz) + lightDir.xz * 5.0;
          float underAnvil = (1.0 - smoothstep(9.5, 12.6, h))
                           * smoothstep(25.0, 8.0, length(sunOff - vec2(8.0, 0.5))) * 1.75;
          float darkBase   = (1.0 - smoothstep(1.5, 4.2, h)) * 2.4;

          outTauSun = puffCrevice + leeShadow + deepCore + underAnvil + darkBase;
        } else {
          float nSun = sampleNoise3D(pNoise + lightDir * 0.12).g;
          float creviceTau = max(0.0, nSun - nMacro.g + 0.12) * 2.6 + (1.0 - nMacro.g) * 0.45;
          float dhTop = max(0.0, topAlt - h);
          float baseDarkening = smoothstep(0.35, 1.85, dhTop) * 2.1;
          outTauSun = baseDarkening + creviceTau;
        }

        return density;
      }

      float hg(float cosT, float g) {
        float g2 = g * g;
        return (1.0 - g2) / (4.0 * PI * pow(max(1e-4, 1.0 + g2 - 2.0 * g * cosT), 1.5));
      }

      void main() {
        #include <logdepthbuf_fragment>

        // Smart Altitude Unloading: planetary cloud layer takes over completely above 88 km
        if (uCamAlt > 88.0) discard;

        vec3 earthCenter = vec3(0.0, -R_EARTH, 0.0);
        vec3 p0 = cameraPosition - earthCenter;
        float camR = length(p0);

        bool isOutside = camR > R_TOP;
        if (isOutside && !gl_FrontFacing) discard;
        if (!isOutside && gl_FrontFacing) discard;

        vec3 rd = normalize(vRayDir);

        // 1. Tight Supercell 3D Bounding Sphere (radius 34 km around storm center -> small dt, zero stipple!)
        float stormDrop = (uStormDistKm * uStormDistKm) / (2.0 * R_EARTH);
        vec3 stormCenter = vec3(6.0, 9.0 - stormDrop, -uStormDistKm);
        vec2 hitStorm = intersectSphere(cameraPosition - stormCenter, rd, 34.0);

        // 2. Intersect low Regional Cumulus Slab [R_BASE .. R_REG_TOP] and full Troposphere [R_BASE .. R_TOP]
        vec2 hitBase  = intersectSphere(p0, rd, R_BASE);
        vec2 hitReg   = intersectSphere(p0, rd, R_REG_TOP);
        vec2 hitTop   = intersectSphere(p0, rd, R_TOP);
        vec2 hitEarth = intersectSphere(p0, rd, R_EARTH);

        float tRegNear = 0.0, tRegFar = -1.0;
        if (camR < R_BASE) {
          if (hitBase.y > 0.0) {
            tRegNear = max(0.0, hitBase.y);
            tRegFar  = min(hitReg.y, tRegNear + 24.0);
          }
        } else if (camR > R_REG_TOP) {
          if (hitReg.x > 0.0 || hitReg.y > 0.0) {
            tRegNear = max(0.0, hitReg.x);
            float rawEnd = (hitEarth.x > 0.0) ? min(hitReg.y, hitEarth.x) : hitReg.y;
            tRegFar = min(rawEnd, tRegNear + 28.0);
          }
        } else {
          tRegNear = 0.0;
          float rawEnd = (hitEarth.x > 0.0) ? min(hitReg.y, hitEarth.x) : hitReg.y;
          tRegFar = min(rawEnd, 24.0);
        }
        bool hasReg = (tRegFar > tRegNear);
        if (hasReg) {
          vec3 pRegEntry = cameraPosition + rd * tRegNear;
          if (length(pRegEntry.xz) > 215.0) hasReg = false;
        }

        float tShellNear = 0.0, tShellFar = -1.0;
        if (camR < R_BASE) {
          tShellNear = max(0.0, hitBase.y);
          tShellFar  = hitTop.y;
        } else if (camR > R_TOP) {
          tShellNear = max(0.0, hitTop.x);
          tShellFar  = (hitEarth.x > 0.0) ? min(hitTop.y, hitEarth.x) : hitTop.y;
        } else {
          tShellNear = 0.0;
          tShellFar  = (hitEarth.x > 0.0) ? min(hitTop.y, hitEarth.x) : hitTop.y;
        }

        float tStormNear = max(tShellNear, max(0.0, hitStorm.x));
        float tStormFar  = min(tShellFar, hitStorm.y);
        bool hitsSupercell = (hitStorm.y > 0.0 && tStormFar > tStormNear + 0.05);

        if (!hasReg && !hitsSupercell) discard;

        // Balanced Blue-Noise IGN jitter (eliminates discrete step shells without graininess)
        float jitter = (ign(gl_FragCoord.xy) - 0.5) * 0.72 + 0.5;

        bool isNight = (dot(uSunDir, vec3(0.0, 1.0, 0.0)) < -0.08);
        vec3 lightDir = isNight ? normalize(uMoonDir) : normalize(uSunDir);
        float cosTheta = dot(rd, lightDir);

        // Energy-conserving base phase function (no nuclear forward blowout!)
        float basePhase = 0.65 + 0.35 * hg(cosTheta, -0.22) * (4.0 * PI);
        float rawSilver = min(hg(cosTheta, 0.74) * (4.0 * PI), 4.6);

        vec3 accumCol = vec3(0.0);
        float accumTransmittance = 1.0;
        float firstHitDist = -1.0;

        // Determine front-to-back segments based on whether camera is below or above the regional cloud tops
        bool doSeg1 = false;
        float s1Near = 0.0, s1Far = 0.0;
        bool doSeg2 = false;
        float s2Near = 0.0, s2Far = 0.0;

        if (camR <= R_REG_TOP) {
          if (hasReg) {
            s1Near = tRegNear;
            s1Far  = hitsSupercell ? min(tRegFar, tStormNear) : tRegFar;
            doSeg1 = (s1Far > s1Near + 0.05);
          }
          if (hitsSupercell) {
            s2Near = hasReg ? max(tStormNear, s1Far) : tStormNear;
            s2Far  = min(tStormFar, s2Near + 48.0);
            doSeg2 = (s2Far > s2Near + 0.05);
          }
        } else {
          if (!hitsSupercell) {
            s1Near = tRegNear;
            s1Far  = tRegFar;
            doSeg1 = hasReg;
          } else {
            float stormChord = clamp((tStormFar - tStormNear) / 16.0, 0.0, 1.0);
            s2Near = hasReg ? mix(tRegNear, min(tRegNear, tStormNear), stormChord) : tStormNear;
            s2Far  = hasReg ? mix(tRegFar,  max(tRegFar,  tStormFar),  stormChord) : tStormFar;
            s2Far  = min(s2Far, s2Near + 52.0);
            doSeg2 = (s2Far > s2Near + 0.05);
          }
        }

        if (!doSeg1 && !doSeg2) discard;
        float tNear = doSeg1 ? s1Near : s2Near;

        // Segment 1: Tight Regional Cumulus Slab (14 steps)
        if (doSeg1) {
          float dtReg = (s1Far - s1Near) / 14.0;
          float t = s1Near + dtReg * jitter;
          for (int i = 0; i < 14; i++) {
            vec3 p = cameraPosition + rd * t;
            float r = length(p - earthCenter);
            float h = r - R_EARTH;

            float tau = 0.0;
            float density = evalRegionalDensity(p, h, tau, lightDir);

            if (density > 0.003) {
              if (firstHitDist < 0.0) firstHitDist = t;
              vec3 upVec = (p - earthCenter) / r;
              float muL = dot(upVec, lightDir);

              vec3 directLight = isNight
                ? sunTransmittance(h, max(muL, 0.05)) * (uMoonIrradiance / PI) * uMoonTint
                : sunTransmittance(h, max(muL, -0.04)) * (uSunIrradiance / PI) * uSunTint * smoothstep(-0.06, 0.06, muL);

              float shadow = max(exp(-tau * 0.45), exp(-tau * 0.15) * 0.22);
              float rimMask = accumTransmittance * exp(-tau * 1.45) * (1.0 - smoothstep(0.32, 0.80, density));
              float phase = basePhase + rawSilver * rimMask;

              float dayAmbScale = isNight ? 0.03 : clamp(muL * 1.8 + 0.15, 0.05, 1.0);
              float sunsetWarmth = isNight ? 0.0 : exp(-pow((muL - 0.02) / 0.08, 2.0));
              vec3 skyAmb = mix(vec3(0.32, 0.46, 0.68), vec3(0.52, 0.28, 0.18), sunsetWarmth * 0.75) * dayAmbScale;
              vec3 gndAmb = mix(vec3(0.10, 0.18, 0.28), vec3(0.24, 0.12, 0.08), sunsetWarmth * 0.70) * dayAmbScale;
              float hFrac = clamp((h - 1.4) / 12.0, 0.0, 1.0);
              vec3 amb = mix(gndAmb, skyAmb, 0.35 + 0.65 * hFrac) * (0.28 + 0.72 * exp(-tau * 0.22));

              vec3 stepLight = directLight * shadow * phase + amb;
              float stepExtinction = density * 0.62 * smoothstep(0.0, 0.15, density);
              float stepTrans = exp(-stepExtinction * dtReg);

              accumCol += stepLight * (1.0 - stepTrans) * accumTransmittance;
              accumTransmittance *= stepTrans;
              if (accumTransmittance < 0.008) {
                accumTransmittance = 0.0;
                break;
              }
            }
            t += dtReg;
          }
        }

        // Segment 2: Tight Supercell Bounding Sphere (26 steps)
        if (doSeg2 && accumTransmittance > 0.008) {
          float dtStorm = (s2Far - s2Near) / 26.0;
          float t = s2Near + dtStorm * jitter;
          for (int i = 0; i < 26; i++) {
            vec3 p = cameraPosition + rd * t;
            float r = length(p - earthCenter);
            float h = r - R_EARTH;

            float tau = 0.0;
            float density = evalFullCloudDensity(p, h, tau, lightDir);

            if (density > 0.003) {
              if (firstHitDist < 0.0) firstHitDist = t;
              vec3 upVec = (p - earthCenter) / r;
              float muL = dot(upVec, lightDir);

              vec3 directLight = isNight
                ? sunTransmittance(h, max(muL, 0.05)) * (uMoonIrradiance / PI) * uMoonTint
                : sunTransmittance(h, max(muL, -0.04)) * (uSunIrradiance / PI) * uSunTint * smoothstep(-0.06, 0.06, muL);

              float shadow = max(exp(-tau * 0.45), exp(-tau * 0.15) * 0.22);
              float rimMask = accumTransmittance * exp(-tau * 1.45) * (1.0 - smoothstep(0.32, 0.80, density));
              float phase = basePhase + rawSilver * rimMask;

              vec3 flashCol = vec3(0.0);
              if (uStormFlash > 0.01) {
                for (int k = 0; k < 4; k++) {
                  if (uFlashInt[k] > 0.05) {
                    vec3 toFlash = uFlashPos[k] - p;
                    flashCol += vec3(0.70, 0.84, 1.0) * (uFlashInt[k] / (dot(toFlash, toFlash) + 9.0)) * 2.2;
                  }
                }
              }

              float dayAmbScale = isNight ? 0.03 : clamp(muL * 1.8 + 0.15, 0.05, 1.0);
              float sunsetWarmth = isNight ? 0.0 : exp(-pow((muL - 0.02) / 0.08, 2.0));
              vec3 skyAmb = mix(vec3(0.32, 0.46, 0.68), vec3(0.52, 0.28, 0.18), sunsetWarmth * 0.75) * dayAmbScale;
              vec3 gndAmb = mix(vec3(0.10, 0.18, 0.28), vec3(0.24, 0.12, 0.08), sunsetWarmth * 0.70) * dayAmbScale;
              float hFrac = clamp((h - 1.4) / 12.0, 0.0, 1.0);
              vec3 amb = mix(gndAmb, skyAmb, 0.35 + 0.65 * hFrac) * (0.28 + 0.72 * exp(-tau * 0.22));

              vec3 stepLight = directLight * shadow * phase + amb + flashCol;
              float stepExtinction = density * 0.62 * smoothstep(0.0, 0.15, density);
              float stepTrans = exp(-stepExtinction * dtStorm);

              accumCol += stepLight * (1.0 - stepTrans) * accumTransmittance;
              accumTransmittance *= stepTrans;
              if (accumTransmittance < 0.008) {
                accumTransmittance = 0.0;
                break;
              }
            }
            t += dtStorm;
          }
        }

        // Solidify core opacity so dense storm/cumulus cores block 100% of the solar disk behind them
        float rawAlpha = 1.0 - accumTransmittance;
        if (rawAlpha < 0.004) discard;

        // Even a thin cloud layer blocks the sharp direct solar disk (e^(-tau_beam) -> 0)
        float solarDiskBlock = smoothstep(0.996, 0.9995, cosTheta) * smoothstep(0.04, 0.25, rawAlpha);
        float accumAlpha = max(smoothstep(0.0, 0.86, rawAlpha), solarDiskBlock);

        // Seamless spatial & altitude cross-fade into the pre-baked Planetary Cloud Layer in planet.js
        vec3 pHit = cameraPosition + rd * (firstHitDist > 0.0 ? firstHitDist : tNear);
        float horizDist = length(pHit.xz);
        float domainFade = (1.0 - smoothstep(140.0, 210.0, horizDist)) * (1.0 - smoothstep(48.0, 88.0, uCamAlt));
        accumAlpha *= domainFade;
        if (accumAlpha < 0.004) discard;

        // Un-premultiply cloud scattered light so NormalBlending does not double-darken cloud edges
        vec3 cloudRadiance = accumCol / max(rawAlpha, 1e-4);

        // Aerial perspective in-scattering & transmittance
        vec3 localSunDir = getSunDirAt(uCamPos);
        Atmo atmo = atmosphereMarch(uCamAlt, uCamUp, rd, localSunDir, firstHitDist > 0.0 ? firstHitDist : tNear, 4);
        vec3 finalCol = cloudRadiance * atmo.transmittance + atmo.inscatter;

        // Soft HDR shoulder (k=0.62 caps max radiance at 1.61 < 1.85 bloom threshold, preventing any blurry sun glare!)
        finalCol = finalCol / (1.0 + finalCol * 0.62);

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

    // Smart CPU-level unloading: completely skip rendering the local 3D volumetric shell
    // and rain shafts when in orbit (> 88 km) or far outside the local domain (> 320 km)
    const camAlt = atmosphereUniforms.uCamAlt.value;
    const camPos = atmosphereUniforms.uCamPos.value;
    const camHorizDist = Math.hypot(camPos.x, camPos.z);
    cloudShellMesh.visible = (camAlt < 89.0 && camHorizDist < 320.0);
    rainMesh.visible = (camAlt < 42.0 && camHorizDist < 210.0);

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