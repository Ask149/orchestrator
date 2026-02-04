/**
 * CLI Backend Abstraction
 *
 * Supports multiple CLI tools:
 * - copilot: GitHub Copilot CLI
 * - claude: Claude Code CLI
 */

import type { CLIBackend, CLIBackendOptions, ParsedOutput, CLIConfig } from './types.js';
import { logger } from './logger.js';

/**
 * GitHub Copilot CLI Backend
 *
 * Flags:
 * - copilot -p "prompt" — Programmatic mode
 * - --agent <name> — Use custom agent
 * - --allow-all-tools — Auto-approve all tools
 * - --model <model> — Specify model
 */
/**
 * MCP Tool Fallback Instructions
 *
 * Copilot CLI loads MCP servers from ~/.copilot/mcp-config.json in -p mode.
 * The --additional-mcp-config flag augments (not replaces) the default config.
 *
 * If MCP servers aren't configured in the default location, provide fallback instructions
 * so sub-agents can use npm packages directly.
 */
const BROWSER_AUTOMATION_FALLBACK = `
## Browser Automation Fallback

If playwright MCP tools are not available (not in ~/.copilot/mcp-config.json),
use Node.js + Playwright npm package directly (cross-platform):

\`\`\`bash
node -e "const { chromium } = require('playwright'); (async () => { const browser = await chromium.launch({ headless: true }); const page = await browser.newPage(); await page.goto('YOUR_URL'); console.log('Title:', await page.title()); const content = await page.content(); console.log('Content:', content.slice(0, 2000)); await browser.close(); })().catch(err => { console.error(err); process.exit(1); });"
\`\`\`
`;

export const CopilotBackend: CLIBackend = {
  name: 'copilot',

  defaultCommand: 'copilot',

  /**
   * Augment prompt with MCP fallback instructions if browser automation is needed
   */
  augmentPromptForMCP(prompt: string, mcpServers?: string[]): string {
    // If playwright is requested, add fallback instructions
    if (mcpServers?.includes('playwright')) {
      return `${prompt}\n\n${BROWSER_AUTOMATION_FALLBACK}`;
    }
    return prompt;
  },

  buildArgs(prompt: string, options: CLIBackendOptions): string[] {
    const args: string[] = [];

    // Note: We intentionally DON'T pass --agent for sub-agents
    // Custom agents have restricted tool sets (e.g., only report_intent, update_todo)
    // Without --agent, sub-agents get full built-in tools (bash, view, edit, create, grep)

    // Prompt (programmatic mode)
    args.push('-p', prompt);

    // Silent mode for cleaner output (no stats)
    args.push('-s');

    // MCP config - augment the default ~/.copilot/mcp-config.json with additional servers
    // Format: @<filepath> for file path (@ prefix required)
    // Note: MCP servers MUST be in ~/.copilot/mcp-config.json for -p mode
    //   - --additional-mcp-config AUGMENTS, doesn't replace the default config
    //   - mcp-subagent.json must include: "type" and "tools" fields (required for Copilot)
    //   - Windows: Use "cmd" with args ["/c", "npx", ...] for npx commands
    if (options.mcpConfigPath) {
      args.push('--additional-mcp-config', `@${options.mcpConfigPath}`);
    }

    // Auto-approve tools for autonomous execution
    if (options.allowAllTools) {
      args.push('--allow-all-tools');
    }

    // Allow access to all file paths for sub-agent autonomy
    if (options.allowAllPaths) {
      args.push('--allow-all-paths');
    }

    // Model selection
    if (options.model) {
      args.push('--model', options.model);
    }

    logger.debug('Copilot args built', {
      argsCount: args.length,
      mcpConfig: options.mcpConfigPath ? 'yes' : 'no',
      allowAllTools: options.allowAllTools,
      allowAllPaths: options.allowAllPaths,
      model: options.model || 'default',
      promptLength: prompt.length
    });

    return args;
  },

  buildEnv(_mcpConfigPath: string | null, baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    // Sub-agents use MCP config from ~/.copilot/mcp-config.json (required for -p mode)
    // The --additional-mcp-config flag augments this default config
    return { ...baseEnv };
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

    logger.debug('Copilot output parsed', {
      stdoutLength: stdout.length,
      hasTokens: !!tokens,
      tokens,
      outputPreview: stdout.slice(0, 200)
    });

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

    // Prompt (print mode for non-interactive)
    args.push('-p', prompt);

    // Use text output for simpler parsing
    args.push('--output-format', 'text');

    // MCP config - load additional MCP servers for this session
    // Note: Claude CLI accepts the same format as Copilot but "type" and "tools" are optional
    // Windows: Use "cmd" with args ["/c", "npx", ...] for npx commands
    // Requires --dangerously-skip-permissions for autonomous MCP tool use
    if (options.mcpConfigPath) {
      args.push('--mcp-config', options.mcpConfigPath);
    }

    // Skip permissions for autonomous execution
    if (options.allowAllTools) {
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

    logger.debug('Claude args built', {
      argsCount: args.length,
      mcpConfig: options.mcpConfigPath ? 'yes' : 'no',
      allowAllTools: options.allowAllTools,
      maxTurns: options.maxTurns,
      model: options.model || 'default',
      promptLength: prompt.length
    });

    return args;
  },

  buildEnv(_mcpConfigPath: string | null, baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return { ...baseEnv };
  },

  parseOutput(stdout: string, _stderr: string, _exitCode: number): ParsedOutput {
    // With text output format, stdout is plain text
    logger.debug('Claude output parsed', {
      stdoutLength: stdout.length,
      outputPreview: stdout.slice(0, 200)
    });

    return {
      output: stdout.trim(),
      tokens: undefined
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
        copilot: { agent: 'job-search', allowAllTools: false, allowAllPaths: false },
        claude: { allowAllTools: false }
      };
    } catch {
      // Default to copilot if config not found
      return {
        backend: 'copilot',
        copilot: { agent: 'job-search', allowAllTools: false, allowAllPaths: false },
        claude: { allowAllTools: false }
      };
    }
  });
}
