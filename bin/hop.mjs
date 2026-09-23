#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { HOP_DIR, gitTop, realpath } from '../lib/util.mjs';
import { findCodexSessions, codexFileById, parseCodex } from '../lib/codex.mjs';
import { findClaudeSessions, claudeFileById, parseClaude } from '../lib/claude.mjs';
import { snapshot } from '../lib/snapshot.mjs';
import { renderHandoff, TOOL_NAMES, resumeCmd } from '../lib/render.mjs';
import { M } from '../lib/i18n.mjs';
import { buildScript, writeScript, openTab, runHere } from '../lib/launch.mjs';


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
    else throw new Error(M.badArg(a));
  }
  return o;
}

const ago = ms => M.ago(Math.round((Date.now() - ms) / 60000));

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || !o.to) { console.log(M.usage); return; }
  const to = { cc: 'claude', claude: 'claude', codex: 'codex', cx: 'codex' }[o.to];
  if (!to) throw new Error(M.badTarget(o.to));
  const from = to === 'claude' ? 'codex' : 'claude';
  const find = from === 'codex' ? findCodexSessions : findClaudeSessions;

  const here = process.cwd();
  const top = gitTop(here);
  const target = realpath(top || here);

  let file, scope;
  if (o.session) {
    file = from === 'codex' ? codexFileById(o.session) : claudeFileById(o.session);
    if (!file) throw new Error(M.sessionNotFound(TOOL_NAMES[from], o.session));
    scope = M.scopeGiven;
  } else {
    let cands = o.latest ? [] : find({ target, targetIsRepo: !!top, days: o.days });
    scope = M.scopeCwd(target);
    if (!cands.length) {
      if (!o.latest && !o.list) console.error(M.noCwdSessions(TOOL_NAMES[from]));
      cands = find({ target, targetIsRepo: !!top, days: o.days, any: true });
      scope = M.scopeGlobal;
    }
    if (o.list) {
      console.log(M.listHeader(TOOL_NAMES[from], scope));
      for (const c of cands.slice(0, 15)) console.log(`  ${ago(c.mtime).padEnd(8)} ${c.id}  ${c.cwd}`);
      return;
    }
    if (!cands.length) throw new Error(M.noSessions(o.days, TOOL_NAMES[from]));
    file = cands[0].file;
    // 同一目录常有多个并行会话，最近改动的那个不一定是用户想切的
    const busy = cands.filter(c => cands[0].mtime - c.mtime < 10 * 60000);
    if (busy.length > 1) {
      console.error(M.busyWarn(busy.length));
      for (const c of busy.slice(0, 5)) console.error(`   ${ago(c.mtime).padEnd(8)} ${c.id}  ${c.cwd}`);
    }
  }

  const session = from === 'codex' ? parseCodex(file) : parseClaude(file);
  if (!session.turns.length && !session.summary) throw new Error(M.emptySession(file));
  const cwd = session.cwd || here;
  const snap = snapshot(cwd);
  const doc = renderHandoff({ session, snap, to, budget: o.budget * 1024 });

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const dir = path.join(HOP_DIR, 'handoffs');
  fs.mkdirSync(dir, { recursive: true });
  const handoff = path.join(dir, `${stamp}-${from}-to-${to}.md`);
  fs.writeFileSync(handoff, doc);
  fs.appendFileSync(path.join(HOP_DIR, 'links.jsonl'), JSON.stringify({ ts: Date.now(), from, fromId: session.id, to, cwd, handoff }) + '\n');

  console.log(M.outSource(TOOL_NAMES[from], session.id, scope, session.title));
  console.log(M.outCwd(cwd, snap.git?.branch));
  console.log(M.outHandoff(handoff, session.turns.length, (Buffer.byteLength(doc) / 1024).toFixed(1)));
  console.log(M.outResume(resumeCmd(session)));
  if (o.dryRun) return;

  const script = writeScript(buildScript({ to, cwd, handoff, extra: o.extra }));
  if (o.here) runHere(script);
  const term = openTab(script);
  console.log(M.launched(term, TOOL_NAMES[to]));
}

try { main(); } catch (e) { console.error(`hop: ${e.message}`); process.exit(1); }
