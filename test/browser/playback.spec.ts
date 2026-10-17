import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

for (const format of ['stereo-24bit', 'stereo-float32']) {
	test(`browser decodes ${format} WavPack locally and disposes playback resources`, async ({ page }) => {
		const fixture = await readFile(new URL(`../fixtures/${format}.wv`, import.meta.url));
		await page.route('**/generated-test.wv', route => route.fulfill({ body: fixture, contentType: 'audio/x-wavpack' }));
		await page.goto('/');
		const player = await page.evaluateHandle(async () => {
			const path = '/playback.js';
			const module = await import(path) as { attachAudioPlayer(container: HTMLElement, audio: {url: string; mime: string; name: string}): Promise<{dispose(): void}> };
			const container = document.createElement('div'); container.id = 'test-player'; document.body.append(container);
			return module.attachAudioPlayer(container, {url: '/generated-test.wv', mime: 'audio/x-wavpack', name: 'Generated stereo'});
		});
		const audio = page.locator('#test-player audio');
		await expect(audio).toBeVisible();
		await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState)).toBeGreaterThanOrEqual(1);
		expect(await audio.evaluate((element: HTMLAudioElement) => element.duration)).toBeCloseTo(0.1, 3);
		const source = await audio.getAttribute('src');
		expect(source).toMatch(/^blob:/);
		await audio.evaluate(async (element: HTMLAudioElement) => { element.volume = 0.25; element.currentTime = 0.05; await element.play(); element.pause(); });
		await player.evaluate(controller => { controller.dispose(); controller.dispose(); });
		await expect(audio).toHaveCount(0);
		expect(await page.evaluate(async url => {
			try { await fetch(url!); return false; } catch { return true; }
		}, source)).toBe(true);
	});
}

test('WavPack failures are readable and navigating away cancels an active worker', async ({ page }) => {
	await page.goto('/');
	await page.route('**/missing-test.wv', route => route.fulfill({ status: 404, body: 'Missing' }));
	const failed = await page.evaluateHandle(async () => {
		const path = '/playback.js';
		const module = await import(path) as { attachAudioPlayer(container: HTMLElement, audio: {url: string; mime: string}): Promise<{dispose(): void}> };
		const container = document.createElement('div'); container.id = 'failed-player'; document.body.append(container);
		return module.attachAudioPlayer(container, {url: '/missing-test.wv', mime: 'audio/x-wavpack'});
	});
	await expect(page.locator('#failed-player [role=status]')).toContainText('Audio could not be loaded (404)');
	await failed.evaluate(controller => { controller.dispose(); });
	const terminated = await page.evaluate(async () => {
		const OriginalWorker = window.Worker;
		let terminations = 0;
		window.Worker = class extends OriginalWorker {
			terminate(): void { terminations++; super.terminate(); }
		};
		try {
			const path = '/playback.js';
			const module = await import(path) as { attachAudioPlayer(container: HTMLElement, audio: {url: string; mime: string}): Promise<{dispose(): void}> };
			const container = document.createElement('div'); document.body.append(container);
			const player = await module.attachAudioPlayer(container, {url: '/not-fetched.wv', mime: 'audio/x-wavpack'});
			player.dispose(); player.dispose(); container.remove();
			return terminations;
		} finally { window.Worker = OriginalWorker; }
	});
	expect(terminated).toBe(1);
});
