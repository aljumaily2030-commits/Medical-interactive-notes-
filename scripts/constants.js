const DEFAULT_CONTENT = `# Welcome to Markdown Studio

Start writing your document here. Use the toolbar above for formatting, or type markdown directly.

## Features

- **Live Preview** — see your document rendered in real time
- **LaTeX Math** — press Ctrl+M or click the LaTeX button
- **Mermaid Diagrams** — press Ctrl+G
- **Block Organizer** — press Ctrl+O
- **Export** — PDF, HTML, DOCX, Markdown, and more

## Quick Start

\`\`\`markdown
**bold** _italic_ \`inline code\`
## Heading
- list item
> blockquote
\`\`\`

$$
E = mc^2
$$

\`\`\`mermaid
graph LR
  A[Write] --> B[Preview] --> C[Export]
\`\`\`
`;

const FILE_RECORD_VERSION = 1;

// ── kept identical to original ─────────────────────────────────────────────

const TEMPLATES = [
  {
    id: "research",
    name: "Research Paper",
    icon: "ti-school",
    desc: "Academic citations",
    theme: "research",
    content:
      "# Paper Title\n\n**Author** · Institution · {{date}}\n\n---\n\n## Abstract\n\nWrite abstract here.\n\n## 1. Introduction\n\nIntroduce research.\n\n## 2. Methodology\n\nMethods description.\n\n## 3. Results\n\n| Variable | Group A | Group B |\n|----------|---------|----------|\n| Metric   | 0.82    | 0.76     |\n\n## 4. Discussion\n\nInterpret results.\n\n## References\n\n1. Author (Year). *Title*. Journal.\n",
  },
  {
    id: "cv",
    name: "Professional CV",
    icon: "ti-id-badge",
    desc: "Resume / CV",
    theme: "cv",
    content:
      "# Your Name\n\n> email@example.com · +1 234 567 8900 · City\n\n## Profile\n\nProfessional summary.\n\n## Experience\n\n### Senior Role · Company\n#### Jan 2022 – Present\n\n- Achievement with outcome\n- Leadership contribution\n\n## Education\n\n### Degree · University\n#### 2016–2020\n\n## Skills\n\n**Technical:** Skill 1 · Skill 2\n",
  },
  {
    id: "technical",
    name: "Tech Docs",
    icon: "ti-code",
    desc: "API / README",
    theme: "technical",
    content:
      "# Project Name\n\nBrief description.\n\n## Installation\n\n```bash\nnpm install your-package\n```\n\n## Quick Start\n\n```javascript\nimport { create } from 'your-package';\nconst instance = create({ option: 'value' });\n\nawait instance.run();\n```\n\n## API Reference\n\n### `create(options)`\n\n| Parameter | Type | Default | Description |\n|-----------|------|---------|-------------|\n| `option` | string | 'default' | Option desc |\n\n## License\n\nMIT\n",
  },
  {
    id: "latex",
    name: "LaTeX Style",
    icon: "ti-math-function",
    desc: "Math / theory",
    theme: "latex",
    content:
      "# Document Title\n\n**Author One** and **Author Two**\n\n---\n\n## Abstract\n\nThis document demonstrates LaTeX-inspired rendering.\n\n## 1. Introduction\n\nLet $G = (V, E)$ be a graph.\n\n**Theorem 1.1.** *Every planar graph is four-colorable.*\n\n## 2. Main Result\n\n$$\\sum_{i=1}^{n} x_i^2 \\geq \\frac{1}{n}\\left(\\sum_{i=1}^{n} x_i\\right)^2$$\n\nThis follows from Cauchy–Schwarz. $\\square$\n\n## References\n\n[1] Appel, K. (1976). *Bull. Amer. Math. Soc.*\n",
  },
  {
    id: "ieee",
    name: "IEEE Paper",
    icon: "ti-cpu",
    desc: "Engineering journal",
    theme: "ieee",
    content:
      '# Title of the Paper\n\n**Author One, Author Two** · Department\n\n---\n\n## Abstract\n\nThis paper presents…\n\n## I. Introduction\n\nIntroduction text.\n\n## II. Methodology\n\nDescribe approach.\n\n## III. Results\n\nEvaluation results.\n\n## IV. Conclusion\n\nConclusion.\n\n## References\n\n[1] A. Author, "Title," *Journal*, vol. 1, pp. 1–10.\n',
  },
  {
    id: "hbs",
    name: "Business Case",
    icon: "ti-briefcase",
    desc: "HBS case study",
    theme: "hbs",
    content:
      "# Company: Situation\n\n**Case Study** · {{date}}\n\n## Executive Summary\n\nBrief overview.\n\n## Background\n\nCompany context.\n\n## Key Issues\n\n1. **Issue One** — Description\n2. **Issue Two** — Description\n\n## Financial Overview\n\n| Metric | FY2022 | FY2023 |\n|--------|--------|--------|\n| Revenue | $100M | $120M |\n\n## Recommendation\n\nRecommended action.\n",
  },
  {
    id: "legal",
    name: "Legal Document",
    icon: "ti-gavel",
    desc: "Contracts",
    theme: "legal",
    content:
      "# CONTRACT AGREEMENT\n\n**Effective Date:** {{date}}\n\n**Between:** Party A and Party B\n\n---\n\n## 1. DEFINITIONS\n\n- **Services** means the professional services described herein.\n\n## 2. SCOPE\n\n1. Service description one\n2. Service description two\n\n## 3. COMPENSATION\n\nClient shall pay $[AMOUNT].\n\n## 4. GOVERNING LAW\n\nGoverned by laws of [Jurisdiction].\n",
  },
  {
    id: "medical",
    name: "Clinical Report",
    icon: "ti-stethoscope",
    desc: "Medical report",
    theme: "medical",
    content:
      "# Clinical Case Report\n\n**Date:** {{date}} · **Physician:** Dr. Name\n\n---\n\n## Patient Information\n\n| Field | Details |\n|-------|--------|\n| Age / Sex | 45 / M |\n| Chief Complaint | Symptom |\n\n## Assessment & Plan\n\n> **Diagnosis:** Primary diagnosis\n\n1. Treatment step one\n2. Treatment step two\n\n## Follow-up\n\nScheduled in X weeks.\n",
  },
  {
    id: "startup",
    name: "Pitch Deck",
    icon: "ti-rocket",
    desc: "Startup pitch",
    theme: "startup",
    content:
      "# Company Name\n\n> *Tagline — One sentence vision*\n\n---\n\n## The Problem\n\nDescribe the pain point.\n\n## Solution\n\nHow you solve it.\n\n## Market Opportunity\n\n- **TAM:** $X billion\n- **SAM:** $X billion\n\n## Traction\n\n| Metric | Value |\n|--------|-------|\n| MRR | $X,XXX |\n| Users | X,XXX |\n\n## The Ask\n\nRaising **$XM**.\n",
  },
  {
    id: "editorial",
    name: "Editorial",
    icon: "ti-feather",
    desc: "Magazine article",
    theme: "editorial",
    content:
      "# The Headline That Captures Attention\n\n*By Author Name · Publication · {{date}}*\n\n---\n\nThe opening paragraph draws readers in with a compelling hook.\n\n> The most powerful sentence is often the simplest one.\n\n## Developing the Story\n\nHere you develop the main argument.\n\n## Conclusion\n\nEnd with impact.\n",
  },
  {
    id: "book",
    name: "Book Chapter",
    icon: "ti-book",
    desc: "Long-form prose",
    theme: "book",
    content:
      '# Chapter One\n\n## The Beginning\n\nIt was on a Tuesday, unremarkable in every outward way, that everything changed.\n\nShe had not expected to find the letter. Nobody ever expects the letter.\n\n---\n\n> *"We carry our histories with us,"* her grandmother had said.\n\nIt was not until she held the paper that she understood.\n',
  },
  {
    id: "newspaper",
    name: "Newspaper",
    icon: "ti-news",
    desc: "Multi-column news",
    theme: "newspaper",
    content:
      '# BREAKING: Major Development Reshapes Industry\n\n*By Staff Reporter · {{date}}*\n\nIn a development analysts call transformative, leaders announced significant changes.\n\n## Experts Weigh In\n\n"This is unprecedented," said Dr. Jane Smith.\n\n## Market Reaction\n\n| Index | Change |\n|-------|--------|\n| Main | +2.3% |\n\n## What Comes Next\n\nObservers will be watching closely.\n',
  },
  {
    id: "meeting",
    name: "Meeting Notes",
    icon: "ti-notes",
    desc: "Minutes & actions",
    theme: "default",
    content:
      "# Meeting Notes\n\n**Date:** {{date}} · **Facilitator:** Name\n\n## Attendees\n\n- Person One\n- Person Two\n\n## Discussion\n\n### Topic 1\n\nSummary. **Decision:** What was decided.\n\n## Action Items\n\n| Task | Owner | Due |\n|------|-------|-----|\n| Task | Person | Date |\n",
  },
  {
    id: "qcm-practice",
    name: "QCM Practice",
    icon: "ti-list-check",
    desc: "Interactive exercises",
    theme: "default",
    content:
      "# QCM Practice Sheet\n\n**Topic:** Course unit · **Date:** {{date}}\n\n## Instructions\n\nSelect the correct answer or answers. Multi-answer questions check automatically once the required number of options is selected.\n\n?? Which data structure uses FIFO ordering?\n\n- [ ] Stack\n- [x] Queue\n- [ ] Tree\n- [ ] Graph\n\n?! FIFO means first in, first out. A queue removes items in the same order they were inserted.\n\n---\n\n?? Select the Markdown features supported by Markdown Studio.\n\n- [x] Mermaid diagrams\n- [x] LaTeX math\n- [ ] Native spreadsheet formulas\n- [x] Tables\n\n?! Markdown Studio supports diagrams, math, and tables directly in the preview.\n\n---\n\n?? What does $O(n \\log n)$ usually describe?\n\n- [ ] Constant-time lookup\n- [x] A common comparison-sort complexity\n- [ ] Exponential search\n- [ ] Linear scan only\n\n?! Algorithms like merge sort and heap sort run in $O(n \\log n)$ time.\n",
  },
  {
    id: "notebook-report",
    name: "Notebook Report",
    icon: "ti-brand-python",
    desc: "Styled notebook notes",
    theme: "technical",
    content:
      "# Notebook Analysis Report\n\n<div class=\"nb-document-meta\">Notebook-style document · imported cells can be restyled here</div>\n\n## Objective\n\nState the question, dataset, or experiment being analyzed.\n\n<div class=\"nb-cell-label\">In [1]</div>\n\n```python\nimport pandas as pd\nimport matplotlib.pyplot as plt\n\n# Load and inspect the dataset\ndf = pd.read_csv(\"data.csv\")\ndf.head()\n```\n\n<div class=\"nb-output\"><div class=\"nb-cell-label\">Out [1]</div><pre>5 rows x 8 columns</pre></div>\n\n## Findings\n\n- Key observation one\n- Key observation two\n- Limitation or next step\n\n<div class=\"nb-cell-label\">In [2]</div>\n\n```python\nsummary = df.describe()\nsummary\n```\n\n<div class=\"nb-output\"><div class=\"nb-cell-label\">Out [2]</div><pre>summary statistics table</pre></div>\n\n## Conclusion\n\nSummarize what the notebook demonstrates and what should happen next.\n",
  },
  {
    id: "minimal",
    name: "Minimal Note",
    icon: "ti-note",
    desc: "Blank canvas",
    theme: "minimal",
    content: "# Title\n\nWrite here…\n",
  },
];

const RENDER_THEMES = [
  { id: "default", name: "Clean Article" },
  { id: "research", name: "Research Paper" },
  { id: "scientific", name: "Scientific Report" },
  { id: "ieee", name: "IEEE / Engineering" },
  { id: "cv", name: "Professional CV" },
  { id: "latex", name: "LaTeX Style" },
  { id: "hbs", name: "Harvard Business" },
  { id: "legal", name: "Legal Document" },
  { id: "medical", name: "Medical / Clinical" },
  { id: "startup", name: "Startup / Pitch" },
  { id: "editorial", name: "Editorial Magazine" },
  { id: "technical", name: "Technical Docs" },
  { id: "book", name: "Book / Novel" },
  { id: "newspaper", name: "Newspaper" },
  { id: "minimal", name: "Minimal" },
];

const LATEX_CATS = [
  {
    id: "greek",
    label: "Greek",
    icon: "ti-alpha",
    symbols: [
      { label: "α", tex: "\\alpha" },
      { label: "β", tex: "\\beta" },
      { label: "γ", tex: "\\gamma" },
      { label: "δ", tex: "\\delta" },
      { label: "ε", tex: "\\epsilon" },
      { label: "θ", tex: "\\theta" },
      { label: "λ", tex: "\\lambda" },
      { label: "μ", tex: "\\mu" },
      { label: "π", tex: "\\pi" },
      { label: "σ", tex: "\\sigma" },
      { label: "φ", tex: "\\phi" },
      { label: "ψ", tex: "\\psi" },
      { label: "ω", tex: "\\omega" },
      { label: "Σ", tex: "\\Sigma" },
      { label: "Δ", tex: "\\Delta" },
      { label: "Γ", tex: "\\Gamma" },
    ],
  },
  {
    id: "ops",
    label: "Operators",
    icon: "ti-math-symbols",
    symbols: [
      { label: "∫", tex: "\\int" },
      { label: "∑", tex: "\\sum" },
      { label: "∏", tex: "\\prod" },
      { label: "∂", tex: "\\partial" },
      { label: "√", tex: "\\sqrt{x}" },
      { label: "±", tex: "\\pm" },
      { label: "×", tex: "\\times" },
      { label: "÷", tex: "\\div" },
      { label: "≤", tex: "\\leq" },
      { label: "≥", tex: "\\geq" },
      { label: "≠", tex: "\\neq" },
      { label: "≈", tex: "\\approx" },
      { label: "∈", tex: "\\in" },
      { label: "∉", tex: "\\notin" },
      { label: "⊂", tex: "\\subset" },
      { label: "∞", tex: "\\infty" },
    ],
  },
  {
    id: "frac",
    label: "Fractions",
    icon: "ti-divide",
    symbols: [
      { label: "a/b", tex: "\\frac{a}{b}" },
      { label: "¹/₂", tex: "\\frac{1}{2}" },
      { label: "a²", tex: "a^{2}" },
      { label: "aₙ", tex: "a_{n}" },
      { label: "lim", tex: "\\lim_{x\\to\\infty}" },
      { label: "log", tex: "\\log_{b}(x)" },
      { label: "ln", tex: "\\ln(x)" },
      { label: "sin", tex: "\\sin(x)" },
      { label: "cos", tex: "\\cos(x)" },
      { label: "tan", tex: "\\tan(x)" },
    ],
  },
  {
    id: "matrix",
    label: "Matrices",
    icon: "ti-grid-4x4",
    symbols: [
      { label: "2×2 mat", tex: "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}" },
      {
        label: "3×3 mat",
        tex: "\\begin{pmatrix}a&b&c\\\\d&e&f\\\\g&h&i\\end{pmatrix}",
      },
      { label: "det", tex: "\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}" },
      { label: "binom", tex: "\\binom{n}{k}" },
      {
        label: "cases",
        tex: "f(x)=\\begin{cases}0&x<0\\\\1&x\\geq 0\\end{cases}",
      },
    ],
  },
  {
    id: "arrows",
    label: "Arrows",
    icon: "ti-arrows-exchange",
    symbols: [
      { label: "→", tex: "\\rightarrow" },
      { label: "←", tex: "\\leftarrow" },
      { label: "↔", tex: "\\leftrightarrow" },
      { label: "⇒", tex: "\\Rightarrow" },
      { label: "⇐", tex: "\\Leftarrow" },
      { label: "⇔", tex: "\\Leftrightarrow" },
      { label: "↑", tex: "\\uparrow" },
      { label: "↓", tex: "\\downarrow" },
    ],
  },
];

const latexTemplates = [
  { label: "Fraction", tex: "\\frac{a}{b}" },
  { label: "Sum", tex: "\\sum_{i=0}^{n} x_i" },
  { label: "Integral", tex: "\\int_{a}^{b} f(x)\\,dx" },
  { label: "Limit", tex: "\\lim_{x\\to\\infty} f(x)" },
  {
    label: "Matrix 2×2",
    tex: "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}",
  },
  {
    label: "Cases",
    tex: "\\begin{cases} a & \\text{if } n>0 \\\\ b & \\text{otherwise} \\end{cases}",
  },
  { label: "Greek sum", tex: "\\sum_{k=1}^{n} \\alpha_k x_k" },
  { label: "Derivative", tex: "\\frac{d}{dx}f(x)" },
  { label: "Binomial", tex: "\\binom{n}{k} = \\frac{n!}{k!(n-k)!}" },
  { label: "Euler", tex: "e^{i\\pi}+1=0" },
];

const MERMAID_TEMPLATES = [
  {
    id: "flowchart",
    label: "Flowchart",
    icon: "ti-topology-star-ring",
    code: "flowchart LR\n  A([Start]) --> B{Decision?}\n  B -->|Yes| C[Action]\n  B -->|No| D[Other]\n  C --> E([End])\n  D --> E",
  },
  {
    id: "sequence",
    label: "Sequence",
    icon: "ti-arrows-exchange",
    code: "sequenceDiagram\n  participant A as User\n  participant B as Server\n  A->>B: Request\n  B-->>A: Response\n  A->>B: Confirm\n  B-->>A: OK",
  },
  {
    id: "class",
    label: "Class Diagram",
    icon: "ti-hierarchy",
    code: "classDiagram\n  class Animal{\n    +String name\n    +makeSound()\n  }\n  class Dog{\n    +fetch()\n  }\n  Animal <|-- Dog",
  },
  {
    id: "state",
    label: "State Machine",
    icon: "ti-circles-relation",
    code: "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running: start\n  Running --> Idle: stop\n  Running --> Error: fail\n  Error --> Idle: reset",
  },
  {
    id: "er",
    label: "ER Diagram",
    icon: "ti-database",
    code: "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ ITEM : contains\n  CUSTOMER {\n    string name\n    string email\n  }",
  },
  {
    id: "gantt",
    label: "Gantt Chart",
    icon: "ti-calendar-stats",
    code: "gantt\n  title Project Plan\n  dateFormat YYYY-MM-DD\n  section Phase 1\n    Research :a1, 2024-01-01, 14d\n    Design   :a2, after a1, 10d\n  section Phase 2\n    Build    :b1, after a2, 21d\n    Test     :b2, after b1, 7d",
  },
  {
    id: "pie",
    label: "Pie Chart",
    icon: "ti-chart-pie",
    code: 'pie title Browser Market Share\n  "Chrome" : 65\n  "Safari" : 19\n  "Firefox" : 4\n  "Edge" : 4\n  "Other" : 8',
  },
  {
    id: "mindmap",
    label: "Mind Map",
    icon: "ti-brain",
    code: "mindmap\n  root((Main Topic))\n    Subtopic A\n      Detail 1\n      Detail 2\n    Subtopic B\n      Detail 3\n    Subtopic C",
  },
  {
    id: "timeline",
    label: "Timeline",
    icon: "ti-timeline",
    code: "timeline\n  title History of Events\n  2020 : Event A\n       : Event B\n  2021 : Event C\n  2022 : Event D\n       : Event E",
  },
  {
    id: "git",
    label: "Git Graph",
    icon: "ti-git-branch",
    code: "gitGraph\n  commit\n  branch feature\n  checkout feature\n  commit\n  commit\n  checkout main\n  merge feature\n  commit",
  },
  {
    id: "journey",
    label: "User Journey",
    icon: "ti-route",
    code: "journey\n  title My Working Day\n  section Morning\n    Wake up: 1: Me\n    Coffee: 5: Me\n    Commute: 3: Me\n  section Work\n    Meetings: 4: Me, Team\n    Code: 5: Me",
  },
  {
    id: "block",
    label: "Block Diagram",
    icon: "ti-layout",
    code: 'block-beta\n  columns 3\n  A["Service A"]:1 B["Service B"]:1 C["Service C"]:1\n  space D["Database"]:1 space\n  A-- "calls" -->D\n  B-->D\n  C-->D',
  },
];

const BLOCK_TYPES = [
  { type: "heading", label: "Heading", icon: "ti-h-1" },
  { type: "paragraph", label: "Paragraph", icon: "ti-text-size" },
  { type: "list", label: "List", icon: "ti-list" },
  { type: "code", label: "Code Block", icon: "ti-terminal-2" },
  { type: "math", label: "Math", icon: "ti-math-function" },
  { type: "mermaid", label: "Mermaid", icon: "ti-topology-star" },
  { type: "quote", label: "Blockquote", icon: "ti-blockquote" },
  { type: "table", label: "Table", icon: "ti-table" },
  { type: "hr", label: "Divider", icon: "ti-minus" },
  { type: "image", label: "Image", icon: "ti-photo" },
];

// ── Keyboard shortcuts (for the modal only — actual binding is below) ──────

const SHORTCUTS = [
  { key: "Ctrl+S", desc: "Save" },
  { key: "Ctrl+N", desc: "New file" },
  { key: "Ctrl+B", desc: "Bold" },
  { key: "Ctrl+I", desc: "Italic" },
  { key: "Ctrl+`", desc: "Inline code" },
  { key: "Ctrl+M", desc: "LaTeX Builder" },
  { key: "Ctrl+G", desc: "Mermaid Builder" },
  { key: "Ctrl+O", desc: "Block Organizer" },
  { key: "Ctrl+F", desc: "Find & Replace" },
  { key: "Ctrl+,", desc: "Settings" },
  { key: "Ctrl+Z", desc: "Undo" },
  { key: "Ctrl+Y", desc: "Redo" },
  { key: "Ctrl+Shift+H", desc: "History / Snapshots" },
  { key: "Escape", desc: "Close modal / exit focus" },
];

export {
  DEFAULT_CONTENT, FILE_RECORD_VERSION, TEMPLATES, RENDER_THEMES,
  LATEX_CATS, latexTemplates, MERMAID_TEMPLATES, BLOCK_TYPES, SHORTCUTS
}
