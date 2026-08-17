#!/usr/bin/env bash
# PROTOTYPE (throwaway) — compile the four style candidates and place the user-facing PDFs
# beside their source (build/ holds aux output, per MF-LATEX-001).
set -euo pipefail
cd "$(dirname "$0")/70 Learning/10 Lectures/Week 03"
for s in a b c d; do
  latexmk -pdf -interaction=nonstopmode -halt-on-error -outdir=build "walkthrough-style-$s.tex"
done
cp "build/walkthrough-style-a.pdf" "Walkthrough Partial Derivatives (Style A).pdf"
cp "build/walkthrough-style-b.pdf" "Walkthrough Partial Derivatives (Style B).pdf"
cp "build/walkthrough-style-c.pdf" "Walkthrough Partial Derivatives (Style C).pdf"
cp "build/walkthrough-style-d.pdf" "Walkthrough Partial Derivatives (Style D).pdf"
echo "Four candidates compiled."
