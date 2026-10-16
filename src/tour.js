// src/tour.js
// Phase 5 Cinematic Perspective Tour Controller (integrates cleanly with camCtrl.orbit & POV)

import * as THREE from 'three';
import gsap from 'gsap';
import { ATMOSPHERE_STATIONS } from './hotspots.js';

export function createTourController(camera, camCtrl, getDistanceKm, callbacks = {}) {
  let currentStationIndex = 0;
  let activeTween = null;

  function goToStation(index, duration = 2.6) {
    if (index < 0 || index >= ATMOSPHERE_STATIONS.length) return;
    const station = ATMOSPHERE_STATIONS[index];
    currentStationIndex = index;

    if (activeTween) activeTween.kill();
    camCtrl.setTransitioning(true);

    const distKm = getDistanceKm();
    const startPos = camera.position.clone();
    const endPos = station.getCameraPos(distKm);

    const startDir = new THREE.Vector3();
    camera.getWorldDirection(startDir);
    const startLook = camera.position.clone().add(startDir.multiplyScalar(distKm));
    const currentLook = startLook.clone();
    const endLook = station.getLookTarget(distKm);

    const midY = Math.max(startPos.y, endPos.y) + Math.abs(endPos.y - startPos.y) * 0.16 + 0.8;
    const controlPos = new THREE.Vector3(
      (startPos.x + endPos.x) * 0.5 - 8.0,
      midY,
      (startPos.z + endPos.z) * 0.5
    );

    if (callbacks.onStationStart) {
      callbacks.onStationStart(station, index);
    }

    const animObj = { t: 0 };
    activeTween = gsap.to(animObj, {
      t: 1.0,
      duration,
      ease: 'power3.inOut',
      onUpdate: () => {
        const t = animObj.t;
        const invT = 1.0 - t;
        camera.position.x = invT * invT * startPos.x + 2.0 * invT * t * controlPos.x + t * t * endPos.x;
        camera.position.y = invT * invT * startPos.y + 2.0 * invT * t * controlPos.y + t * t * endPos.y;
        camera.position.z = invT * invT * startPos.z + 2.0 * invT * t * controlPos.z + t * t * endPos.z;

        currentLook.lerpVectors(startLook, endLook, t);
        camera.lookAt(currentLook);

        if (callbacks.onStationProgress) {
          callbacks.onStationProgress(camera.position.y, station, index);
        }
      },
      onComplete: () => {
        camera.position.copy(endPos);
        camera.lookAt(endLook);
        camCtrl.setTransitioning(false);

        if (station.mode === 'ground') {
          camCtrl.setAltitude(0.025);
          camCtrl.setMode('ground', distKm);
        } else {
          camCtrl.setMode('fly', distKm);
          camCtrl.orbit.target.copy(endLook);
          camCtrl.orbit.update();
        }

        if (callbacks.onStationArrival) {
          callbacks.onStationArrival(station, index);
        }
      }
    });
  }

  function nextStation() {
    goToStation((currentStationIndex + 1) % ATMOSPHERE_STATIONS.length);
  }

  function prevStation() {
    goToStation((currentStationIndex - 1 + ATMOSPHERE_STATIONS.length) % ATMOSPHERE_STATIONS.length);
  }

  return {
    goToStation,
    nextStation,
    prevStation,
    getCurrentIndex: () => currentStationIndex
  };
}