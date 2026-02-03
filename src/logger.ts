/**
 * Structured Logger for MCP Orchestrator
 * 
 * Features:
 * - Log levels (DEBUG, INFO, WARN, ERROR)
 * - JSONL file output (same dir as audit logs)
 * - Respects LOG_LEVEL environment variable
 * - Uses stderr (stdout reserved for MCP protocol)
 * - Auto-rotates at 10MB
 */

import { mkdir, appendFile, stat, rename } from 'fs/promises';
import os from 'os';
import path from 'path';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

// Cross-platform config dir (matches spawn.ts)
const IS_WINDOWS = process.platform === 'win32';
const HOME_DIR = os.homedir();
const WINDOWS_CONFIG_BASE = process.env.LOCALAPPDATA || process.env.APPDATA || HOME_DIR;
const CONFIG_DIR = IS_WINDOWS
  ? path.join(WINDOWS_CONFIG_BASE, 'orchestrator')
  : path.join(HOME_DIR, '.config', 'orchestrator');
const LOG_DIR = path.join(CONFIG_DIR, 'logs');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  taskId?: string;
  backend?: string;
  [key: string]: unknown;
}

class Logger {
  private level: LogLevel;
  private logDir: string;
  private logFile: string;
  private initialized = false;

  constructor() {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase() as LogLevel;
    this.level = envLevel && LEVELS[envLevel] !== undefined ? envLevel : 'INFO';
    this.logDir = LOG_DIR;
    this.logFile = path.join(this.logDir, 'orchestrator.jsonl');
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVELS[level] >= LEVELS[this.level];
  }

  private async ensureLogDir(): Promise<void> {
    if (!this.initialized) {
      try {
        await mkdir(this.logDir, { recursive: true });
        this.initialized = true;
      } catch {
        // Silent fail - logging should not break the app
      }
    }
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const stats = await stat(this.logFile);
      if (stats.size > MAX_LOG_SIZE) {
        const rotatedFile = `${this.logFile}.${Date.now()}`;
        await rename(this.logFile, rotatedFile);
      }
    } catch {
      // File doesn't exist yet, no rotation needed
    }
  }

  private formatConsole(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
    return `[${timestamp}] [${level.padEnd(5)}] ${message}`;
  }

  private async log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>
  ): Promise<void> {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context
    };

    // Always output to stderr (stdout reserved for MCP)
    console.error(this.formatConsole(level, message));

    // Write to JSONL file with rotation
    await this.ensureLogDir();
    try {
      await this.rotateIfNeeded();
      await appendFile(this.logFile, JSON.stringify(entry) + '\n');
    } catch {
      // Silent fail for file writes
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('DEBUG', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('INFO', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('WARN', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('ERROR', message, context);
  }

  /**
   * Log with task context (convenience method)
   */
  task(
    level: LogLevel,
    message: string,
    taskId: string,
    context?: Record<string, unknown>
  ): void {
    this.log(level, message, { taskId, ...context });
  }
}

// Singleton logger instance
export const logger = new Logger();
