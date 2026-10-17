/** Browser ES module, kept as source so deployment needs no client bundler. */
export const playbackClient = String.raw`
export async function attachAudioPlayer(container, {url, mime = '', name = 'Audio'}) {
	const source = new URL(url, location.href);
	if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) throw new Error('Invalid audio playback URL.');
	const wrapper = document.createElement('div'); wrapper.className = 'audio-player';
	const status = document.createElement('p'); status.setAttribute('role', 'status'); status.hidden = true;
	const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'metadata';
	audio.setAttribute('aria-label', 'Audio preview for ' + name);
	wrapper.append(status, audio); container.append(wrapper);
	let worker = null, objectUrl = null, timer = null, disposed = false;
	const stopWorker = () => {
		if (timer !== null) clearTimeout(timer); timer = null;
		if (worker) worker.terminate(); worker = null;
	};
	const fail = message => {
		if (disposed) return;
		stopWorker(); status.textContent = message; status.hidden = false; audio.hidden = true;
	};
	audio.addEventListener('error', () => fail('This browser could not play the recording. Download the original to play it locally.'));
	if (/^audio\/(?:x-)?wavpack(?:;|$)/i.test(mime) || /\.wv$/i.test(source.pathname)) {
		audio.hidden = true; status.hidden = false; status.textContent = 'Preparing WavPack playback in your browser…';
		try {
			worker = new Worker('/assets/wavpack/worker.js', {type: 'module'});
			worker.onmessage = event => {
				if (disposed) return;
				if (event.data.error) { fail(event.data.error); return; }
				if (!(event.data.wav instanceof ArrayBuffer)) { fail('The WavPack decoder returned an invalid recording.'); return; }
				objectUrl = URL.createObjectURL(new Blob([event.data.wav], {type: 'audio/wav'}));
				audio.src = objectUrl; audio.hidden = false; status.hidden = true; stopWorker();
			};
			worker.onerror = () => fail('WavPack playback could not start. Refresh the page and try again.');
			timer = setTimeout(() => fail('WavPack decoding took too long. Download the original to play it locally.'), 60000);
			worker.postMessage({url: source.href});
		} catch (error) { fail(error instanceof Error ? error.message : 'WavPack playback could not start.'); }
	} else audio.src = source.href;
	return {dispose() {
		if (disposed) return;
		disposed = true; stopWorker(); audio.pause(); audio.removeAttribute('src'); audio.load();
		if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; wrapper.remove();
	}};
}
`;
