// src/main.js
// Self-contained main pipeline with integrated Tour & Stations (no external tour.js/hotspots.js needed)
// Updates and dismisses #loading-overlay reliably

import * as THREE from 'three';
import gsap from 'gsap';
import { setupScene } from './scene.js';
import { createCameraController } from './camera.js';
import { createAtmosphericSky, TIME_PRESETS } from './sky.js';
import { createPlanet, calculateHiddenHeightMeters } from './planet.js';
import { createRealisticClouds } from './clouds.js';
import { createLightningSystem } from './lightning.js';
import { createRedSpritesSystem } from './sprites.js';
import { createScaleReferences } from './references.js';
import { audio } from './audio.js';
import { bakeAll } from './bake.js';

const ATMOSPHERE_STATIONS = [
  {
    id: 'S0',
    name: 'Mirador Costero (Barranquilla)',
    altKm: 0.025,
    mode: 'ground',
    getCameraPos: () => new THREE.Vector3(0, 0.025, 0),
    getLookTarget: (distKm) => new THREE.Vector3(0, 1.2, -distKm),
    title: 'El Engaño de la Perspectiva',
    metric: 'Altitud: 25 m • Horizonte a 17.8 km',
    description: 'Desde la costa en Barranquilla, la curvatura terrestre oculta casi 1 km de la base de la tormenta y la perspectiva la aplana contra el cielo como si fuera un telón pintado.',
    badge: 'Curvatura oculta: ~987 m'
  },
  {
    id: 'S1',
    name: 'Nivel de Condensación (LCL)',
    altKm: 2.2,
    mode: 'fly',
    getCameraPos: (distKm) => new THREE.Vector3(-22, 2.2, -distKm + 32),
    getLookTarget: (distKm) => new THREE.Vector3(0, 2.4, -distKm),
    title: 'La Base Plana y Oscura',
    metric: 'Altitud: 1.8 - 2.5 km • Temp: 22°C',
    description: 'El aire cálido y húmedo del Caribe asciende y se enfría hasta alcanzar el 100% de humedad relativa. En este plano exacto (LCL), billones de microgotas se condensan formando una bóveda oscura.',
    badge: 'Presión: ~800 hPa'
  },
  {
    id: 'S2',
    name: 'Chimenea Convectiva & Vuelo',
    altKm: 11.0,
    mode: 'fly',
    getCameraPos: (distKm) => new THREE.Vector3(-48, 11.2, -distKm + 48),
    getLookTarget: (distKm) => new THREE.Vector3(0, 9.5, -distKm),
    title: 'Corrientes de 160 km/h y Granizo',
    metric: 'Altitud: 6 - 12 km • Crucero Boeing 787',
    description: 'En el corazón del cumulonimbo, el calor latente impulsa torres en ebullición más altas que el Monte Everest (8,848 m), sosteniendo granizo y obligando a los aviones comerciales a rodear la supercelda.',
    badge: 'Temperatura: -45°C'
  },
  {
    id: 'S3',
    name: 'Yunque Estratosférico (Incus)',
    altKm: 16.5,
    mode: 'fly',
    getCameraPos: (distKm) => new THREE.Vector3(-62, 18.5, -distKm + 65),
    getLookTarget: (distKm) => new THREE.Vector3(8, 14.5, -distKm),
    title: 'El Techo del Clima Terrestre',
    metric: 'Altitud: 14 - 17 km • Diámetro: 72 km',
    description: 'Al chocar contra la tropopausa, la nube no puede seguir subiendo y se expande 70 km horizontalmente en un escudo de hielo cirriforme, mientras el Overshooting Top perfora la estratosfera.',
    badge: 'Volumen: >5,400 km³'
  },
  {
    id: 'S4',
    name: 'Mesosfera — Red Sprites (TLE)',
    altKm: 75.0,
    mode: 'fly',
    getCameraPos: (distKm) => new THREE.Vector3(-75, 68.0, -distKm + 95),
    getLookTarget: (distKm) => new THREE.Vector3(0, 62.0, -distKm),
    title: 'Fantasmas de Plasma Frío',
    metric: 'Altitud: 46 - 85 km • Duración: 20-200 ms',
    description: 'Cuando un rayo positivo masivo descarga hacia el mar, el campo eléctrico en la mesosfera ioniza el nitrógeno en columnas carmesí y zarcillos azul-violeta de 50 km de ancho.',
    badge: 'Borde del Espacio (80 km)'
  }
];

function createTourController(camera, camCtrl, getDistanceKm, callbacks = {}) {
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

    if (callbacks.onStationStart) callbacks.onStationStart(station, index);

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

        if (callbacks.onStationArrival) callbacks.onStationArrival(station, index);
      }
    });
  }

  return {
    goToStation,
    nextStation: () => goToStation((currentStationIndex + 1) % ATMOSPHERE_STATIONS.length),
    prevStation: () => goToStation((currentStationIndex - 1 + ATMOSPHERE_STATIONS.length) % ATMOSPHERE_STATIONS.length),
    getCurrentIndex: () => currentStationIndex
  };
}

// Application State
const state = {
  viewMode: 'ground',
  timeOfDay: 'noon',
  cloudDistanceKm: 130,
  observerAltitudeKm: 0.025,
  isSlowMo: false
};

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('t')) state.timeOfDay = urlParams.get('t');
if (urlParams.has('view')) state.viewMode = urlParams.get('view');
if (urlParams.has('dist')) state.cloudDistanceKm = parseFloat(urlParams.get('dist'));
if (urlParams.has('alt')) state.observerAltitudeKm = parseFloat(urlParams.get('alt'));

const container = document.getElementById('canvas-container');
const { scene, camera, renderer, composer, sunLight } = setupScene(container);
const hemiLight = scene.children.find(c => c.isHemisphereLight);

const camCtrl = createCameraController(camera, renderer.domElement);
camCtrl.setAltitude(state.observerAltitudeKm);

let sky = null;
let planet = null;
let clouds = null;
let lightning = null;
let sprites = null;
let scaleRefs = null;
let tour = null;

// DOM Elements
const loadingOverlay = document.getElementById('loading-overlay');
const loadingBar = document.getElementById('loading-bar');
const loadingStatus = document.getElementById('loading-status');

const timeButtons = document.querySelectorAll('.time-btn');
const viewGroundBtn = document.getElementById('view-ground');
const viewFlyBtn = document.getElementById('view-fly');
const triggerSpriteBtn = document.getElementById('trigger-sprite-btn');
const slowmoToggleBtn = document.getElementById('slowmo-toggle-btn');
const slowmoText = document.getElementById('slowmo-text');
const spriteAlert = document.getElementById('sprite-alert');
const altSlider = document.getElementById('alt-slider');
const distSlider = document.getElementById('dist-slider');
const sliderAltVal = document.getElementById('slider-alt-val');
const sliderDistVal = document.getElementById('slider-dist-val');
const valHiddenMeters = document.getElementById('val-hidden-meters');
const soundBtn = document.getElementById('sound-btn');
const soundIcon = document.querySelector('.sound-icon');

const stationPills = document.querySelectorAll('.station-pill');
const cardBadge = document.getElementById('card-badge');
const cardTitle = document.getElementById('card-title');
const cardMetric = document.getElementById('card-metric');
const cardDescription = document.getElementById('card-description');
const cardPrevBtn = document.getElementById('card-prev-btn');
const cardNextBtn = document.getElementById('card-next-btn');

function updateLoadingUI(progress01, label) {
  const pct = Math.round(progress01 * 100);
  if (loadingBar) loadingBar.style.width = `${pct}%`;
  if (loadingStatus) loadingStatus.textContent = `${label} (${pct}%)`;
}

function hideLoadingOverlay() {
  if (loadingOverlay) {
    loadingOverlay.style.opacity = '0';
    setTimeout(() => {
      loadingOverlay.style.display = 'none';
    }, 400);
  }
}

function updateTourUI(station, index) {
  if (cardBadge) cardBadge.textContent = station.badge;
  if (cardTitle) cardTitle.textContent = station.title;
  if (cardMetric) cardMetric.textContent = station.metric;
  if (cardDescription) cardDescription.textContent = station.description;

  stationPills.forEach((pill, i) => {
    pill.classList.toggle('active', i === index);
  });

  state.viewMode = station.mode;
  if (viewGroundBtn) viewGroundBtn.classList.toggle('active', station.mode === 'ground');
  if (viewFlyBtn) viewFlyBtn.classList.toggle('active', station.mode === 'fly');
}

function setTimeOfDay(timeKey, duration = 2.0) {
  state.timeOfDay = timeKey;
  if (!sky) return;
  const preset = TIME_PRESETS[timeKey] || TIME_PRESETS.noon;
  sky.transitionToTime(timeKey, duration, (current) => {
    if (sunLight) {
      sunLight.position.copy(current.sunPos.clone().multiplyScalar(4000));
      sunLight.color.copy(current.sunColor);
      sunLight.intensity = current.sunIntensity ?? 2.4;
    }
    if (hemiLight) {
      hemiLight.color.copy(current.hemiSky);
      hemiLight.groundColor.copy(current.hemiGround);
      hemiLight.intensity = current.hemiIntensity;
    }
    if (renderer && preset && preset.exposure) {
      renderer.toneMappingExposure = current.exposure ?? preset.exposure;
    }
    if (clouds && clouds.setTimeOfDay) {
      clouds.setTimeOfDay(preset);
    }
  });

  timeButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.time === timeKey);
  });
}

function updateCurvatureUI() {
  const hiddenMeters = calculateHiddenHeightMeters(state.cloudDistanceKm, state.observerAltitudeKm);
  if (valHiddenMeters) {
    valHiddenMeters.textContent = hiddenMeters > 0 ? `${hiddenMeters.toLocaleString()} m` : '0 m (Visible)';
  }
}

function setViewMode(mode) {
  audio.playWhoosh();
  if (!tour) return;
  if (mode === 'ground') {
    tour.goToStation(0, 2.2);
  } else {
    tour.goToStation(3, 2.6);
  }
}

function triggerSpriteAction() {
  audio.playThunder();
  if (clouds && clouds.flashLight) {
    clouds.flashLight.intensity = 95;
    if (clouds.cloudUniforms) clouds.cloudUniforms.uStormFlash.value = 0.75;
    setTimeout(() => {
      if (clouds.flashLight) clouds.flashLight.intensity = 0;
      if (clouds.cloudUniforms) clouds.cloudUniforms.uStormFlash.value = 0.0;
    }, 180);
  }
  if (sprites) {
    sprites.triggerSprite(state.isSlowMo, () => {
      if (spriteAlert) spriteAlert.classList.add('hidden');
    });
    if (spriteAlert) {
      spriteAlert.textContent = state.isSlowMo
        ? '⏱️ RED SPRITE EN CÁMARA LENTA (0.1x / 1.8s) EN LA MESOSFERA'
        : '⚡ ¡RED SPRITE DETECTADO A 80 KM DE ALTITUD! (220 ms)';
      spriteAlert.classList.remove('hidden');
    }
  }
}

function toggleSlowMo() {
  state.isSlowMo = !state.isSlowMo;
  if (slowmoToggleBtn) slowmoToggleBtn.classList.toggle('active', state.isSlowMo);
  if (slowmoText) slowmoText.textContent = state.isSlowMo ? '0.1x' : '1x';
}

if (altSlider) {
  altSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    let altKm;
    if (val <= 1.0) {
      altKm = 0.025 + (val / 1.0) * 0.975;
      sliderAltVal.textContent = `${Math.round(altKm * 1000)} m`;
    } else if (val <= 30.0) {
      altKm = 1.0 + ((val - 1) / 29.0) * 19.0;
      sliderAltVal.textContent = `${altKm.toFixed(1)} km`;
    } else {
      altKm = 20.0 + ((val - 30) / 70.0) * 65.0;
      sliderAltVal.textContent = `${altKm.toFixed(1)} km`;
    }
    state.observerAltitudeKm = altKm;
    if (state.viewMode === 'ground') {
      camCtrl.setAltitude(altKm);
    } else {
      camera.position.y = altKm;
      camCtrl.orbit.target.set(0, altKm * 0.5, -state.cloudDistanceKm);
      camCtrl.orbit.update();
    }
    updateCurvatureUI();
  });
}

if (distSlider) {
  distSlider.addEventListener('input', (e) => {
    const d = parseInt(e.target.value);
    state.cloudDistanceKm = d;
    sliderDistVal.textContent = `${d} km`;
    if (clouds) clouds.setDistance(d);
    if (lightning) lightning.setDistance(d);
    if (sprites) sprites.setDistance(d);
    if (scaleRefs) scaleRefs.setDistance(d);
    if (state.viewMode === 'fly') {
      camCtrl.orbit.target.set(0, state.observerAltitudeKm * 0.5, -d);
      camCtrl.orbit.update();
    }
    updateCurvatureUI();
  });
}

timeButtons.forEach(btn => {
  btn.addEventListener('click', () => setTimeOfDay(btn.dataset.time));
});
if (viewGroundBtn) viewGroundBtn.addEventListener('click', () => setViewMode('ground'));
if (viewFlyBtn) viewFlyBtn.addEventListener('click', () => setViewMode('fly'));
if (triggerSpriteBtn) triggerSpriteBtn.addEventListener('click', triggerSpriteAction);
if (slowmoToggleBtn) slowmoToggleBtn.addEventListener('click', toggleSlowMo);

document.querySelectorAll('.icon-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.classList.toggle('active');
    if (scaleRefs) scaleRefs.setRefVisibility(btn.dataset.ref, btn.classList.contains('active'));
  });
});

if (soundBtn) {
  soundBtn.addEventListener('click', () => {
    const active = audio.toggleMute();
    if (soundIcon) soundIcon.textContent = active ? '🔊' : '🔇';
  });
}

async function init() {
  try {
    updateLoadingUI(0.02, 'Iniciando GPU Texture Bakers...');
    const bakes = await bakeAll(renderer, (p, label) => {
      updateLoadingUI(p, label);
    });

    sky = createAtmosphericSky(bakes);
    scene.add(sky.group);

    planet = createPlanet(bakes);
    scene.add(planet.group);

    clouds = createRealisticClouds(state.cloudDistanceKm, bakes);
    scene.add(clouds.group);

    lightning = createLightningSystem(state.cloudDistanceKm, {
      onFlash: (pos, intensity) => {
        if (clouds) clouds.addFlash(pos, intensity);
      }
    });
    scene.add(lightning.group);

    sprites = createRedSpritesSystem(state.cloudDistanceKm);
    scene.add(sprites.group);

    scaleRefs = createScaleReferences(state.cloudDistanceKm);
    scene.add(scaleRefs.group);

    tour = createTourController(
      camera,
      camCtrl,
      () => state.cloudDistanceKm,
      {
        onStationStart: (station, index) => {
          audio.playWhoosh();
          updateTourUI(station, index);
        },
        onStationProgress: (altKm) => {
          state.observerAltitudeKm = altKm;
          if (sliderAltVal) {
            sliderAltVal.textContent = altKm < 1.0 ? `${Math.round(altKm * 1000)} m` : `${altKm.toFixed(1)} km`;
          }
          updateCurvatureUI();
        },
        onStationArrival: (station, index) => {
          updateTourUI(station, index);
          if (index === 4 && sprites && !sprites.isPlaying()) {
            triggerSpriteAction();
          }
        }
      }
    );

    stationPills.forEach((pill, idx) => {
      pill.addEventListener('click', () => tour.goToStation(idx));
    });
    if (cardNextBtn) cardNextBtn.addEventListener('click', () => tour.nextStation());
    if (cardPrevBtn) cardPrevBtn.addEventListener('click', () => tour.prevStation());

    setTimeOfDay(state.timeOfDay, 0.1);
    updateCurvatureUI();
    hideLoadingOverlay();

    let lastTime = performance.now();
    function animate() {
      requestAnimationFrame(animate);
      const now = performance.now();
      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      if (clouds) clouds.update(delta);
      if (lightning) lightning.update(delta);
      if (sprites) sprites.update(delta);
      if (scaleRefs) scaleRefs.update(delta, camera, state.viewMode);
      if (planet) planet.update(delta, camera, state.timeOfDay === 'midnight' ? 1.0 : (state.timeOfDay === 'sunset' ? 0.35 : 0.0));

      camCtrl.update();
      composer.render();
    }
    animate();
  } catch (err) {
    console.error('[SkyScale] Error en inicialización:', err);
    if (loadingStatus) {
      loadingStatus.style.color = '#fb7185';
      loadingStatus.textContent = `Error: ${err.message || err}`;
    }
  }
}

init();