// src/scene.js
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export function setupScene(container) {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    52,
    window.innerWidth / window.innerHeight,
    0.0005, // 0.5 meters near plane
    35000   // 35,000 km far plane
  );
  camera.position.set(0, 0.025, 0);
  camera.lookAt(0, 1.2, -130);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    logarithmicDepthBuffer: true,
    powerPreference: 'high-performance'
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.48;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Cinematic bloom with high threshold so clouds, terrain, and ocean never blow out into blurry haze
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(Math.floor(window.innerWidth * 0.5), Math.floor(window.innerHeight * 0.5)),
    0.06, // Crisp, subtle bloom strength (was 0.20)
    0.20, // Tight radius to avoid blurry fogging (was 0.38)
    2.50  // High threshold: only electric lightning arcs and direct solar disk center bloom
  );
  composer.addPass(bloomPass);

  const sunLight = new THREE.DirectionalLight(0xfffdf5, 1.35);
  sunLight.position.set(800, 4200, -2400);
  scene.add(sunLight);

  const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x0c4a6e, 0.40);
  scene.add(hemiLight);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  return {
    scene,
    camera,
    renderer,
    composer,
    sunLight
  };
}