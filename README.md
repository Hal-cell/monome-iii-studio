# monome-iii-studio

A visual configurator that compiles monome Grid button layouts into [iii](https://monome.org/docs/iii/) Lua scripts. Built with SolidJS + Vite. Phase 2 wraps the same web app with Tauri for desktop.

> **Project knowledge base / design docs / decisions** live in the Obsidian vault, not here:
>
> `~/Documents/TestVault/10-projects/monome-iii-studio/`

This repository holds **only code**. Documentation that describes *why* things are designed a certain way is in the vault README, spec, and `docs-reference/` notes there. When you're not sure why something is built a particular way, the answer is in the vault.

## Layout

```
monome-iii-studio/
├── apps/
│   └── web/         # SolidJS + Vite + Tailwind front-end
└── packages/
    └── codegen/     # Pure TypeScript Lua emitter (zero browser deps)
```

## Develop

```bash
pnpm install           # install all workspace deps
pnpm dev               # start the web app on http://localhost:5173
pnpm test              # run all tests in all packages
pnpm typecheck         # type-check everything
pnpm build             # build everything
```

## Engineering protocol

This project follows the engineering kickoff protocol documented in the vault:
`~/Documents/TestVault/10-projects/monome-iii-studio/notes/engineering-kickoff.md`

Briefly: think before acting, plan before executing, push back when a request is wrong or under-specified, use real tools over guessing.
