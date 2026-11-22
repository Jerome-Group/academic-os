# Mathematics cheatsheet seed example

This course-neutral specimen exercises the reusable Academic OS interface without course content. Durable artifacts: [filled seed source](../../seed-templates/70%20Learning/templates/mathematics-cheatsheet.template.tex), [preamble](../../seed-templates/70%20Learning/templates/mathematics-cheatsheet-preamble.template.tex), [vector logo](../../seed-templates/70%20Learning/templates/chatgpt-logo.template.tex), and [compiled PDF](mathematics-cheatsheet.pdf).

Build:

```sh
PATH=/Library/TeX/texbin:$PATH npm run templates:check
```

A4 portrait; exactly two pages; four columns; color with a grayscale print mode. Geometry: 1.8 mm side margins, 4.0 mm body top margin, 5.47 mm reserved body bottom margin, 0.6 mm column gaps, and a 1.6 mm footer baseline. Header/footer remain 4 pt. Body uses Latin Modern 4 pt with 4.1 pt leading. `\DeclareMathSizes{4}{4}{3}{2.4}` sets native math. The scalable `lmex10` override fixes Latin Modern's default fixed 10 pt extension font. No `\resizebox`, `\scalebox`, font stretching, or operator substitution.

Navy section bands and pale blue topic bands organize the page. Source locators use ruled
rows. Whole statements, worked reasoning and cautions use dark teal, plum and rust inks on
white paper. Labels, underlines and boxes keep the same roles in grayscale. The layout
interface records the palette, contrast check and monochrome setup.

Primary API:

- `\SheetSetup{title=...,credit=...,disclaimer=...,publisher=...,logo=...}`
- `\MajorBlock{ID}{title}`, `\SourceBlock{ID}{title}`, `\Topic{title}`
- `\Statement{kind}{number}{text}`; `\FormalStatement{kind}{number}{source-id}{title}{body}`
- `\Assumption{body}`, `\Proof{body}`, `\Example{number}{body}`
- `\Question{number}{source-id}{setup}`
- `\QuestionPart{part}{concept}{source-id}{question}{solution}`
- `\Worked{source+part}{concept}{question}{solution}`
- `\Method{text}`, `\Conclusion{text}`, `\Result{text}`
- `\Alternative{method}{body}`, `\Caution{body}`, `\Continuation{ID}`
- `\SourceRef{ID}`, `\ConceptRef{label}`, `\Identity{name}{math}`, `\CompactTable{tabular}`

`\DisplayStatementKind` and `\DisplayQuestionID` are identity hooks in the generic preamble. A module can override their display locally—for example, `\renewcommand{\DisplayQuestionID}[1]{Problem~#1}`—without putting module-specific label mappings in the public seed.

Long content macros remain breakable. Exact uppercase `\Needspace` was replaced by the approximate lowercase `\needspace`, whose penalty/glue implementation is safe in this multipage `multicols` specimen; final flow is also visually audited for stranded headings. The specimen deliberately demonstrates a question continuation across a column/page boundary.

Logo provenance: `chatgpt-logo.tex` transcribes the single path from `OpenAI-black-monoblossom.svg` in the official [OpenAI logo archive](https://cdn.openai.com/brand/OpenAI-Logos-2025.zip), linked from [OpenAI Design Guidelines](https://openai.com/brand/). It preserves the supplied path/aspect ratio and renders through TikZ `svg.path`; no binary logo dependency. OpenAI owns the mark. The preinserted credit is attribution, not review evidence; no GPT-6 Astra Pro review is claimed.

## Verification

- [Compiled color specimen](mathematics-cheatsheet.pdf) SHA-256 `106891f90c0b255877484e1a94e648dfdf1cc2117dc638acafb6637ccb0f3ea6`.
- The two-page, four-column A4 specimen retained the same extracted word count on each page and
  all eight column starts. The largest change at a body-column bottom was 1.34 pt.
- Inspected both pages in color and grayscale. The compiled print fixture checks 9:1 contrast for
  body passages and navigation bands in both modes.
- [Earlier visual review](visual-review.md) and [mathematical review](mathematics-review.md)
  document the previous specimen revision.
