/**
 * Pattern catalogues used by the security scanning tools.
 *
 * Each catalogue is an ordered list of `{ id, label, regex, severity }`
 * entries. The list is intentionally small and conservative — every
 * pattern has been manually vetted to keep false-positives low.
 *
 * If you add a new pattern:
 *   1. Pick a unique id (snake_case, namespaced).
 *   2. Choose a severity from 'critical' | 'high' | 'medium' | 'low' | 'info'.
 *   3. Provide at least one example in the JSDoc.
 *   4. Make the regex Unicode-aware only when needed; most patterns are ASCII.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Pattern {
  readonly id: string;
  readonly label: string;
  readonly severity: Severity;
  readonly regex: RegExp;
  readonly description: string;
}

export const SECRET_PATTERNS: readonly Pattern[] = [
  {
    id: 'aws_access_key',
    label: 'AWS Access Key ID',
    severity: 'critical',
    regex: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[0-9A-Z]{16}\b/g,
    description: 'AWS access key id (16 chars).'
  },
  {
    id: 'aws_secret_key',
    label: 'AWS Secret Access Key',
    severity: 'critical',
    regex: /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g,
    description:
      'Candidate AWS secret (40 chars base64-ish). False-positive risk is non-trivial; context required.'
  },
  {
    id: 'github_pat',
    label: 'GitHub Personal Access Token',
    severity: 'critical',
    regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
    description: 'GitHub personal access token (ghp_, gho_, ghu_, ghs_, ghr_).'
  },
  {
    id: 'github_fine_grained',
    label: 'GitHub Fine-Grained Token',
    severity: 'critical',
    regex: /\bgithub_pat_[A-Za-z0-9_]{82}\b/g,
    description: 'GitHub fine-grained personal access token.'
  },
  {
    id: 'slack_token',
    label: 'Slack Token',
    severity: 'high',
    regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
    description: 'Slack OAuth token (xoxb-, xoxp-, xoxa-, xoxr-, xoxs-).'
  },
  {
    id: 'stripe_live',
    label: 'Stripe Live Secret Key',
    severity: 'critical',
    regex: /\bsk_live_[A-Za-z0-9]{20,}\b/g,
    description: 'Stripe live secret key.'
  },
  {
    id: 'stripe_test',
    label: 'Stripe Test Secret Key',
    severity: 'medium',
    regex: /\bsk_test_[A-Za-z0-9]{20,}\b/g,
    description: 'Stripe test secret key (often committed by mistake).'
  },
  {
    id: 'google_api_key',
    label: 'Google API Key',
    severity: 'high',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    description: 'Google API key (39 chars after AIza).'
  },
  {
    id: 'private_key_block',
    label: 'PEM Private Key',
    severity: 'critical',
    regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    description: 'Inline PEM private key.'
  },
  {
    id: 'jwt',
    label: 'JSON Web Token',
    severity: 'medium',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    description: 'Inline JSON Web Token.'
  },
  {
    id: 'basic_auth_url',
    label: 'Basic Auth in URL',
    severity: 'high',
    regex: /https?:\/\/[^\s:@/]+:[^\s:@/]+@[^\s/]+/g,
    description: 'URL containing embedded user:password credentials.'
  },
  {
    id: 'php_constant_db',
    label: 'Hardcoded DB credential',
    severity: 'high',
    regex: /(?:DB_PASSWORD|DB_USERNAME|DB_HOST|REDIS_PASSWORD|MYSQL_PASSWORD)\s*=\s*['"][^'"\s]{3,}['"]/g,
    description: 'PHP constant assignment of a sensitive DB / cache credential.'
  }
];

export const VULNERABLE_FUNCTION_PATTERNS: readonly Pattern[] = [
  {
    id: 'eval_input',
    label: 'eval() on dynamic data',
    severity: 'critical',
    regex: /\beval\s*\(\s*\$[A-Za-z_][A-Za-z0-9_]*/g,
    description: 'eval() called with a variable — almost always a code-injection sink.'
  },
  {
    id: 'assert_code',
    label: 'assert() with string (PHP < 8)',
    severity: 'high',
    regex: /\bassert\s*\(\s*['"][^'"]+['"]\s*[,)]/g,
    description: 'assert() with a string argument executes PHP code on PHP < 8.'
  },
  {
    id: 'preg_replace_e',
    label: 'preg_replace with /e modifier',
    severity: 'critical',
    regex: /preg_replace\s*\(\s*['"][^'"]*['"][^,)]*['"][^'"]*e[^'"]*['"]/g,
    description: 'The /e (eval) modifier executes the replacement as PHP code (PHP < 7).'
  },
  {
    id: 'unserialize_user',
    label: 'unserialize() on user input',
    severity: 'critical',
    regex: /\bunserialize\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE|SESSION|SERVER)\b/g,
    description: 'unserialize() of superglobal data — object-injection vector.'
  },
  {
    id: 'system_var',
    label: 'system() / exec() / passthru() / popen() with variable',
    severity: 'critical',
    regex: /\b(?:system|exec|passthru|popen|proc_open|shell_exec)\s*\(\s*\$[A-Za-z_]/g,
    description: 'Shell execution fed by a variable — command-injection sink.'
  },
  {
    id: 'include_var',
    label: 'include / require with variable',
    severity: 'high',
    regex: /\b(?:include|include_once|require|require_once)\s*\(\s*\$[A-Za-z_]/g,
    description: 'Dynamic include — local / remote file inclusion risk.'
  },
  {
    id: 'md5_password',
    label: 'md5() / sha1() for password hashing',
    severity: 'high',
    regex: /\b(?:md5|sha1)\s*\(\s*\$.*[Pp]ass(word)?/g,
    description: 'Weak password hashing — use password_hash() / bcrypt / argon2id.'
  },
  {
    id: 'mt_rand_crypto',
    label: 'mt_rand() for security purposes',
    severity: 'medium',
    regex: /\bmt_rand\s*\(\s*\)/g,
    description: 'mt_rand() is not cryptographically secure — use random_int().'
  },
  {
    id: 'extract_superglobal',
    label: 'extract($_GET / $_POST / $_REQUEST)',
    severity: 'high',
    regex: /\bextract\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE)\b/g,
    description: 'extract() on superglobals overwrites variables — register_globals-style bugs.'
  },
  {
    id: 'create_function',
    label: 'create_function() (deprecated)',
    severity: 'high',
    regex: /\bcreate_function\s*\(/g,
    description: 'create_function() internally eval()s and was removed in PHP 8.'
  },
  {
    id: 'mysql_real_escape',
    label: 'Deprecated mysql_* function',
    severity: 'high',
    regex: /\bmysql_(?:query|connect|fetch|real_escape_string)\s*\(/g,
    description: 'Removed in PHP 7 — also a magnet for SQL-injection bugs.'
  }
];

export const SQL_INJECTION_PATTERNS: readonly Pattern[] = [
  {
    id: 'string_concat_query',
    label: 'String concatenation in query',
    severity: 'high',
    regex: /(?:mysql_query|mysqli_query|\$pdo->query|\$db->query|\$this->db->query)\s*\(\s*["'][^"']*["']\s*\.\s*\$[A-Za-z_]/g,
    description: 'Query built by concatenating a variable — classic SQLi sink.'
  },
  {
    id: 'where_raw',
    label: 'whereRaw / orderByRaw with variable',
    severity: 'high',
    regex: /->(?:whereRaw|orderByRaw|selectRaw|havingRaw)\s*\(\s*["'][^"']*["']\s*\.\s*\$/g,
    description: 'Laravel query-builder raw method concatenating a variable.'
  },
  {
    id: 'db_statement_concat',
    label: 'DB::statement with concat',
    severity: 'high',
    regex: /DB::statement\s*\(\s*["'][^"']*["']\s*\.\s*\$/g,
    description: 'DB::statement() called with concatenated SQL.'
  },
  {
    id: 'sprintf_query',
    label: 'sprintf() in query',
    severity: 'medium',
    regex: /\$pdo->query\s*\(\s*sprintf\s*\(/g,
    description: 'sprintf() in a query is suspicious — usually safe but worth a glance.'
  }
];

export const XSS_PATTERNS: readonly Pattern[] = [
  {
    id: 'echo_request',
    label: 'Echo of $_GET / $_POST / $_REQUEST',
    severity: 'high',
    regex: /\b(?:echo|print|printf|print_r|var_dump)\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE|SERVER)\b/g,
    description: 'Direct output of a superglobal — XSS sink unless escaped downstream.'
  },
  {
    id: 'blade_unescaped',
    label: 'Blade {!! !!} unescaped echo',
    severity: 'medium',
    regex: /\{!!\s*[^!]+!!\}/g,
    description: 'Blade unescaped echo — bypasses {{ }} escaping.'
  },
  {
    id: 'twig_raw',
    label: 'Twig {{ var|raw }}',
    severity: 'medium',
    regex: /\{\{[^}]*\|\s*raw\s*\}\}/g,
    description: 'Twig raw filter disables autoescaping.'
  },
  {
    id: 'response_unescaped',
    label: '->setContent / Response with $_GET unescaped',
    severity: 'high',
    regex: /(?:setContent|Response)\s*\(\s*\$_(?:GET|POST|REQUEST)/g,
    description: 'Setting HTTP response body from superglobal without escaping.'
  }
];
