#!/usr/bin/env node
/**
 * MCP Orchestrator Server
 * 
 * Exposes `spawn_subagents` tool for parallel sub-agent execution
 * Supports multiple CLI backends: copilot, claude
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { spawnSubAgents, getAvailableBackends } from './spawn.js';
import type { SpawnSubagentsInput, SpawnSubagentsOutput } from './types.js';

const DEFAULT_WORKSPACE = process.env.ORCHESTRATOR_WORKSPACE || process.cwd();
const DEFAULT_TIMEOUT = 120; // seconds

// Input validation schema
const FileContextSchema = z.object({
  path: z.string(),
  mode: z.enum(['full', 'summary', 'grep']).default('full'),
  pattern: z.string().optional(),
  hint: z.string().optional()
});

const TaskContextSchema = z.object({
  files: z.array(FileContextSchema).optional(),
  inline_data: z.record(z.unknown()).optional()
});

const SubAgentTaskSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  context: TaskContextSchema.optional(),
  mcp_servers: z.array(z.string()).optional(),
  workspace: z.string().optional(),
  timeout_seconds: z.number().optional(),
  cli_backend: z.enum(['copilot', 'claude']).optional()
});

const SpawnSubagentsInputSchema = z.object({
  tasks: z.array(SubAgentTaskSchema).min(1).max(10),
  default_timeout_seconds: z.number().optional(),
  default_workspace: z.string().optional()
});

// Create MCP server
const server = new Server(
  {
    name: 'mcp-orchestrator',
    version: '1.1.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'spawn_subagents',
        description: `Spawn parallel Copilot sub-agents for complex tasks that can be parallelized.

Use this when:
- A task can be broken into independent sub-tasks (e.g., research multiple companies)
- You need to gather information from multiple sources simultaneously
- A complex workflow has parallelizable steps

Each sub-agent runs in its own process with:
- Full Copilot CLI capabilities
- Access to specified MCP servers (browser, fetch, etc.)
- File context from parent (full, summary, or grep mode)
- Workspace awareness

Returns aggregated results with success/failure status per task.

Example: Research 3 companies in parallel
{
  "tasks": [
    {"id": "stripe", "prompt": "Find SDE-2 roles at Stripe", "mcp_servers": ["playwright"]},
    {"id": "google", "prompt": "Find SDE-2 roles at Google", "mcp_servers": ["playwright"]},
    {"id": "meta", "prompt": "Find SDE-2 roles at Meta", "mcp_servers": ["playwright"]}
  ]
}`,
        inputSchema: {
          type: 'object',
          properties: {
            tasks: {
              type: 'array',
              description: 'Array of sub-agent tasks to run in parallel (max 10)',
              items: {
                type: 'object',
                properties: {
                  id: {
                    type: 'string',
                    description: 'Unique identifier for this task'
                  },
                  prompt: {
                    type: 'string',
                    description: 'The prompt/task for the sub-agent'
                  },
                  context: {
                    type: 'object',
                    description: 'Context to pass to sub-agent',
                    properties: {
                      files: {
                        type: 'array',
                        description: 'Files to include in context',
                        items: {
                          type: 'object',
                          properties: {
                            path: { type: 'string', description: 'File path (relative to workspace or absolute)' },
                            mode: { type: 'string', enum: ['full', 'summary', 'grep'], description: 'How to include file' },
                            pattern: { type: 'string', description: 'Grep pattern (required if mode is grep)' },
                            hint: { type: 'string', description: 'Human-readable hint about the file' }
                          },
                          required: ['path']
                        }
                      },
                      inline_data: {
                        type: 'object',
                        description: 'Inline data to pass to sub-agent'
                      }
                    }
                  },
                  mcp_servers: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'MCP servers to enable (e.g., ["playwright", "perplexity"])'
                  },
                  workspace: {
                    type: 'string',
                    description: 'Working directory for sub-agent'
                  },
                  timeout_seconds: {
                    type: 'number',
                    description: 'Timeout for this task (default: 120s)'
                  },
                  cli_backend: {
                    type: 'string',
                    enum: ['copilot', 'claude'],
                    description: 'CLI backend to use for this task (default: from config)'
                  }
                },
                required: ['id', 'prompt']
              }
            },
            default_timeout_seconds: {
              type: 'number',
              description: 'Default timeout for all tasks (default: 120s)'
            },
            default_workspace: {
              type: 'string',
              description: 'Default workspace for all tasks'
            }
          },
          required: ['tasks']
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'spawn_subagents') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  // Validate input
  const parseResult = SpawnSubagentsInputSchema.safeParse(request.params.arguments);
  if (!parseResult.success) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'Invalid input',
            details: parseResult.error.errors
          }, null, 2)
        }
      ]
    };
  }

  const input: SpawnSubagentsInput = parseResult.data;
  const defaultWorkspace = input.default_workspace || DEFAULT_WORKSPACE;
  const defaultTimeout = input.default_timeout_seconds || DEFAULT_TIMEOUT;

  console.error(`[orchestrator] Spawning ${input.tasks.length} sub-agents...`);

  const startTime = Date.now();
  const results = await spawnSubAgents(input.tasks, defaultWorkspace, defaultTimeout);
  const totalDuration = Date.now() - startTime;

  const output: SpawnSubagentsOutput = {
    completed: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    total: results.length,
    results,
    total_duration_ms: totalDuration
  };

  console.error(`[orchestrator] Completed: ${output.completed}/${output.total} in ${totalDuration}ms`);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(output, null, 2)
      }
    ]
  };
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[orchestrator] MCP Orchestrator server started');
}

main().catch((error) => {
  console.error('[orchestrator] Fatal error:', error);
  process.exit(1);
});
