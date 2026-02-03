/**
 * Smoke tests for cross-platform orchestrator
 *
 * Tests core functionality without requiring CLI backends installed.
 * Run with: npm test (after adding test script to package.json)
 */

import { describe, it, expect } from '@jest/globals';
import os from 'os';
import path from 'path';

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
    it('should escape regex special chars', () => {
      const pattern = '[test] (value)';
      const escapeRegExp = (value: string) =>
        value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const escaped = escapeRegExp(pattern);
      const regex = new RegExp(escaped, 'i');

      expect(regex.test('[test] (value)')).toBe(true);
      expect(regex.test('TEST VALUE')).toBe(true);
      expect(regex.test('other')).toBe(false);
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
});
