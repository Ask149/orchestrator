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
  logger.debug('Loading CLI config', { path: CLI_CONFIG_PATH, defaultBackend });

  try {
    const content = await readFile(CLI_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(content);
    const cliConfig = config.cli || {
      backend: defaultBackend,
      copilot: { agent: 'job-search', allowAllTools: false, allowAllPaths: false },
      claude: { allowAllTools: false }
    };
    logger.debug('CLI config loaded successfully', {
      backend: cliConfig.backend,
      copilotAllowAllTools: cliConfig.copilot?.allowAllTools,
      copilotAllowAllPaths: cliConfig.copilot?.allowAllPaths,
      claudeAllowAllTools: cliConfig.claude?.allowAllTools
    });
    return cliConfig;
  } catch (error) {
    // Default configuration (secure-by-default)
    logger.debug('CLI config not found or invalid, using defaults', { error: String(error) });
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

  let command: string;
  let source: string;

  // Check environment override first
  if (backendName === 'copilot' && ENV_COPILOT_CLI) {
    command = ENV_COPILOT_CLI;
    source = 'COPILOT_CLI env var';
  } else if (backendName === 'claude' && ENV_CLAUDE_CLI) {
    command = ENV_CLAUDE_CLI;
    source = 'CLAUDE_CLI env var';
  } else if (backendName === 'copilot' && cliConfig.copilot?.command) {
    command = cliConfig.copilot.command;
    source = 'config.json copilot.command';
  } else if (backendName === 'claude' && cliConfig.claude?.command) {
    command = cliConfig.claude.command;
    source = 'config.json claude.command';
  } else {
    command = backend.defaultCommand;
    source = 'backend default';
  }

  logger.debug('Resolved CLI command', { backend: backendName, command, source });
  return command;
}

/**
 * Create filtered MCP config for specific servers
 * Claude CLI has stricter schema validation - it rejects 'type' and 'tools' fields
 * that Copilot CLI requires. We strip these for Claude.
 */
async function createFilteredMCPConfig(
  servers: string[] | undefined,
  taskId: string,
  backendName: string = 'copilot'
): Promise<string | null> {
  logger.debug('Creating MCP config', {
    taskId,
    requestedServers: servers,
    fullConfigPath: FULL_MCP_CONFIG
  });

  if (!servers || servers.length === 0) {
    // For Claude, we still need to strip type/tools from the full config
    if (backendName === 'claude') {
      logger.debug('No specific servers requested, creating Claude-compatible full config');
      try {
        const configContent = await readFile(FULL_MCP_CONFIG, 'utf-8');
        const fullConfig: MCPConfig = JSON.parse(configContent);
        const claudeConfig: MCPConfig = { mcpServers: {} };
        
        for (const [name, serverConfig] of Object.entries(fullConfig.mcpServers)) {
          const { type, tools, ...rest } = serverConfig as unknown as Record<string, unknown>;
          claudeConfig.mcpServers[name] = rest as unknown as MCPConfig['mcpServers'][string];
        }
        
        const tempPath = path.join(TEMP_DIR, `mcp_${taskId}_claude_${Date.now()}.json`);
        await writeFile(tempPath, JSON.stringify(claudeConfig, null, 2));
        logger.debug('Claude-compatible full MCP config written', { tempPath });
        return tempPath;
      } catch (error) {
        logger.warn('Failed to create Claude-compatible config', { error: String(error) });
        return null;
      }
    }
    logger.debug('No specific servers requested, using full MCP config', { path: FULL_MCP_CONFIG });
    return FULL_MCP_CONFIG;
  }

  try {
    const { readFile } = await import('fs/promises');
    const configContent = await readFile(FULL_MCP_CONFIG, 'utf-8');
    const fullConfig: MCPConfig = JSON.parse(configContent);
    const availableServers = Object.keys(fullConfig.mcpServers || {});

    logger.debug('Full MCP config loaded', {
      availableServers,
      requestedServers: servers
    });

    const filteredConfig: MCPConfig = {
      mcpServers: {}
    };

    const foundServers: string[] = [];
    const missingServers: string[] = [];

    for (const server of servers) {
      if (fullConfig.mcpServers[server]) {
        // Cast to access optional fields like 'type' that may exist in actual config
        const serverConfig = fullConfig.mcpServers[server] as unknown as Record<string, unknown>;
        
        // Claude CLI rejects 'type' and 'tools' fields - strip them
        if (backendName === 'claude') {
          const { type, tools, ...claudeCompatible } = serverConfig;
          filteredConfig.mcpServers[server] = claudeCompatible as unknown as MCPConfig['mcpServers'][string];
          logger.debug('MCP server included (Claude-compatible, stripped type/tools)', {
            server,
            command: claudeCompatible.command,
            args: claudeCompatible.args,
            strippedFields: { type, tools }
          });
        } else {
          filteredConfig.mcpServers[server] = fullConfig.mcpServers[server];
          logger.debug('MCP server found and included', {
            server,
            type: serverConfig.type,
            command: serverConfig.command,
            args: serverConfig.args
          });
        }
        foundServers.push(server);
      } else {
        missingServers.push(server);
        logger.warn('MCP server not found in config', {
          server,
          availableServers,
          configPath: FULL_MCP_CONFIG
        });
      }
    }

    if (missingServers.length > 0) {
      logger.warn('Some requested MCP servers not available', {
        missing: missingServers,
        found: foundServers,
        hint: 'Add missing servers to mcp-subagent.json'
      });
    }

    // Write temp config
    const tempPath = path.join(TEMP_DIR, `mcp_${taskId}_${Date.now()}.json`);
    const filteredContent = JSON.stringify(filteredConfig, null, 2);
    await writeFile(tempPath, filteredContent);

    logger.debug('Filtered MCP config written', {
      tempPath,
      includedServers: foundServers,
      configSize: filteredContent.length
    });

    return tempPath;
  } catch (error) {
    logger.warn('Failed to create filtered MCP config, using full config', {
      error: String(error),
      fullConfigPath: FULL_MCP_CONFIG,
      hint: 'Ensure mcp-subagent.json exists and is valid JSON'
    });
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
  // Claude CLI has stricter schema - we strip 'type' and 'tools' fields for it
  const mcpConfigPath = await createFilteredMCPConfig(task.mcp_servers, task.id, backendName);

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

  // On Windows, .bat/.cmd files need to be run via cmd /c to work with spawn
  // Using shell: true mangles arguments with spaces, so we use cmd /c explicitly
  const isBatFile = IS_WINDOWS && /\.(bat|cmd)$/i.test(cliCommand);
  const spawnCommand = isBatFile ? 'cmd' : cliCommand;
  const spawnArgs = isBatFile ? ['/c', cliCommand, ...args] : args;

  logger.debug('Spawning CLI process', {
    taskId: task.id,
    command: spawnCommand,
    argsCount: spawnArgs.length,
    argsSummary: spawnArgs.slice(0, 3).map(a => a.length > 50 ? a.slice(0, 50) + '...' : a),
    workspace,
    timeout: timeout / 1000,
    isBatFile,
    mcpConfigPath,
    platform: process.platform
  });

  // Log full command for verbose debugging
  logger.debug('Full CLI command', {
    taskId: task.id,
    fullCommand: `${spawnCommand} ${spawnArgs.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`.slice(0, 500)
  });

  return new Promise<TaskResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let stdoutChunks = 0;
    let stderrChunks = 0;

    const proc = spawn(spawnCommand, spawnArgs, {
      cwd: workspace,
      env,
      timeout,
      // Don't use shell: true as it mangles arguments with spaces on Windows
      // For .bat files, we use cmd /c explicitly instead
      stdio: ['ignore', 'pipe', 'pipe']
    });

    logger.debug('CLI process spawned', { taskId: task.id, pid: proc.pid });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      logger.warn('CLI process timeout, sending SIGTERM', { taskId: task.id, pid: proc.pid, timeout: timeout / 1000 });
      proc.kill('SIGTERM');
    }, timeout);

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      stdoutChunks++;
      if (stdoutChunks <= 5 || stdoutChunks % 10 === 0) {
        logger.debug('CLI stdout chunk', {
          taskId: task.id,
          chunkNum: stdoutChunks,
          chunkSize: chunk.length,
          totalSize: stdout.length,
          preview: chunk.slice(0, 200)
        });
      }
    });

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      stderrChunks++;
      // Always log stderr as it often contains important error info
      logger.debug('CLI stderr chunk', {
        taskId: task.id,
        chunkNum: stderrChunks,
        chunkSize: chunk.length,
        totalSize: stderr.length,
        content: chunk.slice(0, 500)
      });
    });

    proc.on('close', async (code) => {
      clearTimeout(timeoutHandle);
      const duration = Date.now() - startTime;

      logger.debug('CLI process closed', {
        taskId: task.id,
        exitCode: code,
        timedOut,
        duration,
        stdoutSize: stdout.length,
        stderrSize: stderr.length,
        stdoutChunks,
        stderrChunks
      });

      // Log output summary for debugging
      if (stdout.length > 0) {
        logger.debug('CLI stdout summary', {
          taskId: task.id,
          size: stdout.length,
          firstChars: stdout.slice(0, 300),
          lastChars: stdout.length > 300 ? stdout.slice(-200) : undefined
        });
      }
      if (stderr.length > 0) {
        logger.debug('CLI stderr summary', {
          taskId: task.id,
          size: stderr.length,
          content: stderr.slice(0, 1000)
        });
      }

      // Clean up temp MCP config
      if (mcpConfigPath && isTempPath(mcpConfigPath)) {
        logger.debug('Cleaning up temp MCP config', { path: mcpConfigPath });
        unlink(mcpConfigPath).catch(() => {});
      }

      // Parse output using backend-specific parser
      logger.debug('Parsing CLI output', { taskId: task.id, backend: backendName });
      const parsed = backend.parseOutput(stdout, stderr, code || 0);
      logger.debug('Parsed output', {
        taskId: task.id,
        outputLength: parsed.output.length,
        hasTokens: !!parsed.tokens,
        tokens: parsed.tokens
      });

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
