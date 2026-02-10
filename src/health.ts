#!/usr/bin/env node
/**
 * Health Check CLI for MCP Orchestrator
 *
 * Usage:
 *   node dist/health.js
 *   npm run health
 *
 * Exit codes:
 *   0 - At least one backend available
 *   1 - No backends available
 */

import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { BackendRegistry } from './backends.js';

// Cross-platform config dir
const IS_WINDOWS = process.platform === 'win32';
const HOME_DIR = os.homedir();
const WINDOWS_CONFIG_BASE = process.env.LOCALAPPDATA || process.env.APPDATA || HOME_DIR;
const CONFIG_DIR = IS_WINDOWS
  ? path.join(WINDOWS_CONFIG_BASE, 'orchestrator')
  : path.join(HOME_DIR, '.config', 'orchestrator');

interface BackendStatus {
  available: boolean;
  version?: string;
  error?: string;
}

interface HealthCheckResult {
  healthy: boolean;
  timestamp: string;
  platform: string;
  configDir: string;
  backends: Record<string, BackendStatus>;
  config: {
    exists: boolean;
    defaultBackend?: string;
  };
}

/**
 * Check if a CLI command is available
 */
async function checkBackend(
  command: string,
  name: string
): Promise<BackendStatus> {
  return new Promise((resolve) => {
    const proc = spawn(command, ['--version'], {
      timeout: 5000,
      shell: IS_WINDOWS,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({
          available: true,
          version: stdout.trim().split('\n')[0] || 'unknown'
        });
      } else {
        resolve({
          available: false,
          error: stderr.trim() || `Exit code: ${code}`
        });
      }
    });

    proc.on('error', (error) => {
      resolve({
        available: false,
        error: error.message
      });
    });
  });
}

/**
 * Deep auth validation — run a trivial prompt to verify the CLI is actually authenticated.
 * Needed because some CLIs (e.g., Claude) pass --version without auth but fail on real prompts.
 */
async function checkBackendAuth(
  name: string
): Promise<{ authenticated: boolean; error?: string }> {
  const backend = BackendRegistry[name];
  if (!backend) return { authenticated: false, error: 'Unknown backend' };

  let command = backend.defaultCommand;
  if (name === 'claude' && process.env.CLAUDE_CLI) {
    command = process.env.CLAUDE_CLI;
  }

  return new Promise((resolve) => {
    const proc = spawn(command, ['-p', 'respond with ok', '--output-format', 'text', '--max-turns', '1'], {
      timeout: 15000,
      shell: IS_WINDOWS,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ authenticated: true });
      } else {
        const output = (stdout + stderr).toLowerCase();
        const isAuthError = output.includes('invalid api key') ||
                           output.includes('login') ||
                           output.includes('unauthorized') ||
                           output.includes('authentication');
        resolve({
          authenticated: false,
          error: isAuthError
            ? 'Not authenticated (API key missing or invalid)'
            : `Prompt failed with exit code ${code}: ${(stdout + stderr).trim().slice(0, 200)}`
        });
      }
    });

    proc.on('error', (error) => {
      resolve({ authenticated: false, error: error.message });
    });
  });
}

/**
 * Check if config file exists and get default backend
 */
async function checkConfig(): Promise<{ exists: boolean; defaultBackend?: string }> {
  const configPath = path.join(CONFIG_DIR, 'config.json');
  try {
    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content);
    return {
      exists: true,
      defaultBackend: config.cli?.backend || 'copilot'
    };
  } catch {
    return { exists: false };
  }
}

/**
 * Run full health check
 */
export async function checkHealth(): Promise<HealthCheckResult> {
  const backends: Record<string, BackendStatus> = {};

  // Check each registered backend
  for (const [name, backend] of Object.entries(BackendRegistry)) {
    // Check env override first
    let command = backend.defaultCommand;
    if (name === 'copilot' && process.env.COPILOT_CLI) {
      command = process.env.COPILOT_CLI;
    } else if (name === 'claude' && process.env.CLAUDE_CLI) {
      command = process.env.CLAUDE_CLI;
    }

    backends[name] = await checkBackend(command, name);
  }

  // Deep-validate Claude auth: --version succeeds even without login,
  // but actual prompts fail with "Invalid API key". Run a quick prompt to catch this.
  if (backends['claude']?.available) {
    const authStatus = await checkBackendAuth('claude');
    if (!authStatus.authenticated) {
      backends['claude'] = {
        available: true,
        version: backends['claude'].version,
        error: `CLI found but not authenticated: ${authStatus.error}. Run: claude login`
      };
    }
  }

  const config = await checkConfig();
  const healthy = Object.values(backends).some((b) => b.available && !b.error);

  return {
    healthy,
    timestamp: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    configDir: CONFIG_DIR,
    backends,
    config
  };
}

// CLI entrypoint
if (process.argv[1]?.endsWith('health.js') || process.argv[1]?.endsWith('health.ts')) {
  checkHealth()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.healthy ? 0 : 1);
    })
    .catch((error) => {
      console.error(JSON.stringify({ healthy: false, error: error.message }, null, 2));
      process.exit(1);
    });
}
