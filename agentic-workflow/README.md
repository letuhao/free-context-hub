# Agentic Workflow v2

A drop-in structured workflow for AI coding agents (Claude Code, Cursor, Codex, etc.).  
Prevents agents from skipping phases, undersizing tasks, and committing without verification.

## What's inside

```
agentic-workflow/
├── README.md                 # This file — setup guide
├── WORKFLOW.md               # Full workflow doc (paste into CLAUDE.md or agent instructions)
├── CLAUDE.md.snippet         # Minimal snippet to paste into existing CLAUDE.md
├── scripts/
│   └── workflow-gate.sh      # State machine + enforcement script
└── .claude/
    └── settings.json         # Claude Code hooks (pre-commit gate)
```

## Quick Start (3 steps)

### 1. Copy files into your project

```bash
# From your project root:
cp -r /path/to/agentic-workflow/scripts ./scripts
cp /path/to/agentic-workflow/.claude/settings.json .claude/settings.json
```

### 2. Add workflow to agent instructions

**Option A — Full workflow (recommended):**  
Copy `WORKFLOW.md` content into your `CLAUDE.md`.

**Option B — Minimal snippet:**  
Copy `CLAUDE.md.snippet` content into your existing `CLAUDE.md`.

### 3. Add to .gitignore

```bash
echo ".workflow-state.json" >> .gitignore
```

## How it works

### 3-Layer Enforcement

```
Layer 1 (CLAUDE.md)      → Agent reads rules, knows skipping is forbidden
                            ↓ agent tries to skip anyway
Layer 2 (State machine)   → Script blocks the phase transition, shows error
                            ↓ agent tries to commit without verify
Layer 3 (Hook)            → Hook intercepts git commit, blocks it hard
```

### 11-Phase Workflow

```
CLARIFY → DESIGN → REVIEW → PLAN → BUILD → VERIFY → REVIEW → QC → SESSION → COMMIT → RETRO
```

### Task Size Classification

Agents can't self-judge "small vs large." The protocol forces objective counting:

| Size | Files | Logic | Side effects | Allowed skips |
|------|-------|-------|--------------|---------------|
| XS   | 1     | 0-1   | None         | CLARIFY + PLAN |
| S    | 1-2   | 2-3   | None         | PLAN only |
| M    | 3-5   | 4+    | Maybe        | None |
| L    | 6+    | Any   | Yes          | None |
| XL   | 10+   | Any   | Yes          | None |

The script validates counts vs claimed size — **agents cannot undersize**.

### Script Commands

```bash
./scripts/workflow-gate.sh reset                          # New task
./scripts/workflow-gate.sh size M 3 4 0                   # Classify (files, logic, side_effects)
./scripts/workflow-gate.sh phase clarify                  # Enter phase
./scripts/workflow-gate.sh complete clarify "user approved" # Complete with evidence
./scripts/workflow-gate.sh skip plan "user authorized"    # Skip with reason
./scripts/workflow-gate.sh status                         # Show state
./scripts/workflow-gate.sh pre-commit                     # Gate check before commit
```

## Requirements

- **bash** (Git Bash on Windows, native on Mac/Linux)
- **python** (3.x, for JSON state management)
- **Claude Code** (for Layer 3 hooks — optional, other layers work without it)

## Customization

### Change session tracking path

Search for `SESSION_PATCH.md` in WORKFLOW.md and replace with your project's session file path.

### Add/remove phases

Edit the `PHASES` array in `scripts/workflow-gate.sh`:

```bash
PHASES=("clarify" "design" "review-design" "plan" "build" "verify" "review-code" "qc" "session" "commit" "retro")
```

### Adjust size thresholds

Edit the `cmd_size()` function in `scripts/workflow-gate.sh` to change what counts as XS/S/M/L/XL.

### Disable session check in pre-commit

If your project doesn't use session tracking, remove the session check in `cmd_pre_commit()`.

## Credits

- **Session persistence, role perspectives, guardrails** — [free-context-hub](https://github.com/user/free-context-hub) workflow
- **Brainstorming, TDD, verification gate, debugging, subagent dispatch** — [Superpowers](https://github.com/obra/superpowers) by Jesse Vincent

## License

MIT
