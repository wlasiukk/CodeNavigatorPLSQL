# <img src="images/icon.png" width="32" height="32" alt="" align="top"> Code Navigator (PL/SQL)

Offline Ctrl+Click navigation for Oracle PL/SQL source trees. No database connection
needed: all files in the opened folder / workspace folders are indexed in memory.

## Navigation

| Gesture | Result |
|---|---|
| **Ctrl+Click** / F12 | definition: procedure/function **body**, package body, type body, table, view, sequence... |
| **Ctrl+Shift+Click** | declaration: the **package spec** entry (falls back to body for private subprograms) |
| Ctrl+Shift+F12 / context menu *Go to Package Declaration* | same as Ctrl+Shift+Click, from the keyboard |
| Ctrl+F12 | implementation (body) |
| Ctrl+Click on a name that *is* the target | toggles spec <-> body (overloads are matched by parameter list) |
| Hover | signature + comment from the package spec; locals show their declaration |
| Hover on a table | table comment + columns (type, NOT NULL, PK / FK -> table.col, default, comment), merged from `CREATE TABLE`, `ALTER TABLE ... ADD` and `COMMENT ON TABLE/COLUMN` in any file |
| Ctrl+T | workspace symbols, accepts `pkg.proc` |
| Ctrl+Shift+O / Outline | packages with their procedures/functions |

Resolves `proc`, `pkg.proc`, `schema.pkg.proc`, `pkg.constant`, `pkg.type`, object types,
standalone procedures/functions, tables, views, sequences, synonyms, triggers.
Local identifiers (same file, lexical scope): parameters, variables / constants / cursors /
types / exceptions of the declare section, FOR / FORALL loop variables, package-body globals;
inner declarations shadow outer ones and package/schema names.
Unqualified names are then looked up in the enclosing package, then at schema level.
Record fields (`rec.field`) are not resolved.

Indexed by default: `bdy spc pks pkb pkh pck pls plsql sql prc fnc trg tps tpb typ tab vw mvw syn seq`.
`.bdy/.spc/.prc/.fnc/.trg/.tps/.tpb/.typ/.pck` are also associated with the `oracle-sql`
language (Oracle SQL Developer extension highlighting).

## Settings

| Setting | Default | |
|---|---|---|
| `codeNav.exclude` | `**/{node_modules,.git,.svn,out,dist,target}/**` | e.g. add old copies: `**/{node_modules,.git,changes}/**` |
| `codeNav.plsql.include` | see above | |
| `codeNav.shiftClickDeclaration` | `true` | |
| `codeNav.hover` / `codeNav.documentSymbols` | `true` | |
| `codeNav.maxFileSizeKB` | `8192` | |

Command **Code Navigator: Rebuild Index**; log in Output -> *Code Navigator*.

## Call graph

Command **Code Navigator: Generate Call Graph (HTML)** writes one self-contained HTML file
(no internet needed, can be shared). Calls are resolved with the same rules as Ctrl+Click
(local variables / record fields are never counted; overloads are merged into one node).

* search by name or `pkg.name` (`/` focuses the search box, arrow keys + Enter)
* diagram: callers on the left, callees on the right; click a box to move there
* expandable **Callers** tree (who calls it, and who calls those...) and **Callees** tree,
  cycles marked; *expand all* opens up to 6 levels
* direct and transitive caller/callee counts
* `↗` / file links open the source in VS Code (`vscode://file/...`); browser Back/Forward work

Not visible: dynamic SQL (`EXECUTE IMMEDIATE`), calls from APEX/Java/jobs, calls to objects
outside the indexed sources (DBMS_*, UTL_*, ...).

### How Ctrl+Shift+Click works
VS Code gives extensions no access to mouse modifiers. Shift+mouse-down extends the
selection just before VS Code asks for the definition; the extension sees that mouse
selection change (anchor elsewhere, end on the clicked word) and answers with the declaration.
Requires the default `editor.multiCursorModifier: "alt"`.

## Build / install (no node required)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\pack.ps1 -Install
```
then *Developer: Reload Window*. For development: `code --extensionDevelopmentPath=<this folder>`.

## Adding a language
See [src/languages/README.md](src/languages/README.md).
