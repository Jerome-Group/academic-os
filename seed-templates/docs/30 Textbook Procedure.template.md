# Textbook Procedure

"Get me chapter 3 of Rosen", in the MODULE_CODE folder: one division of a book on the Textbook
shelf becomes a PDF in `10 Learning Materials/20 Textbook Chapters/` and an entry in
`00 Module Admin/50 Textbook Register.yaml`.

## The shelf and its index

Whole books live on the **Textbook shelf** — the `Textbooks` folder beside the semester roots —
where the Owner put them. Books arrive by the Owner's hand alone; a request against a book that is
not on the shelf parks, naming what to obtain.

`00 Index.yaml` on the shelf is the catalogue, one entry per book under its **Book key**:

```yaml
books:
  Rosen:
    file: Discrete Mathematics and Its Applications 8e Rosen.pdf
    title: Discrete Mathematics and Its Applications
    edition: 8e
    authors: [Rosen]
    division: Chapter
    sha256: <sha-256 of the PDF bytes>
```

The index owns every book-level fact, and nothing below it repeats one. `division` is the book's
own word for how it divides itself — Chapter, Lecture, Part. A key is the first author's surname by
default, qualified by the Owner where two books would collide (`Isaacs_FGT`, `Tao_I`), and
immutable once any chapter filename cites it. The shelf's `Archive/` holds retired books and stays
outside the index.

## The chain

Five steps, in order. A step that cannot complete parks the request where it stands.

1. **Resolve the Book key in the Shelf index.** The request names a book; the index turns that into
   a key, a filename and a Division word. Resolution is a lookup — a filename is never parsed to
   find a book.
2. **Verify the checksum.** Compute the sha-256 of the file on the shelf and compare it against the
   entry's. Equal, the cut proceeds. Different, the copy on the shelf is not the book the index
   describes: park it, because the index is the Owner's to correct.
3. **Cut whole pages by absolute page range.** Read the book's own table of contents for where the
   division starts and ends, then take those absolute PDF pages, inclusive. Overflow onto a
   neighbouring division's first or last page is fine; every page comes across whole.
4. **Name it.** `MODULE_CODE_<Key>_<Division>_<NN>_<Title>.pdf`, into
   `10 Learning Materials/20 Textbook Chapters/`:

   ```text
   MODULE_CODE_Rosen_Chapter_03_Algorithms.pdf
   MODULE_CODE_Tao_I_Chapter_05_The_Real_Numbers.pdf
   MODULE_CODE_Rosen_Appendix_A_Axioms_For_The_Real_Numbers.pdf
   ```

   The Division word comes from the index, in full. Numbers are zero-padded arabic even where the
   book prints roman, and appendix letters stay as printed. Titles are the book's own
   table-of-contents titles, Title_Cased, and may be shortened here because the register keeps the
   full one. The edition stays out of the filename — the key resolves it.
5. **Record the cut.** Append to `00 Module Admin/50 Textbook Register.yaml`:

   ```yaml
   extractions:
     - book: Rosen              # the key, into the Shelf index
       number: 3                # as the book prints it; roman recorded verbatim
       title: Algorithms        # the full table-of-contents title
       pages: [187, 244]        # absolute PDF pages, inclusive
       file: MODULE_CODE_Rosen_Chapter_03_Algorithms.pdf
       source_sha256: <the book's checksum at cut time>
   ```

   `source_sha256` is what later makes a chapter cut from a superseded copy of the book findable:
   compare it against the index's current checksum.

## Requirements, not tools

Step 3 pins an outcome, and any means that reaches it is the right one on the machine you are on:
the pages that come out are the pages that went in — same count as the range, each one whole and
lossless, at the source's own resolution.

On a machine that offers no such means, step 3 is a step that cannot complete: say so, and let it
park with the book, the range and the intended name recorded, so the next capable session finishes
it.

## The three parks

To park is to leave the shelf and the module folder untouched and surface the request, naming the
book and what stopped it.

- **The book has no entry in the Shelf index.** Absent from the shelf, or sitting there unindexed:
  either way the cut has no key, checksum or Division word to work from. Park, naming the book to
  obtain or the entry the index still owes. Renaming or removing an entry is the Owner's.
- **The request names no division the book prints.** A bare page range, a topic, a subsection, a
  number the book's own contents do not carry — there is nothing to record, so there is nothing to
  cut.
- **Anything ambiguous.** A checksum that disagrees with the index, two candidate ranges for one
  division, a title the contents give two ways, a key that would collide with one already cited. A
  guessed chapter is a chapter no later reader can trace back to its pages.
