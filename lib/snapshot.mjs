import fs from 'node:fs';
import { sh, realpath } from './util.mjs';
import { M } from './i18n.mjs';

// 在 dir 下监听端口的进程（dev server 之类）：先列所有 LISTEN，再按进程 cwd 过滤
function listeners(dir, prefix) {
  const out = sh('lsof', ['-iTCP', '-sTCP:LISTEN', '-P', '-n', '-Fpcn']);
  if (!out) return [];
  const procs = new Map();
  let cur = null;
  for (const line of out.split('\n')) {
    const k = line[0], v = line.slice(1);
    if (k === 'p') { cur = { pid: v, cmd: '', ports: new Set() }; procs.set(v, cur); }
    else if (k === 'c' && cur) cur.cmd = v;
    else if (k === 'n' && cur) cur.ports.add(v.replace(/^.*:/, ''));
  }
  if (!procs.size) return [];
  const cwds = sh('lsof', ['-a', '-d', 'cwd', '-p', [...procs.keys()].join(','), '-Fpn']) || '';
  const res = [];
  let pid = null;
  for (const line of cwds.split('\n')) {
    if (line[0] === 'p') pid = line.slice(1);
    else if (line[0] === 'n' && pid) {
      const cwd = line.slice(1);
      if (cwd === dir || (prefix && cwd.startsWith(dir + '/'))) {
        const p = procs.get(pid);
        res.push(M.listening(p.cmd, pid, [...p.ports], cwd));
      }
    }
  }
  return res;
}

export function snapshot(cwd) {
  const snap = { cwd, exists: fs.existsSync(cwd), git: null, listeners: [] };
  if (!snap.exists) return snap;
  const top = sh('git', ['rev-parse', '--show-toplevel'], { cwd });
  if (top) {
    const g = (...a) => sh('git', a, { cwd }) ?? '';
    snap.git = {
      top,
      branch: g('branch', '--show-current') || '(detached)',
      head: g('log', '-1', '--format=%h %s'),
      upstream: g('rev-parse', '--abbrev-ref', '@{upstream}'),
      aheadBehind: g('rev-list', '--left-right', '--count', 'HEAD...@{upstream}'),
      status: g('status', '--short'),
      diffStat: g('diff', 'HEAD', '--stat'),
      log: g('log', '--oneline', '-8'),
      worktrees: g('worktree', 'list'),
      stash: g('stash', 'list'),
    };
  }
  // 非 git 目录（比如 ~）只认 cwd 完全相同的进程，否则整个家目录下的服务都会被算进来
  snap.listeners = listeners(realpath(top || cwd), !!top);
  return snap;
}
