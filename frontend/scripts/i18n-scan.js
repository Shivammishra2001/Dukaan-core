/**
 * i18n audit: walks every .tsx under app/ and components/ (excluding api
 * routes) with the TypeScript AST and reports user-visible English literals
 * that bypass t(): JSX text, user-facing JSX attributes, string literals
 * rendered inside JSX expressions, and literals passed to error/toast/alert
 * sinks. Also verifies every t('key') used in code exists in all languages,
 * that dynamic namespaces (enum.*, unit.*, theme.*, state.*) cover every
 * value of their TypeScript union types, and that every ERR_* code the
 * frontend can produce has an error.* message.
 *
 * Usage: node scripts/i18n-scan.js   (exit code 1 if anything is found)
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const DIRS = ['app', 'components'];
const ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label']);
const SINKS = /^(setError|setMsg|setMessage|setNotice|setInfo|setWarning|pushToast|toast|alert|confirm|showToast|setToast|addToast|setStatusMsg|setSuccess|setFormError|setScanError|setSaveError|setLoadError|setActionError)$/;
const hasWords = (s) => /[A-Za-z]{2,}/.test(s) && !isClassName(s);
// Tailwind class lists: every token is lowercase class-ish and at least one has a '-' or ':'.
function isClassName(s) {
  const toks = s.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return false;
  if (!toks.every((t) => /^[a-z0-9!\-:\[\]\/.%#()_,>&*]+$/.test(t))) return false;
  return toks.length === 1 ? /^[a-z]+$/.test(toks[0]) && toks[0].length > 1 && /^(antialiased|px|flex|hidden|block|truncate|italic|uppercase|grow|shrink|relative|absolute|underline)$/.test(toks[0]) || /[-:]/.test(toks[0]) : toks.some((t) => /[-:]/.test(t));
}
// Technical tokens deliberately left untranslated (trade acronyms, codes).
const ALLOW = new Set(['DUKAAN Core', 'CSV', 'KB', 'ERR_UNKNOWN', 'GST', 'CGST + SGST', 'SKU', 'UPI', 'PIN', 'PDF (A4)', 'HSN', 'px', 'blank-']);
// Literals that are not user-facing prose.
const IGNORE = (s) =>
  /^[\s]*$/.test(s) ||
  /^(https?:|\/|#|@|\.)/.test(s) ||
  /^[a-z0-9_.:\-\/]+$/.test(s) && !/\s/.test(s) && s.length < 40 && s === s.toLowerCase() ||
  /^[A-Z0-9_]+$/.test(s) && s.length <= 4;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'api') walk(p, out); }
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

function loadKeys() {
  const src = fs.readFileSync(path.join(ROOT, 'lib/translations/index.ts'), 'utf8');
  const sf = ts.createSourceFile('t.ts', src, ts.ScriptTarget.Latest, true);
  const langs = {};
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && n.name.getText() === 'TRANSLATIONS') {
      for (const p of n.initializer.properties) {
        const lang = p.name.text ?? p.name.getText();
        langs[lang] = new Map(p.initializer.properties.map((q) => [q.name.text, q.initializer.text]));
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return langs;
}

const findings = [];
const usedKeys = new Map();
const LIB_FILES = ['lib/nav-config.ts', 'lib/keyboard-shortcuts.ts'].map((f) => path.join(ROOT, f));
for (const file of [...DIRS.flatMap((d) => walk(path.join(ROOT, d), [])), ...LIB_FILES]) {
  const keysOnly = file.endsWith('.ts');
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const report = (node, kind, text) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
    if (ALLOW.has(text.trim())) return;
    findings.push(`${rel}:${line + 1} [${kind}] ${JSON.stringify(text.trim().replace(/\s+/g, ' '))}`);
  };
  const inJsxExpr = (n) => {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isCallExpression(p)) {
        const c = p.expression.getText();
        if (c === 't' || c === 'translateEnum' || c === 'translateError' || /className|clsx|cn$|Date|toLocale|Intl|format|join|split|replace|startsWith|includes|endsWith|querySelector|getItem|setItem|fetch|apiFetch|push|get$|post|encodeURIComponent/.test(c)) return false;
      }
      if (ts.isJsxAttribute(p)) return p.name.getText() !== 'className' && p.name.getText() !== 'key' && !/^(href|type|id|name|src|mode|inputMode|autoComplete|pattern|step|role|htmlFor|value|variant|size|tone|icon|accept|target|rel|method|form|d|viewBox|fill|stroke)$/.test(p.name.getText());
      if (ts.isJsxExpression(p)) return true;
      if (ts.isBinaryExpression(p) && /===|!==|==|!=/.test(p.operatorToken.getText())) return false;
      if (ts.isElementAccessExpression(p) || ts.isCaseClause(p) || ts.isPropertyAccessExpression(p)) return false;
      if (ts.isFunctionLike(p) || ts.isVariableStatement(p)) return false;
    }
    return false;
  };
  const visit = (n) => {
    if (ts.isCallExpression(n) && n.expression.getText() === 't' && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      usedKeys.set(n.arguments[0].text, rel);
    }
    // Keys stored in config objects (labelKey: 'dashboard.x', navKey, titleKey, descriptionKey, ...).
    if (ts.isPropertyAssignment(n) && /Key$/.test(n.name.getText()) && ts.isStringLiteral(n.initializer) && /^[a-z]+\./.test(n.initializer.text)) {
      usedKeys.set(n.initializer.text, rel);
    }
    if (keysOnly) {
      ts.forEachChild(n, visit);
      return;
    }
    if (ts.isJsxText(n) && hasWords(n.text)) report(n, 'text', n.text);
    else if (ts.isJsxAttribute(n) && ATTRS.has(n.name.getText()) && n.initializer && ts.isStringLiteral(n.initializer) && hasWords(n.initializer.text)) report(n, 'attr:' + n.name.getText(), n.initializer.text);
    else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && hasWords(n.text) && !IGNORE(n.text)) {
      const parent = n.parent;
      if (ts.isCallExpression(parent) && SINKS.test(parent.expression.getText())) report(n, 'sink', n.text);
      else if (ts.isThrowStatement(parent.parent ?? {}) || (ts.isNewExpression(parent) && parent.expression.getText() === 'Error')) report(n, 'throw', n.text);
      else if (!ts.isJsxAttribute(parent) && !ts.isImportDeclaration(parent) && inJsxExpr(n)) report(n, 'expr', n.text);
    } else if (ts.isTemplateExpression(n) && !n.head.text.startsWith('/') && inJsxExpr(n)) {
      const lit = [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(' ');
      if (hasWords(lit)) report(n, 'template', lit);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

const langs = loadKeys();
const problems = [];
for (const [key, file] of usedKeys) for (const l of Object.keys(langs)) if (!langs[l].has(key)) problems.push(`missing key ${l}:${key} (used in ${file})`);
for (const l of Object.keys(langs)) for (const [k, v] of langs[l]) if (!v || !v.trim()) problems.push(`empty value ${l}:${k}`);
const en = langs.en;

// Dynamic keys (translateEnum / template-literal lookups) can't be seen
// statically, so check each namespace covers every value of its union type.
const unionValues = (file, typeName, field) => {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const lead = field ? `${field}:` : `type ${typeName}\\s*=`;
  const m = src.match(new RegExp(lead + "((?:\\s*\\|?\\s*'[A-Za-z_]+')+)"));
  if (!m) { problems.push(`could not read union ${typeName ?? field} in ${file}`); return []; }
  return [...m[1].matchAll(/'([A-Za-z_]+)'/g)].map((x) => x[1]);
};
const DYNAMIC = {
  'enum.payment': [...unionValues('types/checkout.ts', 'ApiPaymentMethod')],
  'enum.ledger': [...unionValues('types/customer.ts', 'CustomerLedgerEntryType'), ...unionValues('types/b2b.ts', null, 'entry_type')],
  'enum.orderStatus': unionValues('types/b2b.ts', 'B2bOrderStatus'),
  'enum.shiftStatus': unionValues('types/shift.ts', 'ShiftStatus'),
  'enum.preset': unionValues('types/pos.ts', 'BusinessPreset'),
  unit: unionValues('types/checkout.ts', 'ApiUnitCode'),
  'enum.role': ['OWNER', 'MANAGER', 'CASHIER', 'INVENTORY_CLERK', 'ACCOUNTANT'],
  theme: unionValues('context/ThemeContext.tsx', 'ThemeName'),
  state: [...fs.readFileSync(path.join(ROOT, 'app/register/page.tsx'), 'utf8').matchAll(/\['([A-Z]{2})', '/g)].map((x) => x[1]),
};
// Bulk-import row error codes come from the backend service (rowError('CODE', ...)).
const importService = path.join(ROOT, '..', 'backend', 'src', 'api', 'product-import', 'services', 'product-import.ts');
if (fs.existsSync(importService)) {
  DYNAMIC['import.err'] = [...new Set([...fs.readFileSync(importService, 'utf8').matchAll(/rowError\('([A-Z_]+)'/g)].map((m) => m[1]))];
}
for (const [ns, values] of Object.entries(DYNAMIC)) {
  if (!values.length) problems.push(`no values found for dynamic namespace ${ns}`);
  for (const v of values) for (const l of Object.keys(langs)) if (!langs[l].has(`${ns}.${v}`)) problems.push(`missing dynamic key ${l}:${ns}.${v}`);
}
// Every error code the frontend can produce should have a friendly message.
const codes = new Set();
for (const dir of ['app', 'components', 'lib', 'stores']) {
  (function w(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'api') w(p); }
      else if (/\.tsx?$/.test(p)) for (const m of fs.readFileSync(p, 'utf8').matchAll(/'(ERR_[A-Z_]+)'/g)) codes.add(m[1]);
    }
  })(path.join(ROOT, dir));
}
for (const c of codes) for (const l of Object.keys(langs)) if (!langs[l].has(`error.${c}`)) problems.push(`missing error message ${l}:error.${c}`);
for (const l of Object.keys(langs)) if (l !== 'en') for (const k of en.keys()) if (!langs[l].has(k)) problems.push(`key ${k} missing in ${l}`);

console.log(findings.join('\n'));
console.log(problems.join('\n'));
console.log(`\n${findings.length} hardcoded literal(s), ${problems.length} dictionary problem(s), ${usedKeys.size} keys used.`);
process.exit(findings.length || problems.length ? 1 : 0);
