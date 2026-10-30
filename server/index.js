import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import express from 'express';
import { harden } from './harden.js';
import { router } from './api.js';
import { ROOT } from './store.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host') args.host = argv[++i];
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--token') args.token = argv[++i];
    else if (a === '--dev') args.dev = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const host = args.host || '127.0.0.1';
const port = Number(args.port || 7331);
const remoteToken = args.token || '';
const dev = !!args.dev;
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);

if (!loopback && !remoteToken) {
  console.error(
    'Remote mode (non-loopback bind) requires --token <shared-secret>. Local-first is the default: run without --host for 127.0.0.1.'
  );
  process.exit(1);
}

const allowedHosts = loopback
  ? [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]
  : null; // non-loopback: Host varies (tailscale/IP), the session token is the gate

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));
app.use('/api', harden({ allowedHosts, remoteToken: loopback ? '' : remoteToken }), router);

const dist = path.join(ROOT, 'web', 'dist');
if (!dev && fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(dist, 'index.html'));
    }
    next();
  });
} else if (!dev) {
  app.get('/', (req, res) => {
    res
      .status(200)
      .send('Redirector Studio API is running. Build the UI with `npm run build` or use `npm run dev`.');
  });
}

app.listen(port, host, () => {
  const where = `http://${loopback ? '127.0.0.1' : host}:${port}`;
  console.log(`Redirector Studio ${dev ? '(dev)' : ''} on ${where}`);
  if (dev) console.log('UI dev server: npm run dev:web (Vite on :5173, proxies /api here)');
  if (!loopback) console.log('Remote mode: session token required on every API call.');
});

if (dev) {
  const viteBin = path.join(ROOT, 'node_modules', '.bin', 'vite');
  if (fs.existsSync(viteBin + ext())) {
    const child = spawn(viteBin + ext(), { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    const stop = () => child.kill();
    process.on('SIGINT', stop);
    process.on('exit', stop);
  }
}

function ext() {
  return process.platform === 'win32' ? '.cmd' : '';
}
