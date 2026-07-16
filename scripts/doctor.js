const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const electronCommand = process.platform === 'win32'
  ? path.join(root, 'node_modules', '.bin', 'electron.cmd')
  : path.join(root, 'node_modules', '.bin', 'electron');
const electronRuntime = process.platform === 'win32'
  ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(root, 'node_modules', 'electron', 'dist', 'electron');

const checks = [
  ['package.json', fs.existsSync(path.join(root, 'package.json'))],
  ['electron command', fs.existsSync(electronCommand)],
  ['electron runtime', fs.existsSync(electronRuntime)],
  ['main process', fs.existsSync(path.join(root, 'src', 'main.js'))],
  ['renderer page', fs.existsSync(path.join(root, 'src', 'index.html'))]
];

for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK ' : 'ERR'} ${name}`);
}

if (checks.some(([, ok]) => !ok)) {
  console.log('\nRun: npm install --cache .npm-cache');
  process.exit(1);
}

console.log('\nReady. Run: npm run dev');
