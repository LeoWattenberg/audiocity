/* Deterministic, generated test audio; SPDX-License-Identifier: CC0-1.0
 * Build against WavPack 5.9.0 at the commit pinned in assets/wavpack/NOTICE.md:
 * cc generate-wavpack.c -I/path/to/WavPack/include -lwavpack -o generate-wavpack
 * Run in this directory. No user recordings are included in these fixtures.
 */
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include "wavpack.h"

static int write_block(void *file, void *bytes, int32_t count) {
    return fwrite(bytes, 1, count, file) == (size_t)count;
}
static int generate(const char *path, int floating) {
    const uint32_t frames = 4410;
    FILE *file = fopen(path, "wb");
    if (!file) return 1;
    WavpackContext *context = WavpackOpenFileOutput(write_block, file, NULL);
    WavpackConfig config = {0};
    config.bits_per_sample = floating ? 32 : 24;
    config.bytes_per_sample = floating ? 4 : 3;
    config.num_channels = 2;
    config.channel_mask = 3;
    config.sample_rate = 44100;
    config.float_norm_exp = floating ? 127 : 0;
    config.flags = CONFIG_FAST_FLAG;
    int32_t samples[4410 * 2];
    for (uint32_t index = 0; index < frames; index++) {
        int32_t value = ((int32_t)(index % 257) - 128) * 32768;
        for (uint32_t channel = 0; channel < 2; channel++) {
            int32_t signed_value = channel ? -value : value;
            if (floating) {
                float sample = (float)value / 8388608.0f + 1.0f / 1048576.0f;
                if (channel) sample = -sample;
                memcpy(samples + index * 2 + channel, &sample, 4);
            } else samples[index * 2 + channel] = signed_value;
        }
    }
    int ok = WavpackSetConfiguration64(context, &config, frames, NULL)
        && WavpackPackInit(context) && WavpackPackSamples(context, samples, frames)
        && WavpackFlushSamples(context);
    WavpackCloseFile(context);
    fclose(file);
    return !ok;
}
int main(void) { return generate("stereo-24bit.wv", 0) || generate("stereo-float32.wv", 1); }
