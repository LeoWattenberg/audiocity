import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = new URL('../assets/wavpack/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('source-manifest.json', directory), 'utf8')) as {
	toolchain: { image: string; sourceDateEpoch: string };
	sources: Record<string, string>; compiledSources: string[]; wasm: { sha256: string };
};
for (const [path, expected] of Object.entries(manifest.sources)) {
	const actual = createHash('sha256').update(readFileSync(new URL(path, directory))).digest('hex');
	if (actual !== expected) throw new Error(`WavPack source digest mismatch: ${path}`);
}
if (process.argv.includes('--verify')) {
	const actual = createHash('sha256').update(readFileSync(new URL('wavpack.wasm', directory))).digest('hex');
	if (actual !== manifest.wasm.sha256) throw new Error('WavPack artifact digest mismatch.');
} else {
	const exported = ['_acwp_allocate', '_acwp_free', '_acwp_open', '_acwp_info', '_acwp_read', '_acwp_close'];
	execFileSync('docker', ['run', '--rm', '--user', `${process.getuid!()}:${process.getgid!()}`,
		'-e', `SOURCE_DATE_EPOCH=${manifest.toolchain.sourceDateEpoch}`, '-e', 'TZ=UTC', '-e', 'LC_ALL=C',
		'-v', `${root}:/source`, '-w', '/source', manifest.toolchain.image,
		'emcc', ...manifest.compiledSources.map(path => `assets/wavpack/native/${path}`),
		'-Iassets/wavpack/native', '-std=c11', '-O3', '-flto', '-mno-simd128', '-fno-fast-math', '-fno-finite-math-only',
		'-fvisibility=hidden', '-DNO_TAGS=1', '-DNDEBUG=1', '-DHAVE___BUILTIN_CLZ=1', '-D_POSIX_C_SOURCE=200809L',
		'-ffile-prefix-map=/source=.', '-fdebug-prefix-map=/source=.', '--no-entry',
		'-sSTANDALONE_WASM=1', '-sFILESYSTEM=0', '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=8388608',
		'-sMAXIMUM_MEMORY=134217728', '-sSTACK_SIZE=131072', '-sMALLOC=emmalloc', '-sASSERTIONS=0',
		'-sSUPPORT_LONGJMP=0', '-sDISABLE_EXCEPTION_CATCHING=1', '-sERROR_ON_UNDEFINED_SYMBOLS=1',
		`-sEXPORTED_FUNCTIONS=${JSON.stringify(exported)}`, '-Wl,--strip-all', '-o', 'assets/wavpack/wavpack.wasm',
	], { cwd: root, stdio: 'inherit' });
	const sha256 = createHash('sha256').update(readFileSync(new URL('wavpack.wasm', directory))).digest('hex');
	if (manifest.wasm.sha256 && manifest.wasm.sha256 !== sha256) throw new Error(`Rebuilt WavPack digest differs: ${sha256}`);
	if (!manifest.wasm.sha256) {
		manifest.wasm.sha256 = sha256;
		writeFileSync(new URL('source-manifest.json', directory), `${JSON.stringify(manifest, null, 2)}\n`);
	}
	process.stdout.write(`WavPack SHA-256: ${sha256}\n`);
}
