import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [script, editor, index, manifest, cmEntry, pkg, mermaidRenderer, storage] = await Promise.all([
  read("scripts/script.js"),
  read("scripts/editor.js"),
  read("index.html"),
  read("scripts/site.webmanifest"),
  read("scripts/vendor/cm-bundle-entry.js"),
  read("package.json"),
  read("scripts/preview/mermaid-renderer.js"),
  read("scripts/storage.js"),
]);

assert.match(script, /renderer\.code = function \(tokenOrCode/, "Marked code renderer supports token and positional APIs");
assert.match(script, /renderer\.heading = function \(tokenOrText/, "Marked heading renderer supports token and positional APIs");
assert.match(script, /renderer\.link = function \(tokenOrHref/, "Marked link renderer supports token and positional APIs");
assert.match(script, /function jumpToCorrespondingBlock/, "Sync scroll jump helper exists");
assert.match(script, /createMermaidRenderer/, "Preview Mermaid rendering is extracted from main script");
assert.match(script, /const previewSegments = computed/, "Preview is split into stable keyed segments");
assert.match(script, /latexCat\.value = "greek"/, "LaTeX builder starts on a valid category");
assert.doesNotMatch(script, /ADD_TAGS:\s*\["iframe"\]/, "DOMPurify does not allow raw iframes");
assert.doesNotMatch(script, /\bconfirm\(/, "Native confirm dialogs are not used");
assert.doesNotMatch(script, /\bprompt\(/, "Native prompt dialogs are not used");
assert.match(script, /normalizeFileForStorage/, "Files are normalized before persistence");
assert.match(script, /FILE_RECORD_VERSION/, "File records carry an app-level schema version");
assert.match(script, /function htmlToMarkdown/, "Paste-as-Markdown converter exists");
assert.match(script, /function onEditorPaste/, "Editor paste handler exists");
assert.match(script, /function parseMarkdownTableBlock/, "Markdown table parser exists");
assert.match(script, /function serializeMarkdownTable/, "Markdown table serializer exists");
assert.match(script, /function openTableEditor/, "Preview table editor opens source-backed tables");
assert.match(script, /wrap\.dataset\.tableIndex/, "Preview table editor uses table-only source indexes");
assert.match(script, /function renderPreviewErrorHtml/, "Preview render error boundary exists");
assert.match(script, /previewBlockStyles/, "Per-block preview styles are persisted with file style");
assert.match(script, /function openBlockStyleEditor/, "Preview block style editor can open from toolbar");
assert.match(script, /function applyPreviewBlockStyle/, "Preview block style overrides are applied during post-processing");
assert.match(script, /function sanitizeSvgHtml/, "Mermaid viewer sanitizes SVG snapshots");
assert.match(script, /ADD_TAGS:\s*\["foreignObject"\]/, "Mermaid viewer preserves HTML label containers");
assert.match(script, /function openMermaidViewer/, "Mermaid fullscreen viewer can open from preview toolbar");
assert.match(script, /function setMermaidViewerZoom/, "Mermaid viewer exposes zoom controls");
assert.match(script, /function beginMermaidViewerPan/, "Mermaid viewer supports drag panning");
assert.match(script, /function downloadMermaidSvg/, "Mermaid viewer can export SVG");
assert.match(script, /function downloadMermaidPng/, "Mermaid viewer can export PNG");
assert.match(script, /function embedExportImages/, "HTML exports can embed image library data");
assert.match(script, /function getExportMetadata/, "Exports include template metadata");
assert.match(script, /markdown-studio-metadata/, "HTML exports include metadata script");
assert.match(script, /function createZipBlob/, "Export-all ZIP writer exists");
assert.match(script, /function exportAllZip/, "Workspace ZIP export action exists");
assert.match(script, /getAllImages/, "Image library loads from a dedicated IDB store");
assert.match(script, /replaceAllImages/, "Image library persists outside settings");
assert.match(script, /userTemplates/, "User template persistence is wired");
assert.match(editor, /setValue\(text, options = \{\}\)/, "Editor adapter supports silent setValue options");
assert.match(editor, /onPaste/, "Editor adapter forwards paste events");
assert.match(index, /v-for="f in filteredFiles"/, "Sidebar uses filtered file list");
assert.match(index, /onFileDragStart/, "File sidebar supports drag reorder");
assert.match(index, /sync-indicator-preview/, "Scroll sync preview indicator exists");
assert.match(index, /v-for="segment in previewSegments"/, "Preview renders keyed segments instead of one v-html blob");
assert.match(index, /appDialog\.open/, "App-native dialog markup exists");
assert.match(index, /workspaceFileInput/, "Workspace restore file input exists");
assert.match(index, /backupWorkspace/, "Workspace backup action is exposed in the UI");
assert.match(index, /showTableEditor/, "Table editor modal is exposed in the UI");
assert.match(index, /tableEditor\.headers/, "Table editor supports header editing");
assert.match(index, /tableEditor\.rows/, "Table editor supports row editing");
assert.match(index, /showBlockStyleEditor/, "Block style editor modal is exposed in the UI");
assert.match(index, /blockStyleEditor\.backgroundMode/, "Block style editor supports background mode");
assert.match(index, /showMermaidViewer/, "Mermaid fullscreen viewer modal is exposed in the UI");
assert.match(index, /mermaidViewerZoomLabel/, "Mermaid fullscreen viewer shows zoom state");
assert.match(index, /downloadMermaidPng/, "Mermaid fullscreen viewer exposes PNG download");
assert.match(index, /exportAllZip/, "Workspace ZIP export is exposed in the UI");
assert.match(cmEntry, /from '@codemirror\/search'/, "CodeMirror search exports are bundled");
assert.match(pkg, /"@codemirror\/search"/, "CodeMirror search dependency is declared");
assert.match(manifest, /\.\.\/assets\/images\/android-chrome-192x192\.png/, "Manifest icon path is relative to manifest file");
assert.match(mermaidRenderer, /const cache = new Map/, "Mermaid renderer caches rendered diagrams");
assert.match(mermaidRenderer, /pending = new Map/, "Mermaid renderer de-duplicates pending renders");
assert.match(mermaidRenderer, /hasRenderedOutput/, "Mermaid renderer skips unchanged rendered blocks");
assert.match(storage, /_autosaveQueue/, "Autosave writes are serialized through a queue");
assert.match(storage, /_latestAutosaveByFile/, "Autosave skips stale queued saves by file");
assert.match(storage, /exportWorkspaceData/, "Workspace backup export API exists");
assert.match(storage, /importWorkspaceData/, "Workspace restore import API exists");
assert.match(storage, /DB_VERSION = 3/, "IndexedDB schema includes the images store migration");
assert.match(storage, /createObjectStore\('images'/, "Images use a dedicated IndexedDB store");
assert.match(script, /autosaveStatus\.value = "saving"/, "Autosave exposes an active saving state");
assert.match(script, /checkStorageQuota/, "Storage quota warning helper exists");
assert.match(script, /navigator\.storage\?\.estimate/, "Storage quota warning uses browser storage estimates");
assert.match(script, /persistFileOrder/, "File order persistence exists");
assert.match(script, /getEditorSyncPosition/, "Scroll sync uses ratio-aware editor positioning");
assert.match(script, /showSyncIndicator/, "Scroll sync visual indicator is wired");

console.log("Static regression checks passed.");
