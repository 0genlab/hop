import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const HOME = process.env.HOME;
export const HOP_DIR = process.env.HOP_DIR || path.join(HOME, '.hop');

export function* readJsonl(file) {
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { yield JSON.parse(line); } catch { /* 半行（会话仍在写入）直接跳过 */ }
  }
}

// 只读文件开头第一行，rollout 首行的 session_meta 可能几十 KB
export function readFirstLine(file, max = 1 << 20) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(max, fs.fstatSync(fd).size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    const s = buf.toString('utf8');
    const i = s.indexOf('\n');
    return i === -1 ? s : s.slice(0, i);
  } finally { fs.closeSync(fd); }
}

export function readHead(file, bytes = 128 * 1024) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(bytes, fs.fstatSync(fd).size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
}

export function readTail(file, bytes = 256 * 1024) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
}

export function realpath(p) {
  if (!p) return p;
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

export function sh(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, ...opts }).trimEnd();
  } catch { return null; }
}

export function gitTop(dir) {
  return sh('git', ['rev-parse', '--show-toplevel'], { cwd: dir });
}

// 会话 cwd 是否属于目标目录：完全相同，或目标是 git 根且会话开在其子目录
export function cwdMatches(sessionCwd, target, targetIsRepo) {
  const a = realpath(sessionCwd);
  if (a === target) return true;
  return targetIsRepo && a.startsWith(target + '/');
}

export function clip(s, n) {
  if (s == null) return '';
  s = String(s);
  return s.length <= n ? s : s.slice(0, n) + `…[截断，原长 ${s.length} 字符]`;
}

export function recentFiles(files, days) {
  const since = Date.now() - days * 864e5;
  return files
    .map(f => { try { return { file: f, mtime: fs.statSync(f).mtimeMs }; } catch { return null; } })
    .filter(x => x && x.mtime >= since)
    .sort((a, b) => b.mtime - a.mtime);
}
