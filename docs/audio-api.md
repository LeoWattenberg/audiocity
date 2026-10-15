# Audio uploads

Audiocity preserves uploaded originals on the persistent data volume. It does not
transcode, normalize, or render waveforms. Playback uses the original source and
HTTP byte ranges. WAV duration is extracted when a normal RIFF `fmt`/`data` layout
is present; duration is otherwise zero. Browser playback depends on the browser's
codec support: WavPack and AIFF commonly require downloading into an editor.

## Upload an original

Send a bearer token with audio access to `POST /v1/audio/create`:

```json
{
  "name": "Rain.wav",
  "mime": "audio/wav",
  "size": 48044,
  "category": "recording",
  "title": "Evening rain",
  "visibility": "private"
}
```

The `201` response contains `audio` metadata and capability URLs `url`, `success`,
`fail`, and `progress`. `id` identifies the binary transfer; `audio.id` identifies
the audio resource. PUT the original bytes to `url` and then POST `success` (GET
is also accepted). Sending DELETE to `fail` cancels an unfinished upload. These
URLs include authorization secrets and must be treated as credentials. The
registered size must match the transferred size. A container signature check
rejects bytes inconsistent with the declared MIME type; this is not full media
decoding or a guarantee that the recording can play.

MIME families: WAV, MP3, FLAC, WavPack, AIFF, Ogg, and M4A/MP4, including audio.com
aliases. Maximum source size and per-user disk quota are configured by the server.
An uploaded recording remains `pending` and has an empty `play.url` until the
success callback confirms it. Failed or incomplete uploads cannot be shared.

## Library operations

All `/v1/audio/*` operations require the owner's bearer token, including view.
IDs may be UUIDs or `slug:your-audio-slug` for the owner's library.

| Method and path | Behavior |
| --- | --- |
| `GET /v1/audio/list` | Array of the current user's recordings, including pending uploads |
| `GET /v1/audio/view?id=…` | Metadata for one owned recording |
| `PATCH /v1/audio/update?id=…` | Edit title, slug, category, description, tags, license, visibility, or download permission |
| `POST /v1/audio/delete?id=…` | Delete owned metadata and source bytes; returns `204` |

Listing accepts `page` and `per-page` (1–100), `sort=newest`, `oldest`, or `az`, and
`q` for a title substring. Audio metadata includes `play.url` for ready uploads;
this is a temporary signed URL supporting `Range` requests. Refresh metadata when
a playback URL expires.

Title and name are limited to 256 characters, description to 500, and tags to 50
strings of at most 64 characters. Slugs use lowercase letters, digits and hyphens
and are unique within one user's library. Automatic slugs receive numeric suffixes
when needed. Categories and licenses follow the audio.com public API enumeration.

## Sharing

New uploads default to `visibility: "private"`. The owner must explicitly opt into
sharing:

- `private`: owner access only; excluded from public metadata and discovery.
- `unlisted`: anyone with the resource URL can listen; excluded from discovery.
- `public`: anyone can listen; included in `GET /public/audio` discovery.

For audio.com compatibility, explicitly providing `is_listed: true` means public,
and explicitly providing `is_listed: false` means unlisted. Omitting the field
keeps the private default. Explicit `visibility` takes precedence if both occur.

`GET /public/audio/:id` returns metadata only for ready, shared recordings.
`GET /audio/:id` also lets the authenticated owner read private metadata. Public
metadata contains the author's display name, username and user ID, without email,
account permissions or authentication details.

`GET /download/:id` returns an `items` array with the original file's `format`,
`url`, `size` and `source: true`. The owner can always obtain a ready original.
Other listeners require explicit `is_downloadable: true`. Listening still gives
access to the source bytes: download permission controls the download API, rather
than preventing a listener from saving media they can play. Previously issued
signed media URLs remain valid for up to an hour after changing visibility;
deleting the audio immediately makes those URLs unavailable.

## Audacity protocol compatibility

`POST /audio` accepts Audacity's `name`, `mime`, `size`, `public`, and `method`
fields. Its response additionally supplies `extra.audio` with `id`, `slug`, and
`username`, and a `progress` capability URL accepting PATCH requests. Explicit
`public: false` means unlisted, as with Audacity's original sharing flow.

`GET /my/audio` returns `items` and Audacity's pagination keys `total`, `pages`,
`page`, and `size`. Each item supplies the required `author` string, `created`
epoch, `source.size`, and `source.duration`. `GET /audio/:id` supplies expanded
author ID, download permission, title, tags and creation/update dates for the
Audacity import dialog. `GET /download/:id` marks the preserved original as the
source format, so Audacity can select it without a lossy transcode.

This implements the upload/library/source-download subset used by Audacity and
the audio.com public audio API CRUD shape. Cover image uploads, social features,
statistics, processing/transcoding callbacks and waveform generation are not
implemented.
