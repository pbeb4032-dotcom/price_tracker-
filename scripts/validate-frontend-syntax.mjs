#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const root = process.cwd();
const srcDir = path.join(root, 'src');
const tsCandidates = [
  path.join(root, 'node_modules', 'typescript', 'lib', 'typescript.js'),
  path.join(root, 'api', 'node_modules', 'typescript', 'lib', 'typescript.js'),
];
const tsPath = tsCandidates.find((p) => fs.existsSync(p));
if (!tsPath) {
  console.error('typescript runtime not found; run npm ci (root or api) first');
  process.exit(1);
}
const ts = await import(pathToFileURL(tsPath).href).then((m) => m.default ?? m);

const exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (exts.includes(path.extname(entry.name)) && !entry.name.endsWith('.d.ts')) files.push(full);
  }
}
walk(srcDir);

function resolveImport(fromFile, spec) {
  const cleaned = spec.replace(/\?.*$/, '');
  let base;
  if (cleaned.startsWith('@/')) base = path.join(srcDir, cleaned.slice(2));
  else if (cleaned.startsWith('.')) base = path.resolve(path.dirname(fromFile), cleaned);
  else return true; // external dep, ignore here

  const candidates = [];
  if (path.extname(base)) candidates.push(base);
  else {
    for (const ext of exts) candidates.push(base + ext);
    for (const ext of exts) candidates.push(path.join(base, 'index' + ext));
  }
  return candidates.some((p) => fs.existsSync(p));
}

const importRe = /(?:import|export)\s+(?:[^'"`]*?from\s+)?["'`]([^"'`]+)["'`]/g;
let checked = 0;
const problems = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const out = ts.transpileModule(text, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      allowJs: true,
    },
    fileName: file,
    reportDiagnostics: true,
  });
  const diags = (out.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (diags.length) {
    problems.push(`${path.relative(root, file)}: ${ts.flattenDiagnosticMessageText(diags[0].messageText, '\n')}`);
    continue;
  }
  let m;
  while ((m = importRe.exec(text))) {
    const spec = m[1];
    if (!resolveImport(file, spec)) {
      problems.push(`${path.relative(root, file)}: unresolved import ${spec}`);
      break;
    }
  }
  checked += 1;
}
if (problems.length) {
  console.error('frontend syntax/import validation failed');
  for (const p of problems.slice(0, 20)) console.error('-', p);
  process.exit(1);
}
console.log(`frontend syntax/import validation passed for ${checked} files`);
