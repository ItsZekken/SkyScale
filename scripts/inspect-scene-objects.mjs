import { spawn } from 'child_process';
import http from 'http';

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 9555;
const proc = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  '--user-data-dir=' + process.cwd() + '\\.chrome-inspect',
  'about:blank'
], { stdio: 'ignore' });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

try {
  await sleep(1500);
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

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://localhost:5178/' });

  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const check = await send('Runtime.evaluate', { expression: '!!window.__DEBUG?.planet' });
    if (check.result?.value) break;
  }
  await sleep(1000);

  const evalRes = await send('Runtime.evaluate', {
    expression: `(() => {
      const s = window.__DEBUG.scene;
      const res = [];
      s.traverse(o => {
        if (o.isMesh || o.isLight || o.isPoints) {
          const wp = new window.__DEBUG.THREE.Vector3();
          o.getWorldPosition(wp);
          res.push({
            type: o.type,
            name: o.name || o.parent?.name,
            pos: [wp.x.toFixed(2), wp.y.toFixed(2), wp.z.toFixed(2)],
            mat: o.material?.type,
            matColor: o.material?.color?.getHexString?.(),
            intensity: o.intensity
          });
        }
      });
      return res;
    })()`,
    returnByValue: true
  });

  console.log('Scene elements:', JSON.stringify(evalRes.result?.value, null, 2));
  ws.close();
} finally {
  proc.kill();
}
