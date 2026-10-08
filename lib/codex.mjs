import fs from 'node:fs';
import path from 'node:path';
import { HOME, readJsonl, readFirstLine, recentFiles, cwdMatches } from './util.mjs';
import { M } from './i18n.mjs';

const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, '.codex');
const ROOT = path.join(CODEX_HOME, 'sessions');

// 只认人直接用的会话：cli = codex TUI，vscode = Codex 桌面端。
// exec（被脚本/其他 agent 调起）和 subagent（source 是对象）都排除。
const INTERACTIVE = new Set(['cli', 'vscode']);

function listRollouts(days) {
  const out = [];
  for (let i = 0; i <= days; i++) {
    const d = new Date(Date.now() - i * 864e5);
    const dir = path.join(ROOT, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) if (n.endsWith('.jsonl')) out.push(path.join(dir, n));
  }
  return out;
}

function readMeta(file) {
  try {
    const o = JSON.parse(readFirstLine(file));
    return o.type === 'session_meta' ? o.payload : null;
  } catch { return null; }
}

export function findCodexSessions({ target, targetIsRepo, days = 14, any = false }) {
  const res = [];
  for (const { file, mtime } of recentFiles(listRollouts(days), days)) {
    const meta = readMeta(file);
    if (!meta || typeof meta.source !== 'string' || !INTERACTIVE.has(meta.source)) continue;
    if (!any && !cwdMatches(meta.cwd, target, targetIsRepo)) continue;
    res.push({ tool: 'codex', id: meta.id || meta.session_id, file, mtime, cwd: meta.cwd, origin: meta.originator });
  }
  return res;
}

// 会话名（自动生成或 /rename）不在 rollout 里，而是追加写在 session_index.jsonl，同一 id 以最后一条为准
export function codexThreadName(id, index = path.join(CODEX_HOME, 'session_index.jsonl')) {
  if (!id || !fs.existsSync(index)) return null;
  let name = null;
  for (const rec of readJsonl(index)) if (rec.id === id && rec.thread_name) name = rec.thread_name;
  return name;
}

export function codexFileById(id, days = 60) {
  if (fs.existsSync(id)) return id;
  return recentFiles(listRollouts(days), days).map(x => x.file).find(f => f.includes(id)) || null;
}

// 系统注入到 user 角色里的内容：<environment_context>、<recommended_plugins>、AGENTS.md 等
function isInjected(text) {
  const t = text.trimStart();
  if (t.startsWith('# AGENTS.md instructions')) return true;
  const m = t.match(/^<([a-z_]+)>/);
  return !!m && t.trimEnd().endsWith(`</${m[1]}>`);
}

function textOf(content) {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : '';
  return content.map(p => p.text ?? (p.type === 'input_image' ? M.image : '')).filter(Boolean).join('\n');
}

function patchFiles(patch) {
  return [...String(patch).matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)].map(m => `${m[1]} ${m[2]}`);
}

function briefCall(name, raw) {
  let args = raw;
  if (typeof raw === 'string') { try { args = JSON.parse(raw); } catch { /* custom tool 的 input 是纯文本 */ } }
  if (name === 'apply_patch') {
    const files = patchFiles(typeof args === 'string' ? args : args?.input ?? '');
    return `apply_patch: ${files.join(', ') || M.unknownFiles}`;
  }
  if (args && typeof args === 'object') {
    const cmd = args.cmd ?? (Array.isArray(args.command) ? args.command.join(' ') : args.command);
    if (cmd) return `$ ${cmd}${args.workdir ? `   (in ${args.workdir})` : ''}`;
  }
  const s = typeof args === 'string' ? args : JSON.stringify(args);
  return `${name}: ${s.replace(/\s+/g, ' ').slice(0, 300)}`;
}

function outputText(out) {
  let s = typeof out === 'string' ? out : out?.content ?? out?.output ?? JSON.stringify(out);
  if (typeof s !== 'string') s = JSON.stringify(s);
  // exec_command 的输出带一段元信息头，只留退出码和正文
  const exit = s.match(/Process exited with code (\d+)/);
  const i = s.indexOf('\nOutput:\n');
  if (i !== -1) s = s.slice(i + 9);
  return exit && exit[1] !== '0' ? `[exit ${exit[1]}]\n${s}` : s;
}

export function parseCodex(file) {
  const session = { tool: 'codex', file, id: null, cwd: null, model: null, permission: null, title: null, summary: null, turns: [] };
  let turn = null;
  const calls = new Map();
  const newTurn = user => { turn = { user, ts: null, assistant: [], reasoning: [], tools: [], interjections: [] }; session.turns.push(turn); };

  for (const rec of readJsonl(file)) {
    const p = rec.payload || {};
    if (rec.type === 'session_meta') {
      session.id = p.id || p.session_id; session.cwd = p.cwd; session.origin = p.originator;
      continue;
    }
    if (rec.type === 'turn_context') {
      session.cwd = p.cwd || session.cwd;
      session.model = p.model || session.model;
      session.permission = `sandbox=${p.sandbox_policy?.type ?? '?'} approval=${p.approval_policy ?? '?'}`;
      continue;
    }
    if (rec.type === 'compacted') {
      // 上下文被压缩：压缩前的轮次已由摘要代替
      session.summary = p.message || session.summary;
      session.turns = []; turn = null; calls.clear();
      continue;
    }
    if (rec.type !== 'response_item') continue;

    if (p.type === 'message') {
      const text = textOf(p.content);
      if (p.role === 'user') {
        if (!text || isInjected(text)) continue;
        newTurn(text); turn.ts = rec.timestamp;
      } else if (p.role === 'assistant' && text) {
        if (!turn) newTurn(null);
        turn.assistant.push(text);
      }
    } else if (p.type === 'reasoning') {
      // 官方模型只有加密密文 + 简短 summary 标题；第三方 provider 会有明文 content
      const raw = textOf(p.content);
      const sum = (p.summary || []).map(s => s.text).filter(Boolean).join(' / ');
      if (turn && (raw || sum)) turn.reasoning.push(raw || sum);
    } else if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') {
      if (!turn) newTurn(null);
      const t = { name: p.name || p.type, brief: briefCall(p.name, p.arguments ?? p.input ?? p.action), output: null };
      turn.tools.push(t);
      if (p.call_id) calls.set(p.call_id, t);
    } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      const t = calls.get(p.call_id);
      if (t) t.output = outputText(p.output);
    }
  }
  session.title = codexThreadName(session.id);
  return session;
}
