import fs from 'node:fs';
import path from 'node:path';

const LAND_URLS = [
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson',
  'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_land.geojson'
];

const RIVERS_URLS = [
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_rivers_lake_centerlines.geojson',
  'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_rivers_lake_centerlines.geojson'
];

// Target Bounding Box: lon[-120, -30], lat[-60, 45] (Caribbean, Central America, northern & equatorial South America, southern North America)
const TARGET_BBOX = [-120, -60, -30, 45];

async function fetchWithFallback(urls, label) {
  let lastErr = null;
  for (const url of urls) {
    try {
      console.log(`[prepare-geo] Fetching ${label} from: ${url}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = await res.json();
      console.log(`[prepare-geo] Successfully retrieved ${label}`);
      return data;
    } catch (err) {
      console.warn(`[prepare-geo] Warning: Failed to fetch from ${url} (${err.message}). Trying fallback...`);
      lastErr = err;
    }
  }
  throw new Error(`Failed to fetch ${label} from all sources: ${lastErr?.message}`);
}

function roundCoord(c) {
  if (typeof c[0] === 'number') {
    return [Math.round(c[0] * 1000) / 1000, Math.round(c[1] * 1000) / 1000];
  }
  return c.map(roundCoord);
}

function featureOverlapsBBox(feature, bbox) {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  function scan(coords) {
    if (typeof coords[0] === 'number') {
      const [x, y] = coords;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    } else {
      for (const c of coords) scan(c);
    }
  }
  if (!feature.geometry || !feature.geometry.coordinates) return false;
  scan(feature.geometry.coordinates);
  // Intersect bbox: not completely outside
  return !(maxX < bbox[0] || minX > bbox[2] || maxY < bbox[1] || minY > bbox[3]);
}

function processFeatures(geojson, bbox) {
  const filtered = [];
  for (const f of geojson.features || []) {
    if (featureOverlapsBBox(f, bbox)) {
      filtered.push({
        type: 'Feature',
        properties: {},
        geometry: {
          type: f.geometry.type,
          coordinates: roundCoord(f.geometry.coordinates)
        }
      });
    }
  }
  return {
    type: 'FeatureCollection',
    bbox: bbox,
    features: filtered
  };
}

async function main() {
  const outDir = path.resolve('src/data');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // 1. Process Land
  const landData = await fetchWithFallback(LAND_URLS, 'Land 50m');
  const processedLand = processFeatures(landData, TARGET_BBOX);
  const landPath = path.join(outDir, 'land50.json');
  fs.writeFileSync(landPath, JSON.stringify(processedLand));
  const landSizeKb = (fs.statSync(landPath).size / 1024).toFixed(1);
  console.log(`[prepare-geo] Wrote ${processedLand.features.length} land features to ${landPath} (${landSizeKb} KB)`);

  // 2. Process Rivers
  const riversData = await fetchWithFallback(RIVERS_URLS, 'Rivers 50m');
  const processedRivers = processFeatures(riversData, TARGET_BBOX);
  const riversPath = path.join(outDir, 'rivers50.json');
  fs.writeFileSync(riversPath, JSON.stringify(processedRivers));
  const riversSizeKb = (fs.statSync(riversPath).size / 1024).toFixed(1);
  console.log(`[prepare-geo] Wrote ${processedRivers.features.length} river features to ${riversPath} (${riversSizeKb} KB)`);

  console.log('[prepare-geo] Geo data preparation finished successfully.');
}

main().catch(err => {
  console.error('[prepare-geo] Error during preparation:', err);
  process.exit(1);
});
