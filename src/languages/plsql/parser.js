'use strict';
/**
 * Lightweight Oracle PL/SQL symbol extractor.
 * Pure JS, no vscode dependency (can be tested with plain node).
 *
 * Produces symbols:
 *   { name, display, kind, container, schema, role, local,
 *     line, character, endCharacter,       // name position (0-based)
 *     startLine, endLine,                  // statement / object extent
 *     detail, doc }
 *
 * role:  'spec'    - declaration in package / type specification
 *        'forward' - forward declaration inside a body
 *        'body'    - implementation (IS/AS ...), or a non-PL/SQL object (table, view ...)
 */

const SQLPLUS_LINE_CMDS = new Set(['PROMPT', 'PRO', 'REM', 'REMARK', 'SPOOL', 'WHENEVER', 'CONNECT', 'CONN']);
const CREATE_SKIP = new Set([
    'EDITIONABLE', 'NONEDITIONABLE', 'EDITIONING', 'FORCE', 'NOFORCE', 'NO', 'PUBLIC', 'GLOBAL',
    'TEMPORARY', 'PRIVATE', 'SHARDED', 'DUPLICATED', 'BLOCKCHAIN', 'IMMUTABLE', 'UNIQUE', 'BITMAP',
    'MULTIVALUE', 'OR', 'REPLACE', 'SECURE', 'JSON', 'RELATIONAL', 'DUALITY'
]);
const SPEC_SKIP_STMT = new Set(['PRAGMA', 'END', 'PROCEDURE', 'FUNCTION', 'TYPE', 'SUBTYPE', 'CURSOR']);
const COL_ATTR = new Set(['NOT', 'NULL', 'DEFAULT', 'CONSTRAINT', 'PRIMARY', 'REFERENCES', 'CHECK', 'ENABLE',
    'DISABLE', 'GENERATED', 'COLLATE', 'INVISIBLE', 'VISIBLE', 'ENCRYPT', 'UNIQUE', 'SORT', 'NOVALIDATE', 'VALIDATE',
    'USING', 'DEFERRABLE', 'INITIALLY', 'RELY', 'NORELY', 'ANNOTATIONS', 'DOMAIN']);
const TABLE_CONSTRAINT = new Set(['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK', 'SUPPLEMENTAL']);
/** words never worth resolving as calls (keeps call extraction lean) */
const NOT_CALL = new Set(('IF THEN ELSE ELSIF END BEGIN DECLARE LOOP WHILE FOR FORALL IN OUT NOCOPY IS AS NOT NULL AND OR ' +
    'SELECT FROM WHERE INTO BULK COLLECT INSERT UPDATE DELETE MERGE SET VALUES RETURN RETURNING CASE WHEN EXCEPTION ' +
    'RAISE OTHERS COMMIT ROLLBACK SAVEPOINT OPEN FETCH CLOSE EXIT CONTINUE GOTO NUMBER VARCHAR2 DATE BOOLEAN TRUE ' +
    'FALSE BY ORDER GROUP HAVING JOIN LEFT RIGHT INNER OUTER ON USING DISTINCT UNION ALL EXISTS BETWEEN LIKE ROWTYPE ' +
    'TYPE ROWNUM SYSDATE SYSTIMESTAMP CONSTANT DEFAULT EXECUTE IMMEDIATE PRAGMA CURSOR PROCEDURE FUNCTION WITH ' +
    'COUNT FIRST LAST NEXT PRIOR EXTEND TRIM ASC DESC NVL DECODE TO_CHAR TO_DATE TO_NUMBER SUBSTR INSTR LENGTH ' +
    'UPPER LOWER ROUND TRUNC GREATEST LEAST COALESCE CAST MAX MIN SUM AVG LIMIT ROW ROWS ONLY OFFSET TABLE ' +
    'MATCHED NOWAIT WAIT SKIP LOCKED OF UPDATE SQL SQLERRM SQLCODE FOUND NOTFOUND ROWCOUNT ISOPEN').split(' '));
const NOT_SUBPROGRAM_PREV = new Set(['DROP', 'ALTER', 'EXECUTE', 'AUDIT', 'NOAUDIT', 'ON']);

function isIdStart(c) {
    return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c > 127;
}
function isIdPart(c) {
    return isIdStart(c) || (c >= 48 && c <= 57) || c === 95 /*_*/ || c === 36 /*$*/ || c === 35 /*#*/;
}

/** Tokenize, skipping comments, strings and SQL*Plus line commands. */
function tokenize(text) {
    const toks = [];
    const n = text.length;
    let i = 0;
    let lineStart = true; // only whitespace seen since last newline
    while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 10) { i++; lineStart = true; continue; }
        if (c <= 32 || c === 0xFEFF || c === 0xA0) { i++; continue; }
        // -- comment
        if (c === 45 && text.charCodeAt(i + 1) === 45) {
            const j = text.indexOf('\n', i);
            i = j < 0 ? n : j;
            continue;
        }
        // /* comment */
        if (c === 47 && text.charCodeAt(i + 1) === 42) {
            const j = text.indexOf('*/', i + 2);
            i = j < 0 ? n : j + 2;
            lineStart = false;
            continue;
        }
        // q'[ ... ]'
        if ((c === 113 || c === 81) && text.charCodeAt(i + 1) === 39) {
            const open = text[i + 2];
            const close = ({ '[': ']', '{': '}', '(': ')', '<': '>' })[open] || open;
            const j = text.indexOf(close + "'", i + 3);
            i = j < 0 ? n : j + 2;
            lineStart = false;
            continue;
        }
        // 'string'  (kept as token t:'s', value in .str; .v is undefined so keyword checks never match)
        if (c === 39) {
            let j = i + 1;
            while (j < n) {
                if (text.charCodeAt(j) === 39) {
                    if (text.charCodeAt(j + 1) === 39) { j += 2; continue; }
                    break;
                }
                j++;
            }
            toks.push({ t: 's', s: i, e: Math.min(n, j + 1), get str() { return text.slice(this.s + 1, this.e - 1).replace(/''/g, "'"); } });
            i = j + 1;
            lineStart = false;
            continue;
        }
        // "Quoted identifier"
        if (c === 34) {
            const j = text.indexOf('"', i + 1);
            const end = j < 0 ? n : j;
            const raw = text.slice(i + 1, end);
            if (raw.indexOf('\n') < 0) {
                toks.push({ t: 'id', v: raw.toUpperCase(), s: i, e: end + 1, q: true });
            }
            i = end + 1;
            lineStart = false;
            continue;
        }
        if (isIdStart(c)) {
            let j = i + 1;
            while (j < n && isIdPart(text.charCodeAt(j))) j++;
            const v = text.slice(i, j).toUpperCase();
            if (lineStart && SQLPLUS_LINE_CMDS.has(v)) {
                const k = text.indexOf('\n', j);
                i = k < 0 ? n : k;
                continue;
            }
            toks.push({ t: 'id', v, s: i, e: j });
            i = j;
            lineStart = false;
            continue;
        }
        if (c >= 48 && c <= 57) {
            let j = i + 1;
            while (j < n && (isIdPart(text.charCodeAt(j)) || text.charCodeAt(j) === 46)) j++;
            toks.push({ t: 'n', s: i, e: j }); // number literal (no .v)
            i = j;
            lineStart = false;
            continue;
        }
        toks.push({ t: 'p', v: text[i], s: i, e: i + 1 });
        i++;
        lineStart = false;
    }
    return toks;
}

function lineIndex(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
    return {
        pos(off) {
            let lo = 0, hi = starts.length - 1;
            while (lo < hi) {
                const mid = (lo + hi + 1) >> 1;
                if (starts[mid] <= off) lo = mid; else hi = mid - 1;
            }
            return { line: lo, character: off - starts[lo] };
        },
        lineText(line) {
            const s = starts[line];
            const e = line + 1 < starts.length ? starts[line + 1] - 1 : text.length;
            return text.slice(s, e).replace(/\r$/, '');
        },
        count: starts.length
    };
}

/** Collect "--" comment lines directly above a line (documentation for hover). */
function docAbove(lines, line) {
    const out = [];
    for (let l = line - 1; l >= 0 && out.length < 15; l--) {
        const t = lines.lineText(l).trim();
        if (t.startsWith('--')) out.unshift(t.replace(/^--+\s?/, ''));
        else break;
    }
    return out.length ? out.join('\n') : undefined;
}

/**
 * @param {string} text
 * @param {{calls?: boolean}} [opts] calls: also return identifier chains used in each
 *        subprogram/trigger body (input for the call graph; slower, only on demand)
 */
function parse(text, opts) {
    const collectCalls = !!(opts && opts.calls);
    const callers = [];
    const toks = tokenize(text);
    const lines = lineIndex(text);
    const symbols = [];
    const tableParts = []; // table columns / comments / constraints (merged by table name in the store)
    const tops = []; // top-level objects, to compute extents

    const isId = (k, v) => k < toks.length && toks[k].t === 'id' && (v === undefined || toks[k].v === v);
    const isP = (k, v) => k < toks.length && toks[k].t === 'p' && toks[k].v === v;

    function mk(nameTok, props) {
        const p = lines.pos(nameTok.s);
        const sym = Object.assign({
            name: nameTok.v,
            display: text.slice(nameTok.s, nameTok.e).replace(/"/g, ''),
            line: p.line,
            character: p.character,
            endCharacter: p.character + (nameTok.e - nameTok.s),
            startLine: p.line
        }, props);
        symbols.push(sym);
        return sym;
    }

    /** From token k (after subprogram name) find end of header: decl (; ,) or body (IS/AS). */
    function scanSubprogramEnd(k) {
        let depth = 0;
        const limit = Math.min(toks.length, k + 600);
        for (; k < limit; k++) {
            const t = toks[k];
            if (t.t === 'p') {
                if (t.v === '(') depth++;
                else if (t.v === ')') { if (depth === 0) return { body: false, end: k }; depth--; }
                else if (depth === 0 && (t.v === ';' || t.v === ',')) return { body: false, end: k };
            } else if (depth === 0) {
                if (t.v === 'IS') return { body: true, end: k };
                if (t.v === 'AS') {
                    if (k > 0 && toks[k - 1].v === 'SELF') continue; // RETURN SELF AS RESULT
                    return { body: true, end: k };
                }
                if (t.v === 'PROCEDURE' || t.v === 'FUNCTION' || t.v === 'CREATE' || t.v === 'BEGIN' || t.v === 'END') {
                    return { body: false, end: k - 1 };
                }
            }
        }
        return { body: false, end: Math.min(k, toks.length - 1) };
    }

    function signature(startTok, endTok, includeEnd) {
        const s = toks[startTok].s;
        const e = endTok >= 0 && endTok < toks.length ? (includeEnd ? toks[endTok].e : toks[endTok].s) : text.length;
        let sig = text.slice(s, Math.max(s, e)).replace(/\r/g, '').replace(/[ \t]+$/gm, '').trim();
        if (sig.length > 3000) sig = sig.slice(0, 3000) + ' ...';
        // dedent continuation lines
        const ls = sig.split('\n');
        if (ls.length > 1) {
            const ind = Math.min(...ls.slice(1).filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length));
            if (isFinite(ind) && ind > 0) {
                const firstCol = lines.pos(s).character;
                const cut = Math.min(ind, firstCol);
                sig = [ls[0], ...ls.slice(1).map(l => l.slice(cut))].join('\n');
            }
        }
        return sig;
    }

    let container = null; // { kind, name, schema }
    let specStmtStart = false; // inside package spec at statement start

    for (let i = 0; i < toks.length; i++) {
        const t = toks[i];

        if (t.t === 'p') {
            if (t.v === ';' && container && container.kind === 'package') specStmtStart = true;
            continue;
        }
        if (t.t === 's' || t.t === 'n') continue;

        // ---- table metadata: ALTER TABLE ... ADD, COMMENT ON TABLE/COLUMN
        if (t.v === 'ALTER' && isId(i + 1, 'TABLE')) {
            i = parseAlterTable(i + 2);
            continue;
        }
        if (t.v === 'COMMENT' && isId(i + 1, 'ON') && (isId(i + 2, 'TABLE') || isId(i + 2, 'COLUMN') ||
            (isId(i + 2, 'MATERIALIZED') && isId(i + 3, 'VIEW')))) {
            i = parseComment(i + 2);
            continue;
        }

        if (t.v === 'CREATE') {
            let j = i + 1;
            while (isId(j) && CREATE_SKIP.has(toks[j].v)) j++;
            if (!isId(j)) continue;
            const kw = toks[j].v;
            j++;
            let kind = null;
            let role = 'body';
            switch (kw) {
                case 'PACKAGE':
                    if (isId(j, 'BODY')) { j++; kind = 'packageBody'; } else { kind = 'package'; role = 'spec'; }
                    break;
                case 'TYPE':
                    if (isId(j, 'BODY')) { j++; kind = 'typeBody'; } else { kind = 'type'; role = 'spec'; }
                    break;
                case 'PROCEDURE': case 'FUNCTION': case 'TRIGGER': case 'TABLE': case 'VIEW':
                case 'SEQUENCE': case 'SYNONYM': case 'LIBRARY': case 'CONTEXT':
                    kind = kw.toLowerCase();
                    break;
                case 'MATERIALIZED':
                    if (isId(j, 'VIEW') && !isId(j + 1, 'LOG')) { j++; kind = 'mview'; }
                    break;
            }
            if (!kind) { container = null; specStmtStart = false; continue; }
            if (isId(j, 'IF') && isId(j + 1, 'NOT') && isId(j + 2, 'EXISTS')) j += 3;
            if (!isId(j)) continue;
            let schema = null;
            let nameTok = toks[j];
            if (isP(j + 1, '.') && isId(j + 2)) { schema = nameTok.v; nameTok = toks[j + 2]; j += 2; }

            const symKind = kind === 'packageBody' ? 'package' : kind === 'typeBody' ? 'type' : kind;
            const sym = mk(nameTok, { kind: symKind, container: null, schema, role, local: false });
            sym.startLine = lines.pos(t.s).line;
            tops.push(sym);

            if (kind === 'procedure' || kind === 'function') {
                const r = scanSubprogramEnd(j + 1);
                sym.detail = signature(i, r.end, !r.body);
            } else if (kind === 'package' || kind === 'type') {
                sym.doc = docAbove(lines, sym.startLine);
            } else if (kind === 'synonym') {
                if (isId(j + 1, 'FOR')) {
                    const tn = tableName(j + 2);
                    if (tn.name) sym.target = tn.name;
                }
            } else if (kind === 'table') {
                if (isP(j + 1, '(')) {
                    const r = parseColumnList(j + 1, nameTok.v, 0);
                    j = r.end;
                }
                container = null;
                specStmtStart = false;
                i = j;
                continue;
            }

            container = { kind, name: nameTok.v, schema };
            specStmtStart = false;
            if (kind === 'package') {
                // skip header (AUTHID ..., ACCESSIBLE BY (...)) up to IS/AS
                let k = j + 1, depth = 0;
                for (; k < toks.length && k < j + 200; k++) {
                    if (isP(k, '(')) depth++;
                    else if (isP(k, ')')) depth--;
                    else if (depth === 0 && (isId(k, 'IS') || isId(k, 'AS'))) break;
                }
                i = k;
                specStmtStart = true;
            } else {
                i = j;
            }
            continue;
        }

        // ---- package specification items (constants, variables, types, cursors, exceptions)
        if (container && container.kind === 'package' && specStmtStart) {
            specStmtStart = false;
            if ((t.v === 'TYPE' || t.v === 'SUBTYPE' || t.v === 'CURSOR') && isId(i + 1)) {
                const kind = t.v === 'CURSOR' ? 'cursor' : 'typedef';
                const end = scanToSemicolon(i);
                const s = mk(toks[i + 1], { kind, container: container.name, schema: container.schema, role: 'spec', local: false });
                s.startLine = lines.pos(t.s).line;
                s.detail = signature(i, end, true);
                s.doc = docAbove(lines, s.startLine);
                i = i + 1;
                continue;
            }
            if (!SPEC_SKIP_STMT.has(t.v)) {
                const next = isId(i + 1) ? toks[i + 1].v : '';
                const kind = next === 'CONSTANT' ? 'constant' : next === 'EXCEPTION' ? 'exception' : 'variable';
                const end = scanToSemicolon(i);
                const s = mk(t, { kind, container: container.name, schema: container.schema, role: 'spec', local: false });
                s.detail = signature(i, end, true);
                s.doc = docAbove(lines, s.startLine);
                continue;
            }
        }

        // ---- procedures / functions inside packages, types, other blocks
        if ((t.v === 'PROCEDURE' || t.v === 'FUNCTION') && isId(i + 1)) {
            if (i > 0 && toks[i - 1].t === 'id' && NOT_SUBPROGRAM_PREV.has(toks[i - 1].v)) continue;
            const r = scanSubprogramEnd(i + 2);
            const inPkg = container && (container.kind === 'package' || container.kind === 'packageBody' ||
                container.kind === 'type' || container.kind === 'typeBody');
            const isSpec = container && (container.kind === 'package' || container.kind === 'type');
            const role = r.body ? 'body' : (isSpec ? 'spec' : 'forward');
            // first token of the statement (MEMBER/STATIC/CONSTRUCTOR/OVERRIDING ...)
            let first = i;
            while (first > 0 && toks[first - 1].t === 'id' &&
                ['MEMBER', 'STATIC', 'CONSTRUCTOR', 'MAP', 'ORDER', 'OVERRIDING', 'FINAL', 'INSTANTIABLE', 'NOT'].includes(toks[first - 1].v)) first--;
            const s = mk(toks[i + 1], {
                kind: t.v === 'PROCEDURE' ? 'procedure' : 'function',
                container: container ? container.name : null,
                schema: container ? container.schema : null,
                role,
                local: !inPkg
            });
            s.startLine = lines.pos(toks[first].s).line;
            s.detail = signature(first, r.end, !r.body);
            if (role !== 'body' || !isSpec) s.doc = docAbove(lines, s.startLine);
            if (container && container.kind === 'package') specStmtStart = true; // its ';' was consumed below
            i = Math.max(i + 1, r.body ? r.end : r.end);
            continue;
        }
    }

    // ------------------------------------------------------------------ tables
    // tableParts: { table, columns?: [{name, type, nullable, dflt, order}], pk?: [cols],
    //               fks?: [{cols, ref, refCols}], comment?, colComments?: {COL: text} }
    function tableName(k) {
        // [schema.]name -> { name, next }
        if (!isId(k)) return { name: null, next: k };
        if (isP(k + 1, '.') && isId(k + 2)) return { name: toks[k + 2].v, next: k + 3 };
        return { name: toks[k].v, next: k + 1 };
    }

    function identList(k) {
        // ( a, b, c ) starting at '(' -> { list, end }
        const list = [];
        let m = k + 1;
        for (; m < toks.length && !isP(m, ')'); m++) if (toks[m].t === 'id') list.push(toks[m].v);
        return { list, end: m };
    }

    /** constraint starting at k (CONSTRAINT name | PRIMARY | FOREIGN ...), adds to part */
    function parseConstraint(k, part, colName) {
        if (isId(k, 'CONSTRAINT') && isId(k + 1)) k += 2;
        if (isId(k, 'PRIMARY') && isId(k + 1, 'KEY')) {
            if (isP(k + 2, '(')) { const r = identList(k + 2); part.pk = r.list; }
            else if (colName) part.pk = [colName];
        } else if (isId(k, 'FOREIGN') && isId(k + 1, 'KEY') && isP(k + 2, '(')) {
            const r = identList(k + 2);
            let m = r.end + 1;
            if (isId(m, 'REFERENCES')) {
                const tn = tableName(m + 1);
                const rc = isP(tn.next, '(') ? identList(tn.next).list : [];
                (part.fks = part.fks || []).push({ cols: r.list, ref: tn.name, refCols: rc });
            }
        } else if (isId(k, 'REFERENCES') && colName) {
            const tn = tableName(k + 1);
            const rc = isP(tn.next, '(') ? identList(tn.next).list : [];
            (part.fks = part.fks || []).push({ cols: [colName], ref: tn.name, refCols: rc });
        }
    }

    /** "( col type ..., constraint ... )" starting at '(' */
    function parseColumnList(k, table, order) {
        const part = { table, columns: [] };
        tableParts.push(part);
        let depth = 0, itemStart = k + 1, m = k;
        const items = [];
        for (; m < toks.length; m++) {
            if (isP(m, '(')) depth++;
            else if (isP(m, ')')) { depth--; if (depth === 0) { items.push([itemStart, m]); break; } }
            else if (isP(m, ',') && depth === 1) { items.push([itemStart, m]); itemStart = m + 1; }
            else if (isP(m, ';')) break;
        }
        for (const [a, b] of items) parseColumnItem(a, b, part, order++);
        return { end: m, order };
    }

    function parseColumnItem(a, b, part, order) {
        if (a >= b || !isId(a)) return;
        const f = toks[a].v;
        if (f === 'CONSTRAINT' || f === 'CHECK' || f === 'SUPPLEMENTAL' ||
            ((f === 'PRIMARY' || f === 'FOREIGN') && isId(a + 1, 'KEY')) || (f === 'UNIQUE' && isP(a + 1, '('))) {
            parseConstraint(a, part);
            return;
        }
        const name = toks[a].v;
        let m = a + 1, depth = 0;
        // type: until first column attribute keyword at depth 0
        for (; m < b; m++) {
            if (isP(m, '(')) depth++;
            else if (isP(m, ')')) depth--;
            else if (depth === 0 && toks[m].t === 'id' && COL_ATTR.has(toks[m].v)) break;
        }
        const type = m > a + 1 ? text.slice(toks[a + 1].s, toks[m - 1].e).replace(/\s+/g, ' ').replace(/\s*\(\s*/g, '(').replace(/\s*\)/g, ')') : '';
        let nullable = true, dflt;
        for (let x = m; x < b; x++) {
            if (isId(x, 'NOT') && isId(x + 1, 'NULL')) nullable = false;
            else if (isId(x, 'DEFAULT')) {
                let y = x + 1;
                if (isId(y, 'ON') && isId(y + 1, 'NULL')) y += 2;
                let d = 0, z = y;
                for (; z < b; z++) {
                    if (isP(z, '(')) d++;
                    else if (isP(z, ')')) d--;
                    else if (d === 0 && toks[z].t === 'id' && COL_ATTR.has(toks[z].v)) break;
                }
                if (z > y) dflt = text.slice(toks[y].s, toks[z - 1].e).replace(/\s+/g, ' ');
                x = z - 1;
            } else if (isId(x, 'PRIMARY') || isId(x, 'REFERENCES') || isId(x, 'CONSTRAINT')) {
                parseConstraint(x, part, name);
            }
        }
        part.columns.push({ name, display: text.slice(toks[a].s, toks[a].e).replace(/"/g, ''), type, nullable, dflt, order });
    }

    function parseAlterTable(k) {
        const tn = tableName(k);
        if (!tn.name) return k;
        let m = tn.next;
        const end = scanToSemicolon(m);
        while (m < end) {
            if (isId(m, 'ADD')) {
                if (isP(m + 1, '(')) {
                    const r = parseColumnList(m + 1, tn.name, 1000);
                    m = r.end + 1;
                    continue;
                }
                if (isId(m + 1) && TABLE_CONSTRAINT.has(toks[m + 1].v)) {
                    const part = { table: tn.name };
                    tableParts.push(part);
                    parseConstraint(m + 1, part);
                } else if (isId(m + 1)) {
                    // ADD col type ...  (single column without parentheses)
                    const part = { table: tn.name, columns: [] };
                    tableParts.push(part);
                    let b = m + 1, d = 0;
                    for (; b < end; b++) {
                        if (isP(b, '(')) d++;
                        else if (isP(b, ')')) d--;
                        else if (d === 0 && (isP(b, ',') || isId(b, 'ADD'))) break;
                    }
                    parseColumnItem(m + 1, b, part, 1000);
                    m = b;
                    continue;
                }
            }
            m++;
        }
        return end;
    }

    function parseComment(k) {
        const isColumn = isId(k, 'COLUMN');
        k += isId(k, 'MATERIALIZED') ? 2 : 1;
        // [schema.]table[.column]
        const ids = [];
        let m = k;
        while (isId(m)) { ids.push(toks[m].v); if (isP(m + 1, '.')) m += 2; else { m++; break; } }
        if (!isId(m, 'IS') || !toks[m + 1] || toks[m + 1].t !== 's') return m;
        const str = toks[m + 1].str;
        if (isColumn && ids.length >= 2) {
            const col = ids[ids.length - 1], table = ids[ids.length - 2];
            tableParts.push({ table, colComments: { [col]: str } });
        } else if (!isColumn && ids.length >= 1) {
            tableParts.push({ table: ids[ids.length - 1], comment: str });
        }
        return m + 1;
    }

    function scanToSemicolon(k) {
        let depth = 0;
        for (let m = k; m < toks.length && m < k + 2000; m++) {
            if (toks[m].t !== 'p') continue;
            if (toks[m].v === '(') depth++;
            else if (toks[m].v === ')') depth--;
            else if (toks[m].v === ';' && depth <= 0) return m;
        }
        return Math.min(toks.length - 1, k + 1);
    }

    /**
     * Local declarations with lexical scope: parameters, declare-section items,
     * FOR/FORALL loop variables, package-body globals.
     * A frame stack follows BEGIN/DECLARE/CASE ... END nesting.
     */
    function parseLocals() {
        const locals = [];
        let stack = [];
        let paren = 0;
        let stmtStart = false;
        let pendingTrigger = null;
        const top = () => stack[stack.length - 1];
        const inDecl = () => top() && top().state === 'decl';
        function newCaller(nameTok) {
            if (!collectCalls) return undefined;
            const c = { nameTok, refs: [] };
            callers.push(c);
            return c;
        }

        function addLocal(nameTok, kind, endTok, frame) {
            frame.vars.push({ tok: nameTok, kind, endTok });
        }
        function closeFrame(frame, endOffset) {
            for (const v of frame.vars) {
                const p = lines.pos(v.tok.s);
                const sp = lines.pos(v.tok.s);
                const ep = lines.pos(endOffset);
                const detEnd = v.endTok !== undefined && v.endTok < toks.length ? toks[v.endTok].s : v.tok.e;
                let detail = text.slice(v.tok.s, Math.max(v.tok.e, detEnd)).replace(/\s+/g, ' ').trim();
                if (detail.length > 300) detail = detail.slice(0, 300) + ' ...';
                locals.push({
                    name: v.tok.v,
                    display: text.slice(v.tok.s, v.tok.e).replace(/"/g, ''),
                    kind: v.kind,
                    line: p.line,
                    character: p.character,
                    endCharacter: p.character + (v.tok.e - v.tok.s),
                    startLine: p.line,
                    endLine: p.line,
                    scopeStart: sp,
                    scopeEnd: ep,
                    detail
                });
            }
        }
        function pop(endOffset) {
            const f = stack.pop();
            if (f) closeFrame(f, endOffset);
        }
        /** end of a declaration statement (';' at paren depth 0) */
        function stmtEnd(k) {
            let d = 0;
            for (let m = k; m < toks.length && m < k + 3000; m++) {
                const t = toks[m];
                if (t.t !== 'p') continue;
                if (t.v === '(') d++;
                else if (t.v === ')') d--;
                else if (t.v === ';' && d <= 0) return m;
            }
            return k;
        }

        for (let i = 0; i < toks.length; i++) {
            const t = toks[i];
            if (t.t === 'p') {
                if (t.v === '(') paren++;
                else if (t.v === ')') paren = Math.max(0, paren - 1);
                else if (t.v === ';' && paren === 0) stmtStart = inDecl();
                continue;
            }
            if (t.t === 's' || t.t === 'n') { stmtStart = false; continue; }
            if (i > 0 && toks[i - 1].t === 'p' && toks[i - 1].v === '$') continue; // $IF / $END
            const v = t.v;

            // ---- call graph: identifier chains used inside a subprogram / trigger body
            if (collectCalls && !NOT_CALL.has(v) && !(i > 0 && (isP(i - 1, '.') || isP(i - 1, '%') || isId(i - 1, 'END')))) {
                let caller;
                for (let k = stack.length - 1; k >= 0; k--) if (stack[k].calls) { caller = stack[k].calls; break; }
                if (caller) {
                    let m = i;
                    const parts = [v];
                    while (isP(m + 1, '.') && isId(m + 2)) { parts.push(toks[m + 2].v); m += 2; }
                    if (!(isP(m + 1, '=') && isP(m + 2, '>'))) caller.refs.push({ parts, off: toks[m].s });
                }
            }

            if (v === 'CREATE') {
                while (stack.length) pop(t.s);
                paren = 0;
                pendingTrigger = null;
                let j = i + 1;
                while (isId(j) && CREATE_SKIP.has(toks[j].v)) j++;
                if (isId(j, 'TRIGGER') && isId(j + 1)) {
                    pendingTrigger = isP(j + 2, '.') && isId(j + 3) ? toks[j + 3] : toks[j + 1];
                }
                if ((isId(j, 'PACKAGE') || isId(j, 'TYPE')) && isId(j + 1, 'BODY')) {
                    let k = j + 2;
                    while (k < toks.length && k < j + 50 && !isId(k, 'IS') && !isId(k, 'AS')) k++;
                    stack.push({ state: 'decl', vars: [] });
                    stmtStart = true;
                    i = k;
                } else {
                    stmtStart = false;
                }
                continue;
            }

            if ((v === 'PROCEDURE' || v === 'FUNCTION') && isId(i + 1) &&
                !(i > 0 && toks[i - 1].t === 'id' && NOT_SUBPROGRAM_PREV.has(toks[i - 1].v))) {
                let j = i + 2;
                const nameTok = isP(j, '.') && isId(j + 1) ? toks[j + 1] : toks[i + 1];
                if (isP(j, '.') && isId(j + 1)) j += 2; // schema.name
                const params = [];
                if (isP(j, '(')) {
                    let d = 0, expectName = true, k = j;
                    for (; k < toks.length; k++) {
                        const tk = toks[k];
                        if (tk.t === 'p') {
                            if (tk.v === '(') { d++; if (d === 1) { expectName = true; continue; } }
                            else if (tk.v === ')') { d--; if (d === 0) break; }
                            else if (tk.v === ',' && d === 1) { params[params.length - 1] && (params[params.length - 1].endTok = k); expectName = true; continue; }
                        } else if (expectName && d === 1 && tk.t === 'id') {
                            params.push({ tok: tk, kind: 'parameter' });
                        }
                        expectName = false;
                    }
                    if (params.length) params[params.length - 1].endTok = params[params.length - 1].endTok || k;
                }
                const r = scanSubprogramEnd(j);
                if (r.body) {
                    stack.push({ state: 'decl', vars: params, calls: newCaller(nameTok) });
                    stmtStart = true;
                } else {
                    stmtStart = inDecl();
                }
                i = r.end;
                continue;
            }

            if (v === 'DECLARE') {
                const calls = pendingTrigger && !stack.length ? newCaller(pendingTrigger) : undefined;
                pendingTrigger = null;
                stack.push({ state: 'decl', vars: [], calls });
                stmtStart = true;
                continue;
            }
            if (v === 'BEGIN') {
                if (inDecl()) top().state = 'body';
                else {
                    const calls = pendingTrigger && !stack.length ? newCaller(pendingTrigger) : undefined;
                    pendingTrigger = null;
                    stack.push({ state: 'body', vars: [], calls });
                }
                stmtStart = false;
                continue;
            }
            if (v === 'CASE' && !(i > 0 && toks[i - 1].v === 'END')) { stack.push({ state: 'case', vars: [] }); continue; }
            if (v === 'END') {
                if (isId(i + 1, 'IF') || isId(i + 1, 'LOOP')) { i++; continue; }
                pop(t.s);
                if (isId(i + 1, 'CASE')) i++;
                stmtStart = false;
                continue;
            }

            if ((v === 'FOR' || v === 'FORALL') && isId(i + 1) && isId(i + 2, 'IN') && top()) {
                const f = top();
                // loop variable: visible until the end of the enclosing block (approximation)
                f.vars.push({ tok: toks[i + 1], kind: 'loop variable', endTok: i + 2 });
                continue;
            }

            if (stmtStart && inDecl() && paren === 0) {
                stmtStart = false;
                const f = top();
                if ((v === 'TYPE' || v === 'SUBTYPE' || v === 'CURSOR') && isId(i + 1)) {
                    const end = stmtEnd(i);
                    addLocal(toks[i + 1], v === 'CURSOR' ? 'cursor' : 'type', end, f);
                    i++;
                    continue;
                }
                if (v === 'PRAGMA') continue;
                const next = isId(i + 1) ? toks[i + 1].v : '';
                const kind = next === 'CONSTANT' ? 'constant' : next === 'EXCEPTION' ? 'exception' : 'variable';
                addLocal(t, kind, stmtEnd(i), f);
                continue;
            }
            stmtStart = false;
        }
        while (stack.length) pop(text.length);
        return locals;
    }

    // extents of top-level objects: until the next top-level object
    for (let k = 0; k < tops.length; k++) {
        tops[k].endLine = k + 1 < tops.length ? Math.max(tops[k].line, tops[k + 1].startLine - 1) : lines.count - 1;
    }
    // members: until the next symbol start (approximation good enough for outline)
    const sorted = symbols.slice().sort((a, b) => a.startLine - b.startLine);
    for (let k = 0; k < sorted.length; k++) {
        const s = sorted[k];
        if (s.endLine !== undefined) continue;
        let e = lines.count - 1;
        for (let m = k + 1; m < sorted.length; m++) {
            if (sorted[m].startLine > s.startLine) { e = sorted[m].startLine - 1; break; }
        }
        const top = tops.find(o => o.startLine <= s.startLine && s.startLine <= o.endLine);
        if (top) e = Math.min(e, top.endLine);
        s.endLine = Math.max(s.line, e);
    }
    const details = tableParts.filter((p) => p.table).map((p) => Object.assign(p, { key: 'TABLE:' + p.table }));
    const locals = parseLocals();
    const result = { symbols, locals, details };
    if (collectCalls) {
        // calls: [{ caller: {line, character}, refs: [{ parts: [NAME...], line, character }] }]
        result.calls = callers.map((c) => ({
            caller: lines.pos(c.nameTok.s),
            refs: c.refs.map((r) => Object.assign({ parts: r.parts }, lines.pos(r.off)))
        }));
    }
    return result;
}

module.exports = { parse, tokenize, isIdPart, isIdStart };
