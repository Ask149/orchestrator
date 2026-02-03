# MCP Orchestrator

MCP server for spawning parallel sub-agents with multi-CLI backend support.

## Features

- **Multi-CLI backends** — Support for GitHub Copilot CLI and Claude Code CLI
- **Parallel execution** — Run multiple sub-agents simultaneously
- **Context passing** — Pass file contents (full/summary/grep) to sub-agents
- **MCP server filtering** — Specify which MCP servers each sub-agent can use
- **Timeout handling** — Per-task and global timeouts
- **Audit logging** — All executions logged to `~/.config/orchestrator/logs/`

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

Config files live at `~/.config/orchestrator/`:

```
~/.config/orchestrator/
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
      "command": "/opt/homebrew/bin/copilot",
      "agent": "job-search",
      "allowAllTools": true,
      "model": null
    },
    
    "claude": {
      "command": "claude",
      "allowAllTools": true,
      "maxTurns": 10,
      "model": null
    }
  }
}
```

### Supported CLI Backends

| Backend | CLI | Description |
|---------|-----|-------------|
| `copilot` | GitHub Copilot CLI | `copilot --agent <agent> -p "prompt" --allow-all-tools` |
| `claude` | Claude Code CLI | `claude -p "prompt" --dangerously-skip-permissions --output-format stream-json` |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COPILOT_CLI` | `/opt/homebrew/bin/copilot` | Path to Copilot CLI |
| `CLAUDE_CLI` | `claude` | Path to Claude Code CLI |

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

Define MCP servers available to sub-agents:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@anthropic-ai/mcp-playwright"]
    },
    "fetch": {
      "command": "npx",
      "args": ["@anthropic-ai/mcp-fetch"]
    }
  }
}
```

## MCP Integration

### VS Code / Cline

```json
{
  "servers": {
    "orchestrator": {
      "type": "stdio",
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

Execution logs are written to `~/.config/orchestrator/logs/YYYY-MM-DD.jsonl`:

```jsonl
{"timestamp":"2026-02-01T10:00:00.000Z","task_id":"stripe","backend":"copilot","success":true,"duration_ms":5432}
```

## Development

```bash
# Build
npm run build

# Watch mode
npm run watch

# Type check
npx tsc --noEmit
```

## License

MIT

