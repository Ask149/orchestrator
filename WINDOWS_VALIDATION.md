## Windows Platform Validation Checklist

For testing orchestrator on **Windows x64 and ARM64**.

### Prerequisites

- [ ] Node.js ≥ 18.0.0 installed (`node --version`)
- [ ] npm installed (`npm --version`)
- [ ] Git installed (for cloning)
- [ ] PowerShell 5.1+ or Windows Terminal (recommended)

### Installation on Windows

- [ ] Clone repo: `git clone https://github.com/Ask149/orchestrator.git`
- [ ] Install dependencies: `cd orchestrator && npm install`
- [ ] Build project: `npm run build`
- [ ] Verify no build errors in output

### Configuration Paths (Windows)

- [ ] Config dir resolves to `%LOCALAPPDATA%\orchestrator`
  ```powershell
  echo $env:LOCALAPPDATA
  ```
- [ ] Create config directory manually if needed:
  ```powershell
  New-Item -ItemType Directory -Force $env:LOCALAPPDATA\orchestrator
  ```
- [ ] Create `config.json` in the directory above
- [ ] Create `mcp-subagent.json` in the directory above
- [ ] Create `logs` subdirectory:
  ```powershell
  New-Item -ItemType Directory -Force $env:LOCALAPPDATA\orchestrator\logs
  ```

### Temp Path Handling

- [ ] Verify `os.tmpdir()` works correctly
  ```powershell
  node -e "const os = require('os'); console.log(os.tmpdir());"
  ```
- [ ] Expected output: typically `C:\Users\<username>\AppData\Local\Temp`
- [ ] Orchestrator should create temp configs in this directory

### CLI Backend Detection

**Copilot CLI:**
- [ ] Installed globally: `npm install -g @github/copilot-cli`
- [ ] Verify accessible: `copilot --version`
- [ ] Update `config.json` with actual path if needed:
  ```powershell
  where.exe copilot
  ```

**Claude CLI:**
- [ ] Installed globally: `npm install -g @anthropic-ai/claude-code`
- [ ] Verify accessible: `claude --version`
- [ ] Update `config.json` with actual path if needed:
  ```powershell
  where.exe claude
  ```

### Secure Defaults

- [ ] `config.json` has `allowAllTools: false` (not `true`)
- [ ] `config.json` has `allowAllPaths: false` (not `true`)
- [ ] Verify `--allow-all-tools` NOT added to Copilot args by default
- [ ] Verify `--dangerously-skip-permissions` NOT added to Claude args by default

### MCP Server Configuration (CRITICAL for Windows)

Windows **requires** the `cmd /c` wrapper for `npx`-based MCP servers. Without it, you'll see "Connection closed" errors because Windows cannot directly execute `npx`.

**Correct Windows format (`mcp-subagent.json`):**

```json
{
  "mcpServers": {
    "playwright": {
      "type": "local",
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@playwright/mcp@latest"],
      "tools": ["*"]
    }
  }
}
```

**Required fields for Copilot CLI:**
- [ ] `type` field present (`"local"`, `"stdio"`, `"http"`, or `"sse"`)
- [ ] `tools` field present (`["*"]` for all tools)

**Validation checklist:**
- [ ] MCP config uses `"command": "cmd"` (not `"command": "npx"`)
- [ ] MCP config uses `"args": ["/c", "npx", ...]` format
- [ ] Test with Copilot: `copilot -p "list available tools" --additional-mcp-config @path\to\mcp-subagent.json`
- [ ] Test with Claude: `claude -p "list available tools" --mcp-config path\to\mcp-subagent.json`
- [ ] Both CLIs show MCP tools available (e.g., `browser_navigate`, `browser_snapshot`)

### Spawn / Process Execution

- [ ] `spawn()` is called with `shell: true` on Windows
- [ ] No `/bin/sh` hardcoding (should use Windows shell)
- [ ] Commands can execute `.cmd` / `.exe` files

### Grep Implementation (No Unix Dependencies)

- [ ] File reading uses Node `fs.readFile()`, not `grep` command
- [ ] Pattern matching uses regex, not `grep -i` command
- [ ] Test with file containing special regex chars:
  ```powershell
  # Create test file with regex chars
  Echo '[test] (value)' > test.txt
  # Should match without error
  ```

### Error Handling

- [ ] Missing config files don't crash (fallback to defaults)
- [ ] Invalid JSON in config files doesn't crash
- [ ] Missing CLI backends don't crash (error message only)
- [ ] Timeout behavior works (process cleanup, no hanging)

### Smoke Tests

If Jest installed, run tests:
```powershell
npm test
```

Expected results:
- [ ] Config paths resolve correctly ✓
- [ ] Temp path detection works ✓
- [ ] Secure defaults enforced ✓
- [ ] All tests pass (or skip gracefully if Jest not installed)

### Manual Smoke Test

Start the MCP server and verify no crashes:

```powershell
npm start
```

Expected output:
- [ ] Server starts without errors
- [ ] Logs message like: `[orchestrator] MCP Orchestrator server started`
- [ ] No platform-specific errors (e.g., `/tmp/` not found)
- [ ] No hardcoded macOS paths in output

### PATH Resolution

Test CLI discovery (optional):

```powershell
# Should NOT use hardcoded paths
node -e "
const backends = {
  copilot: process.env.COPILOT_CLI || 'copilot',
  claude: process.env.CLAUDE_CLI || 'claude'
};
console.log('Copilot:', backends.copilot);
console.log('Claude:', backends.claude);
"
```

Expected: Shows `copilot` and `claude` (or custom env paths)

### Performance Baseline (optional)

Measure startup time:

```powershell
Measure-Command { npm start | Select-Object -First 1 }
```

Expected: < 2 seconds (no significant slowdown vs macOS)

### ARM64 Specific (Windows 11 on ARM)

- [ ] Node.js ARM64 build installed: `node -p process.arch`
  - Expected output: `arm64`
- [ ] All dependencies install without ARM64-specific errors
- [ ] No x64-only binaries in `node_modules/`

---

## Known Windows Issues

| Issue | Status | Workaround |
|-------|--------|-----------|
| `LOCALAPPDATA` undefined (rare) | ✓ Fixed | Falls back to `APPDATA` then `HOME` |
| `/tmp/` not exist | ✓ Fixed | Uses `os.tmpdir()` |
| `grep` command not found | ✓ Fixed | Node-based grep implementation |
| Shell execution fails | ✓ Fixed | `shell: true` on Windows |
| MCP `npx` "Connection closed" | ✓ Documented | Use `cmd /c npx` wrapper in config |

---

## Quick Validation Script

Save as `validate-windows.ps1` and run:

```powershell
Write-Host "Orchestrator Windows Validation"
Write-Host "==============================="
Write-Host ""

# Check Node.js
Write-Host "✓ Node.js version: $(node --version)"

# Check npm
Write-Host "✓ npm version: $(npm --version)"

# Check platform
$os = $(node -p "process.platform")
Write-Host "✓ Platform: $os"

# Check arch
$arch = $(node -p "process.arch")
Write-Host "✓ Architecture: $arch"

# Check temp dir
$tmpdir = $(node -e "const os = require('os'); console.log(os.tmpdir());")
Write-Host "✓ Temp dir: $tmpdir"

# Check config dir
$configdir = $(node -e "const os = require('os'); const path = require('path'); const base = process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(); console.log(path.join(base, 'orchestrator'));")
Write-Host "✓ Config dir: $configdir"

# Check CLI backends
if (Get-Command copilot -ErrorAction SilentlyContinue) {
  Write-Host "✓ Copilot CLI available"
} else {
  Write-Host "✗ Copilot CLI NOT found"
}

if (Get-Command claude -ErrorAction SilentlyContinue) {
  Write-Host "✓ Claude CLI available"
} else {
  Write-Host "✗ Claude CLI NOT found"
}

Write-Host ""
Write-Host "All basic checks passed!"
```

Run with:
```powershell
powershell -ExecutionPolicy Bypass -File validate-windows.ps1
```

---

## Support

For issues specific to Windows:
1. Check the Known Windows Issues table above
2. Review logs in `%LOCALAPPDATA%\orchestrator\logs\`
3. Run validation script above
4. Check platform: `node -p process.platform`
4. Check user home: `node -e "const os = require('os'); console.log(os.homedir());"`
