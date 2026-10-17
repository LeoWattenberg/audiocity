# Audiocity notices

Audiocity is an independent implementation of a self-hosted audio and project storage service, licensed under AGPL-3.0-only. It is not operated by audio.com, Muse Group, or the Audacity project.

The native cloud wire protocol was studied in Audacity's public source at commit `b482a5e3ee5443c0a438908aaf1caf09250171a9`, particularly `au3/libraries/au3-cloud-audiocom/`. Audacity's source carries its own GPL notices. This repository implements the observed protocol independently and does not contain copied Audacity implementation code, artwork, trademarks or model assets. The compatibility documentation links to the source evidence.

Browser-side WavPack playback uses WavPack 5.9.0, pinned to upstream commit `5803634a030e2a11dba602ba057b89cc34486c67`, under BSD-3-Clause. The decoder integration builds on Soundscaper's in-memory WebAssembly work. Decoder source, build instructions, provenance and third-party notices are distributed with the runtime in `assets/wavpack/` and in the corresponding source archive. Audiocity's adapter code is AGPL-3.0-only.

The container includes Node.js, Debian, Fastify, and npm dependencies with their respective licenses. Their license and copyright files remain included with the runtime packages. Consult `package-lock.json` for exact npm package versions and each package's distributed license. The full Audiocity license is in `LICENSE`.
