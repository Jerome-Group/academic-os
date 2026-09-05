# Independent mathematical review

Reviewer: GPT-6 Astra, Medium.

Reviewed `mathematics-cheatsheet.tex`: original generic source blocks FND-A, ALG-B, CAL-C, ANA-D, PRB-E, PRB-E2, DSP-F, ABS-G, MIX-H and MIX-I, including defined corpus/extra macros. Mathematical review only; layout remains separately owned. No imported course content or private source material is needed for this report.

Verdict: revise before treating the prototype as a mathematically reliable reference. Most explicit worked calculations are correct, but several theorem statements omit essential assumptions or overstate conclusions.

## Required corrections

1. **PRB-E, Theorem14A (`CorpusProbability`): replace the theorem with a method.** A stopping time and nonnegative integer-valued increments do not imply a closed first-step recurrence in the displayed state. Such a recurrence requires sufficient state information, typically a Markov/restart property. Suggested wording: “For a Markov model, condition on the first transition; include boundary data and prove uniqueness (or identify the minimal nonnegative solution).” Nonnegative increments are irrelevant and even inconsistent with the adjacent nearest-neighbour walk example.

2. **PRB-E optional-stopping caution:** “bounded martingale increments with integrability” is ambiguous and unsafe. State the precise sufficient condition `E[T]<∞` together with a deterministic bound on increments, or uniform integrability of the stopped martingale. Integrability of each level alone does not suffice. The later MIX-I bounded-stopping theorem is correct.

3. **MIX-I W12 gambler's ruin:** add integer `N≥1`, independent symmetric steps, and justify `T<∞` almost surely. In each block of N steps, probability at least `2^{-N}` of reaching a boundary gives `P(T>kN)≤(1−2^{-N})^k→0`. Apply bounded stopping to `T∧n`, then dominated convergence because stopped positions lie in[0,N]. Merely saying the stopped position is bounded skips the existence of the terminal position and limiting argument.

4. **ANA-D Theorem13A contraction:** require **nonempty** complete X and `0≤q<1`, and specify convergence from every starting point. The empty complete space has no fixed point. The existing geometric proof then works.

5. **ANA-D Theorem13B extreme values and Theorem13C consequence:** extreme-value attainment needs a nonempty compact domain. Baire's “cannot be a countable union” consequence needs a nonempty complete space. Also scope nested-compact intersection to a metric/Hausdorff space (compact subsets need not be closed in arbitrary spaces). These are missing hypotheses, not just stylistic preferences.

6. **ALG-B inner-product formulas/table:** declare the complex inner product linear in its first argument; the projection coefficient and Gram–Schmidt formulas use that convention. State real symmetric matrices for `QΛQ^T`, complex normal matrices for `UΛU*`, and real symmetric positive-definite matrices for `LL^T`. Over C use Hermitian positive definite and `LL*`. “Positive definite” alone does not justify the displayed real Cholesky form. Likewise least-squares normal equations with transpose are for real matrices; use adjoints over C.

7. **ABS-G rings:** move “commutative ring with identity” before **both** quotient claims and require proper ideals. A maximal two-sided ideal of a noncommutative ring can give a simple matrix ring, not a field. Suggested: “For a commutative unital ring R, proper maximal ideals correspond to field quotients and proper prime ideals to integral-domain quotients.” Specify nonconstant p for the F[x]/(p) field criterion and modulus n≥2 for modular units.

8. **MIX-I duality:** “strong duality needs [convexity]” is false as a necessity claim. Nonconvex problems can have zero gap. Replace with “Convexity plus a qualification such as Slater gives standard sufficient conditions for strong duality; weak duality requires neither.” For differentiable KKT formulas assume the constraints g_i are differentiable too.

9. **MIX-I Cauchy formula:** explicitly require a strictly inside γ and integer n≥0, γ positively oriented piecewise smooth simple closed, f holomorphic on an open neighbourhood of the curve and enclosed region. Without the location of a the displayed formula is false. W13's positive orientation is currently only introduced in the solution; add it to the problem/setup.

10. **MIX-I maximum principle:** boundary attainment needs a real harmonic function continuous on the closure of a bounded domain; otherwise a boundary value need not exist or be attained. State `u∈C²(D)∩C(closure D)`, D bounded connected. The strong interior maximum principle is a different statement and can be given separately.

11. **PRB-E entropy (`ExtraProbability`):** restrict the displayed entropy-difference identities to finite alphabets, or explicitly require finite relevant entropies. On countable alphabets `H(X)−H(X|Y)` may be∞−∞ even though relative-entropy mutual information is defined. Gibbs proof must sum over p(x)>0, treat q(x)=0<p(x) as D=∞, and use `sum_{p>0}q(x)≤1`; it cannot silently write that sum as1. Equality is p=q as distributions. A finite-alphabet setup is the cleanest repair.

12. **PRB-E statistics likelihood:** product likelihood requires independent observations (iid if all factors share the same fθ). With dependence the likelihood is the joint density, not a product of marginals. Exponential MLE also assumes n≥1 and sum x_i>0; a zero-sum data vector has no finite rate MLE (a probability-zero boundary under the model).

13. **PRB-E Definition14/16 and identities:** define P as a nonnegative measure with values in[0,1]; countable additivity and normalization alone also permit signed measures. Bayes needs P(A)>0, besides positive partition probabilities. Conditional-expectation definition/rules need `X∈L¹` and G a sub-sigma-algebra. State finite sums and finite second moments for the displayed variance formula; integrability alone does not justify arbitrary infinite-sum interchange.

14. **DSP-F Hall/tree statements:** explicitly finite bipartite graph in Hall's theorem; the cardinality criterion as written does not prove the general infinite version. A counterexample has left vertices0,1,2,…, right vertices1,2,…, N(0)=all right vertices and N(i)={i} for i≥1: every cardinal Hall inequality holds but no saturating matching exists. Tree equivalences require at least one vertex, and the proof's leaf assertion requires at least two vertices (handle the singleton base).

15. **DSP-F Dijkstra invariant:** unreached vertices have label∞, not the length of a discovered path. Say “every finite tentative label is a discovered path length.” Replace “visited vertex” by “settled vertex”; mere discovery does not finalize distance. State finite graph/nonnegative weights and the heap model for the stated complexity.

16. **CAL-C/ANA-D interchange and differential estimates:** state a compact interval and appropriate differentiability/integrability before integration/derivative interchange. A safe derivative theorem is f_n∈C¹([a,b]), convergence at one x0, uniform convergence of f_n′. For central difference O(h²), assume bounded third derivative near x; for Newton quadratic convergence assume sufficient smoothness (e.g.C²) and simple root. Taylor's statement should say f∈C^{n+1} on an interval containing a,x, or give the weaker precise endpoint/interior version. Green/Stokes/divergence formulas also need C¹ fields and suitable piecewise smooth oriented domains/surfaces; orientation alone is insufficient.

17. **MIX-H Fourier block:** least-squares/Bessel discussion needs real f∈L², not merely integrable. If complex f is intended, replace coefficient squares by absolute squares and state the corresponding complex basis convention. Both `PageOneCapacity` and `PageOneCapacityShort` contain this issue. In the short Young inequality also restore a,b≥0 and p,q>1.

18. **ABS-G multivariable Hessian test:** require f∈C² near a (or a valid second-order Taylor expansion), not merely existence of second partial derivatives at a. Burnside formula needs finite G and finite X. Character traces and character-orthogonality discussion need finite-dimensional complex representations.

## Further precision repairs

- FND-A W1: every class has **exactly one** representative in[0,1); remove “uniquely except that1 is replaced by0”. Prove fractional-part map invariance under integer translation and uniqueness of representatives differing by an integer in(−1,1).
- ALG-B basis-extension proof uses “dimension bounds termination” before dimension is defined in its own theorem. Cite the exchange lemma: any independent list has length at most a fixed finite spanning list; then derive equal basis lengths.
- DSP-F generic recurrence root recipe should assume a genuine order-k recurrence with c_k≠0; zero characteristic roots need separate transient treatment. State n,k and binomial zero conventions in stars-and-bars/Vandermonde/surjection formulas, especially positive solutions when n<k.
- PRB-E2 distribution table: state n nonnegative integer, p∈[0,1] (geometric p>0), λ>0, σ²>0 for nondegenerate normal. Hoeffding's displayed denominator assumes a<b; a=b is deterministic. Beta prior requires a,b>0 and conditionally independent Bernoulli trials; posterior-mean-as-weighted-average language assumes at least one observation when using sample proportion.
- MIX-I heat stability: specify κ>0 and 0≤r≤1/2 for the standard one-dimensional grid/boundary setting. The logarithm-branch caution gives a sufficient simply connected cut domain, not a necessary condition for every possible branch.
- Theorem16C Neyman–Pearson can retain concise wording but should mention randomization on the likelihood-ratio boundary when an exact specified size is required.

## Worked checks that pass

Verified the explicit arithmetic and proof mechanisms for: rank-nullity kernel/image; projection; nilpotent Jordan partition3+1; CRT solution23 mod105; congruence solutions7,22 mod30; Taylor exponential bound; parameter integral log(a+1); Newton values17/12 and577/408; finite-net uniform convergence including L=0; fixed-interval point; device posterior5/8; stationary law(.6,.4); weak-law variance; bounded composition count10; resonant recurrence n²2^{n−1}; square-rotation Burnside polynomial; implicit derivative−1; KKT minimizer(1/2,1/2); residue value2πi(e−1); and the absolute-value case split after intersecting x≥−1. The Newton wording “squaring brackets” should identify the lower bound explicitly (both iterates displayed are upper bounds).

The review does not certify repairs not yet applied. Recheck these statement edits after integration; mathematical correctness and page fitting are separate checks.


## Repair recheck, 6 September 2026

Re-read the repaired generic source after the author's ready notification. All18 substantive correction groups are now addressed in the mathematical content: first-step method, optional-stopping regimes and gambler stopping proof, contraction/nonempty compact/Baire assumptions, matrix conventions, commutative quotient conditions, duality wording, Cauchy and boundary maximum hypotheses, finite entropy/support proof, independent likelihood, finite-moment formulas, finite Hall/tree/Dijkstra statements, interchange regularity, real L² Fourier assumptions, and finite representation/Burnside/Hessian scopes. The displayed revised computations remain correct.

One integration regression remains before sign-off: PRB-E Definition14 added the correct nonnegative range for P but dropped the existing requirement that F be a sigma-algebra on Omega. Restore that clause. Three short precision repairs were also sent: integer N in W12; epsilon>0 in Q6 weak law; restore “additive subgroup” in the ideal definition. These are the only remaining concrete findings from the bounded recheck. This paragraph supersedes the earlier pending status for the18 groups except that Definition14 regression; it does not certify final layout or later edits.


## Lead closure of the final four findings

GPT-6 Astra, High, independently checked the corrected source after the final bounded repair: Definition 14 again requires F to be a sigma-algebra on Omega while retaining P:F→[0,1]; W12 states integer N≥1; Q6 explicitly assumes epsilon>0; the ideal definition states additive subgroup. All four remaining findings are resolved. Combined with the independent Medium recheck above, no substantive mathematical finding remains open in this specimen. This is session review evidence, not the separately pending Owner-arranged Pro review.

## Integration semantic recheck

GPT-6 Astra, Medium, re-audited the canonical seed after integration corrections. The degree-sum
statement remains Theorem 17; its existing parity consequence is now the explicit numbered
Corollary 17.1. Reducing the degree sum modulo 2 counts the odd-degree vertices, while `2|E|` is
even, so the reclassification introduces no new claim. The Q8(b) continuation now matches Q8.
The semantic inventory includes numbered definitions, theorems, Lemma 3A and Corollary 17.1,
together with the requested sources, topics, proofs, questions, multipart solutions, alternatives,
cautions, references, tables, cases, matrices, derivations, diagrams and continuations. No requested
semantic object remains absent.
