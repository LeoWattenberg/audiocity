# audio.com compatibility contract

Audiocity implements the audio and native project subset used by editor clients.
Its API origin can replace audio.com's API origin for those operations; accounts,
OAuth clients and consent belong to the selected server. It does not implement
every audio.com product endpoint.

The public contract is audio.com's [OpenAPI document](https://api.audio.com/v1/openapi.json),
checked on 2026-10-15. Native project behavior was additionally compared with
authenticated audio.com tests on that date and Audacity source pinned in
[project-protocol.md](project-protocol.md). `test/audio-com-parity.test.ts` records
regressions for the concrete differences found in that comparison:

- Native project/snapshot creation returns 200 with `project`, `snapshot`, and
  `sync`. Native completion returns 204 with no body, including repeat completion.
- Native descriptors and downloaded block hashes use lowercase; differently cased
  hashes reuse the same owner's block, including records written before this fix.
- `public all` is confined to public routes; a refresh narrowing to `all` permits
  native project access. User-agent impersonation is unnecessary.
- Public audio creation requires `mime`, `size`, and `category`; its omitted
  `is_listed` defaults to unlisted. A ready unlisted recording is accessible by its
  direct URL and absent from search. Existing private uploads remain private.
- The public audio library defaults to pages of 50. Search uses pages of ten.
- OAuth expiry comes from the configured provider; a one-year response is valid.

Both servers use OAuth code flow with PKCE S256 for registered public clients,
presigned PUT uploads followed by explicit success/failure hooks, owner-scoped
library CRUD, and signed downloads supporting byte ranges. Capability URLs are
opaque and must never receive the provider OAuth bearer token. Public audio view,
update, and delete remain owner-only; search returns ready listed recordings
across accounts.

The native sync contract carries serialized metadata and WavPack blocks, not a
complete AUP3 database. Audiocity accepts and returns these bytes without decoding
them. The project's whole-file AUP3/AUP4 archive transport, explicit `projects`
scope, private audio, capability discovery, server console and administration are
Audiocity extensions. Existing archive creation/completion retain their 201/200
responses and cannot stand in for native audio.com project synchronization.

This compatibility does not include collections, cover-image uploads, social
operations, statistics, subscription policies, processing/transcoding, waveforms,
or author/collection search results. Audio search matches literal substrings
rather than audio.com's relevance ranking. The server does not transcode media;
formats other than WavPack depend on the browser's native codec support. Windows
Audacity 3.7.9 has been tested manually for login, audio upload, cloud project
save/reopen, and preview generation against a WSL-hosted server. Other versions
still require validation.

Audiocity's browser playback adds a local WebAssembly decoder for WavPack
originals. Its shared-library extension can include a configured server directory
and other users' ready public uploads in native audio lists and search. Users can
disable this inclusion persistently; explicit console source filters remain
available. Audio editing and deletion stay owner-only, with administrators able
to edit metadata for server-directory recordings. See the [library API](library-api.md).
