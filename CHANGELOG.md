# Changelog

All notable changes to **phpustik** are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial public release.
- `get_php_info` tool — reports PHP version and loaded modules.
- `lint_php_file` tool — runs `php -l` on a file.
- `analyze_php_code` tool — runs PHPStan at a configurable level.
- `format_php_code` tool — runs PHP-CS-Fixer (PSR-12) in dry-run or apply mode.
- Cross-platform path normalisation (Windows, macOS, Linux, WSL).
- Stderr-only logger that preserves the MCP JSON-RPC stdout channel.
- Friendly "command not found" hints for PHP, PHPStan and PHP-CS-Fixer.
- GitHub Actions CI, issue and PR templates.
- Comprehensive English documentation for Cursor, Claude Desktop, Claude Code and Opencode.

## [1.0.0] — 2026-06-12

### Added
- First stable release.

[Unreleased]: https://github.com/phpustik/phpustik/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/phpustik/phpustik/releases/tag/v1.0.0
