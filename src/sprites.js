// src/sprites.js
// Phase 3 Photorealistic Mesospheric Red Sprite (Jellyfish C-Sprite TLE):
// - Zero solid revolution meshes (Rule AL-3)
// - Built from 140 vertical filamented plasma columns (66-78 km), fractal branched tendrils (46-68 km)
//   with glowing ionization beads, upward crown plumes (76-84 km), and diffuse ELVE/Sprite halo (82 km)

import * as THREE from 'three';
import { createRng } from './noise.js';
import {
  ATMOSPHERE_CONSTANTS_GLSL,
  ATMOSPHERE_GLSL,
  atmosphereUniforms
} from './atmosphere.js';
import { getEarthPosition, getEarthNormal } from './planet.js';

export function createRedSpritesSystem(initialDistKm = 130) {
  const group = new THREE.Group();
  group.name = 'red-sprites-action-system';
  group.visible = false;

  let currentDist = initialDistKm;
  let isPlaying = false;
  let animTime = 0;
  let duration = 0.22;
  let isSlowMo = false;
  let onCompleteCallback = null;

  const spriteUniforms = {
    ...atmosphereUniforms,
    uOpacity: { value: 0.0 },
    uIntensity: { value: 1.0 },
    uTime: { value: 0.0 }
  };

  // 1. Upper Diffuse Sprite Halo (82 km)
  const haloGeo = new THREE.PlaneGeometry(68, 68, 1, 1);
  haloGeo.rotateX(-Math.PI / 2);
  const haloShaderMat = new THREE.ShaderMaterial({
    uniforms: spriteUniforms,
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uOpacity;
      uniform float uIntensity;
      varying vec2 vUv;
      void main() {
        #include <logdepthbuf_fragment>
        vec2 c = (vUv - 0.5) * 2.0;
        float r = length(c);
        if (r > 1.0) discard;
        float glow = exp(-r * r * 4.2);
        vec3 col = mix(vec3(0.85, 0.03, 0.20), vec3(0.42, 0.01, 0.22), r);
        float alpha = glow * uOpacity * 0.42;
        gl_FragColor = vec4(col * uIntensity, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const haloMesh = new THREE.Mesh(haloGeo, haloShaderMat);
  group.add(haloMesh);

  // 2. Unified Plasma Columns & Branched Streamers Shader (Section §3.1.2)
  const streamerShaderMat = new THREE.ShaderMaterial({
    uniforms: spriteUniforms,
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float aAlt;
      attribute float aWidth;
      attribute float aBead;
      attribute float aBranchLevel;
      varying float vAlt;
      varying float vWidth;
      varying float vBead;
      varying float vBranchLevel;
      varying vec3 vWorldPos;
      void main() {
        vAlt = aAlt;
        vWidth = aWidth;
        vBead = aBead;
        vBranchLevel = aBranchLevel;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${ATMOSPHERE_CONSTANTS_GLSL}
      ${ATMOSPHERE_GLSL}
      uniform float uOpacity;
      uniform float uIntensity;
      varying float vAlt;
      varying float vWidth;
      varying float vBead;
      varying float vBranchLevel;
      varying vec3 vWorldPos;

      void main() {
        #include <logdepthbuf_fragment>
        float absW = abs(vWidth);
        if (absW > 1.0) discard;

        float core = exp(-absW * absW * 8.0);
        float halo = exp(-absW * absW * 2.2);

        // Physical nitrogen emission spectrum by altitude (45 km -> 80 km)
        float normAlt = clamp((vAlt - 45.0) / 32.0, 0.0, 1.0);
        vec3 blueVioletTip = vec3(0.18, 0.45, 1.00); // N2+ 1NG (45-55 km)
        vec3 purpleMid     = vec3(0.72, 0.10, 0.58); // Transition (55-65 km)
        vec3 crimsonHead   = vec3(1.00, 0.04, 0.20); // N2 1PG (65-80 km)

        vec3 plasmaCol = normAlt < 0.35
          ? mix(blueVioletTip, purpleMid, normAlt / 0.35)
          : mix(purpleMid, crimsonHead, (normAlt - 0.35) / 0.65);

        float beadGlow = vBead * exp(-absW * absW * 14.0) * 1.35;
        vec3 beadColor = mix(plasmaCol, vec3(1.0, 0.78, 0.86), 0.65);

        vec3 finalColor = plasmaCol * (halo * 0.42 + core * 0.85) + beadColor * beadGlow;
        float levelAtten = 1.0 / (1.0 + vBranchLevel * 0.35);
        finalColor *= levelAtten * uIntensity * 1.35;

        // Strict HDR cap prevents UnrealBloomPass from burning into a white/pink umbrella blob
        finalColor = min(finalColor, vec3(2.15));

        float alpha = (core * 0.82 + halo * 0.24 + beadGlow * 0.45) * uOpacity * levelAtten;
        if (alpha < 0.005) discard;

        gl_FragColor = vec4(finalColor, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const streamerGroup = new THREE.Group();
  group.add(streamerGroup);

  function addCrossRibbon(points, alts, beads, halfWidthKm, branchLevel, positions, aAlt, aWidth, aBead, aBranchLevel, indices) {
    if (points.length < 2) return;
    for (let axis = 0; axis < 2; axis++) {
      const startIndex = positions.length / 3;
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const nextP = points[Math.min(points.length - 1, i + 1)];
        const prevP = points[Math.max(0, i - 1)];
        const tangent = new THREE.Vector3().subVectors(nextP, prevP).normalize();
        const refVec = axis === 0 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
        let normal = new THREE.Vector3().crossVectors(tangent, refVec).normalize();
        if (normal.lengthSq() < 0.01) normal = new THREE.Vector3(0, 1, 0);

        const prog = i / (points.length - 1);
        const w = halfWidthKm * (1.05 - prog * 0.45);
        const pL = p.clone().addScaledVector(normal, -w);
        const pR = p.clone().addScaledVector(normal, w);

        positions.push(pL.x, pL.y, pL.z, pR.x, pR.y, pR.z);
        aAlt.push(alts[i], alts[i]);
        aWidth.push(-1.0, 1.0);
        aBead.push(beads[i], beads[i]);
        aBranchLevel.push(branchLevel, branchLevel);

        if (i < points.length - 1) {
          const v0 = startIndex + i * 2;
          const v1 = startIndex + i * 2 + 1;
          const v2 = startIndex + (i + 1) * 2;
          const v3 = startIndex + (i + 1) * 2 + 1;
          indices.push(v0, v1, v2, v1, v3, v2);
        }
      }
    }
  }

  function rebuildSpriteSwarm(distKm) {
    while (streamerGroup.children.length > 0) streamerGroup.remove(streamerGroup.children[0]);

    const rng = createRng(8085);
    const positions = [], aAlt = [], aWidth = [], aBead = [], aBranchLevel = [], indices = [];

    function generatePlasmaColumn(dKm, x0, baseAlt, topAlt, widthKm) {
      const steps = 9;
      const pts = [], alts = [], beads = [];
      let cx = x0, cz = dKm;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const alt = THREE.MathUtils.lerp(topAlt, baseAlt, t);
        cx += (rng() - 0.5) * 0.25;
        cz += (rng() - 0.5) * 0.25;
        pts.push(getEarthPosition(cz, alt, cx));
        alts.push(alt);
        const isIgnitionBead = (t > 0.15 && t < 0.45) || rng() > 0.72 ? 1.0 : 0.2;
        beads.push(isIgnitionBead);
      }
      addCrossRibbon(pts, alts, beads, widthKm, 0.0, positions, aAlt, aWidth, aBead, aBranchLevel, indices);
    }

    // 1. Parabolic Swarm of 140 Vertical C-Sprite Plasma Columns (65 km to 78 km)
    const columnCount = 140;
    for (let c = 0; c < columnCount; c++) {
      const angle = rng() * Math.PI * 2;
      const radius = Math.pow(rng(), 0.62) * 18.0;
      const x0 = Math.cos(angle) * radius;
      const z0 = Math.sin(angle) * radius * 0.78;
      const domeHeight = 78.0 - (radius / 18.0) * (radius / 18.0) * 8.0 + (rng() - 0.5) * 1.5;
      const baseAlt = 65.0 + (rng() - 0.5) * 2.8;
      generatePlasmaColumn(distKm + z0, x0, baseAlt, domeHeight, 0.20 + rng() * 0.22);
    }

    // 2. Fractal Branched Downward Tendrils (46 km to 67 km)
    const tendrilTrunks = 75;
    for (let i = 0; i < tendrilTrunks; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = 3.0 + Math.pow(rng(), 0.55) * 16.5;
      let curX = Math.cos(angle) * radius;
      let curZ = distKm + Math.sin(angle) * radius * 0.78;
      const topAlt = 66.5 + (rng() - 0.5) * 2.0;
      const botAlt = 46.5 + rng() * 5.0;
      const steps = 12;

      const pts = [], alts = [], beads = [];
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const alt = THREE.MathUtils.lerp(topAlt, botAlt, t);
        curX += (rng() - 0.5) * 0.85;
        curZ += (rng() - 0.5) * 0.75;
        pts.push(getEarthPosition(curZ, alt, curX));
        alts.push(alt);
        beads.push(rng() > 0.76 ? 1.0 : 0.0);

        // Secondary bifurcating branches
        if ((s === 4 || s === 7) && rng() > 0.35) {
          const bPts = [], bAlts = [], bBeads = [];
          let bx = curX, bz = curZ;
          const bSteps = 6;
          const bEndAlt = Math.max(45.5, alt - 6.0 - rng() * 5.0);
          const dirX = (rng() - 0.5) * 1.4;
          const dirZ = (rng() - 0.5) * 1.4;
          for (let bs = 0; bs <= bSteps; bs++) {
            const bt = bs / bSteps;
            const bAlt = THREE.MathUtils.lerp(alt, bEndAlt, bt);
            bx += dirX * 0.45 + (rng() - 0.5) * 0.4;
            bz += dirZ * 0.45 + (rng() - 0.5) * 0.4;
            bPts.push(getEarthPosition(bz, bAlt, bx));
            bAlts.push(bAlt);
            bBeads.push(bs === bSteps || rng() > 0.8 ? 0.9 : 0.0);
          }
          addCrossRibbon(bPts, bAlts, bBeads, 0.13, 1.0, positions, aAlt, aWidth, aBead, aBranchLevel, indices);
        }
      }
      addCrossRibbon(pts, alts, beads, 0.19 + rng() * 0.12, 0.5, positions, aAlt, aWidth, aBead, aBranchLevel, indices);
    }

    // 3. Upward Crown Filaments (76 km to 83.5 km)
    for (let i = 0; i < 32; i++) {
      const angle = (i / 32) * Math.PI * 2 + rng() * 0.2;
      const r = 2.0 + rng() * 11.0;
      let cx = Math.cos(angle) * r;
      let cz = distKm + Math.sin(angle) * r * 0.78;
      const bAlt = 76.0 + rng() * 1.5;
      const tAlt = 81.5 + rng() * 2.5;
      const pts = [], alts = [], beads = [];
      for (let s = 0; s <= 6; s++) {
        const t = s / 6;
        const alt = THREE.MathUtils.lerp(bAlt, tAlt, t);
        cx += (rng() - 0.5) * 0.4;
        cz += (rng() - 0.5) * 0.4;
        pts.push(getEarthPosition(cz, alt, cx));
        alts.push(alt);
        beads.push(0.2);
      }
      addCrossRibbon(pts, alts, beads, 0.22, 1.0, positions, aAlt, aWidth, aBead, aBranchLevel, indices);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aAlt', new THREE.Float32BufferAttribute(aAlt, 1));
    geo.setAttribute('aWidth', new THREE.Float32BufferAttribute(aWidth, 1));
    geo.setAttribute('aBead', new THREE.Float32BufferAttribute(aBead, 1));
    geo.setAttribute('aBranchLevel', new THREE.Float32BufferAttribute(aBranchLevel, 1));
    geo.setIndex(indices);
    streamerGroup.add(new THREE.Mesh(geo, streamerShaderMat));

    haloMesh.position.copy(getEarthPosition(distKm, 82.0, 0));
    haloMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), getEarthNormal(distKm, 0));
  }

  rebuildSpriteSwarm(currentDist);

  const spriteLight = new THREE.PointLight(0xff1844, 0, 220);
  spriteLight.position.copy(getEarthPosition(currentDist, 73.0, 0));
  group.add(spriteLight);

  function setDistance(distKm) {
    currentDist = distKm;
    rebuildSpriteSwarm(distKm);
    spriteLight.position.copy(getEarthPosition(distKm, 73.0, 0));
  }

  function triggerSprite(slowMo = false, onComplete = null) {
    isPlaying = true;
    animTime = 0;
    isSlowMo = slowMo;
    duration = isSlowMo ? 1.8 : 0.22;
    group.visible = true;
    onCompleteCallback = onComplete;
  }

  function update(delta) {
    if (!isPlaying) return;
    animTime += delta;
    spriteUniforms.uTime.value += delta;
    const progress = Math.min(1.0, animTime / duration);

    let opacity = 0;
    let lightIntensity = 0;
    if (progress < 0.12) {
      const t = progress / 0.12;
      opacity = Math.pow(t, 0.5);
      spriteUniforms.uIntensity.value = 1.0 + (1.0 - t) * 0.6;
      lightIntensity = t * 140;
    } else if (progress < 0.38) {
      opacity = 1.0;
      spriteUniforms.uIntensity.value = 1.0;
      lightIntensity = 140;
    } else {
      const decayT = (progress - 0.38) / 0.62;
      opacity = Math.pow(1.0 - decayT, 2.2);
      spriteUniforms.uIntensity.value = Math.max(0.25, 1.0 - decayT * 0.75);
      lightIntensity = opacity * 140;
    }

    spriteUniforms.uOpacity.value = opacity;
    spriteLight.intensity = lightIntensity;

    if (progress >= 1.0) {
      isPlaying = false;
      group.visible = false;
      spriteUniforms.uOpacity.value = 0;
      spriteLight.intensity = 0;
      if (onCompleteCallback) onCompleteCallback();
    }
  }

  return {
    group,
    triggerSprite,
    setDistance,
    update,
    isPlaying: () => isPlaying
  };
}