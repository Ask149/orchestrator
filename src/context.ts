/**
 * Context handling - file reading and prompt enrichment
 */

import { readFile } from 'fs/promises';
import { execSync } from 'child_process';
import path from 'path';
import type { TaskContext, FileContext } from './types.js';

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
        try {
          const result = execSync(
            `grep -i "${fileCtx.pattern}" "${fullPath}" | head -20`,
            { encoding: 'utf-8', timeout: 5000 }
          );
          return `${fileCtx.path} (grep "${fileCtx.pattern}"):\n${result.trim() || '[no matches]'}`;
        } catch {
          return `${fileCtx.path} (grep "${fileCtx.pattern}"): [no matches]`;
        }
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
 */
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

  const enrichedPrompt = `--- CONTEXT (from parent agent) ---
${contextParts.join('\n\n')}

--- TASK ---
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
