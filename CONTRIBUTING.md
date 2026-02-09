# Contributing to MCP Orchestrator

Thanks for your interest in contributing! 🎉

## Quick Start

```bash
git clone https://github.com/Ask149/orchestrator.git
cd orchestrator
npm install
npm run build
npm test
```

## How to Contribute

### 🐛 Bug Reports
Open an [issue](https://github.com/Ask149/orchestrator/issues/new?template=bug_report.md) with:
- OS and Node.js version
- Steps to reproduce
- Expected vs actual behavior

### 💡 Feature Requests
Open an [issue](https://github.com/Ask149/orchestrator/issues/new?template=feature_request.md) describing:
- The use case
- Proposed solution
- Alternatives you considered

### 🔧 Pull Requests

1. Fork the repo and create a branch: `git checkout -b feat/my-feature`
2. Make your changes
3. Run tests: `npm test`
4. Type check: `npx tsc --noEmit`
5. Commit with [conventional commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `chore:`
6. Push and open a PR

### Code Guidelines

- **stdout is reserved** for MCP protocol — use `console.error()` for logging
- Cross-platform: use `os.tmpdir()`, `path.join()`, `shell: true` on Windows
- Add tests for new features in `src/__tests__/`
- Keep dependencies minimal

## Good First Issues

Look for issues labeled [`good first issue`](https://github.com/Ask149/orchestrator/labels/good%20first%20issue) — these are great starting points.

## Questions?

Open a [Discussion](https://github.com/Ask149/orchestrator/discussions) or reach out on Twitter [@iodevz_ai](https://twitter.com/iodevz_ai).
