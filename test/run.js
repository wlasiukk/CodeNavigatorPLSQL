'use strict';
/**
 * Offline test of the parser + resolver (no VS Code needed).
 * Run with any node, e.g. VS Code's bundled one:
 *   $env:ELECTRON_RUN_AS_NODE=1; & "C:\Program Files\Microsoft VS Code\Code.exe" test\run.js <folder> [file line col]
 */
const fs = require('fs');
const path = require('path');
const adapter = require('../src/languages/plsql');
const { SymbolStore } = require('../src/core/store');
const { resolve } = require('../src/core/resolver');
const { globToRegExp } = require('../src/core/glob');

const root = path.resolve(process.argv[2]);
const inc = globToRegExp(adapter.defaultInclude);
const exc = globToRegExp(process.env.CN_EXCLUDE || '**/{node_modules,.git}/**');
const store = new SymbolStore();
const uriOf = (f) => 'file:///' + f.replace(/\\/g, '/');

function walk(d, out) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (!exc.test(p.replace(/\\/g, '/') + '/x')) walk(p, out); }
        else if (inc.test(p.replace(/\\/g, '/')) && !exc.test(p.replace(/\\/g, '/'))) out.push(p);
    }
    return out;
}

const t0 = Date.now();
const files = walk(root, []);
for (const f of files) {
    const r = adapter.parse(fs.readFileSync(f, 'utf8'));
    store.setFile(uriOf(f), r.symbols, r.locals, r.details);
}
console.log(`files=${files.length} symbols=${store.symbolCount} schemas=${[...store.schemas.keys()].join(',')} ms=${Date.now() - t0}`);

const kinds = {};
for (const l of store.names.values()) for (const s of l) kinds[s.kind + '/' + s.role] = (kinds[s.kind + '/' + s.role] || 0) + 1;
console.log(kinds);

const queries = [];
for (let a = 3; a + 2 < process.argv.length; a += 3) queries.push(process.argv.slice(a, a + 3));
for (const [file, line, col] of queries) {
    const abs = path.resolve(file);
    const text = fs.readFileSync(abs, 'utf8').split('\n')[line - 1].replace(/\r$/, '');
    const ref = adapter.getReference(text, col - 1);
    console.log('line:', text.trim(), '\nref:', ref && ref.parts.map((p) => p.name).join('.'), 'index', ref && ref.index);
    for (const mode of ['definition', 'declaration']) {
        const res = ref ? resolve(adapter, store, ref, { uri: uriOf(abs), line: line - 1, character: col - 1, mode }) : [];
        console.log(`--- ${mode}:`);
        for (const s of res) console.log(`  ${s.kind}/${s.role || 'local'} ${s.container || ''}.${s.display}  ${decodeURI(s.uri).slice(8)}:${s.line + 1}:${s.character + 1}\n    ${(s.detail || '').split('\n')[0]}`);
    }
}
