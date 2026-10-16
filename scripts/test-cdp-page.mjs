import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 9444;
const proc = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  '--user-data-dir=' + process.cwd() + '\\.chrome-test-profile',
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
  if (!pageTarget) throw new Error('No page target!');

  const ws = new globalThis.WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const cbs = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && cbs.has(m.id)) {
      cbs.get(m.id)(m);
      cbs.delete(m.id);
    } else if (m.method === 'Runtime.consoleAPICalled') {
      console.log('[CONSOLE]', m.params.type, m.params.args.map(a => a.value ?? a.description).join(' '));
    }
  };

  const send = (method, params = {}) => new Promise(res => {
    const cur = ++id;
    cbs.set(cur, res);
    ws.send(JSON.stringify({ id: cur, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  console.log('Navigating to http://localhost:5178/ ...');
  await send('Page.navigate', { url: 'http://localhost:5178/' });

  // Poll until init is complete
  console.log('Waiting for bake and init...');
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const check = await send('Runtime.evaluate', {
      expression: '!!window.__DEBUG?.planet',
      returnByValue: true
    });
    if (check.result?.value) {
      console.log(`Scene ready!`);
      break;
    }
  }

  await sleep(1200);

  // Inspect what objects are rendered and camera parameters
  const sceneEval = await send('Runtime.evaluate', {
    expression: `(() => {
      const s = window.__DEBUG.scene;
      const c = window.__DEBUG.camera;
      const objs = [];
      s.traverse(o => {
        if (o.isMesh) {
          const wp = new window.__DEBUG.THREE.Vector3();
          o.getWorldPosition(wp);
          objs.push({
            name: o.name || o.parent?.name || 'unnamed',
            pos: [wp.x.toFixed(3), wp.y.toFixed(3), wp.z.toFixed(3)],
            mat: o.material?.type,
            visible: o.visible
          });
        }
      });
      return {
        cam: { pos: [c.position.x, c.position.y, c.position.z], near: c.near, far: c.far, fov: c.fov },
        objs
      };
    })()`,
    returnByValue: true
  });
  console.log('SCENE INFO:', JSON.stringify(sceneEval.result?.result?.value, null, 2));

  // Capture Noon
  let shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('test-noon.png', Buffer.from(shot.result.data, 'base64'));
  console.log('Saved test-noon.png');

  // Test Sunset
  await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Atardecer'));
      if (btn) btn.click();
    })()`
  });
  await sleep(1000);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('test-sunset.png', Buffer.from(shot.result.data, 'base64'));
  console.log('Saved test-sunset.png');

  // Test Midnight
  await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Medianoche'));
      if (btn) btn.click();
    })()`
  });
  await sleep(1000);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('test-midnight.png', Buffer.from(shot.result.data, 'base64'));
  console.log('Saved test-midnight.png');

  ws.close();
} catch (err) {
  console.error('Test error:', err);
} finally {
  proc.kill();
}
