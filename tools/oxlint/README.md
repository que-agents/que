# Vendored oxlint rules

`anti-slop/` is the oxlint JS plugin from https://github.com/dmmulroy/anti-slop (MIT, see
`anti-slop/LICENSE`), copied at commit `13909c9e07590f5a85d93c62712259fe14a883f7`: its `src/`
without the tests and without the `effect/` rules. `.oxlintrc.json` loads it as `anti-slop`.

Why a copy and not a dependency: upstream says so. Its README: "This project is meant to be
vendored, not treated as a fixed npm dependency. There is no official npm package. Copy the rules
into your repository, read them, and change them to match your team's standards." Its
`package.json` is `private: true`, and the layout here (`tools/oxlint/anti-slop/`, the `jsPlugins`
entry) is the one its README prescribes. The `eslint-plugin-anti-slop` package on npm is an
unrelated project by another author (React UI rules such as `no-gradient-text`).

To update: copy the new upstream `src/` over this directory (same exclusions) and change the commit
above, so the diff is reviewed like any other change.

Tiers in `.oxlintrc.json`: `error` for the rules with no or few hits; `warn` for the type-boundary
rules (`no-runtime-typeof`, `no-unsafe-dictionary-type`, `no-unknown-parameters`,
`no-known-value-widening`), switched off in the files that parse external data (config, protocol,
store, server, preload, test and script code); `off` for `require-safety-comment-for-type-assertion`.
