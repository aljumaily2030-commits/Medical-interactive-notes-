# Markdown Studio

Markdown Studio is a browser-based Markdown authoring workspace for technical notes, documentation, revision sheets, and long-form writing. It combines a CodeMirror editor, live preview, Mermaid diagrams, LaTeX math, image management, templates, per-file styling, snapshots, and export tools in a static web app that can run locally or be hosted as ordinary frontend assets.

The project is intentionally client-side: documents, templates, snapshots, settings, and images are stored in the browser with IndexedDB and can be exported for backup or portability.

## Highlights

- Live Markdown editing with editor, split, preview, and focus modes.
- CodeMirror-powered editing with native-style find/replace and paste-as-Markdown support.
- Mermaid rendering with cached diagram output, syntax error isolation, fullscreen viewer, pan/zoom, and SVG/PNG export.
- KaTeX math support for inline and display equations.
- Image library with upload, insertion, crop/resize tools, embedded export support, and workspace backup.
- Block-level preview controls for resize, alignment, borders, background, padding, and radius.
- Source-backed table editor for Markdown tables.
- Per-file visual styling, built-in document templates, and user-saved templates.
- Scroll synchronization with visual indicators.
- IndexedDB persistence with autosave queueing, schema versioning, snapshots, quota warnings, backup, and restore.
- Export options for Markdown, HTML, PDF print, Word-compatible `.doc`, JSON, workspace ZIP, and diagram SVG/PNG.

## Current Status

Markdown Studio is an actively developed static web application. The core editing, preview, persistence, and export flows are implemented and covered by static regression checks. A real `.docx` export path is still planned and should use a document-generation library rather than the current Word-compatible HTML `.doc` export.

## Quick Start

Use any static web server from the repository root:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

For dependency-based development and regression checks:

```bash
npm install
npm test
```

The app is static, so no backend service is required.

## Browser Requirements

Use a modern Chromium, Firefox, or Safari browser with support for:

- IndexedDB
- FileReader
- Blob downloads
- Clipboard APIs
- SVG rendering
- CSS custom properties

Some export and clipboard features may require a secure context depending on the browser.

## Project Structure

```text
.
├── index.html                  # Main application shell
├── assets/
│   └── style.css               # Application, editor, modal, and preview styling
├── scripts/
│   ├── script.js               # Main Vue application logic
│   ├── editor.js               # CodeMirror/fallback editor adapter
│   ├── storage.js              # IndexedDB persistence, autosave, backup/restore
│   ├── constants.js            # App constants and template exports
│   ├── constants/              # Split constants/data modules
│   ├── preview/
│   │   └── mermaid-renderer.js # Cached Mermaid rendering pipeline
│   └── vendor/                 # Bundled editor vendor entry/output
├── tests/
│   └── static-regression.mjs   # Static guard checks for critical behavior
├── reviews/                    # Review notes, fixed issues, roadmap progress
├── package.json
└── README.md
```

## Architecture

Markdown Studio uses Vue in the browser for state and UI, Marked for Markdown parsing, DOMPurify for sanitized HTML output, Mermaid for diagrams, KaTeX for math, Highlight.js for code highlighting, and CodeMirror for editing.

The preview is segmented around Mermaid blocks so normal typing does not force every diagram to rerender. Mermaid output is cached by source and theme, and unchanged rendered blocks keep their DOM where possible. The preview post-processing layer resolves images, applies block controls, and wires toolbar actions after each render pass.

Persistence is handled in IndexedDB through `scripts/storage.js`. Autosave writes are serialized to avoid stale writes winning over newer content, and file records carry a schema version for future migrations.

## Storage And Portability

Local browser storage contains:

- Markdown files
- File-level styles
- Image library entries
- User templates
- Settings
- Snapshots/history

Use workspace backup/restore or workspace ZIP export before clearing browser data, switching devices, or testing storage migrations.

## Export Capabilities

| Export | Purpose | Notes |
| --- | --- | --- |
| Markdown | Raw document source | Active file only |
| HTML | Standalone rendered document | Embeds app-managed images and metadata |
| PDF | Browser print workflow | Uses print settings |
| Word-compatible `.doc` | Opens in Word-compatible editors | HTML-based, not real `.docx` |
| JSON | Source plus metadata | Includes template/style metadata |
| Workspace ZIP | Portable workspace package | Includes all Markdown files, images, and metadata |
| Mermaid SVG/PNG | Diagram assets | Available from the Mermaid viewer |

## Development Workflow

Run the regression suite before handing off changes:

```bash
npm test
```

Useful syntax checks:

```bash
node --check scripts/script.js
node --check scripts/editor.js
node --check scripts/storage.js
node --check scripts/preview/mermaid-renderer.js
```

Whitespace checks:

```bash
git diff --check
```

## Security Notes

- Markdown-rendered HTML is sanitized before entering the preview.
- Mermaid viewer SVG snapshots are sanitized while preserving Mermaid label containers.
- Native `confirm`/`prompt` dialogs are avoided in favor of app-native dialogs.
- Raw iframe rendering is intentionally not allowed by the sanitizer.
- The app is fully client-side; sensitive content remains in the browser unless exported by the user.

## Deployment

Deploy the repository as static assets behind any web server or static hosting provider. Recommended production headers:

- Serve files over HTTPS.
- Set an appropriate `Content-Type` for JavaScript modules.
- Cache static assets with a versioned deployment strategy.
- Avoid clearing IndexedDB during normal deployments.

If the CDN-hosted libraries in `index.html` are not acceptable for your environment, vendor them locally or add a bundling step.

## Roadmap

Near-term work:

- Real `.docx` export using a document library.
- Browser smoke tests for core editing and export flows.
- Further extraction of feature modules from `scripts/script.js`.
- More robust import/export migration handling.

Completed reliability and authoring improvements are tracked in `reviews/REFACTORING_PROGRESS.md`.

## Contributing

Keep changes focused, preserve existing UI patterns, and update regression checks when modifying critical behavior. For UI work, verify desktop and narrow-screen layouts. For persistence or export work, include backup/restore and compatibility considerations in the review notes.

## License

Markdown Studio is released under the MIT License. See `LICENSE` for details.
