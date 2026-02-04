/**
 * MCP Resources for Orchestrator
 * 
 * Exposes orchestrator logs and config as MCP resources:
 * - logs://orchestrator/app - Application logs (JSONL)
 * - config://orchestrator/current - Current configuration
 */

import { readFile, access, constants } from 'fs/promises';
import os from 'os';
import path from 'path';

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
    uri: 'config://orchestrator/current',
    name: 'Current Configuration',
    description: 'Current orchestrator configuration including CLI backend settings and MCP server definitions.',
    mimeType: 'application/json'
  }
];

/**
 * Get the application log content
 */
export async function getLogResource(): Promise<{ content: string; found: boolean }> {
  const logFile = path.join(LOG_DIR, 'orchestrator.jsonl');
  
  try {
    await access(logFile, constants.R_OK);
    const content = await readFile(logFile, 'utf-8');
    return { content, found: true };
  } catch {
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
  } catch {
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
  } catch {
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
  
  return {
    content: JSON.stringify(result, null, 2),
    found: hasMainConfig || hasMcpConfig
  };
}

/**
 * Read a resource by URI
 */
export async function readResource(uri: string): Promise<{ content: string; mimeType: string }> {
  switch (uri) {
    case 'logs://orchestrator/app':
      const logs = await getLogResource();
      return { content: logs.content, mimeType: 'application/jsonl' };
      
    case 'config://orchestrator/current':
      const config = await getConfigResource();
      return { content: config.content, mimeType: 'application/json' };
      
    default:
      throw new Error(`Unknown resource URI: ${uri}`);
  }
}
