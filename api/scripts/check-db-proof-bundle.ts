import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cli = path.join(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

function run(label: string, scriptName: string) {
  const scriptPath = path.join(__dirname, scriptName);
  const r = spawnSync(process.execPath, [cli, scriptPath], {
    stdio: 'pipe',
    encoding: 'utf8',
    env: process.env,
  });
  return {
    label,
    script: scriptName,
    ok: r.status === 0,
    exitCode: r.status ?? 1,
    stdout: String(r.stdout || '').trim(),
    stderr: String(r.stderr || '').trim(),
  };
}

function tail(text: string, max = 30) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.slice(-max).join('\n');
}

async function main() {
  const steps = [
    run('db-preflight', 'check-db-preflight.ts'),
    run('db-fixture', 'check-live-db-fixture-conflicts.ts'),
    run('db-live-report', 'check-live-db-governance.ts'),
  ];

  const summary = {
    ok: steps.every((s) => s.ok),
    steps: steps.map((s) => ({
      label: s.label,
      script: s.script,
      ok: s.ok,
      exitCode: s.exitCode,
      stdout_tail: tail(s.stdout),
      stderr_tail: tail(s.stderr),
    })),
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

main().catch((err) => {
  console.error('db proof bundle failed');
  console.error(err?.stack || String(err));
  process.exit(1);
});
