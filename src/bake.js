// src/bake.js
// Ultra-fast GPU RenderTarget Texture Baker
// - Generates macro-scale continental relief, river valleys, biomes, and city light networks
// - Uses setTimeout(0) so baking never stalls in background tabs

import * as THREE from 'three';
import { NOISE_GLSL } from './noise.js';
import { ATMOSPHERE_CONSTANTS_GLSL, TRANSMITTANCE_BAKE_FRAG } from './atmosphere.js';
import { rasterizeLand, rasterizeRivers, computeSignedDistanceKm, buildRawGeoDataTexture } from './geo.js';
import landJson from './data/land50.json';
import riversJson from './data/rivers50.json';

const _bakeGeo = new THREE.BufferGeometry();
_bakeGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
_bakeGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
const _bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export function bakeToTexture(renderer, {
  width,
  height,
  fragmentShader,
  uniforms = {},
  wrap = THREE.ClampToEdgeWrapping,
  mipmaps = true,
  anisotropy = 8
}) {
  const rt = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: wrap,
    wrapT: wrap,
    generateMipmaps: mipmaps,
    depthBuffer: false
  });

  const mat = new THREE.ShaderMaterial({
    uniforms,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `
  });

  const mesh = new THREE.Mesh(_bakeGeo, mat);
  const prevRT = renderer.getRenderTarget();
  const prevTM = renderer.toneMapping;

  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(rt);
  renderer.render(mesh, _bakeCam);
  renderer.setRenderTarget(prevRT);
  renderer.toneMapping = prevTM;

  mat.dispose();
  rt.texture.anisotropy = Math.min(anisotropy, renderer.capabilities.getMaxAnisotropy());
  return rt.texture;
}

const GEO_ENHANCE_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D uRawGeo;
uniform vec4 uBBox;
uniform bool uIsRegional;

${NOISE_GLSL}

struct Massif {
  float lat;
  float lon;
  float peakKm;
  float rxKm;
  float ryKm;
  float angDeg;
};

float evaluateMassifs(float lat, float lon, float coastSdf) {
  if (coastSdf > 0.0) return 0.0;

  Massif massifs[14];
  // 0: Sierra Nevada de Santa Marta (Colombian Caribbean coast - triangular pyramid massif)
  massifs[0]  = Massif(10.84, -73.72, 5.77,  38.0,  32.0,  35.0);
  // 1-3: Colombian Andes (Occidental, Central, Oriental)
  massifs[1]  = Massif( 5.50, -76.15, 3.60,  24.0, 290.0,  12.0);
  massifs[2]  = Massif( 4.90, -75.40, 5.10,  30.0, 320.0,  10.0);
  massifs[3]  = Massif( 6.10, -72.90, 4.50,  48.0, 340.0,  22.0);
  // 4-6: Perijá, Mérida & Venezuelan Coastal Range
  massifs[4]  = Massif(10.05, -72.92, 3.55,  22.0, 145.0, -12.0);
  massifs[5]  = Massif( 8.55, -71.05, 4.98,  36.0, 195.0,  42.0);
  massifs[6]  = Massif(10.35, -67.40, 2.50, 130.0,  26.0,  88.0);
  // 7-10: Central America & Greater Antilles
  massifs[7]  = Massif( 9.40, -83.10, 3.82,  95.0,  26.0,  68.0);
  massifs[8]  = Massif(19.02, -70.85, 3.09, 105.0,  32.0, 102.0);
  massifs[9]  = Massif(18.08, -76.62, 2.25,  28.0,  15.0,  88.0);
  massifs[10] = Massif(20.00, -76.80, 1.97,  92.0,  18.0,  98.0);
  // 11-13: Macro Continental Ranges (Ecuador/Peru Andes, Guiana Shield, Montes de María)
  massifs[11] = Massif(-1.50, -78.40, 5.40,  65.0, 620.0,  -8.0);
  massifs[12] = Massif( 5.20, -62.50, 2.80, 280.0, 190.0,  75.0);
  massifs[13] = Massif( 9.65, -75.25, 0.85,  18.0,  55.0,  15.0);

  float totalMtn = 0.0;
  for (int i = 0; i < 14; i++) {
    float mLat = massifs[i].lat;
    float mLon = massifs[i].lon;
    float dLatKm = (lat - mLat) * 111.32;
    float dLonKm = (lon - mLon) * 111.32 * cos(radians(mLat));

    float rad = radians(massifs[i].angDeg);
    float cosA = cos(rad), sinA = sin(rad);
    float xRot = dLonKm * cosA + dLatKm * sinA;
    float yRot = -dLonKm * sinA + dLatKm * cosA;

    float dist2 = (xRot * xRot) / (massifs[i].rxKm * massifs[i].rxKm) + (yRot * yRot) / (massifs[i].ryKm * massifs[i].ryKm);
    if (dist2 < 9.0) {
      float gauss = exp(-dist2 * 0.55);
      vec2 wCoord = warp2(vec2(dLonKm, dLatKm) * 0.06, 0.45, 1.1);
      float rid = ridged2(wCoord * 2.2, 5);
      float fineRid = ridged2(vec2(dLonKm, dLatKm) * 0.35, 3);
      totalMtn += massifs[i].peakKm * gauss * (0.42 + 0.45 * rid + 0.18 * fineRid);
    }
  }
  return totalMtn;
}

void main(){
  vec4 raw = texture2D(uRawGeo, vUv);
  float sdf = raw.r;
  float rivers = raw.a;

  float lon = mix(uBBox.x, uBBox.z, vUv.x);
  float lat = mix(uBBox.y, uBBox.w, vUv.y);

  float elev = 0.0;
  if (sdf <= 0.0) {
    float inland = clamp(-sdf / 55.0, 0.0, 1.0);
    vec2 wp = warp2(vec2(lon * 2.2 + 11.0, lat * 2.2 - 7.0), 0.35, 1.2);
    float baseFbm = fbm2(wp, 5) * 0.5 + 0.5;
    float foothills = ridged2(wp * 1.8, 4) * 0.22;
    elev = inland * (0.06 + 0.24 * baseFbm + foothills * inland);
    elev += evaluateMassifs(lat, lon, sdf);
    // Carve natural river valleys into the terrain elevation
    elev *= (1.0 - 0.55 * clamp(rivers, 0.0, 1.0));
  }

  // Macro biome moisture map (Guajira desert, Magdalena valley, Chocó/Amazon rainforest)
  float moist = 0.52 + 0.48 * (fbm2(vec2(lon * 1.6 - 4.2, lat * 1.6 + 12.1), 4) * 0.5 + 0.5);
  float dGuajira = length(vec2((lon - (-72.0)) * 111.32 * cos(radians(12.0)), (lat - 12.0) * 111.32));
  moist -= 0.65 * exp(-(dGuajira * dGuajira) / (2.0 * 145.0 * 145.0));
  float dFalcon = length(vec2((lon - (-69.8)) * 111.32 * cos(radians(11.5)), (lat - 11.5) * 111.32));
  moist -= 0.52 * exp(-(dFalcon * dFalcon) / (2.0 * 125.0 * 125.0));
  float dChoco = length(vec2((lon - (-77.0)) * 111.32 * cos(radians(5.8)), (lat - 5.8) * 111.32));
  moist += 0.38 * exp(-(dChoco * dChoco) / (2.0 * 210.0 * 210.0));
  moist = clamp(moist + rivers * 0.25, 0.0, 1.0);

  // Channel A: Rivers on land + Bocas de Ceniza (Magdalena River) sediment plume in the sea
  float chanA = rivers;
  if (sdf > 0.0) {
    float dLonP = (lon - (-74.85) - (18.0 * sin(radians(330.0))) / (111.32 * cos(radians(11.12))));
    float dLatP = (lat - 11.12 - (18.0 * cos(radians(330.0))) / 111.32);
    float distPlumeKm = length(vec2(dLonP * 111.32 * cos(radians(11.12)), dLatP * 111.32));
    chanA = 0.85 * exp(-(distPlumeKm * distPlumeKm) / (2.0 * 19.0 * 19.0));
  }

  gl_FragColor = vec4(sdf, elev, moist, chanA);
}
`;

const CITY_LIGHTS_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D uGlobalSdf;

${NOISE_GLSL}

struct City {
  float lat;
  float lon;
  float radiusKm;
  float brightness;
};

void main(){
  float lon = vUv.x * 360.0 - 180.0;
  float lat = vUv.y * 180.0 - 90.0;
  float sdf = texture2D(uGlobalSdf, vUv).r;

  if (sdf >= -0.4) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  City cities[16];
  cities[0]  = City(10.96, -74.80, 10.5, 1.15); // Barranquilla & Soledad
  cities[1]  = City(10.40, -75.50,  8.5, 0.95); // Cartagena
  cities[2]  = City(11.24, -74.20,  6.5, 0.75); // Santa Marta
  cities[3]  = City( 4.65, -74.08, 16.0, 1.55); // Bogotá
  cities[4]  = City( 6.25, -75.56, 12.5, 1.35); // Medellín
  cities[5]  = City( 3.45, -76.53, 11.5, 1.15); // Cali
  cities[6]  = City( 7.12, -73.12,  8.5, 0.90); // Bucaramanga
  cities[7]  = City(10.64, -71.64, 11.5, 1.20); // Maracaibo
  cities[8]  = City(10.50, -66.90, 13.5, 1.40); // Caracas
  cities[9]  = City(10.18, -68.00,  9.5, 1.00); // Valencia
  cities[10] = City( 8.98, -79.52, 10.5, 1.15); // Panamá
  cities[11] = City( 9.93, -84.08,  9.5, 1.05); // San José
  cities[12] = City(18.46, -66.10, 10.5, 1.05); // San Juan
  cities[13] = City(18.49, -69.93, 11.5, 1.15); // Santo Domingo
  cities[14] = City(23.11, -82.37, 12.0, 1.20); // La Habana
  cities[15] = City(25.76, -80.19, 15.0, 1.50); // Miami

  float light = 0.0;
  for (int i = 0; i < 16; i++) {
    float dLatKm = (lat - cities[i].lat) * 111.32;
    float dLonKm = (lon - cities[i].lon) * 111.32 * cos(radians(cities[i].lat));
    float dKm = length(vec2(dLonKm, dLatKm));
    float r = cities[i].radiusKm;
    if (dKm < r * 3.0) {
      float core = exp(-(dKm * dKm) / (2.0 * (r * 0.42) * (r * 0.42)));
      float halo = exp(-dKm / (r * 0.95)) * 0.38;
      float grid = fbm2(vec2(dLonKm, dLatKm) * 0.85, 3) * 0.5 + 0.5;
      light += cities[i].brightness * (core + halo) * (0.45 + 0.55 * grid);
    }
  }

  float landFactor = smoothstep(0.4, 2.8, -sdf);
  light *= landFactor;
  gl_FragColor = vec4(vec3(light), 1.0);
}
`;

const TERRAIN_BAKE_FRAG = /* glsl */`
varying vec2 vUv;
${NOISE_GLSL}
void main(){
  vec2 p = vUv * 6.0;
  vec2 wp = warp2(p, 0.4, 0.9);
  float f1 = fbm2(wp * 2.0, 5) * 0.5 + 0.5;
  float f2 = ridged2(wp * 1.5, 4);
  vec3 arid  = vec3(0.20, 0.15, 0.09);
  vec3 scrub = vec3(0.11, 0.14, 0.06);
  vec3 green = vec3(0.04, 0.10, 0.03);
  vec3 col = mix(arid, mix(scrub, green, f1), smoothstep(0.2, 0.8, f1));
  col = mix(col, vec3(0.16, 0.15, 0.14), smoothstep(0.45, 0.92, f2));
  gl_FragColor = vec4(col, 1.0);
}
`;

const OCEAN_NORMAL_FRAG = /* glsl */`
varying vec2 vUv;
${NOISE_GLSL}
float waveHeight(vec2 uv){
  float h = 0.0;
  h += sin(uv.x * 24.0 + uv.y * 12.0) * 0.35;
  h += sin(uv.x * -18.0 + uv.y * 28.0) * 0.25;
  h += sin(uv.x * 38.0 - uv.y * 16.0) * 0.18;
  h += sin(uv.y * 45.0) * 0.12;
  h += (fbm2(uv * 18.0, 4) * 0.5 + 0.5) * 0.22;
  return h;
}
void main(){
  float eps = 1.0 / 1024.0;
  float hL = waveHeight(vUv - vec2(eps, 0.0));
  float hR = waveHeight(vUv + vec2(eps, 0.0));
  float hD = waveHeight(vUv - vec2(0.0, eps));
  float hU = waveHeight(vUv + vec2(0.0, eps));
  vec3 norm = normalize(vec3(-(hR - hL) * 2.6, -(hU - hD) * 2.6, 1.0));
  gl_FragColor = vec4(norm * 0.5 + 0.5, 1.0);
}
`;

const WEATHER_MAP_FRAG = /* glsl */`
varying vec2 vUv;
${NOISE_GLSL}
void main(){
  // Regional coordinates across 320 km x 320 km Caribbean domain
  vec2 p = (vUv - 0.5) * 6.0;
  // Trade winds angle (approx 25 degrees)
  vec2 pRot = vec2(p.x * 0.90 - p.y * 0.42, p.x * 0.42 + p.y * 0.90);

  // Cloud streets (linear convective bands parallel to trade winds)
  float streetWave = sin(pRot.y * 12.0) * 0.5 + 0.5;
  float streetTurb = fbm2(pRot * vec2(2.5, 8.0), 4) * 0.5 + 0.5;
  float streetMask = smoothstep(0.35, 0.75, streetWave * 0.55 + streetTurb * 0.55);

  // Macro regional weather patterns
  float macroNoise = fbm2(vUv * 4.2 + vec2(3.1, -1.8), 4) * 0.5 + 0.5;
  float coverage = clamp(macroNoise * 0.65 + streetMask * 0.45 - 0.18, 0.0, 1.0);

  // Stratocumulus marine decks over the sea (seaward)
  float marineDeck = smoothstep(0.2, 0.8, -p.y + fbm2(p * 2.0, 3) * 0.4) * 0.55;
  coverage = clamp(max(coverage, marineDeck), 0.0, 1.0);

  // Base altitude: Marine LCL level 1.8 km to 2.2 km
  float baseAlt = 1.85 + 0.35 * fbm2(p * 1.5, 2);

  // Top altitude: 3.0 km for humilis, up to 7.5 km for congestus
  float topAlt = baseAlt + 1.2 + coverage * 4.2;

  // Cloud type: 0.15 cumulus humilis, 0.5 stratocumulus, 0.85 congestus
  float cloudType = mix(0.15, 0.85, coverage);

  gl_FragColor = vec4(coverage, baseAlt / 10.0, topAlt / 10.0, cloudType);
}
`;

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

export async function bakeAll(renderer, onProgress = () => {}) {
  const nextTick = () => new Promise(r => setTimeout(r, 0));

  onProgress(0.10, 'Horneando transmitancia atmosférica (LUT 256×64)...');
  await nextTick();
  const transLUT = bakeToTexture(renderer, {
    width: 256,
    height: 64,
    fragmentShader: TRANSMITTANCE_BAKE_FRAG,
    mipmaps: false,
    anisotropy: 1
  });

  onProgress(0.25, 'Horneando mapa meteorológico regional (1024²)...');
  await nextTick();
  const cloudAtlas = bakeToTexture(renderer, {
    width: 1024,
    height: 1024,
    fragmentShader: WEATHER_MAP_FRAG,
    wrap: THREE.RepeatWrapping,
    mipmaps: true,
    anisotropy: 8
  });

  onProgress(0.40, 'Horneando filamentos de cirros (1024²)...');
  await nextTick();
  const cirrus = bakeToTexture(renderer, {
    width: 1024,
    height: 1024,
    fragmentShader: CIRRUS_BAKE_FRAG,
    mipmaps: true,
    anisotropy: 4
  });

  onProgress(0.50, 'Horneando terreno satelital (1024²)...');
  await nextTick();
  const terrain = bakeToTexture(renderer, {
    width: 1024,
    height: 1024,
    fragmentShader: TERRAIN_BAKE_FRAG,
    mipmaps: true,
    anisotropy: 8
  });

  onProgress(0.60, 'Horneando normales oceánicas (1024²)...');
  await nextTick();
  const oceanNormal = bakeToTexture(renderer, {
    width: 1024,
    height: 1024,
    fragmentShader: OCEAN_NORMAL_FRAG,
    wrap: THREE.RepeatWrapping,
    mipmaps: true,
    anisotropy: 8
  });

  onProgress(0.72, 'Calculando mapas de distancia geodésicos (EDT)...');
  await nextTick();
  const regBBox = [-84, 4, -66, 18];
  const regMask = rasterizeLand(1024, 768, regBBox, landJson);
  const regRivers = rasterizeRivers(1024, 768, regBBox, riversJson);
  const regSDF = computeSignedDistanceKm(regMask, 1024, 768, 0.98);
  const rawRegional = buildRawGeoDataTexture(regSDF, regRivers, 1024, 768);

  const globBBox = [-180, -90, 180, 90];
  const globMask = rasterizeLand(1024, 512, globBBox, landJson);
  const globSDF = computeSignedDistanceKm(globMask, 1024, 512, 25.0);
  const rawGlobal = buildRawGeoDataTexture(globSDF, null, 1024, 512);

  onProgress(0.86, 'Horneando orografía y macizos montañosos en GPU...');
  await nextTick();
  const earthRegional = bakeToTexture(renderer, {
    width: 1024,
    height: 768,
    fragmentShader: GEO_ENHANCE_FRAG,
    uniforms: {
      uRawGeo: { value: rawRegional },
      uBBox: { value: new THREE.Vector4(...regBBox) },
      uIsRegional: { value: true }
    },
    mipmaps: true,
    anisotropy: 8
  });

  const earthGlobal = bakeToTexture(renderer, {
    width: 1024,
    height: 512,
    fragmentShader: GEO_ENHANCE_FRAG,
    uniforms: {
      uRawGeo: { value: rawGlobal },
      uBBox: { value: new THREE.Vector4(...globBBox) },
      uIsRegional: { value: false }
    },
    mipmaps: true,
    anisotropy: 8
  });

  onProgress(0.95, 'Horneando iluminación nocturna urbana...');
  await nextTick();
  const cityLights = bakeToTexture(renderer, {
    width: 1024,
    height: 512,
    fragmentShader: CITY_LIGHTS_FRAG,
    uniforms: {
      uGlobalSdf: { value: earthGlobal }
    },
    mipmaps: true,
    anisotropy: 4
  });

  onProgress(1.0, '¡Listo!');
  await nextTick();

  return {
    transLUT,
    cloudAtlas,
    cirrus,
    earthGlobal,
    earthRegional,
    terrain,
    oceanNormal,
    cityLights
  };
}