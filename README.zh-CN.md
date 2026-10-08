# hop

在 **Codex** 和 **Claude Code** 之间交接正在做的任务，不丢上下文。

```bash
hop cc       # Codex → Claude Code
hop codex    # Claude Code → Codex
```

一条命令：读取你刚才的会话，生成一份交接文档，然后开一个终端新标签页，在同一个目录（包括 worktree）里启动另一个 agent 接着做。

[English](README.md)

## 背景

Codex 做到一半，遇到限流、额度用完或者卡在死循环里，想换 Claude Code 接着做（反过来也一样）。

手动换很麻烦：要重新讲一遍目标，贴最近几条对话，告诉新 agent 现在在哪个分支、哪个 worktree，改了哪些文件，哪些路已经试过不通，dev server 是不是已经起着。这些信息其实都在两个工具的本地会话记录里，`hop` 负责把它们收拢起来。

而且通常是**当前 agent 已经用不了**才要换，限流中的 agent 没法自己写交接说明。所以 `hop` 完全不依赖源 agent，它是一个直接读会话文件的普通命令行工具。在卡住的 Claude Code 会话里直接敲：

```
! hop codex
```

`!` 前缀直接执行 shell 命令，不经过模型，额度用完也能用。

## 环境要求

- macOS，装有 iTerm2 或系统自带的 Terminal（只有开新标签页时需要；`--here` 和 `--dry-run` 在哪都能用）
- Node.js ≥ 20
- 已安装 [Codex CLI](https://github.com/openai/codex) 和/或 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)，并且在 `PATH` 里

没有任何 npm 依赖。

## 安装

```bash
git clone https://github.com/0genlab/hop.git ~/code/hop
ln -s ~/code/hop/bin/hop.mjs ~/.local/bin/hop   # 换成你 PATH 里的任意目录
hop --help
```

也可以用 npm 全局安装：

```bash
npm install -g github:0genlab/hop
```

## 使用手册

### 切换

在你刚才干活的项目目录里执行：

```bash
hop cc        # 在 Claude Code 里接着做这个目录最近的 Codex 会话
hop codex     # 在 Codex 里接着做这个目录最近的 Claude Code 会话
```

`hop` 会先打印它选中了什么：

```
源会话   Codex 019a…（当前目录）
工作目录 /Users/you/code/app/.worktrees/fix-login  [fix-login]
交接文档 ~/.hop/handoffs/20260923-101500-codex-to-claude.md（12 轮，31.8 KB）
切回原会话 codex resume 019a…
```

然后开新标签页启动目标 agent，首条指令是：

> 任务「<任务名>」交接：读 `<交接文档>` 接手这个任务：先按文件里「给接手 agent 的说明」用 5 行以内复述当前状态，等我确认后再继续。

任务名取源会话的标题（Claude Code 里 `/rename` 起的名字优先于自动标题；Codex 取会话名 thread name），没有标题就用第一句用户输入。Claude Code 会带 `--name "<任务名>（接自 Codex）"` 启动；Codex 没有给会话命名的参数，任务名只能通过 prompt 传过去，它自动起名时一般会沿用。

**先核对它的复述，再让它继续。**

### 指定会话

`hop` 按当前目录匹配会话，以 git 根目录为准，所以在仓库任意子目录里开的会话都算。如果最近 10 分钟有多个活跃会话，它会给出警告，这时手动指定：

```bash
hop cc --list                  # 列出候选源会话
hop cc --session 019a1b2c-…    # 按会话 ID 指定，也可以直接给 .jsonl 路径
hop cc --latest                # 不看当前目录，取全局最新的会话
```

当前目录下一个会话都没有时，自动退回到全局最新的会话。

### 全部选项

| 选项 | 作用 |
|---|---|
| `--list` | 列出候选源会话后退出 |
| `--session <id>` | 指定源会话（ID 或 `.jsonl` 路径） |
| `--latest` | 忽略当前目录，取全局最新的会话 |
| `--dry-run` | 只生成交接文档，不启动 |
| `--here` | 在当前终端启动，不开新标签页 |
| `--days <n>` | 往前查找的天数，默认 14 |
| `--budget <KB>` | 交接文档大小上限，默认 48 |
| `-- <参数>` | 后面的参数原样传给目标 CLI，比如 `hop cc -- --model opus` |

### 环境变量

| 变量 | 默认值 | 含义 |
|---|---|---|
| `HOP_TERMINAL` | 装了 iTerm 就用 `iterm`，否则 `terminal` | `iterm` 或 `terminal` |
| `HOP_CLAUDE_BIN` | `claude` | Claude Code 可执行文件 |
| `HOP_CODEX_BIN` | `codex` | Codex 可执行文件 |
| `HOP_DIR` | `~/.hop` | 交接文档、启动脚本、切换记录的存放目录 |
| `HOP_LANG` | 跟随 `LC_ALL` / `LC_MESSAGES` / `LANG` | `zh` 或 `en`：CLI 输出、交接文档和启动提示词的语言 |
| `CODEX_HOME` | `~/.codex` | 查找 Codex 会话时会读取 |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | 查找 Claude Code 会话时会读取 |

### 切回原会话

原会话不会被改动。`hop` 会打印它的 resume 命令（`codex resume <id>` / `claude --resume <id>`）。每次切换都会追加一行到 `~/.hop/links.jsonl`，可以查到哪个会话接的是哪个会话。

## 交接文档里有什么

- **给接手 agent 的说明**：先复述再等确认；需要细节时 grep 原始记录；不要 reset 未提交的改动；之前定下的约束继续有效。
- **未解决的失败**：源会话里最后一次运行仍失败（退出码非 0，或执行到一半被打断）的 shell 命令，附退出码、轮次、时间、目录和输出末尾。只收测试/构建/检查类命令，以及最后一轮里的失败；后来跑通的、grep/diff 这类返回 1 的都排除。新 agent 会被要求先重跑：还失败就是要接着修的问题，已通过说明这条过期了。这一节不参与压缩。
- **源会话信息**：工具、会话 ID、模型、权限/沙箱模式，以及原始 JSONL 记录的路径。
- **环境快照**：工作目录、分支、HEAD、和上游的 ahead/behind、`git status`、diff 统计、最近的提交、worktree 列表、stash，以及工作目录在项目内、正在监听 TCP 端口的进程（避免新 agent 重复起 dev server）。
- **对话**：你的指令、做到一半时插的话（通常是纠偏，会单独标出）、助手的回复、工具调用和截断后的输出，有明文思考的话也会带上。会话被压缩过的话，压缩摘要也会一起带上。

文档不会超过大小上限：最近几轮保留完整细节，更早的轮次逐档压缩，最后压成一行摘要。最后一轮一定会保留。

worktree 和未提交的改动不需要搬，它们本来就在磁盘上，新 agent 在同一个目录启动就都在。

## 带不过来的

- **完整思考过程**：Codex 用 OpenAI 模型时，reasoning 是加密存储的，只有一句简短的 summary 标题。Claude Code 的 thinking 在本地记录里通常只有签名，正文是空的。Codex 走第三方 provider 时有明文思考，会一起带过来。
- **正在运行的进程**：dev server、watcher 这些没法搬，文档里会列出来告诉新 agent。
- **shell 状态**：会话里 `export` 的变量、激活的虚拟环境等。
- **非交互会话**：`codex exec`、`claude -p` / SDK 会话和各类 subagent 会话，查找源会话时会故意跳过。

## 原理

1. **找源会话**
   - Codex：`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`，只认 `source` 为 `cli`（TUI）或 `vscode`（桌面端）的会话。
   - Claude Code：`~/.claude/projects/<slug>/<id>.jsonl`，只认 `entrypoint: cli` 的会话。启动目录和最新目录都会拿来匹配，因为 agent `cd` 或进 worktree 之后 cwd 会变。
2. **解析会话记录**
   - Codex：把 `response_item` 记录按轮次分组；丢掉 Codex 注入到 user 角色里的内容（`<environment_context>`、AGENTS.md 等）；按 `call_id` 把工具调用和输出配对；遇到 `compacted` 就用压缩摘要替换之前的历史。
   - Claude Code：从最新一条非 sidechain（子 agent）消息开始，沿 `parentUuid` 往回走，rewind 掉的分支不会带上；还原斜杠命令，过滤 system reminder 和各种通知。
3. **拍环境快照**：用 `git` 和 `lsof`。
4. **生成交接文档**：写到 `~/.hop/handoffs/`，按 6 档细节逐档压缩，直到不超过上限。
5. **启动**：生成一个小脚本放到 `~/.hop/run/`，用 AppleScript 在 iTerm2 或 Terminal 新标签页里执行。

两个工具的会话格式都是私有的，没有公开文档，随时可能在某个版本里变掉。升级后解析出错，先看 `lib/codex.mjs` 和 `lib/claude.mjs`。

## 常见问题

- **选错了会话**：先 `hop cc --list`，再用 `--session <id>` 指定。
- **提示找不到会话**：试试 `--latest` 或 `--days 60`，再确认 `CODEX_HOME` / `CLAUDE_CONFIG_DIR` 指向的是你会话实际存放的位置。
- **没有开出新标签页**：可能是 macOS 拦了自动化权限。到「系统设置 → 隐私与安全性 → 自动化」里允许你的终端，或者改用 `--here`。
- **启动目录不对**：`hop` 给 Codex 传 `-C <cwd>`，给 Claude Code 是先 `cd` 进去再启动。看输出里的「工作目录」那一行，它取的是会话最新的 cwd。

## 开发

```bash
npm test
```

```
bin/hop.mjs        命令行入口
lib/codex.mjs      Codex 会话查找与解析
lib/claude.mjs     Claude Code 会话查找与解析
lib/snapshot.mjs   git / 监听端口快照
lib/render.mjs     交接文档渲染与大小控制
lib/launch.mjs     启动脚本与终端标签页
```

## 路线图

- 会话内命令：源 agent 还能用的时候，让它自己写一份更完整的交接说明
- 切回时恢复原会话，并附上这段时间的增量交接
- 支持 Linux 终端

## 许可证

MIT
