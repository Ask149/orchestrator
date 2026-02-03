/**
 * CLI Backend Abstraction
 * 
 * Supports multiple CLI tools:
 * - copilot: GitHub Copilot CLI
 * - claude: Claude Code CLI
 */

import type { CLIBackend, CLIBackendOptions, ParsedOutput, CLIConfig } from './types.js';

/**
 * GitHub Copilot CLI Backend
 * 
 * Flags:
 * - copilot -p "prompt" — Programmatic mode
 * - --agent <name> — Use custom agent
 * - --allow-all-tools — Auto-approve all tools
 * - --model <model> — Specify model
 */
export const CopilotBackend: CLIBackend = {
  name: 'copilot',
  
  defaultCommand: '/opt/homebrew/bin/copilot',
  
  buildArgs(prompt: string, options: CLIBackendOptions): string[] {
    const args: string[] = [];
    
    // Note: We intentionally DON'T pass --agent for sub-agents
    // Custom agents have restricted tool sets (e.g., only report_intent, update_todo)
    // Without --agent, sub-agents get full built-in tools (bash, view, edit, create, grep)
    
    // MCP config for additional MCP servers (optional)
    // Copilot CLI requires @ prefix for file paths
    if (options.mcpConfigPath) {
      args.push('--additional-mcp-config', `@${options.mcpConfigPath}`);
    }
    
    // Prompt (programmatic mode)
    args.push('-p', prompt);
    
    // Auto-approve tools for autonomous execution
    if (options.allowAllTools !== false) {
      args.push('--allow-all-tools');
      // Also allow access to all file paths for sub-agent autonomy
      args.push('--allow-all-paths');
    }
    
    // Model selection
    if (options.model) {
      args.push('--model', options.model);
    }
    
    return args;
  },
  
  buildEnv(mcpConfigPath: string | null, baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return {
      ...baseEnv,
      // Copilot CLI reads MCP config from ~/.copilot/ or COPILOT_MCP_CONFIG
      ...(mcpConfigPath && { COPILOT_MCP_CONFIG: mcpConfigPath })
    };
  },
  
  parseOutput(stdout: string, _stderr: string, _exitCode: number): ParsedOutput {
    // Parse token usage if present (format: "123 in, 456 out")
    let tokens: { in: number; out: number } | undefined;
    const tokenMatch = stdout.match(/(\d+)\s*in,\s*(\d+)\s*out/);
    if (tokenMatch) {
      tokens = {
        in: parseInt(tokenMatch[1], 10),
        out: parseInt(tokenMatch[2], 10)
      };
    }
    
    return {
      output: stdout.trim(),
      tokens
    };
  }
};

/**
 * Claude Code CLI Backend
 * 
 * Flags:
 * - claude -p "prompt" — Print mode (non-interactive)
 * - --output-format json — JSON output for parsing
 * - --mcp-config <path> — Load MCP servers
 * - --dangerously-skip-permissions — Skip permission prompts
 * - --max-turns <n> — Limit agentic turns
 * - --model <model> — Set model
 */
export const ClaudeBackend: CLIBackend = {
  name: 'claude',
  
  defaultCommand: 'claude',
  
  buildArgs(prompt: string, options: CLIBackendOptions): string[] {
    const args: string[] = [];
    
    // Prompt (print mode)
    args.push('-p', prompt);
    
    // Output format for parsing
    args.push('--output-format', 'stream-json');
    
    // MCP config path
    if (options.mcpConfigPath) {
      args.push('--mcp-config', options.mcpConfigPath);
    }
    
    // Skip permissions for autonomous execution
    if (options.allowAllTools !== false) {
      args.push('--dangerously-skip-permissions');
    }
    
    // Max turns
    if (options.maxTurns) {
      args.push('--max-turns', options.maxTurns.toString());
    }
    
    // Model selection
    if (options.model) {
      args.push('--model', options.model);
    }
    
    return args;
  },
  
  buildEnv(_mcpConfigPath: string | null, baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return { ...baseEnv };
  },
  
  parseOutput(stdout: string, _stderr: string, _exitCode: number): ParsedOutput {
    // Claude stream-json output is newline-delimited JSON
    // Try to extract the final result
    const lines = stdout.trim().split('\n');
    let finalOutput = '';
    let tokens: { in: number; out: number } | undefined;
    
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        
        // Extract assistant message content
        if (parsed.type === 'assistant' && parsed.message?.content) {
          const textBlocks = parsed.message.content.filter(
            (c: { type: string; text?: string }) => c.type === 'text'
          );
          finalOutput = textBlocks.map((c: { text: string }) => c.text).join('\n');
        }
        
        // Extract usage stats
        if (parsed.type === 'result' && parsed.usage) {
          tokens = {
            in: parsed.usage.input_tokens || 0,
            out: parsed.usage.output_tokens || 0
          };
        }
      } catch {
        // Not JSON, treat as plain text
        if (!finalOutput) finalOutput = stdout.trim();
      }
    }
    
    return {
      output: finalOutput || stdout.trim(),
      tokens
    };
  }
};

/**
 * Registry of available backends
 */
export const BackendRegistry: Record<string, CLIBackend> = {
  copilot: CopilotBackend,
  claude: ClaudeBackend
};

/**
 * Get backend by name
 */
export function getBackend(name: string): CLIBackend | undefined {
  return BackendRegistry[name.toLowerCase()];
}

/**
 * Load CLI configuration
 */
export function loadCLIConfig(configPath: string): Promise<CLIConfig> {
  return import('fs/promises').then(async ({ readFile }) => {
    try {
      const content = await readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      return config.cli || {
        backend: 'copilot',
        copilot: { agent: 'job-search' }
      };
    } catch {
      // Default to copilot if config not found
      return {
        backend: 'copilot',
        copilot: { agent: 'job-search' }
      };
    }
  });
}
