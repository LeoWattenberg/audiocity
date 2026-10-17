import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Fastify from 'fastify';
import { registerPlaybackAssets } from '../src/playback-assets.ts';

const decodeModule = await import(new URL('../assets/wavpack/decode.js', import.meta.url).href) as {
	decodeWavPack(input: ArrayBuffer, wasm: Uint8Array): Promise<ArrayBuffer>;
};
const wasm = await readFile(new URL('../assets/wavpack/wavpack.wasm', import.meta.url));
const fixture = async (name: string): Promise<ArrayBuffer> => {
	const bytes = await readFile(new URL(`./fixtures/${name}.wv`, import.meta.url));
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

for (const name of ['stereo-24bit', 'stereo-float32']) {
	await test(`WavPack ${name} decodes exact channel order and float32 PCM`, async () => {
		const result = await decodeModule.decodeWavPack(await fixture(name), wasm);
		const wav = new DataView(result);
		assert.equal(wav.getUint16(20, true), 3, 'IEEE float WAV preserves precision');
		assert.equal(wav.getUint16(22, true), 2);
		assert.equal(wav.getUint32(24, true), 44100);
		assert.equal(wav.getUint16(34, true), 32);
		assert.equal(wav.getUint32(40, true), 4410 * 2 * 4);
		for (let frame = 0; frame < 4410; frame++) {
			const expected = ((frame % 257) - 128) * 32768 / 8388608 + (name === 'stereo-float32' ? 1 / 1048576 : 0);
			assert.equal(wav.getFloat32(44 + frame * 8, true), expected);
			assert.equal(wav.getFloat32(48 + frame * 8, true), -expected || 0);
		}
	});
}

await test('WavPack rejects corrupted/truncated files and excessive decoded geometry', async () => {
	const good = await fixture('stereo-24bit');
	const corrupt = good.slice(0);
	new Uint8Array(corrupt)[Math.floor(corrupt.byteLength / 2)]! ^= 0x40;
	await assert.rejects(decodeModule.decodeWavPack(corrupt, wasm), /damaged|checksum/);
	await assert.rejects(decodeModule.decodeWavPack(good.slice(0, good.byteLength / 2), wasm), /damaged|checksum|truncated/);
	const huge = good.slice(0);
	new DataView(huge).setUint32(12, 0x7fffffff, true);
	await assert.rejects(decodeModule.decodeWavPack(huge, wasm), /128 MiB/);
	await assert.rejects(decodeModule.decodeWavPack(new ArrayBuffer(33), wasm), /not a WavPack/);
	await assert.rejects(decodeModule.decodeWavPack(new ArrayBuffer(64 * 1024 * 1024 + 1), wasm), /64 MiB/);
});

await test('codec artifact/source digests and public assets match the shipped inventory', async () => {
	const directory = new URL('../assets/wavpack/', import.meta.url);
	const manifest = JSON.parse(await readFile(new URL('source-manifest.json', directory), 'utf8')) as {
		sources: Record<string, string>; wasm: { sha256: string };
	};
	assert.equal(createHash('sha256').update(wasm).digest('hex'), manifest.wasm.sha256);
	const app = Fastify();
	try {
		await registerPlaybackAssets(app);
		for (const [path, expected] of Object.entries(manifest.sources)) {
			const file = await readFile(new URL(path, directory));
			assert.equal(createHash('sha256').update(file).digest('hex'), expected, path);
			const response = await app.inject(`/assets/wavpack/${path}`);
			assert.equal(response.statusCode, 200);
			assert.deepEqual(response.rawPayload, file);
		}
		for (const path of ['NOTICE.md', 'decode.js', 'worker.js', 'wavpack.wasm']) {
			const response = await app.inject(`/assets/wavpack/${path}`);
			assert.equal(response.statusCode, 200);
			assert.deepEqual(response.rawPayload, await readFile(new URL(path, directory)));
		}
		const module = await app.inject('/playback.js');
		assert.equal(module.statusCode, 200);
		assert.match(module.body, /export async function attachAudioPlayer/);
		assert.equal((await app.inject('/assets/wavpack/native/../../../../.env')).statusCode, 404);
	} finally { await app.close(); }
});
