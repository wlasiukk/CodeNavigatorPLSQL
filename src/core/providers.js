'use strict';
const vscode = require('vscode');
const { resolve } = require('./resolver');

const KIND = {
    package: vscode.SymbolKind.Package,
    type: vscode.SymbolKind.Class,
    procedure: vscode.SymbolKind.Method,
    function: vscode.SymbolKind.Function,
    trigger: vscode.SymbolKind.Event,
    table: vscode.SymbolKind.Struct,
    view: vscode.SymbolKind.Interface,
    mview: vscode.SymbolKind.Interface,
    sequence: vscode.SymbolKind.Number,
    synonym: vscode.SymbolKind.Key,
    constant: vscode.SymbolKind.Constant,
    variable: vscode.SymbolKind.Variable,
    exception: vscode.SymbolKind.Event,
    cursor: vscode.SymbolKind.Field,
    typedef: vscode.SymbolKind.TypeParameter,
    library: vscode.SymbolKind.Module,
    context: vscode.SymbolKind.Namespace
};

function roleLabel(s) {
    if (s.kind === 'package' || s.kind === 'type') return s.role === 'body' ? `${s.kind} body` : `${s.kind} spec`;
    return s.role === 'forward' ? `${s.kind} (forward declaration)` : s.kind;
}

/** Registers all navigation providers for one language adapter. */
function registerProviders(indexer, clickTracker) {
    const adapter = indexer.adapter;
    const store = indexer.store;
    const selector = indexer.selector;
    const cfg = () => vscode.workspace.getConfiguration('codeNav');

    function lookup(document, position, mode, includeSelf) {
        if (!indexer.handles(document)) return undefined;
        indexer.flush(document);
        const lineText = document.lineAt(position.line).text;
        const ref = adapter.getReference(lineText, position.character);
        if (!ref) return undefined;
        const part = ref.parts[ref.index];
        const origin = new vscode.Range(position.line, part.start, position.line, part.end);
        if (mode === 'auto') {
            mode = cfg().get('shiftClickDeclaration') && clickTracker.isShiftClick(document, origin)
                ? 'declaration' : 'definition';
        }
        const results = resolve(adapter, store, ref, {
            uri: document.uri.toString(),
            line: position.line,
            character: position.character,
            mode,
            includeSelf
        });
        return { origin, results };
    }

    function toLinks(r) {
        if (!r || !r.results.length) return undefined;
        return r.results.map((s) => {
            const uri = vscode.Uri.parse(s.uri);
            const sel = new vscode.Range(s.line, s.character, s.line, s.endCharacter);
            const sigLines = s.detail ? s.detail.split('\n').length : 1;
            const end = Math.max(s.line, Math.min(s.endLine ?? s.line, s.startLine + sigLines - 1));
            return {
                originSelectionRange: r.origin,
                targetUri: uri,
                targetRange: new vscode.Range(s.startLine, 0, end, 10000),
                targetSelectionRange: sel
            };
        });
    }

    const disposables = [];

    disposables.push(vscode.languages.registerDefinitionProvider(selector, {
        provideDefinition: (doc, pos) => toLinks(lookup(doc, pos, 'auto'))
    }));
    disposables.push(vscode.languages.registerDeclarationProvider(selector, {
        provideDeclaration: (doc, pos) => toLinks(lookup(doc, pos, 'declaration'))
    }));
    disposables.push(vscode.languages.registerImplementationProvider(selector, {
        provideImplementation: (doc, pos) => toLinks(lookup(doc, pos, 'definition'))
    }));

    disposables.push(vscode.languages.registerHoverProvider(selector, {
        provideHover(doc, pos) {
            if (!cfg().get('hover', true)) return undefined;
            const r = lookup(doc, pos, 'declaration', true);
            if (!r || !r.results.length) return undefined;
            const s = r.results[0];
            const md = new vscode.MarkdownString();
            md.supportHtml = false;
            const where = vscode.workspace.asRelativePath(vscode.Uri.parse(s.uri), true);
            const title = `${roleLabel(s)} **${s.container ? s.container.toLowerCase() + '.' : ''}${s.display}**`;
            md.appendMarkdown(`${title}  \n`);
            if (s.detail) md.appendCodeblock(s.detail, adapter.hoverLanguage);
            if (s.doc) md.appendText(s.doc + '\n');
            const extra = adapter.hoverMarkdown && adapter.hoverMarkdown(s, store);
            if (extra) md.appendMarkdown('\n' + extra + '\n');
            const target = vscode.Uri.parse(s.uri).with({ fragment: `L${s.line + 1},${s.character + 1}` });
            md.appendMarkdown(`\n[${where}:${s.line + 1}](${target.toString()})`);
            if (r.results.length > 1) md.appendMarkdown(` _(+${r.results.length - 1} more)_`);
            return new vscode.Hover(md, r.origin);
        }
    }));

    disposables.push(vscode.languages.registerDocumentSymbolProvider(selector, {
        provideDocumentSymbols(doc) {
            if (!cfg().get('documentSymbols', true) || !indexer.handles(doc)) return undefined;
            indexer.flush(doc);
            const syms = store.fileSymbols(doc.uri.toString());
            const tops = [];
            const all = syms.map((s) => {
                const range = new vscode.Range(s.startLine, 0, Math.max(s.endLine ?? s.line, s.line), 0);
                const sel = new vscode.Range(s.line, s.character, s.line, s.endCharacter);
                const ds = new vscode.DocumentSymbol(s.display, roleLabel(s), KIND[s.kind] || vscode.SymbolKind.Object,
                    range.contains(sel) ? range : sel, sel);
                return { s, ds };
            });
            for (const { s, ds } of all) {
                if (!s.container && !s.local) { tops.push(ds); continue; }
                const parent = all.find((p) => !p.s.container && !p.s.local && p.ds.range.contains(ds.range));
                if (parent) parent.ds.children.push(ds); else tops.push(ds);
            }
            return tops;
        }
    }));

    disposables.push(vscode.languages.registerWorkspaceSymbolProvider({
        provideWorkspaceSymbols(query) {
            const q = (adapter.caseInsensitive ? query.toUpperCase() : query).trim();
            if (!q) return [];
            let cq = null, nq = q;
            const dot = q.lastIndexOf('.');
            if (dot >= 0) { cq = q.slice(0, dot); nq = q.slice(dot + 1); }
            const out = [];
            for (const [name, list] of store.names) {
                if (nq && !name.includes(nq)) continue;
                for (const s of list) {
                    if (cq !== null && !(s.container || '').includes(cq)) continue;
                    if (s.role === 'forward' || s.local || s.hidden) continue;
                    out.push(new vscode.SymbolInformation(
                        s.display, KIND[s.kind] || vscode.SymbolKind.Object,
                        s.container ? s.container.toLowerCase() : roleLabel(s),
                        new vscode.Location(vscode.Uri.parse(s.uri), new vscode.Position(s.line, s.character))));
                    if (out.length >= 500) return out;
                }
            }
            return out;
        }
    }));

    /** Command based navigation (keyboard / context menu). */
    async function goTo(mode) {
        const ed = vscode.window.activeTextEditor;
        if (!ed || !indexer.handles(ed.document)) return false;
        const pos = ed.selection.active;
        const links = toLinks(lookup(ed.document, pos, mode));
        if (!links) {
            vscode.window.setStatusBarMessage(`${adapter.label}: no ${mode} found`, 3000);
            return true;
        }
        const locs = links.map((l) => new vscode.Location(l.targetUri, l.targetSelectionRange));
        await vscode.commands.executeCommand('editor.action.goToLocations', ed.document.uri, pos, locs, 'gotoAndPeek', `No ${mode} found`);
        return true;
    }

    return { disposables, goTo };
}

module.exports = { registerProviders };
