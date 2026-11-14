# Token Radar v3 — peer-benchmark valuation

A token launch radar for make.fun's `token-radar-01` bounty. It ranks every
pre-token protocol the snapshot can rank (198 rows, including all 40 of the
watchlist) by an implied value priced against the protocol's own category.

## The model (radar-3-peer-benchmark)

1. **Peer multiple.** For each category, the median market-cap-to-TVL
   multiple of its traded tokens (positive market cap, CEX tokens excluded).
2. **Cross-category calibration.** Each category median is shrunk toward the
   whole market's median in log space, with weight `n / (n + 4)` on the
   category's own median. Categories with few or no traded peers fall back
   most of the way to the market median, so one outlier never sets a price.
3. **Peer-size factor.** The protocol's TVL against the median TVL of its
   category's pre-token set, in logs and clamped: leaders earn a small
   premium, sub-scale protocols a small discount.
4. **Growth and maturity.** The seven-day TVL change (clamped, half-weighted)
   and how long the protocol has run with no token (capped at three years).

`implied = TVL x calibrated multiple x size x growth x maturity`

Every number is recomputed from the sealed snapshot at run time. No protocol
name is special-cased. The dashboard's Peers view shows the full calibration
table; each detail view shows the protocol's traded peers side by side with
its own implied multiple.

## Layout

- `main.ts` — entrypoint: reads the snapshot, writes `board.json`, `data.js`,
  `dashboard/benchmarks.js`, copies `dashboard/` and `screenshots/`, and
  writes `dossier.json` with the vendored library.
- `lib/model.ts` — the model, the farm-plan generator, and the gate checks.
- `dashboard/` — the static page (no network, no framework).
- `screenshots/` — the board, a detail view, the peers view, and a filtered
  view, captured from this entry's own output.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied byte for
  byte from the kit.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Then open `out/dashboard/index.html` in a browser. The program is
deterministic: two runs write the same bytes.
