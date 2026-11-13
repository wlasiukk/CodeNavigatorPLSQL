'use strict';
const vscode = require('vscode');
const adapters = require('./src/languages');
const { WorkspaceIndexer } = require('./src/core/indexer');
const { ClickTracker } = require('./src/core/clickTracker');
const { registerProviders } = require('./src/core/providers');
const { buildCallGraph } = require('./src/core/callGraph');
const { renderCallGraphHtml } = require('./src/core/callGraphHtml');

function activate(context) {
    const out = vscode.window.createOutputChannel('Code Navigator');
    const log = (m) => out.appendLine(`[${new Date().toLocaleTimeString()}] ${m}`);
    const clickTracker = new ClickTracker();
    context.subscriptions.push(out, clickTracker);

    const langs = adapters.map((adapter) => {
        const indexer = new WorkspaceIndexer(adapter, log);
        const { disposables, goTo } = registerProviders(indexer, clickTracker);
        context.subscriptions.push(indexer, ...disposables);
        indexer.start();
        return { adapter, indexer, goTo };
    });

    const updateContext = () => {
        const ed = vscode.window.activeTextEditor;
        const ok = !!ed && langs.some((l) => l.indexer.handles(ed.document));
        vscode.commands.executeCommand('setContext', 'codeNav.supportedFile', ok);
    };
    updateContext();

    const goTo = async (mode) => {
        for (const l of langs) if (await l.goTo(mode)) return;
    };

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(updateContext),
        vscode.commands.registerCommand('codeNav.goToDeclaration', () => goTo('declaration')),
        vscode.commands.registerCommand('codeNav.goToDefinition', () => goTo('definition')),
        vscode.commands.registerCommand('codeNav.rebuildIndex', () => langs.forEach((l) => l.indexer.rebuild())),
        vscode.commands.registerCommand('codeNav.generateCallGraph', () => generateCallGraph(langs, log)),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (langs.some((l) => e.affectsConfiguration(`codeNav.${l.adapter.id}.include`))) {
                vscode.window.showInformationMessage('Code Navigator: include pattern changed - reload the window to apply.');
            } else if (e.affectsConfiguration('codeNav.exclude') || e.affectsConfiguration('codeNav.maxFileSizeKB')) {
                langs.forEach((l) => l.indexer.rebuild());
            }
        })
    );
}

async function generateCallGraph(langs, log) {
    const candidates = langs.filter((l) => l.adapter.parseCalls);
    if (!candidates.length) return;
    let lang = candidates[0];
    if (candidates.length > 1) {
        const pick = await vscode.window.showQuickPick(candidates.map((l) => ({ label: l.adapter.label, l })), { placeHolder: 'Language' });
        if (!pick) return;
        lang = pick.l;
    }
    const { adapter, indexer } = lang;
    const folders = vscode.workspace.workspaceFolders || [];
    const target = await vscode.window.showSaveDialog({
        defaultUri: folders.length ? vscode.Uri.joinPath(folders[0].uri, 'call-graph.html') : undefined,
        filters: { HTML: ['html'] },
        saveLabel: 'Generate call graph',
        title: `Save ${adapter.label} call graph as`
    });
    if (!target) return;

    const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `${adapter.label} call graph`,
        cancellable: true
    }, async (progress, token) => {
        progress.report({ message: 'waiting for index…' });
        await indexer.ready;
        const t0 = Date.now();
        let last = 0;
        const graph = await buildCallGraph(adapter, indexer.store, (u) => readText(vscode.Uri.parse(u)), {
            filter: (u) => !indexer.isExcluded(vscode.Uri.parse(u)),
            isCancelled: () => token.isCancellationRequested,
            onProgress: (done, total) => {
                const pct = Math.floor((done / total) * 100);
                progress.report({ message: `${done}/${total} files`, increment: pct - last });
                last = pct;
            }
        });
        if (!graph) return undefined;
        graph.files = graph.files.map((u) => {
            const uri = vscode.Uri.parse(u);
            return { rel: vscode.workspace.asRelativePath(uri, folders.length > 1), abs: uri.fsPath.replace(/\\/g, '/') };
        });
        const title = vscode.workspace.name || (folders[0] && folders[0].name) || 'workspace';
        const html = renderCallGraphHtml(graph, { title, generated: new Date().toLocaleString() });
        await vscode.workspace.fs.writeFile(target, Buffer.from(html, 'utf8'));
        log(`call graph: ${graph.nodes.length} nodes, ${graph.edgeCount} edges, ${Math.round(html.length / 1024)} KB, ${Date.now() - t0} ms -> ${target.fsPath}`);
        return graph;
    });
    if (!result) return;
    const choice = await vscode.window.showInformationMessage(
        `Call graph written: ${result.nodes.length} procedures/functions, ${result.edgeCount} call edges.`,
        'Open in Browser', 'Reveal File');
    if (choice === 'Open in Browser') vscode.env.openExternal(target);
    else if (choice === 'Reveal File') vscode.commands.executeCommand('revealFileInOS', target);
}

async function readText(uri) {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (open) return open.getText();
    try {
        return new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
    } catch (e) {
        return undefined;
    }
}

function deactivate() { }

module.exports = { activate, deactivate };
