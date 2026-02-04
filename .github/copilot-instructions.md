# Copilot Instructions — MCP Orchestrator

**At task start, read:** This file provides context for the MCP Orchestrator project.

---

## Project Overview

**Package:** `@ask149/mcp-orchestrator`  
**Version:** 1.0.1  
**Purpose:** MCP server for spawning parallel CLI sub-agents (Copilot CLI / Claude CLI)

### Key Principles

1. **Stdio-first** — No HTTP/SSE, uses MCP's StdioServerTransport
2. **Zero external dependencies** — No Redis, databases, or external services
3. **File-based simplicity** — JSON configs, JSONL logs
4. **Cross-platform** — Windows/macOS/Linux with no Unix-only code
5. **Secure-by-default** — Permissions disabled unless explicitly enabled

---

## Architecture

```
src/
├── index.ts      # MCP server entry point (StdioServerTransport)
├── spawn.ts      # Sub-agent spawning with cross-platform support
├── backends.ts   # CLI backend abstraction (Copilot, Claude)
├── context.ts    # File context handling (full/summary/grep modes)
├── types.ts      # TypeScript interfaces and timeout configs
├── logger.ts     # Structured logging with rotation
└── health.ts     # Health check CLI
```

---

## Key Design Decisions

### Cross-Platform (Windows x64/ARM64 + macOS + Linux)

| Area | Implementation |
|------|----------------|
| Config paths | `os.homedir()` + platform check (`~/.config` vs `%LOCALAPPDATA%`) |
| Temp files | `os.tmpdir()` (no hardcoded `/tmp`) |
| CLI spawn | `shell: true` on Windows for `.cmd` resolution |
| Grep | Pure Node implementation (no `execSync('grep')`) |
| Signals | `SIGTERM`/`SIGINT` + Windows IPC message handling |

### Secure-by-Default

| Setting | Default | Opt-in |
|---------|---------|--------|
| `allowAllTools` | `false` | Set `true` in config.json |
| `allowAllPaths` | `false` | Set `true` in config.json |

### CLI Backend Abstraction

```typescript
interface CLIBackend {
  name: string;
  defaultCommand: string;
  buildArgs(prompt, options): string[];
  buildEnv(mcpConfigPath, baseEnv): NodeJS.ProcessEnv;
  parseOutput(stdout, stderr, exitCode): ParsedOutput;
  augmentPromptForMCP?(prompt, mcpServers): string;
}
```

**Important:** Sub-agents run **without** the `--agent` flag. Custom agents restrict tools; omitting gives full Copilot built-in access (`bash`, `view`, `edit`, `create`, `grep`).

---

## Production Features

| Feature | Implementation |
|---------|----------------|
| Graceful shutdown | Waits 30s for active tasks on SIGTERM/SIGINT |
| Active task tracking | `activeTasks` Set exported from spawn.ts |
| Retry logic | Auto-retry once on timeout/ECONNRESET (2s delay) |
| Structured logging | LOG_LEVEL env var, JSONL output |
| Log rotation | Auto-rotates at 10MB |
| Health check | `npm run health` for CI/deployment validation |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COPILOT_CLI` | `copilot` | Path to Copilot CLI |
| `CLAUDE_CLI` | `claude` | Path to Claude Code CLI |
| `ORCHESTRATOR_DEFAULT_BACKEND` | `copilot` | Default CLI backend |
| `ORCHESTRATOR_WORKSPACE` | cwd | Default workspace for tasks |
| `LOG_LEVEL` | `INFO` | DEBUG, INFO, WARN, ERROR |

---

## Configuration

**Location:**
- macOS/Linux: `~/.config/orchestrator/`
- Windows: `%LOCALAPPDATA%\orchestrator\`

**Files:**
- `config.json` — CLI backend settings
- `mcp-subagent.json` — MCP servers for sub-agents
- `logs/orchestrator.jsonl` — Application logs (rotates at 10MB)
- `logs/YYYY-MM-DD.jsonl` — Task execution audit logs

---

## Tool: `spawn_subagents`

Spawns 1-10 parallel sub-agents.

```json
{
  "tasks": [
    {
      "id": "unique-id",
      "prompt": "Task description",
      "mcp_servers": ["playwright"],
      "cli_backend": "copilot",
      "timeout_seconds": 120
    }
  ]
}
```

---

## Smart Timeouts

| MCP Server | Default Timeout |
|------------|-----------------|
| filesystem, memory | 30s |
| github, google-tasks | 60s |
| google-calendar | 90s |
| playwright | 120s |

---

## Development Commands

```bash
npm run build      # Compile TypeScript
npm run dev        # Run with tsx (hot reload)
npm test           # Run Jest tests
npm run health     # Check CLI backend availability
npm start          # Start MCP server
```

---

## Testing

15 smoke tests covering:
- Cross-platform config paths
- Secure permission defaults
- Node-based grep implementation
- Temp path detection
- Platform-specific spawn options
- Active task tracking for graceful shutdown
- Retry logic for transient errors
- Logger level filtering

---

## Version Management

### Updating Version

When making changes, update version in **both** files:

1. `package.json` — `"version": "X.Y.Z"`
2. `src/index.ts` — `version: 'X.Y.Z'` in Server constructor

**Versioning scheme:** Semantic versioning (semver)
- **MAJOR** (X): Breaking API changes
- **MINOR** (Y): New features, backward compatible
- **PATCH** (Z): Bug fixes, minor improvements

### Pre-release Checklist

```bash
# 1. Run tests
npm test

# 2. Build
npm run build

# 3. Health check
npm run health

# 4. Update version in package.json and src/index.ts
# 5. Update CHANGELOG.md with new version section
# 6. Commit with message: "chore: bump version to X.Y.Z"
# 7. Push to git
git push origin main
```

### Publishing

```bash
npm publish --access public
```

Package: https://www.npmjs.com/package/@ask149/mcp-orchestrator

### Post-Release

```bash
# Tag the release
git tag v1.0.1
git push origin v1.0.1
```

---

## Changelog

See [CHANGELOG.md](../CHANGELOG.md) for full version history.

**Current version:** 1.0.1

---

## Common Pitfalls & Learnings

### 1. CLI Command Paths
- Use `copilot` not `gh copilot` — standalone CLI
- Always check env var override first (`COPILOT_CLI`, `CLAUDE_CLI`)

### 2. MCP Protocol
- **stdout is reserved** — All logging must use `console.error` (stderr)
- StdioServerTransport handles JSON-RPC over stdio

### 3. Copilot MCP Config Location (CRITICAL)
- MCP servers **must** be in the default config location for `-p` mode:
  - **macOS/Linux:** `~/.copilot/mcp-config.json`
  - **Windows:** `%USERPROFILE%\.copilot\mcp-config.json`
- `--additional-mcp-config` only **augments** (adds to) the default config
- Servers not in the default location will NOT load in non-interactive mode
- Required fields: `type` ("local"/"stdio"/"http"/"sse") and `tools` (["*"] or specific)

### 4. Windows Compatibility
- Always use `os.tmpdir()` not `/tmp`
- Always use `path.join()` not string concatenation
- Set `shell: true` in spawn options for `.cmd` files
- Use `cmd /c npx` wrapper for npx-based MCP servers

### 5. Async Logging
- Use `fs/promises` not sync methods
- Silent fail on log writes — logging should never break execution

### 6. Task Tracking
- Always `activeTasks.add(id)` at start, `activeTasks.delete(id)` in finally
- Use `Promise.allSettled` not `Promise.all` for parallel tasks

---

## Related Files

| File | Purpose |
|------|---------|
| [README.md](../README.md) | User documentation |
| [CHANGELOG.md](../CHANGELOG.md) | Version history and release notes |
| [SETUP.md](../SETUP.md) | Installation guide |
| [WINDOWS_VALIDATION.md](../WINDOWS_VALIDATION.md) | Windows testing checklist |

---

## Working Style

- Keep cross-platform compatibility (test on Windows if changing paths/spawn)
- Maintain secure defaults (don't enable permissions by default)
- Run `npm test` before commits
- Update docs when changing behavior
- Update CHANGELOG.md when releasing new versions

### Version Sync (CRITICAL)

Always keep these three in sync:
1. **`package.json`** — `"version": "X.Y.Z"`
2. **`src/index.ts`** — `version: 'X.Y.Z'` in Server constructor
3. **`CHANGELOG.md`** — Add new version section with changes

### Git Workflow

- **Always push changes** after completing work
- Use conventional commits: `feat:`, `fix:`, `chore:`, `docs:`
- Tag releases: `git tag vX.Y.Z && git push origin vX.Y.Z`
- Keep `main` branch deployable
