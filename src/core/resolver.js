'use strict';
/**
 * Language-independent resolution of a dotted reference (a.b.c) against a SymbolStore.
 * No vscode dependency, so it can be unit tested with plain node.
 *
 * mode: 'definition'  -> prefer implementation (role body), then spec, then forward
 *       'declaration' -> prefer spec, then forward, then body
 * When the cursor already sits on the preferred target (e.g. Ctrl+Click on a procedure
 * name in the package body), the counterpart is returned instead (body <-> spec toggle).
 */

const ORDER = {
    definition: ['body', 'spec', 'forward'],
    declaration: ['spec', 'forward', 'body']
};

function resolve(adapter, store, ref, ctx) {
    // symbols of excluded files (indexed only while open) are visible only from that file
    const base = store;
    const visible = (s) => !s.hidden || s.uri === ctx.uri;
    store = {
        byName: (n) => base.byName(n).filter(visible),
        isSchema: (n) => base.isSchema(n),
        containerAt: (uri, line) => base.containerAt(uri, line)
    };
    // local variables / parameters (same file, lexical scope) shadow everything else
    if (ref.index === 0 && base.localAt) {
        const name = adapter.caseInsensitive ? ref.parts[0].name.toUpperCase() : ref.parts[0].name;
        const loc = base.localAt(ctx.uri, name, ctx.line, ctx.character);
        if (loc) return isSelf(loc, ctx) && !ctx.includeSelf ? [] : [loc];
    }
    const norm = (n) => (adapter.caseInsensitive ? n.toUpperCase() : n);
    const parts = ref.parts.map((p) => norm(p.name));
    const k = ref.index;
    const isQualifier = k < parts.length - 1;
    let chain = parts.slice(0, k + 1);
    const containerKinds = adapter.containerKinds;
    const objectKinds = adapter.objectKinds;

    const objectsNamed = (name, kinds) =>
        store.byName(name).filter((s) => !s.container && !s.local && kinds.has(s.kind));

    // leading schema prefix: SCHEMA.pkg.member / SCHEMA.object
    if (chain.length >= 2 && store.isSchema(chain[0]) && !objectsNamed(chain[0], containerKinds).length) {
        chain = chain.slice(1);
    } else if (chain.length === 1 && isQualifier && store.isSchema(chain[0]) &&
        !objectsNamed(chain[0], objectKinds).length) {
        return []; // clicked on the schema name itself
    }

    /** container name, following a synonym (SYN.member -> TARGET.member) */
    const containerName = (name) => {
        if (objectsNamed(name, containerKinds).length) return name;
        const syn = store.byName(name).find((s) => s.kind === 'synonym' && s.target && !s.container);
        return syn ? syn.target : name;
    };

    let cands = [];
    if (chain.length === 1) {
        const name = chain[0];
        if (isQualifier) cands = objectsNamed(name, containerKinds);
        if (!cands.length) cands = unqualified(store, objectKinds, name, ctx);
    } else if (chain.length === 2) {
        const cont = containerName(chain[0]);
        cands = store.byName(chain[1]).filter((s) => s.container === cont && !s.local);
    }
    // a real object (table, view, package ...) wins over a synonym with the same name
    if (cands.some((s) => s.kind === 'synonym') && cands.some((s) => s.kind !== 'synonym')) {
        cands = cands.filter((s) => s.kind !== 'synonym');
    }
    return pick(cands, ctx.mode, ctx);
}

function unqualified(store, objectKinds, name, ctx) {
    const all = store.byName(name);
    if (!all.length) return all;
    const cur = store.containerAt(ctx.uri, ctx.line);
    // 1) members of the enclosing package/type (any file), local subprograms in this file
    const tier1 = all.filter((s) =>
        (s.local && s.uri === ctx.uri) ||
        (cur && !s.local && s.container && s.container === cur.name));
    if (tier1.length) return tier1;
    // 2) schema level objects
    return all.filter((s) => !s.container && !s.local && objectKinds.has(s.kind));
}

function isSelf(s, ctx) {
    return s.uri === ctx.uri && s.line === ctx.line && s.character <= ctx.character && ctx.character <= s.endCharacter;
}

function groupKey(s) {
    const k = s.kind === 'procedure' || s.kind === 'function' ? 'sub' : s.kind;
    return `${s.container || ''}|${s.name}|${k}`;
}

/** Normalised parameter list used to match overloads between spec and body. */
function paramKey(s) {
    if (!s.detail) return '';
    let d = s.detail.toUpperCase().replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const i = d.indexOf(s.name);
    if (i >= 0) d = d.slice(i + s.name.length);
    return d.replace(/\s+/g, '').replace(/[;,]$/, '');
}

function pick(cands, mode, ctx) {
    if (!cands.length) return cands;
    const groups = new Map();
    for (const s of cands) {
        const key = groupKey(s);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(s);
    }
    const out = [];
    for (const g of groups.values()) {
        // hover (includeSelf): describe the symbol under the cursor too, no body<->spec toggle
        const self = ctx.includeSelf ? undefined : g.find((s) => isSelf(s, ctx));
        let order = ORDER[mode] || ORDER.definition;
        if (self && self.role === order[0]) order = order.slice(1).concat(order[0]); // toggle body <-> spec
        let chosen = [];
        for (const role of order) {
            chosen = g.filter((s) => s.role === role && s !== self);
            if (chosen.length) break;
        }
        if (self && chosen.length > 1) {
            // overloads: keep only those with identical parameter list
            const pk = paramKey(self);
            const same = chosen.filter((s) => paramKey(s) === pk);
            if (same.length) chosen = same;
        }
        out.push(...chosen);
    }
    return out;
}

module.exports = { resolve };
