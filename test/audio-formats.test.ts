import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { audioFormat, validateAudio } from '../src/audio-formats.ts';

void test('supported audio container signatures and aliases preserve original format', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'audiocity-formats-'));
	try {
		for (const [mime, format, signature, offset, size] of [
			['audio/x-flac', 'flac', 'fLaC', 0, 4],
			['audio/flac', 'flac', 'fLaC', 0, 4],
			['audio/mpeg', 'mp3', 'ID3', 0, 3],
			['audio/MPA', 'mp3', 'ID3', 0, 3],
			['audio/mpa', 'mp3', 'ID3', 0, 3],
			['Audio/MPEG', 'mp3', 'ID3', 0, 3],
			['audio/x-wavpack', 'wv', 'wvpk', 0, 32],
			['audio/ogg', 'ogg', 'OggS', 0, 27],
			['application/ogg', 'ogg', 'OggS', 0, 27],
			['audio/mp4', 'm4a', 'ftypM4A ', 4, 12],
			['audio/x-aiff', 'aiff', 'FORM0000AIFF', 0, 12],
			['audio/aiff', 'aiff', 'FORM0000AIFC', 0, 12],
		] as const) {
			const path = join(directory, 'source');
			const bytes = Buffer.alloc(size);
			bytes.write(signature, offset);
			await writeFile(path, bytes);
			assert.equal(audioFormat(mime), format);
			assert.equal(await validateAudio(path, mime), 0);
		}
	} finally { await rm(directory, { recursive: true, force: true }); }
});

void test('container signatures must match declaration and unknown formats are rejected', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'audiocity-formats-'));
	try {
		const path = join(directory, 'source');
		await writeFile(path, 'fLaC');
		await assert.rejects(validateAudio(path, 'audio/wav'), /does not match/);
		await assert.rejects(validateAudio(path, 'audio/x-aiff'), /does not match/);
		assert.throws(() => audioFormat('text/plain'), /Unsupported/);
		await writeFile(path, Buffer.from([255, 251, 144, 0]));
		assert.equal(await validateAudio(path, 'audio/mpeg'), 0);
	} finally { await rm(directory, { recursive: true, force: true }); }
});
