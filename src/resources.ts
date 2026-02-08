/**
 * MCP Resources for Orchestrator
 * 
 * Exposes orchestrator logs and config as MCP resources:
 * - logs://orchestrator/app - Application logs (JSONL)
 * - logs://orchestrator/recent - Tail of application logs (JSONL)
 * - config://orchestrator/current - Current configuration
 * - health://orchestrator/status - Health status (same as check_health tool)
 * - state://orchestrator/active_tasks - Current active task IDs
 */

import { readFile, access, constants } from 'fs/promises';
import os from 'os';
import path from 'path';
import { logger } from './logger.js';
import { checkHealth } from './health.js';
import { activeTasks } from './spawn.js';

// Cross-platform config dir (matches logger.ts)
const IS_WINDOWS = process.platform === 'win32';
const HOME_DIR = os.homedir();
const WINDOWS_CONFIG_BASE = process.env.LOCALAPPDATA || process.env.APPDATA || HOME_DIR;
const CONFIG_DIR = IS_WINDOWS
  ? path.join(WINDOWS_CONFIG_BASE, 'orchestrator')
  : path.join(HOME_DIR, '.config', 'orchestrator');
const LOG_DIR = path.join(CONFIG_DIR, 'logs');

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export const AVAILABLE_RESOURCES: ResourceDefinition[] = [
  {
    uri: 'logs://orchestrator/app',
    name: 'Application Logs',
    description: 'MCP Orchestrator application logs in JSONL format. Contains execution history, errors, and debug information.',
    mimeType: 'application/jsonl'
  },
  {
    uri: 'logs://orchestrator/recent',
    name: 'Recent Application Logs',
    description: 'Tail of MCP Orchestrator application logs (last ~200 lines) in JSONL format.',
    mimeType: 'application/jsonl'
  },
  {
    uri: 'config://orchestrator/current',
    name: 'Current Configuration',
    description: 'Current orchestrator configuration including CLI backend settings and MCP server definitions.',
    mimeType: 'application/json'
  },
  {
    uri: 'health://orchestrator/status',
    name: 'Health Status',
    description: 'Health status snapshot (CLI backends, platform, config presence).',
    mimeType: 'application/json'
  },
  {
    uri: 'state://orchestrator/active_tasks',
    name: 'Active Tasks',
    description: 'Current in-flight task IDs tracked for graceful shutdown.',
    mimeType: 'application/json'
  }
];

/**
 * Get the application log content
 */
export async function getLogResource(): Promise<{ content: string; found: boolean }> {
  const logFile = path.join(LOG_DIR, 'orchestrator.jsonl');
  logger.debug('Reading log resource', { logFile });
  
  try {
    await access(logFile, constants.R_OK);
    const content = await readFile(logFile, 'utf-8');
    logger.debug('Log resource read successfully', { size: content.length, lines: content.split('\n').length });
    return { content, found: true };
  } catch (error) {
    logger.debug('Log file not found or not readable', { logFile, error: String(error) });
    return {
      content: JSON.stringify({
        message: 'Log file not found or not readable',
        expectedPath: logFile,
        hint: 'Logs are created when the orchestrator processes tasks'
      }, null, 2),
      found: false
    };
  }
}

/**
 * Get the tail of the application log content (fixed size)
 */
export async function getRecentLogResource(
  maxLines: number = 200
): Promise<{ content: string; found: boolean }> {
  const logFile = path.join(LOG_DIR, 'orchestrator.jsonl');
  logger.debug('Reading recent log resource', { logFile, maxLines });

  try {
    await access(logFile, constants.R_OK);
    const content = await readFile(logFile, 'utf-8');
    const lines = content.split('\n').filter((l) => l.length > 0);
    const tail = lines.slice(Math.max(0, lines.length - maxLines)).join('\n') + (lines.length > 0 ? '\n' : '');
    logger.debug('Recent log resource read successfully', { totalLines: lines.length, returnedLines: Math.min(lines.length, maxLines) });
    return { content: tail, found: true };
  } catch (error) {
    logger.debug('Log file not found or not readable', { logFile, error: String(error) });
    return {
      content: JSON.stringify({
        message: 'Log file not found or not readable',
        expectedPath: logFile,
        hint: 'Logs are created when the orchestrator processes tasks'
      }, null, 2),
      found: false
    };
  }
}

/**
 * Get the current configuration
 */
export async function getConfigResource(): Promise<{ content: string; found: boolean }> {
  const configFile = path.join(CONFIG_DIR, 'config.json');
  const mcpConfigFile = path.join(CONFIG_DIR, 'mcp-subagent.json');
  
  logger.debug('Reading config resource', { configFile, mcpConfigFile });
  
  let hasMainConfig = false;
  let hasMcpConfig = false;
  
  const result: Record<string, unknown> = {
    configDir: CONFIG_DIR,
    platform: `${process.platform}-${process.arch}`
  };
  
  // Read main config
  try {
    await access(configFile, constants.R_OK);
    const content = await readFile(configFile, 'utf-8');
    result.cliConfig = JSON.parse(content);
    hasMainConfig = true;
    const cliSection = (result.cliConfig as Record<string, unknown>)?.cli as Record<string, unknown> | undefined;
    logger.debug('Main config loaded', { path: configFile, backend: cliSection?.backend });
  } catch (error) {
    logger.debug('Main config not found', { path: configFile, error: String(error) });
    result.cliConfig = {
      error: 'Config file not found',
      expectedPath: configFile
    };
  }
  
  // Read MCP subagent config
  try {
    await access(mcpConfigFile, constants.R_OK);
    const content = await readFile(mcpConfigFile, 'utf-8');
    result.mcpServers = JSON.parse(content);
    hasMcpConfig = true;
    const serverNames = Object.keys((result.mcpServers as Record<string, unknown>)?.mcpServers || {});
    logger.debug('MCP config loaded', { path: mcpConfigFile, serverCount: serverNames.length, servers: serverNames });
  } catch (error) {
    logger.debug('MCP config not found', { path: mcpConfigFile, error: String(error) });
    result.mcpServers = {
      error: 'MCP config file not found',
      expectedPath: mcpConfigFile
    };
  }
  
  // Add environment variables (filtered)
  result.environment = {
    ORCHESTRATOR_WORKSPACE: process.env.ORCHESTRATOR_WORKSPACE || '(not set)',
    ORCHESTRATOR_DEFAULT_BACKEND: process.env.ORCHESTRATOR_DEFAULT_BACKEND || '(not set)',
    LOG_LEVEL: process.env.LOG_LEVEL || '(not set, defaults to INFO)',
    COPILOT_CLI: process.env.COPILOT_CLI || '(not set, defaults to copilot)',
    CLAUDE_CLI: process.env.CLAUDE_CLI || '(not set, defaults to claude)'
  };

  logger.debug('Config resource assembled', {
    hasMainConfig,
    hasMcpConfig,
    platform: result.platform
  });
  
  return {
    content: JSON.stringify(result, null, 2),
    found: hasMainConfig || hasMcpConfig
  };
}

/**
 * Get current health status (same shape as check_health tool)
 */
export async function getHealthResource(): Promise<{ content: string; found: boolean }> {
  const health = await checkHealth();
  return { content: JSON.stringify(health, null, 2), found: true };
}

/**
 * Get currently active tasks
 */
export async function getActiveTasksResource(): Promise<{ content: string; found: boolean }> {
  const ids = Array.from(activeTasks.values());
  const result = {
    active_count: ids.length,
    active_task_ids: ids,
    timestamp: new Date().toISOString()
  };
  return { content: JSON.stringify(result, null, 2), found: true };
}

/**
 * Read a resource by URI
 */
export async function readResource(uri: string): Promise<{ content: string; mimeType: string }> {
  logger.debug('Reading resource', { uri });
  
  switch (uri) {
    case 'logs://orchestrator/app': {
      const logs = await getLogResource();
      logger.debug('Returning log resource', { found: logs.found, size: logs.content.length });
      return { content: logs.content, mimeType: 'application/jsonl' };
    }

    case 'logs://orchestrator/recent': {
      const logs = await getRecentLogResource();
      logger.debug('Returning recent log resource', { found: logs.found, size: logs.content.length });
      return { content: logs.content, mimeType: 'application/jsonl' };
    }
      
    case 'config://orchestrator/current': {
      const config = await getConfigResource();
      logger.debug('Returning config resource', { found: config.found, size: config.content.length });
      return { content: config.content, mimeType: 'application/json' };
    }

    case 'health://orchestrator/status': {
      const health = await getHealthResource();
      logger.debug('Returning health resource', { found: health.found, size: health.content.length });
      return { content: health.content, mimeType: 'application/json' };
    }

    case 'state://orchestrator/active_tasks': {
      const state = await getActiveTasksResource();
      logger.debug('Returning active tasks resource', { found: state.found, size: state.content.length });
      return { content: state.content, mimeType: 'application/json' };
    }
      
    default:
      throw new Error(`Unknown resource URI: ${uri}`);
  }
}
