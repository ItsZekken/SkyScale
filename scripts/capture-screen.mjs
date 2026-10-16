// scripts/capture-screen.mjs
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const cdpPort = 9333;

const chromeProc = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${cdpPort}`,
  '--disable-gpu-sandbox',
  '--no-sandbox',
  '--window-size=1280,720',
  '--user-data-dir=' + process.cwd() + '\\.chrome-temp',
  'about:blank'
], { stdio: 'inherit' });

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${cdpPort}${path}`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function run() {
  try {
    let list = null;
    for (let i = 0; i < 30; i++) {
      await sleep(200);
      try {
        list = await getJson('/json/list');
        if (list && list.length > 0) break;
      } catch (e) {}
    }

    if (!list || list.length === 0) {
      console.error('No CDP target found');
      return;
    }

    const wsUrl = list[0].webSocketDebuggerUrl;
    console.log('Connecting to target:', wsUrl);

    let msgId = 0;
    const pending = new Map();

    const ws = new globalThis.WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    ws.onmessage = evt => {
      try {
        const text = typeof evt.data === 'string' ? evt.data : evt.data.toString('utf-8');
        const msg = JSON.parse(text);
        if (msg.id && pending.has(msg.id)) {
          const { resolve, reject } = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
        } else if (msg.method === 'Runtime.consoleAPICalled') {
          console.log('[BROWSER ' + msg.params.type + ']', ...msg.params.args.map(a => a.value ?? a.description ?? ''));
        } else if (msg.method === 'Runtime.exceptionThrown') {
          console.error('[BROWSER EXCEPTION]', msg.params.exceptionDetails);
        }
      } catch (err) {
        console.error('onmessage parse error:', err);
      }
    };

    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++msgId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('Navigating to http://localhost:5178/ ...');
    await send('Page.navigate', { url: 'http://localhost:5178/' });

    // Wait for bake and 60 frames
    console.log('Waiting 5s for GPU bake and scene initialization...');
    await sleep(5000);

    console.log('Capturing screenshot...');
    const result = await send('Page.captureScreenshot', { format: 'png' });
    const imgBuffer = Buffer.from(result.data, 'base64');
    fs.writeFileSync('browser-test.png', imgBuffer);
    console.log('Screenshot saved to browser-test.png (', imgBuffer.length, 'bytes)');

    // Also evaluate window.__DEBUG
    const evalRes = await send('Runtime.evaluate', {
      expression: `({
        skyExists: !!window.__DEBUG?.sky,
        planetExists: !!window.__DEBUG?.planet,
        camAlt: window.__DEBUG?.sky ? window.__DEBUG.sky.group.visible : null,
        bakes: window.__DEBUG?.bakes ? Object.keys(window.__DEBUG.bakes) : null
      })`,
      returnByValue: true
    });
    console.log('Debug state in browser:', evalRes.result?.value);

    ws.close();
  } finally {
    chromeProc.kill('SIGKILL');
  }
}

run().catch(e => {
  console.error('Fatal runner error:', e);
  chromeProc.kill('SIGKILL');
});
