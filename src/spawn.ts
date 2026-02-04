/**
 * Sub-agent spawning logic with multi-CLI backend support
 *
 * Supports:
 * - copilot: GitHub Copilot CLI
 * - claude: Claude Code CLI
 */

import { spawn } from 'child_process';
import { writeFile, unlink, mkdir, appendFile, readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { buildEnrichedPrompt, summarizeOutput } from './context.js';
import { getBackend, BackendRegistry } from './backends.js';
import { logger } from './logger.js';
import type { SubAgentTask, TaskResult, MCPConfig, CLIConfig, CLIBackendOptions } from './types.js';
import { getRecommendedTimeout } from './types.js';

// Active task tracking for graceful shutdown
export const activeTasks = new Set<string>();

// Configuration paths
const IS_WINDOWS = process.platform === 'win32';
const HOME_DIR = os.homedir();
const WINDOWS_CONFIG_BASE = process.env.LOCALAPPDATA || process.env.APPDATA || HOME_DIR;
const CONFIG_DIR = IS_WINDOWS
  ? path.join(WINDOWS_CONFIG_BASE, 'orchestrator')
  : path.join(HOME_DIR, '.config', 'orchestrator');
const FULL_MCP_CONFIG = path.join(CONFIG_DIR, 'mcp-subagent.json');
const CLI_CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const LOG_DIR = path.join(CONFIG_DIR, 'logs');
const TEMP_DIR = os.tmpdir();

// Environment overrides
const ENV_COPILOT_CLI = process.env.COPILOT_CLI;
const ENV_CLAUDE_CLI = process.env.CLAUDE_CLI;
const ENV_DEFAULT_BACKEND = process.env.ORCHESTRATOR_DEFAULT_BACKEND;

function isTempPath(filePath: string): boolean {
  const tempRoot = path.resolve(TEMP_DIR);
  const target = path.resolve(filePath);
  return target.startsWith(`${tempRoot}${path.sep}`);
}

/**
 * Load CLI configuration from config.json
 */
async function loadCLIConfig(): Promise<CLIConfig> {
  const defaultBackend = ENV_DEFAULT_BACKEND === 'claude' ? 'claude' : 'copilot';

  try {
    const content = await readFile(CLI_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(content);
    return config.cli || {
      backend: defaultBackend,
      copilot: { agent: 'job-search', allowAllTools: false, allowAllPaths: false },
      claude: { allowAllTools: false }
    };
  } catch {
    // Default configuration (secure-by-default)
    return {
      backend: defaultBackend,
      copilot: { agent: 'job-search', allowAllTools: false, allowAllPaths: false },
      claude: { allowAllTools: false }
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
    const tempPath = path.join(TEMP_DIR, `mcp_${taskId}_${Date.now()}.json`);
    await writeFile(tempPath, JSON.stringify(filteredConfig, null, 2));
    return tempPath;
  } catch (error) {
    logger.warn('Failed to create filtered MCP config, using full config', { error: String(error) });
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
    logger.warn('Failed to log execution', { error: String(error), taskId: task.id });
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
  // Track active task for graceful shutdown
  activeTasks.add(task.id);

  const startTime = Date.now();
  const workspace = task.workspace || defaultWorkspace;

  // Smart timeout: use task override > MCP-recommended > default
  const recommendedTimeout = getRecommendedTimeout(task.mcp_servers);
  const timeout = (task.timeout_seconds || Math.max(recommendedTimeout, defaultTimeout)) * 1000;

  // Load CLI config if not provided
  const config = cliConfig || await loadCLIConfig();

  // Determine which backend to use (task override > config default)
  const backendName = task.cli_backend || config.backend || 'copilot';
  const backend = getBackend(backendName);

  logger.debug('Spawning sub-agent', { taskId: task.id, backend: backendName, timeout: timeout / 1000 });

  if (!backend) {
    activeTasks.delete(task.id);
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

  // Augment prompt with MCP fallback instructions if backend supports it
  const finalPrompt = backend.augmentPromptForMCP
    ? backend.augmentPromptForMCP(enrichedPrompt, task.mcp_servers)
    : enrichedPrompt;

  // Create MCP config (filtered if specific servers requested)
  const mcpConfigPath = await createFilteredMCPConfig(task.mcp_servers, task.id);

  // Get CLI command
  const cliCommand = getCLICommand(backendName, config);

  const copilotAllowAllTools = config.copilot?.allowAllTools === true;
  const copilotAllowAllPaths = config.copilot?.allowAllPaths === true;
  const claudeAllowAllTools = config.claude?.allowAllTools === true;

  // Build backend-specific options
  const backendOptions: CLIBackendOptions = {
    mcpConfigPath,
    agent: backendName === 'copilot' ? (config.copilot?.agent || 'job-search') : undefined,
    allowAllTools: backendName === 'copilot' ? copilotAllowAllTools : claudeAllowAllTools,
    allowAllPaths: backendName === 'copilot' ? copilotAllowAllPaths : undefined,
    model: backendName === 'copilot' ? config.copilot?.model : config.claude?.model,
    maxTurns: backendName === 'claude' ? config.claude?.maxTurns : undefined
  };

  // Build args using backend
  const args = backend.buildArgs(finalPrompt, backendOptions);
  const env = backend.buildEnv(mcpConfigPath, process.env as NodeJS.ProcessEnv);

  // On Windows, only use shell for .bat/.cmd files (needed for path resolution)
  // For .exe files, shell: true mangles arguments with special characters
  const needsShell = IS_WINDOWS && /\.(bat|cmd)$/i.test(cliCommand);

  return new Promise<TaskResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const proc = spawn(cliCommand, args, {
      cwd: workspace,
      env,
      timeout,
      shell: needsShell,
      // Close stdin immediately - CLI tools don't need input, and Claude waits for stdin to close
      stdio: ['ignore', 'pipe', 'pipe']
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
      if (mcpConfigPath && isTempPath(mcpConfigPath)) {
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
      await logExecution(task, result, finalPrompt, backendName);

      // Remove from active tasks
      activeTasks.delete(task.id);
      logger.debug('Sub-agent completed', { taskId: task.id, success: result.success, duration: duration });

      resolve(result);
    });

    proc.on('error', async (error) => {
      clearTimeout(timeoutHandle);
      const duration = Date.now() - startTime;

      // Clean up temp MCP config on error too
      if (mcpConfigPath && isTempPath(mcpConfigPath)) {
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

      // Remove from active tasks
      activeTasks.delete(task.id);
      logger.error('Sub-agent process error', { taskId: task.id, error: error.message });

      resolve(result);
    });
  });
}

/**
 * Check if an error is retryable (transient failure)
 */
function isRetryableError(result: TaskResult): boolean {
  if (result.success) return false;
  const error = result.error?.toLowerCase() || '';
  return (
    error.includes('timeout') ||
    error.includes('etimedout') ||
    error.includes('econnreset') ||
    error.includes('econnrefused') ||
    error.includes('spawn') // CLI not found temporarily
  );
}

/**
 * Spawn a sub-agent with simple retry for transient failures
 */
async function spawnWithRetry(
  task: SubAgentTask,
  defaultWorkspace: string,
  defaultTimeout: number,
  cliConfig: CLIConfig,
  maxAttempts = 2
): Promise<TaskResult> {
  let lastResult: TaskResult | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastResult = await spawnSubAgent(task, defaultWorkspace, defaultTimeout, cliConfig);

    // Success or non-retryable error: return immediately
    if (lastResult.success || !isRetryableError(lastResult) || attempt === maxAttempts) {
      return lastResult;
    }

    // Retryable error: wait and retry
    logger.warn('Retrying sub-agent due to transient error', {
      taskId: task.id,
      attempt,
      error: lastResult.error
    });

    await new Promise((resolve) => setTimeout(resolve, 2000)); // 2s fixed delay
  }

  return lastResult!;
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
    spawnWithRetry(task, defaultWorkspace, defaultTimeout, cliConfig)
  );

  // Use allSettled to continue even if some fail
  const settled = await Promise.allSettled(promises);

  return settled.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    // This shouldn't happen since spawnSubAgent handles errors internally
    logger.error('Unexpected promise rejection', { taskId: tasks[index].id, error: result.reason?.message });
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
