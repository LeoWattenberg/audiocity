/* SPDX-License-Identifier: AGPL-3.0-only */
/* global self, fetch, URL */
import { decodeWavPack, MAX_INPUT_BYTES } from './decode.js';

self.onmessage = async event => {
	try {
		const url = new URL(event.data.url);
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid audio playback URL.');
		const response = await fetch(url, { credentials: 'omit' });
		if (!response.ok) throw new Error(`Audio could not be loaded (${response.status}). Refresh the page and try again.`);
		const declared = Number(response.headers.get('content-length'));
		if (declared > MAX_INPUT_BYTES) throw new Error('WavPack playback accepts files up to 64 MiB. Download larger originals to play them locally.');
		if (!response.body) throw new Error('The audio response is empty.');
		const reader = response.body.getReader(), chunks = [];
		let length = 0;
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				length += value.byteLength;
				if (length > MAX_INPUT_BYTES) throw new Error('WavPack playback accepts files up to 64 MiB. Download larger originals to play them locally.');
				chunks.push(value);
			}
		} finally { await reader.cancel(); }
		const encoded = new Uint8Array(length);
		let position = 0;
		for (const chunk of chunks) { encoded.set(chunk, position); position += chunk.byteLength; }
		const wav = await decodeWavPack(encoded.buffer);
		self.postMessage({ wav }, [wav]);
	} catch (error) {
		self.postMessage({ error: error instanceof Error ? error.message : 'WavPack playback failed.' });
	}
};
