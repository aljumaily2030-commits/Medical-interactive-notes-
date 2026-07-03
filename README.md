# Markdown Studio

Markdown Studio is a client-side Markdown workspace for technical writing, study material, documentation, research notes, interactive exercises, and poster-ready academic content. It combines a CodeMirror editor, live preview, Mermaid diagrams, KaTeX math, image management, block customization, templates, snapshots, and export tooling in a static web app that can run locally or be deployed as ordinary frontend assets.

The app is intentionally browser-first. Files, settings, images, templates, snapshots, and workspace metadata are stored in IndexedDB, with backup and ZIP export flows for portability.

## Features

- Markdown editor with editor, split, preview, and focus modes.
- CodeMirror editing with search, replace, paste-as-Markdown, word wrap, and configurable font sizing.
- Live preview with syntax highlighting, KaTeX math, tables, images, and sanitized HTML.
- Mermaid diagrams with cached rendering, isolated syntax errors, fullscreen viewer, pan/zoom, and SVG/PNG export.
- Interactive QCM exercises using readable Markdown syntax, with modern custom controls, answer feedback, JSON export, and printable answer-sheet export.
- Research poster builder that converts document sections into fixed-size poster layouts with slots, drag/drop assignment, themes, and print-ready page sizing.
- Image library with upload, insertion, crop, resize, persistence, embedded export support, and workspace backup.
- Source-backed table editor for Markdown tables.
- Per-file preview styling for typography, width, padding, colors, block sizing, alignment, borders, backgrounds, table density, code wrapping, LaTeX sizing, and text wrapping.
- Multi-file workspace with search, drag reorder, autosave status, snapshots, backup/restore, quota warnings, and ZIP export.
- Built-in templates for research papers, CVs, technical docs, lab reports, algorithm revision sheets, QCM exams, notebook reports, research posters, business cases, and more.

## Quick Start

Serve the repository with any static web server:

```bash
python3 -m http.server 8000
```

Open:

```text
http://localhost:8000
```

Install development dependencies and run regression checks:

```bash
npm install
npm test
```

No backend service is required.

## Common Workflows

### Technical Notes

Write Markdown normally, insert code blocks, equations, Mermaid diagrams, and images, then export to HTML, PDF print, Markdown, JSON, Word-compatible `.doc`, or ZIP.

### QCM Exercises

Use the QCM syntax:

```markdown
?? What is the derivative of $x^2$?

- [ ] $x$
- [x] $2x$
- [ ] $x^3$

?! Apply the power rule.
```

The preview renders an interactive exercise. Export options appear automatically when the current file contains QCM blocks.

### Research Posters

Create a document with `##` sections, open Export, then choose Research Poster. The poster builder lets you assign sections to layout slots, choose size/orientation/theme, and print the poster with the correct page dimensions.

### Notebook Reports

Upload `.ipynb` files through the normal open/upload flow. Markdown cells, code cells, text outputs, HTML outputs, and images are converted into a styled Markdown Studio document.

## Export Capabilities

| Export | Purpose | Notes |
| --- | --- | --- |
| Markdown | Raw document source | Active file only |
| HTML | Standalone rendered document | Embeds app-managed images and metadata |
| PDF | Browser print workflow | Uses active print settings |
| Research Poster | Fixed-size academic poster | A0/A1/architectural sizes with slot layout |
| Word-compatible `.doc` | Opens in Word-compatible editors | HTML-based, not real `.docx` |
| JSON | Source plus metadata | Includes template/style metadata |
| QCM JSON | Structured exercise data | Questions, choices, correctness, explanations |
| QCM Sheet | Printable assessment HTML | Includes answer key |
| Workspace ZIP | Portable workspace package | Markdown files, images, and metadata |
| Mermaid SVG/PNG | Diagram assets | Available from the Mermaid viewer |

## Architecture

Markdown Studio uses Vue in the browser for state and UI, Marked for Markdown parsing, DOMPurify for sanitization, Mermaid for diagrams, KaTeX for math, Highlight.js for code highlighting, and CodeMirror for editing.

The preview is segmented around Mermaid blocks so normal typing does not force every diagram to rerender. Mermaid output is cached by source and theme, and unchanged rendered blocks keep their DOM where possible. Preview post-processing resolves image library paths, applies block controls, renders Mermaid blocks, activates QCM widgets, and wires table/block tooling.

Persistence is handled through IndexedDB in `scripts/storage.js`. Autosave writes are serialized so stale queued saves do not overwrite newer content. File records include an app schema version for future migrations.

## Project Structure

```text
.
├── index.html
├── assets/
│   └── style.css
├── scripts/
│   ├── script.js
│   ├── editor.js
│   ├── storage.js
│   ├── constants.js
│   ├── preview/
│   │   └── mermaid-renderer.js
│   └── vendor/
├── tests/
│   └── static-regression.mjs
├── reviews/
├── package.json
└── README.md
```

## Development

Run the regression suite before handing off changes:

```bash
npm test
```

Useful syntax checks:

```bash
node --check scripts/script.js
node --check scripts/constants.js
node --check scripts/editor.js
node --check scripts/storage.js
node --check scripts/preview/mermaid-renderer.js
```

Whitespace checks:

```bash
git diff --check
```

## Browser Requirements

Use a modern Chromium, Firefox, or Safari browser with support for IndexedDB, FileReader, Blob downloads, Clipboard APIs, SVG rendering, and CSS custom properties. Some clipboard and export features may require HTTPS or localhost depending on browser policy.

## Security And Data

- Markdown-rendered HTML is sanitized before entering the preview.
- Mermaid viewer SVG snapshots are sanitized while preserving Mermaid label containers.
- Raw iframe rendering is intentionally not allowed.
- Files and images remain in browser storage unless the user exports or backs up the workspace.
- Workspace backup/restore and ZIP export should be used before clearing browser data or moving devices.

## Deployment

Deploy the repository as static assets behind any web server or static hosting provider. Recommended production practices:

- Serve over HTTPS.
- Set correct `Content-Type` headers for JavaScript modules.
- Use versioned cache headers for static assets.
- Avoid deployment processes that clear IndexedDB.
- Vendor CDN dependencies locally or add a bundling step if offline or locked-down deployments are required.

## Roadmap

- Real `.docx` export using a document-generation library.
- Browser smoke tests for core editing, persistence, and export flows.
- Further module extraction from `scripts/script.js`.
- Stronger import/export migration tooling.
- Optional local vendoring/bundling of CDN dependencies.

Progress and completed review items are tracked in `reviews/REFACTORING_PROGRESS.md` and `reviews/FIXED_ISSUES.md`.

## License

Markdown Studio is released under the MIT License. See `LICENSE` for details.
