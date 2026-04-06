You are assembling a final PR review document from the outputs of a multi-step review process.

Combine the sections below into a clean, well-structured markdown review document. The document should have these sections:

1. **Summary** — Brief overview of what this PR does (from goals)
2. **Risk Assessment** — Which files are high-risk and why
3. **Architecture Diagram** — The mermaid diagram
4. **Architecture & Security Review** — Validated comments from architecture and security reviews
5. **File-by-File Review** — Validated comments from individual file reviews
6. **Overall Assessment** — Your overall verdict: approve, request changes, or needs discussion

Format it cleanly. Remove any redundancy between sections. If a section has no comments, note that explicitly (e.g., "No security concerns identified.").

## Goals

{{GOALS}}

## Risk Assessment

{{RISK}}

## Mermaid Diagram

{{DIAGRAM}}

## Validated Architecture & Security Comments

{{ARCH_SECURITY_VALIDATED}}

## Validated File Review Comments

{{FILES_VALIDATED}}