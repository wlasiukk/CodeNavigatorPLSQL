'use strict';
const { parse, isIdPart } = require('./parser');

/**
 * PL/SQL language adapter. See src/languages/README.md for the adapter contract.
 */
module.exports = {
    id: 'plsql',
    label: 'PL/SQL',
    /** settings key holding the include glob: codeNav.<id>.include */
    defaultInclude: '**/*.{bdy,spc,pks,pkb,pkh,pck,pls,plsql,sql,prc,fnc,trg,tps,tpb,typ,tab,vw,mvw,syn,seq}',
    /** language ids whose documents are handled even when not matching the include glob */
    languageIds: ['oracle-sql', 'plsql', 'oraclesql'],
    caseInsensitive: true,
    /** language id used to highlight code blocks in hovers */
    hoverLanguage: 'sql',

    parse(text) {
        return parse(text);
    },

    /** Call extraction for the call graph: [{ caller: {line, character}, refs: [{parts, line, character}] }] */
    parseCalls(text) {
        return parse(text, { calls: true }).calls;
    },

    /** Container-level kinds (things that can qualify a member: pkg.member) */
    containerKinds: new Set(['package', 'type']),
    /** Top-level object kinds that can be referenced by name */
    objectKinds: new Set(['package', 'type', 'procedure', 'function', 'table', 'view', 'mview', 'sequence', 'synonym', 'trigger', 'library']),

    /**
     * Extra hover markdown for a resolved symbol: table columns with types and comments,
     * merged from CREATE TABLE, ALTER TABLE ... ADD and COMMENT ON statements in any file.
     */
    hoverMarkdown(sym, store) {
        let prefix = '';
        if (sym.kind === 'synonym' && sym.target) {
            prefix = `synonym for **${sym.target.toLowerCase()}**\n\n`;
            const target = store.byName(sym.target).find((s) => !s.container && s.kind !== 'synonym');
            if (!target) return prefix;
            sym = target;
        }
        if (sym.kind !== 'table' && sym.kind !== 'view' && sym.kind !== 'mview') return prefix || undefined;
        const parts = store.details('TABLE:' + sym.name);
        if (!parts.length) return prefix || undefined;
        const cols = new Map();
        const comments = {};
        const pk = new Set();
        const fks = new Map(); // COL -> "REF_TABLE.REF_COL"
        let tableComment;
        // CREATE TABLE first, then ALTER ... ADD
        const ordered = parts.slice().sort((a, b) =>
            ((a.columns && a.columns[0] && a.columns[0].order) || 0) - ((b.columns && b.columns[0] && b.columns[0].order) || 0));
        for (const p of ordered) {
            for (const c of p.columns || []) if (!cols.has(c.name)) cols.set(c.name, c);
            if (p.colComments) Object.assign(comments, p.colComments);
            if (p.comment) tableComment = p.comment;
            for (const c of p.pk || []) pk.add(c);
            for (const fk of p.fks || []) {
                fk.cols.forEach((c, i) => fks.set(c, `${fk.ref.toLowerCase()}${fk.refCols[i] ? '.' + fk.refCols[i].toLowerCase() : ''}`));
            }
        }
        const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'))
            .replace(/\r?\n/g, ' ').replace(/([*_`\[\]])/g, '\\$1');
        const out = [];
        if (tableComment) out.push(esc(tableComment), '');
        if (cols.size) {
            const hasDefault = [...cols.values()].some((c) => c.dflt);
            const hasKey = pk.size || fks.size;
            const hasComment = [...cols.keys()].some((c) => comments[c]);
            const head = ['Column', 'Type', 'Null'];
            if (hasKey) head.push('Key');
            if (hasDefault) head.push('Default');
            if (hasComment) head.push('Comment');
            out.push('| ' + head.join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|');
            for (const c of cols.values()) {
                const row = [`**${esc(c.display)}**`, esc(c.type.toLowerCase()), c.nullable ? '' : 'NOT NULL'];
                if (hasKey) row.push([pk.has(c.name) ? 'PK' : '', fks.has(c.name) ? 'FK → ' + esc(fks.get(c.name)) : ''].filter(Boolean).join(', '));
                if (hasDefault) row.push(c.dflt ? esc(c.dflt) : '');
                if (hasComment) {
                    let cm = comments[c.name] || '';
                    if (cm.length > 200) cm = cm.slice(0, 200) + '…';
                    row.push(esc(cm));
                }
                out.push('| ' + row.join(' | ') + ' |');
            }
        } else if (Object.keys(comments).length) {
            out.push('| Column | Comment |', '|---|---|');
            for (const [c, cm] of Object.entries(comments)) out.push(`| **${esc(c.toLowerCase())}** | ${esc(cm)} |`);
        }
        return out.join('\n');
    },

    /**
     * Returns the dotted identifier chain under the cursor:
     * { parts: [{name, start, end}], index } or undefined.
     */
    getReference(lineText, character) {
        if (inLineComment(lineText, character)) return undefined;
        const parts = [];
        // locate identifier containing character
        const word = (pos) => readIdentAt(lineText, pos);
        let cur = word(character) || (character > 0 ? word(character - 1) : undefined);
        if (!cur) return undefined;
        parts.push(cur);
        // walk left
        let p = cur.start;
        while (p > 0 && lineText[p - 1] === '.') {
            const prev = readIdentEndingAt(lineText, p - 1);
            if (!prev) break;
            parts.unshift(prev);
            p = prev.start;
        }
        const index = parts.length - 1;
        // walk right
        p = cur.end;
        while (p < lineText.length && lineText[p] === '.') {
            const next = readIdentAt(lineText, p + 1);
            if (!next || next.start !== p + 1) break;
            parts.push(next);
            p = next.end;
        }
        return { parts, index };
    }
};

function readIdentAt(line, pos) {
    if (pos < 0 || pos >= line.length) return undefined;
    // quoted identifier
    if (line[pos] === '"' || isInsideQuotes(line, pos)) {
        const open = line[pos] === '"' && !isInsideQuotes(line, pos) ? pos : line.lastIndexOf('"', pos - 1);
        const close = line.indexOf('"', open + 1);
        if (open >= 0 && close > open) {
            return { name: line.slice(open + 1, close).toUpperCase(), start: open, end: close + 1 };
        }
        return undefined;
    }
    if (!isIdPart(line.charCodeAt(pos))) return undefined;
    let s = pos, e = pos;
    while (s > 0 && isIdPart(line.charCodeAt(s - 1))) s--;
    while (e < line.length && isIdPart(line.charCodeAt(e))) e++;
    if (/^[0-9]/.test(line[s])) return undefined;
    return { name: line.slice(s, e).toUpperCase(), start: s, end: e };
}

function readIdentEndingAt(line, dotPos) {
    const pos = dotPos - 1;
    if (pos < 0) return undefined;
    if (line[pos] === '"') {
        const open = line.lastIndexOf('"', pos - 1);
        if (open < 0) return undefined;
        return { name: line.slice(open + 1, pos).toUpperCase(), start: open, end: pos + 1 };
    }
    return readIdentAt(line, pos);
}

function isInsideQuotes(line, pos) {
    let n = 0;
    for (let i = 0; i < pos; i++) if (line[i] === '"') n++;
    return n % 2 === 1;
}

/** true when position is after "--" (outside a string literal) or inside a '...' literal on this line */
function inLineComment(line, pos) {
    let inStr = false;
    for (let i = 0; i < pos && i < line.length; i++) {
        const c = line[i];
        if (inStr) { if (c === "'") inStr = false; continue; }
        if (c === "'") { inStr = true; continue; }
        if (c === '-' && line[i + 1] === '-') return true;
    }
    return inStr;
}
