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

await send('Runtime.enable');
const res = await send('Runtime.evaluate', {
  expression: `(() => {
    const s = window.__DEBUG.scene;
    const items = [];
    s.traverse(o => {
      if (o.isMesh) {
        items.push({
          name: o.name || o.parent?.name,
          geo: o.geometry?.type,
          mat: o.material?.type,
          visible: o.visible,
          pos: [o.position.x, o.position.y, o.position.z],
          color: o.material?.color?.getHexString?.()
        });
      }
    });
    return items;
  })()`,
  returnByValue: true
});

console.log('Meshes in scene:', JSON.stringify(res.result?.value, null, 2));
ws.close();
