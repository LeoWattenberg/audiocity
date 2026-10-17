/* Audiocity's bounded in-memory WavPack playback bridge.
 * SPDX-License-Identifier: AGPL-3.0-only
 * Reader callbacks follow Soundscaper's soundscaper_wavpack.c bridge.
 * WavPack itself is BSD-3-Clause; see ../licenses/WAVPACK.txt.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "wavpack.h"

#define EXPORT __attribute__((used, visibility("default")))
#define MAX_INPUT (64u * 1024u * 1024u)
#define MAX_PCM (128u * 1024u * 1024u)
#define MAX_CHUNK 16384u

typedef struct {
    const unsigned char *data;
    int64_t size, position;
    WavpackContext *context;
    uint32_t frames, channels, sample_rate, bits;
    int is_float;
} Input;

static int32_t read_bytes(void *id, void *data, int32_t count) {
    Input *input = id;
    if (!input || !data || count <= 0) return 0;
    int64_t remaining = input->size - input->position;
    if (remaining < count) count = (int32_t)remaining;
    if (count <= 0) return 0;
    memcpy(data, input->data + input->position, (size_t)count);
    input->position += count;
    return count;
}
static int32_t write_bytes(void *id, void *data, int32_t count) { (void)id; (void)data; (void)count; return 0; }
static int64_t position(void *id) { return ((Input *)id)->position; }
static int set_position(void *id, int64_t offset) {
    Input *input = id;
    if (offset < 0 || offset > input->size) return -1;
    input->position = offset;
    return 0;
}
static int relative_position(void *id, int64_t delta, int mode) {
    Input *input = id;
    int64_t base = mode == SEEK_SET ? 0 : mode == SEEK_CUR ? input->position : mode == SEEK_END ? input->size : -1;
    if (base < 0 || (delta > 0 && base > INT64_MAX - delta) || (delta < 0 && base < INT64_MIN - delta)) return -1;
    return set_position(id, base + delta);
}
static int push_back(void *id, int value) {
    Input *input = id;
    if (input->position <= 0 || input->data[input->position - 1] != (unsigned char)value) return EOF;
    --input->position;
    return value;
}
static int64_t length(void *id) { return ((Input *)id)->size; }
static int can_seek(void *id) { return id != NULL; }
static int truncate_input(void *id) { (void)id; return -1; }
static int close_input(void *id) { (void)id; return 0; }
static WavpackStreamReader64 reader = { read_bytes, write_bytes, position, set_position, relative_position,
    push_back, length, can_seek, truncate_input, close_input };

EXPORT void *acwp_allocate(uint32_t bytes) { return bytes && bytes <= MAX_INPUT ? malloc(bytes) : NULL; }
EXPORT void acwp_free(void *pointer) { free(pointer); }

EXPORT void acwp_close(Input *input) {
    if (!input) return;
    if (input->context) WavpackCloseFile(input->context);
    free(input);
}

EXPORT Input *acwp_open(const void *data, uint32_t bytes) {
    if (!data || !bytes || bytes > MAX_INPUT) return NULL;
    Input *input = calloc(1, sizeof(*input));
    if (!input) return NULL;
    input->data = data;
    input->size = bytes;
    char error[80] = {0};
    input->context = WavpackOpenFileInputEx64(&reader, input, NULL, error, OPEN_NORMALIZE, 0);
    if (!input->context) { acwp_close(input); return NULL; }
    int64_t frames = WavpackGetNumSamples64(input->context);
    input->channels = WavpackGetNumChannels(input->context);
    input->sample_rate = WavpackGetSampleRate(input->context);
    input->bits = WavpackGetBitsPerSample(input->context);
    input->is_float = !!(WavpackGetMode(input->context) & MODE_FLOAT);
    if (frames <= 0 || input->channels < 1 || input->channels > 8
        || input->sample_rate < 1 || input->sample_rate > 384000
        || input->bits < 1 || input->bits > 32
        || frames > MAX_PCM / (input->channels * 4u)) {
        acwp_close(input);
        return NULL;
    }
    input->frames = (uint32_t)frames;
    return input;
}

/* All geometry fits uint32_t because acwp_open applies the decoded-byte budget. */
EXPORT uint32_t acwp_info(Input *input, uint32_t field) {
    if (!input) return 0;
    switch (field) {
        case 0: return input->frames;
        case 1: return input->channels;
        case 2: return input->sample_rate;
        case 3: return input->bits;
        case 4: return input->is_float;
        default: return 0;
    }
}

EXPORT int32_t acwp_read(Input *input, void *output, uint32_t frames) {
    if (!input || !output || !frames || frames > MAX_CHUNK) return -1;
    uint32_t count = WavpackUnpackSamples(input->context, output, frames);
    if (WavpackGetNumErrors(input->context)) return -2;
    if (!input->is_float) {
        int32_t *integers = output;
        float scale = (float)((uint64_t)1 << (input->bits - 1));
        for (uint32_t i = 0; i < count * input->channels; ++i) {
            float sample = (float)integers[i] / scale;
            memcpy(integers + i, &sample, sizeof(sample));
        }
    }
    return (int32_t)count;
}
