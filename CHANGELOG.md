# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.2] - 2026-02-03

### Added
- **Extensive DEBUG logging** for troubleshooting MCP server issues and CLI execution
  - `spawn.ts`: CLI config loading, command resolution, MCP config creation, process details
  - `spawn.ts`: stdout/stderr chunk logging, exit codes, MCP server discovery (found/missing)
  - `backends.ts`: Args building and output parsing for copilot/claude backends
  - `context.ts`: File reading operations (full/summary/grep modes), prompt enrichment
  - `resources.ts`: Resource reads and config assembly
- Enable verbose logging with `LOG_LEVEL=DEBUG`

## [1.1.0] - 2026-02-03

### Added
- **MCP Resources primitive** — Expose orchestrator logs and config as MCP resources
  - `logs://orchestrator/app` — Application logs in JSONL format
  - `config://orchestrator/current` — Current configuration (CLI, MCP servers, env vars)
- **`check_health` tool** — Health check now available as MCP tool (in addition to CLI)
- New file `src/resources.ts` for resource handling
- 4 new tests for resources and health check (19 total)

### Changed
- Server now declares `resources: {}` capability alongside `tools: {}`
- `CallToolRequestSchema` handler refactored to support multiple tools
- Startup log now includes capabilities list

## [1.0.1] - 2026-02-03

### Added
- Structured logger with DEBUG/INFO/WARN/ERROR levels (`src/logger.ts`)
- Log rotation at 10MB max file size
- Graceful shutdown with 30s drain period on SIGTERM/SIGINT
- Active task tracking for shutdown coordination (`activeTasks` Set)
- Retry logic for transient errors (timeout, ECONNRESET) — max 2 attempts, 2s delay
- Health check CLI (`npm run health`, `npx mcp-orchestrator-health`)
- `mcp-orchestrator-health` binary in package.json
- Environment variable support: `LOG_LEVEL`, `ORCHESTRATOR_DEFAULT_BACKEND`, `ORCHESTRATOR_WORKSPACE`
- 4 new tests for production features (15 total)

### Changed
- Logs now write to single `orchestrator.jsonl` file instead of daily files
- Updated README with Production Features section
- Updated copilot-instructions.md with version management and changelog

## [1.0.0] - 2026-01-15

### Added
- Initial release
- Multi-CLI backend support (GitHub Copilot CLI, Claude Code CLI)
- Parallel sub-agent spawning (max 10 concurrent tasks)
- Context passing modes: full, summary, grep
- MCP server filtering per task
- Smart timeout configuration based on MCP server type
- Cross-platform support (Windows x64/ARM64, macOS Intel/Apple Silicon, Linux x86-64/ARM64)
- Secure-by-default permissions (`allowAllTools`, `allowAllPaths` default to `false`)
- JSONL audit logging to `~/.config/orchestrator/logs/`
- CLI backend abstraction interface for extensibility
- 11 smoke tests for cross-platform compatibility

[1.1.2]: https://github.com/Ask149/orchestrator/compare/v1.1.0...v1.1.2
[1.1.0]: https://github.com/Ask149/orchestrator/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/Ask149/orchestrator/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Ask149/orchestrator/releases/tag/v1.0.0
