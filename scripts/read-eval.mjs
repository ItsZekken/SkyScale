import http from 'http';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:9444${path}`, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

const targets = await getJson('/json/list');
const page = targets.find(t => t.type === 'page');
const ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);
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

const r = await send('Runtime.evaluate', {
  expression: `(() => {
    const p = window.__DEBUG?.planet;
    const s = window.__DEBUG?.scene;
    const c = window.__DEBUG?.camera;
    return {
      hasPlanet: !!p,
      camPos: [c.position.x, c.position.y, c.position.z],
      oceanUniforms: {
        uSunIrr: p?.oceanMat?.uniforms?.uSunIrradiance?.value,
        uSunDir: p?.oceanMat?.uniforms?.uSunDir?.value,
        uCamPos: p?.oceanMat?.uniforms?.uCameraPos?.value,
        uTransLUT: !!p?.oceanMat?.uniforms?.uTransLUT?.value
      }
    };
  })()`,
  returnByValue: true
});

console.log('EVAL VALUE:', JSON.stringify(r.result.result.value, null, 2));
ws.close();
