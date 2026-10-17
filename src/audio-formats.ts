import { open } from 'node:fs/promises';
import { ApiError } from './core.ts';

const formats = new Map<string, string>([
	...['audio/wav', 'audio/vnd.wave', 'audio/wave', 'audio/x-wav'].map(mime => [mime, 'wav'] as const),
	...['audio/mpeg', 'audio/mp3', 'audio/mpa', 'audio/mpa-robust'].map(mime => [mime, 'mp3'] as const),
	...['audio/flac', 'audio/x-flac'].map(mime => [mime, 'flac'] as const),
	...['audio/x-wavpack', 'audio/x-wavpack-correction'].map(mime => [mime, 'wv'] as const),
	...['audio/aiff', 'audio/x-aiff'].map(mime => [mime, 'aiff'] as const),
	...['audio/ogg', 'audio/opus', 'audio/vorbis', 'audio/vorbis-config', 'application/ogg'].map(mime => [mime, 'ogg'] as const),
	...['audio/m4a', 'audio/mp4', 'audio/x-m4a', 'audio/mpeg4-generic'].map(mime => [mime, 'm4a'] as const),
	['audio/aac', 'aac'], ['audio/x-aac', 'aac'], ['audio/webm', 'webm'], ['video/webm', 'webm'],
]);

export function audioFormat(mime: string): string {
	const format = formats.get(mime.toLowerCase());
	if (!format) throw new ApiError(422, 'Unsupported audio MIME type.', 'ValidationError');
	return format;
}

/** Inspect the container without decoding or changing the uploaded original. */
export async function inspectAudio(path: string, expectedMime?: string): Promise<{ mime: string; duration: number }> {
	const file = await open(path, 'r');
	try {
		const buffer = Buffer.alloc(65_536);
		const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
		return inspectAudioHeader(buffer.subarray(0, bytesRead), expectedMime);
	} finally { await file.close(); }
}

/** Inspect bytes already read from a verified file handle. */
export function inspectAudioHeader(data: Buffer, expectedMime?: string): { mime: string; duration: number } {
	const text = (offset: number, length: number) => data.toString('ascii', offset, offset + length);
	const matches: Record<string, boolean> = {
		wav: data.length >= 12 && ['RIFF', 'RF64'].includes(text(0, 4)) && text(8, 4) === 'WAVE',
		mp3: data.length >= 3 && (text(0, 3) === 'ID3' || (data[0] === 255 && ((data[1] ?? 0) & 224) === 224 && ((data[1] ?? 0) & 6) !== 0)),
		flac: data.length >= 4 && text(0, 4) === 'fLaC',
		wv: data.length >= 32 && text(0, 4) === 'wvpk',
		aiff: data.length >= 12 && text(0, 4) === 'FORM' && ['AIFF', 'AIFC'].includes(text(8, 4)),
		ogg: data.length >= 27 && text(0, 4) === 'OggS',
		m4a: data.length >= 12 && text(4, 4) === 'ftyp',
		aac: data.length >= 7 && data[0] === 255 && ((data[1] ?? 0) & 246) === 240,
		webm: data.length >= 4 && data.readUInt32BE(0) === 0x1a45dfa3,
	};
	const format = expectedMime === undefined ? Object.keys(matches).find(format => matches[format]) : audioFormat(expectedMime);
	if (!format || !matches[format]) throw new ApiError(422, expectedMime === undefined ? 'Unsupported audio preview container.' : 'The uploaded container does not match the declared audio MIME type.', 'ValidationError');
	const mime = { wav: 'audio/wav', mp3: 'audio/mpeg', flac: 'audio/flac', wv: 'audio/x-wavpack', aiff: 'audio/aiff', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', webm: 'audio/webm' }[format]!;
	if (format !== 'wav') return { mime, duration: 0 };
	let byteRate = 0;
	for (let offset = 12; offset + 8 <= data.length;) {
		const length = data.readUInt32LE(offset + 4);
		if (text(offset, 4) === 'fmt ' && length >= 16 && offset + 24 <= data.length) byteRate = data.readUInt32LE(offset + 16);
		if (text(offset, 4) === 'data' && byteRate) return { mime, duration: Math.round(length / byteRate * 1000) };
		offset += 8 + length + length % 2;
	}
	return { mime, duration: 0 };
}

export async function validateAudio(path: string, mime: string): Promise<number> {
	return (await inspectAudio(path, mime)).duration;
}
