// src/lightning.js
// Phase 3 Volumetric Fractal Lightning System:
// - Includes logdepthbuf chunks (Rule AL-6) so bolts properly occlude against curved ocean & clouds
// - Calibrated HDR core (~2.35) so bolts trigger crisp electric bloom without blinding the screen
// - 3-tier stepped leader branching & onFlash callback

import * as THREE from 'three';
import { getEarthPosition } from './planet.js';

export function createLightningSystem(initialDistKm = 130, options = {}) {
  const group = new THREE.Group();
  group.name = 'lightning-system';

  let currentDist = initialDistKm;
  let animTimer = 0;

  const lightningUniforms = {
    uOpacity: { value: 0.92 },
    uCoreBoost: { value: 1.15 }
  };

  const boltShaderMat = new THREE.ShaderMaterial({
    uniforms: lightningUniforms,
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float aWidthCoord;
      attribute float aBranchType;
      varying float vWidthCoord;
      varying float vBranchType;
      void main() {
        vWidthCoord = aWidthCoord;
        vBranchType = aBranchType;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uOpacity;
      uniform float uCoreBoost;
      varying float vWidthCoord;
      varying float vBranchType;
      void main() {
        #include <logdepthbuf_fragment>
        float absW = abs(vWidthCoord);
        if (absW > 1.0) discard;

        float coreProfile = exp(-absW * absW * 16.0);
        float haloProfile = exp(-absW * absW * 3.6);

        // Calibrated HDR core (~2.35 max) triggers subtle electric bloom without whiteout
        vec3 coreColor = vec3(2.15, 2.25, 2.45);
        vec3 haloColor = mix(vec3(0.32, 0.78, 1.0), vec3(0.48, 0.36, 0.95), absW * 0.7);

        float coreWeight = vBranchType > 1.5 ? 0.35 : (vBranchType > 0.5 ? 0.60 : 1.0);
        vec3 finalColor = mix(haloColor * 0.95, coreColor * uCoreBoost, coreProfile * coreWeight);
        float alpha = haloProfile * uOpacity * (1.0 - vBranchType * 0.22);

        gl_FragColor = vec4(finalColor, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  function generateJaggedPath(start, end, jitter = 1.2, subdivisions = 5) {
    let points = [start, end];
    for (let s = 0; s < subdivisions; s++) {
      const nextPoints = [];
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
        const currentJitter = jitter / Math.pow(1.55, s);
        mid.x += (Math.random() - 0.5) * currentJitter;
        mid.y += (Math.random() - 0.5) * currentJitter * 0.65;
        mid.z += (Math.random() - 0.5) * currentJitter;
        nextPoints.push(p1, mid);
      }
      nextPoints.push(points[points.length - 1]);
      points = nextPoints;
    }
    return points;
  }

  function addBoltRibbon(points, halfWidthKm, branchType, positions, aWidthCoord, aBranchType, indices) {
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

        const pL = p.clone().addScaledVector(normal, -halfWidthKm);
        const pR = p.clone().addScaledVector(normal, halfWidthKm);
        positions.push(pL.x, pL.y, pL.z, pR.x, pR.y, pR.z);
        aWidthCoord.push(-1.0, 1.0);
        aBranchType.push(branchType, branchType);

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

  const strikeGroup = new THREE.Group();
  const megaflashGroup = new THREE.Group();

  function buildGroundStrike() {
    while (strikeGroup.children.length > 0) strikeGroup.remove(strikeGroup.children[0]);
    const positions = [], aWidthCoord = [], aBranchType = [], indices = [];

    const startX = (Math.random() - 0.5) * 10;
    const startPos = getEarthPosition(currentDist, 2.5, startX);
    const endPos = getEarthPosition(currentDist + (Math.random() - 0.5) * 3, 0.0, startX + (Math.random() - 0.5) * 3);

    const mainPoints = generateJaggedPath(startPos, endPos, 1.4, 5);
    addBoltRibbon(mainPoints, 0.038, 0.0, positions, aWidthCoord, aBranchType, indices);

    for (let i = 3; i < mainPoints.length - 3; i += 3) {
      const bStart = mainPoints[i];
      const bEnd = bStart.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 3.2,
        -0.8 - Math.random() * 0.9,
        (Math.random() - 0.5) * 3.2
      ));
      const bPts = generateJaggedPath(bStart, bEnd, 0.75, 3);
      addBoltRibbon(bPts, 0.018, 1.0, positions, aWidthCoord, aBranchType, indices);

      if (bPts.length > 3 && Math.random() > 0.35) {
        const tStart = bPts[Math.floor(bPts.length * 0.5)];
        const tEnd = tStart.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * 1.4,
          -0.4 - Math.random() * 0.5,
          (Math.random() - 0.5) * 1.4
        ));
        const tPts = generateJaggedPath(tStart, tEnd, 0.35, 2);
        addBoltRibbon(tPts, 0.009, 2.0, positions, aWidthCoord, aBranchType, indices);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aWidthCoord', new THREE.Float32BufferAttribute(aWidthCoord, 1));
    geo.setAttribute('aBranchType', new THREE.Float32BufferAttribute(aBranchType, 1));
    geo.setIndex(indices);
    strikeGroup.add(new THREE.Mesh(geo, boltShaderMat));

    if (options.onFlash) {
      options.onFlash(startPos, 5.5);
    }
  }

  function buildMegaflash() {
    while (megaflashGroup.children.length > 0) megaflashGroup.remove(megaflashGroup.children[0]);
    const positions = [], aWidthCoord = [], aBranchType = [], indices = [];

    const startPos = getEarthPosition(currentDist - 8, 14.5, -24);
    const endPos = getEarthPosition(currentDist + 8, 14.2, 32);
    const trunkPoints = generateJaggedPath(startPos, endPos, 3.8, 6);
    addBoltRibbon(trunkPoints, 0.055, 0.0, positions, aWidthCoord, aBranchType, indices);

    for (let i = 4; i < trunkPoints.length - 4; i += 4) {
      const p = trunkPoints[i];
      const sideEnd = p.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 8.0,
        (Math.random() - 0.5) * 2.2,
        (Math.random() - 0.5) * 9.5
      ));
      const sPts = generateJaggedPath(p, sideEnd, 1.8, 3);
      addBoltRibbon(sPts, 0.026, 1.0, positions, aWidthCoord, aBranchType, indices);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aWidthCoord', new THREE.Float32BufferAttribute(aWidthCoord, 1));
    geo.setAttribute('aBranchType', new THREE.Float32BufferAttribute(aBranchType, 1));
    geo.setIndex(indices);
    megaflashGroup.add(new THREE.Mesh(geo, boltShaderMat));
  }

  buildGroundStrike();
  buildMegaflash();
  group.add(strikeGroup, megaflashGroup);

  function setDistance(distKm) {
    currentDist = distKm;
    buildGroundStrike();
    buildMegaflash();
  }

  function update(delta) {
    animTimer += delta;
    if (animTimer > 0.85) {
      animTimer = 0;
      if (Math.random() > 0.35) {
        buildGroundStrike();
        buildMegaflash();
      }
    }
    const shimmer = 0.65 + Math.random() * 0.30;
    lightningUniforms.uOpacity.value = shimmer;
    lightningUniforms.uCoreBoost.value = 0.95 + Math.random() * 0.35;
  }

  return {
    group,
    update,
    setDistance,
    setVisible: (v) => { group.visible = v; }
  };
}