# Security Policy

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a vulnerability

**Please do not open public issues for security problems.**

Send a private report to **[security@phpustik.dev](mailto:security@phpustik.dev)**
(encrypted PGP key on request). You should receive an acknowledgement within
72 hours.

We follow responsible disclosure:

1. Triage and reproduce the issue.
2. Develop a fix in a private branch.
3. Publish the fix in a new minor/patch release.
4. Publish a security advisory on GitHub after the fix is available.

## Scope

- Remote code execution through the MCP stdio transport.
- Path traversal in any of the four tools.
- Command injection in `child_process` invocations.
- Information disclosure through verbose error messages.

## Out of scope

- Bugs in third-party tools (PHP, PHPStan, PHP-CS-Fixer). Please report those
  to the respective maintainers.
- Issues caused by running an outdated version of Node.js or PHP.
