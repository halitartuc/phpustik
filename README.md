<div align="center">

# 🐘 phpustik

### Production-grade MCP server that gives AI assistants deep visibility into the entire PHP ecosystem — runtime, linting, static analysis, security, testing, Composer and framework tools.

[![npm version](https://img.shields.io/npm/v/phpustik.svg?style=flat-square&logo=npm)](https://www.npmjs.com/package/phpustik)
[![MIT License](https://img.shields.io/github/license/phpustik/phpustik.svg?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/node/v/phpustik.svg?style=flat-square&logo=node.js)](https://nodejs.org)
[![CI](https://img.shields.io/github/actions/workflow/status/phpustik/phpustik/ci.yml?style=flat-square&logo=github)](https://github.com/phpustik/phpustik/actions)
[![semantic-release](https://img.shields.io/badge/semantic--release-angular-e10079.svg?style=flat-square&logo=semantic-release)](https://github.com/semantic-release/semantic-release)
[![MCP](https://img.shields.io/badge/MCP-v2-blueviolet.svg?style=flat-square)](https://modelcontextprotocol.io)
[![Tools](https://img.shields.io/badge/tools-33-blue.svg?style=flat-square)](#-tools)
[![Resources](https://img.shields.io/badge/resources-8-green.svg?style=flat-square)](#-resources)
[![Prompts](https://img.shields.io/badge/prompts-7-orange.svg?style=flat-square)](#-prompts)

> A Model Context Protocol server for PHP — written in TypeScript, shipped as a single `npx`-able package, battle-tested on Windows, macOS and Linux.

[Features](#-features) · [Installation](#-installation) · [Usage](#-usage) · [Tools](#-tools) · [Resources](#-resources) · [Prompts](#-prompts) · [Integrations](#-integrations)

</div>

---

## 📑 Table of contents

- [Why phpustik?](#-why-phpustik)
- [What's inside](#-whats-inside)
- [Features](#-features)
- [Architecture](#-architecture)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Usage](#-usage)
- [Tools](#-tools) — 31 tools in 9 categories
- [Resources](#-resources) — 8 read-only data sources
- [Prompts](#-prompts) — 7 pre-baked workflows
- [Integrations](#-integrations)
- [Configuration](#-configuration)
- [Troubleshooting](#-troubleshooting)
- [Security](#-security)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)
- [License](#-license)

---

## 💡 Why phpustik?

AI assistants like **Cursor**, **Claude Desktop**, **Claude Code** and **Opencode** are increasingly good at writing PHP, but they remain blind to the runtime they target:

- They don't know which PHP version is installed.
- They cannot run `php -l` to catch a missing semicolon.
- They cannot invoke **PHPStan**, **Psalm**, **PHP-CS-Fixer**, **PHPUnit**, **Rector**, **PHPMD**, **PHPCS**…
- They cannot manage **Composer** packages, audit security, or detect the framework.
- They cannot run **Laravel artisan** or **Symfony console** commands.

**phpustik** closes that gap. It is a self-contained MCP server that exposes **31 tools**, **8 resources** and **7 prompts** to the model — across runtime, static analysis, security, testing, refactoring, dependency management and framework integration.

It is:

- **Production-ready** — strict TypeScript, no `any`, exhaustive error handling, structured logs.
- **Cross-platform** — Windows, macOS, Linux, WSL. Path handling is normalised centrally.
- **Safe by default** — `execFile` (no shell), deterministic timeouts, output capping, `isError: true` on every failure.
- **Honest** — if a binary is missing, the model is told exactly which command to run.

---

## 📦 What's inside

| Category               | Count | Examples                                                                              |
| ---------------------- | :---: | ------------------------------------------------------------------------------------- |
| 🛠 **Tools**           |  33   | `get_php_info`, `analyze_php_code`, `composer_audit`, `scan_secrets`, `laravel_routes`, **`phpustik_doctor`**, **`phpustik_init`** |
| 📚 **Resources**       |   8   | `php://info`, `phpustik://workspace`, `phpustik://composer-json`                      |
| 💬 **Prompts**         |   7   | `review_php_code`, `security_audit`, `upgrade_php`                                    |
| 🧰 **PHP tools wired** |  11   | PHP, Composer, PHPStan, Psalm, PHPMD, PHPCS, PHPMND, Rector, PHP Insights, PHPCPD, PHPUnit |
| 🚀 **Killer features**|   2   | `phpustik_doctor` (one-shot health check) + `phpustik_init` (project bootstrap)         |
| 📡 **MCP v2 features** |   3   | Logging notifications, progress reporting, cancellation                              |

---

## ✨ Features

| Area                  | What you get                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------- |
| **MCP protocol**      | Implements `McpServer` with the v2 high-level `registerTool` API.                          |
| **Transport**         | `StdioServerTransport` for first-class integration with every major MCP client.             |
| **Validation**        | Zod v4 input validation on every tool — invalid calls are rejected before any IO.          |
| **MCP logging**       | Real-time `notifications/message` updates while long tools run.                            |
| **Progress**          | `notifications/progress` for multi-step operations (`phpustik_doctor`, `phpustik_init`).    |
| **Cancellation**      | AbortSignal-aware; long ops are tracked and can be killed if the user cancels.              |
| **Structured output** | `structuredContent` on key tools — model iterates typed data, not Markdown tables.         |
| **Error UX**          | Friendly, actionable messages for missing binaries, timeouts, permission errors.           |
| **Cross-platform**    | POSIX, Windows, UNC, WSL, `file://` and `~`-prefixed paths accepted and normalised.         |
| **Security**          | No `shell: true`, no `eval`, capped output buffers, secrets never logged.                   |
| **Observability**     | Stderr-only logger with `PHPUSTIK_LOG_LEVEL` (debug/info/warn/error).                      |
| **Workspace-aware**   | Auto-detects project root from `composer.json` / `phpstan.neon` / `artisan` / `bin/console`.|
| **Framework-aware**   | Auto-detects Laravel, Symfony, WordPress, CodeIgniter, Yii, Slim, Laminas, Phalcon, CakePHP.|
| **Caching**           | TTL cache for expensive ops (composer info, phpstan, audits) — 60 s default.               |
| **Distribution**      | `bin` field + `files` whitelist → `npm i -g phpustik` or `npx phpustik`.                    |
| **CI / Release**      | GitHub Actions matrix (3 OS × 3 Node versions), `semantic-release`.                        |

---

## 🩺 Killer features

### `phpustik_doctor` — one-shot health check

A single tool call that runs the entire PHP quality pipeline and produces a prioritised Markdown + JSON report.

```json
{
  "tool": "phpustik_doctor",
  "arguments": {
    "category": "all",
    "failOn": "high",
    "skipTests": false,
    "fix": false,
    "json": false
  }
}
```

- Runs `composer validate`, `composer audit`, `analyze_php_code`, `run_phpcs`, `run_phpmd`, `run_phpunit`, `scan_secrets`, `scan_vulnerable_functions`, `scan_sql_injection`, `scan_xss`, `check_php_compatibility`, `suggest_refactoring`, `get_php_ini`, `detect_framework`, `get_php_info` — in order, with progress notifications.
- Returns a unified **Markdown report** plus a typed **`DoctorReport`** structured content (overall status, per-check severity, fixable count, recommendations).
- `failOn` lets the model or CI fail at a configurable severity threshold.
- `json: true` mode for CI pipelines (returns only the structured content).
- `category: security|quality|style` to run a targeted subset.

### `phpustik_init` — project bootstrap

Generates optimal config files for a PHP project, tailored to its framework and PHP version.

```json
{
  "tool": "phpustik_init",
  "arguments": {
    "dryRun": true,
    "force": false,
    "phpstanLevel": "5",
    "psalmLevel": "4",
    "phpVersions": "8.1,8.2,8.3,8.4"
  }
}
```

- Detects `composer.json`, `composer.lock`, framework, PHP version.
- Generates up to **11 config files**: `phpstan.neon`, `psalm.xml`, `.php-cs-fixer.php`, `rector.php`, `phpmd.xml`, `phpcs.xml`, `phpunit.xml`, `.editorconfig`, `.gitattributes`, `.github/workflows/ci.yml`, `bin/pre-commit`.
- All templates hand-tuned for low false-positive rate, modern PHP, PSR-12 + strict types.
- `dryRun: true` (default) shows a unified diff without touching disk.
- `force: true` overwrites existing files; default is "keep what's there".
- `only: "phpstan.neon,phpunit.xml"` restricts to a subset.

---

## 🏗 Architecture

```
┌──────────────────────┐    JSON-RPC over stdio    ┌────────────────────────────────────────┐
│   MCP client         │  ◀────────────────────▶   │              phpustik server           │
│ (Cursor / Claude /   │                          │            (TypeScript, ESM)            │
│  Opencode / Cline)   │                          │                                        │
└──────────────────────┘                          │  33 tools │ 8 resources │ 7 prompts    │
                                                   └──────────────────┬─────────────────────┘
                                                                      │
        ┌──────────────────────────┬────────────────────────────┬──┴─────────────────────────────┐
        │                          │                            │                                │
        ▼                          ▼                            ▼                                ▼
   ┌────────┐  ┌────────┐  ┌────────────┐  ┌────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐
   │  php   │  │ composer│ │  phpstan / │  │  phpcs /   │  │  rector /    │  │  laravel /   │  │  pattern    │
   │  -v -m │  │  *      │ │  psalm /   │  │  phpmd /   │  │  insights /  │  │  symfony     │  │  scanner    │
   │  -l -i │  │         │ │  phpmnd    │  │  phpcpd    │  │  phpcpd      │  │  console     │  │  (secrets,  │
   │  -r    │  │         │ │            │  │            │  │              │  │              │  │  SQLi, XSS) │
   └────────┘  └────────┘  └────────────┘  └────────────┘  └──────────────┘  └──────────────┘  └─────────────┘
```

### Source layout

```
src/
├── index.ts                 # entry point
├── server.ts                # bootstrap (tools + resources + prompts)
├── constants.ts             # binary names, install hints, timeouts
├── prompts.ts               # 7 MCP prompts
├── resources.ts             # 8 MCP resources
├── tools/
│   ├── get-php-info.ts
│   ├── lint-php-file.ts
│   ├── analyze-php-code.ts
│   ├── format-php-code.ts
│   ├── run-php-script.ts
│   ├── show-opcache-status.ts
│   ├── get-extension-info.ts
│   ├── get-php-ini.ts
│   ├── check-php-compatibility.ts
│   ├── run-phpunit.ts
│   ├── run-psalm.ts
│   ├── run-phpmd.ts
│   ├── run-phpcs.ts
│   ├── run-phpmnd.ts
│   ├── run-phpcpd.ts
│   ├── run-phpinsights.ts
│   ├── run-rector.ts
│   ├── composer.ts          # 9 composer_* tools
│   ├── scan-security.ts     # 4 scan_* tools
│   ├── codegen.ts           # add_strict_types, generate_phpdoc, suggest_refactoring
│   ├── framework.ts         # detect + Laravel + Symfony tools
│   ├── doctor.ts            # phpustik_doctor
│   └── init.ts              # phpustik_init
└── utils/
    ├── executor.ts          # execFile wrapper, no shell, timeouts
    ├── paths.ts             # cross-platform path normalisation
    ├── logger.ts            # stderr-only structured logger
    ├── responses.ts         # uniform MCP tool responses
    ├── workspace.ts         # project root auto-detection
    ├── framework-detector.ts
    ├── patterns.ts          # secrets / SQLi / XSS / vuln-func catalogues
    ├── scan-runner.ts       # pattern-scan engine
    ├── file-scanner.ts      # FS walker with skips
    ├── cache.ts             # TTL cache
    ├── active-ops.ts        # AbortController registry for cancellation
    ├── notification-sink.ts # MCP logging/progress bridge
    └── config-templates.ts  # init tool generators
```

---

## ✅ Prerequisites

| Software      | Minimum     | Required for                              |
| ------------- | ----------- | ----------------------------------------- |
| **Node.js**   | 20.0 LTS    | Running the MCP server                    |
| **npm**       | 10 (bundled)| Package manager (or `pnpm`/`yarn`)        |
| **PHP**       | 8.0+        | All PHP-runtime tools                     |
| **Composer**  | 2.x         | `composer_*` tools                        |
| **PHPUnit**   | 10+         | `run_phpunit`                             |
| **PHPStan**   | 1.x or 2.x  | `analyze_php_code` (recommended)          |
| **Psalm**     | 5+          | `run_psalm`                               |
| **PHPMD**     | 2.x         | `run_phpmd`                               |
| **PHPCS**     | 3.x         | `run_phpcs`                               |
| **PHPMND**    | 3.x         | `run_phpmnd`                              |
| **Rector**    | 1.x         | `run_rector`                              |
| **PHP Insights** | 2.x     | `run_phpinsights`                         |
| **PHPCPD**    | 6+          | `run_phpcpd`                              |
| **PHP-CS-Fixer** | 3.x     | `format_php_code`                         |

> All of these are **optional** — phpustik will tell you which to install when a tool needs a missing binary.

### Quick check

```bash
node -v     # v20 or higher
php -v      # PHP 8.0 or higher
composer --version
```

---

## 🛠 Installation

### 1. Install PHP

| OS            | Command                                                                          |
| ------------- | -------------------------------------------------------------------------------- |
| macOS         | `brew install php`                                                               |
| Ubuntu/Zorin  | `sudo apt-get install -y php-cli php-mbstring php-xml`                           |
| Fedora        | `sudo dnf install -y php-cli`                                                    |
| Alpine        | `sudo apk add php php-mbstring`                                                  |
| Windows       | Download from <https://windows.php.net/download/> or `winget install PHP.PHP.8.3` |

### 2. Install Composer

```bash
# macOS / Linux / WSL
curl -sS https://getcomposer.org/installer | php
sudo mv composer.phar /usr/local/bin/composer

# Windows (PowerShell)
Invoke-WebRequest https://getcomposer.org/installer -OutFile composer-setup.php
php composer-setup.php
Move-Item composer.phar C:\Program Files\composer\composer.exe
```

### 3. Install all PHP tools (optional but recommended)

```bash
composer global require \
    phpstan/phpstan \
    vimeo/psalm \
    phpmd/phpmd \
    squizlabs/php_codesniffer \
    povils/phpmnd \
    sebastianbergmann/phpcpd \
    nunomaduro/phpinsights \
    rector/rector \
    friendsofphp/php-cs-fixer \
    phpcompatibility/php-compatibility
```

Make sure `~/.composer/vendor/bin` (Linux/macOS) or `%USERPROFILE%\Composer\vendor\bin` (Windows) is on your `PATH`.

### 4. Install phpustik

```bash
# Option A: run on demand
npx -y phpustik

# Option B: install globally
npm install -g phpustik
phpustik
```

---

## 🚀 Usage

### Quick start with `npx`

```bash
npx -y phpustik
```

You'll see on stderr:

```
[INFO] server.boot {"name":"phpustik","version":"1.0.0"}
[INFO] server.php_detected {"version":"PHP 8.3.6 (cli)"}
[INFO] server.ready {"transport":"stdio"}
```

### Local development

```bash
git clone https://github.com/phpustik/phpustik.git
cd phpustik
npm install
npm run dev          # tsx, no build
```

### Inspect with the MCP Inspector

```bash
npm run inspect
```

This opens a local web UI where you can call every tool by hand.

---

## 🛠 Tools (33)

All tools accept JSON Schema (Zod-validated) input and return MCP `text` content (and, where useful, a typed `structuredContent` companion). Tools marked ⚠️ are **destructive** (they modify the filesystem). Tools marked 🔒 require project-level configuration.

### 🔍 PHP Runtime & Environment (5)

| Tool | Purpose |
| --- | --- |
| `get_php_info` | PHP sürümü, modüller, INI. |
| `show_opcache_status` | OPcache + JIT (PHP 8+) durumu. |
| `get_extension_info` | Tek bir eklentinin fonksiyon/sabit/INI detayı. |
| `get_php_ini` | Aktif php.ini, tarama dizini, direktifler. |
| `check_php_compatibility` | PHPCompatibility ile hedef PHP sürüm denetimi. |

### 🧪 Linting, Formatting & Syntax (4)

| Tool | Purpose |
| --- | --- |
| `lint_php_file` | `php -l` ile sözdizimi denetimi. |
| `run_phpcs` | PHP_CodeSniffer (PSR12, Squiz, vb.). `fix=true` ile otomatik düzeltme. |
| `format_php_code` | PHP-CS-Fixer (PSR-12) — dry-run veya apply. |
| `add_strict_types` | Dosyaya `declare(strict_types=1);` ekler. |

### 📐 Static Analysis (6)

| Tool | Purpose |
| --- | --- |
| `analyze_php_code` | PHPStan seviye 0–max. |
| `run_psalm` | Psalm seviye 1–8. |
| `run_phpmd` | Mess Detector (karmaşıklık, unused code, design). |
| `run_phpmnd` | Magic number tespiti. |
| `run_phpcpd` | Copy-paste tespiti. |
| `run_phpinsights` | Genel kod kalite skoru (Code / Architecture / Style / Complexity). |

### 🛠 Refactoring & Codegen (3)

| Tool | Purpose |
| --- | --- |
| `run_rector` | Otomatik refactoring — `dryRun=true` önizleme. ⚠️ |
| `generate_phpdoc` | Eksik PHPDoc bloklarını raporlar. |
| `suggest_refactoring` | Uzun metod, god class, derin nesting heuristik önerileri. |

### ▶️ Execution & Testing (2)

| Tool | Purpose |
| --- | --- |
| `run_php_script` | İzole temp dosyada PHP kodu çalıştır. ⚠️ |
| `run_phpunit` | PHPUnit testleri (filter, testdox, coverage). |

### 📦 Composer (9)

| Tool | Purpose |
| --- | --- |
| `composer_info` | Yüklü paketler / belirli paket bilgisi. |
| `composer_validate` | `composer.json` doğrulama. |
| `composer_audit` | Bilinen CVE taraması. |
| `composer_outdated` | Güncellenmesi gereken paketler. |
| `composer_require` | Paket ekle. ⚠️ |
| `composer_remove` | Paket kaldır. ⚠️ |
| `composer_install` | `composer install`. ⚠️ |
| `composer_update` | `composer update`. ⚠️ |
| `composer_dump_autoload` | `composer dump-autoload`. |

### 🔐 Security (4)

| Tool | Purpose |
| --- | --- |
| `scan_secrets` | Hardcoded API key, private key, token, basic-auth URL. |
| `scan_vulnerable_functions` | `eval()`, `system()`, `unserialize()`, weak hash, `extract()`. |
| `scan_sql_injection` | Query string concatenation, `whereRaw`, `DB::statement`. |
| `scan_xss` | Unescaped `echo $_GET`, Blade `{!! !!}`, Twig `|raw`. |

### 🏗 Framework Integration (7)

| Tool | Purpose |
| --- | --- |
| `detect_framework` | Laravel / Symfony / WordPress / … otomatik tespit. |
| `laravel_artisan` | `php artisan <command>` çalıştır. ⚠️ |
| `laravel_routes` | Tüm route'lar (method, uri, name, action, middleware). |
| `laravel_migrations` | `php artisan migrate:status`. |
| `symfony_console` | `bin/console <command>`. ⚠️ |
| `symfony_container` | `debug:container` ile servis listesi. |

### 🚀 Meta-tools (2)

| Tool | Purpose |
| --- | --- |
| `phpustik_doctor` | Tek çağrıda tüm kalite/güvenlik/test kontrollerini çalıştırır, priorize rapor döner. |
| `phpustik_init` | PHPStan / Psalm / Rector / phpcs / phpunit / .editorconfig / .gitattributes / CI workflow üretir. |

---

## 📚 Resources (8)

Resources are server-side data the model can read on demand to enrich its context. No parameters required.

| URI                              | MIME              | Description                                    |
| -------------------------------- | ----------------- | ---------------------------------------------- |
| `phpustik://workspace`           | `text/plain`      | Aktif proje özeti (root, config dosyaları).   |
| `phpustik://composer-json`       | `application/json`| composer.json içeriği.                         |
| `phpustik://composer-extra`      | `application/json`| composer.json `extra` bloğu.                   |
| `phpustik://php-version`         | `text/plain`      | `.php-version` içeriği.                        |
| `phpustik://framework`           | `application/json`| Tespit edilen framework + sürüm.              |
| `php://info`                     | `text/plain`      | `php -i` çıktısı (ilk 200 satır).             |
| `php://extensions`               | `text/plain`      | `php -m` (yüklü eklentiler).                   |
| `php://ini-loaded`               | `application/json`| Sistem + proje INI dosyaları.                  |

---

## 💬 Prompts (7)

Prompts are pre-baked, parameterised workflows the model can invoke.

| Prompt | Arguments | Purpose |
| --- | --- | --- |
| `review_php_code` | `filepath`, `focus` | PSR-12, güvenlik ve performans review. |
| `explain_php_code` | `filepath`, `depth` | Satır satır kod açıklaması. |
| `refactor_php_code` | `filepath`, `goal` | Somut refactoring önerileri + değişiklik örnekleri. |
| `write_phpunit_test` | `filepath`, `method?`, `coverage` | PHPUnit testi üret. |
| `write_pest_test` | `filepath`, `method?` | Pest testi üret. |
| `security_audit` | `path?` | 4'lü güvenlik taraması başlat. |
| `upgrade_php` | `fromVersion`, `toVersion` | PHP sürüm yükseltme yol haritası. |

---

## 🔌 Integrations

The server speaks stdio MCP — any client that supports MCP can use it.

### Cursor

`Settings → MCP → + Add new global MCP server`:

```json
{
  "mcpServers": {
    "phpustik": {
      "command": "npx",
      "args": ["-y", "phpustik"]
    }
  }
}
```

### Claude Desktop

Edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "phpustik": {
      "command": "npx",
      "args": ["-y", "phpustik"]
    }
  }
}
```

### Claude Code (CLI)

```bash
claude mcp add phpustik -- npx -y phpustik
claude mcp list
```

### Opencode

`~/.config/opencode/mcp.json`:

```json
{
  "mcpServers": {
    "phpustik": {
      "command": "npx",
      "args": ["-y", "phpustik"]
    }
  }
}
```

### Cline / Continue.dev

`.vscode/cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "phpustik": { "command": "npx", "args": ["-y", "phpustik"] }
  }
}
```

---

## ⚙️ Configuration

All via env vars. Everything has a sensible default.

| Variable                  | Default     | Description                                              |
| ------------------------- | ----------- | -------------------------------------------------------- |
| `PHPUSTIK_LOG_LEVEL`      | `info`      | `debug` / `info` / `warn` / `error` — stderr.            |
| `PHPUSTIK_CACHE_TTL`      | `60000`     | Tool result cache TTL (ms).                              |
| `PHPUSTIK_TIMEOUT_MS`     | `30000`     | Default command timeout.                                 |
| `PHPUSTIK_PHPSTAN_BIN`    | `phpstan`   | Override PHPStan binary path.                            |
| `PHPUSTIK_PSALM_BIN`      | `psalm`     | Override Psalm binary path.                              |
| `PHPUSTIK_PHPCS_BIN`      | `phpcs`     | Override PHPCS binary path.                              |
| `PATH`                    | —           | The system PATH is used to find every PHP tool.          |

---

## 🧯 Troubleshooting

Common issues & fixes:

<details>
<summary><strong>Server starts but the model reports "tool not found".</strong></summary>

- Make sure the MCP client config is valid JSON. Trailing commas break it.
- Restart the MCP client **after** editing the config.
- Run the server manually: `npx -y phpustik`. If it crashes, the issue is server-side.

</details>

<details>
<summary><strong>"PHPStan / Psalm / PHPMD … bulunamadı" errors.</strong></summary>

```bash
composer global require phpstan/phpstan
```

Make sure `~/.composer/vendor/bin` is on your `PATH`. Restart the terminal and the MCP client.

</details>

<details>
<summary><strong>Windows: "php is not recognized".</strong></summary>

Add `C:\php` to `Path` in System Environment Variables, then restart the terminal **and** the MCP client.

</details>

<details>
<summary><strong>The server exits silently with no log line.</strong></summary>

The server sends logs to **stderr** and protocol frames to **stdout**. If your client shows nothing, set `PHPUSTIK_LOG_LEVEL=debug` and check its log panel.

</details>

<details>
<summary><strong>`@cfworker/json-schema` missing.</strong></summary>

```bash
npm install @cfworker/json-schema
```

It's a peer dep of the MCP SDK v2 alpha.

</details>

---

## 🔒 Security

- No `shell: true`. Every command runs through `execFile` — arguments are never parsed as shell.
- Every tool input goes through Zod validation before any IO.
- File-system access is read-only by default. Destructive tools are clearly marked ⚠️.
- Output buffers are capped at 1 MiB per stream.
- File contents are never logged — only paths and metadata.

Please report security issues privately — see [SECURITY.md](SECURITY.md).

---

## 🗺 Roadmap

- [ ] `php -S` managed dev server tool
- [ ] `phpdbg` interactive debugging
- [ ] `php -d` ini override preview
- [ ] Docker image: `phpustik/phpustik:latest` with every tool pre-installed
- [ ] HTTP/SSE transport for remote deployments
- [ ] VS Code extension proxy
- [ ] GitHub Actions annotation output for CI integration

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Run `npm run lint && npm run typecheck && npm run build` before opening a PR.

---

## 📄 License

[MIT](LICENSE) — © 2024-2026 phpustik contributors.

---

## 🙏 Acknowledgements

- The [Model Context Protocol](https://modelcontextprotocol.io) team for the spec and SDK.
- [PHPStan](https://phpstan.org), [Psalm](https://psalm.dev), [PHPMD](https://phpmd.org), [PHPCS](https://github.com/squizlabs/PHP_CodeSniffer), [Rector](https://getrector.org), [PHP Insights](https://phpinsights.com) and [PHP-CS-Fixer](https://cs.symfony.com/) — every PHP tool that makes this server possible.
- [Composer](https://getcomposer.org) for dependency management.
- Everyone who ⭐️s, opens issues or sends PRs.

<div align="center">

Made with ❤️ for the PHP + AI community.

</div>
