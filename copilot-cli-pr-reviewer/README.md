# Copilot PR Review Tool

Automated PR review tool that orchestrates the **GitHub Copilot SDK** through a 10-step review pipeline, producing a structured `review.md` document.


---

## Prerequisites

1. **GitHub Copilot subscription** (Free tier works, but has limited monthly requests)
2. **A GitHub personal access token** with Copilot access
3. **Bun** runtime installed

### Set your token

```bash
export COPILOT_GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

Add it to your `~/.zshrc` or `~/.bashrc` to persist it.

> The tool also checks `GH_TOKEN` and `GITHUB_TOKEN` as fallbacks.

---

## Usage

```bash
bun run review
```

You'll be prompted for:

1. **Model** — picks from live list, defaults to `claude-sonnet-4.6`
2. **Repository directory** — default: `~/projects/review-clone`
3. **Base branch** — default: `origin/develop`

### Example session

```
🔍 Copilot PR Review Tool

Fetching available models...

Available models:
  1. claude-sonnet-4.6  ← default
  2. gpt-4.1
  3. gpt-4o

Select model [1]:

Repository directory (default: ~/projects/review-clone):

Base branch (default: origin/develop):

Repo:   /Users/you/projects/review-clone
Branch: feat/my-feature
Base:   origin/develop
Model:  claude-sonnet-4.6
Output: /Users/you/projects/review-clone/.local/reviews/feat-my-feature/v1/

Found 8 changed file(s).

[============================================================]
[Step 1/10] Generating diffs...
...
✅ Review complete!
📄 /Users/you/projects/review-clone/.local/reviews/feat-my-feature/v1/review.md
```

---

## Review Steps

| Step | What it does |
|------|-------------|
| 1 | Generate per-file diffs |
| 2 | Describe PR goals |
| 3 | Flag high-risk files (auth, payments, data access, etc.) |
| 4 | Generate Mermaid architecture diagram |
| 5 | Architecture review |
| 6 | Security review |
| 7 | Revalidate architecture & security comments (remove low-value ones) |
| 8 | File-by-file review (3 files in parallel) |
| 9 | Revalidate file-level comments (remove low-value ones) |
| 10 | Assemble final review document |

---

## Output Structure

Reviews are saved inside the **target repo's** `.local` folder:

```
<repo>/.local/reviews/
└── <branch-name>/
    └── v<N>/
        ├── diffs/           # Per-file diffs
        ├── steps/           # Intermediate step outputs
        │   └── file-reviews/
        └── review.md        # Final review document
```

Version auto-increments on each run, so re-reviews after author changes are preserved.

---

## Customization

Prompt templates are in `prompts/`. Edit them to adjust what the AI focuses on in each step.

---

## Quota

Each prompt counts as one **premium request** against your Copilot subscription. A typical run (10 steps + ~10 file reviews) uses ~20 requests.
