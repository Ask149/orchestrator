/**
 * Sub-agent spawning logic with multi-CLI backend support
 * 
 * Supports:
 * - copilot: GitHub Copilot CLI
 * - claude: Claude Code CLI
 */

import { spawn } from 'child_process';
import { writeFile, unlink, mkdir, appendFile, readFile } from 'fs/promises';
import path from 'path';
import { buildEnrichedPrompt, summarizeOutput } from './context.js';
import { getBackend, BackendRegistry } from './backends.js';
import type { SubAgentTask, TaskResult, MCPConfig, CLIConfig, CLIBackendOptions } from './types.js';

// Configuration paths
const CONFIG_DIR = path.join(process.env.HOME || '', '.config/orchestrator');
const FULL_MCP_CONFIG = path.join(CONFIG_DIR, 'mcp-subagent.json');
const CLI_CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const LOG_DIR = path.join(CONFIG_DIR, 'logs');

// Environment overrides
const ENV_COPILOT_CLI = process.env.COPILOT_CLI;
const ENV_CLAUDE_CLI = process.env.CLAUDE_CLI;

/**
 * Load CLI configuration from config.json
 */
async function loadCLIConfig(): Promise<CLIConfig> {
  try {
    const content = await readFile(CLI_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(content);
    return config.cli || { backend: 'copilot', copilot: { agent: 'job-search' } };
  } catch {
    // Default configuration
    return {
      backend: 'copilot',
      copilot: { agent: 'job-search', allowAllTools: true }
    };
  }
}

/**
 * Get CLI command path for a backend
 */
function getCLICommand(backendName: string, cliConfig: CLIConfig): string {
  const backend = getBackend(backendName);
  if (!backend) {
    throw new Error(`Unknown CLI backend: ${backendName}`);
  }
  
  // Check environment override first
  if (backendName === 'copilot' && ENV_COPILOT_CLI) return ENV_COPILOT_CLI;
  if (backendName === 'claude' && ENV_CLAUDE_CLI) return ENV_CLAUDE_CLI;
  
  // Check config override
  if (backendName === 'copilot' && cliConfig.copilot?.command) {
    return cliConfig.copilot.command;
  }
  if (backendName === 'claude' && cliConfig.claude?.command) {
    return cliConfig.claude.command;
  }
  
  return backend.defaultCommand;
}

/**
 * Create filtered MCP config for specific servers
 */
async function createFilteredMCPConfig(
  servers: string[] | undefined,
  taskId: string
): Promise<string | null> {
  if (!servers || servers.length === 0) {
    return FULL_MCP_CONFIG;
  }

  try {
    const { readFile } = await import('fs/promises');
    const fullConfig: MCPConfig = JSON.parse(
      await readFile(FULL_MCP_CONFIG, 'utf-8')
    );

    const filteredConfig: MCPConfig = {
      mcpServers: {}
    };

    for (const server of servers) {
      if (fullConfig.mcpServers[server]) {
        filteredConfig.mcpServers[server] = fullConfig.mcpServers[server];
      }
    }

    // Write temp config
    const tempPath = `/tmp/mcp_${taskId}_${Date.now()}.json`;
    await writeFile(tempPath, JSON.stringify(filteredConfig, null, 2));
    return tempPath;
  } catch (error) {
    console.error(`Failed to create filtered MCP config: ${error}`);
    return FULL_MCP_CONFIG;
  }
}

/**
 * Log sub-agent execution for audit
 */
async function logExecution(
  task: SubAgentTask,
  result: TaskResult,
  enrichedPrompt: string,
  backendUsed: string
): Promise<void> {
  try {
    await mkdir(LOG_DIR, { recursive: true });
    const logFile = path.join(LOG_DIR, `${new Date().toISOString().split('T')[0]}.jsonl`);
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      task_id: task.id,
      backend: backendUsed,
      prompt_preview: task.prompt.slice(0, 200),
      enriched_prompt_length: enrichedPrompt.length,
      mcp_servers: task.mcp_servers,
      success: result.success,
      duration_ms: result.duration_ms,
      output_preview: result.output ? summarizeOutput(result.output, 200) : null,
      error: result.error
    };

    await appendFile(logFile, JSON.stringify(logEntry) + '\n');
  } catch (error) {
    console.error(`Failed to log execution: ${error}`);
  }
}

/**
 * Spawn a single sub-agent and wait for result
 */
export async function spawnSubAgent(
  task: SubAgentTask,
  defaultWorkspace: string,
  defaultTimeout: number,
  cliConfig?: CLIConfig
): Promise<TaskResult> {
  const startTime = Date.now();
  const workspace = task.workspace || defaultWorkspace;
  const timeout = (task.timeout_seconds || defaultTimeout) * 1000;

  // Load CLI config if not provided
  const config = cliConfig || await loadCLIConfig();
  
  // Determine which backend to use (task override > config default)
  const backendName = task.cli_backend || config.backend || 'copilot';
  const backend = getBackend(backendName);
  
  if (!backend) {
    return {
      id: task.id,
      success: false,
      error: `Unknown CLI backend: ${backendName}. Available: ${Object.keys(BackendRegistry).join(', ')}`,
      duration_ms: Date.now() - startTime
    };
  }

  // Build enriched prompt with context
  const { prompt: enrichedPrompt, filesRead } = await buildEnrichedPrompt(
    task.prompt,
    task.context,
    workspace
  );

  // Create MCP config (filtered if specific servers requested)
  const mcpConfigPath = await createFilteredMCPConfig(task.mcp_servers, task.id);

  // Get CLI command
  const cliCommand = getCLICommand(backendName, config);
  
  // Build backend-specific options
  const backendOptions: CLIBackendOptions = {
    mcpConfigPath,
    agent: backendName === 'copilot' ? (config.copilot?.agent || 'job-search') : undefined,
    allowAllTools: backendName === 'copilot' 
      ? config.copilot?.allowAllTools !== false 
      : config.claude?.allowAllTools !== false,
    model: backendName === 'copilot' ? config.copilot?.model : config.claude?.model,
    maxTurns: backendName === 'claude' ? config.claude?.maxTurns : undefined
  };

  // Build args using backend
  const args = backend.buildArgs(enrichedPrompt, backendOptions);
  const env = backend.buildEnv(mcpConfigPath, process.env as NodeJS.ProcessEnv);

  return new Promise<TaskResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const proc = spawn(cliCommand, args, {
      cwd: workspace,
      env,
      timeout
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, timeout);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', async (code) => {
      clearTimeout(timeoutHandle);
      const duration = Date.now() - startTime;

      // Clean up temp MCP config
      if (mcpConfigPath && mcpConfigPath.startsWith('/tmp/')) {
        unlink(mcpConfigPath).catch(() => {});
      }

      // Parse output using backend-specific parser
      const parsed = backend.parseOutput(stdout, stderr, code || 0);

      const result: TaskResult = timedOut
        ? {
            id: task.id,
            success: false,
            error: `Timeout after ${timeout / 1000}s`,
            duration_ms: duration,
            mcp_servers_requested: task.mcp_servers,
            context_files_read: filesRead
          }
        : code === 0
        ? {
            id: task.id,
            success: true,
            output: parsed.output,
            duration_ms: duration,
            mcp_servers_requested: task.mcp_servers,
            context_files_read: filesRead,
            tokens: parsed.tokens
          }
        : {
            id: task.id,
            success: false,
            error: stderr.trim() || `Exit code: ${code}`,
            output: parsed.output || undefined,
            duration_ms: duration,
            mcp_servers_requested: task.mcp_servers,
            context_files_read: filesRead
          };

      // Log for audit
      await logExecution(task, result, enrichedPrompt, backendName);

      resolve(result);
    });

    proc.on('error', async (error) => {
      clearTimeout(timeoutHandle);
      const duration = Date.now() - startTime;

      // Clean up temp MCP config on error too
      if (mcpConfigPath && mcpConfigPath.startsWith('/tmp/')) {
        unlink(mcpConfigPath).catch(() => {});
      }

      const result: TaskResult = {
        id: task.id,
        success: false,
        error: error.message,
        duration_ms: duration,
        mcp_servers_requested: task.mcp_servers,
        context_files_read: filesRead
      };

      await logExecution(task, result, enrichedPrompt, backendName);
      resolve(result);
    });
  });
}

/**
 * Spawn multiple sub-agents in parallel
 */
export async function spawnSubAgents(
  tasks: SubAgentTask[],
  defaultWorkspace: string,
  defaultTimeout: number
): Promise<TaskResult[]> {
  // Load CLI config once for all tasks
  const cliConfig = await loadCLIConfig();
  
  const promises = tasks.map((task) =>
    spawnSubAgent(task, defaultWorkspace, defaultTimeout, cliConfig)
  );

  // Use allSettled to continue even if some fail
  const settled = await Promise.allSettled(promises);

  return settled.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    // This shouldn't happen since spawnSubAgent handles errors internally
    return {
      id: tasks[index].id,
      success: false,
      error: result.reason?.message || 'Unknown error',
      duration_ms: 0
    };
  });
}

/**
 * Get available CLI backends
 */
export function getAvailableBackends(): string[] {
  return Object.keys(BackendRegistry);
}
