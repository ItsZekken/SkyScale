// src/hotspots.js
// Phase 5 Educational Stations for "El Cambio de Perspectiva" (neal.fun style)

import * as THREE from 'three';

export const ATMOSPHERE_STATIONS = [
  {
    id: 'S0',
    name: 'Mirador Costero (Barranquilla)',
    altKm: 0.025,
    mode: 'ground',
    getCameraPos: () => new THREE.Vector3(0, 0.025, 0),
    getLookTarget: (distKm) => new THREE.Vector3(0, 1.2, -distKm),
    title: 'El Engaño de la Perspectiva',
    metric: 'Altitud: 25 m • Horizonte a 17.8 km',
    description: 'Desde la costa en Barranquilla, la curvatura terrestre oculta más de 1,200 m de la base de la tormenta y la perspectiva la aplana contra el cielo como si fuera un telón pintado.',
    badge: 'Curvatura oculta: ~1,204 m'
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
    description: 'El aire cálido y húmedo del Caribe asciende y se enfría hasta alcanzar el 100% de humedad relativa. En este plano exacto (LCL), billones de microgotas se condensan formando una bóveda oscura como el plomo.',
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