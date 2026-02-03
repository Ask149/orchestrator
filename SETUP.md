# Setup Instructions

## Prerequisites

- **Node.js** ≥ 18.0.0
- **npm** or **yarn**
- **GitHub Copilot CLI** or **Claude Code CLI** (at least one)

### Installing CLI Backends

#### GitHub Copilot CLI

```bash
npm install -g @github/copilot-cli
# or with Homebrew
brew install copilot-cli
```

**Verify installation:**
```bash
copilot --version
```

#### Claude Code CLI

```bash
npm install -g @anthropic-ai/claude-code
# or with brew
brew install anthropic-ai/packages/claude-code
```

**Verify installation:**
```bash
claude --version
```

## Installation Steps

### 1. Clone the Repository

```bash
git clone https://github.com/Ask149/orchestrator.git
cd orchestrator
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Build the Project

```bash
npm run build
```

### 4. Configure CLI Backends (First Time Only)

Create the configuration directory:

```bash
mkdir -p ~/.config/orchestrator
```

Create `~/.config/orchestrator/config.json`:

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

**Note:** Adjust CLI paths based on your installation:
- **Copilot**: Run `which copilot` to find your installation path
- **Claude**: Usually available as `claude` command if installed globally

### 5. Optional: Configure MCP Servers

Create `~/.config/orchestrator/mcp-subagent.json` to define MCP servers available to sub-agents:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-playwright"],
      "env": {}
    },
    "fetch": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-fetch"],
      "env": {}
    }
  }
}
```

## Usage

### As an MCP Server

The orchestrator is designed to run as an MCP server. Start it with:

```bash
npm start
```

Or in development mode:

```bash
npm run dev
```

### CLI Backend Override

Set the default backend via environment variable:

```bash
export ORCHESTRATOR_DEFAULT_BACKEND=claude
npm start
```

### Custom Workspace

Set the default workspace for tasks:

```bash
export ORCHESTRATOR_WORKSPACE=/path/to/your/project
npm start
```

## Integration with Cline / Claude Code

Add to your Cline MCP settings:

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

Then spawn parallel sub-agents with:

```typescript
const result = await useMcpTool('orchestrator', 'spawn_subagents', {
  tasks: [
    {
      id: "task-1",
      prompt: "Your task description here",
      mcp_servers: ["playwright"],
      cli_backend: "copilot"
    }
  ]
});
```

## Troubleshooting

### CLI Command Not Found

**Problem:** `Error: Command not found: copilot`

**Solution:** Update the CLI path in `~/.config/orchestrator/config.json`:

```bash
which copilot
# Copy the output and update config.json
```

### MCP Servers Not Available

**Problem:** `Error: MCP server 'playwright' not found`

**Solution:** Create `~/.config/orchestrator/mcp-subagent.json` with your available servers (see Section 5 above).

### Logs Not Being Saved

Ensure the log directory exists and is writable:

```bash
mkdir -p ~/.config/orchestrator/logs
chmod 755 ~/.config/orchestrator/logs
```

### Port Already in Use

If running multiple instances, specify different stdio connections or ports in your MCP configuration.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ORCHESTRATOR_WORKSPACE` | Current working directory | Default workspace for tasks |
| `ORCHESTRATOR_DEFAULT_BACKEND` | `copilot` | Default CLI backend (`copilot` or `claude`) |
| `COPILOT_CLI` | `copilot` | Path to GitHub Copilot CLI |
| `CLAUDE_CLI` | `claude` | Path to Claude Code CLI |

## Development

### Run in Development Mode

```bash
npm run dev
```

This uses `tsx` to run TypeScript directly without compilation.

### Build Changes

```bash
npm run build
```

### Type Checking

```bash
npx tsc --noEmit
```

## Testing

To test the MCP server locally:

```bash
node dist/index.js
```

Send test requests via stdin (MCP uses JSON-RPC over stdio).

## Security Notes

- **Config Files:** Keep `~/.config/orchestrator/` secured with appropriate permissions
- **CLI Credentials:** Ensure your CLI backends are properly authenticated
- **Logs:** Execution logs may contain sensitive data; review before sharing

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review logs in `~/.config/orchestrator/logs/`
3. Open an issue on the GitHub repository
