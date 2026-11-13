# Language adapters

Each language lives in `src/languages/<id>/index.js` and is listed in `src/languages/index.js`.
The core (`src/core`) does indexing, file watching, resolution and all VS Code providers;
an adapter only knows how to read its language.

## Contract

```js
module.exports = {
    id: 'mylang',                       // settings key: codeNav.mylang.include
    label: 'MyLang',                    // shown in status/progress
    defaultInclude: '**/*.{ext1,ext2}', // files to index (overridable in settings)
    languageIds: ['mylang'],            // VS Code language ids also handled
    caseInsensitive: false,             // true => names are upper-cased (PL/SQL)
    hoverLanguage: 'mylang',            // code-block language in hovers

    containerKinds: new Set(['class']),           // kinds that can qualify members (a.b)
    objectKinds: new Set(['class', 'function']),  // top-level kinds referable by bare name

    // Extract symbols from file text. Positions are 0-based.
    // Return either an array of global symbols, or { symbols, locals } where locals are
    // same-file declarations with lexical scope (innermost wins, they shadow globals):
    //   { name, display, kind, line, character, endCharacter, startLine, endLine,
    //     scopeStart: {line, character}, scopeEnd: {line, character}, detail }
    parse(text) {
        return [{
            name: 'FOO',          // normalised name used for lookup
            display: 'Foo',       // as written
            kind: 'function',     // see KIND map in src/core/providers.js
            container: 'BAR',     // owning container name or null for top-level
            schema: null,         // optional namespace prefix (e.g. DB schema)
            role: 'body',         // 'spec' (declaration) | 'forward' | 'body' (implementation)
            local: false,         // true => only visible inside the same file
            line, character, endCharacter,   // name position
            startLine, endLine,              // extent of the declaration
            detail: 'function Foo(a, b)',    // signature for hover / overload matching
            doc: 'optional comment text'
        }];
    },

    // Dotted identifier chain under the cursor, or undefined.
    getReference(lineText, character) {
        return { parts: [{ name: 'BAR', start: 4, end: 7 }, { name: 'FOO', start: 8, end: 11 }], index: 1 };
    }
};
```

Navigation semantics are shared: **definition** prefers `role: 'body'`, **declaration**
prefers `role: 'spec'`; clicking on a target itself toggles to its counterpart.
For a language with a different scoping model an adapter may export its own
`resolve(store, ref, ctx)`-style logic later; the current core resolver covers
`name`, `container.name` and `namespace.container.name`.

Test a parser offline with `test/run.js` (any node, incl. VS Code's bundled one).
