# Mathematics cheatsheet seed example

This course-neutral specimen exercises the reusable Academic OS interface without course content. Durable artifacts: [filled seed source](../../seed-templates/70%20Learning/templates/mathematics-cheatsheet.template.tex), [preamble](../../seed-templates/70%20Learning/templates/mathematics-cheatsheet-preamble.template.tex), [vector logo](../../seed-templates/70%20Learning/templates/chatgpt-logo.template.tex), and [compiled PDF](mathematics-cheatsheet.pdf).

Build:

```sh
PATH=/Library/TeX/texbin:$PATH npm run templates:check
```

A4 portrait; exactly two pages; four columns; color release with a grayscale legibility check. Geometry: 1.8 mm side margins, 4.0 mm body top margin, 5.47 mm reserved body bottom margin, 0.6 mm column gaps, and a 1.6 mm footer baseline. Header/footer remain 4 pt. Body uses Latin Modern 4 pt with 4.1 pt leading. `\DeclareMathSizes{4}{4}{3}{2.4}` sets native math. The scalable `lmex10` override fixes Latin Modern's default fixed 10 pt extension font. No `\resizebox`, `\scalebox`, font stretching, or operator substitution.

Navy navigation and ruled headings organize the page. On white paper, cobalt marks selected
theorems and formulas, green marks key terms and method pivots, and rust marks pitfalls.
The specimen shows a short pale blue theorem label, a lilac fill behind a whole compact lemma,
a mint exercise tag and a yellow lookup term. Routine text is black. A heavier underline marks
a selected claim in grayscale.

Primary API:

- `\SheetSetup{title=...,credit=...,disclaimer=...,publisher=...,logo=...}`
- `\MajorBlock{ID}{title}`, `\SourceBlock{ID}{title}`, `\Topic{title}`
- `\Statement{kind}{number}{text}`, `\FormalStatement{kind}{number}{source-id}{title}{body}`, with starred forms for selected claims
- `\TaggedStatement{role}{kind}{number}{body}`, `\HighlightedStatement{role}{kind}{number}{body}`, `\PassageHighlight{role}{body}`, `\HighlightTag{role}{text}`
- `\Assumption{body}`, `\Proof{body}`, `\Example{number}{body}`
- `\Question{number}{source-id}{setup}`
- `\QuestionPart{part}{concept}{source-id}{question}{solution}`
- `\Worked{source+part}{concept}{question}{solution}`
- `\KeyTerm{term}`, `\Method{text}`, `\Conclusion{text}`, `\Result{text}`, `\Pitfall{phrase}`
- `\Alternative{method}{body}`, `\Caution{body}`, `\Continuation{ID}`
- `\SourceRef{ID}`, `\ConceptRef{label}`, `\Identity{name}{math}`, `\CompactTable{tabular}`

`\DisplayStatementKind` and `\DisplayQuestionID` are identity hooks in the generic preamble. A module can override their display locally—for example, `\renewcommand{\DisplayQuestionID}[1]{Problem~#1}`—without putting module-specific label mappings in the public seed.

Long content macros remain breakable. Exact uppercase `\Needspace` was replaced by the approximate lowercase `\needspace`, whose penalty/glue implementation is safe in this multipage `multicols` specimen; final flow is also visually audited for stranded headings. The specimen deliberately demonstrates a question continuation across a column/page boundary.

Logo provenance: `chatgpt-logo.tex` transcribes the single path from `OpenAI-black-monoblossom.svg` in the official [OpenAI logo archive](https://cdn.openai.com/brand/OpenAI-Logos-2025.zip), linked from [OpenAI Design Guidelines](https://openai.com/brand/). It preserves the supplied path/aspect ratio and renders through TikZ `svg.path`; no binary logo dependency. OpenAI owns the mark. The preinserted credit is attribution, not review evidence; no GPT-6 Astra Pro review is claimed.

## Verification

- [Compiled color specimen](mathematics-cheatsheet.pdf) SHA-256 `d88642069119c02e66f6706629f430afa7dfe30b258d2ded0693f6c2851344d3`.
- Reviewed both A4 pages and all eight columns in color and grayscale. The 46 structured explanations each contain a cue. The shared verifier checks literal wrapper calls in the document body.
- The compiled print fixtures check all five highlight roles, one fill for nested highlights,
  equal bounds for equivalent highlighted and plain lines, and at least 7:1 ink-to-background contrast.
- [Earlier visual review](visual-review.md) and [mathematical review](mathematics-review.md)
  document the previous specimen revision.
