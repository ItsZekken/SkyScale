// scripts/inspect-browser.mjs
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const cdpPort = 9222;

console.log('Starting headless Chrome on port', cdpPort);
const chromeProc = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${cdpPort}`,
  '--disable-gpu-sandbox',
  '--no-sandbox',
  '--hide-scrollbars',
  '--window-size=1280,720',
  'about:blank'
], { stdio: 'ignore' });

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getJson(path) {
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

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.callbacks = new Map();
  }

  async connect() {
    const WS = globalThis.WebSocket;
    this.ws = new WS(this.wsUrl);
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
      this.ws.onmessage = evt => {
        const msg = JSON.parse(evt.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const cb = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) cb.reject(msg.error);
          else cb.resolve(msg.result);
        } else if (this.onEvent) {
          this.onEvent(msg.method, msg.params);
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function run() {
  try {
    let list = null;
    for (let i = 0; i < 20; i++) {
      await sleep(300);
      try {
        list = await getJson('/json/list');
        if (list && list.length > 0) break;
      } catch (e) {}
    }

    if (!list || list.length === 0) {
      throw new Error('Chrome CDP did not return targets');
    }

    const pageTarget = list[0];
    const client = new CDP(pageTarget.webSocketDebuggerUrl);
    await client.connect();

    client.onEvent = (method, params) => {
      if (method === 'Runtime.consoleAPICalled') {
        const text = params.args.map(a => a.value ?? a.description ?? JSON.stringify(a)).join(' ');
        console.log(`[BROWSER ${params.type}] ${text}`);
      } else if (method === 'Runtime.exceptionThrown') {
        console.log(`[BROWSER EXCEPTION] ${params.exceptionDetails.text} ${params.exceptionDetails.exception?.description || ''}`);
      }
    };

    await client.send('Page.enable');
    await client.send('Runtime.enable');

    console.log('Navigating to http://localhost:5173...');
    await client.send('Page.navigate', { url: 'http://localhost:5173/' });

    // Wait 4 seconds for page bake and rendering
    await sleep(4000);


    const screenshotRes = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('browser-test.png', Buffer.from(screenshotRes.data, 'base64'));
    console.log('Saved screenshot to browser-test.png');

    await client.send('Page.close');
  } finally {
    chromeProc.kill();
  }
}

run().catch(err => {
  console.error('Test error:', err);
  chromeProc.kill();
});
