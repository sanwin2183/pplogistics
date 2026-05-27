/**
 * Shared init for admin-SDK scripts. Locates the service-account JSON and calls
 * initializeApp once. Used by setAdmin.ts, seedCategories.ts, seedSample.ts.
 *
 * Discovery order (first match wins):
 *   1. $GOOGLE_APPLICATION_CREDENTIALS   — explicit env var
 *   2. <root>/serviceAccount.json        — the recommended drop-in location
 *   3. <root>/service-account.json       — kebab-case variant
 *   4. <root>/service_accounts/*.json    — any JSON in the service_accounts dir
 *   5. <root>/service-accounts/*.json    — kebab-case variant
 *   6. <root>/*-firebase-adminsdk-*.json — Firebase's default download filename
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import fs from 'node:fs';
import path from 'node:path';

/** Primary database is named `default` (not `(default)`). */
export const DB_ID = 'default';

function projectRoot(): string {
  return path.resolve(import.meta.dirname ?? '.', '..');
}

function listJsonsIn(dir: string): string[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f));
}

function findCredentialFile(): string | null {
  const env = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (env && fs.existsSync(env)) return env;

  const root = projectRoot();
  const candidates = [
    path.join(root, 'serviceAccount.json'),
    path.join(root, 'service-account.json'),
    ...listJsonsIn(path.join(root, 'service_accounts')),
    ...listJsonsIn(path.join(root, 'service-accounts')),
    ...fs
      .readdirSync(root)
      .filter((f) => /-firebase-adminsdk-.*\.json$/.test(f))
      .map((f) => path.join(root, f)),
  ];

  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export function initAdminApp(): void {
  if (getApps().length > 0) return;
  const credPath = findCredentialFile();
  if (!credPath) {
    console.error('✗ No service-account JSON found.');
    console.error('  Looked for (in order):');
    console.error('   - $GOOGLE_APPLICATION_CREDENTIALS env var');
    console.error('   - <root>/serviceAccount.json');
    console.error('   - <root>/service_accounts/*.json');
    console.error('   - <root>/*-firebase-adminsdk-*.json');
    console.error('');
    console.error('  Get one from Firebase Console → ⚙ Project settings → Service accounts.');
    process.exit(1);
  }
  console.log(`· using credentials: ${path.relative(projectRoot(), credPath)}`);
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(credPath, 'utf8'))) });
}
