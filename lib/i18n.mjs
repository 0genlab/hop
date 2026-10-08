// 输出语言：HOP_LANG=zh|en 优先，其次看系统 locale，中文环境出中文，其余一律英文
export function detectLang(env = process.env) {
  const forced = (env.HOP_LANG || '').toLowerCase();
  if (forced.startsWith('zh')) return 'zh';
  if (forced.startsWith('en')) return 'en';
  const loc = env.LC_ALL || env.LC_MESSAGES || env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || '';
  return /^zh/i.test(loc) ? 'zh' : 'en';
}

const zh = {
  usage: `hop — 在 Codex 和 Claude Code 之间切换任务，不丢上下文

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
环境变量：HOP_TERMINAL=iterm|terminal  HOP_CLAUDE_BIN  HOP_CODEX_BIN  HOP_DIR  HOP_LANG=zh|en`,
  badArg: a => `无法识别的参数：${a}`,
  ago: m => m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前`,
  badTarget: x => `目标只能是 cc 或 codex，收到：${x}`,
  sessionNotFound: (tool, id) => `找不到 ${tool} 会话：${id}`,
  scopeGiven: '指定',
  scopeCwd: dir => `当前目录 ${dir}`,
  scopeGlobal: '全局',
  noCwdSessions: tool => `当前目录没有 ${tool} 会话，改用全局最新的。`,
  listHeader: (tool, scope) => `${tool} 候选会话（${scope}，新的在前）：`,
  noSessions: (days, tool) => `近 ${days} 天没有交互式 ${tool} 会话`,
  busyWarn: n => `⚠️ 有 ${n} 个会话在 10 分钟内活跃，默认取最新的；不对就用 --list 看、--session <id> 指定：`,
  emptySession: file => `会话是空的：${file}`,
  outSource: (tool, id, scope, title) => `源会话   ${tool} ${id}（${scope}）${title ? ` — ${title}` : ''}`,
  outCwd: (cwd, branch) => `工作目录 ${cwd}${branch ? `  [${branch}]` : ''}`,
  outHandoff: (file, turns, kb) => `交接文档 ${file}（${turns} 轮，${kb} KB）`,
  outResume: cmd => `切回原会话 ${cmd}`,
  launched: (term, tool) => `已在 ${term} 新标签页启动 ${tool}`,

  sessionName: (task, from) => `${task}（接自 ${from}）`,
  prompt: (file, task) => `${task ? `任务「${task}」交接：` : ''}读 ${file} 接手这个任务：先按文件里「给接手 agent 的说明」用 5 行以内复述当前状态，等我确认后再继续。`,
  scriptComment: 'hop 生成的启动脚本',
  dirMissing: dir => `hop: 目录不存在 ${dir}`,
  osaFail: err => `osascript 失败：${err}`,
  badTerminal: term => `不支持的 HOP_TERMINAL=${term}（可选 iterm / terminal）`,

  listening: (cmd, pid, ports, cwd) => `${cmd} (pid ${pid}) 监听 :${ports.join(', :')}  cwd=${cwd}`,
  truncated: n => `…[截断，原长 ${n} 字符]`,
  image: '[图片]',
  unknownFiles: '(未识别文件)',

  timeLocale: 'zh-CN',
  snapGone: cwd => `- ⚠️ 工作目录 \`${cwd}\` 已不存在（worktree 可能被删了），先和用户确认在哪继续。`,
  snapCwd: cwd => `- 工作目录：\`${cwd}\``,
  snapTop: top => `- 仓库根：\`${top}\``,
  snapBranch: (branch, upstream, ab) => `- 分支：\`${branch}\`${upstream ? `（跟踪 \`${upstream}\`，领先/落后 ${ab}）` : '（无上游）'}`,
  snapStatus: '未提交改动（`git status --short`）：',
  snapClean: '(工作区干净)',
  snapDiff: '改动规模（`git diff HEAD --stat`）：',
  snapLog: '最近提交：',
  snapWorktrees: 'worktree 列表：',
  snapNotGit: '- 不是 git 仓库',
  snapListeners: '该目录下仍在监听端口的进程（可能是原 agent 起的 dev server，不要重复启动）：',
  snapNoListeners: '该目录下没有监听端口的进程。',

  turnHead: (n, time) => `### 第 ${n} 轮${time ? ` · ${time}` : ''}`,
  userLabel: '**用户：**',
  userNone: '**用户：**（本段没有新的用户消息，是上一轮的延续）',
  interjections: '**用户中途插话（优先级高，常是纠偏）：**',
  reasoning: '**源 agent 的思考（明文部分）：**',
  tools: n => `**工具调用（${n} 次）：**`,
  toolsOmitted: n => `- …省略前 ${n} 次调用（需要时 grep 原始记录）`,
  emptyOutput: '(空输出)',
  reply: '**回复：**',
  oldCont: '（延续上一轮）',
  oldInterjection: '中途插话：',
  oldToolsMore: n => `   - …共 ${n} 次工具调用`,
  oldToolsCount: n => `   - （${n} 次工具调用）`,
  oldReply: '回复：',

  docTitle: (from, dest) => `# 任务交接：${from} → ${dest}`,
  docIntro: (time, from) => `> 生成于 ${time}，由 hop 从 ${from} 的会话记录机械抽取。原 agent 的完整思考过程是加密的、没法带过来，下文只有对话、工具调用和明文思考片段。`,
  docGuide: (from, file) => `## 给接手 agent 的说明

1. 用户原本在 ${from} 里做这个任务，${from} 不可用或用户想换工具，所以切给你继续。**本文件就是你的上下文。**
2. 先读完全文，再用 5 行以内复述：**目标 / 已完成 / 停在哪 / 下一步打算**，等用户确认后再动手。
3. 本文件的细节不够时，去原始会话记录里按关键词 grep：\`${file}\`（JSONL，可能很大，不要整个读进来）。
4. 工作区里未提交的改动是原 agent 留下的在制品，**不要 reset、checkout 或丢弃**。
5. 原 agent 定下的约束和用户否决过的方案一样有效。它们散落在下面的用户消息里，复述时一并列出来。`,
  docSource: '## 源会话',
  srcTool: '工具',
  srcId: '会话 ID',
  srcTitle: '标题',
  srcModel: '模型',
  srcPermission: '权限',
  srcTurns: '轮数',
  srcHasSummary: '（另有一段更早的压缩摘要）',
  srcResume: '用户切回原会话',
  unknown: '未知',
  paren: x => `（${x}）`,
  sep: '：',
  docSnapshot: '## 环境快照',
  docSummary: '## 更早的上下文（源会话自己的压缩摘要）',
  docOld: cut => `## 更早的轮次（${cut === 1 ? '第 1 轮' : `第 1–${cut} 轮`}，已压缩）`,
  docRecent: (a, b) => `## 最近的轮次（${a === b ? `第 ${b} 轮` : `第 ${a}–${b} 轮`}，详细）`,
  docInterrupted: '## ⚠️ 注意\n\n最后一轮没有助手的文字回复。原 agent 很可能是在执行中途被中断的（额度耗尽、限流或卡死），最后那个动作不一定完成了，先核实再继续。',
};

const en = {
  usage: `hop — hand off a task between Codex and Claude Code without losing context

Usage:
  hop cc      [options] [-- args passed to claude]   Codex → Claude Code
  hop codex   [options] [-- args passed to codex]    Claude Code → Codex

Options:
  --latest          ignore the current directory, take the source tool's latest session
  --session <id>    pick the source session (session ID or jsonl path)
  --list            list candidate source sessions and exit
  --dry-run         write the handoff document only, don't launch
  --here            launch in the current terminal (default: new iTerm tab)
  --days <n>        how far back to look, default 14 days
  --budget <KB>     handoff document size cap, default 48

Inside a stuck Claude Code session, just type: ! hop codex
Env: HOP_TERMINAL=iterm|terminal  HOP_CLAUDE_BIN  HOP_CODEX_BIN  HOP_DIR  HOP_LANG=zh|en`,
  badArg: a => `unknown argument: ${a}`,
  ago: m => m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`,
  badTarget: x => `target must be cc or codex, got: ${x}`,
  sessionNotFound: (tool, id) => `${tool} session not found: ${id}`,
  scopeGiven: 'given',
  scopeCwd: dir => `current dir ${dir}`,
  scopeGlobal: 'global',
  noCwdSessions: tool => `No ${tool} session in this directory, falling back to the latest one.`,
  listHeader: (tool, scope) => `${tool} candidate sessions (${scope}, newest first):`,
  noSessions: (days, tool) => `no interactive ${tool} session in the last ${days} days`,
  busyWarn: n => `⚠️ ${n} sessions were active in the last 10 minutes; taking the newest. If that's wrong, use --list and --session <id>:`,
  emptySession: file => `session is empty: ${file}`,
  outSource: (tool, id, scope, title) => `Source    ${tool} ${id} (${scope})${title ? ` — ${title}` : ''}`,
  outCwd: (cwd, branch) => `Workdir   ${cwd}${branch ? `  [${branch}]` : ''}`,
  outHandoff: (file, turns, kb) => `Handoff   ${file} (${turns} turns, ${kb} KB)`,
  outResume: cmd => `Go back   ${cmd}`,
  launched: (term, tool) => `Started ${tool} in a new ${term} tab`,

  sessionName: (task, from) => `${task} (from ${from})`,
  prompt: (file, task) => `${task ? `Task handoff "${task}": ` : ''}Read ${file} and take over this task: following "Notes for the receiving agent" in that file, first restate the current state in 5 lines or fewer, then wait for my confirmation before continuing.`,
  scriptComment: 'launch script generated by hop',
  dirMissing: dir => `hop: directory does not exist ${dir}`,
  osaFail: err => `osascript failed: ${err}`,
  badTerminal: term => `unsupported HOP_TERMINAL=${term} (use iterm or terminal)`,

  listening: (cmd, pid, ports, cwd) => `${cmd} (pid ${pid}) listening on :${ports.join(', :')}  cwd=${cwd}`,
  truncated: n => `…[truncated, ${n} chars total]`,
  image: '[image]',
  unknownFiles: '(unrecognized files)',

  timeLocale: 'en-US',
  snapGone: cwd => `- ⚠️ Working directory \`${cwd}\` no longer exists (the worktree may have been removed). Ask the user where to continue first.`,
  snapCwd: cwd => `- Working directory: \`${cwd}\``,
  snapTop: top => `- Repo root: \`${top}\``,
  snapBranch: (branch, upstream, ab) => `- Branch: \`${branch}\`${upstream ? ` (tracking \`${upstream}\`, ahead/behind ${ab})` : ' (no upstream)'}`,
  snapStatus: 'Uncommitted changes (`git status --short`):',
  snapClean: '(working tree clean)',
  snapDiff: 'Change size (`git diff HEAD --stat`):',
  snapLog: 'Recent commits:',
  snapWorktrees: 'Worktrees:',
  snapNotGit: '- Not a git repository',
  snapListeners: 'Processes still listening on ports in this directory (likely dev servers started by the previous agent; don\'t start them again):',
  snapNoListeners: 'No process is listening on a port in this directory.',

  turnHead: (n, time) => `### Turn ${n}${time ? ` · ${time}` : ''}`,
  userLabel: '**User:**',
  userNone: '**User:** (no new user message here; continues the previous turn)',
  interjections: '**User interjections mid-turn (high priority, often corrections):**',
  reasoning: '**Source agent\'s reasoning (plaintext parts):**',
  tools: n => `**Tool calls (${n}):**`,
  toolsOmitted: n => `- …first ${n} calls omitted (grep the raw log if needed)`,
  emptyOutput: '(empty output)',
  reply: '**Reply:**',
  oldCont: '(continues the previous turn)',
  oldInterjection: 'Interjection: ',
  oldToolsMore: n => `   - …${n} tool calls in total`,
  oldToolsCount: n => `   - (${n} tool calls)`,
  oldReply: 'Reply: ',

  docTitle: (from, dest) => `# Task handoff: ${from} → ${dest}`,
  docIntro: (time, from) => `> Generated ${time} by hop, mechanically extracted from the ${from} session log. The previous agent's full reasoning is encrypted and can't be carried over; below are only the conversation, tool calls, and plaintext reasoning snippets.`,
  docGuide: (from, file) => `## Notes for the receiving agent

1. The user was doing this task in ${from}. ${from} is unavailable or the user wants to switch tools, so it's handed to you. **This file is your context.**
2. Read the whole file, then restate in 5 lines or fewer: **goal / done / where it stopped / next step**. Wait for the user to confirm before doing anything.
3. If this file lacks detail, grep the raw session log by keyword: \`${file}\` (JSONL, possibly large; don't read it whole).
4. Uncommitted changes in the working tree are the previous agent's work in progress. **Do not reset, checkout, or discard them.**
5. Constraints set earlier and approaches the user rejected still apply. They are scattered through the user messages below; list them in your recap.`,
  docSource: '## Source session',
  srcTool: 'Tool',
  srcId: 'Session ID',
  srcTitle: 'Title',
  srcModel: 'Model',
  srcPermission: 'Permissions',
  srcTurns: 'Turns',
  srcHasSummary: ' (plus an earlier compacted summary)',
  srcResume: 'User goes back with',
  unknown: 'unknown',
  paren: x => ` (${x})`,
  sep: ': ',
  docSnapshot: '## Environment snapshot',
  docSummary: '## Earlier context (the source session\'s own compacted summary)',
  docOld: cut => `## Earlier turns (${cut === 1 ? 'turn 1' : `turns 1–${cut}`}, compressed)`,
  docRecent: (a, b) => `## Recent turns (${a === b ? `turn ${b}` : `turns ${a}–${b}`}, detailed)`,
  docInterrupted: '## ⚠️ Note\n\nThe last turn has no text reply from the assistant. The previous agent was most likely interrupted mid-run (out of quota, rate-limited, or stuck), so its last action may not have completed. Verify before continuing.',
};

export const MESSAGES = { zh, en };
export const LANG = detectLang();
export const M = MESSAGES[LANG];
