/**
 * Configuration file templates.
 *
 * The `init` tool uses these to scaffold optimal config files for
 * PHPStan, Psalm, PHPCS, PHP-CS-Fixer, Rector, PHPUnit, GitHub Actions,
 * EditorConfig and Git attributes.
 *
 * Each generator returns the file contents as a string. The caller
 * decides whether to write it to disk or show a diff first.
 *
 * Templates are intentionally hand-tuned to:
 *   - use a sensible default level
 *   - skip noisy rules that produce false positives
 *   - include strict types + readonly enforcement
 *   - respect PSR-12 / PSR-4
 */

import type { FrameworkName, PhpStanLevel, PsalmLevel } from '../constants.js';

export interface InitContext {
  readonly framework: FrameworkName;
  readonly phpVersion: string | null;
  readonly projectName: string;
  readonly isLaravel: boolean;
  readonly isSymfony: boolean;
  readonly isWordPress: boolean;
}

const safeName = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'my-php-project';

export const buildProjectName = (composerName: string | null, rootDir: string): string => {
  if (composerName) {
    const parts = composerName.split('/');
    return parts[parts.length - 1] ?? composerName;
  }
  return safeName(rootDir.split(/[\\/]/).pop() ?? 'project');
};

// ──────────────────────────────────────────────────────────────────────
// phpstan.neon
// ──────────────────────────────────────────────────────────────────────

export const generatePhpstanConfig = (level: PhpStanLevel, ctx: InitContext): string => {
  const laravelIgnores = ctx.isLaravel
    ? `
    - ${ctx.projectName}\\Facades\\*
    - ${ctx.projectName}\\Database\\Factories\\*`
    : '';
  return `parameters:
    level: ${level}
    paths:
        - src
        - app
    excludePaths:
        - vendor/*
        - storage/*
        - bootstrap/cache/*
        - node_modules/*${laravelIgnores}
    treatPhpDocTypesAsCertain: false
    checkMissingIterableValueType: false
    reportUnmatchedIgnoredErrors: false
includes:
    - vendor/phpstan/phpstan/conf/bleedingEdge.neon
`;
};

// ──────────────────────────────────────────────────────────────────────
// psalm.xml
// ──────────────────────────────────────────────────────────────────────

export const generatePsalmConfig = (level: PsalmLevel, ctx: InitContext): string => {
  return `<?xml version="1.0"?>
<psalm
    errorLevel="${level}"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:noNamespaceSchemaLocation="https://getpsalm.org/schema/config"
    cacheDirectory="${ctx.isLaravel ? 'bootstrap/cache' : 'cache'}"
    requireVoidReturnType="false"
    phpVersion="${ctx.phpVersion ?? '8.1'}"
    findUnusedVariablesAndParams="false"
>
    <projectFiles>
        <directory name="src" />
        ${ctx.isLaravel ? '<directory name="app" />' : ''}
        <ignoreFiles>
            <directory name="vendor" />
            <directory name="node_modules" />
            ${ctx.isLaravel ? '<directory name="storage" />' : ''}
        </ignoreFiles>
    </projectFiles>
</psalm>
`;
};

// ──────────────────────────────────────────────────────────────────────
// .php-cs-fixer.php
// ──────────────────────────────────────────────────────────────────────

export const generatePhpCsFixerConfig = (): string => {
  return `<?php

declare(strict_types=1);

use PhpCsFixer\\Config;
use PhpCsFixer\\Finder;

$finder = (new Finder())
    ->in(__DIR__)
    ->name('*.php')
    ->notPath('vendor/*')
    ->notPath('node_modules/*')
    ->notPath('storage/*')
    ->notPath('bootstrap/cache/*');

return (new Config())
    ->setRiskyAllowed(true)
    ->setRules([
        '@PSR12' => true,
        '@PSR1' => true,
        'declare_strict_types' => true,
        'no_unused_imports' => true,
        'ordered_imports' => ['sort_algorithm' => 'alpha'],
        'single_quote' => true,
        'trailing_comma_in_multiline' => ['elements' => ['arrays', 'arguments', 'parameters']],
        'no_trailing_whitespace' => true,
        'no_empty_statement' => true,
        'no_extra_blank_lines' => true,
        'no_short_echo_tag' => true,
        'array_syntax' => ['syntax' => 'short'],
        'binary_operator_spaces' => ['default' => 'single_space'],
        'cast_spaces' => true,
        'concat_space' => ['spacing' => 'single'],
        'method_chaining_indentation' => true,
        'no_useless_else' => true,
        'phpdoc_align' => false,
        'void_return' => true,
        'nullable_type_declaration_for_default_null_value' => true,
    ])
    ->setFinder($finder);
`;
};

// ──────────────────────────────────────────────────────────────────────
// rector.php
// ──────────────────────────────────────────────────────────────────────

export const generateRectorConfig = (ctx: InitContext): string => {
  return `<?php

declare(strict_types=1);

use Rector\\Config\\RectorConfig;
use Rector\\Set\\ValueObject\\LevelSetList;
use Rector\\Set\\ValueObject\\SetList;

return RectorConfig::configure()
    ->withPaths([
        __DIR__ . '/src',
        ${ctx.isLaravel ? `__DIR__ . '/app',` : ''}
    ])
    ->withSets([
        LevelSetList::UP_TO_PHP_${(ctx.phpVersion ?? '8.1').replace('.', '_')},
        SetList::CODE_QUALITY,
        SetList::DEAD_CODE,
        SetList::TYPE_DECLARATION,
        SetList::PRIVATIZATION,
        SetList::EARLY_RETURN,
    ])
    ->withSkip([
        __DIR__ . '/vendor',
        __DIR__ . '/storage',
        ${ctx.isLaravel ? `__DIR__ . '/bootstrap/cache',` : ''}
    ]);
`;
};

// ──────────────────────────────────────────────────────────────────────
// phpunit.xml
// ──────────────────────────────────────────────────────────────────────

export const generatePhpunitConfig = (): string => {
  return `<?xml version="1.0" encoding="UTF-8"?>
<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="vendor/phpunit/phpunit/phpunit.xsd"
         bootstrap="vendor/autoload.php"
         colors="true"
         cacheDirectory=".phpunit.cache"
         executionOrder="random"
         failOnRisky="true"
         failOnWarning="true"
         displayDetailsOnTestsThatTriggerWarnings="true"
         displayDetailsOnTestsThatTriggerNotices="true"
         displayDetailsOnTestsThatTriggerDeprecations="true">
    <testsuites>
        <testsuite name="Unit">
            <directory>tests/Unit</directory>
        </testsuite>
        <testsuite name="Feature">
            <directory>tests/Feature</directory>
        </testsuite>
    </testsuites>
    <source>
        <include>
            <directory>src</directory>
            <directory>app</directory>
        </include>
    </source>
    <php>
        <ini name="error_reporting" value="-1"/>
        <ini name="date.timezone" value="UTC"/>
        <env name="APP_ENV" value="testing"/>
    </php>
</phpunit>
`;
};

// ──────────────────────────────────────────────────────────────────────
// phpmd.xml
// ──────────────────────────────────────────────────────────────────────

export const generatePhpmdConfig = (projectName: string): string => {
  return `<?xml version="1.0"?>
<ruleset name="PHPMD rule set"
         xmlns="http://pmd.sf.net/ruleset/1.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://pmd.sf.net/ruleset/1.0.0 http://pmd.sf.net/ruleset_xml_schema_1.0.0.xsd">
    <description>Custom PHPMD ruleset for ${projectName}</description>

    <rule ref="rulesets/cleancode.xml">
        <exclude name="StaticAccess"/>
        <exclude name="ElseExpression"/>
    </rule>
    <rule ref="rulesets/codesize.xml">
        <exclude name="TooManyMethods"/>
    </rule>
    <rule ref="rulesets/design.xml"/>
    <rule ref="rulesets/naming.xml">
        <exclude name="ShortVariable"/>
    </rule>
    <rule ref="rulesets/unusedcode.xml"/>
    <rule ref="rulesets/controversial.xml"/>

    <exclude-pattern>vendor/*</exclude-pattern>
    <exclude-pattern>node_modules/*</exclude-pattern>
    <exclude-pattern>storage/*</exclude-pattern>
    <exclude-pattern>bootstrap/cache/*</exclude-pattern>
</ruleset>
`;
};

// ──────────────────────────────────────────────────────────────────────
// phpcs.xml
// ──────────────────────────────────────────────────────────────────────

export const generatePhpcsConfig = (isLaravel: boolean): string => {
  const appFile = isLaravel ? '    <file>app</file>\n' : '';
  return `<?xml version="1.0"?>
<ruleset name="phpcs-ruleset">
    <description>PSR-12 coding standard</description>
    <rule ref="PSR12"/>
    <rule ref="PSR1.Files.SideEffects"/>
    <file>src</file>
${appFile}    <exclude-pattern>vendor/*</exclude-pattern>
    <exclude-pattern>node_modules/*</exclude-pattern>
    <exclude-pattern>storage/*</exclude-pattern>
    <exclude-pattern>bootstrap/cache/*</exclude-pattern>
</ruleset>
`;
};

// ──────────────────────────────────────────────────────────────────────
// .editorconfig
// ──────────────────────────────────────────────────────────────────────

export const generateEditorConfig = (): string => {
  return `root = true

[*]
indent_style = space
indent_size = 4
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.{yml,yaml}]
indent_size = 2

[*.md]
trim_trailing_whitespace = false

[Makefile]
indent_style = tab
`;
};

// ──────────────────────────────────────────────────────────────────────
// .gitattributes
// ──────────────────────────────────────────────────────────────────────

export const generateGitAttributes = (): string => {
  return `# Auto-detect text files, ensure LF line endings
* text=auto eol=lf

# Source code
*.php         text eol=lf
*.phtml       text eol=lf
*.js          text eol=lf diff=javascript
*.ts          text eol=lf
*.json        text eol=lf
*.md          text eol=lf
*.yml         text eol=lf
*.yaml        text eol=lf

# Lock files
composer.lock binary
package-lock.json binary
pnpm-lock.yaml binary
yarn.lock     binary

# Vendor (don't diff)
/vendor/      -text
/node_modules/ -text

# Exclude from archive
.gitattributes export-ignore
.gitignore    export-ignore
.editorconfig export-ignore
README.md     export-ignore
LICENSE       export-ignore
CHANGELOG.md  export-ignore
`;
};

// ──────────────────────────────────────────────────────────────────────
// GitHub Actions CI
// ──────────────────────────────────────────────────────────────────────

export const generateGitHubActionsCi = (ctx: InitContext, phpVersions: readonly string[]): string => {
  const laravelStep = ctx.isLaravel
    ? `      - name: Laravel migrations
        run: php artisan migrate --env=testing

`
    : '';
  return `name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

permissions:
  contents: read

jobs:
  test:
    name: PHP \${{ matrix.php }} · \${{ matrix.deps }}
    runs-on: ubuntu-latest

    strategy:
      fail-fast: false
      matrix:
        php:
${phpVersions.map((v) => `          - ${v}`).join('\n')}
        deps: [highest, lowest]

    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: \${{ matrix.php }}
          coverage: pcov
          tools: composer:v2

      - name: Cache Composer
        uses: actions/cache@v4
        with:
          path: ~/.composer/cache/files
          key: composer-\${{ matrix.php }}-\${{ matrix.deps }}-\${{ hashFiles('composer.json') }}

      - name: Install dependencies
        run: |
          if [ "\${{ matrix.deps }}" = "lowest" ]; then
            composer update --prefer-lowest --no-interaction --no-progress
          else
            composer update --no-interaction --no-progress
          fi

      - name: Lint
        run: composer exec -- phpcs

      - name: Static analysis
        run: composer exec -- phpstan analyse --no-progress

      - name: Tests
        run: vendor/bin/phpunit --colors=never

${laravelStep}`;
};

// ──────────────────────────────────────────────────────────────────────
// Pre-commit hook
// ──────────────────────────────────────────────────────────────────────

export const generatePreCommit = (): string => {
  return `#!/usr/bin/env bash
#
# phpustik pre-commit hook
# Runs cs-fixer (dry-run) and phpmnd on staged PHP files.
# Configure: git config core.hooksPath bin/pre-commit
#

set -e

STAGED=$(git diff --cached --name-only --diff-filter=ACMR -- '*.php' || true)
if [ -z "$STAGED" ]; then
    exit 0
fi

echo "[phpustik] Running PHP-CS-Fixer in --dry-run mode..."
vendor/bin/php-cs-fixer fix --dry-run --diff \$STAGED

echo "[phpustik] Running phpmnd on staged files..."
vendor/bin/phpmnd --non-zero-only \$STAGED || true
`;
};
