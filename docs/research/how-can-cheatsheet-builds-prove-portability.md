# How can a cheatsheet build prove portability?

A successful rebuild in a temporary directory can still read host files. Academic OS therefore compiles with controlled settings, then checks the actual input recorder before claiming an isolated build.

The [latexmk manual](https://tug.ctan.org/support/latexmk/latexmk.pdf) documents `-norc` for disabling automatic initialization files, `-bibtex-` for disabling bibliography processors, and `-recorder` for recording compiler inputs. These settings keep host configuration and external bibliography generation out of the single-source release check.

[Web2c](https://tug.org/texinfohtml/web2c.html) documents restricted input/output names and disabling shell escape. The verifier also supplies a private TeX home/config/cache and a small process environment, so caller search paths and Perl configuration do not enter the build.

[Kpathsea](https://tug.org/texinfohtml/kpathsea.html) and the [TeX Live guide](https://tug.org/texlive/doc/texlive-en/texlive-en.html) define distribution, system configuration and generated resource trees. Debian also supplies a [distribution package tree](https://sources.debian.org/patches/texlive-base/2024.20250309-1/debian-texmfcnf.lua/) named `TEXMFDEBIAN`. The verifier asks the installed toolchain for those roots and active system `texmf.cnf` files, then compares canonical recorded input paths with them and its owned build workspace. Personal and site-local add-on trees are outside that allowance.

The installed TeX distribution and executables remain trusted. Compilation, dependency confinement and matching PDF text/renders establish bounded release evidence; mathematical accuracy and visual quality still require review.
