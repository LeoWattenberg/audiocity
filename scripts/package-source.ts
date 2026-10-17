import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
// Explicit inventory excludes local credentials, database volumes and dependencies.
execFileSync('tar', ['-czf', 'dist/source.tar.gz',
	'src', 'assets', 'test', 'scripts', 'docs', '.github', 'CHANGELOG.md', 'package.json', 'package-lock.json',
	'tsconfig.json', 'tsconfig.build.json', 'eslint.config.js', 'playwright.config.ts', '.npmrc', '.nvmrc',
	'Dockerfile', 'compose.yaml', '.env.example', 'README.md', 'LICENSE', 'NOTICE.md', '.gitignore', '.dockerignore',
], { cwd: root, stdio: 'inherit' });
