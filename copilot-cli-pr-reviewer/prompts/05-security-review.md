You are reviewing a pull request for security concerns. Below are the goals, risk assessment, and diffs.

Review the changes for **security issues**:
- Injection vulnerabilities (SQL, command, XSS)
- Authentication / authorization bypasses
- Sensitive data exposure (logging secrets, leaking tokens)
- Insecure defaults or configurations
- Missing input validation at system boundaries
- OWASP Top 10 concerns

For each concern, provide:
- **File(s):** which file(s) are affected
- **Issue:** what the security concern is
- **Suggestion:** how to fix it
- **Severity:** low / medium / high / critical

If no security issues are found, say so explicitly.

## Goals

{{GOALS}}

## Risk Assessment

{{RISK}}

## Diffs

{{DIFFS}}