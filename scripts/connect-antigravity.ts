#!/usr/bin/env npx tsx
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * 1-Command Easy Connector: Registers LOW Memory MCP Server in Antigravity (`~/.gemini/config/mcp_config.json`
 * and `~/.gemini/antigravity/mcp_config.json`).
 *
 * Usage:
 *   npm run connect:antigravity
 *   npm run connect:antigravity -- https://low-web-402708876408.us-central1.run.app
 */
const remoteUrlArg = process.argv[2]?.trim();
const homeDir = os.homedir();
const projectRoot = path.resolve(import.meta.dirname, '..');
const mcpScriptPath = path.join(projectRoot, 'scripts', 'low-mcp-server.ts');

const configPaths = [
  path.join(homeDir, '.gemini', 'config', 'mcp_config.json'),
  path.join(homeDir, '.gemini', 'antigravity', 'mcp_config.json'),
];

const serverEntry = remoteUrlArg
  ? {
      url: `${remoteUrlArg.replace(/\/$/, '')}/api/mcp`,
    }
  : {
      command: 'npx',
      args: ['tsx', mcpScriptPath],
      env: {
        LOW_ORG_ID: 'org-berezovsky',
        LOW_UID: 'berezovsky360',
      },
    };

for (const cfgPath of configPaths) {
  const dir = path.dirname(cfgPath);
  fs.mkdirSync(dir, { recursive: true });

  let existing: { mcpServers?: Record<string, unknown> } = {};
  if (fs.existsSync(cfgPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as {
        mcpServers?: Record<string, unknown>;
      };
    } catch {
      existing = {};
    }
  }

  existing.mcpServers = {
    ...(existing.mcpServers ?? {}),
    'low-memory': serverEntry,
  };

  fs.writeFileSync(cfgPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
  console.log(`✓ Connected 'low-memory' in ${cfgPath}`);
}

console.log(
  remoteUrlArg
    ? `✓ Antigravity is now connected to remote LOW Memory: ${remoteUrlArg.replace(/\/$/, '')}/api/mcp`
    : `✓ Antigravity is now connected to local LOW Memory (${mcpScriptPath})`
);
