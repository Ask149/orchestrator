# Copilot Instructions — MCP Orchestrator

**At task start, read:** This file provides context for the MCP Orchestrator project.

---

## Project Overview

**Package:** `@ask149/mcp-orchestrator`
**Purpose:** MCP server for spawning parallel CLI sub-agents (Copilot CLI / Claude CLI)

---

## Architecture

```
src/
├── index.ts      # MCP server entry point (StdioServerTransport)
├── spawn.ts      # Sub-agent spawning with cross-platform support
├── backends.ts   # CLI backend abstraction (Copilot, Claude)
├── context.ts    # File context handling (full/summary/grep modes)
└── types.ts      # TypeScript interfaces and timeout configs
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

---

## Configuration

**Location:**
- macOS/Linux: `~/.config/orchestrator/`
- Windows: `%LOCALAPPDATA%\orchestrator\`

**Files:**
- `config.json` — CLI backend settings
- `mcp-subagent.json` — MCP servers for sub-agents
- `logs/` — JSONL audit logs

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
npm start          # Start MCP server
```

---

## Testing

11 smoke tests covering:
- Cross-platform config paths
- Secure permission defaults
- Node-based grep implementation
- Temp path detection
- Platform-specific spawn options

---

## Publishing

```bash
npm publish --access public
```

Package: https://www.npmjs.com/package/@ask149/mcp-orchestrator

---

## Related Files

| File | Purpose |
|------|---------|
| [README.md](../README.md) | User documentation |
| [SETUP.md](../SETUP.md) | Installation guide |
| [WINDOWS_VALIDATION.md](../WINDOWS_VALIDATION.md) | Windows testing checklist |

---

## Working Style

- Keep cross-platform compatibility (test on Windows if changing paths/spawn)
- Maintain secure defaults (don't enable permissions by default)
- Run `npm test` before commits
- Update docs when changing behavior
