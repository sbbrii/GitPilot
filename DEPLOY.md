# DEPLOY.md — Git Pilot Production Deployment & Release Checklist

This document details the mandatory pre-flight checks, security validations, packaging workflows, and release procedures for publishing the **Git Pilot** extension (`v0.1.0`) to the Visual Studio Marketplace.

---

## 1. Security & Safety Verification

- [x] **Zero Shell Subshell Injection (`shell: false`)**
  - Confirmed all process spawning in `CommandExecutor.ts` and `gitCliAdapter.ts` uses `child_process.spawn("git", args, { shell: false })`.
  - Verified no raw string concatenation or interpolation is used to form shell execution strings.

- [x] **Subcommand & Argument Allowlisting**
  - Verified `ALLOWED_SUBCOMMANDS` and `BLOCKED_SUBCOMMANDS` in `riskRules.ts`.
  - Confirmed permanently blocked commands (`filter-branch`, `gc`, `push --force`) throw `BlockedCommandError`.
  - Metacharacter regex `SHELL_METACHARACTERS` (`[|;&$`"<>\\()\[\]{}]`) tested against malicious payload strings.

- [x] **Approval Gate & Safety Policy**
  - Verified read-only commands (`status`, `log`, `diff`) execute without prompt.
  - Verified reversible write operations (`add`, `commit`, `switch`) require standard modal approval.
  - Verified destructive write operations (`reset --hard`, `rebase`, `clean -fd`, `push --force-with-lease`) require typed phrase confirmation (`"CONFIRM RESET"`).
  - Verified `ApprovalGate.purgeExpired()` correctly invalidates requests after 60s timeout.

- [x] **Credential & Prompt Protection**
  - Environment variables set `GIT_TERMINAL_PROMPT="0"` and `GIT_ASKPASS="echo"` to prevent subprocess deadlocks on auth prompts.
  - API Key stored securely in VS Code SecretStorage (`context.secrets`).

---

## 2. Automated Quality Gates

Run the automated validation pipeline before packaging:

```bash
# 1. Typecheck (0 errors expected)
npm run typecheck

# 2. Unit & Integration Test Suite (45/45 tests passing expected)
npm test

# 3. Production Bundle Build
npm run build:prod
```

---

## 3. Pre-Release Build & Packaging Workflow

### A. Environment Preparation
Ensure `vsce` (Visual Studio Code Extension Manager) is installed:
```bash
npm install -g @vscode/vsce
```

### B. Verify Package Inclusions & Exclusions
Check `.vscodeignore` to guarantee source files, tests, and temporary node_modules are excluded from the VSIX package:
```
.vscode/**
.git/**
node_modules/**
src/**
webview-src/**
test/**
tsconfig.json
esbuild.config.js
vitest.config.ts
*.vsix
```

### C. Build VSIX Artifact
Generate the production `.vsix` file:
```bash
vsce package --out git-copilot-0.1.0.vsix
```

---

## 4. Visual Studio Marketplace Publishing

### A. Authentication
Log in with your Azure DevOps Personal Access Token (PAT) configured for Marketplace publishing:
```bash
vsce login git-copilot
```

### B. Publish Command
```bash
vsce publish 0.1.0 -p <PAT_TOKEN>
```

---

## 5. Rollback & Emergency Contingency Plan

In the event of a critical security bug or regression post-launch:

1. **Unpublish / Deprecate Release**:
   ```bash
   vsce unpublish git-copilot.git-copilot@0.1.0
   ```
2. **Patch & Re-tag**:
   - Create hotfix release `v0.1.1`.
   - Update `package.json` version.
   - Run standard build and test gates.
   - Publish patched VSIX package.

---

## 6. Telemetry & Opt-In Policy

- **Opt-In Default**: Telemetry is strict opt-in (`gitCopilot.telemetry.enabled: false`).
- **No Data PII Collection**: Never send repository paths, code contents, or commit messages over telemetry. Collect only execution status codes and error type names.
