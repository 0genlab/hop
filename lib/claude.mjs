import fs from 'node:fs';
import path from 'node:path';
import { HOME, readJsonl, readHead, readTail, recentFiles, cwdMatches } from './util.mjs';
import { M } from './i18n.mjs';

const ROOT = process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, 'projects') : path.join(HOME, '.claude/projects');

function listTranscripts() {
  const out = [];
  let dirs;
  try { dirs = fs.readdirSync(ROOT, { withFileTypes: true }); } catch { return out; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(ROOT, d.name);
    for (const n of fs.readdirSync(dir)) if (n.endsWith('.jsonl')) out.push(path.join(dir, n));
  }
  return out;
}

function headCwd(file) {
  for (const line of readHead(file).split('\n')) {
    try { const o = JSON.parse(line); if (o.cwd) return o.cwd; } catch { /* 末尾半行 */ }
  }
  return null;
}

// 从文件尾部拿最新 cwd：会话中途进 worktree 后 cwd 会变，文件也会被 relocated 到新目录
function tailInfo(file) {
  const lines = readTail(file).split('\n');
  let cwd = null, entrypoint = null, hasMsg = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    let o; try { o = JSON.parse(lines[i]); } catch { continue; }
    if (o.type === 'relocated' && !cwd) cwd = o.relocatedCwd;
    if (o.cwd && !cwd) cwd = o.cwd;
    if (o.entrypoint && !entrypoint) entrypoint = o.entrypoint;
    if (o.type === 'user' || o.type === 'assistant') hasMsg = true;
    if (cwd && entrypoint && hasMsg) break;
  }
  return { cwd, entrypoint, hasMsg };
}

export function findClaudeSessions({ target, targetIsRepo, days = 14, any = false }) {
  const res = [];
  for (const { file, mtime } of recentFiles(listTranscripts(), days)) {
    const { cwd, entrypoint, hasMsg } = tailInfo(file);
    // sdk-cli = claude -p / SDK 调起的非交互会话，排除
    if (!hasMsg || !cwd || (entrypoint && entrypoint !== 'cli')) continue;
    // cwd 会跟着 agent 的 cd 漂移，启动目录和最新目录任一匹配都算
    if (!any && !cwdMatches(cwd, target, targetIsRepo)) {
      const start = headCwd(file);
      if (!start || !cwdMatches(start, target, targetIsRepo)) continue;
    }
    res.push({ tool: 'claude', id: path.basename(file, '.jsonl'), file, mtime, cwd });
  }
  return res;
}

export function claudeFileById(id) {
  if (fs.existsSync(id)) return id;
  return listTranscripts().find(f => path.basename(f, '.jsonl') === id) || null;
}

const NOISE = ['<task-notification', '<local-command-', 'Another Claude session', '[Request interrupted', 'Base directory for this skill', 'Caveat: '];

function cleanUserText(s) {
  s = s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  if (!s || NOISE.some(p => s.startsWith(p))) return null;
  // 斜杠命令还原成用户实际敲的样子
  const name = s.match(/<command-name>([\s\S]*?)<\/command-name>/);
  if (name) {
    const args = s.match(/<command-args>([\s\S]*?)<\/command-args>/);
    return `${name[1].trim()} ${args ? args[1].trim() : ''}`.trim();
  }
  return s;
}

function briefTool(name, input = {}) {
  switch (name) {
    case 'Bash': return `$ ${input.command}`;
    case 'Read': case 'Edit': case 'Write': case 'NotebookEdit':
      return `${name} ${input.file_path || input.notebook_path}`;
    case 'Grep': case 'Glob': return `${name} ${input.pattern}${input.path ? ` in ${input.path}` : ''}`;
    case 'Agent': case 'Task': return `${name}: ${input.description || ''}`;
    case 'Skill': return `Skill /${input.skill} ${input.args || ''}`.trim();
    case 'WebFetch': return `WebFetch ${input.url}`;
    default: return `${name}: ${JSON.stringify(input).slice(0, 300)}`;
  }
}

function resultText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(b => b.text ?? (b.type === 'image' ? M.image : '')).join('\n');
  return JSON.stringify(c);
}

export function parseClaude(file) {
  const session = { tool: 'claude', file, id: path.basename(file, '.jsonl'), cwd: null, model: null, permission: null, title: null, summary: null, turns: [] };
  const byUuid = new Map();
  let leaf = null;
  for (const rec of readJsonl(file)) {
    if (rec.type === 'ai-title') session.title = rec.aiTitle;
    else if (rec.type === 'permission-mode') session.permission = rec.permissionMode;
    else if (rec.type === 'relocated') session.cwd = rec.relocatedCwd;
    if (rec.cwd) session.cwd = rec.cwd;
    if (!rec.uuid) continue;
    byUuid.set(rec.uuid, rec);
    if ((rec.type === 'user' || rec.type === 'assistant') && !rec.isSidechain) leaf = rec;
  }

  // 沿 parentUuid 从最新叶子往回走，得到当前真正生效的那条分支（rewind 掉的分支不算）；
  // 压缩边界的 parentUuid 为 null，自然停在压缩摘要处
  const chain = [];
  for (let r = leaf; r; r = r.parentUuid ? byUuid.get(r.parentUuid) : null) chain.push(r);
  chain.reverse();

  let turn = null;
  const tools = new Map();
  const newTurn = user => { turn = { user, ts: null, assistant: [], reasoning: [], tools: [], interjections: [] }; session.turns.push(turn); };

  for (const rec of chain) {
    // 用户在 agent 干活途中插的话，存成 queued_command 附件，常是纠偏指令
    const a = rec.type === 'attachment' ? rec.attachment : null;
    if (a?.type === 'queued_command' && a.origin?.kind === 'human' && a.prompt) {
      if (!turn) newTurn(null);
      turn.interjections.push(String(a.prompt));
      continue;
    }
    const msg = rec.message;
    if (!msg) continue;
    if (rec.type === 'assistant') {
      if (msg.model && msg.model !== '<synthetic>') session.model = msg.model;
      for (const b of Array.isArray(msg.content) ? msg.content : []) {
        if (!turn) newTurn(null);
        if (b.type === 'text' && b.text.trim()) turn.assistant.push(b.text);
        else if (b.type === 'thinking' && b.thinking) turn.reasoning.push(b.thinking);
        else if (b.type === 'tool_use') {
          const t = { name: b.name, brief: briefTool(b.name, b.input), output: null };
          turn.tools.push(t); tools.set(b.id, t);
        }
      }
      continue;
    }
    if (rec.type !== 'user' || rec.isMeta) continue;
    if (rec.isCompactSummary) { session.summary = resultText(msg.content); continue; }
    const content = msg.content;
    if (typeof content === 'string') {
      const t = cleanUserText(content);
      if (t) { newTurn(t); turn.ts = rec.timestamp; }
      continue;
    }
    const texts = [];
    for (const b of content || []) {
      if (b.type === 'tool_result') {
        const t = tools.get(b.tool_use_id);
        if (t) t.output = (b.is_error ? '[error]\n' : '') + resultText(b.content);
      } else if (b.type === 'text') {
        const t = cleanUserText(b.text);
        if (t) texts.push(t);
      } else if (b.type === 'image') texts.push(M.image);
    }
    if (texts.length) { newTurn(texts.join('\n')); turn.ts = rec.timestamp; }
  }
  return session;
}
