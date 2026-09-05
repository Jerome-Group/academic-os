# Mathematics cheatsheet seed example

This course-neutral specimen exercises the reusable Academic OS interface without course content. Durable artifacts: [filled seed source](../../seed-templates/70%20Learning/templates/mathematics-cheatsheet.template.tex), [preamble](../../seed-templates/70%20Learning/templates/mathematics-cheatsheet-preamble.template.tex), [vector logo](../../seed-templates/70%20Learning/templates/chatgpt-logo.template.tex), and [compiled PDF](mathematics-cheatsheet.pdf).

Build:

```sh
PATH=/Library/TeX/texbin:$PATH npm run templates:check
```

A4 portrait; exactly two pages; four columns; black and white. Geometry: 1.8 mm side margins, 4.0 mm body top margin, 5.47 mm reserved body bottom margin, 0.6 mm column gaps, and a 1.6 mm footer baseline. Header/footer remain 4 pt. Body uses Latin Modern 4 pt with 3.78 pt leading. `\DeclareMathSizes{4}{4}{3}{2.4}` sets native math. The scalable `lmex10` override fixes Latin Modern's default fixed 10 pt extension font. No `\resizebox`, `\scalebox`, font stretching, or operator substitution.

Navigation has three levels: `\MajorBlock` black bands; `\SourceBlock` compact ruled locator rows; `\Topic` local topic rules. Question IDs use a small outline marker and bold sans text; concepts are bold sans; formal labels and `Sol.` are underlined. `\Method`, `\Conclusion`, and `\Result` selectively emphasize pivots and results without changing font size.

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

## Verification (2026-09-06)

- Reviewed [compiled artifact](mathematics-cheatsheet.pdf): SHA-256 `2b6c204ec0a2d8dc3441ad33bf508069f95fc663428a0d065d1b6595950f191b`.
- Two A4 pages (`595.276 x 841.89 pt`); no overfull boxes.
- Build diagnostics: extension fonts 4.0/3.0/2.4 pt. Every font embedded/subset; no raster images.
- Independent 600 dpi thresholded all-ink clearance is about 1.736 mm left, 1.693 mm top, at least 1.736 mm right and 1.312 mm bottom. These measured bounds are not a printer guarantee.
- `pdftotext mathematics-cheatsheet.pdf - | wc -w`: 11,152 extracted words. This is only a rough density comparator, not information capacity.
- Full-page and dense 600 dpi review evidence is recorded in [visual-review.md](visual-review.md); mathematical review is recorded in [mathematics-review.md](mathematics-review.md).
