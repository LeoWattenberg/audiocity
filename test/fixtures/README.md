# Generated WavPack playback fixtures

`stereo-24bit.wv` and `stereo-float32.wv` are deterministic 0.1 second,
44.1 kHz stereo sawtooth signals generated from `generate-wavpack.c` using
WavPack 5.9.0, commit `5803634a030e2a11dba602ba057b89cc34486c67`.
The left sample at frame `i` is `((i % 257) - 128) * 32768` as signed 24-bit
PCM; the right sample has the opposite sign. The float32 fixture divides both
samples by `8388608` and adds `1/1048576` before inverting the right channel,
with no quantization. That addition is smaller than a 16-bit PCM step. These
fixtures contain no user audio.

Compile the generator against that upstream WavPack version and run it in this
directory. The generator and recordings are dedicated to the public domain
under CC0-1.0. The decoder tests compare every decoded sample to this formula,
including channel order and float precision.
