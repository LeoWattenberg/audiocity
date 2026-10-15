# Audiocity

Self-hosted audio uploads and Audacity project synchronization in one Docker container. SQLite holds account and revision metadata; a persistent data volume holds original audio, project snapshots, and audio blocks. No external database, object store, email service, or audio.com account is required.

Implemented:

- Accounts, administrator-created users, optional registration, OAuth authorization codes with PKCE, access/refresh tokens, and password recovery.
- Original sound uploads: WAV, MP3, FLAC, WavPack, AIFF, Ogg, and M4A, with private, unlisted, or public visibility and HTTP range playback/downloads.
- Audacity's native cloud snapshot/block protocol, missing-block reuse, resumable transfers, revisions, conflict detection, and history.
- Complete AUP3/AUP4 file revisions for clients such as Soundscaper, preserving the uploaded SQLite file byte for byte.
- A small browser console for accounts, uploads, libraries, sharing, and project archive downloads. Actions are available through its menu.

Compatibility is implemented and tested against the observed protocol. Native Audacity desktop end-to-end testing remains outstanding. Clients must be configured to use Audiocity: running the server does not redirect an existing audio.com integration. Whole-file archive storage and Audacity's native block transport are separate, explicitly identified formats. See [client setup](docs/clients.md) and [protocol details](docs/project-protocol.md).

## Start

Install Docker with Compose v2 or newer, then:

```sh
cd ~/git/audiocity
docker compose up --build -d
docker compose logs audiocity
```

Open <http://localhost:8080>. The first startup creates `admin@audiocity.local` and prints a randomly generated password once. Save it, sign in, and use **Menu → Change password**. Alternatively, set `AUDIOCITY_ADMIN_EMAIL` and a password of at least 12 characters in `.env` before the first startup. Existing accounts are not reset when these environment variables change.

The default Compose port binds to loopback. Data is retained in the `audiocity-data` named volume across container rebuilds and restarts. `docker compose down` retains it; `docker compose down -v` deletes it.

Without Compose:

```sh
docker build -t audiocity:local .
docker run -d --name audiocity --init --restart unless-stopped \
  -p 127.0.0.1:8080:8080 -v audiocity-data:/data audiocity:local
docker logs audiocity
```

## Configure

Copy `.env.example` to `.env` to override defaults. Recreate the container after configuration changes.

| Variable | Default / purpose |
|---|---|
| `AUDIOCITY_PUBLIC_URL` | `http://localhost:8080`; externally reachable origin, no path prefix |
| `AUDIOCITY_CORS_ORIGINS` | `http://localhost:8080`; comma-separated allowed editor origins |
| `AUDIOCITY_ADMIN_EMAIL` | `admin@audiocity.local`; initial administrator only |
| `AUDIOCITY_ADMIN_PASSWORD` | Generated once when blank; initial administrator only |
| `AUDIOCITY_REGISTRATION` | `false`; administrator can create accounts through the console |
| `AUDIOCITY_MAX_UPLOAD_BYTES` | 1 GiB per transfer |
| `AUDIOCITY_MAX_USER_BYTES` | 20 GiB per account, including retained revisions |
| `AUDIOCITY_AUDACITY_CLIENT_ID` | `audiocity-desktop`; configure the same value in Audacity |
| `AUDIOCITY_AUDACITY_CLIENT_SECRET` | `audiocity-local-desktop`; local compatibility client credential |
| `AUDIOCITY_BIND_ADDRESS` | `127.0.0.1`; Compose port binding |
| `AUDIOCITY_PORT` | `8080`; host port in Compose, listen port outside Docker |

Native Node runs additionally accept `AUDIOCITY_DATA_DIR` (default `./data`), `AUDIOCITY_HOST`, `AUDIOCITY_TOKEN_TTL_SECONDS` (3600), and `AUDIOCITY_UPLOAD_TTL_SECONDS` (86400). Compose intentionally keeps the internal port at 8080. If the host port changes, update `AUDIOCITY_PUBLIC_URL` and allowed origins too.

For another machine or a public deployment, set the public HTTPS URL and place a TLS reverse proxy in front of the loopback port. Keep the proxy's upload limit and request timeout large enough for your configured transfers; use HTTP/1.1 streaming and avoid buffering entire uploads. Set `AUDIOCITY_CORS_ORIGINS` to the actual Soundscaper/editor origin as well as the console origin. Credentials must travel over HTTPS outside a local machine. No live service requests are sent to audio.com.

## API

- [Audio uploads, listing, editing, sharing and downloads](docs/audio-api.md)
- [Project snapshots, whole-file archives, revisions, and resuming uploads](docs/project-protocol.md)
- [Authentication, scopes, OAuth clients and password changes](docs/authentication.md)
- [audio.com API compatibility and deliberate extensions](docs/audio-com-compatibility.md)
- [Audacity and Soundscaper client configuration](docs/clients.md)
- [Operations, recovery and backups](docs/operations.md)

`GET /health` checks service/database availability. `GET /.well-known/audiocity` advertises supported features and transfer limits; `GET /.well-known/oauth-authorization-server` advertises OAuth endpoints. Errors use `{ "status": 422, "name": "ValidationError", "message": "…" }`.

## Development and verification

Use Node.js **26.5.0** and npm **12.0.1**:

```sh
npm ci
npm run check
npm run build
npm run dev
```

`npm run check` runs strict TypeScript, type-aware ESLint, and the Node integration suite. Tests exercise auth, the Audacity DTO shapes, upload completion, cross-account isolation, conflicts, deduplication, archive persistence, streaming ranges, and transfer validation. Tests use temporary data directories and do not contact audio.com. `npm run build` produces `dist/`; the Docker image builds and runs that JavaScript as an unprivileged user.

The browser suite starts its own loopback server with disposable storage and runs the console workflows in headless Chromium:

```sh
npx playwright install chromium
npm run test:browser
```

Set `PLAYWRIGHT_PORT` if the default test port is in use.

For a running local or Docker server, use a disposable account to exercise the actual HTTP path:

```sh
AUDIOCITY_SMOKE_PASSWORD='your-password' npm run test:smoke
```

Set `AUDIOCITY_URL` and `AUDIOCITY_SMOKE_EMAIL` if needed. This creates and deletes test audio and projects. The native block fixtures are opaque test bytes, and archive fixtures test byte-preserving transport; they do not demonstrate that a desktop editor can open the fixtures.

## Scope

This implements the requested storage/upload/sync service, rather than all audio.com's social, subscription, collection, statistics, embedding, and discovery APIs. Audio stays in its original format; browser codec support determines preview playback. The server does not transcode, interpret native block audio, convert project generations, merge concurrent edits, or reconstruct whole project files from native block snapshots. Editors remain responsible for those operations.

Run one server process against one local data volume. Multi-replica operation, remote/network filesystems, and shared SQLite volumes are unsupported. See the operations guide for backup and cleanup behavior.

Licensed under [AGPL-3.0-only](LICENSE). See [notices](NOTICE.md). Built deployments serve their corresponding source at `/source.tar.gz`; the archive excludes local credentials and stored user data.
