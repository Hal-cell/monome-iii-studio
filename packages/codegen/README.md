# @monome-iii-studio/codegen

Pure-TypeScript compiler from a `GridLayout` configuration to an iii Lua script.

This package has **zero browser dependencies**. It is consumed by:
- `apps/web` — the SolidJS UI
- (later) a Node CLI for batch-compiling layout JSON files
- (later) tests, including golden-file regression in `tests/golden/`

Why it's a separate package: keeping the emitter free of UI concerns means it can be tested as a pure function (input → output), and the emitter is the most output-stability-critical part of the project (see vault `notes/engineering-kickoff.md`, "Project-specific addenda").

See the vault for design:
- `~/Documents/TestVault/10-projects/monome-iii-studio/spec/v0-design.md`
- `~/Documents/TestVault/10-projects/monome-iii-studio/docs-reference/grid-recipes-taxonomy.md`
