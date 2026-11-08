#!/usr/bin/env node
'use strict';

/**
 * PreToolUse(mcp__supabase__execute_sql) 훅. 조회는 그대로 통과시키고, 데이터를 고치거나 지우거나 구조, 권한을 바꾸는 SQL만 승인 창을 띄운다.
 * INSERT는 묻지 않는다(데이터를 더하기만 해 기존 행을 잃지 않는다). 주석과 문자열 안의 낱말은 보지 않는다.
 * SQL을 읽지 못하면 묻는다. 물을 때마다 승인 창 기록(ask-log.js의 logAsk)에 한 줄을 남긴다.
 */

const fs = require('node:fs');
const { word } = require('./guardShared.cjs');
const { logAsk } = require('./ask-log.js');

const WRITE_WORDS = new RegExp(word('(update|delete|drop|alter|truncate|create|grant|revoke)'), 'giu');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const stripNoise = (sql) => sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/'(?:[^']|'')*'/g, "''");

function ask(reason, data) {
  logAsk(data, 'supabase-sql-guard', reason);
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } })}\n`);
}

let data;
let query;
try {
  data = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (!isObj(data) || !isObj(data.tool_input) || !Object.hasOwn(data.tool_input, 'query')) throw new Error('query 없음');
  query = data.tool_input.query;
} catch {
  ask('SQL 내용을 읽지 못해 확인을 요청합니다.', {});
  process.exit(0);
}
if (typeof query === 'string') {
  const found = [...new Set([...stripNoise(query).matchAll(WRITE_WORDS)].map((m) => m[1].toLowerCase()))].sort();
  if (found.length) ask(`운영 DB를 바꾸는 SQL입니다(${found.map((w) => w.toUpperCase()).join(', ')}).`, data);
}
process.exit(0);
