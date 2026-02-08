# MCP Orchestrator

MCP server for spawning parallel sub-agents with multi-CLI backend support.

## Platform Support

- **macOS** (Intel & Apple Silicon)
- **Linux** (x86-64 & ARM64)
- **Windows** (x64 & ARM64)

**Windows setup:** See [WINDOWS_VALIDATION.md](WINDOWS_VALIDATION.md)

## Features

- **Multi-CLI backends** — Support for GitHub Copilot CLI and Claude Code CLI
- **Parallel execution** — Run multiple sub-agents simultaneously
- **Context passing** — Pass file contents (full/summary/grep) to sub-agents
- **MCP server filtering** — Specify which MCP servers each sub-agent can use
- **MCP Resources** — Expose logs and config as readable MCP resources
- **Timeout handling** — Per-task and global timeouts
- **Audit logging** — All executions logged to `~/.config/orchestrator/logs/`

## Quick Demo

**Spawn 3 parallel sub-agents for job research:**

```bash
# Via job-search-automation workspace
cd /path/to/job-search-automation
ma parallel \
  "search LinkedIn for SDE-2 roles" \
  "search Reddit for remote jobs" \
  "research top companies for tech stack"
```

**Expected output:**
```
🐙 SPAWNING PARALLEL TASKS
==========================

Tasks (3 total):
  1. search LinkedIn for SDE-2 roles
  2. search Reddit for remote jobs
  3. research top companies for tech stack

⏳ Spawning sub-agents via Orchestrator...
[Sub-Agent 1] LinkedIn search in progress...
[Sub-Agent 2] Reddit search in progress...
[Sub-Agent 3] Company research in progress...
✅ Parallel execution complete
```

## Installation

**For detailed setup instructions, see [SETUP.md](SETUP.md).**

Quick start:

```bash
git clone https://github.com/Ask149/orchestrator.git
cd orchestrator
npm install
npm run build
```

## Configuration

Config files live at:

- **macOS/Linux:** `~/.config/orchestrator/`
- **Windows:** `%LOCALAPPDATA%\\orchestrator\\` (falls back to `%APPDATA%`)

```
<config-dir>/
├── config.json          # CLI backend configuration
├── mcp-subagent.json    # MCP servers available to sub-agents
└── logs/                # Execution audit logs (JSONL)
```

### CLI Backend Configuration (config.json)

```json
{
  "cli": {
    "backend": "copilot",
    
    "copilot": {
      "command": "copilot",
      "allowAllTools": false,
      "allowAllPaths": false,
      "model": null
    },
    
    "claude": {
      "command": "claude",
      "allowAllTools": false,
      "maxTurns": 10,
      "model": null
    }
  }
}
```

Defaults are secure: `allowAllTools` and `allowAllPaths` are `false`. Enable explicitly for unattended runs.

### Supported CLI Backends

| Backend | CLI | Description |
|---------|-----|-------------|
| `copilot` | GitHub Copilot CLI | `copilot -p "prompt" [--allow-all-tools] [--allow-all-paths]` |
| `claude` | Claude Code CLI | `claude -p "prompt" [--dangerously-skip-permissions] --output-format stream-json` |

> **Note:** Sub-agents run **without** the `--agent` flag. Custom agents restrict the available toolset (e.g., to only `report_intent`, `update_todo`). By omitting `--agent`, sub-agents get full access to Copilot's built-in tools: `bash`, `view`, `edit`, `create`, `grep`.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COPILOT_CLI` | `copilot` | Path to Copilot CLI |
| `CLAUDE_CLI` | `claude` | Path to Claude Code CLI |
| `ORCHESTRATOR_DEFAULT_BACKEND` | `copilot` | Default CLI backend (`copilot` or `claude`) |
| `ORCHESTRATOR_WORKSPACE` | cwd | Default workspace for tasks |
| `LOG_LEVEL` | `INFO` | Logging level: `DEBUG`, `INFO`, `WARN`, `ERROR` |

### Smart Timeout Configuration

The orchestrator automatically selects appropriate timeouts based on MCP servers requested:

| MCP Server | Default Timeout | Reason |
|------------|-----------------|--------|
| `filesystem`, `memory` | 30s | Fast local operations |
| `github`, `google-tasks` | 60s | API calls + auth overhead |
| `google-calendar`, `leetcode` | 90s | OAuth + complex APIs |
| `playwright` | **120s** | Browser startup + page rendering |

**Logic:** `effective_timeout = max(task.timeout_seconds, recommended_for_servers, default)`

Override with explicit `timeout_seconds` in task definition when needed.

## Usage

### Tool: `spawn_subagents`

Spawn parallel sub-agents for complex tasks.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tasks` | array | Yes | Array of sub-agent tasks (max 10) |
| `default_timeout_seconds` | number | No | Default timeout (default: 120) |
| `default_workspace` | string | No | Default working directory |

**Task Properties:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string | Yes | Unique task identifier |
| `prompt` | string | Yes | Task prompt for sub-agent |
| `context` | object | No | File/data context to pass |
| `mcp_servers` | array | No | MCP servers to enable |
| `workspace` | string | No | Working directory |
| `timeout_seconds` | number | No | Task timeout |
| `cli_backend` | string | No | Override CLI backend (`copilot` or `claude`) |

### Example: Parallel Research

```json
{
  "tasks": [
    {
      "id": "stripe",
      "prompt": "Find SDE-2 roles at Stripe",
      "mcp_servers": ["playwright"]
    },
    {
      "id": "google",
      "prompt": "Find SDE-2 roles at Google",
      "mcp_servers": ["playwright"]
    },
    {
      "id": "meta",
      "prompt": "Find SDE-2 roles at Meta",
      "mcp_servers": ["playwright"],
      "cli_backend": "claude"
    }
  ]
}
```

### Example: Context Passing

```json
{
  "tasks": [
    {
      "id": "analyze",
      "prompt": "Analyze this file and summarize",
      "context": {
        "files": [
          { "path": "src/main.ts", "mode": "full" },
          { "path": "README.md", "mode": "summary" },
          { "path": "src/", "mode": "grep", "pattern": "TODO|FIXME" }
        ]
      }
    }
  ]
}
```

## MCP Server Configuration (mcp-subagent.json)

Define MCP servers available to sub-agents.

> **⚠️ IMPORTANT:** For Copilot CLI in `-p` (programmatic) mode, MCP servers **must** be configured in the default config location. The `--additional-mcp-config` flag only **augments** (adds to) this default config. Servers not in the default location will not load in `-p` mode.
>
> **Config location:**
> - **macOS/Linux:** `~/.copilot/mcp-config.json`
> - **Windows:** `%USERPROFILE%\.copilot\mcp-config.json` (e.g., `C:\Users\username\.copilot\mcp-config.json`)

**Required fields for CLI compatibility:**

| Field | Copilot CLI | Claude CLI | Description |
|-------|-------------|------------|-------------|
| `type` | **Required** | Optional | `"local"`, `"stdio"`, `"http"`, or `"sse"` |
| `tools` | **Required** | Optional | Array of tool names or `["*"]` for all |
| `command` | Required | Required | Executable path |
| `args` | Required | Required | Command arguments |

**macOS/Linux:**

```json
{
  "mcpServers": {
    "playwright": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"],
      "tools": ["*"]
    }
  }
}
```

**Windows (requires `cmd /c` wrapper for npx):**

```json
{
  "mcpServers": {
    "playwright": {
      "type": "local",
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@playwright/mcp@latest"],
      "tools": ["*"]
    }
  }
}
```

> **Windows Users:** Without `cmd /c`, you'll encounter "Connection closed" errors because Windows cannot directly execute `npx`. See [WINDOWS_VALIDATION.md](WINDOWS_VALIDATION.md) for details.

## MCP Integration

### Job Search Automation (Recommended)

Use the `ma` CLI for integrated job search workflows:

```bash
cd /path/to/job-search-automation
ma parallel "search LinkedIn for SDE-2" "search Reddit for remote jobs"
```

See [automation/ORCHESTRATOR.md](../job-search-automation/automation/ORCHESTRATOR.md) in job-search-automation workspace for complete usage guide with workflows and examples.

### Standalone: VS Code / Cline

Add to your MCP settings to use as a standalone server:

```json
{
  "mcpServers": {
    "orchestrator": {
      "command": "node",
      "args": ["/path/to/orchestrator/dist/index.js"],
      "env": {
        "ORCHESTRATOR_WORKSPACE": "/path/to/your/workspace"
      }
    }
  }
}
```

## Audit Logs

Execution logs are written to `<config-dir>/logs/orchestrator.jsonl`:

```jsonl
{"timestamp":"2026-02-01T10:00:00.000Z","level":"INFO","message":"Spawning 3 sub-agents","taskIds":["stripe","google","meta"]}
```

## Production Features

### Health Check

Verify CLI backends are available before deployment:

```bash
npm run health
# or
npx mcp-orchestrator-health
```

Returns JSON with backend availability and exit code 0 if at least one backend is available.

### Graceful Shutdown

Server waits up to 30 seconds for active tasks to complete on `SIGTERM`/`SIGINT`.

### Automatic Retry

Transient failures (timeout, connection reset) are automatically retried once with a 2s delay.

### Log Rotation

Application logs auto-rotate at 10MB:
- `~/.config/orchestrator/logs/orchestrator.jsonl`

## MCP Resources (v1.1.0+)

The orchestrator exposes its logs and configuration as MCP resources:

| Resource URI | Description |
|--------------|-------------|
| `logs://orchestrator/app` | Application logs in JSONL format |
| `logs://orchestrator/recent` | Tail of application logs (last ~200 lines) |
| `config://orchestrator/current` | Current CLI and MCP server configuration |
| `health://orchestrator/status` | Health status snapshot (same as `check_health`) |
| `state://orchestrator/active_tasks` | In-flight task IDs tracked for graceful shutdown |

Use these resources to inspect orchestrator state without direct file access.

### Tool: `check_health`

Verify orchestrator health via MCP (alternative to CLI `npm run health`):

```json
{
  "healthy": true,
  "timestamp": "2026-02-03T10:00:00.000Z",
  "platform": "darwin-arm64",
  "backends": {
    "copilot": { "available": true, "version": "1.0.0" },
    "claude": { "available": false, "error": "not found" }
  }
}
```

## Development

```bash
# Build
npm run build

# Watch mode
npm run watch

# Type check
npx tsc --noEmit

# Run smoke tests
npm test

# Watch tests
npm test:watch
```

## Testing

Cross-platform smoke tests validate:
- Config path resolution (macOS/Linux/Windows)
- Temp file handling
- Secure permission defaults
- Grep implementation (no Unix deps)
- Platform-specific spawn behavior

Run tests with: `npm test`

## License

MIT
