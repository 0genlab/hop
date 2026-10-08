// 仍未解决的失败：同一条命令（命令文本 + 目录）最后一次运行的退出码非 0。
// 后来又跑通了的不算；搜索/比较类命令返回 1 只表示「没找到 / 有差异」，也不算。
// 真实会话里大部分失败是探索性的一次性命令（agent 换个写法就过去了），所以只收两类：
// 测试/构建/检查命令（任意轮次），以及最后一轮里的任何失败（agent 停下时手上的问题）。

const QUIET = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'diff', 'cmp', 'test', '[', 'which', 'pgrep', 'command']);
const TEST = /\b(pytest|jest|vitest|mocha|unittest|go test|cargo test|node --test|make test|(npm|pnpm|yarn|bun)( run)? test)\b/;
const CHECK = /\b(tsc|eslint|ruff|mypy|go (build|vet)|cargo (build|check|clippy)|(npm|pnpm|yarn|bun) run (build|lint|typecheck|check)|make)\b/;

// 管道 / && / ; 串起来的命令，退出码来自最后一段
function lastWord(brief) {
  const cmd = brief.replace(/^\$ /, '').replace(/ {3}\(in .*\)$/, '');
  const seg = cmd.split(/\|\||&&|;|\|/).at(-1).trim();
  return seg.split(/\s+/).find(w => !/^\w+=/.test(w)) || '';
}

const tail = (s, lines) => s.split('\n').slice(-lines).join('\n');

export function openFailures(turns, max = 5) {
  const last = new Map();
  let final = null;
  turns.forEach((t, i) => t.tools.forEach(x => {
    if (!x.shell) return;
    const key = `${x.cwd || ''}\0${x.brief}`;
    last.delete(key);
    final = { ...x, turn: i + 1, ts: t.ts };
    last.set(key, final);
  }));
  const res = [];
  for (const f of last.values()) {
    if (f.turn !== turns.length && !TEST.test(f.brief) && !CHECK.test(f.brief)) continue;
    // 整个会话最后一次调用没有输出 = 执行中被中断，结果未知
    const pending = f === final && f.output == null;
    if (!pending && !(f.exit > 0)) continue;
    if (f.exit === 1 && QUIET.has(lastWord(f.brief))) continue;
    // 去掉解析时加的 [error] / [exit N] 前缀，只留正文末尾
    const out = f.output == null ? '' : tail(f.output.replace(/^\[(error|exit \d+)\]\n/, '').replace(/^Exit code \d+\n/, '').trimEnd(), 20);
    res.push({ brief: f.brief, cwd: f.cwd, exit: f.exit, turn: f.turn, ts: f.ts, pending, output: out, test: TEST.test(f.brief) });
  }
  // 测试命令排前面，其余按时间倒序
  return res.reverse().sort((a, b) => b.test - a.test).slice(0, max);
}
