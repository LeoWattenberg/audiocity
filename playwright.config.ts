import { defineConfig } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4328);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
	testDir: './test/browser',
	testMatch: '**/*.spec.ts',
	fullyParallel: false,
	workers: 1,
	timeout: 60_000,
	expect: { timeout: 5_000 },
	outputDir: 'test-results',
	reporter: 'list',
	use: {
		baseURL,
		browserName: 'chromium',
		headless: true,
		acceptDownloads: true,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	webServer: {
		command: 'node test/browser/server.ts',
		url: `${baseURL}/health`,
		reuseExistingServer: false,
		timeout: 30_000,
		gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
	},
});
