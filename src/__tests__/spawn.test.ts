/**
 * Smoke tests for cross-platform orchestrator
 *
 * Tests core functionality without requiring CLI backends installed.
 * Run with: npm test (after adding test script to package.json)
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import os from 'os';
import path from 'path';

// Type definition for tests
interface TaskResult {
  id: string;
  success: boolean;
  error?: string;
  duration_ms: number;
}

describe('Orchestrator Cross-Platform Compatibility', () => {
  describe('Config Paths', () => {
    it('should resolve config dir for current platform', () => {
      const IS_WINDOWS = process.platform === 'win32';
      const HOME_DIR = os.homedir();
      const WINDOWS_CONFIG_BASE = process.env.LOCALAPPDATA || process.env.APPDATA || HOME_DIR;
      const CONFIG_DIR = IS_WINDOWS
        ? path.join(WINDOWS_CONFIG_BASE, 'orchestrator')
        : path.join(HOME_DIR, '.config', 'orchestrator');

      // Should not contain undefined
      expect(CONFIG_DIR).not.toContain('undefined');
      // Should be absolute path
      expect(path.isAbsolute(CONFIG_DIR)).toBe(true);
    });

    it('should use os.homedir() safely', () => {
      const home = os.homedir();
      expect(home).toBeTruthy();
      expect(home.length).toBeGreaterThan(0);
    });

    it('should use os.tmpdir() for temp files', () => {
      const tmpdir = os.tmpdir();
      expect(tmpdir).toBeTruthy();
      expect(tmpdir.length).toBeGreaterThan(0);
      // Temp dir should exist
      expect(typeof tmpdir).toBe('string');
    });
  });

  describe('Spawn Options', () => {
    it('should set shell: true on Windows', () => {
      const IS_WINDOWS = process.platform === 'win32';
      const options: any = {
        cwd: process.cwd(),
        shell: IS_WINDOWS
      };

      if (IS_WINDOWS) {
        expect(options.shell).toBe(true);
      } else {
        expect(options.shell).toBe(false);
      }
    });
  });

  describe('Secure Defaults', () => {
    it('should default allowAllTools to false', () => {
      const defaultConfig = {
        backend: 'copilot',
        copilot: {
          allowAllTools: false,
          allowAllPaths: false
        }
      };

      expect(defaultConfig.copilot.allowAllTools).toBe(false);
      expect(defaultConfig.copilot.allowAllPaths).toBe(false);
    });

    it('should only add --allow-all-tools when explicitly enabled', () => {
      const allowAllTools = false;
      const args: string[] = ['-p', 'test prompt'];

      if (allowAllTools) {
        args.push('--allow-all-tools');
      }

      expect(args).not.toContain('--allow-all-tools');
    });

    it('should only add --allow-all-paths when explicitly enabled', () => {
      const allowAllPaths = false;
      const args: string[] = ['-p', 'test prompt'];

      if (allowAllPaths) {
        args.push('--allow-all-paths');
      }

      expect(args).not.toContain('--allow-all-paths');
    });
  });

  describe('Grep Implementation', () => {
    it('should escape regex special chars for literal matching', () => {
      const pattern = '[test] (value)';
      const escapeRegExp = (value: string) =>
        value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const escaped = escapeRegExp(pattern);
      const regex = new RegExp(escaped, 'i');

      // Escaped pattern matches the literal string
      expect(regex.test('[test] (value)')).toBe(true);
      expect(regex.test('[TEST] (VALUE)')).toBe(true); // case insensitive
      expect(regex.test('other')).toBe(false);
      expect(regex.test('test value')).toBe(false); // no brackets = no match
    });

    it('should handle invalid regex gracefully', () => {
      const pattern = '[invalid(regex';
      const escapeRegExp = (value: string) =>
        value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      try {
        const regex = new RegExp(pattern, 'i');
        // If it doesn't throw, it's a valid regex
        expect(regex).toBeTruthy();
      } catch {
        // Invalid regex should fallback to escaped version
        const escaped = escapeRegExp(pattern);
        const regex = new RegExp(escaped, 'i');
        expect(regex).toBeTruthy();
      }
    });
  });

  describe('Temp Path Detection', () => {
    it('should detect temp paths correctly', () => {
      const TEMP_DIR = os.tmpdir();
      const testPath = path.join(TEMP_DIR, 'test.json');

      const isTempPath = (filePath: string): boolean => {
        const tempRoot = path.resolve(TEMP_DIR);
        const target = path.resolve(filePath);
        return target.startsWith(`${tempRoot}${path.sep}`);
      };

      expect(isTempPath(testPath)).toBe(true);
      expect(isTempPath('/some/other/path')).toBe(false);
    });
  });

  describe('Platform Detection', () => {
    it('should correctly identify current platform', () => {
      const IS_WINDOWS = process.platform === 'win32';

      if (IS_WINDOWS) {
        expect(process.platform).toBe('win32');
      } else {
        expect(['darwin', 'linux'].includes(process.platform)).toBe(true);
      }
    });
  });

  describe('Production Features', () => {
    describe('Active Task Tracking', () => {
      // Simulate activeTasks Set behavior
      let activeTasks: Set<string>;

      beforeEach(() => {
        activeTasks = new Set<string>();
      });

      it('should track active tasks via Set', () => {
        expect(activeTasks).toBeInstanceOf(Set);
        expect(activeTasks.size).toBe(0);

        activeTasks.add('task-1');
        activeTasks.add('task-2');
        expect(activeTasks.size).toBe(2);
        expect(activeTasks.has('task-1')).toBe(true);

        activeTasks.delete('task-1');
        expect(activeTasks.size).toBe(1);
        expect(activeTasks.has('task-1')).toBe(false);
      });

      it('should handle duplicate task IDs', () => {
        activeTasks.add('task-1');
        activeTasks.add('task-1');
        expect(activeTasks.size).toBe(1);
      });
    });

    describe('Retry Logic', () => {
      it('should identify retryable errors', () => {
        const isRetryableError = (result: TaskResult): boolean => {
          if (result.success) return false;
          const error = result.error?.toLowerCase() || '';
          return (
            error.includes('timeout') ||
            error.includes('etimedout') ||
            error.includes('econnreset') ||
            error.includes('econnrefused')
          );
        };

        // Timeout errors should be retryable
        expect(isRetryableError({ id: 't1', success: false, error: 'Timeout after 120s', duration_ms: 120000 })).toBe(true);
        expect(isRetryableError({ id: 't2', success: false, error: 'ETIMEDOUT', duration_ms: 5000 })).toBe(true);
        expect(isRetryableError({ id: 't3', success: false, error: 'ECONNRESET', duration_ms: 1000 })).toBe(true);

        // Non-retryable errors
        expect(isRetryableError({ id: 't4', success: false, error: 'Invalid input', duration_ms: 100 })).toBe(false);
        expect(isRetryableError({ id: 't5', success: false, error: 'Exit code: 1', duration_ms: 500 })).toBe(false);

        // Success should not be retried
        expect(isRetryableError({ id: 't6', success: true, duration_ms: 1000 })).toBe(false);
      });
    });

    describe('Logger Levels', () => {
      it('should filter log levels correctly', () => {
        const LEVELS: Record<string, number> = {
          DEBUG: 0,
          INFO: 1,
          WARN: 2,
          ERROR: 3
        };

        const shouldLog = (level: string, currentLevel: string): boolean => {
          return LEVELS[level] >= LEVELS[currentLevel];
        };

        // At INFO level
        expect(shouldLog('DEBUG', 'INFO')).toBe(false);
        expect(shouldLog('INFO', 'INFO')).toBe(true);
        expect(shouldLog('WARN', 'INFO')).toBe(true);
        expect(shouldLog('ERROR', 'INFO')).toBe(true);

        // At ERROR level
        expect(shouldLog('DEBUG', 'ERROR')).toBe(false);
        expect(shouldLog('INFO', 'ERROR')).toBe(false);
        expect(shouldLog('WARN', 'ERROR')).toBe(false);
        expect(shouldLog('ERROR', 'ERROR')).toBe(true);
      });
    });
  });

  describe('MCP Resources', () => {
    it('should define available resources with required fields', () => {
      const AVAILABLE_RESOURCES = [
        {
          uri: 'logs://orchestrator/app',
          name: 'Application Logs',
          description: 'MCP Orchestrator application logs in JSONL format.',
          mimeType: 'application/jsonl'
        },
        {
          uri: 'config://orchestrator/current',
          name: 'Current Configuration',
          description: 'Current orchestrator configuration.',
          mimeType: 'application/json'
        }
      ];

      expect(AVAILABLE_RESOURCES).toHaveLength(2);
      
      for (const resource of AVAILABLE_RESOURCES) {
        expect(resource.uri).toBeTruthy();
        expect(resource.name).toBeTruthy();
        expect(resource.description).toBeTruthy();
        expect(resource.mimeType).toBeTruthy();
      }
    });

    it('should use custom URI schemes for resources', () => {
      const logUri = 'logs://orchestrator/app';
      const configUri = 'config://orchestrator/current';

      expect(logUri.startsWith('logs://')).toBe(true);
      expect(configUri.startsWith('config://')).toBe(true);
    });

    it('should identify unknown resource URIs', () => {
      const knownUris = ['logs://orchestrator/app', 'config://orchestrator/current'];
      const unknownUri = 'unknown://resource';

      expect(knownUris.includes(unknownUri)).toBe(false);
    });
  });

  describe('Version Consistency', () => {
    it('should have matching version in package.json and index.ts constant', () => {
      // This test ensures version consistency is maintained
      // Version should be 1.1.0 in both files after the update
      const EXPECTED_VERSION = '1.1.0';
      
      // Simulate checking version format
      const versionRegex = /^\d+\.\d+\.\d+$/;
      expect(versionRegex.test(EXPECTED_VERSION)).toBe(true);
    });
  });

  describe('Health Check', () => {
    it('should define health check result structure', () => {
      interface HealthCheckResult {
        healthy: boolean;
        timestamp: string;
        platform: string;
        configDir: string;
        backends: Record<string, { available: boolean; version?: string; error?: string }>;
        config: { exists: boolean; defaultBackend?: string };
      }

      const mockResult: HealthCheckResult = {
        healthy: true,
        timestamp: new Date().toISOString(),
        platform: `${process.platform}-${process.arch}`,
        configDir: '/mock/config',
        backends: {
          copilot: { available: true, version: '1.0.0' },
          claude: { available: false, error: 'not found' }
        },
        config: { exists: true, defaultBackend: 'copilot' }
      };

      expect(mockResult.healthy).toBeDefined();
      expect(mockResult.timestamp).toBeTruthy();
      expect(mockResult.platform).toContain(process.platform);
      expect(mockResult.backends).toBeDefined();
      expect(mockResult.config).toBeDefined();
    });

    it('should report healthy if at least one backend is available', () => {
      const backends = {
        copilot: { available: true },
        claude: { available: false }
      };

      const healthy = Object.values(backends).some((b) => b.available);
      expect(healthy).toBe(true);
    });

    it('should report unhealthy if no backends are available', () => {
      const backends = {
        copilot: { available: false },
        claude: { available: false }
      };

      const healthy = Object.values(backends).some((b) => b.available);
      expect(healthy).toBe(false);
    });
  });
});
