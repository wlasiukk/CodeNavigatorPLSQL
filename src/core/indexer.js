'use strict';
const vscode = require('vscode');
const fs = require('fs');
const { SymbolStore } = require('./store');
const { globToRegExp } = require('./glob');

const decoder = new TextDecoder('utf-8');

/** Builds and maintains the SymbolStore of one language adapter for all workspace folders. */
class WorkspaceIndexer {
    constructor(adapter, log) {
        this.adapter = adapter;
        this.log = log;
        this.store = new SymbolStore();
        this.disposables = [];
        this.pending = new Map(); // uri -> timer
        this.ready = Promise.resolve();
        this.generation = 0;
        this.readConfig();
    }

    /** Settings are resource scoped: each workspace folder may have its own include/exclude. */
    folderConfig(scope) {
        const cfg = vscode.workspace.getConfiguration('codeNav', scope);
        const include = cfg.get(`${this.adapter.id}.include`) || this.adapter.defaultInclude;
        const exclude = cfg.get('exclude') || '';
        return {
            include,
            exclude,
            includeRe: globToRegExp(include),
            excludeRe: exclude ? globToRegExp(exclude) : null
        };
    }

    readConfig() {
        const cfg = vscode.workspace.getConfiguration('codeNav');
        this.include = cfg.get(`${this.adapter.id}.include`) || this.adapter.defaultInclude;
        this.maxBytes = (cfg.get('maxFileSizeKB') || 8192) * 1024;
        this.configs = new Map(); // folder uri -> folderConfig
        for (const f of vscode.workspace.workspaceFolders || []) this.configs.set(f.uri.toString(), this.folderConfig(f));
        this.defaultConfig = this.folderConfig(undefined);
    }

    configFor(uri) {
        const f = vscode.workspace.getWorkspaceFolder(uri);
        return (f && this.configs.get(f.uri.toString())) || this.defaultConfig;
    }

    get selector() {
        return [
            { scheme: 'file', pattern: this.include },
            { scheme: 'untitled', pattern: this.include },
            ...this.adapter.languageIds.map((language) => ({ language }))
        ];
    }

    accepts(uri) {
        const c = this.configFor(uri);
        const f = vscode.workspace.getWorkspaceFolder(uri);
        // exclude is matched relative to the workspace folder (so a folder named e.g. "changes" above the root does not matter)
        const rel = f ? '/' + vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/') : uri.path;
        return c.includeRe.test(rel) && !(c.excludeRe && c.excludeRe.test(rel));
    }

    isExcluded(uri) {
        const f = vscode.workspace.getWorkspaceFolder(uri);
        if (!f) return false;
        const c = this.configFor(uri);
        const rel = '/' + vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
        return !!(c.excludeRe && c.excludeRe.test(rel));
    }

    start() {
        this.watch();
        return this.rebuild();
    }

    rebuild() {
        this.readConfig();
        const gen = ++this.generation;
        this.store.clear();
        this.ready = vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `${this.adapter.label} index` },
            async (progress) => {
                const t0 = Date.now();
                const uris = [];
                for (const f of vscode.workspace.workspaceFolders || []) {
                    const c = this.configs.get(f.uri.toString());
                    uris.push(...await vscode.workspace.findFiles(new vscode.RelativePattern(f, c.include), c.exclude || undefined));
                }
                const excl = [...this.configs.values()].map((c) => c.exclude).filter(Boolean).join(' | ');
                this.log(`${this.adapter.label}: exclude = ${excl || '(none)'}`);
                let done = 0;
                const batch = 24;
                for (let i = 0; i < uris.length; i += batch) {
                    if (gen !== this.generation) return;
                    await Promise.all(uris.slice(i, i + batch).map((u) => this.indexUri(u)));
                    done = Math.min(uris.length, i + batch);
                    progress.report({ message: `${done}/${uris.length}` });
                }
                // open (possibly dirty) documents win over disk content
                for (const doc of vscode.workspace.textDocuments) this.indexDocument(doc);
                this.log(`${this.adapter.label}: indexed ${uris.length} files, ${this.store.symbolCount} symbols in ${Date.now() - t0} ms`);
            }
        );
        return this.ready;
    }

    async indexUri(uri, fromDisk) {
        const open = !fromDisk && vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
        if (open) return this.indexDocument(open);
        try {
            let bytes;
            if (uri.scheme === 'file') {
                const st = await fs.promises.stat(uri.fsPath);
                if (st.size > this.maxBytes) return;
                bytes = await fs.promises.readFile(uri.fsPath);
            } else {
                bytes = await vscode.workspace.fs.readFile(uri);
                if (bytes.byteLength > this.maxBytes) return;
            }
            this.indexText(uri, decoder.decode(bytes));
        } catch (e) {
            this.store.removeFile(uri.toString());
        }
    }

    indexDocument(doc) {
        if (!this.handles(doc)) return;
        // excluded (or outside-workspace-include) files that are open are indexed as "hidden":
        // visible only to navigation started inside that same file
        this.indexText(doc.uri, doc.getText(), this.isExcluded(doc.uri));
    }

    /** Whether navigation works in this document (excluded files can still be navigated FROM). */
    handles(doc) {
        return (doc.uri.scheme === 'file' && this.includeMatches(doc.uri)) ||
            vscode.languages.match(this.selector, doc) > 0;
    }

    includeMatches(uri) {
        return this.configFor(uri).includeRe.test(uri.path);
    }

    /** Whether the document's symbols go into the index (excluded files never do). */
    indexText(uri, text, hidden) {
        try {
            const r = this.adapter.parse(text);
            const syms = Array.isArray(r) ? r : r.symbols;
            if (hidden) for (const s of syms) s.hidden = true;
            if (Array.isArray(r)) this.store.setFile(uri.toString(), syms);
            else this.store.setFile(uri.toString(), syms, r.locals, hidden ? undefined : r.details);
        } catch (e) {
            this.log(`parse error ${uri.fsPath}: ${e && e.stack}`);
        }
    }

    schedule(doc, delay) {
        const key = doc.uri.toString();
        clearTimeout(this.pending.get(key));
        this.pending.set(key, setTimeout(() => {
            this.pending.delete(key);
            this.indexDocument(doc);
        }, delay));
    }

    /** Make sure the document's latest text is indexed (called before resolving). */
    flush(doc) {
        const key = doc.uri.toString();
        if (this.pending.has(key)) {
            clearTimeout(this.pending.get(key));
            this.pending.delete(key);
            this.indexDocument(doc);
        } else if (!this.store.files.has(key)) {
            this.indexDocument(doc);
        }
    }

    watch() {
        const w = vscode.workspace.createFileSystemWatcher(this.include);
        const onDisk = (uri) => {
            if (!this.accepts(uri)) return;
            const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
            if (open && open.isDirty) return;
            this.indexUri(uri);
        };
        this.disposables.push(
            w,
            w.onDidCreate(onDisk),
            w.onDidChange(onDisk),
            w.onDidDelete((uri) => this.store.removeFile(uri.toString())),
            vscode.workspace.onDidOpenTextDocument((d) => this.handles(d) && this.schedule(d, 50)),
            vscode.workspace.onDidChangeTextDocument((e) => this.handles(e.document) && this.schedule(e.document, 700)),
            vscode.workspace.onDidCloseTextDocument((d) => {
                if (!this.handles(d)) return;
                clearTimeout(this.pending.get(d.uri.toString()));
                this.pending.delete(d.uri.toString());
                if (d.uri.scheme === 'file' && this.accepts(d.uri)) this.indexUri(d.uri, true); // drop unsaved edits
                else this.store.removeFile(d.uri.toString());
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.rebuild())
        );
    }

    dispose() {
        this.generation++;
        for (const t of this.pending.values()) clearTimeout(t);
        this.disposables.forEach((d) => d.dispose());
    }
}

module.exports = { WorkspaceIndexer };
