// Local relay for the two-device Maestro runs (README.md "Two devices"). Runs on the host next to
// the Maestro CLI, binds to 127.0.0.1 only, keeps values in memory, prints nothing, and exits with
// the run script. Two jobs:
//   POST|PUT /v/<key>   store the body (device A publishes the room link)
//   GET      /v/<key>   read it back (device B)
//   DELETE   /v         forget everything
//   POST     /trigger   { action, platform, device }: run one allow-listed simulator command that
//                       Maestro cannot express (a system screenshot, a biometric match).
// The values pass through here exactly once and are never written to disk or stdout.
import { Buffer } from 'node:buffer';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const port = Number(process.env.RELAY_PORT ?? 4311);
const store = new Map();
const DEVICE = /^[A-Za-z0-9:_.-]{1,64}$/;

// Where the iOS Simulator saves "Save Screen" captures when the run script has pointed it there
// (`defaults write com.apple.iphonesimulator ScreenShotSaveLocation <dir>`). Deleted after each trigger.
const shotDir = process.env.RELAY_SHOT_DIR ?? path.join(os.tmpdir(), 'onepeek-e2e-shots');

const triggers = {
  screenshot: {
    ios: () => [
      // Simulator.app "Save Screen" (⌘S) is the only simulator action that posts
      // UIApplicationUserDidTakeScreenshotNotification. It targets the frontmost simulator window,
      // so the run script keeps device B frontmost during 07 (README).
      ['osascript', ['-e', 'tell application "Simulator" to activate', '-e', 'tell application "System Events" to keystroke "s" using command down']],
    ],
    android: device => [
      ['adb', ['-s', device, 'shell', 'input', 'keyevent', 'KEYCODE_SYSRQ']],
      ['adb', ['-s', device, 'shell', 'sleep 2; rm -f /sdcard/Pictures/Screenshots/*']],
    ],
  },
  biometric: {
    ios: device => [['xcrun', ['simctl', 'spawn', device, 'notifyutil', '-p', 'com.apple.BiometricKit_Sim.fingerTouch.match']]],
    android: device => [['adb', ['-s', device, 'emu', 'finger', 'touch', '1']]],
  },
};

function run([cmd, args]) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', code => resolve(code === 0));
  });
}

async function trigger(body) {
  const action = triggers[body.action];
  const platform = String(body.platform ?? '').toLowerCase();
  const device = String(body.device ?? '');
  if (!action || !action[platform] || !DEVICE.test(device)) return 400;
  for (const step of action[platform](device)) if (!(await run(step))) return 502;
  if (body.action === 'screenshot') await rm(shotDir, { recursive: true, force: true }).catch(() => {});
  return 204;
}

function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const key = url.pathname.startsWith('/v/') ? decodeURIComponent(url.pathname.slice(3)) : null;
  if (key && (req.method === 'POST' || req.method === 'PUT')) {
    store.set(key, await readBody(req));
    res.writeHead(204).end();
  } else if (key && req.method === 'GET') {
    const v = store.get(key);
    if (v === undefined) res.writeHead(404).end();
    else res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(v);
  } else if (url.pathname === '/v' && req.method === 'DELETE') {
    store.clear();
    res.writeHead(204).end();
  } else if (url.pathname === '/trigger' && req.method === 'POST') {
    let body = {};
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      body = {};
    }
    res.writeHead(await trigger(body)).end();
  } else if (url.pathname === '/health') {
    res.writeHead(204).end();
  } else {
    res.writeHead(404).end();
  }
});

server.listen(port, '127.0.0.1');
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
