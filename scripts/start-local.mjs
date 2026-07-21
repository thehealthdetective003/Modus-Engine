import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const python = path.join(root, '.runtime', 'python', 'python.exe');
if (!existsSync(python)) {
  console.error('Local Whisper is not installed. Run: npm run setup:whisper');
  process.exit(1);
}

const service = spawn(python, [path.join(root, 'whisper-service', 'service.py')], { cwd: root, stdio: 'inherit' });
const vite = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'], { cwd: root, stdio: 'inherit' });
const stop = () => { service.kill(); vite.kill(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
service.on('exit', code => { if (code) console.error(`Whisper service exited with code ${code}`); });
vite.on('exit', code => { stop(); process.exit(code ?? 0); });
