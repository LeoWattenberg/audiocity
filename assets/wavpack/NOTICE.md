# Browser WavPack playback

Audiocity uses WavPack 5.9.0, commit
`5803634a030e2a11dba602ba057b89cc34486c67`, under BSD-3-Clause.
The unmodified upstream decoder sources and license are included in `native/`
and `licenses/WAVPACK.txt`. Upstream: <https://github.com/dbry/WavPack>.

These sources, the memory-reader approach and the reproducible Emscripten
3.1.64 toolchain were reused from Soundscaper's audited WavPack runtime.
Soundscaper's float32 chunk bridge is not used: Audiocity's
`native/audiocity_decode.c` handles integer and float32 recordings for playback.
The bridge, browser wrapper and worker are AGPL-3.0-only, like Audiocity.

`wavpack.wasm` contains the decoder, the bridge and Emscripten's minimal C
runtime. The Emscripten, compiler-rt and musl licenses are included in
`licenses/`. No external codec service, filesystem, threads, SIMD, tag parsing,
DSD or legacy pre-WavPack-4 decoding is included.

The complete inputs and SHA-256 hashes are in `source-manifest.json`.
Rebuild with `node scripts/build-wavpack-wasm.ts` from the corresponding source
archive; Docker fetches the toolchain by immutable image digest. Verify the
checked-in source/artifact with `node scripts/build-wavpack-wasm.ts --verify`.
The generated decoder is checked in so ordinary Node/Docker builds need no C
toolchain or downloads.

Playback is decoded locally to IEEE float32 WAV and played through browser
audio controls, preserving floating-point precision. Non-finite samples are
silenced. Encoded files are limited to 64 MiB; decoded audio to 128 MiB,
8 channels and 384 kHz. Leaving the page terminates decoding and releases its
worker and playback URL. The uploaded original is never changed.
