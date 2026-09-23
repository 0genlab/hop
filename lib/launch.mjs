import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HOP_DIR } from './util.mjs';
import { M } from './i18n.mjs';

const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

export function buildScript({ to, cwd, handoff, extra = [] }) {
  const prompt = M.prompt(handoff);
  const bin = to === 'codex' ? (process.env.HOP_CODEX_BIN || 'codex') : (process.env.HOP_CLAUDE_BIN || 'claude');
  // prompt 放在 flag 前面，避免被 --add-dir 这类可变参数吞掉
  const argv = to === 'codex'
    ? [bin, '-C', cwd, prompt, ...extra]
    : [bin, prompt, ...extra];
  return `#!/bin/bash\n# ${M.scriptComment}\ncd ${q(cwd)} || { echo ${q(M.dirMissing(cwd))}; exit 1; }\nexec ${argv.map(q).join(' ')}\n`;
}

export function writeScript(content) {
  const dir = path.join(HOP_DIR, 'run');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `launch-${Date.now()}.sh`);
  fs.writeFileSync(file, content, { mode: 0o755 });
  return file;
}

function osa(lines) {
  const r = spawnSync('osascript', lines.flatMap(l => ['-e', l]), { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(M.osaFail((r.stderr || '').trim()));
}

export function openTab(script) {
  const cmd = `bash ${q(script)}`.replace(/"/g, '\\"');
  const term = process.env.HOP_TERMINAL || (fs.existsSync('/Applications/iTerm.app') ? 'iterm' : 'terminal');
  if (term === 'iterm') {
    osa([
      'tell application "iTerm2"',
      'activate',
      'if (count of windows) = 0 then',
      'create window with default profile',
      'else',
      'tell current window to create tab with default profile',
      'end if',
      `tell current session of current window to write text "${cmd}"`,
      'end tell',
    ]);
  } else if (term === 'terminal') {
    osa(['tell application "Terminal"', 'activate', `do script "${cmd}"`, 'end tell']);
  } else {
    throw new Error(M.badTerminal(term));
  }
  return term;
}

export function runHere(script) {
  const r = spawnSync('bash', [script], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
