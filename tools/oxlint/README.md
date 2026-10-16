# Vendored oxlint rules

`anti-slop/` is the oxlint JS plugin from https://github.com/dmmulroy/anti-slop (MIT, see
`anti-slop/LICENSE`), copied at commit `13909c9e07590f5a85d93c62712259fe14a883f7`: its `src/`
without the tests and without the `effect/` rules. `.oxlintrc.json` loads it as `anti-slop`.

To update: copy the new upstream `src/` over this directory (same exclusions) and change the commit
above. Never an npm bump; the plugin is not published and we want the diff in review.

Tiers in `.oxlintrc.json`: `error` for the rules with no or few hits; `warn` for the type-boundary
rules (`no-runtime-typeof`, `no-unsafe-dictionary-type`, `no-unknown-parameters`,
`no-known-value-widening`), switched off in the files that parse external data (config, protocol,
store, server, preload, test and script code); `off` for `require-safety-comment-for-type-assertion`.
