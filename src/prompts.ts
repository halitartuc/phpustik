/**
 * MCP Prompts.
 *
 * Prompts are pre-baked templates the model can invoke with a single
 * argument. They save the model from having to construct the
 * instructions from scratch.
 *
 *   - review_php_code    → structured code review
 *   - explain_php_code   → line-by-line explanation
 *   - refactor_php_code  → refactoring suggestions
 *   - write_phpunit_test → generate a unit test
 *   - write_pest_test    → generate a Pest test
 *   - security_audit     → kick off a security review
 *   - upgrade_php        → migrate to a target PHP version
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';

const user = (text: string) => ({
  messages: [
    {
      role: 'user' as const,
      content: { type: 'text' as const, text }
    }
  ]
});

export const registerAllPrompts = (server: McpServer): void => {
  server.registerPrompt(
    'review_php_code',
    {
      title: 'Review PHP code',
      description: 'Bir PHP dosyasını PSR-12, güvenlik ve performans için review et.',
      argsSchema: z.object({
        filepath: z.string().describe('Review edilecek dosya yolu.'),
        focus: z
          .enum(['security', 'performance', 'maintainability', 'all'])
          .default('all')
          .describe('Review odağı.')
      })
    },
    ({ filepath, focus }) =>
      user(`Lütfen ${filepath} dosyasını aşağıdaki odakla review et: ${focus}.

Yapman gerekenler:
1. Önce dosyayı oku (phpustik read_file).
2. \`lint_php_file\` ile sözdizimi denetimi yap.
3. \`analyze_php_code\` ile PHPStan level=max çalıştır.
4. \`scan_vulnerable_functions\`, \`scan_sql_injection\`, \`scan_xss\` ile güvenlik taraması yap.
5. \`format_php_code\` ile PSR-12 uyumluluğunu kontrol et.
6. Bulguları severity (critical/high/medium/low) sırasıyla listele.
7. Her bulgu için somut bir öneri/değişiklik örneği ver.

Sadece kanıta dayalı bulguları rapor et. Tahmin yürütme.`)
  );

  server.registerPrompt(
    'explain_php_code',
    {
      title: 'Explain PHP code',
      description: 'Bir PHP dosyasını/kod parçasını satır satır açıkla.',
      argsSchema: z.object({
        filepath: z.string().describe('Açıklanacak dosya yolu.'),
        depth: z.enum(['overview', 'detailed', 'deep']).default('detailed').describe('Açıklama derinliği.')
      })
    },
    ({ filepath, depth }) =>
      user(`${filepath} dosyasını ${depth} seviyesinde açıkla.

Seviye tanımları:
- overview: dosyanın amacı, sınıfların/fonksiyonların listesi, giriş-çıkış ilişkileri.
- detailed: her sınıf ve public metodun işlevi, parametreler, dönüş değerleri, hata durumları.
- deep: implementasyon detayları, algoritma karmaşıklığı, edge case'ler, mimari kararlar.

Önce dosyayı oku, sonra açıklamayı Markdown başlıkları ile yap.`)
  );

  server.registerPrompt(
    'refactor_php_code',
    {
      title: 'Refactor PHP code',
      description: 'Bir PHP dosyası için somut refactoring önerileri üret.',
      argsSchema: z.object({
        filepath: z.string().describe('Refactor edilecek dosya yolu.'),
        goal: z
          .enum(['readability', 'testability', 'performance', 'type-safety', 'modernize'])
          .default('readability')
          .describe('Refactoring hedefi.')
      })
    },
    ({ filepath, goal }) =>
      user(`${filepath} dosyasını ${goal} odağıyla refactor et.

Adımlar:
1. \`suggest_refactoring\` ile mevcut kötü kokuları listele.
2. \`analyze_php_code\` ile statik analiz raporu al.
3. Her bulgu için: bulgu → neden sorun → önerilen değişiklik → değişiklik sonrası kod parçacığı.
4. Değişikliklerin geriye dönük uyumlu olup olmadığını belirt.
5. \`run_rector\` aracını kullanarak otomatikleştirilebilir olanları işaretle.

Yeni testler gerekiyorsa \`write_phpunit_test\` promptunu çağırmamı iste.`)
  );

  server.registerPrompt(
    'write_phpunit_test',
    {
      title: 'Write a PHPUnit test',
      description: 'Bir sınıf veya metot için PHPUnit testi üret.',
      argsSchema: z.object({
        filepath: z.string().describe('Test edilecek sınıfın dosya yolu.'),
        method: z.string().optional().describe('Sadece tek bir metodu test etmek için.'),
        coverage: z.enum(['happy-path', 'edge-cases', 'full']).default('full').describe('Test kapsamı.')
      })
    },
    ({ filepath, method, coverage }) =>
      user(`${filepath} dosyası${method ? `, ${method} metodu` : ''} için PHPUnit testi yaz.

Kapsam: ${coverage}.

Beklenen çıktı:
1. tests/Unit/... altında test dosyasının tam içeriği.
2. Data provider kullanımı (gerekli yerlerde).
3. Mock/stub kullanımı (bağımlılık izolasyonu).
4. Açıklayıcı test metod adları (testMethodDoesXWhenY).
5. Arrange-Act-Assert yapısına uygunluk.
6. Coverage yorumu: hangi branch'lerin örtüldüğü, hangilerinin eksik kaldığı.

Önce \`run_phpunit\` ile mevcut test suite'in çalıştığını doğrula, sonra yeni testi ekle.`)
  );

  server.registerPrompt(
    'write_pest_test',
    {
      title: 'Write a Pest test',
      description: 'Pest PHP framework için test üret (Pest kuruluysa).',
      argsSchema: z.object({
        filepath: z.string().describe('Test edilecek sınıfın dosya yolu.'),
        method: z.string().optional().describe('Sadece tek bir metodu test etmek için.')
      })
    },
    ({ filepath, method }) =>
      user(`${filepath} dosyası${method ? `, ${method} metodu` : ''} için Pest testi yaz.

Pest 2.x sürümü hedefle. \`it()\`, \`describe()\`, \`expect()\` zincirlerini ve dataset()'i kullan.`)
  );

  server.registerPrompt(
    'security_audit',
    {
      title: 'Security audit',
      description: 'Proje için tam güvenlik taraması başlat.',
      argsSchema: z.object({
        path: z.string().optional().describe('Taranacak dizin. Boş bırakılırsa proje kökü.')
      })
    },
    ({ path }) =>
      user(`Bu proje için tam güvenlik taraması yap${path ? ` (odak: ${path})` : ''}.

Sırasıyla çalıştır:
1. \`scan_secrets\` → hardcoded credentials
2. \`scan_vulnerable_functions\` → eval, system, unserialize vb.
3. \`scan_sql_injection\` → sorgu concatenation
4. \`scan_xss\` → unescaped output
5. \`composer_audit\` → bilinen CVE'ler

Bulguları severity sırasıyla, dosya:line referanslarıyla rapor et. Her bulgu için fix önerisi ver.`)
  );

  server.registerPrompt(
    'upgrade_php',
    {
      title: 'Upgrade to a target PHP version',
      description: "Projeyi belirli bir PHP sürümüne yükseltmek için yol haritası çıkar.",
      argsSchema: z.object({
        fromVersion: z.string().describe('Mevcut PHP sürümü. Örnek: 7.4'),
        toVersion: z.string().describe('Hedef PHP sürümü. Örnek: 8.3')
      })
    },
    ({ fromVersion, toVersion }) =>
      user(`Bu projeyi PHP ${fromVersion}'dan PHP ${toVersion}'a yükselt.

Adımlar:
1. \`check_php_compatibility\` ile uyumsuzlukları tara (targetVersion: ${toVersion}).
2. \`scan_vulnerable_functions\` ve \`scan_sql_injection\` çalıştır.
3. \`get_php_info\` ile hedef sürümün özelliklerini kontrol et (enums, readonly, fibers vb.).
4. \`add_strict_types\` ile strict_types ekle.
5. \`run_rector --dryRun\` ile otomatikleştirilebilir refactoring'leri listele.
6. Değişiklik listesini sırayla ver: hangi dosya, ne değişecek, neden.
7. Test stratejisi: \`run_phpunit\` ile doğrula.`)
  );
};
