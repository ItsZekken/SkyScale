
# SkyScale v2 — Architecture & Shader Guardrails (Master Prompt)

## 1. Project Identity & Scale Convention

- **Project:** SkyScale v2 — An interactive 3D planetary & atmospheric scale visualization inspired by *neal.fun* and *Google Earth*, set on the Caribbean coast of Barranquilla / Sabanilla, Colombia (`11.01° N, -74.89° W`)[cite: 1].
- **Stack:** Three.js `0.186.1`, Vite, GSAP, custom GLSL shaders, WebGL2 `HalfFloatType` GPU RenderTarget bakers (`src/bake.js`)[cite: 1].
- **Strict 1:1 Metric Scale:** `1 Three.js world unit = 1.0 km` (`R_EARTH = 6371.0`, `H_ATM = 100.0`, `AU_KM = 149597870.7`, `MOON_ORBIT_KM = 384400.0`)[cite: 1].
- **Coordinate System at Origin `(0, 0, 0)`:**
  - Earth's center is at `(0, -6371.0, 0)`[cite: 1].
  - The POV coastal observer is at `(0, 0.025, 0)` (25 meters above sea level) on the Sabanilla/Barranquilla malecón balcony[cite: 1].
  - `-Z` points **North** (seaward over the open Caribbean Sea toward the Cumulonimbus supercell at `z = -distKm`)[cite: 1].
  - `+Z` points **South** (inland onto the Atlántico mainland).
  - `+X` points **East** (toward Santa Marta / Sierra Nevada); `-X` points **West** (toward Cartagena)[cite: 1].

## 2. File Map & Responsibilities

- `src/atmosphere.js`: Single source of truth for Rayleigh + Mie + Ozone physical scattering, 1 AU solar vector (`getSunDirAt`), orbiting lunar vector (`getMoonDirAt`), space-aware vacuum transmittance (`spaceAwareTransmittance`), and nocturnal airglow + urban light pollution.
- `src/sky.js`: Infinite translation-locked celestial vault (`skyDome` & `stars`), Milky Way galactic band, real astronomical bright star catalog + 9,000 galactic stars, 1 AU Sun disk, 3D selenographic Moon disk, and `TIME_PRESETS` (`sunrise`, `noon`, `sunset`, `midnight`)[cite: 1].
- `src/planet.js`: Concentric spherical cap (`createPlanetCapGeometry`), continuous vertex + derivative-normal continental orography, view-stabilized ocean/land shader (`oceanMat`), and the 1:1 scale POV coastal malecón (`miradorGroup`) with automatic altitude LOD[cite: 1].
- `src/clouds.js`: 360° WMO cloud ecosystem (*Cumulus humilis/mediocris/congestus*, *Stratocumulus*, *Altocumulus*, *Cirrus*, and the main *Cumulonimbus capillatus incus* supercell), 3D voxel self-shadowing grid, back-to-front depth sorting, and rain virga curtains[cite: 1].
- `src/bake.js` & `src/geo.js`: Scanline polygon rasterizer (Natural Earth `land50.json` & `rivers50.json`), Felzenszwalb-Huttenlocher 2D Euclidean Distance Transform (EDT), and non-blocking `setTimeout(0)` GPU texture bakers[cite: 1].
- `src/sprites.js` & `src/lightning.js`: Mesospheric Red Sprites (46–85 km) and 3-tier fractal stepped-leader lightning ribbons[cite: 1].
- `src/references.js`: Scale comparison meshes (Mt. Everest 8,848 m, Burj Khalifa 828 m, Boeing 787 at 11 km) and geodesic curvature/zenith-tilt guides[cite: 1].
- `src/camera.js` & `src/main.js`: Dual POV / OrbitControls camera with spherical planetary collision (`enforcePlanetaryCollision`) and 5-station tour controller[cite: 1].

## 3. Strict Invariant Rules (DO NOT VIOLATE)

1. **Logarithmic Depth Buffer (`logdepthbuf`):** The renderer uses `logarithmicDepthBuffer: true` to render from `0.5 m` (`near = 0.0005`) to `35,000 km` (`far = 35000`) without Z-fighting[cite: 1]. Every custom `ShaderMaterial` that writes or tests depth MUST include `#include <logdepthbuf_pars_vertex>`, `#include <logdepthbuf_vertex>`, `#include <logdepthbuf_pars_fragment>`, and `#include <logdepthbuf_fragment>`[cite: 1].
2. **60 FPS Cloud Performance:** In `src/clouds.js`, atmospheric transmittance and in-scattering MUST remain evaluated **per-vertex** in `cloudVertexShader`[cite: 1]. Never put `atmosphereMarch()` inside `cloudFragmentShader`.
3. **Horizon-Locked Cloud Billboards:** Cloud billboards in `src/clouds.js` must compute their horizontal axis using the planetary zenith `up = normalize(vec3(position.x, position.y + R_EARTH, position.z))` and `right = normalize(cross(up, viewDir))`. NEVER use `viewMatrix` camera-right/up vectors, or clouds will rotate with monitor roll/pitch.
4. **Heliocentric 1 AU Sun & Lunar Orbit:** At `midnight`, `realSunDir` MUST remain on the antipodal hemisphere (`y = -0.95`) with full `sunIrradiance = 20.0`. Never fake the Moon by moving the Sun or lowering `sunIrradiance`.
5. **Space Visibility & Orbital Stability:** Always use `spaceAwareTransmittance(h, uCamUp, rd)` for celestial objects (`sky.js`) so stars, the Milky Way, the Sun, and the Moon remain visible when zooming far out into space (`uCamAlt > 100 km`). In `planet.js`, keep the `orbitBlend` transition so rotating the camera in space never creates a moving bright spot on the ocean.
6. **Soft HDR Shoulder (Bloom Guardrail):** `UnrealBloomPass` in `src/scene.js` has a threshold of `1.85`[cite: 1]. Keep the soft HDR compression (`col / (1.0 + col * k)`) on clouds and horizon scattering so only the solar disk, lightning cores, and Red Sprites trigger bloom[cite: 1].
