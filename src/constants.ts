/**
 * Global constants for the phpustik MCP server.
 *
 * Centralising these values keeps behaviour consistent across tools and makes
 * localisation / branding changes a single-file edit.
 */

export const SERVER_NAME = 'phpustik';
export const SERVER_VERSION = '1.0.0';
export const SERVER_DESCRIPTION =
  'PHP environment, linting, static analysis, security, testing, Composer and framework tools for AI assistants.';

export const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
export const ANALYZE_EXEC_TIMEOUT_MS = 180_000;
export const FORMAT_EXEC_TIMEOUT_MS = 60_000;
export const TEST_EXEC_TIMEOUT_MS = 600_000;
export const COMPOSER_EXEC_TIMEOUT_MS = 300_000;
export const SCRIPT_EXEC_TIMEOUT_MS = 60_000;

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.bat` : name);

export const PHP_BIN = 'php';
export const COMPOSER_BIN = exe('composer');
export const PHPSTAN_BIN = exe('phpstan');
export const PHP_CS_FIXER_BIN = exe('php-cs-fixer');
export const PSALM_BIN = exe('psalm');
export const PHPMD_BIN = exe('phpmd');
export const PHPCS_BIN = exe('phpcs');
export const PHPCBF_BIN = exe('phpcbf');
export const PHPMND_BIN = exe('phpmnd');
export const RECTOR_BIN = exe('rector');
export const PHPINSIGHTS_BIN = exe('insights');
export const PHPCPD_BIN = exe('phpcpd');
export const PHPUNIT_BIN = exe('phpunit');
export const PHP_COMPATIBILITY_BIN = exe('phpcs');

export const PHP_MISSING_HINT =
  "PHP çalıştırılabilir dosyası bulunamadı. Lütfen https://www.php.net/downloads.php adresinden PHP'yi indirip kurun ve 'php' komutunun PATH'te olduğundan emin olun.";

export const COMPOSER_MISSING_HINT =
  "Composer bulunamadı. Lütfen https://getcomposer.org/download/ adresinden kurun.";

export const PHPSTAN_INSTALL_HINT =
  "PHPStan bulunamadı. Lütfen 'composer global require phpstan/phpstan' komutu ile kurun ve '~/.composer/vendor/bin' dizinini PATH'e ekleyin.";

export const PHP_CS_FIXER_INSTALL_HINT =
  "PHP-CS-Fixer bulunamadı. Lütfen 'composer global require friendsofphp/php-cs-fixer' komutu ile kurun ve '~/.composer/vendor/bin' dizinini PATH'e ekleyin.";

export const PSALM_INSTALL_HINT =
  "Psalm bulunamadı. Lütfen 'composer global require vimeo/psalm' komutu ile kurun.";

export const PHPMD_INSTALL_HINT =
  "PHP Mess Detector bulunamadı. Lütfen 'composer global require phpmd/phpmd' komutu ile kurun.";

export const PHPCS_INSTALL_HINT =
  "PHP_CodeSniffer bulunamadı. Lütfen 'composer global require squizlabs/php_codesniffer' komutu ile kurun.";

export const PHPMND_INSTALL_HINT =
  "PHP Magic Number Detector bulunamadı. Lütfen 'composer global require povils/phpmnd' komutu ile kurun.";

export const RECTOR_INSTALL_HINT =
  "Rector bulunamadı. Lütfen 'composer global require rector/rector' komutu ile kurun.";

export const PHPINSIGHTS_INSTALL_HINT =
  "PHP Insights bulunamadı. Lütfen 'composer global require nunomaduro/phpinsights' komutu ile kurun.";

export const PHPCPD_INSTALL_HINT =
  "PHP Copy-Paste Detector bulunamadı. Lütfen 'composer global require sebastianbergmann/phpcpd' komutu ile kurun.";

export const PHPUNIT_INSTALL_HINT =
  "PHPUnit bulunamadı. Lütfen 'composer global require phpunit/phpunit' komutu ile kurun veya proje bağımlılığı olarak ekleyin ('composer require --dev phpunit/phpunit').";

export const PHPSTAN_LEVELS = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'max'
] as const;

export type PhpStanLevel = (typeof PHPSTAN_LEVELS)[number];

export const PSALM_LEVELS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;
export type PsalmLevel = (typeof PSALM_LEVELS)[number];

export const SUPPORTED_FRAMEWORKS = [
  'laravel',
  'symfony',
  'wordpress',
  'codeigniter',
  'yii',
  'slim',
  'laminas',
  'phalcon',
  'cake',
  'php-cms',
  'unknown'
] as const;

export type FrameworkName = (typeof SUPPORTED_FRAMEWORKS)[number];
