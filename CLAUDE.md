# Instructions for Claude Code

Read and follow [AGENTS.md](AGENTS.md), including the coding standards, ownership rules, checks, and release workflow it links. More specific directory instructions also apply.

For Restyle cloud agent work, start with:

1. [Current progress and exact next task](docs/engineering/restyle-cloud-agent-progress.md).
2. [Handoff and restart instructions](docs/engineering/restyle-cloud-agent-handoff.md).
3. [Roadmap overview](docs/engineering/restyle-cloud-agent-roadmap.md) and the numbered checklist for the current milestone.

After each verified task, mark its checkbox complete and update the progress file with evidence and the next action. Save partial progress before stopping. Never mark a task complete from generated code, a mock, or a chat claim when its acceptance check requires a real integration or browser test.

Use the repository files and actual Git/provider state as your evidence. The previous Codex chat and Codex-specific tools are not required. Check the working directory first: the handoff records a separate implementation worktree and a Desktop checkout with pending generated output.
