# The mathematics cheatsheet is a separate versioned artifact type

The Teaching workspace gains `mathematics-cheatsheet.tex`, its own
`mathematics-cheatsheet-preamble.tex`, and a portable `chatgpt-logo.tex`. The filled type is an
original generic specimen for dense results, proofs and solved questions. `reference-sheet.tex`
remains the formulas-and-conditions type, and all six existing artifact types keep their shared
`preamble.tex` and existing appearance.

## Why the type is separate

A solved-question sheet needs multipart question structure, per-part source and concept tags,
proofs, alternatives, warnings, tables, cases, derivations and diagrams. Adding that surface to the
reference sheet would make two different artifacts share one ambiguous interface. A separate type
lets an author select the needed semantics directly and keeps ordinary teaching artifacts stable.

The cheatsheet preamble fixes its own compact monochrome A4 system. Body-like roles use 4 pt type
with 3.78 pt leading; mathematics uses native 4/3/2.4 pt fonts with a scalable Latin Modern
extension shape. The specimen uses four columns, 0.6 mm gutters, nominal 1.8 mm side margins, a
4 mm body top margin, a 5.47 mm reserved body bottom margin and a 1.6 mm footer baseline.
Independent 600 dpi raster measurement found minimum all-ink clearance of about 1.31 mm. That
measurement is evidence about the specimen, not a printer guarantee.

The local logo source transcribes the OpenAI black monoblossom vector path from the official 2025
logo archive linked by OpenAI's Design Guidelines. Keeping the vector in TeX makes the seeded set
self-contained and reproducible without a network or binary asset.

## Why this is contract version 5

MF-LEARNING-001 now requires eleven names instead of eight. A version-4 module can therefore be
missing three files the current interface requires. Audit reports that older Definition as needing
a transition; it does not silently call the module version-5 conformant. Transition installs the
new seed files through the existing Owner-approved procedure and moves the Definition version last.

The `.tex` bodies remain module-editable by name. `preferences.md` remains the only pinned file in
the directory. Coursework, source quotations and personal paths stay in module folders; the public
specimen contains original generic mathematics only.
