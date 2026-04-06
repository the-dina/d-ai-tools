You are reviewing a pull request. Below are the goals of the PR and the diffs of all changed files.

Flag which files are **highest-risk** and why. High-risk means the file touches sensitive areas such as:
- Authentication / authorization
- Payments / billing
- Data access / database queries
- Security (tokens, secrets, encryption)
- Infrastructure / deployment
- Shared utilities used by many other files

For each high-risk file, explain briefly why it's high-risk and what to watch out for.

Also list files that are **low-risk** (e.g., purely cosmetic, tests, minor refactors).

## Goals

{{GOALS}}

## Diffs

{{DIFFS}}