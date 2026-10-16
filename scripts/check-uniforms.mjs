import http from 'http';

const port = 9444;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

try {
  const targets = await getJson('/json/list');
  const pageTarget = targets.find(t => t.type === 'page');
  const ws = new globalThis.WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let id = 0;
  const cbs = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && cbs.has(m.id)) { cbs.get(m.id)(m); cbs.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise(res => {
    const cur = ++id; cbs.set(cur, res); ws.send(JSON.stringify({ id: cur, method, params }));
  });

  const res = await send('Runtime.evaluate', {
    expression: `(() => {
      const p = window.__DEBUG.planet;
      const u = p.oceanMat.uniforms;
      return {
        uTransLUT: !!u.uTransLUT.value,
        uSunDir: [u.uSunDir.value.x, u.uSunDir.value.y, u.uSunDir.value.z],
        uSunIrr: u.uSunIrradiance.value,
        uGeoGlobal: !!u.uGeoGlobal.value,
        uGeoRegional: !!u.uGeoRegional.value,
        uOceanNormal: !!u.uOceanNormalMap.value
      };
    })()`,
    returnByValue: true
  });

  console.log('UNIFORMS:', res.result?.value);
  ws.close();
} catch (e) {
  console.error(e);
}
