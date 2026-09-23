#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { HOP_DIR, gitTop, realpath } from '../lib/util.mjs';
import { findCodexSessions, codexFileById, parseCodex } from '../lib/codex.mjs';
import { findClaudeSessions, claudeFileById, parseClaude } from '../lib/claude.mjs';
import { snapshot } from '../lib/snapshot.mjs';
import { renderHandoff, TOOL_NAMES, resumeCmd } from '../lib/render.mjs';
import { buildScript, writeScript, openTab, runHere } from '../lib/launch.mjs';

const USAGE = `hop — 在 Codex 和 Claude Code 之间切换任务，不丢上下文

用法：
  hop cc      [选项] [-- 透传给 claude 的参数]   Codex → Claude Code
  hop codex   [选项] [-- 透传给 codex 的参数]    Claude Code → Codex

选项：
  --latest          不按当前目录匹配，直接取源工具全局最新的会话
  --session <id>    指定源会话（会话 ID 或 jsonl 路径）
  --list            列出候选源会话后退出
  --dry-run         只生成交接文档，不启动
  --here            在当前终端启动（默认开 iTerm 新 tab）
  --days <n>        查找范围，默认 14 天
  --budget <KB>     交接文档大小上限，默认 48

在卡住的 Claude Code 会话里可以直接敲：! hop codex
环境变量：HOP_TERMINAL=iterm|terminal  HOP_CLAUDE_BIN  HOP_CODEX_BIN  HOP_DIR`;

function parseArgs(argv) {
  const o = { extra: [], days: 14, budget: 48 };
  const dd = argv.indexOf('--');
  if (dd !== -1) { o.extra = argv.slice(dd + 1); argv = argv.slice(0, dd); }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--latest') o.latest = true;
    else if (a === '--list') o.list = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--here') o.here = true;
    else if (a === '--session') o.session = argv[++i];
    else if (a === '--days') o.days = Number(argv[++i]);
    else if (a === '--budget') o.budget = Number(argv[++i]);
    else if (a === '-h' || a === '--help') o.help = true;
    else if (!o.to) o.to = a;
    else throw new Error(`无法识别的参数：${a}`);
  }
  return o;
}

const ago = ms => {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前`;
};

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || !o.to) { console.log(USAGE); return; }
  const to = { cc: 'claude', claude: 'claude', codex: 'codex', cx: 'codex' }[o.to];
  if (!to) throw new Error(`目标只能是 cc 或 codex，收到：${o.to}`);
  const from = to === 'claude' ? 'codex' : 'claude';
  const find = from === 'codex' ? findCodexSessions : findClaudeSessions;

  const here = process.cwd();
  const top = gitTop(here);
  const target = realpath(top || here);

  let file, scope;
  if (o.session) {
    file = from === 'codex' ? codexFileById(o.session) : claudeFileById(o.session);
    if (!file) throw new Error(`找不到 ${TOOL_NAMES[from]} 会话：${o.session}`);
    scope = '指定';
  } else {
    let cands = o.latest ? [] : find({ target, targetIsRepo: !!top, days: o.days });
    scope = `当前目录 ${target}`;
    if (!cands.length) {
      if (!o.latest && !o.list) console.error(`当前目录没有 ${TOOL_NAMES[from]} 会话，改用全局最新的。`);
      cands = find({ target, targetIsRepo: !!top, days: o.days, any: true });
      scope = '全局';
    }
    if (o.list) {
      console.log(`${TOOL_NAMES[from]} 候选会话（${scope}，新的在前）：`);
      for (const c of cands.slice(0, 15)) console.log(`  ${ago(c.mtime).padEnd(8)} ${c.id}  ${c.cwd}`);
      return;
    }
    if (!cands.length) throw new Error(`近 ${o.days} 天没有交互式 ${TOOL_NAMES[from]} 会话`);
    file = cands[0].file;
    // 同一目录常有多个并行会话，最近改动的那个不一定是用户想切的
    const busy = cands.filter(c => cands[0].mtime - c.mtime < 10 * 60000);
    if (busy.length > 1) {
      console.error(`⚠️ 有 ${busy.length} 个会话在 10 分钟内活跃，默认取最新的；不对就用 --list 看、--session <id> 指定：`);
      for (const c of busy.slice(0, 5)) console.error(`   ${ago(c.mtime).padEnd(8)} ${c.id}  ${c.cwd}`);
    }
  }

  const session = from === 'codex' ? parseCodex(file) : parseClaude(file);
  if (!session.turns.length && !session.summary) throw new Error(`会话是空的：${file}`);
  const cwd = session.cwd || here;
  const snap = snapshot(cwd);
  const doc = renderHandoff({ session, snap, to, budget: o.budget * 1024 });

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const dir = path.join(HOP_DIR, 'handoffs');
  fs.mkdirSync(dir, { recursive: true });
  const handoff = path.join(dir, `${stamp}-${from}-to-${to}.md`);
  fs.writeFileSync(handoff, doc);
  fs.appendFileSync(path.join(HOP_DIR, 'links.jsonl'), JSON.stringify({ ts: Date.now(), from, fromId: session.id, to, cwd, handoff }) + '\n');

  console.log(`源会话   ${TOOL_NAMES[from]} ${session.id}（${scope}）${session.title ? ` — ${session.title}` : ''}`);
  console.log(`工作目录 ${cwd}${snap.git ? `  [${snap.git.branch}]` : ''}`);
  console.log(`交接文档 ${handoff}（${session.turns.length} 轮，${(Buffer.byteLength(doc) / 1024).toFixed(1)} KB）`);
  console.log(`切回原会话 ${resumeCmd(session)}`);
  if (o.dryRun) return;

  const script = writeScript(buildScript({ to, cwd, handoff, extra: o.extra }));
  if (o.here) runHere(script);
  const term = openTab(script);
  console.log(`已在 ${term} 新标签页启动 ${TOOL_NAMES[to]}`);
}

try { main(); } catch (e) { console.error(`hop: ${e.message}`); process.exit(1); }
