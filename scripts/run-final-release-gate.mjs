import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const artifactsDir = path.join(root, 'artifacts');
fs.mkdirSync(artifactsDir, { recursive: true });
const outFile = path.join(artifactsDir, 'final-release-proof.json');

function fileExists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

const prerequisites = {
  rootNodeModules: fileExists('node_modules'),
  apiNodeModules: fileExists('api/node_modules'),
  apiTypeScript: fileExists('api/node_modules/typescript/lib/tsc.js'),
  apiTsx: fileExists('api/node_modules/tsx/dist/cli.mjs'),
};

if (!prerequisites.rootNodeModules || !prerequisites.apiNodeModules || !prerequisites.apiTypeScript || !prerequisites.apiTsx) {
  const summary = {
    generatedAt: new Date().toISOString(),
    project: path.basename(root),
    databaseUrlPresent: Boolean(process.env.DATABASE_URL),
    allPassed: false,
    blockedAt: 'dependency_install',
    prerequisites,
    nextSteps: [
      'npm ci --no-audit --no-fund',
      'npm --prefix api ci --no-audit --no-fund',
      'npm run validate:release:full',
    ],
  };
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.error('release gate blocked: dependencies are not installed cleanly.');
  console.error('run: npm ci --no-audit --no-fund');
  console.error('run: npm --prefix api ci --no-audit --no-fund');
  console.error(`wrote ${outFile}`);
  process.exit(2);
}

const steps = [
  { name: 'api_typecheck', cmd: 'npm', args: ['run', 'validate:api', '--silent'] },
  { name: 'frontend_syntax', cmd: 'npm', args: ['run', 'validate:frontend:syntax', '--silent'] },
  { name: 'classifier', cmd: 'npm', args: ['run', 'validate:classifier', '--silent'] },
  { name: 'governance_e2e', cmd: 'npm', args: ['run', 'validate:governance:e2e', '--silent'] },
  { name: 'frontend_build', cmd: 'npm', args: ['run', 'validate:build', '--silent'] },
  { name: 'db_preflight', cmd: 'npm', args: ['run', 'validate:db:preflight', '--silent'] },
  { name: 'db_fixture', cmd: 'npm', args: ['run', 'validate:db:fixture', '--silent'] },
  { name: 'db_live', cmd: 'npm', args: ['run', 'validate:db:live', '--silent'] },
];

const results = [];
let allPassed = true;
for (const step of steps) {
  const startedAt = new Date();
  const t0 = Date.now();
  const res = spawnSync(step.cmd, step.args, {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  const durationMs = Date.now() - t0;
  const exitCode = typeof res.status === 'number' ? res.status : 1;
  const passed = exitCode === 0;
  allPassed = allPassed && passed;
  results.push({
    name: step.name,
    command: [step.cmd, ...step.args].join(' '),
    startedAt: startedAt.toISOString(),
    durationMs,
    exitCode,
    passed,
    stdoutTail: (res.stdout || '').slice(-4000),
    stderrTail: (res.stderr || '').slice(-4000),
  });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${step.name} (${durationMs} ms)`);
  if (!passed) {
    console.error((res.stdout || '').slice(-2000));
    console.error((res.stderr || '').slice(-2000));
    break;
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  project: path.basename(root),
  databaseUrlPresent: Boolean(process.env.DATABASE_URL),
  prerequisites,
  allPassed,
  steps: results,
};
fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
console.log(`wrote ${outFile}`);
if (!allPassed) process.exit(1);
