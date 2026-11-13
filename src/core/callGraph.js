'use strict';
/**
 * Language-independent call graph builder (no vscode dependency).
 * Uses adapter.parseCalls(text) -> [{ caller: {line, character}, refs: [{parts, line, character}] }]
 * and resolves every reference with the same resolver as Ctrl+Click, so local variables,
 * record fields etc. never become edges.
 */
const { resolve } = require('./resolver');

const CALLABLE = new Set(['procedure', 'function', 'trigger']);

/**
 * @param adapter   language adapter (must implement parseCalls)
 * @param store     SymbolStore
 * @param readText  async (uri) => string | undefined
 * @param opts      { onProgress?(done, total), isCancelled?() , filter?(uri) }
 */
async function buildCallGraph(adapter, store, readText, opts = {}) {
    const nodes = [];
    const byKey = new Map();
    const files = [];
    const fileIdx = new Map();
    const containerDisplay = new Map();
    for (const list of store.names.values()) {
        for (const s of list) if (!s.container && (s.kind === 'package' || s.kind === 'type')) containerDisplay.set(s.name, s.display);
    }

    const fileOf = (uri) => {
        if (!fileIdx.has(uri)) { fileIdx.set(uri, files.length); files.push(uri); }
        return fileIdx.get(uri);
    };
    const keyOf = (s) => (s.local ? `${s.uri}#` : '') + `${s.container || ''}.${s.name}${s.kind === 'trigger' ? '!T' : ''}`;
    const nodeOf = (s) => {
        const key = keyOf(s);
        let n = byKey.get(key);
        if (!n) {
            n = {
                id: nodes.length,
                name: s.display,
                pkg: s.container ? (containerDisplay.get(s.container) || s.container) : '',
                kind: s.kind,
                file: fileOf(s.uri),
                line: s.line,
                sig: s.detail ? s.detail.split('\n').slice(0, 12).join('\n') : '',
                out: new Map() // callee id -> call count
            };
            byKey.set(key, n);
            nodes.push(n);
        } else if (s.role === 'body' && nodes[n.id].roleRank !== 2) {
            // prefer the implementation location for navigation
            n.file = fileOf(s.uri); n.line = s.line; n.roleRank = 2;
            if (s.detail) n.sig = s.detail.split('\n').slice(0, 12).join('\n');
        }
        if (s.role === 'body') n.roleRank = 2;
        return n;
    };

    // all implemented subprograms / triggers are nodes (also when never called)
    const uris = [...store.files.keys()].filter((u) => !opts.filter || opts.filter(u));
    for (const u of uris) {
        for (const s of store.fileSymbols(u)) {
            if (!s.hidden && CALLABLE.has(s.kind) && (s.role === 'body' || s.kind === 'trigger')) nodeOf(s);
        }
    }

    let done = 0, edgeCount = 0;
    for (const uri of uris) {
        if (opts.isCancelled && opts.isCancelled()) return undefined;
        done++;
        const syms = store.fileSymbols(uri);
        if (!syms.some((s) => CALLABLE.has(s.kind) && !s.hidden)) continue;
        const text = await readText(uri);
        if (text === undefined) continue;
        let calls;
        try { calls = adapter.parseCalls(text) || []; } catch (e) { continue; }
        for (const c of calls) {
            const callerSym = syms.find((s) => s.line === c.caller.line && s.character === c.caller.character && CALLABLE.has(s.kind));
            if (!callerSym) continue;
            const caller = nodeOf(callerSym);
            for (const r of c.refs) {
                const ref = { parts: r.parts.map((name) => ({ name })), index: r.parts.length - 1 };
                const res = resolve(adapter, store, ref, { uri, line: r.line, character: r.character, mode: 'definition' });
                const seen = new Set();
                for (const s of res) {
                    if (!CALLABLE.has(s.kind) || s.kind === 'trigger' || s.hidden) continue;
                    const callee = nodeOf(s);
                    if (seen.has(callee.id)) continue;
                    seen.add(callee.id);
                    if (!caller.out.has(callee.id)) edgeCount++;
                    caller.out.set(callee.id, (caller.out.get(callee.id) || 0) + 1);
                }
            }
        }
        if (opts.onProgress && done % 25 === 0) {
            opts.onProgress(done, uris.length);
            await new Promise((r) => setTimeout(r, 0)); // keep the extension host responsive
        }
    }
    return { nodes, files, edgeCount };
}

module.exports = { buildCallGraph };
