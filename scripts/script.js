/**
 * Markdown Studio — script.js 
 *
 * Changes vs original:
 *  1. Textarea replaced with CodeMirror 6 wrapper (editor.js adapter)
 *  2. localStorage replaced with IndexedDB (storage.js)
 *  3. Autosave + version snapshots + restore UI
 *  4. DOMPurify used for safe HTML rendering (sanitizes marked output)
 *  5. Settings modal (autosave delay, snapshot frequency, editor prefs)
 */

import { createEditor } from "./editor.js";
import { createMermaidRenderer } from "./preview/mermaid-renderer.js";
import { getDocument, GlobalWorkerOptions } from "./vendor/pdfjs/pdf.mjs";

GlobalWorkerOptions.workerSrc = new URL(
  "./vendor/pdfjs/pdf.worker.mjs",
  import.meta.url,
).toString();
import {
  openDB,
  getAllFiles,
  getFile,
  saveFile,
  deleteFile as dbDeleteFile,
  scheduleAutosave,
  cancelAutosave,
  setAutosaveDelay,
  createSnapshot,
  getSnapshots,
  getSnapshot,
  deleteSnapshot,
  getSetting,
  setSetting,
  deleteSetting,
  getAllSettings,
  getAllImages,
  replaceAllImages,
  exportWorkspaceData,
  importWorkspaceData,
  migrateFromLocalStorage,
} from "./storage.js";

/* ══════════════════════════════════════════════════════════════════════════
   GLOBALS / CONSTANTS (kept identical to original)
══════════════════════════════════════════════════════════════════════════ */

import {
  DEFAULT_CONTENT, FILE_RECORD_VERSION, TEMPLATES, RENDER_THEMES,
  LATEX_CATS, latexTemplates, MERMAID_TEMPLATES, BLOCK_TYPES, SHORTCUTS
} from "./constants.js";

const { createApp, ref, computed, watch, nextTick, onMounted, onUnmounted } =
  Vue;


// ─── Sanitizer setup ────────────────────────────────────────────────────────

function sanitizeHtml(html) {
  if (window.DOMPurify) {
    return DOMPurify.sanitize(html, {
      FORCE_BODY: true,
    });
  }
  return String(html).replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
}

function sanitizeSvgHtml(html) {
  if (window.DOMPurify) {
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true, svg: true, svgFilters: true },
      ADD_TAGS: ["foreignObject"],
      ADD_ATTR: ["xmlns", "viewBox"],
    });
  }
  return String(html).replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
}

// ─── Marked setup ───────────────────────────────────────────────────────────

function setupMarked() {
  if (!window.marked) return;
  const renderer = new marked.Renderer();
  const isToken = (value) =>
    value && typeof value === "object" && !Array.isArray(value);

  // Code blocks — highlight.js + mermaid detection
  renderer.code = function (tokenOrCode, langArg = "") {
    const token = isToken(tokenOrCode) ? tokenOrCode : null;
    const code = token ? token.text ?? token.raw ?? "" : tokenOrCode ?? "";
    const lang = token ? token.lang || token.infostring || "" : langArg || "";
    if (lang.trim().toLowerCase() === "mermaid") {
      const id = "mmd-" + Math.random().toString(36).slice(2, 8);
      return `<div class="mermaid-block code-block-wrap" data-id="${id}" data-code="${escHtml(code)}"><span class="code-lang">mermaid</span><pre class="mermaid mermaid-source">${escHtml(code)}</pre></div>`;
    }
    const validLang = lang && hljs && hljs.getLanguage(lang) ? lang : null;
    const highlighted = validLang
      ? hljs.highlight(code, { language: validLang, ignoreIllegals: true })
          .value
      : hljs
        ? hljs.highlightAuto(code).value
        : escHtml(code);
    const langLabel = lang
      ? `<span class="code-lang">${escHtml(lang)}</span>`
      : "";
    return `<div class="code-block-wrap" data-code="${escHtml(code)}">${langLabel}<pre><code class="hljs ${escHtml(lang || "")}">${highlighted}</code></pre></div>`;
  };

  // Headings — add slug ids for outline/anchor
  renderer.heading = function (tokenOrText, levelArg = 1) {
    const token = isToken(tokenOrText) ? tokenOrText : null;
    const level = token ? token.depth || 1 : levelArg || 1;
    const text = token
      ? token.tokens && this.parser
        ? this.parser.parseInline(token.tokens)
        : token.text || ""
      : tokenOrText ?? "";
    const slugText = token?.text || String(text).replace(/<[^>]+>/g, "");
    const slug = slugText
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-");
    return `<h${level} id="${slug}">${text}</h${level}>`;
  };

  // Links — open external in new tab safely
  renderer.link = function (tokenOrHref, titleArg = "", textArg = "") {
    const token = isToken(tokenOrHref) ? tokenOrHref : null;
    const href = token ? token.href || "" : tokenOrHref || "";
    const title = token ? token.title || "" : titleArg || "";
    const text = token
      ? token.tokens && this.parser
        ? this.parser.parseInline(token.tokens)
        : token.text || href
      : textArg || href;
    const isExternal =
      href && (href.startsWith("http://") || href.startsWith("https://"));
    const rel = isExternal ? ' rel="noopener noreferrer"' : "";
    const tgt = isExternal ? ' target="_blank"' : "";
    const ttl = title ? ` title="${escHtml(title)}"` : "";
    return `<a href="${escHtml(href)}"${ttl}${tgt}${rel}>${text}</a>`;
  };

  marked.setOptions({
    renderer,
    gfm: true,
    breaks: false,
    pedantic: false,
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stableHash(value) {
  let hash = 5381;
  const text = String(value);
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function renderQcmRichText(text, block = false) {
  const mathBlocks = [];
  let source = String(text || "");
  source = source.replace(/\$\$([\s\S]+?)\$\$/g, (match, expr) => {
    const id = `QCMKATEXDISPLAY${mathBlocks.length}XYZ`;
    mathBlocks.push({ id, expr, displayMode: true, fallback: match });
    return id;
  });
  source = source.replace(/\$([^\n$]+?)\$/g, (match, expr) => {
    const id = `QCMKATEXINLINE${mathBlocks.length}XYZ`;
    mathBlocks.push({ id, expr, displayMode: false, fallback: match });
    return id;
  });

  let html = escHtml(source).replace(/\n/g, block ? "<br>" : " ");
  if (window.marked?.parseInline) {
    html = sanitizeHtml(marked.parseInline(source));
    if (block) html = html.replace(/\n/g, "<br>");
  }

  mathBlocks.forEach((math) => {
    let rendered = escHtml(math.fallback);
    if (window.katex) {
      try {
        rendered = katex.renderToString(math.expr.trim(), {
          displayMode: math.displayMode,
          throwOnError: false,
        });
      } catch {
        rendered = escHtml(math.fallback);
      }
    }
    const wrapper = math.displayMode
      ? `<span class="qcm-katex-display">${rendered}</span>`
      : `<span class="qcm-katex-inline">${rendered}</span>`;
    html = html.replace(math.id, wrapper);
  });

  return html;
}

function renderQcmWidget(question) {
  const multiple = question.choices.filter((choice) => choice.correct).length > 1;
  const required = question.choices.filter((choice) => choice.correct).length || 1;
  const inputType = multiple ? "checkbox" : "radio";
  const choices = question.choices
    .map((choice, index) => `
      <label class="qcm-choice">
        <input type="${inputType}" name="${escHtml(question.id)}" data-correct="${choice.correct ? "true" : "false"}">
        <span class="qcm-choice-marker">${String.fromCharCode(65 + index)}</span>
        <span class="qcm-choice-text">${renderQcmRichText(choice.text)}</span>
      </label>`)
    .join("");
  const explanation = question.explanation
    ? `<div class="qcm-explanation" hidden>${renderQcmRichText(question.explanation, true)}</div>`
    : "";
  const typeLabel = multiple ? `${required} answers` : "1 answer";
  return `<section class="qcm-widget" data-qcm-id="${escHtml(question.id)}" data-qcm-required="${required}" data-qcm-multiple="${multiple ? "true" : "false"}">
    <div class="qcm-header">
      <div class="qcm-question">${renderQcmRichText(question.question, true)}</div>
      <span class="qcm-type">${escHtml(typeLabel)}</span>
    </div>
    <div class="qcm-choices">${choices}</div>
    <div class="qcm-actions">
      <button type="button" class="qcm-check">Check</button>
      <span class="qcm-feedback" aria-live="polite"></span>
    </div>
    ${explanation}
  </section>`;
}

function extractQcmBlocks(markdown, renderWidgets = true) {
  const lines = String(markdown || "").split("\n");
  const widgets = [];
  const out = [];
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].trim().startsWith("??")) {
      out.push(lines[index]);
      index++;
      continue;
    }

    const start = index;
    const questionLines = [lines[index].trim().replace(/^\?\?\s*/, "")];
    const choices = [];
    const explanationLines = [];
    let mode = "question";
    index++;

    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();
      if (trimmed === "---" || trimmed.startsWith("??")) break;
      const choice = trimmed.match(/^[-*]\s+\[(x|X| )\]\s+(.+)$/);
      if (choice) {
        mode = "choices";
        choices.push({ correct: choice[1].toLowerCase() === "x", text: choice[2] });
      } else if (trimmed.startsWith("?!")) {
        mode = "explanation";
        explanationLines.push(trimmed.replace(/^\?!\s*/, ""));
      } else if (mode === "explanation") {
        explanationLines.push(line);
      } else if (mode === "question" && trimmed) {
        questionLines.push(line);
      }
      index++;
    }

    if (choices.length) {
      const id = `qcm-${widgets.length}-${stableHash(questionLines.join("\n") + choices.map((c) => c.text).join("|"))}`;
      const placeholder = `QCMWIDGETPLACEHOLDER${widgets.length}XYZ`;
      const question = {
        id,
        question: questionLines.join("\n").trim(),
        choices,
        explanation: explanationLines.join("\n").trim(),
      };
      widgets.push({
        placeholder,
        question,
        html: renderWidgets ? renderQcmWidget(question) : "",
      });
      out.push(placeholder);
      if (lines[index]?.trim() === "---") index++;
    } else {
      out.push(...lines.slice(start, index));
    }
  }

  return { source: out.join("\n"), widgets };
}

function updateQcmChoiceStates(widget, showCorrectness = false) {
  widget.querySelectorAll(".qcm-choice").forEach((choice) => {
    const input = choice.querySelector("input[data-correct]");
    const checked = Boolean(input?.checked);
    const correct = input?.dataset.correct === "true";
    choice.classList.toggle("is-selected", checked);
    choice.classList.toggle("is-choice-correct", showCorrectness && correct);
    choice.classList.toggle("is-choice-wrong", showCorrectness && checked && !correct);
  });
}

function updateQcmWidget(widget, force = false) {
  const inputs = Array.from(widget.querySelectorAll("input[data-correct]"));
  const selectedCount = inputs.filter((input) => input.checked).length;
  const required = Number(widget.dataset.qcmRequired || 1);
  const multiple = widget.dataset.qcmMultiple === "true";
  const ready = selectedCount > 0 && (!multiple || selectedCount >= required || force);
  const partial = multiple && selectedCount > 0 && selectedCount < required && !force;
  const correct = ready && inputs.every((input) =>
    (input.dataset.correct === "true") === input.checked,
  );
  widget.classList.toggle("is-pending", partial);
  widget.classList.toggle("is-correct", correct);
  widget.classList.toggle("is-incorrect", ready && !correct);
  updateQcmChoiceStates(widget, ready);
  const feedback = widget.querySelector(".qcm-feedback");
  if (feedback) {
    feedback.textContent = !selectedCount
      ? "Choose an answer"
      : partial
        ? `${selectedCount}/${required} selected`
        : correct
          ? "Correct"
          : "Review your answer";
  }
  const explanation = widget.querySelector(".qcm-explanation");
  if (explanation) explanation.hidden = !ready;
}

function enhanceQcmWidgets(container) {
  container.querySelectorAll(".qcm-widget:not([data-qcm-ready])").forEach((widget) => {
    widget.dataset.qcmReady = "true";
    widget.querySelectorAll("input[data-correct]").forEach((input) => {
      input.addEventListener("change", () => updateQcmWidget(widget, false));
    });
    widget.querySelector(".qcm-check")?.addEventListener("click", () => {
      updateQcmWidget(widget, true);
    });
  });
}

function getQcmExportScript() {
  return `<script>
function updateQcmChoiceStates(widget,showCorrectness){
  [].slice.call(widget.querySelectorAll(".qcm-choice")).forEach(function(choice){
    var input=choice.querySelector("input[data-correct]");
    var checked=!!(input&&input.checked);
    var correct=input&&input.dataset.correct==="true";
    choice.classList.toggle("is-selected",checked);
    choice.classList.toggle("is-choice-correct",!!showCorrectness&&correct);
    choice.classList.toggle("is-choice-wrong",!!showCorrectness&&checked&&!correct);
  });
}
function updateQcmWidget(widget,force){
  if(!widget)return;
  var inputs=[].slice.call(widget.querySelectorAll("input[data-correct]"));
  var selectedCount=inputs.filter(function(input){return input.checked;}).length;
  var required=Number(widget.dataset.qcmRequired||1);
  var multiple=widget.dataset.qcmMultiple==="true";
  var ready=selectedCount>0&&(!multiple||selectedCount>=required||force);
  var partial=multiple&&selectedCount>0&&selectedCount<required&&!force;
  var correct=ready&&inputs.every(function(input){return (input.dataset.correct==="true")===input.checked;});
  widget.classList.toggle("is-pending",partial);
  widget.classList.toggle("is-correct",correct);
  widget.classList.toggle("is-incorrect",ready&&!correct);
  updateQcmChoiceStates(widget,ready);
  var feedback=widget.querySelector(".qcm-feedback");
  if(feedback)feedback.textContent=!selectedCount?"Choose an answer":partial?selectedCount+"/"+required+" selected":correct?"Correct":"Review your answer";
  var explanation=widget.querySelector(".qcm-explanation");
  if(explanation)explanation.hidden=!ready;
}
document.addEventListener("change",function(event){
  if(!event.target.matches(".qcm-widget input[data-correct]"))return;
  updateQcmWidget(event.target.closest(".qcm-widget"),false);
});
document.addEventListener("click",function(event){
  var button=event.target.closest(".qcm-check");
  if(!button)return;
  updateQcmWidget(button.closest(".qcm-widget"),true);
});
<\/script>`;
}

function renderPreviewErrorHtml(error) {
  const message = error?.message || String(error || "Unknown render error");
  return `<div class="preview-render-error" role="alert">
    <div class="preview-render-error-title"><i class="ti ti-alert-triangle"></i> Preview render failed</div>
    <pre class="preview-render-error-message">${escHtml(message)}</pre>
  </div>`;
}

function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const escape = (text) =>
    text.replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");

  function convert(node, depth = 0) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue.replace(/\s+/g, " ");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName.toLowerCase();
    const children = () =>
      Array.from(node.childNodes).map((child) => convert(child, depth)).join("");
    const block = (text) => `\n\n${text.trim()}\n\n`;

    if (/^h[1-6]$/.test(tag)) {
      return block(`${"#".repeat(Number(tag[1]))} ${children().trim()}`);
    }
    if (tag === "p" || tag === "div" || tag === "section" || tag === "article") {
      return block(children());
    }
    if (tag === "br") return "\n";
    if (tag === "strong" || tag === "b") return `**${children().trim()}**`;
    if (tag === "em" || tag === "i") return `*${children().trim()}*`;
    if (tag === "code") return `\`${node.textContent.trim()}\``;
    if (tag === "pre") return `\n\n\`\`\`\n${node.textContent.replace(/\n+$/, "")}\n\`\`\`\n\n`;
    if (tag === "a") {
      const href = node.getAttribute("href") || "";
      const text = children().trim() || href;
      return href ? `[${text}](${href})` : text;
    }
    if (tag === "img") {
      const alt = node.getAttribute("alt") || "Image";
      const src = node.getAttribute("src") || "";
      return src ? `![${alt}](${src})` : "";
    }
    if (tag === "blockquote") {
      return block(
        children()
          .trim()
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n"),
      );
    }
    if (tag === "ul" || tag === "ol") {
      const items = Array.from(node.children)
        .filter((child) => child.tagName?.toLowerCase() === "li")
        .map((li, index) => {
          const marker = tag === "ol" ? `${index + 1}.` : "-";
          return `${"  ".repeat(depth)}${marker} ${convert(li, depth + 1).trim()}`;
        });
      return `\n${items.join("\n")}\n`;
    }
    if (tag === "li") return children();
    if (tag === "table") {
      const rows = Array.from(node.querySelectorAll("tr")).map((row) =>
        Array.from(row.children).map((cell) => cell.textContent.trim()),
      );
      if (!rows.length) return "";
      const header = rows[0];
      const separator = header.map(() => "---");
      const body = rows.slice(1);
      return block(
        [header, separator, ...body]
          .map((row) => `| ${row.map((cell) => escape(cell)).join(" | ")} |`)
          .join("\n"),
      );
    }
    return children();
  }

  return Array.from(doc.body.childNodes)
    .map((node) => convert(node))
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function notebookSourceToText(source) {
  if (Array.isArray(source)) return source.join("");
  return String(source || "");
}

function markdownFenceBlock(code, lang = "") {
  const text = String(code || "").replace(/\s+$/g, "");
  const matches = text.match(/`{3,}/g) || [];
  const ticks = Math.max(3, ...matches.map((match) => match.length)) + 1;
  const fence = "`".repeat(ticks);
  return `${fence}${lang}\n${text}\n${fence}`;
}

function renderNotebookOutput(output = {}, index = 0) {
  const parts = [];
  const label = output.execution_count != null
    ? `Out [${output.execution_count}]`
    : output.name
      ? String(output.name)
      : `Output ${index + 1}`;
  const data = output.data || {};
  const text =
    notebookSourceToText(output.text) ||
    notebookSourceToText(data["text/plain"]) ||
    notebookSourceToText(output.traceback);
  const html = notebookSourceToText(data["text/html"]);
  const image = notebookSourceToText(data["image/png"] || data["image/jpeg"]);
  const imageMime = data["image/jpeg"] ? "image/jpeg" : "image/png";

  if (html) {
    parts.push(`<div class="nb-output nb-output-html"><div class="nb-cell-label">${escHtml(label)}</div>${html}</div>`);
  }
  if (image) {
    parts.push(`<div class="nb-output nb-output-image"><div class="nb-cell-label">${escHtml(label)}</div><img src="data:${imageMime};base64,${image.replace(/\s+/g, "")}" alt="${escHtml(label)}"></div>`);
  }
  if (text) {
    const className = output.output_type === "error" ? "nb-output nb-output-error" : "nb-output";
    parts.push(`<div class="${className}"><div class="nb-cell-label">${escHtml(label)}</div><pre>${escHtml(text)}</pre></div>`);
  }
  return parts.join("\n\n");
}

function notebookToMarkdown(notebook, fileName = "notebook.ipynb") {
  if (!notebook || !Array.isArray(notebook.cells)) {
    throw new Error("Invalid Jupyter notebook: missing cells array.");
  }

  const title = fileName.replace(/\.ipynb$/i, "").replace(/[-_]+/g, " ").trim() || "Notebook";
  const language =
    notebook.metadata?.language_info?.name ||
    notebook.metadata?.kernelspec?.language ||
    "python";
  const chunks = [
    `# ${title}`,
    `<div class="nb-document-meta">Imported from ${escHtml(fileName)} · ${notebook.cells.length} cells</div>`,
  ];

  notebook.cells.forEach((cell, index) => {
    const source = notebookSourceToText(cell.source).trimEnd();
    if (cell.cell_type === "markdown") {
      if (source.trim()) chunks.push(source);
      return;
    }
    if (cell.cell_type !== "code") return;

    const inputLabel = cell.execution_count != null ? `In [${cell.execution_count}]` : `In [${index + 1}]`;
    const code = [
      `<div class="nb-cell-label">${escHtml(inputLabel)}</div>`,
      markdownFenceBlock(source, language),
    ].join("\n\n");
    chunks.push(code);

    const outputs = Array.isArray(cell.outputs)
      ? cell.outputs.map((output, outputIndex) => renderNotebookOutput(output, outputIndex)).filter(Boolean)
      : [];
    if (outputs.length) chunks.push(outputs.join("\n\n"));
  });

  return chunks.filter(Boolean).join("\n\n");
}

async function pdfToMarkdown(file) {
  const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => `${item.str}${item.hasEOL ? "\n" : ""}`)
      .join("");
    pages.push(`<!-- SOURCE_PAGE:${pageNumber} -->\n## 📄 Source Page ${pageNumber}\n\n${text}`);
  }

  return pages.join("\n\n");
}

// Global copy helper referenced in rendered HTML
window.copyCode = function (btn) {
  const wrap = btn.closest(".code-block-wrap");
  const code =
    wrap?.dataset.code ||
    wrap?.querySelector("code")?.textContent ||
    wrap?.querySelector("pre.mermaid")?.textContent ||
    "";
  navigator.clipboard?.writeText(code).then(() => {
    btn.innerHTML = '<i class="ti ti-check"></i>';
    setTimeout(() => {
      btn.innerHTML = '<i class="ti ti-copy"></i>';
    }, 1500);
  });
};

function resolvePreviewImages(container, imageMap) {
  container.querySelectorAll("img[src]").forEach((img) => {
    const src = img.getAttribute("src") || "";
    const normalized = src.replace(/^\.\//, "");
    let decoded = normalized;
    try {
      decoded = decodeURIComponent(normalized);
    } catch {}
    const mapped =
      imageMap?.[src] ||
      imageMap?.[normalized] ||
      imageMap?.[decoded] ||
      imageMap?.[decoded.replace(/^\.\//, "")];
    if (mapped) {
      img.src = mapped;
      img.dataset.path = decoded;
    }
  });
}

function copyBlockSource(kind, wrap) {
  let text = "";
  if (kind === "image") {
    const img = wrap.querySelector("img");
    const src = img?.dataset.path || img?.getAttribute("src") || "";
    const alt = img?.getAttribute("alt") || "Image";
    text = `![${alt}](${src})`;
  } else if (kind === "table") {
    text = wrap.querySelector("table")?.outerHTML || "";
  } else if (kind === "mermaid") {
    text =
      wrap.querySelector(".mermaid-block")?.dataset.code ||
      wrap.dataset.code ||
      wrap.querySelector("pre.mermaid")?.textContent ||
      "";
  }
  if (!text) return;
  navigator.clipboard?.writeText(text);
}

function getPreviewMermaidPayload(wrap) {
  const block = wrap?.querySelector(".mermaid-block");
  const source =
    block?.dataset.code ||
    wrap?.dataset.code ||
    wrap?.querySelector("pre.mermaid")?.textContent ||
    "";
  const svg = wrap?.querySelector(".mermaid-rendered svg");
  const error = wrap?.querySelector(".mermaid-error-message")?.textContent || "";
  let width = 960;
  let height = 540;
  if (svg) {
    const viewBox = svg.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
    const attrWidth = Number.parseFloat(svg.getAttribute("width") || "");
    const attrHeight = Number.parseFloat(svg.getAttribute("height") || "");
    if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) {
      width = Math.max(1, viewBox[2]);
      height = Math.max(1, viewBox[3]);
    } else if (Number.isFinite(attrWidth) && Number.isFinite(attrHeight)) {
      width = Math.max(1, attrWidth);
      height = Math.max(1, attrHeight);
    }
  }
  return {
    source,
    html: svg ? sanitizeSvgHtml(svg.outerHTML) : "",
    error,
    width,
    height,
  };
}

function parseMarkdownTableBlock(block) {
  const lines = String(block || "")
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));
  if (lines.length < 2) return null;
  const toCells = (line) => {
    const body = line.replace(/^\|/, "").replace(/\|$/, "");
    const cells = [];
    let cell = "";
    for (let index = 0; index < body.length; index++) {
      const char = body[index];
      if (char === "\\" && body[index + 1] === "|") {
        cell += "|";
        index++;
        continue;
      }
      if (char === "|") {
        cells.push(cell.trim());
        cell = "";
        continue;
      }
      cell += char;
    }
    cells.push(cell.trim());
    return cells;
  };
  const header = toCells(lines[0]);
  const body = lines.slice(2).map(toCells);
  const width = Math.max(header.length, ...body.map((row) => row.length), 1);
  const normalize = (row) =>
    Array.from({ length: width }, (_, index) => row[index] || "");
  return {
    headers: normalize(header),
    rows: body.map(normalize),
  };
}

function serializeMarkdownTable(table) {
  const headers = table.headers?.length ? table.headers : ["Column 1"];
  const width = headers.length;
  const normalize = (row) =>
    Array.from({ length: width }, (_, index) =>
      String(row?.[index] || "").replace(/\|/g, "\\|").trim(),
    );
  const header = normalize(headers);
  const separator = header.map(() => "---");
  const rows = (table.rows?.length ? table.rows : [Array(width).fill("")]).map(normalize);
  return [header, separator, ...rows]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

function clampNumber(value, min, max, fallback) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(max, Math.max(min, next));
}

function safeHexColor(value, fallback = "#ffffff") {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
}

function normalizePreviewBlockStyle(style = {}, kind = "image") {
  const defaults = {
    border: false,
    borderColor: "#d1d5db",
    backgroundMode: "transparent",
    backgroundColor: "#ffffff",
    padding: kind === "table" ? 0 : 6,
    radius: 8,
  };
  const backgroundMode = style.backgroundMode === "color" ? "color" : "transparent";
  return {
    ...defaults,
    border: Boolean(style.border),
    borderColor: safeHexColor(style.borderColor, defaults.borderColor),
    backgroundMode,
    backgroundColor: safeHexColor(style.backgroundColor, defaults.backgroundColor),
    padding: clampNumber(style.padding, 0, 48, defaults.padding),
    radius: clampNumber(style.radius, 0, 32, defaults.radius),
  };
}

function applyPreviewBlockStyle(wrap, style, kind) {
  if (!wrap || !style) return;
  const normalized = normalizePreviewBlockStyle(style, kind);
  wrap.classList.add("has-preview-block-style");
  wrap.style.border = normalized.border
    ? `1px solid ${normalized.borderColor}`
    : "1px solid transparent";
  wrap.style.background =
    normalized.backgroundMode === "color"
      ? normalized.backgroundColor
      : "transparent";
  wrap.style.padding = `${normalized.padding}px`;
  wrap.style.borderRadius = `${normalized.radius}px`;
}

const zipCrcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let crc = index;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[index] = crc >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = zipCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeZipUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeZipUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function getZipDateParts(date = new Date()) {
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, dosDate };
}

function concatZipParts(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

function createZipBlob(entries) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const { time, dosDate } = getZipDateParts();

  entries.forEach((entry) => {
    const name = encoder.encode(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : encoder.encode(String(entry.data || ""));
    const crc = crc32(data);

    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    writeZipUint32(localView, 0, 0x04034b50);
    writeZipUint16(localView, 4, 20);
    writeZipUint16(localView, 6, 0x0800);
    writeZipUint16(localView, 8, 0);
    writeZipUint16(localView, 10, time);
    writeZipUint16(localView, 12, dosDate);
    writeZipUint32(localView, 14, crc);
    writeZipUint32(localView, 18, data.length);
    writeZipUint32(localView, 22, data.length);
    writeZipUint16(localView, 26, name.length);
    writeZipUint16(localView, 28, 0);
    local.set(name, 30);

    parts.push(local, data);

    const header = new Uint8Array(46 + name.length);
    const headerView = new DataView(header.buffer);
    writeZipUint32(headerView, 0, 0x02014b50);
    writeZipUint16(headerView, 4, 20);
    writeZipUint16(headerView, 6, 20);
    writeZipUint16(headerView, 8, 0x0800);
    writeZipUint16(headerView, 10, 0);
    writeZipUint16(headerView, 12, time);
    writeZipUint16(headerView, 14, dosDate);
    writeZipUint32(headerView, 16, crc);
    writeZipUint32(headerView, 20, data.length);
    writeZipUint32(headerView, 24, data.length);
    writeZipUint16(headerView, 28, name.length);
    writeZipUint16(headerView, 30, 0);
    writeZipUint16(headerView, 32, 0);
    writeZipUint16(headerView, 34, 0);
    writeZipUint16(headerView, 36, 0);
    writeZipUint32(headerView, 38, 0);
    writeZipUint32(headerView, 42, offset);
    header.set(name, 46);
    central.push(header);

    offset += local.length + data.length;
  });

  const centralStart = offset;
  const centralBytes = concatZipParts(central);
  parts.push(centralBytes);
  offset += centralBytes.length;

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeZipUint32(endView, 0, 0x06054b50);
  writeZipUint16(endView, 4, 0);
  writeZipUint16(endView, 6, 0);
  writeZipUint16(endView, 8, entries.length);
  writeZipUint16(endView, 10, entries.length);
  writeZipUint32(endView, 12, centralBytes.length);
  writeZipUint32(endView, 16, centralStart);
  writeZipUint16(endView, 20, 0);
  parts.push(end);

  return new Blob(parts, { type: "application/zip" });
}

function dataUrlToBytes(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return null;
  const payload = match[3] || "";
  const text = match[2] ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) {
    bytes[index] = text.charCodeAt(index);
  }
  return bytes;
}

function clearPreviewBlockStyle(wrap) {
  if (!wrap) return;
  wrap.classList.remove("has-preview-block-style");
  wrap.style.border = "";
  wrap.style.background = "";
  wrap.style.padding = "";
  wrap.style.borderRadius = "";
}

function setAlignButtonIcon(button, align) {
  const iconByAlign = {
    left: "ti-align-left",
    center: "ti-align-center",
    right: "ti-align-right",
    justify: "ti-align-justified",
  };
  const icon = iconByAlign[align] || "ti-align-center";
  button.innerHTML = `<i class="ti ${icon}"></i>`;
}

function applyPreviewAlignment(wrap, align, kind) {
  wrap.dataset.align = align;
  wrap.style.marginLeft = align === "right" ? "auto" : align === "center" || align === "justify" ? "auto" : "0";
  wrap.style.marginRight = align === "left" ? "auto" : align === "center" || align === "justify" ? "auto" : "0";
  wrap.style.textAlign = align;
  wrap.style.width = align === "justify" && kind !== "image" ? "100%" : wrap.style.width || "";
}

// ─── KaTeX post-process ─────────────────────────────────────────────────────

function renderKatex(container) {
  if (!window.katex) return;

  const targets = container.querySelectorAll(
    "p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote",
  );

  targets.forEach((el) => {
    if (el.querySelector(".katex, .katex-display")) return;

    const trimmed = (el.textContent || "").trim();
    if (/^\$\$[\s\S]+\$\$$/.test(trimmed)) {
      const tex = trimmed.slice(2, -2).trim();
      el.innerHTML = `<div class="katex-block">${katex.renderToString(tex, {
        displayMode: true,
        throwOnError: false,
      })}</div>`;
      return;
    }

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.includes("$")) {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest("code, pre, .katex, .katex-display")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach((node) => {
      const content = node.nodeValue || "";
      const parts = [];
      let cursor = 0;

      while (cursor < content.length) {
        const blockStart = content.indexOf("$$", cursor);
        const inlineStart = content.indexOf("$", cursor);
        let start = -1;
        let displayMode = false;

        if (blockStart !== -1 && (inlineStart === -1 || blockStart <= inlineStart)) {
          start = blockStart;
          displayMode = true;
        } else if (inlineStart !== -1) {
          start = inlineStart;
        }

        if (start === -1) {
          parts.push({ type: "text", value: content.slice(cursor) });
          break;
        }

        if (start > cursor) {
          parts.push({ type: "text", value: content.slice(cursor, start) });
        }

        const delimiter = displayMode ? "$$" : "$";
        const end = content.indexOf(delimiter, start + delimiter.length);
        if (end === -1) {
          parts.push({ type: "text", value: content.slice(start) });
          break;
        }

        parts.push({
          type: "math",
          value: content.slice(start + delimiter.length, end).trim(),
          displayMode,
        });
        cursor = end + delimiter.length;
      }

      if (!parts.some((part) => part.type === "math")) return;

      const fragment = document.createDocumentFragment();
      parts.forEach((part) => {
        if (part.type === "text") {
          fragment.appendChild(document.createTextNode(part.value));
          return;
        }
        const wrap = document.createElement(part.displayMode ? "div" : "span");
        wrap.className = part.displayMode ? "katex-block" : "katex-inline";
        wrap.innerHTML = katex.renderToString(part.value, {
          displayMode: part.displayMode,
          throwOnError: false,
        });
        fragment.appendChild(wrap);
      });

      node.parentNode?.replaceChild(fragment, node);
    });
  });
}

// ─── Mermaid post-process ──────────────────────────────────────────────────

const mermaidPreviewRenderer = createMermaidRenderer();

async function renderMermaid(container) {
  await mermaidPreviewRenderer.render(container);
}

async function postProcessPreviewContainer(
  container,
  sizes,
  alignments,
  blockStyles,
  imageMap,
  onResize,
  onStyleChange,
  onOpenBlockStyle,
  onOpenMermaidViewer,
  onEditTable,
) {
  if (!container) return;
  await renderMermaid(container);
  resolvePreviewImages(container, imageMap);
  enhanceQcmWidgets(container);
  enhancePreviewBlocks(
    container,
    sizes,
    alignments,
    blockStyles,
    onResize,
    onStyleChange,
    onOpenBlockStyle,
    onOpenMermaidViewer,
    onEditTable,
  );
}

function enhancePreviewBlocks(
  container,
  sizes,
  alignments,
  blockStyles,
  onResize,
  onStyleChange,
  onOpenBlockStyle,
  onOpenMermaidViewer,
  onEditTable,
) {
  const targets = [];
  const blockKeyByElement = new Map();
  const tableIndexByElement = new Map();
  let blockIndex = 0;
  let tableIndex = 0;
  container.querySelectorAll(".mermaid-block, table, img").forEach((el) => {
    const kind = el.matches(".mermaid-block")
      ? "mermaid"
      : el.matches("table")
        ? "table"
        : "image";
    blockKeyByElement.set(el, `${kind}:${blockIndex++}`);
    if (kind === "table") tableIndexByElement.set(el, tableIndex++);
  });

  container.querySelectorAll(".preview-resize-wrap").forEach((wrap) => {
    const child = wrap.querySelector(".mermaid-block, table, img");
    const key = child ? blockKeyByElement.get(child) : wrap.dataset.resizeKey;
    const kind = child?.matches(".mermaid-block")
      ? "mermaid"
      : child?.matches("table")
        ? "table"
        : wrap.dataset.resizeKind || "image";
    if (!key) return;
    wrap.dataset.resizeKey = key;
    wrap.dataset.resizeKind = kind;
    if (kind === "table" && child) {
      wrap.dataset.tableIndex = String(tableIndexByElement.get(child) ?? -1);
    }
    wrap.style.width = sizes?.[key] || wrap.style.width || "";
    applyPreviewAlignment(wrap, alignments?.[key] || wrap.dataset.align || "left", kind);
    clearPreviewBlockStyle(wrap);
    applyPreviewBlockStyle(wrap, blockStyles?.[key], kind);
  });

  container.querySelectorAll(".mermaid-block, table, img").forEach((el) => {
    if (el.closest(".preview-resize-wrap")) return;
    targets.push(el);
  });

  targets.forEach((el, index) => {
    const kind = el.matches(".mermaid-block")
      ? "mermaid"
      : el.matches("table")
        ? "table"
        : "image";
    const wrap = document.createElement("div");
    const key = blockKeyByElement.get(el) || `${kind}:${index}`;
    wrap.className = `preview-resize-wrap preview-resize-${kind}`;
    wrap.dataset.resizeKey = key;
    wrap.dataset.resizeKind = kind;
    wrap.style.width = sizes[key] || "";
    applyPreviewAlignment(wrap, alignments?.[key] || "left", kind);
    applyPreviewBlockStyle(wrap, blockStyles?.[key], kind);

    let sourceTableIndex = -1;
    if (kind === "table") {
      sourceTableIndex = tableIndexByElement.get(el) ?? -1;
      wrap.dataset.tableIndex = String(sourceTableIndex);
      el.classList.add("preview-table-block");
    }
    if (kind === "image") {
      el.classList.add("preview-image-block");
    }
    if (kind === "mermaid") {
      el.classList.add("preview-mermaid-block");
    }

    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "preview-resize-handle";
    handle.title = "Resize block";
    handle.innerHTML = '<i class="ti ti-arrows-diagonal"></i>';

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "preview-block-copy";
    copy.title = "Copy block";
    copy.innerHTML = '<i class="ti ti-copy"></i>';
    copy.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      copyBlockSource(kind, wrap);
    });

    const align = document.createElement("button");
    align.type = "button";
    align.className = "preview-block-align";
    align.title = "Align block";
    setAlignButtonIcon(align, alignments?.[key] || "left");
    align.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const options = ["left", "center", "right", "justify"];
      const currentKey = wrap.dataset.resizeKey || key;
      const current = wrap.dataset.align || "left";
      const next = options[(options.indexOf(current) + 1) % options.length];
      if (alignments) alignments[currentKey] = next;
      applyPreviewAlignment(wrap, next, kind);
      setAlignButtonIcon(align, next);
      onStyleChange?.();
    });

    const toolbar = document.createElement("div");
    toolbar.className = "preview-block-toolbar";
    toolbar.append(copy, align);
    const style = document.createElement("button");
    style.type = "button";
    style.className = "preview-block-style";
    style.title = "Customize block";
    style.innerHTML = '<i class="ti ti-brush"></i>';
    style.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onOpenBlockStyle?.(
        wrap.dataset.resizeKey || key,
        wrap.dataset.resizeKind || kind,
      );
    });
    toolbar.append(style);
    if (kind === "mermaid") {
      const zoom = document.createElement("button");
      zoom.type = "button";
      zoom.className = "preview-block-zoom";
      zoom.title = "Open Mermaid viewer";
      zoom.innerHTML = '<i class="ti ti-arrows-maximize"></i>';
      zoom.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenMermaidViewer?.(
          wrap.dataset.resizeKey || key,
          getPreviewMermaidPayload(wrap),
        );
      });
      toolbar.append(zoom);
    }
    if (kind === "table") {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "preview-block-edit";
      edit.title = "Edit table";
      edit.innerHTML = '<i class="ti ti-table-options"></i>';
      edit.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onEditTable?.(Number(wrap.dataset.tableIndex ?? sourceTableIndex));
      });
      toolbar.append(edit);
    }

    handle.addEventListener("pointerdown", (event) =>
      onResize(
        event,
        wrap,
        wrap.dataset.resizeKey || key,
        wrap.dataset.resizeKind || kind,
      ),
    );

    el.parentNode?.insertBefore(wrap, el);
    wrap.appendChild(el);
    wrap.appendChild(toolbar);
    wrap.appendChild(handle);
  });
}

function getPreviewTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "default";
}

/* ══════════════════════════════════════════════════════════════════════════
   VUE APP
══════════════════════════════════════════════════════════════════════════ */

createApp({
  setup() {
    // ── state ────────────────────────────────────────────────────────────────

    const files = ref([]);
    const activeFileId = ref(null);
    const unsaved = ref(false);
    const fileSearch = ref("");
    const draggedFileId = ref(null);
    const fileDragOverId = ref(null);

    // editor
    let editorInstance = null; // the CM6 / fallback adapter
    const editorWrap = ref(null); // DOM ref for #editor-wrap
    const previewScroller = ref(null);
    const syncIndicator = ref({
      visible: false,
      editorTop: 0,
      previewTop: 0,
    });

    // view
    const viewMode = ref("split");
    const medicalSearch = ref("");
    const medicalFocusMode = ref(false);
    const medicalFocusPage = ref(0);
    const medicalShowPageNumbers = ref(true);
    const medicalExpanded = ref({});
    const medicalRevealed = ref({});
    const sidebarOpen = ref(true);
    const topbarOpen = ref(false);
    const themeMode = ref("system");
    const systemDarkMode = ref(false);
    const darkMode = ref(false);
    const focusMode = ref(false);
    const wordWrap = ref(true);
    const editorFontSize = ref(15);
    const editorLineHeight = ref(1.7);

    // modals
    const showLatex = ref(false);
    const showMermaid = ref(false);
    const showExport = ref(false);
    const showImgManager = ref(false);
    const showTemplates = ref(false);
    const showStylePanel = ref(false);
    const showShortcuts = ref(false);
    const showTutorial = ref(false);
    const showFR = ref(false);
    const showSettings = ref(false);
    const showHistory = ref(false);
    const showPosterBuilder = ref(false);
    const posterPreviewRef = ref(null);
    const posterTitle = ref("");
    const posterSubtitle = ref("");
    const posterSize = ref("a0");
    const posterOrientation = ref("landscape");
    const posterColumns = ref(3);
    const posterSlotCount = ref(6);
    const posterLayout = ref([]);
    const posterDragSectionId = ref("");
    const posterTheme = ref("academic-blue");
    const posterSizeOptions = [
      { id: "a0", label: "A0", width: 841, height: 1189 },
      { id: "a1", label: "A1", width: 594, height: 841 },
      { id: "arch-d", label: "36 x 24 in", width: 914, height: 610 },
      { id: "arch-e", label: "48 x 36 in", width: 1219, height: 914 },
    ];
    const posterThemeOptions = [
      { id: "academic-blue", label: "Academic Blue" },
      { id: "nature-journal", label: "Nature Journal" },
      { id: "minimal-white", label: "Minimal White" },
      { id: "dark-presentation", label: "Dark Presentation" },
    ];
    const appDialog = ref({
      open: false,
      title: "",
      message: "",
      fields: [],
      confirmText: "OK",
      cancelText: "Cancel",
      danger: false,
    });
    let appDialogResolve = null;
    const syncScrollEnabled = ref(false);
    const sidebarTemplatesOpen = ref(true);

    // Find & replace
    const frFind = ref("");
    const frReplace = ref("");
    const frCase = ref(false);
    const frRegex = ref(false);
    const frWord = ref(false);
    const frCount = ref(0);

    // rename
    const renamingFile = ref(false);
    const renameVal = ref("");
    const renameInputRef = ref(null);

    // latex builder
    const latexCat = ref("greek");
    const latexInput = ref("");
    const latexRendered = ref("");
    const latexMode = ref("block");

    // mermaid builder
    const mermaidCode = ref("graph TD\n  A --> B");
    const mermaidPrev = ref("");
    const mermaidError = ref("");
    const mermaidTpl = ref("flowchart");
    const mermaidDiagramType = computed({
      get: () => mermaidTpl.value,
      set: (value) => {
        mermaidTpl.value = value;
      },
    });
    const mermaidRendered = computed(() => mermaidPrev.value);

    // block organizer
    const activePanel = ref("editor");
    const blocks = ref([]);
    const editingBlockIdx = ref(-1);
    const dragSrcIdx = ref(-1);
    const blockTypeMenuOpen = ref(false);
    const blockTypeMenuPos = ref({ x: 0, y: 0 });
    const blockTypeMenuTarget = ref(0);
    const blockTypeSearch = ref("");

    // style panel
    const renderTheme = ref("default");
    const customFont = ref("");
    const cFontSize = ref(17);
    const cLineH = ref(1.7);
    const cParaGap = ref(0.8);
    const cHeadFont = ref("");
    const cH1 = ref(2.2);
    const cH2 = ref(1.7);
    const cWidth = ref(780);
    const cPadH = ref(40);
    const cPadV = ref(40);
    const cColorText = ref("");
    const cColorHead = ref("");
    const cColorLink = ref("");
    const cColorBg = ref("");
    const previewTextWrap = ref(true);
    const previewCodeWrap = ref(false);
    const previewCodeFontScale = ref(1);
    const previewLatexFontScale = ref(1);
    const previewTableLayout = ref("full");
    const previewTableStriped = ref(true);
    const previewTableCompact = ref(false);
    const previewTableFontScale = ref(1);
    const previewScaleScope = ref("all");
    const previewScaleFactor = ref(1);
    const previewBlockSizes = ref({});
    const previewBlockAlignments = ref({});
    const previewBlockStyles = ref({});
    const mediaBlockBorder = ref(false);
    const mediaBlockBgMode = ref("transparent");
    const mediaBlockBgColor = ref("#ffffff");
    const fileStyleDefaults = ref(null);
    const imagePathMap = ref({});

    // table editor
    const showTableEditor = ref(false);
    const tableEditor = ref({
      tableIndex: -1,
      blockIndex: -1,
      headers: [],
      rows: [],
    });
    const showBlockStyleEditor = ref(false);
    const blockStyleEditor = ref({
      key: "",
      kind: "image",
      border: false,
      borderColor: "#d1d5db",
      backgroundMode: "transparent",
      backgroundColor: "#ffffff",
      padding: 6,
      radius: 8,
    });
    const showMermaidViewer = ref(false);
    const mermaidViewer = ref({
      key: "",
      html: "",
      source: "",
      error: "",
      zoom: 1,
      width: 960,
      height: 540,
      panX: 0,
      panY: 0,
      dragging: false,
    });
    const mermaidViewerCanvasRef = ref(null);
    const mermaidViewerZoomLabel = computed(() =>
      `${Math.round(mermaidViewer.value.zoom * 100)}%`,
    );
    const mermaidViewerStageStyle = computed(() => ({
      width: `${Math.max(1, mermaidViewer.value.width * mermaidViewer.value.zoom)}px`,
      minHeight: `${Math.max(1, mermaidViewer.value.height * mermaidViewer.value.zoom)}px`,
      transform: `translate(${mermaidViewer.value.panX}px, ${mermaidViewer.value.panY}px)`,
    }));

    // export
    const showPdfSettings = ref(false);
    const exportPaperSize = ref("A4");
    const exportOrientation = ref("portrait");
    const exportMargins = ref("normal");
    const exportScale = ref("100");
    const exportBgGraphics = ref(true);
    const exportTitle = ref("");
    const exportAuthor = ref("");

    // images
    const images = ref([]);
    const selectedImgs = ref([]);
    const imgFileInput = ref(null);
    const showResizeModal = ref(false);
    const resizeTarget = ref(null);
    const resizeW = ref(0);
    const resizeH = ref(0);
    const resizeLock = ref(true);
    const resQ = ref(0.92);
    const showCropModal = ref(false);
    const cropTarget = ref(null);
    const cropX = ref(0);
    const cropY = ref(0);
    const cropW = ref(100);
    const cropH = ref(100);
    const cropPreset = ref("");
    const cropWrapRef = ref(null);
    const cropImgRef = ref(null);
    const cropDisplayTick = ref(0);
    const cropPresets = ["Free", "1:1", "4:3", "16:9"];

    const showResize = computed({
      get: () => showResizeModal.value,
      set: (value) => {
        showResizeModal.value = value;
      },
    });
    const resizeTgt = computed(() => resizeTarget.value);
    const resW = computed({
      get: () => resizeW.value,
      set: (value) => {
        resizeW.value = value;
      },
    });
    const resH = computed({
      get: () => resizeH.value,
      set: (value) => {
        resizeH.value = value;
      },
    });
    const resLock = computed({
      get: () => resizeLock.value,
      set: (value) => {
        resizeLock.value = value;
      },
    });
    const showCrop = computed({
      get: () => showCropModal.value,
      set: (value) => {
        showCropModal.value = value;
      },
    });
    const cropTgt = computed(() => cropTarget.value);
    const cropDisplayRect = computed(() => {
      cropDisplayTick.value;
      const target = cropTarget.value;
      const imgEl = cropImgRef.value;
      if (!target || !imgEl?.clientWidth || !imgEl?.clientHeight) return null;
      const scaleX = imgEl.clientWidth / target.width;
      const scaleY = imgEl.clientHeight / target.height;
      return {
        left: `${imgEl.offsetLeft + cropX.value * scaleX}px`,
        top: `${imgEl.offsetTop + cropY.value * scaleY}px`,
        width: `${cropW.value * scaleX}px`,
        height: `${cropH.value * scaleY}px`,
      };
    });

    // templates
    const userTemplates = ref([]);
    const showSaveTplModal = ref(false);
    const tplTab = ref("builtin");
    const newTplName = ref("");
    const newTplDesc = ref("");
    const newTplIncContent = ref(false);
    const tplInclude = computed({
      get: () => newTplIncContent.value,
      set: (value) => {
        newTplIncContent.value = value;
      },
    });
    const pdfPaperSize = computed({
      get: () => exportPaperSize.value,
      set: (value) => {
        exportPaperSize.value = value;
      },
    });
    const pdfOrientation = computed({
      get: () => exportOrientation.value,
      set: (value) => {
        exportOrientation.value = value;
      },
    });
    const pdfMargins = computed({
      get: () => exportMargins.value,
      set: (value) => {
        exportMargins.value = value;
      },
    });
    const pdfScale = computed({
      get: () => exportScale.value,
      set: (value) => {
        exportScale.value = value;
      },
    });
    const pdfBg = computed({
      get: () => exportBgGraphics.value,
      set: (value) => {
        exportBgGraphics.value = value;
      },
    });

    // notifications
    const notifications = ref([]);

    // context menus
    const editorCtxOpen = ref(false);
    const editorCtxPos = ref({ x: 0, y: 0 });
    const editorCtxBlockIndex = ref(0);
    const previewCtxOpen = ref(false);
    const previewCtxPos = ref({ x: 0, y: 0 });
    const previewCtxBlockIndex = ref(0);
    const syncScrollSource = ref("editor");
    const fileCtxOpen = ref(false);
    const fileCtxPos = ref({ x: 0, y: 0 });
    const fileCtxTarget = ref(null);

    const shortcuts = SHORTCUTS;
    const tutorialSections = [
      {
        icon: "ti-sparkles",
        title: "Start Fast",
        items: [
          "Create a file from the sidebar or topbar, then write Markdown in the editor.",
          "Switch between editor, split, preview, and focus modes from the topbar.",
          "Use Templates for ready-made research papers, QCM exams, lab reports, posters, product specs, and more.",
          "Template variables such as {{date}}, {{title}}, {{author}}, {{year}}, and {{filename}} render automatically.",
        ],
      },
      {
        icon: "ti-markdown",
        title: "Write Markdown",
        items: [
          "Use headings, lists, blockquotes, tables, links, images, code fences, and horizontal rules.",
          "Use Paste as Markdown to bring formatted web or document content into the editor cleanly.",
          "Open the block organizer to reorder, duplicate, delete, and insert document blocks.",
          "Use the source-backed table editor from the preview toolbar to edit Markdown tables visually.",
        ],
      },
      {
        icon: "ti-math-function",
        title: "Math And Diagrams",
        items: [
          "Open the LaTeX builder for symbols, matrices, cases, fractions, and common formulas.",
          "Write inline math with $...$ and display math with $$...$$.",
          "Open the Mermaid builder to insert flowcharts, sequence diagrams, class diagrams, timelines, ER diagrams, Gantt charts, and more.",
          "Open a diagram from the preview to zoom, pan, copy source, or export SVG/PNG.",
        ],
      },
      {
        icon: "ti-list-check",
        title: "QCM Exercises",
        items: [
          "Start a question with ??, mark correct answers with - [x], wrong answers with - [ ], and explanations with ?!.",
          "QCM blocks support LaTeX inside questions, choices, and explanations.",
          "Single-answer and multi-answer questions check automatically as users select choices.",
          "Export QCM content as interactive HTML, structured JSON, or a printable answer sheet.",
        ],
      },
      {
        icon: "ti-photo",
        title: "Images And Blocks",
        items: [
          "Use the image manager to upload, crop, resize, select, and insert images.",
          "Images are stored in the workspace and can be embedded into HTML and Word-compatible exports.",
          "Use preview block controls to resize, align, add borders, change background, adjust padding, and tune radius.",
          "Per-file style settings let each document keep its own visual identity.",
        ],
      },
      {
        icon: "ti-presentation",
        title: "Research Posters",
        items: [
          "Structure the source document with ## sections, then open Export > Research Poster.",
          "Choose poster size, orientation, columns, and theme.",
          "Drag sections into layout slots or use auto-fill, then reorder or clear slots as needed.",
          "Print the poster to PDF with dynamic page sizing for the selected poster format.",
        ],
      },
      {
        icon: "ti-download",
        title: "Export And Backup",
        items: [
          "Export Markdown, HTML, PDF print, Word-compatible .doc, JSON, QCM assets, and workspace ZIP.",
          "HTML and Word-compatible exports include metadata and embedded app-managed images.",
          "Use Settings to backup or restore the entire workspace.",
          "Quota warnings help protect image-heavy workspaces before storage becomes risky.",
        ],
      },
      {
        icon: "ti-shield-check",
        title: "Reliability",
        items: [
          "Autosave writes are queued so newer content is not overwritten by stale saves.",
          "Snapshots preserve history and can be restored from the History panel.",
          "Use file search and drag reorder to keep larger workspaces manageable.",
          "Before clearing browser data or changing devices, export a workspace backup or ZIP.",
        ],
      },
    ];

    function applyThemeMode(enabled) {
      if (enabled) document.documentElement.setAttribute("data-theme", "dark");
      else document.documentElement.removeAttribute("data-theme");
      document.documentElement.classList.toggle("dark", enabled);
      const hljsTheme = document.getElementById("hljs-theme");
      if (hljsTheme) {
        hljsTheme.href = enabled
          ? "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css"
          : "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css";
      }
    }

    function resolveThemeMode(mode = themeMode.value) {
      return mode === "system" ? systemDarkMode.value : mode === "dark";
    }

    function applyThemePreference(mode = themeMode.value) {
      const enabled = resolveThemeMode(mode);
      darkMode.value = enabled;
      applyThemeMode(enabled);
      editorInstance?.setDarkMode(enabled);
      scheduleRender?.();
    }

    function setThemeMode(mode) {
      themeMode.value = ["light", "dark", "system"].includes(mode)
        ? mode
        : "system";
      applyThemePreference(themeMode.value);
      setSetting("themeMode", themeMode.value);
      setSetting("darkMode", darkMode.value);
    }

    function cycleThemeMode() {
      const modes = ["light", "dark", "system"];
      const next = modes[(modes.indexOf(themeMode.value) + 1) % modes.length];
      setThemeMode(next);
    }

    const themeModeIcon = computed(() => {
      if (themeMode.value === "system") return "ti ti-device-desktop";
      return darkMode.value ? "ti ti-sun" : "ti ti-moon";
    });

    const themeModeLabel = computed(() => {
      if (themeMode.value === "system")
        return `System (${darkMode.value ? "dark" : "light"})`;
      return darkMode.value ? "Dark" : "Light";
    });

    const ctxMenu = computed(() => {
      if (fileCtxOpen.value) {
        return {
          show: true,
          type: "file",
          x: fileCtxPos.value.x,
          y: fileCtxPos.value.y,
          fileId: fileCtxTarget.value?.id || null,
        };
      }
      if (previewCtxOpen.value) {
        return {
          show: true,
          type: "preview",
          x: previewCtxPos.value.x,
          y: previewCtxPos.value.y,
          fileId: null,
        };
      }
      if (editorCtxOpen.value) {
        return {
          show: true,
          type: "editor",
          x: editorCtxPos.value.x,
          y: editorCtxPos.value.y,
          fileId: null,
        };
      }
      return { show: false, type: "editor", x: 0, y: 0, fileId: null };
    });

    // resize split
    const editorWidth = ref(560);

    // autosave status
    const autosaveStatus = ref("saved"); // 'saved' | 'saving' | 'unsaved'
    const autosaveDelay = ref(2000);
    let syncingEditorProgrammatically = false;
    let systemThemeMedia = null;
    let systemThemeListener = null;

    // snapshots panel
    const snapshots = ref([]);
    const snapshotFreq = ref(5); // minutes between auto-snapshots
    let lastSnapshotTime = Date.now();
    let snapshotTimer = null;

    // settings
    const settingsAutosaveDelay = ref(2000);
    const settingsSnapshotFreq = ref(5);
    const settingsEditorFontSize = ref(15);
    const settingsLineHeight = ref(1.7);
    const settingsWordWrap = ref(true);
    const settingsSpellcheck = ref(false);

    // ── computed ─────────────────────────────────────────────────────────────

    const activeFile = computed(
      () => files.value.find((f) => f.id === activeFileId.value) || null,
    );

    const filteredFiles = computed(() => {
      const query = fileSearch.value.trim().toLowerCase();
      if (!query) return files.value;
      return files.value.filter((file) =>
        (file.name || "").toLowerCase().includes(query),
      );
    });

    const isFileSearchActive = computed(() => Boolean(fileSearch.value.trim()));

    const currentContent = computed({
      get: () => activeFile.value?.content || "",
      set: (v) => {
        const f = activeFile.value;
        if (f) {
          f.content = v;
          markUnsaved();
        }
      },
    });

    function stripMarkdownTitle(text) {
      return String(text || "")
        .replace(/^#+\s*/, "")
        .replace(/[*_`[\]()]/g, "")
        .trim();
    }

    function getContentTitle(content) {
      const h1 = String(content || "")
        .split("\n")
        .find((line) => /^#\s+/.test(line) && !/{{\s*title\s*}}/i.test(line));
      return h1 ? stripMarkdownTitle(h1) : "";
    }

    function buildTemplateVariableMap(content = "", overrides = {}) {
      const now = new Date();
      const pad = (value) => String(value).padStart(2, "0");
      const fileName = overrides.filename || activeFile.value?.name || "untitled.md";
      const title =
        overrides.title ||
        exportTitle.value ||
        getContentTitle(content) ||
        fileName.replace(/\.[^.]+$/, "") ||
        "Untitled";
      const author = overrides.author || exportAuthor.value || "Author";
      const monthName = now.toLocaleString(undefined, { month: "long" });
      const values = {
        app: "Markdown Studio",
        title,
        author,
        date: now.toLocaleDateString(),
        today: now.toLocaleDateString(),
        time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        datetime: now.toLocaleString(),
        isodate: now.toISOString().slice(0, 10),
        iso: now.toISOString(),
        year: String(now.getFullYear()),
        month: pad(now.getMonth() + 1),
        monthname: monthName,
        day: pad(now.getDate()),
        filename: fileName,
        file: fileName,
        theme: overrides.theme || renderTheme.value || "default",
        template: overrides.template || "",
      };
      values["iso-date"] = values.isodate;
      values["month-name"] = monthName;
      return values;
    }

    function renderTemplateVariables(content, overrides = {}) {
      const source = String(content || "");
      const values = buildTemplateVariableMap(source, overrides);
      return source.replace(/{{\s*(!?[\w.-]+|raw:[\w.-]+)\s*}}/g, (match, key) => {
        const normalized = String(key || "").toLowerCase();
        if (normalized.startsWith("!")) return `{{${normalized.slice(1)}}}`;
        if (normalized.startsWith("raw:")) return `{{${normalized.slice(4)}}}`;
        return Object.prototype.hasOwnProperty.call(values, normalized)
          ? values[normalized]
          : match;
      });
    }

    function renderMarkdownToHtml(markdown) {
      try {
        if (!window.marked) return "<p>Loading...</p>";
        let src = renderTemplateVariables(markdown || "");
        const mathBlocks = [];
        const qcm = extractQcmBlocks(src);
        src = qcm.source;

        src = src.replace(/\$\$([\s\S]+?)\$\$/g, (match, expr) => {
          const id = `KATEXDISPLAYPLACEHOLDER${mathBlocks.length}XYZ`;
          mathBlocks.push({ id, expr, displayMode: true });
          return id;
        });

        src = src.replace(/\$([^\n$]+?)\$/g, (match, expr) => {
          const id = `KATEXINLINEPLACEHOLDER${mathBlocks.length}XYZ`;
          mathBlocks.push({ id, expr, displayMode: false });
          return id;
        });

        let html = sanitizeHtml(marked.parse(src));

        if (window.katex) {
          mathBlocks.forEach((block) => {
            try {
              const rendered = katex.renderToString(block.expr.trim(), {
                displayMode: block.displayMode,
                throwOnError: false,
              });
              const wrapper = block.displayMode
                ? `<div class="katex-block">${rendered}</div>`
                : `<span class="katex-inline">${rendered}</span>`;
              html = html.replace(block.id, wrapper);
            } catch (e) {
              const errWrapper = block.displayMode
                ? `<div class="katex-error">LaTeX: ${escHtml(e.message)}</div>`
                : `<span class="katex-error">${escHtml(block.expr)}</span>`;
              html = html.replace(block.id, errWrapper);
            }
          });
        }

        qcm.widgets.forEach((widget) => {
          html = html.replace(`<p>${widget.placeholder}</p>`, widget.html);
          html = html.replace(widget.placeholder, widget.html);
        });

        return html;
      } catch (error) {
        return renderPreviewErrorHtml(error);
      }
    }

    function splitPreviewSource(src) {
      const segments = [];
      const mermaidFence = /```mermaid[^\n]*\n[\s\S]*?```/gi;
      let cursor = 0;
      let match;
      let textIndex = 0;
      let mermaidIndex = 0;

      while ((match = mermaidFence.exec(src))) {
        if (match.index > cursor) {
          const text = src.slice(cursor, match.index);
          segments.push({
            type: "markdown",
            key: `md:${textIndex++}`,
            html: renderMarkdownToHtml(text),
          });
        }

        const source = match[0];
        segments.push({
          type: "mermaid",
          key: `mermaid:${mermaidIndex++}:${stableHash(source)}`,
          html: renderMarkdownToHtml(source),
        });
        cursor = match.index + source.length;
      }

      if (cursor < src.length || !segments.length) {
        const text = src.slice(cursor);
        segments.push({
          type: "markdown",
          key: `md:${textIndex++}`,
          html: renderMarkdownToHtml(text),
        });
      }

      return segments;
    }

    const previewSegments = computed(() =>
      splitPreviewSource(currentContent.value || ""),
    );

    const renderedHtml = computed(() =>
      previewSegments.value.map((segment) => segment.html).join(""),
    );

    function escapeRegExp(value) {
      return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function decorateMedicalHtml(html, query = "") {
      if (typeof DOMParser === "undefined") return html;
      const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
      const root = doc.body.firstElementChild;
      if (!root) return html;
      const emphasis = /\b\d+(?:[.,]\d+)?\s?(?:mg|mcg|μg|g|kg|mL|ml|L|dL|IU|units?|mmHg|mmol\/L|mEq\/L|%)\b/gi;
      const search = String(query || "").trim();
      const searchPattern = search ? new RegExp(escapeRegExp(search), "gi") : null;
      const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let node;
      while ((node = walker.nextNode())) {
        if (!/^(SCRIPT|STYLE|MARK)$/i.test(node.parentElement?.tagName || "")) nodes.push(node);
      }
      nodes.forEach((textNode) => {
        const text = textNode.nodeValue || "";
        const pattern = searchPattern
          ? new RegExp(`(${searchPattern.source})|(${emphasis.source})`, "gi")
          : emphasis;
        if (!pattern.test(text)) {
          pattern.lastIndex = 0;
          return;
        }
        pattern.lastIndex = 0;
        const fragment = doc.createDocumentFragment();
        let cursor = 0;
        text.replace(pattern, (match, searchMatch, emphasisMatch, offset) => {
          if (offset > cursor) fragment.appendChild(doc.createTextNode(text.slice(cursor, offset)));
          const mark = doc.createElement("mark");
          mark.className = searchMatch ? "medical-search-hit" : "medical-emphasis";
          mark.textContent = match;
          fragment.appendChild(mark);
          cursor = offset + match.length;
          return match;
        });
        if (cursor < text.length) fragment.appendChild(doc.createTextNode(text.slice(cursor)));
        textNode.parentNode?.replaceChild(fragment, textNode);
      });
      return root.innerHTML;
    }

    function buildMedicalPages(source) {
      const text = String(source || "");
      const marker = /<!--[ \t]*SOURCE_PAGE[ \t]*:[ \t]*(\d+)[ \t]*-->/gi;
      const matches = [...text.matchAll(marker)];
      const chunks = [];
      if (!matches.length) {
        chunks.push({ number: 1, content: text });
      } else {
        if (matches[0].index > 0 && text.slice(0, matches[0].index).trim()) {
          chunks.push({ number: 1, content: text.slice(0, matches[0].index) });
        }
        matches.forEach((match, index) => {
          const start = match.index + match[0].length;
          const end = matches[index + 1]?.index ?? text.length;
          chunks.push({ number: Number(match[1]), content: text.slice(start, end) });
        });
      }
      return chunks.map((page, pageIndex) => {
        const rawBlocks = page.content.split(/\n\s*\n/).filter((block) => block.trim());
        const blocks = (rawBlocks.length ? rawBlocks : [page.content]).map((block, blockIndex) => ({
          id: `${pageIndex}-${blockIndex}`,
          source: block,
          html: decorateMedicalHtml(renderMarkdownToHtml(block), medicalSearch.value),
          emphasis: /\b(contraindication|contraindications|treatment|diagnosis|symptoms?|signs?|complications?|mechanism)\b/i.test(block),
        }));
        return { id: `medical-page-${pageIndex}`, number: page.number, blocks };
      });
    }

    const medicalPages = computed(() => buildMedicalPages(currentContent.value));
    const medicalVisiblePages = computed(() =>
      medicalFocusMode.value
        ? medicalPages.value.slice(medicalFocusPage.value, medicalFocusPage.value + 1)
        : medicalPages.value,
    );
    const medicalMatchCount = computed(() => {
      const query = medicalSearch.value.trim().toLowerCase();
      if (!query) return 0;
      return medicalPages.value.reduce(
        (count, page) => count + page.blocks.filter((block) => block.source.toLowerCase().includes(query)).length,
        0,
      );
    });

    function medicalBlockMatches(block) {
      const query = medicalSearch.value.trim().toLowerCase();
      return !query || block.source.toLowerCase().includes(query);
    }

    function isMedicalPageOpen(page) {
      return medicalExpanded.value[page.id] !== false;
    }

    function toggleMedicalPage(page) {
      medicalExpanded.value = { ...medicalExpanded.value, [page.id]: !isMedicalPageOpen(page) };
    }

    function setAllMedicalPages(open) {
      const next = {};
      medicalPages.value.forEach((page) => { next[page.id] = open; });
      medicalExpanded.value = next;
    }

    function toggleMedicalRecall(page, block) {
      const key = `${page.id}:${block.id}`;
      medicalRevealed.value = { ...medicalRevealed.value, [key]: !medicalRevealed.value[key] };
    }

    function isMedicalRevealed(page, block) {
      return medicalRevealed.value[`${page.id}:${block.id}`] !== false;
    }

    function setMedicalFocus(enabled) {
      medicalFocusMode.value = enabled;
      if (enabled) medicalFocusPage.value = Math.min(medicalFocusPage.value, Math.max(0, medicalPages.value.length - 1));
    }

    function moveMedicalFocus(delta) {
      medicalFocusPage.value = Math.max(0, Math.min(medicalPages.value.length - 1, medicalFocusPage.value + delta));
    }

    const wordCount = computed(
      () =>
        (currentContent.value || "").trim().split(/\s+/).filter(Boolean).length,
    );

    const charCount = computed(() => (currentContent.value || "").length);

    const lineCount = computed(
      () => (currentContent.value || "").split("\n").length,
    );

    const readTime = computed(() =>
      Math.max(1, Math.round(wordCount.value / 200)),
    );

    const headings = computed(() => {
      const h = [];
      const lines = (currentContent.value || "").split("\n");
      for (const line of lines) {
        const m = line.match(/^(#{1,6})\s+(.+)/);
        if (m) {
          h.push({
            level: m[1].length,
            text: m[2],
            slug: m[2]
              .toLowerCase()
              .replace(/[^\w\s-]/g, "")
              .replace(/\s+/g, "-"),
          });
        }
      }
      return h;
    });

    function getPosterSourceTitle() {
      const h1 = (currentContent.value || "")
        .split("\n")
        .find((line) => /^#\s+/.test(line));
      if (h1) return stripMarkdownTitle(renderTemplateVariables(h1.replace(/^#\s+/, "")));
      return activeFile.value?.name?.replace(/\.[^.]+$/, "") || "Research Poster";
    }

    const posterPageSize = computed(() => {
      const size =
        posterSizeOptions.find((item) => item.id === posterSize.value) ||
        posterSizeOptions[0];
      const wide = posterOrientation.value === "landscape";
      const width = wide ? Math.max(size.width, size.height) : Math.min(size.width, size.height);
      const height = wide ? Math.min(size.width, size.height) : Math.max(size.width, size.height);
      return { ...size, width, height };
    });

    const posterCanvasStyle = computed(() => ({
      "--poster-columns": posterColumns.value,
      "--poster-page-width": `${posterPageSize.value.width}mm`,
      "--poster-page-height": `${posterPageSize.value.height}mm`,
      aspectRatio: `${posterPageSize.value.width} / ${posterPageSize.value.height}`,
    }));

    const posterSections = computed(() => {
      const source = currentContent.value || "";
      const lines = source.split("\n");
      const sections = [];
      const intro = [];
      let current = null;

      lines.forEach((line) => {
        const h2 = line.match(/^##\s+(.+)/);
        if (h2) {
          if (current) sections.push(current);
          current = { title: h2[1].trim(), body: [] };
          return;
        }
        if (current) current.body.push(line);
        else if (!/^#\s+/.test(line)) intro.push(line);
      });

      if (current) sections.push(current);

      const panels = [];
      const introText = intro.join("\n").trim();
      if (introText) {
        const id = `poster-intro-${stableHash(introText)}`;
        panels.push({
          id,
          title: "Overview",
          body: introText,
          html: renderMarkdownToHtml(introText),
        });
      }

      sections.forEach((section, index) => {
        const body = section.body.join("\n").trim();
        const id = `poster-${index}-${stableHash(section.title + body)}`;
        panels.push({
          id,
          title: section.title,
          body: body || section.title,
          html: renderMarkdownToHtml(body || section.title),
        });
      });

      if (!panels.length) {
        const id = `poster-full-${stableHash(source)}`;
        panels.push({
          id,
          title: getPosterSourceTitle(),
          body: source || "Start writing to generate a poster.",
          html: renderMarkdownToHtml(source || "Start writing to generate a poster."),
        });
      }

      return panels;
    });

    const posterAssignedIds = computed(() =>
      posterLayout.value.filter((id) => posterSections.value.some((section) => section.id === id)),
    );

    const posterUnassignedSections = computed(() => {
      const assigned = new Set(posterAssignedIds.value);
      return posterSections.value.filter((section) => !assigned.has(section.id));
    });

    const posterPanels = computed(() => {
      const sectionMap = new Map(posterSections.value.map((section) => [section.id, section]));
      const assigned = posterLayout.value
        .map((id, index) => {
          const section = sectionMap.get(id);
          return section ? { ...section, slot: index + 1 } : null;
        })
        .filter(Boolean);
      return assigned.length ? assigned : posterSections.value.map((section, index) => ({ ...section, slot: index + 1 }));
    });

    const qcmQuestions = computed(() =>
      extractQcmBlocks(currentContent.value || "", false).widgets.map((widget) => widget.question),
    );

    const hasQcmQuestions = computed(() => qcmQuestions.value.length > 0);

    const fontChoices = [
      { name: "System", val: "-apple-system,BlinkMacSystemFont,sans-serif" },
      { name: "DM Sans", val: '"DM Sans",sans-serif' },
      { name: "IBM Plex", val: '"IBM Plex Sans",sans-serif' },
      { name: "Crimson", val: '"Crimson Pro",Georgia,serif' },
      { name: "Libre B.", val: '"Libre Baskerville",Georgia,serif' },
      { name: "Source S.", val: '"Source Serif 4",Georgia,serif' },
      { name: "Raleway", val: '"Raleway",sans-serif' },
    ];

    const renderThemes = RENDER_THEMES;

    const currentThemeName = computed(
      () =>
        RENDER_THEMES.find((t) => t.id === renderTheme.value)?.name ||
        "Default",
    );

    const previewPageStyle = computed(() => {
      const s = {};
      if (customFont.value) s.fontFamily = customFont.value;
      if (cFontSize.value)
        s.fontSize =
          previewScaleScope.value === "all"
            ? cFontSize.value * previewScaleFactor.value + "px"
            : cFontSize.value + "px";
      if (cLineH.value) s.lineHeight = cLineH.value;
      if (cWidth.value) s.maxWidth = cWidth.value + "px";
      if (cPadH.value) {
        s.paddingLeft = cPadH.value + "px";
        s.paddingRight = cPadH.value + "px";
      }
      if (cPadV.value) {
        s.paddingTop = cPadV.value + "px";
        s.paddingBottom = cPadV.value + "px";
      }
      if (cColorText.value) s.color = cColorText.value;
      if (cColorBg.value) s.background = cColorBg.value;
      if (cParaGap.value) s["--para-gap"] = cParaGap.value + "em";
      if (cHeadFont.value) s["--head-font"] = cHeadFont.value;
      if (cH1.value) s["--h1-size"] = cH1.value + "em";
      if (cH2.value) s["--h2-size"] = cH2.value + "em";
      if (cColorHead.value) s["--color-head"] = cColorHead.value;
      if (cColorLink.value) s["--color-link"] = cColorLink.value;
      s["--text-wrap"] = previewTextWrap.value ? "break-word" : "normal";
      s["--text-word-break"] = previewTextWrap.value ? "break-word" : "normal";
      s["--code-font-size"] = `${previewCodeFontScale.value}em`;
      s["--code-white-space"] = previewCodeWrap.value ? "pre-wrap" : "pre";
      s["--code-overflow-wrap"] = previewCodeWrap.value ? "anywhere" : "normal";
      s["--latex-font-size"] = `${previewLatexFontScale.value}em`;
      s["--table-width"] =
        previewTableLayout.value === "full" ? "100%" : "fit-content";
      s["--table-display"] =
        previewTableLayout.value === "fit" || previewTableLayout.value === "center"
          ? "table"
          : "block";
      s["--table-margin"] =
        previewTableLayout.value === "center" ? "0.7em auto" : "0.7em 0";
      s["--table-font-size"] = `${previewTableFontScale.value}em`;
      s["--table-pad-y"] = previewTableCompact.value ? "0.22em" : "0.42em";
      s["--table-pad-x"] = previewTableCompact.value ? "0.5em" : "0.68em";
      s["--table-stripe"] = previewTableStriped.value
        ? "color-mix(in srgb, var(--acc) 7%, transparent)"
        : "transparent";
      s["--media-scale"] = String(previewScaleFactor.value);
      s["--media-block-border"] = mediaBlockBorder.value
        ? "1px solid var(--border2)"
        : "1px solid transparent";
      s["--media-block-bg"] =
        mediaBlockBgMode.value === "color" ? mediaBlockBgColor.value : "transparent";
      return s;
    });

    const previewPageClass = computed(() => {
      if (previewScaleScope.value === "images") return "scale-images";
      if (previewScaleScope.value === "mermaid") return "scale-mermaid";
      if (previewScaleScope.value === "media") return "scale-media";
      return "scale-all";
    });

    let editorScrollEl = null;
    let previewScrollEl = null;
    let scrollSyncing = false;
    let syncIndicatorTimer = null;

    const filteredBlockTypes = computed(() => {
      if (!blockTypeSearch.value) return BLOCK_TYPES;
      return BLOCK_TYPES.filter((b) =>
        b.label.toLowerCase().includes(blockTypeSearch.value.toLowerCase()),
      );
    });

    // ── helpers ──────────────────────────────────────────────────────────────

    function genId() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2);
    }

    const settingDebounceTimers = new Map();
    function setSettingDebounced(key, value, delay = 300) {
      clearTimeout(settingDebounceTimers.get(key));
      settingDebounceTimers.set(
        key,
        setTimeout(() => {
          settingDebounceTimers.delete(key);
          setSetting(key, value);
        }, delay),
      );
    }

    function notify(msg, type = "success", duration = 2500) {
      const id = genId();
      notifications.value.push({ id, msg, type });
      setTimeout(() => {
        notifications.value = notifications.value.filter((n) => n.id !== id);
      }, duration);
    }

    let lastStorageQuotaWarning = 0;
    async function checkStorageQuota(context = "Storage") {
      if (!navigator.storage?.estimate) return;
      try {
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        if (!quota) return;
        const ratio = usage / quota;
        const now = Date.now();
        if (ratio < 0.85 || now - lastStorageQuotaWarning < 60000) return;
        lastStorageQuotaWarning = now;
        notify(
          `${context} is using ${Math.round(ratio * 100)}% of browser storage. Export a backup soon.`,
          "warn",
          6000,
        );
      } catch {
        // Storage estimate is best-effort and not supported in every browser mode.
      }
    }

    function openAppDialog(options) {
      if (appDialogResolve) appDialogResolve({ confirmed: false, values: {} });
      appDialog.value = {
        open: true,
        title: options.title || "Confirm",
        message: options.message || "",
        fields: (options.fields || []).map((field) => ({ ...field })),
        confirmText: options.confirmText || "OK",
        cancelText: options.cancelText || "Cancel",
        danger: Boolean(options.danger),
      };
      return new Promise((resolve) => {
        appDialogResolve = resolve;
        nextTick(() => {
          document.querySelector(".app-dialog-field input")?.focus();
        });
      });
    }

    function closeAppDialog(confirmed = false) {
      const values = {};
      appDialog.value.fields.forEach((field) => {
        values[field.id] = field.value || "";
      });
      appDialog.value.open = false;
      if (appDialogResolve) appDialogResolve({ confirmed, values });
      appDialogResolve = null;
    }

    async function confirmApp(message, options = {}) {
      const result = await openAppDialog({
        title: options.title || "Confirm action",
        message,
        confirmText: options.confirmText || "Confirm",
        cancelText: options.cancelText || "Cancel",
        danger: options.danger,
      });
      return result.confirmed;
    }

    async function promptApp(options) {
      const result = await openAppDialog({
        title: options.title || "Enter details",
        message: options.message || "",
        confirmText: options.confirmText || "Insert",
        cancelText: options.cancelText || "Cancel",
        fields: options.fields || [],
      });
      return result.confirmed ? result.values : null;
    }

    function createBaseFileStyle() {
      return {
        version: 1,
        renderTheme: "default",
        customFont: "",
        cFontSize: 17,
        cLineH: 1.7,
        cParaGap: 0.8,
        cHeadFont: "",
        cH1: 2.2,
        cH2: 1.7,
        cWidth: 780,
        cPadH: 40,
        cPadV: 40,
        cColorText: "",
        cColorHead: "",
        cColorLink: "",
        cColorBg: "",
        previewTextWrap: true,
        previewCodeWrap: false,
        previewCodeFontScale: 1,
        previewLatexFontScale: 1,
        previewTableLayout: "full",
        previewTableStriped: true,
        previewTableCompact: false,
        previewTableFontScale: 1,
        previewScaleScope: "all",
        previewScaleFactor: 1,
        previewBlockSizes: {},
        previewBlockAlignments: {},
        previewBlockStyles: {},
        mediaBlockBorder: false,
        mediaBlockBgMode: "transparent",
        mediaBlockBgColor: "#ffffff",
      };
    }

    function sanitizeStyleDefaults(style) {
      const {
        previewBlockSizes,
        previewBlockAlignments,
        previewBlockStyles,
        ...defaults
      } = style || {};
      return defaults;
    }

    function createDefaultFileStyle() {
      return {
        ...createBaseFileStyle(),
        ...sanitizeStyleDefaults(fileStyleDefaults.value),
        previewBlockSizes: {},
        previewBlockAlignments: {},
        previewBlockStyles: {},
      };
    }

    function captureFileStyle() {
      return {
        version: 1,
        renderTheme: renderTheme.value,
        customFont: customFont.value,
        cFontSize: cFontSize.value,
        cLineH: cLineH.value,
        cParaGap: cParaGap.value,
        cHeadFont: cHeadFont.value,
        cH1: cH1.value,
        cH2: cH2.value,
        cWidth: cWidth.value,
        cPadH: cPadH.value,
        cPadV: cPadV.value,
        cColorText: cColorText.value,
        cColorHead: cColorHead.value,
        cColorLink: cColorLink.value,
        cColorBg: cColorBg.value,
        previewTextWrap: previewTextWrap.value,
        previewCodeWrap: previewCodeWrap.value,
        previewCodeFontScale: previewCodeFontScale.value,
        previewLatexFontScale: previewLatexFontScale.value,
        previewTableLayout: previewTableLayout.value,
        previewTableStriped: previewTableStriped.value,
        previewTableCompact: previewTableCompact.value,
        previewTableFontScale: previewTableFontScale.value,
        previewScaleScope: previewScaleScope.value,
        previewScaleFactor: previewScaleFactor.value,
        previewBlockSizes: { ...previewBlockSizes.value },
        previewBlockAlignments: { ...previewBlockAlignments.value },
        previewBlockStyles: { ...previewBlockStyles.value },
        mediaBlockBorder: mediaBlockBorder.value,
        mediaBlockBgMode: mediaBlockBgMode.value,
        mediaBlockBgColor: mediaBlockBgColor.value,
      };
    }

    let applyingFileStyle = false;
    function applyFileStyle(style) {
      const s = { ...createDefaultFileStyle(), ...(style || {}) };
      applyingFileStyle = true;
      renderTheme.value = s.renderTheme;
      customFont.value = s.customFont;
      cFontSize.value = s.cFontSize;
      cLineH.value = s.cLineH;
      cParaGap.value = s.cParaGap;
      cHeadFont.value = s.cHeadFont;
      cH1.value = s.cH1;
      cH2.value = s.cH2;
      cWidth.value = s.cWidth;
      cPadH.value = s.cPadH;
      cPadV.value = s.cPadV;
      cColorText.value = s.cColorText;
      cColorHead.value = s.cColorHead;
      cColorLink.value = s.cColorLink;
      cColorBg.value = s.cColorBg;
      previewTextWrap.value = s.previewTextWrap !== false;
      previewCodeWrap.value = Boolean(s.previewCodeWrap);
      previewCodeFontScale.value = s.previewCodeFontScale || 1;
      previewLatexFontScale.value = s.previewLatexFontScale || 1;
      previewTableLayout.value = s.previewTableLayout;
      previewTableStriped.value = s.previewTableStriped;
      previewTableCompact.value = s.previewTableCompact;
      previewTableFontScale.value = s.previewTableFontScale;
      previewScaleScope.value = s.previewScaleScope;
      previewScaleFactor.value = s.previewScaleFactor;
      previewBlockSizes.value = { ...(s.previewBlockSizes || {}) };
      previewBlockAlignments.value = { ...(s.previewBlockAlignments || {}) };
      previewBlockStyles.value = { ...(s.previewBlockStyles || {}) };
      mediaBlockBorder.value = Boolean(s.mediaBlockBorder);
      mediaBlockBgMode.value = s.mediaBlockBgMode || "transparent";
      mediaBlockBgColor.value = s.mediaBlockBgColor || "#ffffff";
      nextTick(() => {
        applyingFileStyle = false;
        scheduleRender();
      });
    }

    function touchActiveFileStyle() {
      if (!activeFile.value || applyingFileStyle) return;
      const style = captureFileStyle();
      activeFile.value.style = style;
      fileStyleDefaults.value = sanitizeStyleDefaults(style);
      setSetting("fileStyleDefaults", fileStyleDefaults.value);
      markUnsaved();
    }

    function normalizeFileForStorage(file, overrides = {}) {
      const source = { ...(file || {}), ...overrides };
      const now = Date.now();
      return {
        id: source.id || genId(),
        name: source.name || "untitled.md",
        content: source.content || "",
        style: source.style || createDefaultFileStyle(),
        schemaVersion: FILE_RECORD_VERSION,
        createdAt: source.createdAt || now,
        updatedAt: source.updatedAt || now,
      };
    }

    function persistFile(file, overrides = {}) {
      return saveFile(normalizeFileForStorage(file, overrides));
    }

    function markUnsaved() {
      if (!activeFile.value) return;
      unsaved.value = true;
      autosaveStatus.value = "unsaved";
      scheduleAutosave(
        normalizeFileForStorage(activeFile.value, {
          content: currentContent.value,
          style: activeFile.value.style || captureFileStyle(),
        }),
        () => {
          unsaved.value = false;
          autosaveStatus.value = "saved";
          // Possibly create snapshot
          maybeCreateSnapshot();
        },
        (error) => {
          autosaveStatus.value = "unsaved";
          notify(error?.message || "Autosave failed", "warn");
        },
        () => {
          autosaveStatus.value = "saving";
        },
      );
    }

    // ── editor interaction ────────────────────────────────────────────────────

    /** Called by toolbar fmt() buttons → wraps selection */
    function fmt(prefix, suffix) {
      if (!editorInstance) return;
      editorInstance.wrapSelection(prefix, suffix);
      syncFromEditor();
    }

    /** Called by toolbar fmtLine() → prepends prefix to current line(s) */
    function fmtLine(prefix) {
      if (!editorInstance) return;
      editorInstance.prefixLine(prefix);
      syncFromEditor();
    }

    /** Called by toolbar fmtBlock() → fence block */
    function fmtBlock(open, close) {
      if (!editorInstance) return;
      editorInstance.fenceBlock(open, close);
      syncFromEditor();
    }

    /** Insert arbitrary text at cursor */
    function insertText(text) {
      if (!editorInstance) return;
      editorInstance.insert(text);
      syncFromEditor();
    }

    function onEditorPaste(event) {
      const html = event.clipboardData?.getData("text/html");
      const plain = event.clipboardData?.getData("text/plain");
      if (!html || !/<[a-z][\s\S]*>/i.test(html)) return false;
      const markdown = htmlToMarkdown(html);
      if (!markdown || markdown.trim() === plain?.trim()) return false;
      insertText(markdown);
      notify("Pasted as Markdown", "success", 1200);
      return true;
    }

    /** Pull current value from editor → currentContent */
    function syncFromEditor() {
      if (!editorInstance || !activeFile.value) return;
      activeFile.value.content = editorInstance.getValue();
      markUnsaved();
    }

    /** Push content into editor (e.g. after file switch) */
    function syncToEditor(text) {
      if (!editorInstance) return;
      syncingEditorProgrammatically = true;
      try {
        editorInstance.setValue(text || "", { silent: true });
      } finally {
        syncingEditorProgrammatically = false;
      }
    }

    // ── file management ──────────────────────────────────────────────────────

    function applyFileOrder(order = []) {
      if (!Array.isArray(order) || !order.length) {
        files.value = [...files.value].sort(
          (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
        );
        return;
      }
      const rank = new Map(order.map((id, index) => [id, index]));
      files.value = [...files.value].sort((a, b) => {
        const ar = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
        const br = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
        if (ar !== br) return ar - br;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
    }

    function persistFileOrder() {
      setSetting(
        "fileOrder",
        files.value.map((file) => file.id),
      );
    }

    async function loadAllFiles() {
      const all = await getAllFiles();
      if (!all || all.length === 0) {
        // create default file
        const def = {
          id: genId(),
          name: "untitled.md",
          content: DEFAULT_CONTENT,
          style: createDefaultFileStyle(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await persistFile(def);
        files.value = [def];
      } else {
        files.value = all.map((file) => normalizeFileForStorage(file));
        applyFileOrder(await getSetting("fileOrder", []));
      }
      // Activate most recently updated
      const lastId = await getSetting("activeFileId", null);
      const target = files.value.find((f) => f.id === lastId) || files.value[0];
      await switchFile(target.id);
    }

    async function switchFile(id) {
      if (!id || id === activeFileId.value) return;
      // Flush any pending autosave for current file
      if (activeFileId.value) {
        cancelAutosave();
        if (unsaved.value && activeFile.value) {
          await persistFile(activeFile.value);
          unsaved.value = false;
        }
      }
      activeFileId.value = id;
      await setSetting("activeFileId", id);
      const file = await getFile(id);
      if (file) {
        // Ensure files array is up to date
        const idx = files.value.findIndex((f) => f.id === id);
        if (idx >= 0) files.value[idx] = file;
        else files.value.push(file);
        syncToEditor(file.content);
        applyFileStyle(file.style);
      }
      editingBlockIdx.value = -1;
      if (window.innerWidth <= 960) sidebarOpen.value = false;
      unsaved.value = false;
      autosaveStatus.value = "saved";
    }

    async function newFile() {
      const f = {
        id: genId(),
        name: "untitled.md",
        content: "",
        style: createDefaultFileStyle(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await persistFile(f);
      files.value.unshift(f);
      persistFileOrder();
      await switchFile(f.id);
    }

    async function deleteFile(id) {
      if (files.value.length <= 1) {
        notify("Cannot delete last file", "warn");
        return;
      }
      const ok = await confirmApp("Delete this file? This cannot be undone.", {
        title: "Delete file",
        confirmText: "Delete",
        danger: true,
      });
      if (!ok) return;
      await dbDeleteFile(id);
      files.value = files.value.filter((f) => f.id !== id);
      persistFileOrder();
      if (activeFileId.value === id) {
        await switchFile(files.value[0].id);
      }
    }

    async function saveFileFn() {
      if (!activeFile.value) return;
      await persistFile(activeFile.value, {
        content: editorInstance?.getValue() || currentContent.value,
        style: captureFileStyle(),
      });
      unsaved.value = false;
      autosaveStatus.value = "saved";
      notify("Saved", "success", 1200);
    }

    // rename
    function startRename() {
      renamingFile.value = true;
      renameVal.value = activeFile.value?.name || "";
      nextTick(() => renameInputRef.value?.focus());
    }
    function finishRename() {
      if (activeFile.value && renameVal.value.trim()) {
        activeFile.value.name = renameVal.value.trim();
        persistFile(activeFile.value);
      }
      renamingFile.value = false;
    }

    // file upload
    const mdFileInput = ref(null);
    const workspaceFileInput = ref(null);
    function triggerMdUpload() {
      mdFileInput.value?.click();
    }
    async function onMdFileUpload(e) {
      const file = e.target.files[0];
      if (!file) return;
      const isPdf = /\.pdf$/i.test(file.name);
      const isNotebook = /\.ipynb$/i.test(file.name);
      let text;
      let content;
      let name = file.name;
      if (isPdf) {
        try {
          content = await pdfToMarkdown(file);
        } catch (error) {
          notify(error?.message || "Could not import PDF", "warn");
          e.target.value = "";
          return;
        }
        if (!content.replace(/<!-- SOURCE_PAGE:\d+ -->/g, "").replace(/## 📄 Source Page \d+/g, "").trim()) {
          notify("PDF contains no extractable text", "warn");
          e.target.value = "";
          return;
        }
        name = file.name.replace(/\.pdf$/i, ".md");
      } else {
        text = await file.text();
        content = text;
      }
      if (isNotebook) {
        try {
          content = notebookToMarkdown(JSON.parse(text), file.name);
          name = file.name.replace(/\.ipynb$/i, ".md");
        } catch (error) {
          notify(error?.message || "Could not import notebook", "warn");
          e.target.value = "";
          return;
        }
      }
      const f = {
        id: genId(),
        name,
        content,
        style: createDefaultFileStyle(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await persistFile(f);
      files.value.unshift(f);
      persistFileOrder();
      await switchFile(f.id);
      notify(
        isPdf
          ? "PDF imported with source page markers"
          : isNotebook
            ? "Notebook imported"
            : "File uploaded",
        "success",
        1400,
      );
      e.target.value = "";
    }

    function onFileDragStart(event, id) {
      if (isFileSearchActive.value) {
        event.preventDefault();
        return;
      }
      draggedFileId.value = id;
      fileDragOverId.value = id;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
    }

    function onFileDragOver(event, id) {
      if (!draggedFileId.value || isFileSearchActive.value) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      fileDragOverId.value = id;
    }

    function onFileDrop(event, targetId) {
      event.preventDefault();
      const sourceId = draggedFileId.value || event.dataTransfer.getData("text/plain");
      draggedFileId.value = null;
      fileDragOverId.value = null;
      if (!sourceId || sourceId === targetId || isFileSearchActive.value) return;
      const next = [...files.value];
      const sourceIndex = next.findIndex((file) => file.id === sourceId);
      const targetIndex = next.findIndex((file) => file.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return;
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      files.value = next;
      persistFileOrder();
    }

    function onFileDragEnd() {
      draggedFileId.value = null;
      fileDragOverId.value = null;
    }

    function triggerWorkspaceRestore() {
      workspaceFileInput.value?.click();
    }

    async function backupWorkspace() {
      if (unsaved.value && activeFile.value) {
        await saveFileFn();
      }
      const data = await exportWorkspaceData();
      const backup = {
        app: "markdown-studio",
        schemaVersion: 1,
        ...data,
      };
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      downloadBlob(
        new Blob([JSON.stringify(backup, null, 2)], {
          type: "application/json",
        }),
        `markdown-studio-backup-${stamp}.json`,
      );
      checkStorageQuota("Workspace");
    }

    async function onWorkspaceRestore(e) {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (data?.app !== "markdown-studio" || !Array.isArray(data.files)) {
          notify("Invalid workspace backup file", "warn");
          return;
        }
        const ok = await confirmApp(
          "Restore this workspace backup? Current files, snapshots, templates, and image library will be replaced.",
          {
            title: "Restore workspace",
            confirmText: "Restore",
            danger: true,
          },
        );
        if (!ok) return;
        cancelAutosave();
        await importWorkspaceData(data);
        notify("Workspace restored. Reloading…", "success", 1600);
        setTimeout(() => window.location.reload(), 600);
      } catch (error) {
        notify(error?.message || "Workspace restore failed", "warn");
      }
    }

    // ── snapshots ────────────────────────────────────────────────────────────

    async function maybeCreateSnapshot() {
      const now = Date.now();
      const freq = snapshotFreq.value * 60 * 1000;
      if (now - lastSnapshotTime < freq) return;
      lastSnapshotTime = now;
      if (!activeFileId.value) return;
      await createSnapshot(
        activeFileId.value,
        editorInstance?.getValue() || currentContent.value,
      );
    }

    async function openHistory() {
      if (!activeFileId.value) return;
      snapshots.value = await getSnapshots(activeFileId.value);
      showHistory.value = true;
    }

    async function manualSnapshot() {
      if (!activeFileId.value) return;
      const content = editorInstance?.getValue() || currentContent.value;
      await createSnapshot(activeFileId.value, content, "Manual snapshot");
      snapshots.value = await getSnapshots(activeFileId.value);
      lastSnapshotTime = Date.now();
      notify("Snapshot created", "success");
    }

    async function restoreSnapshot(snap) {
      const ok = await confirmApp(
        `Restore snapshot from ${snap.label}? Current content will be replaced.`,
        {
          title: "Restore snapshot",
          confirmText: "Restore",
          danger: true,
        },
      );
      if (!ok) return;
      syncToEditor(snap.content);
      syncFromEditor();
      showHistory.value = false;
      notify("Snapshot restored", "success");
    }

    async function removeSnapshot(snap) {
      await deleteSnapshot(snap.id);
      snapshots.value = snapshots.value.filter((s) => s.id !== snap.id);
    }

    function formatSnapDate(ts) {
      return new Date(ts).toLocaleString();
    }

    // ── settings ─────────────────────────────────────────────────────────────

    async function openSettings() {
      settingsAutosaveDelay.value = await getSetting("autosaveDelay", 2000);
      settingsSnapshotFreq.value = await getSetting("snapshotFreq", 5);
      settingsEditorFontSize.value = await getSetting("editorFontSize", 15);
      settingsLineHeight.value = await getSetting("lineHeight", 1.7);
      settingsWordWrap.value = await getSetting("wordWrap", true);
      settingsSpellcheck.value = await getSetting("spellcheck", false);
      showSettings.value = true;
    }

    async function applySettings() {
      // persist
      await setSetting("autosaveDelay", settingsAutosaveDelay.value);
      await setSetting("snapshotFreq", settingsSnapshotFreq.value);
      await setSetting("editorFontSize", settingsEditorFontSize.value);
      await setSetting("lineHeight", settingsLineHeight.value);
      await setSetting("wordWrap", settingsWordWrap.value);
      await setSetting("spellcheck", settingsSpellcheck.value);

      // apply
      setAutosaveDelay(settingsAutosaveDelay.value);
      snapshotFreq.value = settingsSnapshotFreq.value;
      editorFontSize.value = settingsEditorFontSize.value;
      editorLineHeight.value = settingsLineHeight.value;
      wordWrap.value = settingsWordWrap.value;

      if (editorInstance) {
        editorInstance.setFontSize(settingsEditorFontSize.value);
        editorInstance.setWordWrap(settingsWordWrap.value);
      }

      showSettings.value = false;
      notify("Settings saved", "success");
    }

    // ── preview rendering ─────────────────────────────────────────────────────

    let renderTimer = null;
    function scheduleRender() {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(() => {
        nextTick(() => {
          const pages = [
            document.getElementById("preview-page"),
            document.querySelector(".focus-inner"),
          ].filter(Boolean);
          Promise.all(
            pages.map((page) =>
              postProcessPreviewContainer(
                page,
                previewBlockSizes.value,
                previewBlockAlignments.value,
                previewBlockStyles.value,
                imagePathMap.value,
                beginPreviewResize,
                touchActiveFileStyle,
                openBlockStyleEditor,
                openMermaidViewer,
                openTableEditor,
              ),
            ),
          ).then(() => {
            if (syncScrollEnabled.value) syncPreviewFromEditor();
          });
        });
      }, 250);
    }

    // ── editor keydown ───────────────────────────────────────────────────────

    function onEditorKeydown(e) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "s") {
        e.preventDefault();
        saveFileFn();
      }
      if (ctrl && e.key === "b") {
        e.preventDefault();
        fmt("**", "**");
      }
      if (ctrl && e.key === "i") {
        e.preventDefault();
        fmt("*", "*");
      }
      if (ctrl && e.key === "`") {
        e.preventDefault();
        fmt("`", "`");
      }
      if (ctrl && e.key === "m") {
        e.preventDefault();
        openLatexBuilder();
      }
      if (ctrl && e.key === "g") {
        e.preventDefault();
        openMermaidBuilder();
      }
      if (ctrl && e.key === "o") {
        e.preventDefault();
        activePanel.value =
          activePanel.value === "organizer" ? "editor" : "organizer";
      }
      if (ctrl && e.key === "f") {
        e.preventDefault();
        openFR();
      }
      if (ctrl && e.key === ",") {
        e.preventDefault();
        openSettings();
      }
      if (ctrl && e.key === "n") {
        e.preventDefault();
        newFile();
      }
      if (ctrl && e.shiftKey && e.key === "H") {
        e.preventDefault();
        openHistory();
      }
      if (e.key === "Escape" && focusMode.value) {
        focusMode.value = false;
      }
    }

    // ── window keydown (global) ──────────────────────────────────────────────

    function onWindowKeydown(e) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "s") {
        e.preventDefault();
        saveFileFn();
      }
      if (ctrl && e.key === ",") {
        e.preventDefault();
        openSettings();
      }
      if (ctrl && e.key === "n") {
        e.preventDefault();
        newFile();
      }
      if (e.key === "Escape") {
        if (appDialog.value.open) {
          closeAppDialog(false);
          return;
        }
        if (focusMode.value) {
          focusMode.value = false;
          return;
        }
        showLatex.value =
          showMermaid.value =
          showExport.value =
          showImgManager.value =
          showTemplates.value =
          showShortcuts.value =
          showTutorial.value =
          showFR.value =
          showSettings.value =
          showHistory.value =
            false;
        editorCtxOpen.value = previewCtxOpen.value = fileCtxOpen.value = false;
      }
    }

    // ── toolbar helpers ──────────────────────────────────────────────────────

    function undo() {
      editorInstance?.undo();
    }
    function redo() {
      editorInstance?.redo();
    }

    async function insertLink() {
      const values = await promptApp({
        title: "Insert link",
        confirmText: "Insert",
        fields: [
          { id: "url", label: "URL", value: "https://", placeholder: "https://" },
          { id: "label", label: "Label", value: "Link", placeholder: "Link text" },
        ],
      });
      if (!values) return;
      const url = values.url;
      const label = values.label;
      if (url) insertText(`[${label || "Link"}](${url})`);
    }

    function insertImageFromLib() {
      if (!images.value.length) {
        openImgManager();
        return;
      }
      // use first selected or prompt
      if (selectedImgs.value.length) {
        for (const imgId of selectedImgs.value) {
          const img = images.value.find((entry) => entry.id === imgId);
          if (img) insertText(`![${img.name}](${img.path})\n`);
        }
      } else {
        openImgManager();
      }
    }

    function insertTable() {
      insertText(
        "\n| Column 1 | Column 2 | Column 3 |\n" +
          "|----------|----------|----------|\n" +
          "| Cell 1   | Cell 2   | Cell 3   |\n" +
          "| Cell 4   | Cell 5   | Cell 6   |\n",
      );
    }

    function getMarkdownBlocksWithPositions() {
      const content = editorInstance?.getValue() || currentContent.value || "";
      const blocks = [];
      const pattern = /(?:^|\n{2,})([^\n](?:[\s\S]*?))(?=\n{2,}|$)/g;
      let match;
      while ((match = pattern.exec(content))) {
        const raw = match[1];
        const leadingBreaks = match[0].length - raw.length;
        blocks.push({
          content: raw,
          start: match.index + leadingBreaks,
          end: match.index + match[0].length,
        });
      }
      return { content, blocks };
    }

    function findTableBlockByIndex(tableIndex) {
      const { content, blocks } = getMarkdownBlocksWithPositions();
      let currentTable = 0;
      for (let index = 0; index < blocks.length; index++) {
        const parsed = parseMarkdownTableBlock(blocks[index].content);
        if (!parsed) continue;
        if (currentTable === tableIndex) {
          return { content, block: blocks[index], blockIndex: index, parsed };
        }
        currentTable++;
      }
      return null;
    }

    function openTableEditor(tableIndex) {
      const found = findTableBlockByIndex(tableIndex);
      if (!found) {
        notify("Could not find table source", "warn");
        return;
      }
      tableEditor.value = {
        tableIndex,
        blockIndex: found.blockIndex,
        headers: found.parsed.headers.map((cell) => cell),
        rows: found.parsed.rows.map((row) => row.map((cell) => cell)),
      };
      showTableEditor.value = true;
    }

    function addTableRow() {
      const width = Math.max(1, tableEditor.value.headers.length);
      tableEditor.value.rows.push(Array(width).fill(""));
    }

    function removeTableRow(index) {
      tableEditor.value.rows.splice(index, 1);
      if (!tableEditor.value.rows.length) addTableRow();
    }

    function addTableColumn() {
      const next = tableEditor.value.headers.length + 1;
      tableEditor.value.headers.push(`Column ${next}`);
      tableEditor.value.rows.forEach((row) => row.push(""));
    }

    function removeTableColumn(index) {
      if (tableEditor.value.headers.length <= 1) return;
      tableEditor.value.headers.splice(index, 1);
      tableEditor.value.rows.forEach((row) => row.splice(index, 1));
    }

    function applyTableEditor() {
      const found = findTableBlockByIndex(tableEditor.value.tableIndex);
      if (!found) {
        notify("Could not update table source", "warn");
        return;
      }
      const nextTable = serializeMarkdownTable(tableEditor.value);
      const nextContent =
        found.content.slice(0, found.block.start) +
        nextTable +
        found.content.slice(found.block.end);
      syncToEditor(nextContent);
      syncFromEditor();
      showTableEditor.value = false;
      notify("Table updated", "success", 1200);
    }

    function openBlockStyleEditor(key, kind) {
      const current = normalizePreviewBlockStyle(previewBlockStyles.value[key], kind);
      blockStyleEditor.value = {
        key,
        kind,
        ...current,
      };
      showBlockStyleEditor.value = true;
    }

    function applyBlockStyleEditor() {
      const editor = blockStyleEditor.value;
      if (!editor.key) return;
      const normalized = normalizePreviewBlockStyle(editor, editor.kind);
      previewBlockStyles.value = {
        ...previewBlockStyles.value,
        [editor.key]: normalized,
      };
      showBlockStyleEditor.value = false;
      touchActiveFileStyle();
      scheduleRender();
      notify("Block style updated", "success", 1200);
    }

    function resetBlockStyleEditor() {
      const key = blockStyleEditor.value.key;
      if (!key) return;
      const next = { ...previewBlockStyles.value };
      delete next[key];
      previewBlockStyles.value = next;
      showBlockStyleEditor.value = false;
      touchActiveFileStyle();
      scheduleRender();
      notify("Block style reset", "success", 1200);
    }

    function openMermaidViewer(key, payload = {}) {
      const source = payload.source || "";
      mermaidViewer.value = {
        key,
        html: payload.html || "",
        source,
        error: payload.error || "",
        zoom: 1,
        width: Math.max(1, Number(payload.width) || 960),
        height: Math.max(1, Number(payload.height) || 540),
        panX: 0,
        panY: 0,
        dragging: false,
      };
      showMermaidViewer.value = true;
      nextTick(fitMermaidViewer);
    }

    function closeMermaidViewer() {
      showMermaidViewer.value = false;
    }

    function fitMermaidViewer() {
      const canvas = mermaidViewerCanvasRef.value;
      if (!canvas || !mermaidViewer.value.html) return;
      const padding = 56;
      const availableW = Math.max(240, canvas.clientWidth - padding);
      const availableH = Math.max(180, canvas.clientHeight - padding);
      const fit = Math.min(
        availableW / mermaidViewer.value.width,
        availableH / mermaidViewer.value.height,
      );
      mermaidViewer.value.zoom = clampNumber(fit, 0.15, 3, 1);
      mermaidViewer.value.panX = 0;
      mermaidViewer.value.panY = 0;
    }

    function setMermaidViewerZoom(delta) {
      mermaidViewer.value.zoom = clampNumber(
        mermaidViewer.value.zoom * (delta > 0 ? 1.18 : 1 / 1.18),
        0.1,
        6,
        1,
      );
    }

    function resetMermaidViewerZoom() {
      mermaidViewer.value.zoom = 1;
      mermaidViewer.value.panX = 0;
      mermaidViewer.value.panY = 0;
    }

    function onMermaidViewerWheel(event) {
      if (!mermaidViewer.value.html) return;
      const direction = event.deltaY < 0 ? 1 : -1;
      setMermaidViewerZoom(direction);
    }

    function beginMermaidViewerPan(event) {
      if (!mermaidViewer.value.html || event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const initialX = mermaidViewer.value.panX;
      const initialY = mermaidViewer.value.panY;
      mermaidViewer.value.dragging = true;
      event.currentTarget?.setPointerCapture?.(event.pointerId);

      const move = (moveEvent) => {
        mermaidViewer.value.panX = initialX + (moveEvent.clientX - startX);
        mermaidViewer.value.panY = initialY + (moveEvent.clientY - startY);
      };
      const up = () => {
        mermaidViewer.value.dragging = false;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
    }

    function copyMermaidViewerSource() {
      if (!mermaidViewer.value.source) return;
      navigator.clipboard?.writeText(mermaidViewer.value.source);
      notify("Mermaid source copied", "success", 1200);
    }

    function mermaidDownloadName(ext) {
      const base = activeFile.value?.name?.replace(/\.[^.]+$/, "") || "mermaid-diagram";
      return `${base}-${mermaidViewer.value.key || "diagram"}.${ext}`.replace(/[^\w.-]+/g, "-");
    }

    function getMermaidViewerSvgMarkup() {
      if (!mermaidViewer.value.html) return "";
      const doc = new DOMParser().parseFromString(mermaidViewer.value.html, "image/svg+xml");
      const svg = doc.querySelector("svg");
      if (!svg) return mermaidViewer.value.html;
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.setAttribute("width", String(Math.round(mermaidViewer.value.width)));
      svg.setAttribute("height", String(Math.round(mermaidViewer.value.height)));
      svg.style.maxWidth = "";
      return new XMLSerializer().serializeToString(svg);
    }

    function downloadMermaidSvg() {
      const svg = getMermaidViewerSvgMarkup();
      if (!svg) return;
      const blob = new Blob([svg], { type: "image/svg+xml" });
      downloadBlob(blob, mermaidDownloadName("svg"));
      notify("SVG exported", "success", 1200);
    }

    function downloadMermaidPng() {
      const svg = getMermaidViewerSvgMarkup();
      if (!svg) return;
      const svgBlob = new Blob([svg], { type: "image/svg+xml" });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        const scale = 2;
        const width = Math.max(1, Math.round(mermaidViewer.value.width));
        const height = Math.max(1, Math.round(mermaidViewer.value.height));
        const canvas = document.createElement("canvas");
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg0") || "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
          if (!blob) return;
          downloadBlob(blob, mermaidDownloadName("png"));
          notify("PNG exported", "success", 1200);
        }, "image/png");
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        notify("PNG export failed", "warn");
      };
      img.src = url;
    }

    function scrollToHeading(slug) {
      const el = document.getElementById(slug);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function getSyncBlocks() {
      return (editorInstance?.getValue() || currentContent.value || "")
        .split(/\n\n+/)
        .filter(Boolean);
    }

    function getBlockLineMap() {
      const blocks = getSyncBlocks();
      let startLine = 0;
      return blocks.map((block, index) => {
        const lines = block.split("\n").length;
        const endLine = startLine + lines - 1;
        const item = { index, startLine, endLine };
        startLine = endLine + 2;
        return item;
      });
    }

    function blockIndexForLine(line) {
      const map = getBlockLineMap();
      for (const item of map) {
        if (line <= item.endLine) return item.index;
      }
      return Math.max(0, map.length - 1);
    }

    function getEditorBlockIndex() {
      const view = editorInstance?._view;
      if (!view) return 0;
      const viewportStart = view.viewport?.from ?? 0;
      const line = view.state.doc.lineAt(viewportStart).number;
      return blockIndexForLine(line);
    }

    function getPreviewBlockIndex() {
      const preview = previewScrollEl || previewScroller.value || document.getElementById("preview-scroller");
      const page = document.getElementById("preview-page");
      if (!preview || !page) return 0;
      const blocks = Array.from(page.children);
      const top = preview.scrollTop + 12;
      let idx = 0;
      let best = Number.POSITIVE_INFINITY;
      blocks.forEach((block, i) => {
        if (block.offsetTop <= top) {
          const distance = top - block.offsetTop;
          if (distance <= best) {
            best = distance;
            idx = i;
          }
        }
      });
      return Math.min(idx, Math.max(0, blocks.length - 1));
    }

    function getEditorSyncPosition() {
      const view = editorInstance?._view;
      const map = getBlockLineMap();
      if (!map.length) return { index: 0, ratio: 0, line: 1, top: 0 };
      if (view) {
        const viewportStart = view.viewport?.from ?? 0;
        const line = view.state.doc.lineAt(viewportStart).number;
        const index = blockIndexForLine(line);
        const block = map[index] || map[0];
        const span = Math.max(1, block.endLine - block.startLine + 1);
        const ratio = Math.max(0, Math.min(1, (line - block.startLine - 1) / span));
        const coords = view.coordsAtPos(view.state.doc.line(line).from);
        const scrollerRect = view.scrollDOM.getBoundingClientRect();
        return {
          index,
          ratio,
          line,
          top: coords ? coords.top - scrollerRect.top : 0,
        };
      }

      const ta = editorInstance?._el;
      if (!ta) return { index: 0, ratio: 0, line: 1, top: 0 };
      const approxLineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      const line = Math.max(1, Math.floor(ta.scrollTop / approxLineHeight) + 1);
      const index = blockIndexForLine(line);
      const block = map[index] || map[0];
      const span = Math.max(1, block.endLine - block.startLine + 1);
      return {
        index,
        ratio: Math.max(0, Math.min(1, (line - block.startLine - 1) / span)),
        line,
        top: 0,
      };
    }

    function getPreviewSyncPosition() {
      const preview = previewScrollEl || previewScroller.value || document.getElementById("preview-scroller");
      const page = document.getElementById("preview-page");
      if (!preview || !page) return { index: 0, ratio: 0, top: 0 };
      const blocks = Array.from(page.children);
      if (!blocks.length) return { index: 0, ratio: 0, top: 0 };
      const top = preview.scrollTop + 12;
      let index = getPreviewBlockIndex();
      const block = blocks[index] || blocks[0];
      const height = Math.max(1, block.offsetHeight || block.getBoundingClientRect().height || 1);
      const ratio = Math.max(0, Math.min(1, (top - block.offsetTop) / height));
      return {
        index,
        ratio,
        top: Math.max(0, block.offsetTop - preview.scrollTop + ratio * height),
      };
    }

    function showSyncIndicator(editorTop, previewTop) {
      if (!syncScrollEnabled.value) {
        syncIndicator.value.visible = false;
        return;
      }
      syncIndicator.value = {
        visible: true,
        editorTop: Math.max(0, editorTop || 0),
        previewTop: Math.max(0, previewTop || 0),
      };
      clearTimeout(syncIndicatorTimer);
      syncIndicatorTimer = setTimeout(() => {
        syncIndicator.value.visible = false;
      }, 900);
    }

    function focusEditorLine(lineNumber) {
      const view = editorInstance?._view;
      if (view) {
        const line = view.state.doc.line(Math.max(1, Math.min(lineNumber, view.state.doc.lines)));
        view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
        view.focus();
        return;
      }

      const ta = editorInstance?._el;
      if (!ta) return;
      const lines = ta.value.split("\n");
      const targetLine = Math.max(0, Math.min(lineNumber - 1, lines.length - 1));
      const before = lines.slice(0, targetLine).join("\n");
      const pos = before.length + (targetLine > 0 ? 1 : 0);
      ta.focus();
      ta.setSelectionRange(pos, pos);
    }

    function beginPreviewResize(event, wrap, key, kind) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = wrap.getBoundingClientRect().width;
      const minWidth = kind === "image" ? 180 : 240;
      const maxWidth = wrap.parentElement?.clientWidth || 960;
      wrap.classList.add("is-resizing");

      const move = (moveEvent) => {
        const nextWidth = Math.max(
          minWidth,
          Math.min(maxWidth, startWidth + (moveEvent.clientX - startX)),
        );
        wrap.style.width = `${nextWidth}px`;
      };

      const up = () => {
        window.removeEventListener("pointermove", move);
        wrap.classList.remove("is-resizing");
        previewBlockSizes.value = {
          ...previewBlockSizes.value,
          [key]: wrap.style.width,
        };
        touchActiveFileStyle();
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
    }

    function syncPreviewFromEditor() {
      if (!syncScrollEnabled.value || scrollSyncing) return;
      const view = editorInstance?._view;
      const preview = previewScrollEl || previewScroller.value || document.getElementById("preview-scroller");
      if (!preview) return;
      const page = document.getElementById("preview-page");
      const blocks = page ? Array.from(page.children) : [];
      if (!blocks.length) return;
      const position = getEditorSyncPosition();
      const idx = Math.min(position.index, blocks.length - 1);
      const target = blocks[idx];
      if (!target) return;
      const targetHeight = Math.max(1, target.offsetHeight || target.getBoundingClientRect().height || 1);
      scrollSyncing = true;
      preview.scrollTop = Math.max(
        0,
        target.offsetTop + targetHeight * position.ratio - preview.clientHeight * 0.18,
      );
      showSyncIndicator(position.top, target.offsetTop - preview.scrollTop + targetHeight * position.ratio);
      requestAnimationFrame(() => {
        scrollSyncing = false;
      });
    }

    function syncEditorFromPreview() {
      if (!syncScrollEnabled.value || scrollSyncing) return;
      const view = editorInstance?._view;
      const preview = previewScrollEl || previewScroller.value || document.getElementById("preview-scroller");
      if (!view || !preview) return;
      const map = getBlockLineMap();
      if (!map.length) return;
      const position = getPreviewSyncPosition();
      const idx = Math.min(position.index, map.length - 1);
      const block = map[idx] || map[0];
      const span = Math.max(1, block.endLine - block.startLine + 1);
      const targetLine = Math.max(1, Math.round(block.startLine + 1 + span * position.ratio));
      scrollSyncing = true;
      focusEditorLine(targetLine);
      showSyncIndicator(24, position.top);
      requestAnimationFrame(() => {
        scrollSyncing = false;
      });
    }

    function onEditorScroll() {
      syncPreviewFromEditor();
    }

    function onPreviewScroll() {
      syncEditorFromPreview();
    }

    function jumpToCorrespondingBlock(source) {
      if (source === "preview") {
        syncEditorFromPreview();
        return;
      }
      syncPreviewFromEditor();
    }

    function toggleSyncScroll() {
      syncScrollEnabled.value = !syncScrollEnabled.value;
      nextTick(() => {
        jumpToCorrespondingBlock(syncScrollSource.value);
        if (syncScrollEnabled.value) syncPreviewFromEditor();
      });
    }

    // ── LaTeX builder ─────────────────────────────────────────────────────────

    function openLatexBuilder() {
      latexInput.value = "";
      latexRendered.value = "";
      latexCat.value = "greek";
      showLatex.value = true;
    }

    function insertLatexSym(tex) {
      latexInput.value += tex;
      onLatexInputChange();
    }

    function onLatexInputChange() {
      if (!window.katex) return;
      try {
        latexRendered.value = katex.renderToString(latexInput.value, {
          displayMode: latexMode.value === "block",
          throwOnError: false,
        });
      } catch (e) {
        latexRendered.value = `<span class="katex-error">${e.message}</span>`;
      }
    }

    function onLatexKeyUp(e) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) insertLatexToEditor();
    }

    function insertLatexToEditor() {
      const wrap =
        latexMode.value === "block"
          ? `$$\n${latexInput.value}\n$$`
          : `$${latexInput.value}$`;
      insertText(wrap);
      showLatex.value = false;
    }

    // ── Mermaid builder ───────────────────────────────────────────────────────

    function openMermaidBuilder() {
      mermaidCode.value = MERMAID_TEMPLATES[0].code;
      mermaidTpl.value = MERMAID_TEMPLATES[0].id;
      mermaidError.value = "";
      showMermaid.value = true;
      nextTick(() => previewMermaid());
    }

    async function previewMermaid() {
      if (!window.mermaid) return;
      try {
        const id = "mbld-" + Math.random().toString(36).slice(2, 8);
        document.getElementById(`d${id}`)?.remove();
        if (typeof mermaid.initialize === "function") {
          mermaid.initialize({
            startOnLoad: false,
            theme: getPreviewTheme(),
            suppressErrorRendering: true,
          });
        }
        if (typeof mermaid.parse === "function") {
          await mermaid.parse(mermaidCode.value);
        }
        const { svg } = await mermaid.render(id, mermaidCode.value);
        document.getElementById(`d${id}`)?.remove();
        mermaidPrev.value = svg;
        mermaidError.value = "";
      } catch (e) {
        document.querySelectorAll('[id^="dmbld-"], [id^="dmmd-"], [id^="dmermaid-"]').forEach((el) => {
          if (el.parentElement === document.body) el.remove();
        });
        mermaidError.value = e.message;
        mermaidPrev.value = "";
      }
    }

    function renderMermaidPreview() {
      return previewMermaid();
    }

    function loadMermaidTpl(tpl) {
      mermaidCode.value = tpl.code;
      mermaidTpl.value = tpl.id;
      previewMermaid();
    }

    function insertMermaidToEditor() {
      insertText(`\n\`\`\`mermaid\n${mermaidCode.value}\n\`\`\`\n`);
      showMermaid.value = false;
    }

    // ── Block organizer ───────────────────────────────────────────────────────

    function parseBlocks() {
      const content = editorInstance?.getValue() || currentContent.value;
      const raw = content.split(/\n\n+/);
      blocks.value = raw.map((c, i) => ({
        id: i + "-" + genId(),
        content: c,
        type: detectBlockType(c),
      }));
    }

    function detectBlockType(c) {
      if (/^#{1,6} /.test(c)) return "heading";
      if (/^```/.test(c)) return "code";
      if (/^\$\$/.test(c)) return "math";
      if (/^```mermaid/.test(c)) return "mermaid";
      if (/^>/.test(c)) return "quote";
      if (/^\|.+\|/.test(c)) return "table";
      if (/^!?\[.*\]\(/.test(c)) return "image";
      if (/^[-*] |^\d+\. /.test(c)) return "list";
      if (/^---+$/.test(c)) return "hr";
      return "paragraph";
    }

    function blocksToContent() {
      const text = blocks.value.map((b) => b.content).join("\n\n");
      syncToEditor(text);
      syncFromEditor();
    }

    function moveBlock(idx, dir) {
      const arr = [...blocks.value];
      const to = idx + dir;
      if (to < 0 || to >= arr.length) return;
      [arr[idx], arr[to]] = [arr[to], arr[idx]];
      blocks.value = arr;
      blocksToContent();
    }

    function duplicateBlock(idx) {
      const b = { ...blocks.value[idx], id: genId() };
      blocks.value.splice(idx + 1, 0, b);
      blocksToContent();
    }

    function deleteBlock(idx) {
      blocks.value.splice(idx, 1);
      blocksToContent();
    }

    function addBlock(idx, type) {
      blocks.value.splice(idx + 1, 0, { id: genId(), content: "", type });
      blocksToContent();
    }

    function openBlockTypeMenu(idx, e) {
      blockTypeMenuTarget.value = idx;
      blockTypeMenuPos.value = { x: e.clientX, y: e.clientY };
      blockTypeMenuOpen.value = true;
    }

    function onBlockDragStart(e, idx) {
      dragSrcIdx.value = idx;
      e.dataTransfer.effectAllowed = "move";
    }
    function onBlockDragOver(e, idx) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
    function onBlockDrop(e, idx) {
      e.preventDefault();
      const src = dragSrcIdx.value;
      if (src === idx) return;
      const arr = [...blocks.value];
      const [item] = arr.splice(src, 1);
      arr.splice(idx, 0, item);
      blocks.value = arr;
      blocksToContent();
    }
    function onBlockDragEnd() {
      dragSrcIdx.value = -1;
    }

    // ── Find & Replace ────────────────────────────────────────────────────────

    const frFindRef = ref(null);

    function openFR() {
      showFR.value = true;
      frCountMatches();
    }

    function frDoFind() {
      frCountMatches();
      nextTick(() => {
        frFindRef.value?.focus();
      });
    }

    function frReplaceOne() {
      frReplaceFn();
    }

    function frGoTo() {
      if (!editorInstance) return;
      const query = {
        search: frFind.value || "",
        caseSensitive: frCase.value,
        literal: !frRegex.value,
        regexp: frRegex.value,
        replace: frReplace.value || "",
        wholeWord: frWord.value,
      };
      editorInstance.setSearchQuery?.(query);
      editorInstance.findNext?.();
      editorInstance.openSearchPanel?.();
    }

    function frCountMatches() {
      const content = editorInstance?.getValue() || currentContent.value;
      if (!frFind.value) {
        frCount.value = 0;
        return;
      }
      try {
        const flags = "g" + (frCase.value ? "" : "i");
        const pat = frRegex.value
          ? frFind.value
          : frFind.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const full = frWord.value ? `\\b${pat}\\b` : pat;
        frCount.value = (content.match(new RegExp(full, flags)) || []).length;
      } catch {
        frCount.value = 0;
      }
    }

    function frReplaceFn() {
      let content = editorInstance?.getValue() || currentContent.value;
      if (!frFind.value) return;
      try {
        const flags = frCase.value ? "" : "i";
        const pat = frRegex.value
          ? frFind.value
          : frFind.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const full = frWord.value ? `\\b${pat}\\b` : pat;
        content = content.replace(new RegExp(full, flags), frReplace.value);
        syncToEditor(content);
        syncFromEditor();
        frCountMatches();
      } catch (e) {
        notify("Invalid regex: " + e.message, "warn");
      }
    }

    function frReplaceAll() {
      let content = editorInstance?.getValue() || currentContent.value;
      if (!frFind.value) return;
      try {
        const flags = "g" + (frCase.value ? "" : "i");
        const pat = frRegex.value
          ? frFind.value
          : frFind.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const full = frWord.value ? `\\b${pat}\\b` : pat;
        content = content.replace(new RegExp(full, flags), frReplace.value);
        syncToEditor(content);
        syncFromEditor();
        frCount.value = 0;
        notify("Replaced all", "success");
      } catch (e) {
        notify("Invalid regex: " + e.message, "warn");
      }
    }

    // ── Image manager ─────────────────────────────────────────────────────────

    function openImgManager() {
      showImgManager.value = true;
    }

    function syncImagePath(img) {
      if (!img?.path || !img.data) return;
      imagePathMap.value = {
        ...imagePathMap.value,
        [img.path]: img.data,
        [`./${img.path}`]: img.data,
      };
    }

    function rebuildImagePathMap() {
      const map = {};
      images.value.forEach((img) => {
        if (!img?.path || !img.data) return;
        map[img.path] = img.data;
        map[`./${img.path}`] = img.data;
      });
      imagePathMap.value = map;
    }

    function insertImageMarkdown(img) {
      if (!img) return;
      const alt = (img.name || "Image").replace(/[\[\]\n\r]/g, " ").trim() || "Image";
      insertText(`\n\n![${alt}](${img.path})\n\n`);
      syncImagePath(img);
      scheduleRender();
    }

    function loadImageData(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Could not load image"));
        img.src = src;
      });
    }

    function updateImageData(img, data, width, height, mime = "image/png") {
      if (!img) return;
      img.data = data;
      img.dataUrl = data;
      img.mime = mime;
      img.width = width;
      img.height = height;
      syncImagePath(img);
      scheduleRender();
    }

    function processImageFiles(files) {
      for (const file of files) {
        if (!file.type?.startsWith("image/")) continue;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const img = new Image();
          img.onload = () => {
            const safeName = file.name.replace(/[^\w.-]+/g, "-");
            const id = genId();
            const path = `images/${Date.now()}-${id}-${safeName}`;
            const entry = {
              id: genId(),
              name: file.name,
              path,
              mime: file.type || "image/png",
              dataUrl: ev.target.result,
              data: ev.target.result,
              width: img.naturalWidth,
              height: img.naturalHeight,
            };
            images.value.push(entry);
            if (!selectedImgs.value.includes(entry.id)) selectedImgs.value.push(entry.id);
            syncImagePath(entry);
            notify(`Uploaded ${file.name}`, "success", 1400);
            setTimeout(() => checkStorageQuota("Image library"), 250);
          };
          img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
      }
    }

    function onImgUpload(e) {
      processImageFiles(Array.from(e.target.files || []));
      e.target.value = "";
    }

    function onImgDrop(e) {
      processImageFiles(Array.from(e.dataTransfer?.files || []));
    }

    function toggleImgSelect(img) {
      const idx = selectedImgs.value.indexOf(img.id);
      if (idx >= 0) selectedImgs.value.splice(idx, 1);
      else selectedImgs.value.push(img.id);
    }

    function insertSelectedImgs() {
      for (const imgId of selectedImgs.value) {
        const img = images.value.find((entry) => entry.id === imgId);
        if (img) insertImageMarkdown(img);
      }
      selectedImgs.value = [];
      showImgManager.value = false;
    }

    function deleteSelectedImgs() {
      const deleted = images.value.filter((i) => selectedImgs.value.includes(i.id));
      images.value = images.value.filter(
        (i) => !selectedImgs.value.includes(i.id),
      );
      if (deleted.length) {
        const nextMap = { ...imagePathMap.value };
        deleted.forEach((img) => {
          delete nextMap[img.path];
          delete nextMap[`./${img.path}`];
        });
        imagePathMap.value = nextMap;
      }
      selectedImgs.value = [];
      scheduleRender();
    }

    function triggerImgUpload() {
      imgFileInput.value?.click();
    }

    function insertSelected() {
      insertSelectedImgs();
    }

    function deleteSelected() {
      deleteSelectedImgs();
    }

    function toggleImgSel(id) {
      const idx = selectedImgs.value.indexOf(id);
      if (idx >= 0) selectedImgs.value.splice(idx, 1);
      else selectedImgs.value.push(id);
    }

    function insertOneImage(img) {
      if (!img) return;
      insertImageMarkdown(img);
    }

    function openResize(img) {
      resizeTarget.value = img;
      resizeW.value = img.width;
      resizeH.value = img.height;
      showResizeModal.value = true;
    }
    function onRW() {
      const img = resizeTarget.value;
      if (!resizeLock.value || !img?.width || !img?.height) return;
      resizeH.value = Math.max(1, Math.round((Number(resizeW.value) * img.height) / img.width));
    }
    function onRH() {
      const img = resizeTarget.value;
      if (!resizeLock.value || !img?.width || !img?.height) return;
      resizeW.value = Math.max(1, Math.round((Number(resizeH.value) * img.width) / img.height));
    }
    async function applyResize() {
      const target = resizeTarget.value;
      if (!target) return;
      try {
        const source = await loadImageData(target.data);
        const width = Math.max(1, Math.round(Number(resizeW.value) || target.width));
        const height = Math.max(1, Math.round(Number(resizeH.value) || target.height));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(source, 0, 0, width, height);
        const mime = target.mime === "image/jpeg" || target.mime === "image/webp" ? target.mime : "image/png";
        updateImageData(target, canvas.toDataURL(mime, resQ.value), width, height, mime);
        showResizeModal.value = false;
        notify("Image resized", "success", 1400);
      } catch (e) {
        notify(e.message || "Resize failed", "warn");
      }
    }
    function openCrop(img) {
      cropTarget.value = img;
      cropX.value = 0;
      cropY.value = 0;
      cropW.value = img.width;
      cropH.value = img.height;
      cropPreset.value = "Free";
      showCropModal.value = true;
      nextTick(() => initCropDisplay());
    }
    function initCropDisplay() {
      cropDisplayTick.value += 1;
    }
    function cropPointFromEvent(event) {
      const target = cropTarget.value;
      const imgEl = cropImgRef.value;
      if (!target || !imgEl) return { x: 0, y: 0 };
      const rect = imgEl.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      return {
        x: Math.round((x / rect.width) * target.width),
        y: Math.round((y / rect.height) * target.height),
      };
    }
    function onCropMouseDown(event) {
      if (!cropTarget.value) return;
      const start = cropPointFromEvent(event);
      cropX.value = start.x;
      cropY.value = start.y;
      cropW.value = 1;
      cropH.value = 1;
      const move = (moveEvent) => {
        const point = cropPointFromEvent(moveEvent);
        cropX.value = Math.min(start.x, point.x);
        cropY.value = Math.min(start.y, point.y);
        cropW.value = Math.max(1, Math.abs(point.x - start.x));
        cropH.value = Math.max(1, Math.abs(point.y - start.y));
        cropDisplayTick.value += 1;
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    }
    function applyCropPreset(preset) {
      const target = cropTarget.value;
      if (!target) return;
      cropPreset.value = preset;
      if (preset === "Free") return;
      const [rw, rh] = preset.split(":").map(Number);
      if (!rw || !rh) return;
      let width = target.width;
      let height = Math.round(width * (rh / rw));
      if (height > target.height) {
        height = target.height;
        width = Math.round(height * (rw / rh));
      }
      cropW.value = width;
      cropH.value = height;
      cropX.value = Math.round((target.width - width) / 2);
      cropY.value = Math.round((target.height - height) / 2);
      cropDisplayTick.value += 1;
    }
    async function applyCrop() {
      const target = cropTarget.value;
      if (!target) return;
      try {
        const source = await loadImageData(target.data);
        const sx = Math.max(0, Math.round(cropX.value));
        const sy = Math.max(0, Math.round(cropY.value));
        const sw = Math.max(1, Math.min(target.width - sx, Math.round(cropW.value)));
        const sh = Math.max(1, Math.min(target.height - sy, Math.round(cropH.value)));
        const canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
        const mime = target.mime === "image/jpeg" || target.mime === "image/webp" ? target.mime : "image/png";
        updateImageData(target, canvas.toDataURL(mime, resQ.value), sw, sh, mime);
        showCropModal.value = false;
        notify("Image cropped", "success", 1400);
      } catch (e) {
        notify(e.message || "Crop failed", "warn");
      }
    }

    // ── Templates ─────────────────────────────────────────────────────────────

    function openTemplates() {
      showTemplates.value = true;
    }
    async function loadTemplate(t) {
      const ok = await confirmApp("Replace current content with this template?", {
        title: "Apply template",
        confirmText: "Replace",
      });
      if (!ok) return;
      const content = renderTemplateVariables(t.content || "", {
        title: t.title || t.name || exportTitle.value,
        template: t.name || "",
        theme: t.theme || renderTheme.value,
      });
      syncToEditor(content);
      syncFromEditor();
      if (t.style) applyFileStyle(t.style);
      else if (t.theme) renderTheme.value = t.theme;
      nextTick(touchActiveFileStyle);
      showTemplates.value = false;
    }

    function openSaveTplModal() {
      newTplName.value = "";
      newTplDesc.value = "";
      newTplIncContent.value = false;
      showSaveTplModal.value = true;
    }

    function saveAsTheme() {
      openSaveTplModal();
    }

    function saveNewTemplate() {
      if (!newTplName.value.trim()) {
        notify("Name required", "warn");
        return;
      }
      userTemplates.value.push({
        id: genId(),
        name: newTplName.value.trim(),
        desc: newTplDesc.value.trim(),
        theme: renderTheme.value,
        style: captureFileStyle(),
        content: newTplIncContent.value
          ? editorInstance?.getValue() || currentContent.value
          : "",
      });
      showSaveTplModal.value = false;
      notify("Template saved", "success");
    }

    function saveAsUserTemplate() {
      saveNewTemplate();
    }

    function loadUserTemplate(t) {
      loadTemplate(t);
    }

    function deleteUserTpl(id) {
      userTemplates.value = userTemplates.value.filter((tpl) => tpl.id !== id);
    }

    // ── Export ────────────────────────────────────────────────────────────────

    function openExport() {
      showExport.value = true;
    }

    let posterRenderTimer = null;
    function clampPosterSlotCount(value) {
      return Math.min(12, Math.max(1, Number(value) || 1));
    }

    function syncPosterLayout(fillEmpty = false) {
      const validIds = new Set(posterSections.value.map((section) => section.id));
      const next = posterLayout.value
        .filter((id) => !id || validIds.has(id))
        .slice(0, posterSlotCount.value);

      while (next.length < posterSlotCount.value) next.push("");

      if (fillEmpty) {
        const used = new Set(next.filter(Boolean));
        let cursor = 0;
        for (let index = 0; index < next.length; index++) {
          if (next[index]) continue;
          while (
            cursor < posterSections.value.length &&
            used.has(posterSections.value[cursor].id)
          ) {
            cursor++;
          }
          const section = posterSections.value[cursor];
          if (!section) break;
          next[index] = section.id;
          used.add(section.id);
        }
      }

      posterLayout.value = next;
    }

    function resetPosterLayout() {
      posterSlotCount.value = clampPosterSlotCount(
        Math.max(posterColumns.value * 2, posterSections.value.length || 1),
      );
      posterLayout.value = [];
      syncPosterLayout(true);
      schedulePosterRender();
    }

    function setPosterSlot(index, sectionId) {
      const next = posterLayout.value.slice();
      const cleanId = sectionId || "";
      if (cleanId) {
        const existing = next.indexOf(cleanId);
        if (existing >= 0 && existing !== index) next[existing] = "";
      }
      next[index] = cleanId;
      posterLayout.value = next;
      syncPosterLayout(false);
      schedulePosterRender();
    }

    function clearPosterSlot(index) {
      setPosterSlot(index, "");
    }

    function movePosterSlot(index, direction) {
      const target = index + direction;
      if (target < 0 || target >= posterLayout.value.length) return;
      const next = posterLayout.value.slice();
      [next[index], next[target]] = [next[target], next[index]];
      posterLayout.value = next;
      schedulePosterRender();
    }

    function addPosterSlot() {
      posterSlotCount.value = clampPosterSlotCount(posterSlotCount.value + 1);
      syncPosterLayout(false);
    }

    function removePosterSlot(index) {
      if (posterSlotCount.value <= 1) return;
      const next = posterLayout.value.slice();
      next.splice(index, 1);
      posterSlotCount.value = clampPosterSlotCount(posterSlotCount.value - 1);
      posterLayout.value = next;
      syncPosterLayout(false);
      schedulePosterRender();
    }

    function beginPosterSectionDrag(sectionId) {
      posterDragSectionId.value = sectionId;
    }

    function dropPosterSection(index) {
      if (!posterDragSectionId.value) return;
      setPosterSlot(index, posterDragSectionId.value);
      posterDragSectionId.value = "";
    }

    function endPosterSectionDrag() {
      posterDragSectionId.value = "";
    }

    function schedulePosterRender() {
      clearTimeout(posterRenderTimer);
      posterRenderTimer = setTimeout(() => {
        nextTick(async () => {
          const target = posterPreviewRef.value;
          if (!target) return;
          await renderMermaid(target);
          resolvePreviewImages(target, imagePathMap.value);
          enhanceQcmWidgets(target);
        });
      }, 120);
    }

    function openPosterBuilder() {
      posterTitle.value = getPosterSourceTitle();
      posterSubtitle.value = exportAuthor.value || "Markdown Studio Poster";
      resetPosterLayout();
      showExport.value = false;
      showPosterBuilder.value = true;
      schedulePosterRender();
    }

    function closePosterBuilder() {
      showPosterBuilder.value = false;
    }

    function printPoster() {
      let pageStyle = document.getElementById("poster-print-page-style");
      if (!pageStyle) {
        pageStyle = document.createElement("style");
        pageStyle.id = "poster-print-page-style";
        document.head.appendChild(pageStyle);
      }
      pageStyle.textContent = `@media print { @page poster { size: ${posterPageSize.value.width}mm ${posterPageSize.value.height}mm; margin: 0; } }`;
      document.body.classList.add("poster-printing");
      const clearPrintMode = () => document.body.classList.remove("poster-printing");
      window.addEventListener("afterprint", clearPrintMode, { once: true });
      nextTick(() => {
        window.print();
        setTimeout(clearPrintMode, 800);
      });
    }

    function exportMarkdown() {
      const blob = new Blob(
        [editorInstance?.getValue() || currentContent.value],
        { type: "text/markdown" },
      );
      downloadBlob(
        blob,
        (activeFile.value?.name || "document") +
          (activeFile.value?.name?.endsWith(".md") ? "" : ".md"),
      );
    }

    function exportHtml() {
      const html = buildExportHtml();
      const blob = new Blob([html], { type: "text/html" });
      downloadBlob(
        blob,
        (activeFile.value?.name?.replace(".md", "") || "document") + ".html",
      );
    }

    function getExportMetadata() {
      return {
        app: "Markdown Studio",
        exportedAt: new Date().toISOString(),
        file: {
          id: activeFile.value?.id || "",
          name: activeFile.value?.name || "document.md",
          updatedAt: activeFile.value?.updatedAt || null,
        },
        document: {
          title: exportTitle.value || activeFile.value?.name || "Document",
          author: exportAuthor.value || "",
          wordCount: wordCount.value,
          lineCount: lineCount.value,
        },
        template: {
          theme: renderTheme.value,
          style: captureFileStyle(),
        },
      };
    }

    function buildMetadataScript(metadata) {
      return `<script type="application/json" id="markdown-studio-metadata">${JSON.stringify(metadata, null, 2).replace(/<\/script/gi, "<\\/script")}<\/script>`;
    }

    function getEmbeddedImageSource(src) {
      const normalized = String(src || "").replace(/^\.\//, "");
      let decoded = normalized;
      try {
        decoded = decodeURIComponent(normalized);
      } catch {}
      const mapped =
        imagePathMap.value?.[src] ||
        imagePathMap.value?.[normalized] ||
        imagePathMap.value?.[decoded] ||
        imagePathMap.value?.[decoded.replace(/^\.\//, "")];
      if (mapped) return mapped;
      const image = images.value.find((entry) => {
        const path = String(entry.path || "").replace(/^\.\//, "");
        return path === normalized || path === decoded || entry.name === decoded;
      });
      return image?.dataUrl || image?.data || "";
    }

    function embedExportImages(html) {
      return String(html || "").replace(/<img\b[^>]*>/gi, (tag) => {
        return tag.replace(/\bsrc\s*=\s*(["'])(.*?)\1/i, (match, quote, src) => {
          const embedded = getEmbeddedImageSource(src);
          if (!embedded) return match;
          const escaped = String(embedded)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(quote === '"' ? /"/g : /'/g, quote === '"' ? "&quot;" : "&#39;");
          return `src=${quote}${escaped}${quote}`;
        });
      });
    }

    function cssPropName(prop) {
      return prop.startsWith("--")
        ? prop
        : prop.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
    }

    function styleObjectToCss(style) {
      return Object.entries(style || {})
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([prop, value]) => `  ${cssPropName(prop)}: ${String(value).replace(/;/g, "")};`)
        .join("\n");
    }

    function buildExportStyle() {
      const pageStyle = styleObjectToCss(previewPageStyle.value);
      return `
  :root { color-scheme: light; }
  body { margin: 0; background: #f3f5f8; color: #1f2937; }
  .md-export {
${pageStyle}
    box-sizing: border-box;
    margin: 40px auto;
    background: ${cColorBg.value || "#ffffff"};
    color: ${cColorText.value || "inherit"};
  }
  .md-export p { margin: 0 0 var(--para-gap, 0.8em); }
  .md-export p, .md-export li, .md-export blockquote, .md-export td, .md-export th {
    overflow-wrap: var(--text-wrap, break-word);
    word-break: var(--text-word-break, break-word);
  }
  .md-export h1, .md-export h2, .md-export h3, .md-export h4 {
    color: var(--color-head, inherit);
    font-family: var(--head-font, inherit);
    line-height: 1.18;
  }
  .md-export h1 { font-size: var(--h1-size, 2.2em); }
  .md-export h2 { font-size: var(--h2-size, 1.7em); }
  .md-export a { color: var(--color-link, #2563eb); }
  .md-export pre {
    background: #f6f8fa;
    padding: 16px;
    border-radius: 6px;
    overflow-x: auto;
  }
  .md-export code {
    font-family: "JetBrains Mono", "DM Mono", monospace;
    font-size: calc(0.86em * var(--code-font-size, 1));
    overflow-wrap: var(--code-overflow-wrap, anywhere);
  }
  .md-export pre code {
    font-size: calc(0.84em * var(--code-font-size, 1));
    white-space: var(--code-white-space, pre);
    overflow-wrap: var(--code-overflow-wrap, normal);
  }
  .md-export .katex-block,
  .md-export .katex-inline {
    font-size: var(--latex-font-size, 1em);
  }
  .md-export table {
    border-collapse: collapse;
    width: var(--table-width, 100%);
    display: var(--table-display, block);
    margin: var(--table-margin, 0.7em 0);
    font-size: var(--table-font-size, 1em);
    overflow-x: auto;
  }
  .md-export th, .md-export td {
    border: 1px solid #d1d5db;
    padding: var(--table-pad-y, 0.42em) var(--table-pad-x, 0.68em);
  }
  .md-export tbody tr:nth-child(even) { background: var(--table-stripe, transparent); }
  .md-export img, .md-export svg { max-width: 100%; height: auto; }
  .mermaid-block, .image-block, .table-block {
    border: var(--media-block-border, 1px solid transparent);
    background: var(--media-block-bg, transparent);
  }`;
    }

    function buildExportHtml() {
      const body = embedExportImages(renderedHtml.value);
      const title = escHtml(exportTitle.value || activeFile.value?.name || "Document");
      const themeClass = `theme-${String(renderTheme.value).replace(/[^\w-]/g, "")}`;
      const scaleClass = String(previewPageClass.value).replace(/[^\w-]/g, "");
      const metadata = getExportMetadata();
      return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"><\/script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"><\/script>
<style>
${buildExportStyle()}
</style>
</head>
<body>
${buildMetadataScript(metadata)}
<main class="md-export md-body ${themeClass} ${scaleClass}">
${body}
</main>
<script>mermaid.initialize({startOnLoad:true});<\/script>
${getQcmExportScript()}
</body>
</html>`;
    }

    function exportPdfFn() {
      document.body.classList.add("document-printing");
      const clearPrintMode = () => document.body.classList.remove("document-printing");
      window.addEventListener("afterprint", clearPrintMode, { once: true });
      nextTick(() => {
        window.print();
        setTimeout(clearPrintMode, 800);
      });
    }

    function exportDocx() {
      // Simple Word-compatible HTML export
      const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'><head><meta charset='utf-8'><style>${buildExportStyle()}</style></head><body>${buildMetadataScript(getExportMetadata())}<main class="md-export">${embedExportImages(renderedHtml.value)}</main></body></html>`;
      const blob = new Blob([html], { type: "application/msword" });
      downloadBlob(
        blob,
        (activeFile.value?.name?.replace(".md", "") || "document") + ".doc",
      );
    }

    function exportPlain() {
      const content = editorInstance?.getValue() || currentContent.value;
      const blob = new Blob([content], { type: "text/plain" });
      downloadBlob(
        blob,
        (activeFile.value?.name?.replace(".md", "") || "document") + ".txt",
      );
    }

    function exportJson() {
      const data = {
        name: activeFile.value?.name,
        content: editorInstance?.getValue() || currentContent.value,
        exportedAt: new Date().toISOString(),
        metadata: getExportMetadata(),
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      downloadBlob(
        blob,
        (activeFile.value?.name?.replace(".md", "") || "document") + ".json",
      );
    }

    function exportQcmJson() {
      const data = {
        source: activeFile.value?.name || "document.md",
        exportedAt: new Date().toISOString(),
        questions: qcmQuestions.value.map((question, index) => ({
          id: question.id,
          number: index + 1,
          question: question.question,
          choices: question.choices.map((choice) => ({
            text: choice.text,
            correct: Boolean(choice.correct),
          })),
          explanation: question.explanation || "",
        })),
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      downloadBlob(
        blob,
        (activeFile.value?.name?.replace(/\.(md|markdown|txt)$/i, "") || "qcm") +
          "-questions.json",
      );
      notify("QCM JSON exported", "success", 1400);
    }

    function buildQcmAnswerSheetHtml() {
      const title = escHtml(exportTitle.value || activeFile.value?.name || "QCM");
      const questions = qcmQuestions.value;
      const body = questions
        .map((question, index) => {
          const choices = question.choices
            .map((choice, choiceIndex) => `<li>
              <span class="qcm-answer-letter">${String.fromCharCode(65 + choiceIndex)}.</span>
              <span>${renderQcmRichText(choice.text)}</span>
            </li>`)
            .join("");
          return `<section class="qcm-sheet-question">
            <h2>${index + 1}. ${renderQcmRichText(question.question)}</h2>
            <ol type="A">${choices}</ol>
          </section>`;
        })
        .join("");
      const answerKey = questions
        .map((question, index) => {
          const answers = question.choices
            .map((choice, choiceIndex) => (choice.correct ? String.fromCharCode(65 + choiceIndex) : ""))
            .filter(Boolean)
            .join(", ");
          const explanation = question.explanation
            ? `<div class="qcm-key-explanation">${renderQcmRichText(question.explanation, true)}</div>`
            : "";
          return `<li><strong>${index + 1}.</strong> ${escHtml(answers || "-")}${explanation}</li>`;
        })
        .join("");
      return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title} Answer Sheet</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<style>
body { margin: 0; background: #f3f4f6; color: #111827; font: 14px/1.55 system-ui, sans-serif; }
.qcm-sheet { max-width: 820px; margin: 32px auto; padding: 38px 44px; background: white; box-shadow: 0 18px 48px rgba(15,23,42,.12); }
.qcm-sheet h1 { margin: 0 0 22px; font-size: 28px; line-height: 1.1; }
.qcm-sheet-question { break-inside: avoid; margin: 0 0 22px; }
.qcm-sheet-question h2 { margin: 0 0 9px; font-size: 16px; line-height: 1.35; }
.qcm-sheet-question ol { margin: 0; padding-left: 24px; }
.qcm-sheet-question li { margin: 5px 0; padding-left: 4px; }
.qcm-answer-letter { font-weight: 700; margin-right: 4px; }
.qcm-answer-key { break-before: page; }
.qcm-answer-key li { margin: 9px 0; }
.qcm-key-explanation { margin: 4px 0 0 1.4em; color: #4b5563; }
.qcm-katex-display { display: block; margin: .35em 0; overflow-x: auto; }
@media print {
  body { background: white; }
  .qcm-sheet { margin: 0; max-width: none; min-height: 100vh; box-shadow: none; }
  @page { size: A4; margin: 18mm; }
}
</style>
</head>
<body>
<main class="qcm-sheet">
<h1>${title}</h1>
${body}
<section class="qcm-answer-key">
<h1>Answer Key</h1>
<ol>${answerKey}</ol>
</section>
</main>
</body>
</html>`;
    }

    function exportQcmAnswerSheet() {
      const blob = new Blob([buildQcmAnswerSheetHtml()], { type: "text/html" });
      downloadBlob(
        blob,
        (activeFile.value?.name?.replace(/\.(md|markdown|txt)$/i, "") || "qcm") +
          "-answer-sheet.html",
      );
      notify("QCM answer sheet exported", "success", 1400);
    }

    function safeZipPathName(name, fallback = "file") {
      return String(name || fallback)
        .replace(/[\\/:*?"<>|]+/g, "-")
        .replace(/\s+/g, " ")
        .trim() || fallback;
    }

    function exportAllZip() {
      const entries = [];
      const seen = new Set();
      const currentText = editorInstance?.getValue() || currentContent.value;
      const workspaceFiles = files.value.map((file) =>
        file.id === activeFileId.value ? { ...file, content: currentText } : file,
      );

      workspaceFiles.forEach((file, index) => {
        const base = safeZipPathName(file.name || `document-${index + 1}.md`);
        const name = base.endsWith(".md") ? base : `${base}.md`;
        let path = `documents/${name}`;
        if (seen.has(path)) path = `documents/${file.id || index}-${name}`;
        seen.add(path);
        entries.push({ name: path, data: file.content || "" });
      });

      images.value.forEach((image, index) => {
        const data = dataUrlToBytes(image.dataUrl || image.data);
        if (!data) return;
        const name = safeZipPathName(image.path || image.name || `image-${index + 1}`);
        let path = name.startsWith("images/") ? name : `images/${name}`;
        if (seen.has(path)) path = `images/${image.id || index}-${name.replace(/^images\//, "")}`;
        seen.add(path);
        entries.push({ name: path, data });
      });

      entries.push({
        name: "metadata/workspace.json",
        data: JSON.stringify(
          {
            metadata: getExportMetadata(),
            files: workspaceFiles.map((file) => ({
              id: file.id,
              name: file.name,
              createdAt: file.createdAt,
              updatedAt: file.updatedAt,
              style: file.style || null,
            })),
            images: images.value.map((image) => ({
              id: image.id,
              name: image.name,
              path: image.path,
              mime: image.mime,
              width: image.width,
              height: image.height,
            })),
          },
          null,
          2,
        ),
      });

      const blob = createZipBlob(entries);
      downloadBlob(blob, `markdown-studio-${new Date().toISOString().slice(0, 10)}.zip`);
      notify("Workspace ZIP exported", "success", 1600);
    }

    function copyHtml() {
      navigator.clipboard
        ?.writeText(renderedHtml.value)
        .then(() => notify("HTML copied", "success"));
    }

    function downloadBlob(blob, name) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    }

    // ── Context menus ─────────────────────────────────────────────────────────

    function openEditorCtx(e) {
      syncScrollSource.value = "editor";
      editorCtxBlockIndex.value = getEditorBlockIndex();
      editorCtxPos.value = { x: e.clientX, y: e.clientY };
      editorCtxOpen.value = true;
    }
    function openPreviewCtx(e) {
      syncScrollSource.value = "preview";
      const page = document.getElementById("preview-page");
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      let target = hit;
      while (target && page && target.parentElement && target.parentElement !== page) {
        target = target.parentElement;
      }
      const children = page ? Array.from(page.children) : [];
      const idx = target ? children.indexOf(target) : -1;
      previewCtxBlockIndex.value = idx >= 0 ? idx : getPreviewBlockIndex();
      previewCtxPos.value = { x: e.clientX, y: e.clientY };
      previewCtxOpen.value = true;
    }
    function openFileCtx(e, f) {
      fileCtxTarget.value = f;
      fileCtxPos.value = { x: e.clientX, y: e.clientY };
      fileCtxOpen.value = true;
    }
    function closeAllCtx() {
      editorCtxOpen.value = previewCtxOpen.value = fileCtxOpen.value = false;
      blockTypeMenuOpen.value = false;
    }

    function closeCtx() {
      closeAllCtx();
    }

    function getEditorText() {
      return editorInstance?.getValue() || currentContent.value || "";
    }

    function doSelectAll() {
      if (!editorInstance) return;
      if (editorInstance._type === "textarea" && editorInstance._el) {
        editorInstance._el.focus();
        editorInstance._el.select();
        return;
      }
      const view = editorInstance._view;
      if (!view) return;
      const end = view.state.doc.length;
      view.dispatch({ selection: { anchor: 0, head: end } });
      view.focus();
    }

    async function doCopy() {
      const text = getEditorText();
      await navigator.clipboard?.writeText(text);
      notify("Copied", "success", 1000);
    }

    function clearEditor() {
      syncToEditor("");
      syncFromEditor();
    }

    function copyText() {
      return doCopy();
    }

    function exportTxt() {
      return exportPlain();
    }

    function exportJSON() {
      return exportJson();
    }

    async function startRenameById(id) {
      if (id) await switchFile(id);
      startRename();
    }

    async function duplicateFile(id) {
      const file = files.value.find((f) => f.id === id);
      if (file) await ctxDuplicateFile(file);
    }

    function exportSingle(id) {
      const file = files.value.find((f) => f.id === id);
      if (file) ctxDownloadFile(file);
    }

    async function ctxDuplicateFile(f) {
      const dup = {
        ...f,
        id: genId(),
        name: f.name.replace(".md", "") + "-copy.md",
        updatedAt: Date.now(),
      };
      await persistFile(dup);
      files.value.unshift(dup);
      fileCtxOpen.value = false;
    }

    function ctxDownloadFile(f) {
      const blob = new Blob([f.content], { type: "text/markdown" });
      downloadBlob(blob, f.name);
    }

    // ── Split resize ──────────────────────────────────────────────────────────

    let resizing = false;
    function startResize(e) {
      resizing = true;
      const startX = e.clientX;
      const startW = editorWidth.value;
      const mainW = document.getElementById("main")?.clientWidth || window.innerWidth;
      const onMove = (ev) => {
        if (!resizing) return;
        const maxW = Math.max(220, mainW - 240);
        editorWidth.value = Math.min(maxW, Math.max(220, startW + (ev.clientX - startX)));
      };
      const onUp = () => {
        resizing = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    }

    // ── dark mode ─────────────────────────────────────────────────────────────

    function toggleDark() {
      cycleThemeMode();
    }

    // ── style panel ───────────────────────────────────────────────────────────

    function resetStyle() {
      applyFileStyle(createBaseFileStyle());
      nextTick(touchActiveFileStyle);
    }

    // ── watches ──────────────────────────────────────────────────────────────

    watch(renderedHtml, () => scheduleRender());
    watch(focusMode, (visible) => {
      if (visible) scheduleRender();
    });

    watch(darkMode, (v) => {
      applyThemeMode(v);
    });

    watch(wordWrap, (v) => {
      editorInstance?.setWordWrap(v);
    });

    watch(editorFontSize, (v) => {
      editorInstance?.setFontSize(v);
    });

    watch(previewTableLayout, (v) => setSettingDebounced("previewTableLayout", v));
    watch(previewScaleScope, (v) => setSettingDebounced("previewScaleScope", v));
    watch(previewScaleFactor, (v) => setSettingDebounced("previewScaleFactor", v));
    watch(userTemplates, (templates) => setSetting("userTemplates", templates), {
      deep: true,
    });
    watch(
      images,
      (library) => {
        rebuildImagePathMap();
        clearTimeout(settingDebounceTimers.get("imageStore"));
        settingDebounceTimers.set(
          "imageStore",
          setTimeout(() => {
            settingDebounceTimers.delete("imageStore");
            replaceAllImages(library).catch((error) => {
              notify(error?.message || "Could not save image library", "warn");
            });
          }, 500),
        );
      },
      { deep: true },
    );

    watch(
      [
        renderTheme,
        customFont,
        cFontSize,
        cLineH,
        cParaGap,
        cHeadFont,
        cH1,
        cH2,
        cWidth,
        cPadH,
        cPadV,
        cColorText,
        cColorHead,
        cColorLink,
        cColorBg,
        previewTextWrap,
        previewCodeWrap,
        previewCodeFontScale,
        previewLatexFontScale,
        previewTableLayout,
        previewTableStriped,
        previewTableCompact,
        previewTableFontScale,
        previewScaleScope,
        previewScaleFactor,
        mediaBlockBorder,
        mediaBlockBgMode,
        mediaBlockBgColor,
      ],
      touchActiveFileStyle,
    );

    watch(activePanel, (v) => {
      if (v === "organizer") parseBlocks();
    });

    let mermaidPreviewTimer = null;
    watch(mermaidCode, () => {
      if (!showMermaid.value) return;
      clearTimeout(mermaidPreviewTimer);
      mermaidPreviewTimer = setTimeout(() => previewMermaid(), 180);
    });

    watch(
      [posterPanels, posterTheme, posterColumns, posterSize, posterOrientation],
      () => {
        if (showPosterBuilder.value) schedulePosterRender();
      },
    );

    watch(posterSections, () => {
      if (!showPosterBuilder.value) return;
      syncPosterLayout(false);
      schedulePosterRender();
    });

    watch(posterSlotCount, () => {
      if (!showPosterBuilder.value) return;
      posterSlotCount.value = clampPosterSlotCount(posterSlotCount.value);
      syncPosterLayout(false);
      schedulePosterRender();
    });

    watch(showPosterBuilder, (visible) => {
      if (visible) schedulePosterRender();
    });

    // ── onMounted ────────────────────────────────────────────────────────────

    onMounted(async () => {
      // Setup marked
      setupMarked();
      systemThemeMedia = window.matchMedia?.("(prefers-color-scheme: dark)") || null;
      systemDarkMode.value = Boolean(systemThemeMedia?.matches);
      systemThemeListener = (event) => {
        systemDarkMode.value = Boolean(event.matches);
        if (themeMode.value === "system") applyThemePreference("system");
      };
      systemThemeMedia?.addEventListener?.("change", systemThemeListener);
      if (systemThemeMedia && !systemThemeMedia.addEventListener)
        systemThemeMedia.addListener?.(systemThemeListener);

      // Mermaid init
      if (window.mermaid) {
        mermaid.initialize({
          startOnLoad: false,
          theme: darkMode.value ? "dark" : "default",
          suppressErrorRendering: true,
        });
      }

      // IndexedDB + migration
      await openDB();
      await migrateFromLocalStorage();

      // Load persisted settings
      const settings = await getAllSettings();
      if (settings.themeMode) themeMode.value = settings.themeMode;
      else if (settings.darkMode !== undefined)
        themeMode.value = settings.darkMode ? "dark" : "light";
      applyThemePreference(themeMode.value);
      if (settings.wordWrap !== undefined) wordWrap.value = settings.wordWrap;
      if (settings.editorFontSize)
        editorFontSize.value = settings.editorFontSize;
      if (settings.lineHeight) editorLineHeight.value = settings.lineHeight;
      if (settings.autosaveDelay) {
        autosaveDelay.value = settings.autosaveDelay;
        setAutosaveDelay(settings.autosaveDelay);
      }
      if (settings.snapshotFreq) snapshotFreq.value = settings.snapshotFreq;
      if (settings.renderTheme) renderTheme.value = settings.renderTheme;
      if (settings.sidebarOpen !== undefined)
        sidebarOpen.value = settings.sidebarOpen;
      if (settings.topbarOpen !== undefined)
        topbarOpen.value = settings.topbarOpen;
      if (settings.viewMode) viewMode.value = settings.viewMode;
      if (settings.editorWidth) editorWidth.value = settings.editorWidth;
      if (settings.activePanel) activePanel.value = settings.activePanel;
      if (settings.showStylePanel !== undefined)
        showStylePanel.value = settings.showStylePanel;
      if (settings.syncScrollEnabled !== undefined)
        syncScrollEnabled.value = settings.syncScrollEnabled;
      if (settings.sidebarTemplatesOpen !== undefined)
        sidebarTemplatesOpen.value = settings.sidebarTemplatesOpen;
      if (settings.previewTableLayout)
        previewTableLayout.value = settings.previewTableLayout;
      if (settings.previewScaleScope)
        previewScaleScope.value = settings.previewScaleScope;
      if (settings.previewScaleFactor)
        previewScaleFactor.value = settings.previewScaleFactor;
      if (settings.fileStyleDefaults)
        fileStyleDefaults.value = sanitizeStyleDefaults(settings.fileStyleDefaults);
      if (Array.isArray(settings.userTemplates))
        userTemplates.value = settings.userTemplates;
      const storedImages = await getAllImages();
      if (storedImages.length) {
        images.value = storedImages;
        rebuildImagePathMap();
      } else if (Array.isArray(settings.imageLibrary)) {
        images.value = settings.imageLibrary;
        await replaceAllImages(settings.imageLibrary);
        await deleteSetting("imageLibrary");
        rebuildImagePathMap();
      }
      checkStorageQuota("Workspace");

      // Load files from IndexedDB
      await loadAllFiles();
      if (activePanel.value === "organizer") parseBlocks();
      if (settings.hasSeenGuide !== true) {
        showTutorial.value = true;
        await setSetting("hasSeenGuide", true);
      }

      // Mount CodeMirror 6 editor
      nextTick(() => {
        const parent = document.getElementById("editor-wrap");
        if (!parent) return;

        editorInstance = createEditor({
          parent,
          initialValue: activeFile.value?.content || "",
          darkMode: darkMode.value,
          wordWrap: wordWrap.value,
          fontSize: editorFontSize.value,
          lineHeight: editorLineHeight.value,
          onChange(text) {
            if (syncingEditorProgrammatically) return;
            if (activeFile.value) {
              activeFile.value.content = text;
              markUnsaved();
            }
          },
          onKeydown: onEditorKeydown,
          onPaste: onEditorPaste,
        });

        editorScrollEl = editorInstance?._view?.scrollDOM || null;
        previewScrollEl = previewScroller.value || document.getElementById("preview-scroller");
        editorScrollEl?.addEventListener("scroll", onEditorScroll, { passive: true });
        previewScrollEl?.addEventListener("scroll", onPreviewScroll, { passive: true });
      });

      // Global keyboard listener
      window.addEventListener("keydown", onWindowKeydown);
      window.addEventListener("click", closeAllCtx);

      // Snapshot timer
      snapshotTimer = setInterval(() => {
        if (activeFileId.value && unsaved.value) maybeCreateSnapshot();
      }, 60000); // check every minute

      // Persist sidebar/theme changes
      watch(sidebarOpen, (v) => setSetting("sidebarOpen", v));
      watch(topbarOpen, (v) => setSetting("topbarOpen", v));
      watch(viewMode, (v) => setSetting("viewMode", v));
      watch(editorWidth, (v) => setSettingDebounced("editorWidth", v));
      watch(activePanel, (v) => setSetting("activePanel", v));
      watch(showStylePanel, (v) => setSetting("showStylePanel", v));
      watch(syncScrollEnabled, (v) => setSetting("syncScrollEnabled", v));
      watch(sidebarTemplatesOpen, (v) => setSetting("sidebarTemplatesOpen", v));
      watch(renderTheme, (v) => setSetting("renderTheme", v));
    });

    onUnmounted(() => {
      window.removeEventListener("keydown", onWindowKeydown);
      window.removeEventListener("click", closeAllCtx);
      if (systemThemeMedia && systemThemeListener)
        systemThemeMedia.removeEventListener?.("change", systemThemeListener);
      if (systemThemeMedia && systemThemeListener && !systemThemeMedia.removeEventListener)
        systemThemeMedia.removeListener?.(systemThemeListener);
      editorScrollEl?.removeEventListener("scroll", onEditorScroll);
      previewScrollEl?.removeEventListener("scroll", onPreviewScroll);
      clearInterval(snapshotTimer);
      clearTimeout(syncIndicatorTimer);
      clearTimeout(renderTimer);
      clearTimeout(mermaidPreviewTimer);
      clearTimeout(posterRenderTimer);
      settingDebounceTimers.forEach((timer) => clearTimeout(timer));
      settingDebounceTimers.clear();
      editorInstance?.destroy();
    });

    // ── expose to template ────────────────────────────────────────────────────

    return {
      // constants
      TEMPLATES,
      RENDER_THEMES,
      LATEX_CATS,
      latexTemplates,
      MERMAID_TEMPLATES,
      BLOCK_TYPES,
      SHORTCUTS,
      shortcuts,
      tutorialSections,

      // state
      files,
      activeFileId,
      activeFile,
      fileSearch,
      filteredFiles,
      isFileSearchActive,
      draggedFileId,
      fileDragOverId,
      unsaved,
      autosaveStatus,
      viewMode,
      medicalSearch,
      medicalFocusMode,
      medicalFocusPage,
      medicalShowPageNumbers,
      medicalPages,
      medicalVisiblePages,
      medicalMatchCount,
      sidebarOpen,
      topbarOpen,
      themeMode,
      themeModeIcon,
      themeModeLabel,
      darkMode,
      focusMode,
      wordWrap,
      editorFontSize,
      editorLineHeight,
      showLatex,
      showMermaid,
      showExport,
      showImgManager,
      showTemplates,
      showStylePanel,
      showShortcuts,
      showTutorial,
      showFR,
      showSettings,
      showHistory,
      showPosterBuilder,
      posterPreviewRef,
      posterTitle,
      posterSubtitle,
      posterSize,
      posterOrientation,
      posterColumns,
      posterSlotCount,
      posterLayout,
      posterDragSectionId,
      posterTheme,
      posterSizeOptions,
      posterThemeOptions,
      appDialog,
      closeAppDialog,
      syncScrollEnabled,
      syncIndicator,
      sidebarTemplatesOpen,
      previewScroller,
      frFindRef,
      renamingFile,
      renameVal,
      renameInputRef,
      latexCat,
      latexInput,
      latexRendered,
      latexMode,
      mermaidCode,
      mermaidPrev,
      mermaidRendered,
      mermaidError,
      mermaidTpl,
      mermaidDiagramType,
      activePanel,
      blocks,
      editingBlockIdx,
      blockTypeMenuOpen,
      blockTypeMenuPos,
      blockTypeMenuTarget,
      blockTypeSearch,
      renderTheme,
      customFont,
      cFontSize,
      cLineH,
      cParaGap,
      cHeadFont,
      cH1,
      cH2,
      cWidth,
      cPadH,
      cPadV,
      cColorText,
      cColorHead,
      cColorLink,
      cColorBg,
      previewTextWrap,
      previewCodeWrap,
      previewCodeFontScale,
      previewLatexFontScale,
      previewTableLayout,
      previewTableStriped,
      previewTableCompact,
      previewTableFontScale,
      previewScaleScope,
      previewScaleFactor,
      previewBlockSizes,
      previewBlockAlignments,
      previewBlockStyles,
      mediaBlockBorder,
      mediaBlockBgMode,
      mediaBlockBgColor,
      showPdfSettings,
      exportPaperSize,
      pdfPaperSize,
      exportOrientation,
      pdfOrientation,
      exportMargins,
      pdfMargins,
      exportScale,
      pdfScale,
      exportBgGraphics,
      pdfBg,
      exportTitle,
      exportAuthor,
      images,
      selectedImgs,
      imgFileInput,
      imgUploadRef: imgFileInput,
      showResizeModal,
      showResize,
      resizeTarget,
      resizeTgt,
      resizeW,
      resW,
      resizeH,
      resH,
      resizeLock,
      resLock,
      resQ,
      showCropModal,
      showCrop,
      cropTarget,
      cropTgt,
      cropX,
      cropY,
      cropW,
      cropH,
      cropPreset,
      cropPresets,
      cropWrapRef,
      cropImgRef,
      cropDisplayRect,
      userTemplates,
      showSaveTplModal,
      tplTab,
      newTplName,
      newTplDesc,
      newTplIncContent,
      tplInclude,
      showTableEditor,
      tableEditor,
      showBlockStyleEditor,
      blockStyleEditor,
      showMermaidViewer,
      mermaidViewer,
      mermaidViewerCanvasRef,
      notifications,
      ctxMenu,
      editorCtxOpen,
      editorCtxPos,
      previewCtxOpen,
      previewCtxPos,
      fileCtxOpen,
      fileCtxPos,
      fileCtxTarget,
      editorWidth,
      editorWrap,
      frFind,
      frReplace,
      frCase,
      frRegex,
      frWord,
      frWhole: frWord,
      frCount,
      snapshots,
      snapshotFreq,
      autosaveDelay,
      settingsAutosaveDelay,
      settingsSnapshotFreq,
      settingsEditorFontSize,
      settingsLineHeight,
      settingsWordWrap,
      settingsSpellcheck,

      // computed
      currentContent,
      previewSegments,
      renderedHtml,
      medicalBlockMatches,
      isMedicalPageOpen,
      toggleMedicalPage,
      setAllMedicalPages,
      toggleMedicalRecall,
      isMedicalRevealed,
      setMedicalFocus,
      moveMedicalFocus,
      wordCount,
      charCount,
      lineCount,
      readTime,
      headings,
      posterSections,
      posterUnassignedSections,
      posterPanels,
      posterCanvasStyle,
      qcmQuestions,
      hasQcmQuestions,
      fontChoices,
      renderThemes,
      currentThemeName,
      previewPageStyle,
      previewPageClass,
      mermaidViewerZoomLabel,
      mermaidViewerStageStyle,
      filteredBlockTypes,

      // methods
      newFile,
      switchFile,
      deleteFile,
      saveFile: saveFileFn,
      startRename,
      finishRename,
      mdFileInput,
      workspaceFileInput,
      triggerMdUpload,
      onMdFileUpload,
      triggerWorkspaceRestore,
      backupWorkspace,
      onWorkspaceRestore,
      onFileDragStart,
      onFileDragOver,
      onFileDrop,
      onFileDragEnd,
      fmt,
      fmtLine,
      fmtBlock,
      insertText,
      undo,
      redo,
      insertLink,
      insertImageFromLib,
      insertTable,
      addTableRow,
      removeTableRow,
      addTableColumn,
      removeTableColumn,
      applyTableEditor,
      applyBlockStyleEditor,
      resetBlockStyleEditor,
      closeMermaidViewer,
      fitMermaidViewer,
      setMermaidViewerZoom,
      resetMermaidViewerZoom,
      onMermaidViewerWheel,
      beginMermaidViewerPan,
      copyMermaidViewerSource,
      downloadMermaidSvg,
      downloadMermaidPng,
      scrollToHeading,
      openLatexBuilder,
      insertLatexSym,
      onLatexInputChange,
      onLatexKeyUp,
      insertLatexToEditor,
      openMermaidBuilder,
      previewMermaid,
      renderMermaidPreview,
      loadMermaidTpl,
      insertMermaidToEditor,
      parseBlocks,
      blocksToContent,
      moveBlock,
      duplicateBlock,
      deleteBlock,
      addBlock,
      openBlockTypeMenu,
      onBlockDragStart,
      onBlockDragOver,
      onBlockDrop,
      onBlockDragEnd,
      openFR,
      frDoFind,
      frReplaceOne,
      frGoTo,
      frCountMatches,
      frReplaceFn,
      frReplaceAll,
      openImgManager,
      onImgUpload,
      onImgDrop,
      triggerImgUpload,
      toggleImgSelect,
      toggleImgSel,
      insertSelectedImgs,
      insertSelected,
      deleteSelectedImgs,
      deleteSelected,
      insertOneImage,
      openResize,
      onRW,
      onRH,
      applyResize,
      openCrop,
      initCropDisplay,
      onCropMouseDown,
      applyCropPreset,
      applyCrop,
      openTemplates,
      loadTemplate,
      openSaveTplModal,
      saveAsTheme,
      saveNewTemplate,
      saveAsUserTemplate,
      loadUserTemplate,
      deleteUserTpl,
      openExport,
      openPosterBuilder,
      closePosterBuilder,
      printPoster,
      resetPosterLayout,
      setPosterSlot,
      clearPosterSlot,
      movePosterSlot,
      addPosterSlot,
      removePosterSlot,
      beginPosterSectionDrag,
      dropPosterSection,
      endPosterSectionDrag,
      exportMarkdown,
      exportHtml,
      exportPdfFn,
      exportDocx,
      exportPlain,
      exportJson,
      exportAllZip,
      copyHtml,
      openEditorCtx,
      openPreviewCtx,
      openFileCtx,
      closeCtx,
      closeAllCtx,
      doSelectAll,
      doCopy,
      clearEditor,
      copyText,
      exportTxt,
      exportJSON,
      exportQcmJson,
      exportQcmAnswerSheet,
      startRenameById,
      duplicateFile,
      exportSingle,
      ctxDuplicateFile,
      ctxDownloadFile,
      startResize,
      toggleDark,
      setThemeMode,
      cycleThemeMode,
      toggleSyncScroll,
      resetStyle,
      openSettings,
      applySettings,
      openHistory,
      manualSnapshot,
      restoreSnapshot,
      removeSnapshot,
      formatSnapDate,
      notify,
      katex: window.katex,
    };
  },
}).mount("#vue-root");
