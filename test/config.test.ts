import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readConfig } from '../src/config.ts';

void test('blank initial password means generate credentials and origin overrides remain explicit', () => {
	const defaults = readConfig({ AUDIOCITY_ADMIN_PASSWORD: '' });
	assert.equal(defaults.adminPassword, undefined);
	assert.equal(defaults.publicUrl, 'http://localhost:8080');
	assert.equal(defaults.sharedDir, undefined);
	assert.equal(readConfig({ AUDIOCITY_SHARED_DIR: '/srv/sfx' }).sharedDir, '/srv/sfx');
	assert.deepEqual(readConfig({ AUDIOCITY_CORS_ORIGINS: 'https://editor.example, https://sound.example' }).corsOrigins, ['https://editor.example', 'https://sound.example']);
});

void test('invalid origin, port and limits fail before the service starts', () => {
	for (const value of ['ftp://example.com', 'https://example.com/path', 'https://user:secret@example.com', 'https://example.com?x=y']) {
		assert.throws(() => readConfig({ AUDIOCITY_PUBLIC_URL: value }));
	}
	assert.throws(() => readConfig({ AUDIOCITY_PORT: '70000' }));
	assert.throws(() => readConfig({ AUDIOCITY_MAX_UPLOAD_BYTES: '-1' }));
});
