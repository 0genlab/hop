import { clip } from './util.mjs';

export const TOOL_NAMES = { codex: 'Codex', claude: 'Claude Code' };

export function resumeCmd(s) {
  return s.tool === 'codex' ? `codex resume ${s.id}` : `claude --resume ${s.id}`;
}

// 由宽到紧的几档压缩参数，超预算就降一档
// tools = 每轮最多列几次调用，outK = 其中最后几次附带输出
const LEVELS = [
  { recent: 8, user: 4000, reply: 4000, think: 800, tools: 40, outK: 12, out: 1500, oldUser: 600, oldReply: 400, oldTools: 8 },
  { recent: 6, user: 3000, reply: 3000, think: 600, tools: 30, outK: 8, out: 1000, oldUser: 500, oldReply: 300, oldTools: 0 },
  { recent: 4, user: 2500, reply: 2500, think: 400, tools: 20, outK: 5, out: 600, oldUser: 300, oldReply: 200, oldTools: 0 },
  { recent: 3, user: 2000, reply: 2000, think: 0, tools: 12, outK: 3, out: 300, oldUser: 200, oldReply: 0, oldTools: 0 },
  { recent: 2, user: 1500, reply: 1500, think: 0, tools: 8, outK: 2, out: 200, oldUser: 120, oldReply: 0, oldTools: 0 },
  { recent: 1, user: 1500, reply: 1500, think: 0, tools: 5, outK: 0, out: 0, oldUser: 100, oldReply: 0, oldTools: 0 },
];

// 回复原文放进引用块，里面的 ## 标题就不会和交接文档自己的结构混在一起
const quote = s => s.split('\n').map(l => `> ${l}`).join('\n');
const fence = s => `~~~\n${s.replace(/~~~/g, '~ ~ ~')}\n~~~`;
const fmtTime = ts => ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '';

function renderSnapshot(snap) {
  const L = [];
  if (!snap.exists) {
    L.push(`- ⚠️ 工作目录 \`${snap.cwd}\` 已不存在（worktree 可能被删了），先和用户确认在哪继续。`);
    return L.join('\n');
  }
  L.push(`- 工作目录：\`${snap.cwd}\``);
  const g = snap.git;
  if (g) {
    L.push(`- 仓库根：\`${g.top}\``);
    L.push(`- 分支：\`${g.branch}\`${g.upstream ? `（跟踪 \`${g.upstream}\`，领先/落后 ${g.aheadBehind.replace(/\s+/, '/')}）` : '（无上游）'}`);
    L.push(`- HEAD：${g.head}`);
    L.push(`\n未提交改动（\`git status --short\`）：\n${fence(g.status || '(工作区干净)')}`);
    if (g.diffStat) L.push(`改动规模（\`git diff HEAD --stat\`）：\n${fence(clip(g.diffStat, 3000))}`);
    L.push(`最近提交：\n${fence(g.log)}`);
    if (g.worktrees.split('\n').length > 1) L.push(`worktree 列表：\n${fence(clip(g.worktrees, 2000))}`);
    if (g.stash) L.push(`stash：\n${fence(clip(g.stash, 1000))}`);
  } else {
    L.push('- 不是 git 仓库');
  }
  L.push(snap.listeners.length
    ? `\n该目录下仍在监听端口的进程（可能是原 agent 起的 dev server，不要重复启动）：\n${snap.listeners.map(x => `- ${x}`).join('\n')}`
    : '\n该目录下没有监听端口的进程。');
  return L.join('\n');
}

function renderTurnDetail(t, i, lv) {
  const L = [`### 第 ${i + 1} 轮${t.ts ? ` · ${fmtTime(t.ts)}` : ''}`];
  L.push(t.user ? `**用户：**\n\n${fence(clip(t.user, lv.user))}` : '**用户：**（本段没有新的用户消息，是上一轮的延续）');
  if (t.interjections?.length) L.push(`**用户中途插话（优先级高，常是纠偏）：**\n${t.interjections.map(x => `- ${clip(x, lv.user)}`).join('\n')}`);
  if (lv.think && t.reasoning.length) {
    const r = t.reasoning.slice(-4).map(x => `- ${clip(x.replace(/\s+/g, ' '), lv.think)}`);
    L.push(`**源 agent 的思考（明文部分）：**\n${r.join('\n')}`);
  }
  if (t.tools.length) {
    L.push(`**工具调用（${t.tools.length} 次）：**`);
    const shown = t.tools.slice(-lv.tools);
    if (t.tools.length > shown.length) L.push(`- …省略前 ${t.tools.length - shown.length} 次调用（需要时 grep 原始记录）`);
    shown.forEach((x, k) => {
      L.push(`- \`${clip(x.brief.replace(/\n/g, ' ↵ '), 400).replace(/`/g, "'")}\``);
      if (x.output != null && k >= shown.length - lv.outK) L.push(fence(clip(x.output.trim() || '(空输出)', lv.out)));
    });
  }
  if (t.assistant.length) L.push(`**回复：**\n\n${quote(clip(t.assistant.join('\n\n'), lv.reply))}`);
  return L.join('\n\n');
}

function renderOldTurn(t, i, lv) {
  const L = [`${i + 1}. ${t.ts ? `[${fmtTime(t.ts)}] ` : ''}${t.user ? clip(t.user.replace(/\s+/g, ' '), lv.oldUser) : '（延续上一轮）'}`];
  for (const x of t.interjections || []) L.push(`   - 中途插话：${clip(x.replace(/\s+/g, ' '), lv.oldUser)}`);
  if (lv.oldTools && t.tools.length) {
    for (const x of t.tools.slice(-lv.oldTools)) L.push(`   - \`${clip(x.brief.replace(/\s+/g, ' '), 150).replace(/`/g, "'")}\``);
    if (t.tools.length > lv.oldTools) L.push(`   - …共 ${t.tools.length} 次工具调用`);
  } else if (t.tools.length) L.push(`   - （${t.tools.length} 次工具调用）`);
  const last = t.assistant.at(-1);
  if (lv.oldReply && last) L.push(`   - 回复：${clip(last.replace(/\s+/g, ' '), lv.oldReply)}`);
  return L.join('\n');
}

export function renderHandoff({ session, snap, to, budget = 48 * 1024 }) {
  const from = TOOL_NAMES[session.tool], dest = TOOL_NAMES[to];
  let doc = '';
  for (const lv of LEVELS) {
    doc = build(session, snap, from, dest, lv);
    if (Buffer.byteLength(doc) <= budget) break;
  }
  return doc;
}

function build(s, snap, from, dest, lv) {
  const turns = s.turns;
  const cut = Math.max(0, turns.length - lv.recent);
  const L = [];
  L.push(`# 任务交接：${from} → ${dest}`);
  L.push(`> 生成于 ${fmtTime(Date.now())}，由 hop 从 ${from} 的会话记录机械抽取。原 agent 的完整思考过程是加密的、没法带过来，下文只有对话、工具调用和明文思考片段。`);

  L.push(`## 给接手 agent 的说明

1. 用户原本在 ${from} 里做这个任务，${from} 不可用或用户想换工具，所以切给你继续。**本文件就是你的上下文。**
2. 先读完全文，再用 5 行以内复述：**目标 / 已完成 / 停在哪 / 下一步打算**，等用户确认后再动手。
3. 本文件的细节不够时，去原始会话记录里按关键词 grep：\`${s.file}\`（JSONL，可能很大，不要整个读进来）。
4. 工作区里未提交的改动是原 agent 留下的在制品，**不要 reset、checkout 或丢弃**。
5. 原 agent 定下的约束和用户否决过的方案一样有效。它们散落在下面的用户消息里，复述时一并列出来。`);

  L.push(`## 源会话

- 工具：${from}${s.origin ? `（${s.origin}）` : ''}
- 会话 ID：\`${s.id}\`${s.title ? `\n- 标题：${s.title}` : ''}
- 模型：${s.model || '未知'}
- 权限：${s.permission || '未知'}
- 轮数：${turns.length}${s.summary ? '（另有一段更早的压缩摘要）' : ''}
- 用户切回原会话：\`${resumeCmd(s)}\``);

  L.push(`## 环境快照\n\n${renderSnapshot(snap)}`);

  if (s.summary) L.push(`## 更早的上下文（源会话自己的压缩摘要）\n\n${fence(clip(s.summary, 8000))}`);

  if (cut > 0) {
    L.push(`## 更早的轮次（${cut === 1 ? '第 1 轮' : `第 1–${cut} 轮`}，已压缩）\n\n${turns.slice(0, cut).map((t, i) => renderOldTurn(t, i, lv)).join('\n')}`);
  }
  L.push(`## 最近的轮次（${cut + 1 === turns.length ? `第 ${turns.length} 轮` : `第 ${cut + 1}–${turns.length} 轮`}，详细）\n\n${turns.slice(cut).map((t, i) => renderTurnDetail(t, cut + i, lv)).join('\n\n---\n\n')}`);

  const lastTurn = turns.at(-1);
  if (lastTurn && !lastTurn.assistant.length) {
    L.push('## ⚠️ 注意\n\n最后一轮没有助手的文字回复。原 agent 很可能是在执行中途被中断的（额度耗尽、限流或卡死），最后那个动作不一定完成了，先核实再继续。');
  }
  return L.join('\n\n') + '\n';
}
