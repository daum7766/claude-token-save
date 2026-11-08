#!/usr/bin/env node
'use strict';

/**
 * 키트 스크립트 린트(키트 관리자용, 사용자 설치에는 깔리지 않는다).
 * 쓰는 법: node --expose-internals tools/kit-lint.cjs [--json] [파일이나 폴더…]   (인자가 없으면 subagent-system과 tools 전체)
 *
 * 왜: 설치 바닥 작업의 커밋 다섯 판에서 리뷰가 손으로 잡은 꼴(정의 안 된 이름, 안 쓰는 변수, 문법 오류, 없는 이름을 가져오는 import)을 기계가 먼저 잡게 한다.
 * 어떻게: Node에 들어 있는 acorn 파서를 --expose-internals로 빌려 쓴다. 내려받을 것이 없어 시험에 네트워크가 필요 없고, 설치할 것도 유지할 설정도 없다.
 *   ESLint를 쓰면 규칙이 더 풍부하지만 npm 설치(네트워크)와 node_modules, 설정 파일이 필요하고, 설치가 안 된 복제에서는 린트가 조용히 빠진다.
 * 전제:
 *  - Node 내부 경로(internal/deps/acorn)에 기댄다. 경로가 바뀌어 파서를 못 찾으면 종료 코드 3으로 이유를 알리고, 시험은 그때 건너뛰기로 표시한다(조용히 통과하지 않음).
 *  - 규칙 심각도는 아래 RULES가 정한다. 새 규칙은 warn으로 들이고, 한동안 잡은 수와 오탐 수가 0에 가까우면 error로 올린다. 문법 오류만 처음부터 error다.
 *  - 오탐은 그 줄이나 바로 윗줄에 `// kit-lint-ignore <규칙>: <까닭>`을 달아 가린다. 가린 수는 요약에 따로 나와 오탐 비율을 볼 수 있다.
 *  - 이 도구는 완전한 스코프 분석이 아니다. with, eval, 동적으로 이름을 만드는 코드는 보지 않는다. 모르는 꼴은 경고를 내지 않는 쪽으로 둔다.
 */

const fs = require('node:fs');
const path = require('node:path');

let acorn;
try {
  acorn = require('internal/deps/acorn/acorn/dist/acorn');
} catch {
  process.stderr.write('Node 내부 acorn을 못 찾았습니다. node --expose-internals로 돌리고, 그래도 안 되면 이 Node 판에서는 린트를 쓸 수 없습니다.\n');
  process.exit(3);
}

const RULES = {
  syntax: 'error',
  'no-undef': 'warn',
  'no-unused-vars': 'warn',
  'import-missing-export': 'warn',
};

const ES_GLOBALS = [
  'Object', 'Function', 'Array', 'Number', 'String', 'Boolean', 'Symbol', 'BigInt', 'Math', 'JSON', 'Date', 'RegExp', 'Error', 'EvalError', 'RangeError', 'ReferenceError',
  'SyntaxError', 'TypeError', 'URIError', 'AggregateError', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry', 'Proxy', 'Reflect', 'Intl', 'Atomics',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array',
  'Float64Array', 'BigInt64Array', 'BigUint64Array', 'Iterator', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'escape', 'unescape', 'eval', 'undefined', 'NaN', 'Infinity', 'globalThis',
];
const NODE_GLOBALS = [
  'process', 'console', 'Buffer', 'global', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'structuredClone',
  'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal', 'fetch', 'Headers', 'Request', 'Response', 'FormData', 'Blob', 'performance',
  'atob', 'btoa', 'Event', 'EventTarget', 'BroadcastChannel', 'MessageChannel', 'MessagePort', 'WebAssembly', 'crypto',
];
const CJS_GLOBALS = ['require', 'module', 'exports', '__dirname', '__filename'];
const BUILTIN = new Set([...ES_GLOBALS, ...NODE_GLOBALS]);

// 파일이 ESM인지: 확장자 .mjs는 ESM, .cjs는 CJS, .js는 가까운 package.json의 type을 따른다(없으면 CJS).
const typeCache = new Map();
function moduleKind(file) {
  if (file.endsWith('.mjs')) return 'module';
  if (file.endsWith('.cjs')) return 'script';
  let dir = path.dirname(path.resolve(file));
  for (;;) {
    if (typeCache.has(dir)) return typeCache.get(dir);
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      let kind = 'script';
      try {
        kind = JSON.parse(fs.readFileSync(pkg, 'utf8')).type === 'module' ? 'module' : 'script';
      } catch {
        // 깨진 package.json은 CJS로 본다.
      }
      typeCache.set(dir, kind);
      return kind;
    }
    const up = path.dirname(dir);
    if (up === dir) return 'script';
    dir = up;
  }
}

// ---- 스코프 분석 ----

class Scope {
  constructor(kind, parent) {
    this.kind = kind; // 'function' | 'block' | 'module'
    this.parent = parent;
    this.vars = new Map();
  }

  declare(name, info) {
    const prev = this.vars.get(name);
    if (prev) {
      // var와 함수 선언의 다시 선언은 같은 변수다.
      if (prev.reads === 0 && info.reads) prev.reads += info.reads;
      return prev;
    }
    const v = { name, reads: 0, writes: 0, ...info };
    this.vars.set(name, v);
    return v;
  }

  lookup(name) {
    for (let s = this; s; s = s.parent) {
      const v = s.vars.get(name);
      if (v) return v;
    }
    return null;
  }
}

const SKIP_KEYS = new Set(['type', 'start', 'end', 'loc', 'range', 'sourceType']);
const isNode = (x) => x && typeof x === 'object' && typeof x.type === 'string';
const children = (node) => {
  const out = [];
  for (const [k, v] of Object.entries(node)) {
    if (SKIP_KEYS.has(k)) continue;
    if (Array.isArray(v)) out.push(...v.filter(isNode));
    else if (isNode(v)) out.push(v);
  }
  return out;
};

function patternNames(pattern, out = []) {
  if (!pattern) return out;
  switch (pattern.type) {
    case 'Identifier':
      out.push(pattern);
      break;
    case 'ObjectPattern':
      for (const p of pattern.properties) patternNames(p.type === 'RestElement' ? p.argument : p.value, out);
      break;
    case 'ArrayPattern':
      for (const e of pattern.elements) patternNames(e, out);
      break;
    case 'AssignmentPattern':
      patternNames(pattern.left, out);
      break;
    case 'RestElement':
      patternNames(pattern.argument, out);
      break;
    default:
      break;
  }
  return out;
}

// `const { 뺄키, ...나머지 } = 객체`의 뺄키처럼 나머지(rest)를 만들려고 일부러 꺼내 버리는 이름. 안 쓰는 변수로 세지 않는다(오탐을 좁힌 규칙).
function restSiblings(pattern, out = new Set()) {
  if (!pattern) return out;
  if (pattern.type === 'ObjectPattern') {
    const hasRest = pattern.properties.some((p) => p.type === 'RestElement');
    for (const p of pattern.properties) {
      if (p.type === 'RestElement') continue;
      if (hasRest) for (const id of patternNames(p.value)) out.add(id);
      else restSiblings(p.value, out);
    }
  } else if (pattern.type === 'ArrayPattern') for (const e of pattern.elements) restSiblings(e, out);
  else if (pattern.type === 'AssignmentPattern') restSiblings(pattern.left, out);
  return out;
}

// 이 범위 안에서 hoist되는 var 선언을 모은다(중첩 함수 안은 보지 않는다).
function collectVars(node, out = []) {
  if (!isNode(node)) return out;
  if (node.type === 'VariableDeclaration' && node.kind === 'var') {
    for (const d of node.declarations) patternNames(d.id, out);
  }
  if (/^(Function|Arrow)/.test(node.type) || node.type === 'ClassBody') return out;
  for (const c of children(node)) {
    if (/^Function(Declaration|Expression)$/.test(c.type) || c.type === 'ArrowFunctionExpression') continue;
    collectVars(c, out);
  }
  return out;
}

function analyze(ast, { sourceType, filename }) {
  const undef = [];
  const unusedCandidates = [];
  const importedBindings = [];
  const exportNames = new Set();
  let exportsUnknown = false;

  const root = new Scope('module', null);
  if (sourceType === 'script') for (const g of CJS_GLOBALS) root.declare(g, { kind: 'global', reads: 1 });

  const addDecl = (scope, id, kind, node) => {
    const v = scope.declare(id.name, { kind, node: id });
    if (!v.listed && ['const', 'let', 'var', 'function', 'class', 'import'].includes(kind)) {
      v.listed = true;
      unusedCandidates.push(v);
    }
    return v;
  };

  // 한 범위의 위쪽에서 let, const, class, 함수 선언(블록 안)과 import를 미리 선언한다.
  const hoistLexical = (scope, body) => {
    for (const st of body) {
      if (st.type === 'VariableDeclaration' && st.kind !== 'var') {
        for (const d of st.declarations) {
          const siblings = restSiblings(d.id);
          for (const id of patternNames(d.id)) addDecl(scope, id, st.kind, st).restSibling = siblings.has(id);
        }
      } else if (st.type === 'ClassDeclaration' && st.id) addDecl(scope, st.id, 'class', st);
      else if (st.type === 'FunctionDeclaration' && st.id) addDecl(scope, st.id, 'function', st);
      else if ((st.type === 'ExportNamedDeclaration' || st.type === 'ExportDefaultDeclaration') && st.declaration) {
        const d = st.declaration;
        if (d.type === 'VariableDeclaration' && d.kind !== 'var') for (const dd of d.declarations) for (const id of patternNames(dd.id)) addDecl(scope, id, d.kind, d).reads += 1;
        else if ((d.type === 'ClassDeclaration' || d.type === 'FunctionDeclaration') && d.id) addDecl(scope, d.id, d.type === 'ClassDeclaration' ? 'class' : 'function', d).reads += 1;
      } else if (st.type === 'ImportDeclaration') {
        for (const sp of st.specifiers) {
          const v = addDecl(scope, sp.local, 'import', sp);
          importedBindings.push({ v, decl: st, spec: sp });
        }
      }
    }
  };

  const ref = (scope, id, mode, parentType) => {
    const v = scope.lookup(id.name);
    if (v) {
      if (mode === 'write') v.writes += 1;
      else if (mode === 'readwrite') {
        v.reads += 1;
        v.writes += 1;
      } else v.reads += 1;
      return;
    }
    if (BUILTIN.has(id.name)) return;
    if (id.name === 'arguments') return;
    if (parentType === 'typeof') return;
    undef.push(id);
  };

  const visitPatternTargets = (scope, p, mode) => {
    if (!p) return;
    switch (p.type) {
      case 'Identifier':
        ref(scope, p, mode);
        break;
      case 'MemberExpression':
        visit(scope, p);
        break;
      case 'ObjectPattern':
        for (const prop of p.properties) {
          if (prop.type === 'RestElement') visitPatternTargets(scope, prop.argument, mode);
          else {
            if (prop.computed) visit(scope, prop.key);
            visitPatternTargets(scope, prop.value, mode);
          }
        }
        break;
      case 'ArrayPattern':
        for (const e of p.elements) visitPatternTargets(scope, e, mode);
        break;
      case 'AssignmentPattern':
        visitPatternTargets(scope, p.left, mode);
        visit(scope, p.right);
        break;
      case 'RestElement':
        visitPatternTargets(scope, p.argument, mode);
        break;
      default:
        visit(scope, p);
    }
  };

  // 선언 패턴 안의 기본값과 계산된 키는 식이라 방문한다(이름 자체는 이미 선언됨).
  const visitDeclPattern = (scope, p) => {
    if (!p) return;
    switch (p.type) {
      case 'ObjectPattern':
        for (const prop of p.properties) {
          if (prop.type === 'RestElement') visitDeclPattern(scope, prop.argument);
          else {
            if (prop.computed) visit(scope, prop.key);
            visitDeclPattern(scope, prop.value);
          }
        }
        break;
      case 'ArrayPattern':
        for (const e of p.elements) visitDeclPattern(scope, e);
        break;
      case 'AssignmentPattern':
        visitDeclPattern(scope, p.left);
        visit(scope, p.right);
        break;
      case 'RestElement':
        visitDeclPattern(scope, p.argument);
        break;
      default:
        break;
    }
  };

  const visitFunction = (scope, fn) => {
    let outer = scope;
    if (fn.type === 'FunctionExpression' && fn.id) {
      outer = new Scope('block', scope);
      outer.declare(fn.id.name, { kind: 'fname', reads: 1 });
    }
    const fscope = new Scope('function', outer);
    if (fn.type !== 'ArrowFunctionExpression') fscope.declare('arguments', { kind: 'arguments', reads: 1 });
    for (const p of fn.params) for (const id of patternNames(p)) fscope.declare(id.name, { kind: 'param', node: id, reads: 1 });
    for (const p of fn.params) visitDeclPattern(fscope, p);
    if (fn.body.type === 'BlockStatement') {
      for (const id of collectVars(fn.body)) addDecl(fscope, id, 'var', fn);
      hoistLexical(fscope, fn.body.body);
      for (const st of fn.body.body) visit(fscope, st);
    } else visit(fscope, fn.body);
  };

  function visit(scope, node, parentType) {
    if (!isNode(node)) return;
    switch (node.type) {
      case 'Identifier':
        ref(scope, node, 'read', parentType);
        return;
      case 'Program': {
        for (const id of collectVars(node)) addDecl(scope, id, 'var', node);
        hoistLexical(scope, node.body);
        for (const st of node.body) visit(scope, st);
        return;
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        visitFunction(scope, node);
        return;
      case 'BlockStatement': {
        const s = new Scope('block', scope);
        hoistLexical(s, node.body);
        for (const st of node.body) visit(s, st);
        return;
      }
      case 'StaticBlock': {
        const s = new Scope('function', scope);
        for (const id of collectVars(node)) addDecl(s, id, 'var', node);
        hoistLexical(s, node.body);
        for (const st of node.body) visit(s, st);
        return;
      }
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement': {
        const s = new Scope('block', scope);
        const init = node.type === 'ForStatement' ? node.init : node.left;
        if (init && init.type === 'VariableDeclaration' && init.kind !== 'var') hoistLexical(s, [init]);
        if (node.type === 'ForStatement') {
          visit(s, node.init);
          visit(s, node.test);
          visit(s, node.update);
        } else {
          if (init.type === 'VariableDeclaration') visit(s, init);
          else visitPatternTargets(s, init, 'write');
          visit(s, node.right);
        }
        visit(s, node.body);
        return;
      }
      case 'SwitchStatement': {
        visit(scope, node.discriminant);
        const s = new Scope('block', scope);
        hoistLexical(s, node.cases.flatMap((c) => c.consequent));
        for (const c of node.cases) {
          visit(s, c.test);
          for (const st of c.consequent) visit(s, st);
        }
        return;
      }
      case 'CatchClause': {
        const s = new Scope('block', scope);
        if (node.param) for (const id of patternNames(node.param)) s.declare(id.name, { kind: 'catch', node: id, reads: 1 });
        visitDeclPattern(s, node.param);
        visit(s, node.body);
        return;
      }
      case 'ClassDeclaration':
      case 'ClassExpression': {
        const s = new Scope('block', scope);
        if (node.id) s.declare(node.id.name, { kind: 'cname', reads: 1 });
        visit(scope, node.superClass);
        for (const m of node.body.body) {
          if (m.computed) visit(s, m.key);
          if (m.type === 'StaticBlock') visit(s, m);
          else if (m.value) {
            const fs2 = new Scope('function', s);
            visit(fs2, m.value);
          }
        }
        return;
      }
      case 'VariableDeclaration': {
        for (const d of node.declarations) {
          visitDeclPattern(scope, d.id);
          if (d.init) {
            visit(scope, d.init);
            for (const id of patternNames(d.id)) {
              const v = scope.lookup(id.name);
              if (v) v.writes += 1;
            }
          }
        }
        return;
      }
      case 'AssignmentExpression':
        visitPatternTargets(scope, node.left, node.operator === '=' ? 'write' : 'readwrite');
        visit(scope, node.right);
        return;
      case 'UpdateExpression':
        if (node.argument.type === 'Identifier') ref(scope, node.argument, 'readwrite');
        else visit(scope, node.argument);
        return;
      case 'UnaryExpression':
        visit(scope, node.argument, node.operator === 'typeof' ? 'typeof' : undefined);
        return;
      case 'MemberExpression':
        visit(scope, node.object);
        if (node.computed) visit(scope, node.property);
        return;
      case 'Property':
        if (node.computed) visit(scope, node.key);
        visit(scope, node.value);
        return;
      case 'LabeledStatement':
        visit(scope, node.body);
        return;
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'MetaProperty':
      case 'PrivateIdentifier':
        return;
      case 'ImportDeclaration':
        return;
      case 'ExportNamedDeclaration':
        if (node.declaration) {
          const d = node.declaration;
          if (d.type === 'VariableDeclaration') for (const dd of d.declarations) for (const id of patternNames(dd.id)) exportNames.add(id.name);
          else if (d.id) exportNames.add(d.id.name);
          visit(scope, d);
        }
        for (const sp of node.specifiers ?? []) {
          exportNames.add(sp.exported.name ?? sp.exported.value);
          if (!node.source) ref(scope, sp.local, 'read');
        }
        return;
      case 'ExportDefaultDeclaration':
        exportNames.add('default');
        visit(scope, node.declaration);
        return;
      case 'ExportAllDeclaration':
        exportsUnknown = true;
        if (node.exported) exportNames.add(node.exported.name);
        return;
      default:
        for (const c of children(node)) visit(scope, c, node.type);
    }
  }

  visit(root, ast);

  const unused = unusedCandidates.filter((v) => v.reads === 0 && !v.name.startsWith('_') && !v.restSibling);
  return { undef, unused, importedBindings, exportNames, exportsUnknown, filename };
}

// ---- 파일 한 개 ----

function lintFile(file, cache) {
  const text = fs.readFileSync(file, 'utf8');
  const sourceType = moduleKind(file);
  const hits = [];
  const add = (rule, node, message) => hits.push({ rule, severity: RULES[rule], file, line: node.loc.start.line, column: node.loc.start.column + 1, message });
  let ast;
  try {
    ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType, allowHashBang: true, allowReturnOutsideFunction: sourceType === 'script', locations: true });
  } catch (e) {
    hits.push({ rule: 'syntax', severity: RULES.syntax, file, line: e.loc?.line ?? 1, column: (e.loc?.column ?? 0) + 1, message: e.message.replace(/\s*\(\d+:\d+\)$/, '') });
    return { hits, ignored: [], text };
  }
  const r = analyze(ast, { sourceType, filename: file });
  // 파일 머리의 `/* global a, b */`는 그 파일이 다른 실행 환경(브라우저에 넣어 돌리는 함수 등)의 이름을 쓴다는 표시라 정의된 것으로 본다.
  const declared = new Set((/^\s*\/\*\s*global\s+([^*]+)\*\//m.exec(text)?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  for (const id of r.undef) if (!declared.has(id.name)) add('no-undef', id, `정의 안 된 이름: ${id.name}`);
  for (const v of r.unused) {
    add('no-unused-vars', v.node, `안 쓰는 ${v.kind === 'import' ? '가져온 이름' : '변수'}: ${v.name}`);
  }
  // 상대 경로 ESM을 가져올 때 이름이 그쪽에 있는지 본다.
  for (const { decl, spec } of r.importedBindings) {
    if (spec.type !== 'ImportSpecifier' || typeof decl.source.value !== 'string' || !decl.source.value.startsWith('.')) continue;
    const target = path.resolve(path.dirname(file), decl.source.value);
    const info = exportInfo(target, cache);
    if (!info || info.unknown) continue;
    const name = spec.imported.name ?? spec.imported.value;
    if (!info.names.has(name)) add('import-missing-export', spec, `${decl.source.value}에 내보낸 이름이 없음: ${name}`);
  }
  // 오탐 표시: 그 줄이나 윗줄의 // kit-lint-ignore <규칙>: 까닭
  const lines = text.split('\n');
  const ignored = [];
  const kept = hits.filter((h) => {
    if (h.rule === 'syntax') return true;
    for (const ln of [h.line, h.line - 1]) {
      const m = /\/\/\s*kit-lint-ignore\s+([\w-]+)\s*:\s*\S/.exec(lines[ln - 1] ?? '');
      if (m && m[1] === h.rule) {
        ignored.push(h);
        return false;
      }
    }
    return true;
  });
  return { hits: kept, ignored, text };
}

// 가져오는 쪽이 이름을 확인할 수 있도록 ESM 파일의 내보내기 이름을 모은다. 모르는 꼴(export *, CJS, 못 읽음)은 null이나 unknown이다.
function exportInfo(target, cache) {
  const candidates = [target, `${target}.js`, path.join(target, 'index.js')];
  const file = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
  if (!file || !/\.js$/.test(file) || moduleKind(file) !== 'module') return null;
  if (cache.has(file)) return cache.get(file);
  let info = null;
  try {
    const ast = acorn.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, locations: true });
    const r = analyze(ast, { sourceType: 'module', filename: file });
    info = { names: r.exportNames, unknown: r.exportsUnknown };
  } catch {
    info = null;
  }
  cache.set(file, info);
  return info;
}

// ---- 대상 모으기와 실행 ----

const SKIP_DIRS = new Set(['node_modules', 'records', '.kit-base', '.git', '.claude']);
function collect(target, out = []) {
  const st = fs.statSync(target);
  if (st.isFile()) {
    if (/\.(js|cjs|mjs)$/.test(target)) out.push(target);
    return out;
  }
  for (const e of fs.readdirSync(target, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    collect(path.join(target, e.name), out);
  }
  return out;
}

function lintAll(targets) {
  const cache = new Map();
  const files = targets.flatMap((t) => collect(t)).sort();
  const hits = [];
  const ignored = [];
  for (const f of files) {
    const r = lintFile(f, cache);
    hits.push(...r.hits);
    ignored.push(...r.ignored);
  }
  hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
  const count = (list, sev) => list.filter((h) => h.severity === sev).length;
  const byRule = {};
  for (const h of hits) byRule[h.rule] = (byRule[h.rule] ?? 0) + 1;
  const ignoredByRule = {};
  for (const h of ignored) ignoredByRule[h.rule] = (ignoredByRule[h.rule] ?? 0) + 1;
  return { files: files.length, errors: count(hits, 'error'), warnings: count(hits, 'warn'), ignored: ignored.length, byRule, ignoredByRule, hits };
}

module.exports = { lintAll, lintFile, RULES };

if (require.main === module) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const repo = path.resolve(__dirname, '..');
  const targets = args.filter((a) => !a.startsWith('--')).map((a) => path.resolve(a));
  const result = lintAll(targets.length ? targets : [path.join(repo, 'subagent-system'), path.join(repo, 'tools')]);
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    for (const h of result.hits) process.stdout.write(`${path.relative(repo, h.file)}:${h.line}:${h.column} ${h.severity} ${h.rule} ${h.message}\n`);
    const rules = Object.entries(result.byRule).map(([k, v]) => `${k} ${v}`).join(', ') || '없음';
    process.stdout.write(`린트 ${result.files}개 파일: 오류 ${result.errors}, 경고 ${result.warnings}(${rules}), 오탐 표시로 가린 것 ${result.ignored}\n`);
  }
  process.exit(result.errors > 0 ? 1 : 0);
}
