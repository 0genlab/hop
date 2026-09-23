import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCodex } from '../lib/codex.mjs';
import { parseClaude } from '../lib/claude.mjs';
import { renderHandoff } from '../lib/render.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hop-test-'));
const write = (name, recs) => {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, recs.map(r => JSON.stringify(r)).join('\n') + '\n');
  return f;
};

test('codex：过滤系统注入、配对工具输出、保留明文思考', () => {
  const f = write('rollout.jsonl', [
    { type: 'session_meta', payload: { id: 'cx1', cwd: '/repo', source: 'cli', originator: 'codex-tui' } },
    { type: 'turn_context', payload: { cwd: '/repo/wt', model: 'gpt-x', sandbox_policy: { type: 'workspace-write' }, approval_policy: 'on-request' } },
    { type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'sys' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\n<cwd>/repo</cwd>\n</environment_context>' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for /repo\n...' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '修一下登录 bug' }] }, timestamp: '2026-09-23T10:00:00Z' },
    { type: 'response_item', payload: { type: 'reasoning', summary: [], content: [{ type: 'reasoning_text', text: '先看 auth.js' }], encrypted_content: 'x' } },
    { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"rg login","workdir":"/repo"}', call_id: 'c1' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: 'Chunk ID: a\nProcess exited with code 1\nOutput:\nno match' } },
    { type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Update File: src/auth.js\n@@\n*** End Patch', call_id: 'c2' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '改好了' }] } },
  ]);
  const s = parseCodex(f);
  assert.equal(s.id, 'cx1');
  assert.equal(s.cwd, '/repo/wt', 'cwd 取最新 turn_context');
  assert.equal(s.turns.length, 1);
  const t = s.turns[0];
  assert.equal(t.user, '修一下登录 bug');
  assert.deepEqual(t.reasoning, ['先看 auth.js']);
  assert.equal(t.tools[0].brief, '$ rg login   (in /repo)');
  assert.equal(t.tools[0].output, '[exit 1]\nno match');
  assert.equal(t.tools[1].brief, 'apply_patch: Update src/auth.js');
  assert.deepEqual(t.assistant, ['改好了']);
});

test('claude：沿 parentUuid 取当前分支、还原斜杠命令、跳过噪音', () => {
  const base = { cwd: '/repo', entrypoint: 'cli', isSidechain: false };
  const f = write('s1.jsonl', [
    { type: 'ai-title', aiTitle: '登录修复' },
    { ...base, type: 'user', uuid: 'u1', parentUuid: null, message: { role: 'user', content: '<command-name>/review</command-name><command-args>42</command-args>' } },
    { ...base, type: 'user', uuid: 'u2', parentUuid: 'u1', message: { role: 'user', content: '<task-notification>done</task-notification>' } },
    { ...base, type: 'assistant', uuid: 'a1', parentUuid: 'u2', message: { model: 'claude-x', content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git diff' } }] } },
    { ...base, type: 'user', uuid: 'u3', parentUuid: 'a1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'diff...' }] } },
    // 被 rewind 掉的分支
    { ...base, type: 'assistant', uuid: 'x1', parentUuid: 'u3', message: { content: [{ type: 'text', text: '废弃分支' }] } },
    { ...base, type: 'assistant', uuid: 'a2', parentUuid: 'u3', message: { content: [{ type: 'text', text: '看完了' }] } },
    { ...base, type: 'attachment', uuid: 'q1', parentUuid: 'a2', attachment: { type: 'queued_command', prompt: '放独立项目', origin: { kind: 'human' } } },
    { ...base, type: 'user', uuid: 'u4', parentUuid: 'q1', message: { role: 'user', content: '继续<system-reminder>ignore</system-reminder>' } },
    { ...base, type: 'user', uuid: 'sc', parentUuid: 'u4', isSidechain: true, message: { role: 'user', content: '子 agent' } },
  ]);
  const s = parseClaude(f);
  assert.equal(s.title, '登录修复');
  assert.equal(s.model, 'claude-x');
  assert.deepEqual(s.turns.map(t => t.user), ['/review 42', '继续']);
  assert.equal(s.turns[0].tools[0].brief, '$ git diff');
  assert.equal(s.turns[0].tools[0].output, 'diff...');
  assert.deepEqual(s.turns[0].assistant, ['看完了']);
  assert.deepEqual(s.turns[0].reasoning, [], '空 thinking 不收');
  assert.deepEqual(s.turns[0].interjections, ['放独立项目']);
});

test('render：超预算时逐档压缩', () => {
  const big = 'x'.repeat(5000);
  const turns = Array.from({ length: 30 }, (_, i) => ({
    user: `第${i}轮 ${big}`, ts: null, reasoning: [], assistant: [big],
    tools: Array.from({ length: 50 }, () => ({ name: 'Bash', brief: '$ ls', output: big })),
  }));
  const session = { tool: 'codex', id: 'x', file: '/f', turns };
  const snap = { cwd: '/repo', exists: true, git: null, listeners: [] };
  const doc = renderHandoff({ session, snap, to: 'claude', budget: 48 * 1024 });
  assert.ok(Buffer.byteLength(doc) <= 48 * 1024, `实际 ${Buffer.byteLength(doc)}`);
  assert.match(doc, /第29轮/, '最后一轮一定在');
});
