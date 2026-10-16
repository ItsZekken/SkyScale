// src/textures.js
// Procedural texture generators using GPU RenderTargets (bakeToTexture)
// Eliminates slow CPU loops, canvas premultiplication bugs, and sine-hash artifacts

import * as THREE from 'three';
import { bakeToTexture } from './bake.js';
import { NOISE_GLSL } from './noise.js';

// 1. Regional Cloud Weather Map (1024x1024)
// RGBA half-float: R = Coverage, G = Base Alt, B = Top Alt, A = Type/Moisture
const WEATHER_MAP_FRAG = /* glsl */`
varying vec2 vUv;
${NOISE_GLSL}
void main(){
  vec2 p = (vUv - 0.5) * 6.0;
  vec2 pRot = vec2(p.x * 0.90 - p.y * 0.42, p.x * 0.42 + p.y * 0.90);

  float streetWave = sin(pRot.y * 12.0) * 0.5 + 0.5;
  float streetTurb = fbm2(pRot * vec2(2.5, 8.0), 4) * 0.5 + 0.5;
  float streetMask = smoothstep(0.35, 0.75, streetWave * 0.55 + streetTurb * 0.55);

  float macroNoise = fbm2(vUv * 4.2 + vec2(3.1, -1.8), 4) * 0.5 + 0.5;
  float coverage = clamp(macroNoise * 0.65 + streetMask * 0.45 - 0.18, 0.0, 1.0);

  float marineDeck = smoothstep(0.2, 0.8, -p.y + fbm2(p * 2.0, 3) * 0.4) * 0.55;
  coverage = clamp(max(coverage, marineDeck), 0.0, 1.0);

  float baseAlt = 1.85 + 0.35 * fbm2(p * 1.5, 2);
  float topAlt = baseAlt + 1.2 + coverage * 4.2;
  float cloudType = mix(0.15, 0.85, coverage);

  gl_FragColor = vec4(coverage, baseAlt / 10.0, topAlt / 10.0, cloudType);
}
`;

export function generateVolumetricCloudTexture(renderer) {
  if (!renderer) {
    return new THREE.Texture();
  }
  return bakeToTexture(renderer, {
    width: 1024,
    height: 1024,
    fragmentShader: WEATHER_MAP_FRAG,
    wrap: THREE.RepeatWrapping,
    mipmaps: true,
    anisotropy: 8
  });
}

// 2. Wispy Cirrus Ice-Crystal Fibers (1024x1024)
const CIRRUS_BAKE_FRAG = /* glsl */`
varying vec2 vUv;
${NOISE_GLSL}
void main(){
  vec2 q = vUv * 2.0 - 1.0;
  float fall = pow(max(0.0, cos(min(1.0, abs(q.x)) * 1.5708) * cos(min(1.0, abs(q.y)) * 1.5708)), 1.4);
  vec2 p = vec2(q.x * 2.2 + q.y * 0.75 + sin(q.y * 6.0) * 0.15, q.y * 22.0);
  float fib = fbm2(vec2(p.x * 1.4 + 3.0, p.y), 5) * 0.5 + 0.5;
  float clump = fbm2(q * vec2(2.4, 3.2) + 9.0, 4) * 0.5 + 0.5;
  float density = smoothstep(0.28, 0.75, fib * 0.68 + clump * 0.38) * fall * 0.88;
  gl_FragColor = vec4(vec3(1.0), density);
}
`;

export function generateCirrusTexture(renderer) {
  if (!renderer) return new THREE.Texture();
  return bakeToTexture(renderer, {
    width: 1024,
    height: 1024,
    fragmentShader: CIRRUS_BAKE_FRAG,
    mipmaps: true,
    anisotropy: 4
  });
}

// 3. Multi-Scale Ocean Wave Normal Map (1024x1024)
const OCEAN_NORMAL_FRAG = /* glsl */`
varying vec2 vUv;
${NOISE_GLSL}
float waveHeight(vec2 uv){
  float h = 0.0;
  h += sin(uv.x * 24.0 + uv.y * 12.0) * 0.35;
  h += sin(uv.x * -18.0 + uv.y * 28.0) * 0.25;
  h += sin(uv.x * 38.0 - uv.y * 16.0) * 0.18;
  h += sin(uv.y * 45.0) * 0.12;
  h += (fbm2(uv * 18.0, 5) * 0.5 + 0.5) * 0.22;
  return h;
}
void main(){
  float eps = 1.0 / 1024.0;
  float hL = waveHeight(vUv - vec2(eps, 0.0));
  float hR = waveHeight(vUv + vec2(eps, 0.0));
  float hD = waveHeight(vUv - vec2(0.0, eps));
  float hU = waveHeight(vUv + vec2(0.0, eps));
  vec3 norm = normalize(vec3(-(hR - hL) * 2.8, -(hU - hD) * 2.8, 1.0));
  gl_FragColor = vec4(norm * 0.5 + 0.5, 1.0);
}
`;

export function generateOceanNormalMap(renderer) {
  if (!renderer) return new THREE.Texture();
  return bakeToTexture(renderer, {
    width: 1024,
    height: 1024,
    fragmentShader: OCEAN_NORMAL_FRAG,
    wrap: THREE.RepeatWrapping,
    mipmaps: true,
    anisotropy: 8
  });
}

// 4. Satellite Aerial Terrain Texture (1024x1024)
const TERRAIN_BAKE_FRAG = /* glsl */`
varying vec2 vUv;
${NOISE_GLSL}
void main(){
  vec2 p = vUv * 6.0;
  vec2 wp = warp2(p, 0.4, 0.9);
  float f1 = fbm2(wp * 2.0, 6) * 0.5 + 0.5;
  float f2 = ridged2(wp * 1.5, 5);
  vec3 arid = vec3(0.24, 0.18, 0.11);
  vec3 scrub = vec3(0.14, 0.16, 0.07);
  vec3 green = vec3(0.06, 0.12, 0.04);
  vec3 col = mix(arid, mix(scrub, green, f1), smoothstep(0.2, 0.8, f1));
  col = mix(col, vec3(0.18, 0.17, 0.16), smoothstep(0.4, 0.9, f2));
  gl_FragColor = vec4(col, 1.0);
}
`;

export function generateSatelliteTerrainTexture(renderer) {
  if (!renderer) return new THREE.Texture();
  return bakeToTexture(renderer, {
    width: 1024,
    height: 1024,
    fragmentShader: TERRAIN_BAKE_FRAG,
    mipmaps: true,
    anisotropy: 8
  });
}

// 5. Earth Globe Regional and Global Geography Textures
export function generateEarthGlobeTexture(bakedTextures) {
  if (bakedTextures && bakedTextures.earthGlobal) {
    return {
      global: bakedTextures.earthGlobal,
      regional: bakedTextures.earthRegional
    };
  }
  return {
    global: new THREE.Texture(),
    regional: new THREE.Texture()
  };
}

// 6. Earth City Lights Texture (Zero lights on water)
export function generateEarthCityLightsTexture(bakedTextures) {
  if (bakedTextures && bakedTextures.cityLights) {
    return bakedTextures.cityLights;
  }
  return new THREE.Texture();
}
