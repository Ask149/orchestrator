/**
 * Types for MCP Orchestrator - Sub-Agent Spawning
 */

export type ContextMode = 'full' | 'summary' | 'grep';

export interface FileContext {
  path: string;
  mode: ContextMode;
  pattern?: string;  // For grep mode
  hint?: string;     // Optional human-readable summary
}

export interface TaskContext {
  files?: FileContext[];
  inline_data?: Record<string, unknown>;
}

// ============================================
// CLI Backend Types
// ============================================

/**
 * Options passed to CLI backend when building args
 */
export interface CLIBackendOptions {
  mcpConfigPath?: string | null;
  agent?: string;
  allowAllTools?: boolean;
  maxTurns?: number;
  model?: string;
}

/**
 * Parsed output from CLI execution
 */
export interface ParsedOutput {
  output: string;
  tokens?: {
    in: number;
    out: number;
  };
}

/**
 * CLI Backend interface - implemented by each CLI tool
 */
export interface CLIBackend {
  name: string;
  defaultCommand: string;
  buildArgs(prompt: string, options: CLIBackendOptions): string[];
  buildEnv(mcpConfigPath: string | null, baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  parseOutput(stdout: string, stderr: string, exitCode: number): ParsedOutput;
}

/**
 * CLI-specific configuration options
 */
export interface CopilotCLIConfig {
  command?: string;       // Override default command path
  agent?: string;         // Default agent to use
  model?: string;         // Model selection
  allowAllTools?: boolean;
}

export interface ClaudeCLIConfig {
  command?: string;       // Override default command path
  model?: string;         // Model selection
  maxTurns?: number;      // Max agentic turns
  allowAllTools?: boolean;
}

/**
 * Main CLI configuration block
 */
export interface CLIConfig {
  backend: 'copilot' | 'claude';
  copilot?: CopilotCLIConfig;
  claude?: ClaudeCLIConfig;
}

// ============================================
// Sub-Agent Task Types
// ============================================

export interface SubAgentTask {
  id: string;
  prompt: string;
  context?: TaskContext;
  mcp_servers?: string[];  // Which MCP servers to enable
  workspace?: string;
  timeout_seconds?: number;
  cli_backend?: 'copilot' | 'claude';  // Override default backend per task
}

export interface SpawnSubagentsInput {
  tasks: SubAgentTask[];
  default_timeout_seconds?: number;
  default_workspace?: string;
}

export interface TaskResult {
  id: string;
  success: boolean;
  output?: string;
  error?: string;
  duration_ms: number;
  mcp_servers_requested?: string[];
  context_files_read?: string[];
  tokens?: {
    in: number;
    out: number;
  };
}

export interface SpawnSubagentsOutput {
  completed: number;
  failed: number;
  total: number;
  results: TaskResult[];
  total_duration_ms: number;
}

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}
