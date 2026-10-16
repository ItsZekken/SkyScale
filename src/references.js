// src/references.js
// Phase 4 Scale References & Geodesic Curvature Guides:
// - Mount Everest (8,848 m) with zero green floating disc (seamless feathered Himalayan granite & glacier snow)
// - Burj Khalifa (828 m) & Boeing 787 Commercial Airliner (11,000 m)
// - Evaluates 1 AU Solar + Orbiting Lunar illumination & per-pixel aerial perspective

import * as THREE from 'three';
import { createNoise, NOISE_GLSL } from './noise.js';
import {
  ATMOSPHERE_CONSTANTS_GLSL,
  ATMOSPHERE_GLSL,
  atmosphereUniforms
} from './atmosphere.js';
import { getEarthPosition, getEarthNormal, calculateHiddenHeightMeters, EARTH_RADIUS } from './planet.js';

export function createScaleReferences(initialDistKm = 130) {
  const group = new THREE.Group();
  group.name = 'scale-references';

  let currentDist = initialDistKm;
  const pinSprites = [];

  // =========================================================================
  // 1. MOUNT EVEREST MASSIF (8,848 m — Seamless Feathered Base, Zero Green Ring!)
  // =========================================================================
  const everestGroup = new THREE.Group();
  const everestX = -38;

  function generateEverestGeometry() {
    const sizeKm = 24.0;
    const segments = 144;
    const geo = new THREE.PlaneGeometry(sizeKm, sizeKm, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const noise = createNoise(9921);

    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const lz = pos.getZ(i);
      const r = Math.hypot(lx, lz) / (sizeKm * 0.5);
      const r2 = lx * lx + lz * lz;
      const curveDrop = Math.sqrt(Math.max(0, EARTH_RADIUS * EARTH_RADIUS - r2)) - EARTH_RADIUS;

      if (r >= 1.0) {
        pos.setY(i, -0.45 + curveDrop);
        continue;
      }

      // Domain-warped coordinates for Himalayan arêtes (South-East, North-East, West ridges)
      const [wx, wz] = noise.warp(lx * 0.16, lz * 0.16, 1.35, 0.5);
      const angle = Math.atan2(wz, wx);
      const threeRidges = Math.pow(Math.abs(Math.cos(angle * 1.5 + 0.35)), 1.6) * 0.38 + 0.62;

      const baseEnvelope = Math.pow(1.0 - r, 1.95) * threeRidges;
      const rNoise = noise.ridged(wx * 1.18, wz * 1.18, 8, 2.06, 0.52);
      const detailFbm = noise.fbm(lx * 0.65, lz * 0.65, 4) * 0.12;

      let elevationKm = baseEnvelope * 8.848 * (0.42 + 0.62 * rNoise) + detailFbm * (1.0 - r);

      // Force exact 8,848 m summit height at center
      if (r < 0.08) {
        elevationKm = THREE.MathUtils.lerp(8.848, elevationKm, r / 0.08);
      }

      // Smoothly dip the outer skirt below sea level so there is never a flat disc perimeter
      const skirtDip = THREE.MathUtils.smoothstep(r, 0.72, 1.0) * 0.35;
      elevationKm = elevationKm - skirtDip;
      pos.setY(i, elevationKm + curveDrop);
    }

    geo.computeVertexNormals();
    return geo;
  }

  const everestGeo = generateEverestGeometry();

  const everestMat = new THREE.ShaderMaterial({
    uniforms: {
      ...atmosphereUniforms
    },
    transparent: true,
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec2 vLocalXZ;
      void main() {
        vLocalXZ = position.xz / 12.0;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec2 vLocalXZ;

      ${NOISE_GLSL}
      ${ATMOSPHERE_CONSTANTS_GLSL}
      ${ATMOSPHERE_GLSL}

      void main() {
        #include <logdepthbuf_fragment>

        float alt = altitudeAboveSea(vWorldPos);
        float rad = length(vLocalXZ);
        if (alt < 0.02 || rad > 0.96) discard;

        vec3 N = normalize(vWorldNormal);
        vec3 up = normalize(vec3(vWorldPos.x, vWorldPos.y + R_EARTH, vWorldPos.z));
        float slope = clamp(dot(N, up), 0.0, 1.0);

        float nMacro = fbm3(vWorldPos * 0.55, 4) * 0.5 + 0.5;
        float strata = sin(alt * 18.0 + nMacro * 6.0) * 0.5 + 0.5;

        // Pure Himalayan dark gneiss/slate rock + Yellow Band strata + glacier snow (NO green jungle ring!)
        vec3 lowerSlate  = mix(vec3(0.05, 0.065, 0.085), vec3(0.11, 0.125, 0.145), nMacro);
        vec3 darkGranite = mix(vec3(0.08, 0.09, 0.11), vec3(0.18, 0.19, 0.21), strata * 0.7 + nMacro * 0.3);
        vec3 glacierSnow = vec3(0.86, 0.90, 0.96);

        vec3 rockCol = mix(lowerSlate, darkGranite, smoothstep(0.8, 2.8, alt));

        float altSnow = smoothstep(3.2, 4.8, alt + (nMacro - 0.5) * 0.6);
        float slopeSnow = smoothstep(0.44, 0.66, slope + smoothstep(6.2, 8.8, alt) * 0.18);
        float snowMask = clamp(altSnow * slopeSnow, 0.0, 1.0);

        vec3 alb = mix(rockCol, glacierSnow, snowMask);

        vec3 primDir;
        vec3 directCol = evalDirectCelestialLight(alt, up, vWorldPos, primDir);
        vec3 localSun = getSunDirAt(vWorldPos);
        vec3 skyAmb = atmosphereMarch(alt, up, up, localSun, 1e9, 4).inscatter * 1.65 * PI;
        vec3 radiance = (alb / PI) * (directCol * max(0.0, dot(N, primDir)) + skyAmb * (0.45 + 0.55 * slope));

        vec3 finalCol = applyAerialPerspective(radiance, cameraPosition, vWorldPos, 6);

        // Smoothly feather the base into the sea surface so there is zero hard circular edge
        float baseAlpha = smoothstep(0.02, 0.55, alt) * (1.0 - smoothstep(0.68, 0.95, rad));
        if (baseAlpha < 0.01) discard;

        gl_FragColor = vec4(finalCol, baseAlpha);
      }
    `
  });

  const everestMesh = new THREE.Mesh(everestGeo, everestMat);
  everestGroup.add(everestMesh);

  const everestPin = createAltitudePin('Mt. Everest: 8,848 m', 0x38bdf8);
  everestGroup.add(everestPin);
  pinSprites.push(everestPin);

  group.add(everestGroup);

  // =========================================================================
  // 2. BURJ KHALIFA (828 m)
  // =========================================================================
  const burjGroup = new THREE.Group();
  const burjX = -16;

  const burjMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.85,
    roughness: 0.20
  });

  const tierCount = 8;
  for (let t = 0; t < tierCount; t++) {
    const tierBottom = (t / tierCount) * 0.72;
    const tierHeight = 0.72 / tierCount;
    const radius = 0.16 * (1.0 - (t / tierCount) * 0.75);
    const tierGeo = new THREE.CylinderGeometry(radius * 0.88, radius, tierHeight, 8);
    const tierMesh = new THREE.Mesh(tierGeo, burjMat);
    tierMesh.position.y = tierBottom + tierHeight / 2;
    burjGroup.add(tierMesh);
  }
  const spireMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.032, 0.108, 6), burjMat);
  spireMesh.position.y = 0.72 + 0.108 / 2;
  burjGroup.add(spireMesh);

  const burjPin = createAltitudePin('Burj Khalifa: 828 m', 0xf59e0b);
  burjGroup.add(burjPin);
  pinSprites.push(burjPin);
  group.add(burjGroup);

  // =========================================================================
  // 3. COMMERCIAL PASSENGER JET (Cruising Altitude: 11.0 km)
  // =========================================================================
  const planeGroup = new THREE.Group();
  planeGroup.name = 'ref-plane';

  const planeMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, metalness: 0.5, roughness: 0.25 });
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.016, 0.16, 12), planeMat);
  fuselage.rotation.z = Math.PI / 2;
  planeGroup.add(fuselage);

  const wings = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.004, 0.18), planeMat);
  planeGroup.add(wings);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.035, 0.004), planeMat);
  tail.position.set(-0.065, 0.02, 0);
  planeGroup.add(tail);

  const trail = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.14, 12.0, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false })
  );
  trail.rotation.z = Math.PI / 2;
  trail.position.set(-6.1, 0, 0);
  planeGroup.add(trail);

  const planePin = createAltitudePin('Vuelo Comercial: 11,000 m', 0x10b981);
  planePin.position.set(0, 0.65, 0);
  planeGroup.add(planePin);
  pinSprites.push(planePin);
  group.add(planeGroup);

  // =========================================================================
  // 4. PLANETARY CURVATURE & GEODESIC TILT GUIDES
  // =========================================================================
  const curvatureGuideGroup = new THREE.Group();
  curvatureGuideGroup.name = 'curvature-perspective-guides';

  const tangentLineMat = new THREE.LineDashedMaterial({
    color: 0x38bdf8,
    dashSize: 2.5,
    gapSize: 1.5,
    transparent: true,
    opacity: 0.75,
    depthWrite: false
  });
  const tangentLineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.025, 0),
    new THREE.Vector3(0, 0.025, -200)
  ]);
  const tangentLine = new THREE.Line(tangentLineGeo, tangentLineMat);
  tangentLine.computeLineDistances();
  curvatureGuideGroup.add(tangentLine);

  const dropLineGeo = new THREE.BufferGeometry();
  const dropLine = new THREE.Line(
    dropLineGeo,
    new THREE.LineBasicMaterial({ color: 0xf43f5e, transparent: true, opacity: 0.85, depthWrite: false })
  );
  curvatureGuideGroup.add(dropLine);

  const dropPin = createAltitudePin('Curvatura Oculta', 0xf43f5e);
  dropPin.scale.set(7.5, 1.8, 1);
  curvatureGuideGroup.add(dropPin);
  pinSprites.push(dropPin);

  const tiltGroup = new THREE.Group();
  const obsVertGeo = new THREE.BufferGeometry();
  const obsVertLine = new THREE.Line(
    obsVertGeo,
    new THREE.LineDashedMaterial({ color: 0x94a3b8, dashSize: 1.5, gapSize: 1.0, transparent: true, opacity: 0.70 })
  );
  tiltGroup.add(obsVertLine);

  const localZenithGeo = new THREE.BufferGeometry();
  const localZenithLine = new THREE.Line(
    localZenithGeo,
    new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.90 })
  );
  tiltGroup.add(localZenithLine);

  const tiltPin = createAltitudePin('Inclinación Geodésica: 1.17°', 0xfbbf24);
  tiltPin.scale.set(8.5, 2.0, 1);
  tiltGroup.add(tiltPin);
  pinSprites.push(tiltPin);

  curvatureGuideGroup.add(tiltGroup);
  group.add(curvatureGuideGroup);

  function createAltitudePin(text, colorHex) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.roundRect(10, 10, 492, 108, 24);
    ctx.fill();

    ctx.lineWidth = 4;
    ctx.strokeStyle = `#${colorHex.toString(16).padStart(6, '0')}`;
    ctx.stroke();

    ctx.font = 'bold 34px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0.85,
      depthTest: false
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(7.5, 1.85, 1);
    sprite.userData = { canvas, ctx, colorHex };
    return sprite;
  }

  function updatePinText(pin, text, strokeHex) {
    const ctx = pin.userData.ctx;
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.roundRect(10, 10, 492, 108, 24);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = strokeHex;
    ctx.stroke();
    ctx.font = 'bold 34px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 64);
    pin.material.map.needsUpdate = true;
  }

  function updateCurvatureGuides(distKm) {
    const seaPos = getEarthPosition(distKm, 0.0, 0.0);
    const tangentY = 0.025;

    dropLineGeo.setFromPoints([
      new THREE.Vector3(0, tangentY, -distKm),
      new THREE.Vector3(0, seaPos.y, seaPos.z)
    ]);

    const hiddenM = calculateHiddenHeightMeters(distKm, 0.025);
    updatePinText(dropPin, `Curvatura: ${hiddenM.toLocaleString()} m Ocultos`, '#f43f5e');
    dropPin.position.set(0, (tangentY + seaPos.y) * 0.5, -distKm);

    const stormBasePos = getEarthPosition(distKm, 0.0, 26.0);
    const earthNorm = getEarthNormal(distKm, 26.0);
    const axisHeight = 20.0;

    const obsTop = stormBasePos.clone().add(new THREE.Vector3(0, axisHeight, 0));
    obsVertGeo.setFromPoints([stormBasePos, obsTop]);
    obsVertLine.computeLineDistances();

    const localTop = stormBasePos.clone().addScaledVector(earthNorm, axisHeight);
    localZenithGeo.setFromPoints([stormBasePos, localTop]);

    const thetaDeg = (Math.asin(Math.min(1.0, distKm / EARTH_RADIUS)) * (180 / Math.PI)).toFixed(2);
    updatePinText(tiltPin, `Inclinación Geodésica: ${thetaDeg}°`, '#fbbf24');
    tiltPin.position.copy(localTop).add(new THREE.Vector3(0, 1.8, 0));
  }

  function setDistance(distKm) {
    currentDist = distKm;

    const everestDist = distKm - 12;
    everestGroup.position.copy(getEarthPosition(everestDist, 0, everestX));
    everestGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), getEarthNormal(everestDist, everestX));
    everestPin.position.set(0, 9.8, 0);

    const burjDist = distKm + 14;
    burjGroup.position.copy(getEarthPosition(burjDist, 0, burjX));
    burjGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), getEarthNormal(burjDist, burjX));
    burjPin.position.set(0, 1.45, 0);

    updateCurvatureGuides(distKm);
  }

  setDistance(currentDist);

  let planeProgress = -60;

  function update(delta, camera = null, viewMode = 'ground') {
    planeProgress += delta * 5.2;
    if (planeProgress > 60) planeProgress = -60;
    const planeDist = currentDist + 18;
    planeGroup.position.copy(getEarthPosition(planeDist, 11.0, planeProgress));
    planeGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), getEarthNormal(planeDist, planeProgress));

    const isGround = viewMode === 'ground' || (camera && camera.position.y < 0.25);
    const targetOpacity = isGround ? 0.30 : 0.88;
    for (const pin of pinSprites) {
      if (pin && pin.material) {
        pin.material.opacity += (targetOpacity - pin.material.opacity) * 0.1;
      }
    }

    curvatureGuideGroup.visible = !isGround;
  }

  return {
    group,
    setDistance,
    update,
    setRefVisibility: (refName, visible) => {
      if (refName === 'everest') everestGroup.visible = visible;
      if (refName === 'burj') burjGroup.visible = visible;
      if (refName === 'plane') planeGroup.visible = visible;
    }
  };
}