#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
RELEASE_DATE=$(TZ=UTC-8 date '+%Y-%m-%d')
export RELEASE_DATE
node - "$@" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const dryRun = args.at(-1) === '--dry-run';
if (dryRun) args.pop();
if (args.length !== 3 || !/^\d+\.\d+\.\d+$/.test(args[0]) || args.slice(1).some(s => !s || /[\r\n]/.test(s))) {
  console.error('用法: bash tools/上线/升版本.sh <新版本> <中文一行> <英文一行> [--dry-run]');
  process.exit(2);
}
const [version, zh, en] = args;
const root = process.cwd();
const changes = [];
function change(name, transform, optional = false) {
  const file = path.join(root, name);
  const before = optional && !fs.existsSync(file) ? '' : fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (before !== after) changes.push({ name, file, before, after });
}
change('VERSION', () => version + '\n');
for (const name of ['README.md', 'README.zh-CN.md', 'README.ja.md']) {
  change(name, text => {
    const badge = /!\[Version v[^\]\r\n]+\]\(https:\/\/img\.shields\.io\/badge\/Version-v[^)\r\n]+-2ea44f\)/g;
    const matches = text.match(badge);
    if (!matches || matches.length !== 1) throw new Error(`${name}: 找不到唯一版本徽章`);
    return text.replace(badge, `![Version v${version}](https://img.shields.io/badge/Version-v${version}-2ea44f)`);
  });
}
change('docs/入口/start.md', text => {
  const line = /^Version: v[^\r\n]*(?=\r?$)/m;
  if (line.test(text)) return text.replace(line, `Version: v${version}`);
  const guide = /^(Guide revision:[^\r\n]*)(\r?\n|$)/m;
  if (!guide.test(text)) throw new Error('start.md: 找不到 Guide revision 行');
  return text.replace(guide, (_, content, end) => `${content}${end || '\n'}Version: v${version}${end || '\n'}`);
});
change('CHANGELOG.md', text => {
  if (!text) text = '# Changelog\n';
  if (!/^# Changelog(?:\r?\n|$)/.test(text)) throw new Error('CHANGELOG.md: 找不到标题');
  const entry = `\n\n## v${version} — ${process.env.RELEASE_DATE}\n\n- ${zh}\n- ${en}`;
  return text.replace(/^# Changelog/, '# Changelog' + entry + '\n');
}, true);
function diff({ name, before, after }) {
  const lines = text => text ? text.match(/[^\n]*\n|[^\n]+$/g) || [] : [];
  const a = lines(before), b = lines(after);
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  let out = `--- ${before ? 'a/' + name : '/dev/null'}\n+++ b/${name}\n@@ -${a.length ? 1 : 0},${a.length} +${b.length ? 1 : 0},${b.length} @@\n`;
  let i = 0, j = 0;
  const append = (prefix, line) => { out += prefix + line + (line.endsWith('\n') ? '' : '\n\\ No newline at end of file\n'); };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { append(' ', a[i++]); j++; }
    else if (i < a.length && (j === b.length || table[i + 1][j] >= table[i][j + 1])) append('-', a[i++]);
    else append('+', b[j++]);
  }
  return out;
}
if (dryRun) process.stdout.write(changes.map(diff).join(''));
else for (const { file, after } of changes) fs.writeFileSync(file, after, 'utf8');
NODE
