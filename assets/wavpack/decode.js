/* SPDX-License-Identifier: AGPL-3.0-only */
/* global WebAssembly, fetch, URL */

export const MAX_INPUT_BYTES = 64 * 1024 * 1024;
export const MAX_PCM_BYTES = 128 * 1024 * 1024;
const CHUNK_FRAMES = 16384;
const imports = {
	env: {
		emscripten_notify_memory_growth() {},
		abort() { throw new Error('WavPack ran out of working memory.'); },
	},
	wasi_snapshot_preview1: {
		fd_close: () => 8, fd_write: () => 8, fd_seek: () => 8,
		proc_exit() { throw new Error('WavPack decoder stopped unexpectedly.'); },
	},
};

/** Decode integer or floating-point WavPack to interleaved IEEE float WAV.
 * Decoding remains in the browser worker; the original upload is unchanged.
 */
export async function decodeWavPack(encoded, wasmSource = new URL('./wavpack.wasm', import.meta.url)) {
	if (!(encoded instanceof ArrayBuffer) || encoded.byteLength < 32 || encoded.byteLength > MAX_INPUT_BYTES) {
		throw new Error('WavPack playback accepts files up to 64 MiB. Download larger originals to play them locally.');
	}
	if (new DataView(encoded).getUint32(0, false) !== 0x7776706b) throw new Error('This file is not a WavPack recording.');
	const wasm = wasmSource instanceof ArrayBuffer || ArrayBuffer.isView(wasmSource)
		? wasmSource : await loadWasm(wasmSource);
	const module = await WebAssembly.compile(wasm);
	for (const item of WebAssembly.Module.imports(module)) {
		if (item.kind !== 'function' || typeof imports[item.module]?.[item.name] !== 'function') {
			throw new Error('WavPack decoder has an unexpected runtime dependency.');
		}
	}
	const instance = await WebAssembly.instantiate(module, imports);
	const api = instance.exports;
	api._initialize();
	let input = 0, stream = 0, output = 0;
	try {
		input = api.acwp_allocate(encoded.byteLength);
		if (!input) throw new Error('The browser cannot allocate memory for this WavPack recording.');
		new Uint8Array(api.memory.buffer, input, encoded.byteLength).set(new Uint8Array(encoded));
		stream = api.acwp_open(input, encoded.byteLength);
		if (!stream) throw new Error('Unsupported or damaged WavPack recording. Playback supports up to 8 channels, 384 kHz and 128 MiB of decoded audio.');
		const frames = api.acwp_info(stream, 0), channels = api.acwp_info(stream, 1), sampleRate = api.acwp_info(stream, 2);
		const pcmBytes = frames * channels * 4;
		if (!Number.isSafeInteger(pcmBytes) || pcmBytes <= 0 || pcmBytes > MAX_PCM_BYTES) throw new Error('The decoded WavPack recording exceeds the 128 MiB playback limit.');
		const wav = new ArrayBuffer(44 + pcmBytes);
		const view = new DataView(wav);
		writeWavHeader(view, pcmBytes, channels, sampleRate);
		output = api.acwp_allocate(CHUNK_FRAMES * channels * 4);
		if (!output) throw new Error('The browser cannot allocate WavPack decoding memory.');
		let position = 0;
		while (position < frames) {
			const wanted = Math.min(CHUNK_FRAMES, frames - position);
			const count = api.acwp_read(stream, output, wanted);
			if (count !== wanted) throw new Error('The WavPack recording is truncated or failed its checksum.');
			const samples = new Float32Array(api.memory.buffer, output, count * channels);
			for (let index = 0; index < samples.length; index++) {
				// WAV float32 preserves the decoder's precision. Non-finite values are silent.
				view.setFloat32(44 + ((position * channels) + index) * 4, Number.isFinite(samples[index]) ? samples[index] : 0, true);
			}
			position += count;
		}
		if (api.acwp_read(stream, output, 1) !== 0) throw new Error('WavPack sample count or checksum is invalid.');
		return wav;
	} finally {
		if (stream) api.acwp_close(stream);
		if (output) api.acwp_free(output);
		if (input) api.acwp_free(input);
	}
}

async function loadWasm(source) {
	const response = await fetch(source, { credentials: 'omit' });
	if (!response.ok) throw new Error(`WavPack decoder could not load (${response.status}).`);
	return response.arrayBuffer();
}

function writeWavHeader(view, pcmBytes, channels, sampleRate) {
	for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVEfmt '], [36, 'data']]) {
		for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index));
	}
	view.setUint32(4, pcmBytes + 36, true); view.setUint32(16, 16, true);
	view.setUint16(20, 3, true); view.setUint16(22, channels, true);
	view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * 4, true);
	view.setUint16(32, channels * 4, true); view.setUint16(34, 32, true); view.setUint32(40, pcmBytes, true);
}
