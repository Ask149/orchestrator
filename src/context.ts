/**
 * Context handling - file reading and prompt enrichment
 */

import { readFile } from 'fs/promises';
import path from 'path';
import type { TaskContext, FileContext } from './types.js';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSearchRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'i');
  } catch {
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

  try {
    switch (fileCtx.mode) {
      case 'full': {
        const content = await readFile(fullPath, 'utf-8');
        return `${fileCtx.path}:\n${content}`;
      }

      case 'summary': {
        const content = await readFile(fullPath, 'utf-8');
        // For JSON files, show structure
        if (fullPath.endsWith('.json')) {
          try {
            const parsed = JSON.parse(content);
            const keys = Object.keys(parsed);
            return `${fileCtx.path} (JSON, ${keys.length} top-level keys): ${keys.slice(0, 10).join(', ')}${keys.length > 10 ? '...' : ''}`;
          } catch {
            // Not valid JSON, fall through
          }
        }
        // For other files, show line count and first/last lines
        const lines = content.split('\n');
        const preview = lines.length > 10
          ? `${lines.slice(0, 5).join('\n')}\n... (${lines.length - 10} lines) ...\n${lines.slice(-5).join('\n')}`
          : content;
        return `${fileCtx.path} (${lines.length} lines):\n${preview}`;
      }

      case 'grep': {
        if (!fileCtx.pattern) {
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

        return `${fileCtx.path} (grep "${fileCtx.pattern}"):\n${matches.length > 0 ? matches.join('\n') : '[no matches]'}`;
      }

      default:
        return `${fileCtx.path}: [unknown mode: ${fileCtx.mode}]`;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
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
    contextParts.push(`inline_data: ${JSON.stringify(context.inline_data, null, 2)}`);
  }

  // Build final prompt
  if (contextParts.length === 0) {
    return { prompt: originalPrompt, filesRead };
  }

  // Note: Don't start with `---` as Claude CLI interprets it as an option flag
  let contextStr = contextParts.join('\n\n');

  // Truncate context if too long (preserve task prompt space)
  const maxContextLen = MAX_PROMPT_LENGTH - originalPrompt.length - 100;
  if(contextStr.length > maxContextLen && maxContextLen > 500) {
    contextStr = contextStr.slice(0, maxContextLen) + `\n... (context truncated for command line limits, total length ${contextStr.length} chars) ...`;
  }

  const enrichedPrompt = `[CONTEXT from parent agent]
${contextStr}

[TASK]
${originalPrompt}`;

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
