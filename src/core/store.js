'use strict';

/** In-memory symbol index for one language adapter. */
class SymbolStore {
    constructor() {
        this.files = new Map();   // uri string -> symbols[]
        this.names = new Map();   // NAME -> symbols[]
        this.schemas = new Map(); // SCHEMA -> count
        this.locals = new Map();  // uri string -> locals[] (scoped, same-file only)
        this.detailIndex = new Map(); // key (e.g. TABLE:NAME) -> detail parts from any file
        this.fileDetails = new Map(); // uri -> detail parts
        this.symbolCount = 0;
    }

    /** Extra language-specific metadata parts (e.g. table columns/comments) for a key, across files. */
    details(key) {
        return this.detailIndex.get(key) || [];
    }

    /** symbols: global symbols; locals: [{name, line, character, endCharacter, scopeStart, scopeEnd, ...}] */
    setFile(uri, symbols, locals, details) {
        this.removeFile(uri);
        if (locals && locals.length) {
            for (const l of locals) l.uri = uri;
            this.locals.set(uri, locals);
        }
        if (details && details.length) {
            for (const d of details) {
                d.uri = uri;
                let list = this.detailIndex.get(d.key);
                if (!list) this.detailIndex.set(d.key, (list = []));
                list.push(d);
            }
            this.fileDetails.set(uri, details);
        }
        for (const s of symbols) {
            s.uri = uri;
            let list = this.names.get(s.name);
            if (!list) this.names.set(s.name, (list = []));
            list.push(s);
            if (s.schema) this.schemas.set(s.schema, (this.schemas.get(s.schema) || 0) + 1);
        }
        this.files.set(uri, symbols);
        this.symbolCount += symbols.length;
    }

    removeFile(uri) {
        this.locals.delete(uri);
        const dets = this.fileDetails.get(uri);
        if (dets) {
            for (const d of dets) {
                const list = this.detailIndex.get(d.key);
                if (!list) continue;
                const i = list.indexOf(d);
                if (i >= 0) list.splice(i, 1);
                if (!list.length) this.detailIndex.delete(d.key);
            }
            this.fileDetails.delete(uri);
        }
        const old = this.files.get(uri);
        if (!old) return;
        for (const s of old) {
            const list = this.names.get(s.name);
            if (list) {
                const i = list.indexOf(s);
                if (i >= 0) list.splice(i, 1);
                if (!list.length) this.names.delete(s.name);
            }
            if (s.schema) {
                const c = (this.schemas.get(s.schema) || 1) - 1;
                if (c <= 0) this.schemas.delete(s.schema); else this.schemas.set(s.schema, c);
            }
        }
        this.symbolCount -= old.length;
        this.files.delete(uri);
    }

    clear() {
        this.files.clear();
        this.names.clear();
        this.schemas.clear();
        this.locals.clear();
        this.detailIndex.clear();
        this.fileDetails.clear();
        this.symbolCount = 0;
    }

    /** Innermost (latest declared) local named `name` whose scope contains line/character. */
    localAt(uri, name, line, character) {
        const list = this.locals.get(uri);
        if (!list) return undefined;
        const before = (a, b) => a.line < b.line || (a.line === b.line && a.character <= b.character);
        const pos = { line, character };
        let best;
        for (const l of list) {
            if (l.name !== name) continue;
            if (!before(l.scopeStart, pos) || !before(pos, l.scopeEnd)) continue;
            if (!best || before(best.scopeStart, l.scopeStart)) best = l;
        }
        return best;
    }

    byName(name) {
        return this.names.get(name) || [];
    }

    isSchema(name) {
        return this.schemas.has(name);
    }

    fileSymbols(uri) {
        return this.files.get(uri) || [];
    }

    /** Top-level object (package, type, procedure, trigger ...) whose extent contains the line. */
    containerAt(uri, line) {
        let best;
        for (const s of this.fileSymbols(uri)) {
            if (s.container || s.local) continue;
            if (s.startLine <= line && line <= s.endLine) {
                if (!best || s.startLine >= best.startLine) best = s;
            }
        }
        return best;
    }
}

module.exports = { SymbolStore };
