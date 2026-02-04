/**
 * Context handling - file reading and prompt enrichment
 */

import { readFile } from 'fs/promises';
import path from 'path';
import type { TaskContext, FileContext } from './types.js';
import { logger } from './logger.js';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSearchRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    logger.debug('Invalid regex pattern, escaping', { pattern });
    return new RegExp(escapeRegExp(pattern), 'i');
  }
}

/**
 * Read a file with the specified mode
 */
async function readFileWithMode(
  fileCtx: FileContext,
  workspace: string
): Promise<string> {
  const fullPath = path.isAbsolute(fileCtx.path)
    ? fileCtx.path
    : path.join(workspace, fileCtx.path);

  logger.debug('Reading file for context', {
    path: fileCtx.path,
    fullPath,
    mode: fileCtx.mode,
    pattern: fileCtx.pattern
  });

  try {
    switch (fileCtx.mode) {
      case 'full': {
        const content = await readFile(fullPath, 'utf-8');
        logger.debug('File read (full mode)', {
          path: fileCtx.path,
          size: content.length,
          lines: content.split('\n').length
        });
        return `${fileCtx.path}:\n${content}`;
      }

      case 'summary': {
        const content = await readFile(fullPath, 'utf-8');
        // For JSON files, show structure
        if (fullPath.endsWith('.json')) {
          try {
            const parsed = JSON.parse(content);
            const keys = Object.keys(parsed);
            logger.debug('File read (summary mode, JSON)', {
              path: fileCtx.path,
              topLevelKeys: keys.length
            });
            return `${fileCtx.path} (JSON, ${keys.length} top-level keys): ${keys.slice(0, 10).join(', ')}${keys.length > 10 ? '...' : ''}`;
          } catch {
            // Not valid JSON, fall through
            logger.debug('File is not valid JSON, using line-based summary', { path: fileCtx.path });
          }
        }
        // For other files, show line count and first/last lines
        const lines = content.split('\n');
        const preview = lines.length > 10
          ? `${lines.slice(0, 5).join('\n')}\n... (${lines.length - 10} lines) ...\n${lines.slice(-5).join('\n')}`
          : content;
        logger.debug('File read (summary mode)', {
          path: fileCtx.path,
          totalLines: lines.length,
          previewLines: Math.min(lines.length, 10)
        });
        return `${fileCtx.path} (${lines.length} lines):\n${preview}`;
      }

      case 'grep': {
        if (!fileCtx.pattern) {
          logger.warn('Grep mode without pattern', { path: fileCtx.path });
          return `${fileCtx.path}: [grep mode requires pattern]`;
        }

        const content = await readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        const regex = buildSearchRegex(fileCtx.pattern);
        const matches: string[] = [];

        for (const line of lines) {
          if (regex.test(line)) {
            matches.push(line);
            if (matches.length >= 20) break;
          }
        }

        logger.debug('File read (grep mode)', {
          path: fileCtx.path,
          pattern: fileCtx.pattern,
          totalLines: lines.length,
          matchCount: matches.length
        });
        return `${fileCtx.path} (grep "${fileCtx.pattern}"):\n${matches.length > 0 ? matches.join('\n') : '[no matches]'}`;
      }

      default:
        logger.warn('Unknown file read mode', { path: fileCtx.path, mode: fileCtx.mode });
        return `${fileCtx.path}: [unknown mode: ${fileCtx.mode}]`;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.debug('Failed to read file for context', { path: fileCtx.path, fullPath, error: msg });
    return `${fileCtx.path}: [error: ${msg}]`;
  }
}

/**
 * Build enriched prompt with context
 *
 * Note: Windows has ~8192 char command line limit, so we cap total prompt size
 */
const MAX_PROMPT_LENGTH = 6000; // Leave room for CLI args

export async function buildEnrichedPrompt(
  originalPrompt: string,
  context: TaskContext | undefined,
  workspace: string
): Promise<{ prompt: string; filesRead: string[] }> {
  logger.debug('Building enriched prompt', {
    originalPromptLength: originalPrompt.length,
    hasContext: !!context,
    fileCount: context?.files?.length || 0,
    hasInlineData: !!(context?.inline_data && Object.keys(context.inline_data).length > 0),
    workspace
  });

  const filesRead: string[] = [];
  const contextParts: string[] = [];

  // Process file context
  if (context?.files && context.files.length > 0) {
    for (const fileCtx of context.files) {
      const content = await readFileWithMode(fileCtx, workspace);
      contextParts.push(content);
      filesRead.push(fileCtx.path);

      // Add hint if provided
      if (fileCtx.hint) {
        contextParts.push(`  → Hint: ${fileCtx.hint}`);
      }
    }
  }

  // Process inline data
  if (context?.inline_data && Object.keys(context.inline_data).length > 0) {
    const inlineStr = JSON.stringify(context.inline_data, null, 2);
    logger.debug('Adding inline data to context', { size: inlineStr.length });
    contextParts.push(`inline_data: ${inlineStr}`);
  }

  // Build final prompt
  if (contextParts.length === 0) {
    logger.debug('No context to add, returning original prompt', { promptLength: originalPrompt.length });
    return { prompt: originalPrompt, filesRead };
  }

  // Note: Don't start with `---` as Claude CLI interprets it as an option flag
  let contextStr = contextParts.join('\n\n');

  // Truncate context if too long (preserve task prompt space)
  const maxContextLen = MAX_PROMPT_LENGTH - originalPrompt.length - 100;
  if (contextStr.length > maxContextLen && maxContextLen > 500) {
    logger.debug('Truncating context to fit command line limits', {
      originalSize: contextStr.length,
      maxSize: maxContextLen
    });
    contextStr = contextStr.slice(0, maxContextLen) + '\n... [context truncated for command line limits]';
  }

  const enrichedPrompt = `[CONTEXT from parent agent]
${contextStr}

[TASK]
${originalPrompt}`;

  logger.debug('Enriched prompt built', {
    filesRead,
    contextSize: contextStr.length,
    totalPromptSize: enrichedPrompt.length
  });

  return { prompt: enrichedPrompt, filesRead };
}

/**
 * Summarize large output for logging
 */
export function summarizeOutput(output: string, maxLength: number = 500): string {
  if (output.length <= maxLength) {
    return output;
  }
  const half = Math.floor(maxLength / 2) - 10;
  return `${output.slice(0, half)}\n... (${output.length - maxLength} chars truncated) ...\n${output.slice(-half)}`;
}
