import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Script } from 'node:vm';
import { fixture } from './helpers.ts';

void test('browser console is available anonymously with menu entry points and external assets', async () => {
	const f = await fixture();
	try {
		const home = await f.app.inject('/');
		assert.equal(home.statusCode, 200, home.body);
		assert.match(home.headers['content-type'] ?? '', /text\/html/);
		assert.match(home.body, /<summary>Menu<\/summary>/);
		assert.match(home.body, /\+ Upload/);
		assert.match(home.body, /Manage files/);
		assert.match(home.body, /data-action="library"/);
		assert.match(home.body, /src="\/console.js"/);
		assert.doesNotMatch(home.body, /<script[^>]*>[^<]+<\/script>/);
		assert.doesNotMatch(home.body, /test-password-for-admin|admin@example.test/);
		const script = await f.app.inject('/console.js');
		assert.equal(script.statusCode, 200);
		assert.match(script.headers['content-type'] ?? '', /javascript/);
		assert.doesNotThrow(() => new Script(script.body));
		const style = await f.app.inject('/console.css');
		assert.equal(style.statusCode, 200);
		assert.match(style.headers['content-type'] ?? '', /text\/css/);
	} finally { await f.cleanup(); }
});

void test('console policy isolates scripts, connections and embedding without third-party dependencies', async () => {
	const f = await fixture();
	try {
		const response = await f.app.inject('/');
		const csp = response.headers['content-security-policy'];
		assert.equal(typeof csp, 'string');
		assert.match(String(csp), /script-src 'self' 'wasm-unsafe-eval'/);
		assert.match(String(csp), /worker-src 'self'/);
		assert.match(String(csp), /media-src 'self' blob:/);
		assert.match(String(csp), /object-src 'none'/);
		assert.match(String(csp), /frame-ancestors 'none'/);
		assert.match(String(csp), /base-uri 'none'/);
		assert.equal(response.headers['referrer-policy'], 'no-referrer');
		assert.equal(response.headers['x-content-type-options'], 'nosniff');
		assert.equal(response.headers['cache-control'], 'no-store');
		assert.doesNotMatch(response.body, /https?:\/\//);
	} finally { await f.cleanup(); }
});

void test('native Audacity browser paths redirect to fixed console views without reflecting path IDs or query input', async () => {
	const f = await fixture();
	try {
		for (const [path, destination] of [
			['/someone/projects/foreign-project?next=https://other.example', '/?view=projects'],
			['/someone/projects?return=//other.example', '/?view=projects'],
			['/someone?next=https://other.example', '/'],
		] as const) {
			const response = await f.app.inject(path);
			assert.equal(response.statusCode, 302, response.body);
			assert.equal(response.headers.location, destination);
		}
	} finally { await f.cleanup(); }
});

void test('library, playback, edit and management URLs serve the console shell without reflecting URL input', async () => {
	const f = await fixture();
	try {
		for (const path of ['/library?tab=projects', '/upload', '/manage', '/admin/categories/manage', '/audio/unknown-id/play', '/audio/unknown-id/edit', '/someone/audio/missing-slug', '/someone/audio/missing-slug/edit?next=https://other.example']) {
			const response = await f.app.inject(path);
			assert.equal(response.statusCode, 200, response.body);
			assert.match(response.headers['content-type'] ?? '', /text\/html/);
			assert.match(response.body, /id="workspace"/);
			assert.doesNotMatch(response.body, /unknown-id|missing-slug|other\.example/);
		}
	} finally { await f.cleanup(); }
});
