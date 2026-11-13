'use strict';
const vscode = require('vscode');

/**
 * VS Code does not pass keyboard modifiers to definition providers, and mouse gestures
 * cannot be rebound. Ctrl+Shift+Click is detected indirectly: the Shift+mouse-down
 * extends the selection (selection change of kind Mouse whose active end lands on the
 * clicked word and whose anchor is elsewhere) right before VS Code asks for the definition.
 */
class ClickTracker {
    constructor() {
        this.last = undefined;
        this.disposable = vscode.window.onDidChangeTextEditorSelection((e) => {
            if (e.kind !== vscode.TextEditorSelectionChangeKind.Mouse) return;
            const s = e.selections[0];
            this.last = {
                uri: e.textEditor.document.uri.toString(),
                time: Date.now(),
                empty: s.isEmpty,
                anchor: s.anchor,
                active: s.active
            };
        });
    }

    /** @param {vscode.Range} wordRange range of the clicked identifier */
    isShiftClick(document, wordRange) {
        const l = this.last;
        if (!l || l.empty || Date.now() - l.time > 2000) return false;
        if (l.uri !== document.uri.toString()) return false;
        if (!wordRange.contains(l.active)) return false;
        if (wordRange.contains(l.anchor)) return false; // double-click word selection
        return true;
    }

    dispose() {
        this.disposable.dispose();
    }
}

module.exports = { ClickTracker };
