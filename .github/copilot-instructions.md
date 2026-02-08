# Copilot Instructions — MCP Orchestrator

**Package:** `@ask149/mcp-orchestrator` v1.1.2
**Purpose:** MCP server for spawning parallel CLI sub-agents (Copilot/Claude CLI)

**For full architecture:** Read [README.md](../README.md)

## Key Rules

- **stdout is reserved** for MCP protocol — all logging via `console.error` (stderr)
- Cross-platform: use `os.tmpdir()`, `path.join()`, `shell: true` on Windows
- Version must be synced in `package.json` AND `src/index.ts`
- Run `npm test` before commits
- Use conventional commits: `feat:`, `fix:`, `chore:`, `docs:`
