// src/camera.js
// Free 3D Orbital & First-Person POV Camera Controller with Geodesic Planetary Collision
// Prevents the camera or orbit target from ever penetrating inside the Earth sphere (R = 6,371 km)

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export const EARTH_RADIUS = 6371.0;
const MIN_CAMERA_ALT_KM = 0.015; // 15 meters minimum clearance above surface

export function enforcePlanetaryCollision(camera, orbit = null) {
  // 1. Clamp camera position outside the spherical planet surface
  const cx = camera.position.x;
  const cy = camera.position.y + EARTH_RADIUS;
  const cz = camera.position.z;
  const distFromCenter = Math.hypot(cx, cy, cz);
  const minRadius = EARTH_RADIUS + MIN_CAMERA_ALT_KM;

  if (distFromCenter < minRadius && distFromCenter > 1e-5) {
    const scale = minRadius / distFromCenter;
    camera.position.x = cx * scale;
    camera.position.y = cy * scale - EARTH_RADIUS;
    camera.position.z = cz * scale;
  }

  // 2. Keep OrbitControls target from sinking deep underground when panning freely
  if (orbit && orbit.enabled) {
    const tx = orbit.target.x;
    const ty = orbit.target.y + EARTH_RADIUS;
    const tz = orbit.target.z;
    const tDist = Math.hypot(tx, ty, tz);
    const minTargetRadius = EARTH_RADIUS + 0.005;
    if (tDist < minTargetRadius && tDist > 1e-5) {
      const tScale = minTargetRadius / tDist;
      orbit.target.x = tx * tScale;
      orbit.target.y = ty * tScale - EARTH_RADIUS;
      orbit.target.z = tz * tScale;
    }
  }
}

export function createCameraController(camera, domElement) {
  const orbit = new OrbitControls(camera, domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.05;
  orbit.enablePan = true;
  orbit.screenSpacePanning = true;
  orbit.minDistance = 0.05;
  orbit.maxDistance = 28000;
  orbit.enabled = false;

  const pov = {
    yaw: 0,
    targetYaw: 0,
    pitch: 0.05,
    targetPitch: 0.05,
    fov: 52,
    targetFov: 52,
    isDragging: false,
    prevX: 0,
    prevY: 0,
    position: new THREE.Vector3(0, 0.025, 0)
  };

  const sensitivity = 0.0032;

  domElement.addEventListener('mousedown', (e) => {
    if (orbit.enabled) return;
    pov.isDragging = true;
    pov.prevX = e.clientX;
    pov.prevY = e.clientY;
  });

  window.addEventListener('mouseup', () => {
    pov.isDragging = false;
  });

  domElement.addEventListener('mousemove', (e) => {
    if (orbit.enabled || !pov.isDragging) return;
    const deltaX = e.clientX - pov.prevX;
    const deltaY = e.clientY - pov.prevY;
    pov.targetYaw += deltaX * sensitivity;
    pov.targetPitch -= deltaY * sensitivity;

    const maxPitch = (85 * Math.PI) / 180;
    const minPitch = (-80 * Math.PI) / 180;
    pov.targetPitch = Math.max(minPitch, Math.min(maxPitch, pov.targetPitch));
    pov.prevX = e.clientX;
    pov.prevY = e.clientY;
  });

  domElement.addEventListener('touchstart', (e) => {
    if (orbit.enabled || e.touches.length !== 1) return;
    pov.isDragging = true;
    pov.prevX = e.touches[0].clientX;
    pov.prevY = e.touches[0].clientY;
  });

  window.addEventListener('touchend', () => {
    pov.isDragging = false;
  });

  domElement.addEventListener('touchmove', (e) => {
    if (orbit.enabled || !pov.isDragging || e.touches.length !== 1) return;
    const deltaX = e.touches[0].clientX - pov.prevX;
    const deltaY = e.touches[0].clientY - pov.prevY;
    pov.targetYaw += deltaX * sensitivity * 1.2;
    pov.targetPitch -= deltaY * sensitivity * 1.2;
    const maxPitch = (85 * Math.PI) / 180;
    const minPitch = (-80 * Math.PI) / 180;
    pov.targetPitch = Math.max(minPitch, Math.min(maxPitch, pov.targetPitch));
    pov.prevX = e.touches[0].clientX;
    pov.prevY = e.touches[0].clientY;
  });

  domElement.addEventListener('wheel', (e) => {
    if (orbit.enabled) return;
    e.preventDefault();
    pov.targetFov += e.deltaY * 0.035;
    pov.targetFov = Math.max(20, Math.min(65, pov.targetFov));
  }, { passive: false });

  let isTransitioning = false;

  function update() {
    if (isTransitioning) {
      enforcePlanetaryCollision(camera);
      return;
    }
    if (orbit.enabled) {
      orbit.update();
      enforcePlanetaryCollision(camera, orbit);
      return;
    }

    pov.yaw += (pov.targetYaw - pov.yaw) * 0.14;
    pov.pitch += (pov.targetPitch - pov.pitch) * 0.14;
    pov.fov += (pov.targetFov - pov.fov) * 0.12;

    camera.fov = pov.fov;
    camera.updateProjectionMatrix();

    pov.position.y = Math.max(MIN_CAMERA_ALT_KM, pov.position.y);
    camera.position.copy(pov.position);
    enforcePlanetaryCollision(camera);

    const cosPitch = Math.cos(pov.pitch);
    const lookDir = new THREE.Vector3(
      Math.sin(pov.yaw) * cosPitch,
      Math.sin(pov.pitch),
      -Math.cos(pov.yaw) * cosPitch
    );
    camera.lookAt(camera.position.clone().add(lookDir));
  }

  function setMode(mode, targetDistanceKm = 65) {
    if (mode === 'ground') {
      orbit.enabled = false;
      pov.yaw = 0;
      pov.targetYaw = 0;
      pov.pitch = 0.05;
      pov.targetPitch = 0.05;
      pov.targetFov = 52;
    } else {
      orbit.enabled = true;
      orbit.target.set(0, 7.5, -targetDistanceKm);
      orbit.update();
      enforcePlanetaryCollision(camera, orbit);
    }
  }

  function setAltitude(altKm) {
    pov.position.y = Math.max(MIN_CAMERA_ALT_KM, altKm);
  }

  function setTransitioning(val) {
    isTransitioning = val;
  }

  return {
    orbit,
    pov,
    update,
    setMode,
    setAltitude,
    setTransitioning
  };
}