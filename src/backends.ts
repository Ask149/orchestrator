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
 * - --allow-all-tools — Auto-approve all tools (alias: --yolo)
 * - --allow-all-paths — Allow access to all file paths
 * - --yolo — Full bypass mode (2026), alias for --allow-all-tools
 * - --model <model> — Specify model
 */
/**
 * MCP Tool Fallback Instructions
 * 
 * Copilot CLI doesn't load MCP servers in non-interactive mode.
 * These instructions help sub-agents use npm packages directly as fallback.
 */
const BROWSER_AUTOMATION_FALLBACK = `
## Browser Automation (No MCP Tools Available)

You do NOT have browser_navigate or browser_snapshot MCP tools.
Use Node + Playwright directly (cross-platform):

### Basic (headless, no auth):
\`\`\`bash
node -e "const { chromium } = require('playwright'); (async () => { const browser = await chromium.launch({ headless: true }); const page = await browser.newPage(); await page.goto('YOUR_URL'); console.log('Title:', await page.title()); const content = await page.content(); console.log('Content:', content.slice(0, 2000)); await browser.close(); })().catch(err => { console.error(err); process.exit(1); });"
\`\`\`

### With Authenticated Session (for Google/Gemini/etc):
Use persistent browser context to reuse existing login sessions:
\`\`\`bash
node -e "const { chromium } = require('playwright'); const os = require('os'); const path = require('path'); (async () => { const userDataDir = path.join(os.homedir(), '.playwright-profile'); const browser = await chromium.launchPersistentContext(userDataDir, { headless: false }); const page = browser.pages()[0] || await browser.newPage(); await page.goto('YOUR_URL'); console.log('Title:', await page.title()); await browser.close(); })().catch(err => { console.error(err); process.exit(1); });"
\`\`\`

### Supported Sites Without Auth:
- perplexity.ai — Full functionality without login
- duckduckgo.com — Search without login

### Sites Requiring Auth (use persistent context):
- gemini.google.com — Requires Google sign-in
- chatgpt.com — Requires OpenAI sign-in
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
    
    // Note: We DON'T pass --additional-mcp-config because:
    // 1. Copilot CLI has strict schema validation (rejects command/args format in non-interactive)
    // 2. MCP servers require stdio communication that CLI doesn't set up automatically
    // Solution: Augment prompts with npm package instructions as fallback
    
    // Prompt (programmatic mode)
    args.push('-p', prompt);

    // Silent mode for cleaner output (not stats)
    args.push('-s');
    
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
    
    return args;
  },
  
  buildEnv(_mcpConfigPath: string | null, baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    // Sub-agents inherit MCP config from ~/.copilot/mcp-config.json automatically
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
    
    return args;
  },
  
  buildEnv(_mcpConfigPath: string | null, baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return { ...baseEnv };
  },
  
  parseOutput(stdout: string, _stderr: string, _exitCode: number): ParsedOutput {
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
