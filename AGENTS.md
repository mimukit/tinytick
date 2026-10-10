# AGENTS.md

## Project

tinytick is a TickTick extension for the [Tinycast](https://github.com/abue-ammar/tinycast) launcher. It talks to the TickTick web API directly and needs no TickTick desktop app. It is a Raycast-format extension: a `package.json` manifest plus one CommonJS bundle per command, with `react`, `react/jsx-runtime` and `@raycast/api` left external. Stack: TypeScript, React, esbuild, Vitest, chrono-node. Package manager: pnpm.

## Build and test

- `pnpm install`
- `pnpm typecheck`, `pnpm test`
- `pnpm build` writes `dist/`
- `pnpm build:install` builds and copies `dist/` into Tinycast's extensions folder (macOS only)
- `pnpm smoke <tinycast-checkout>` runs the built bundles in Tinycast's JS runtime against a fake TickTick server. Run it after `pnpm build` when you change a command or a component.

## Rules for agents

- Do not add the Raycast CLI (`ray`) or `@raycast/utils`. The build is `scripts/build.mjs`.
- Keep `src/parse/`, `src/views/`, `src/undo/` and `src/api/` free of `@raycast/api` imports, so Vitest can run them in Node.
- Never store a secret in a preference, `LocalStorage` or `Cache`. Tinycast keeps those as plaintext JSON. Secrets go through `src/auth/secrets.ts` to the Keychain.
- Every `/api/v2` call must sit behind the `enableV2` preference.
- Keep each command bundle under 300 KB. `pnpm build` prints the sizes.
- Use pnpm only. Do not commit a lockfile from another package manager.

## Docs artifact naming

- An artifact under `docs/<type>/` (a plan, a QA plan, a review, research) is named `NNNN-<type>-<slug>-YYYY-MM-DD.md`.
- `NNNN` is a four-digit serial, per directory, assigned in creation order and never reused. To get it, list the directory, take the highest serial, and add one. An empty directory starts at `0001`.
- `YYYY-MM-DD` is the creation date. The whole name stays fixed after edits.
