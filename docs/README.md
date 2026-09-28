# Documentation

Documentation has its own source area, separate from the editor and player.

- [Agent instructions](../AGENTS.md): repository-wide rules loaded by coding agents.
- [Coding standard](engineering/coding-standards.md): clean code, SOLID, file ownership, and verification.
- [Architecture](engineering/architecture.md): current folders, ownership and dependency direction.
- [Code audit](engineering/code-audit.md): current structure, measured hotspots, and ordered improvements.
- [Format specification](../SPEC.md): canonical PVO format note.
- [PVO language](language/README.md): Structure, Style and Logic authoring grammar and runtime boundary.
- [Rust compiler ownership](../packages/pvo-language/README.md): native modules, browser bindings and package checks.
- [Build and verification](../scripts/README.md): tooling folders, npm commands and browser prerequisites.
- [SDK reference](../packages/pvo-sdk/README.md): public package API.
- [Editor guide](../editor/README.md): authoring behavior and development commands.
- [Creative no-code plan](product/no-code-experience.md): proposed visual controls, ownership, release scope and acceptance criteria.
- [Claude no-code design brief](product/claude-no-code-design-brief.md): ready-to-use prompt for the phone interaction prototype.

The documentation website lives in `site/` and is built to `/docs/`. Run `npm run dev` from the repository root and open [the local documentation site](http://127.0.0.1:4173/docs/). The root route serves the demo landing page; `/editor/` and `/player/` remain separate applications.

Keep format facts in `SPEC.md`, package API details with the package, and engineering guidance here. Link to the owning document rather than maintaining duplicate specifications.
