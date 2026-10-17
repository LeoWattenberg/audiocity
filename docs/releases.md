# Releases and deployment packages

Get official downloads from [GitHub Releases](https://github.com/mindscaper-org/audiocity/releases/latest).
Each release provides:

| Archive | Purpose |
|---|---|
| `audiocity-VERSION-deploy.tar.gz` | Compose file, deployment script, example configuration, license, and operator/client guides |
| `audiocity-VERSION-docker-amd64.tar.gz` | Docker image for Linux Intel/AMD 64-bit servers |
| `audiocity-VERSION-docker-arm64.tar.gz` | Docker image for Linux ARM64 servers, including Docker Desktop on Apple Silicon |
| `audiocity-VERSION-node.tar.gz` | Compiled JavaScript with a lockfile and source archive; install production dependencies using Node.js 26.5.0 and npm 12.0.1 |
| `audiocity-VERSION-source.tar.gz` | Complete source, tests, workflows, and build instructions |
| `SHA256SUMS` | SHA-256 checksums of all five archives |

The deployment bundle's `./deploy.sh` chooses the Docker server's architecture,
downloads and verifies the image if that version is not already installed, loads
it, and runs `docker compose up -d --wait`. It requires Docker with Compose,
curl, and either sha256sum or shasum. Run it from a terminal with access to a local
Linux Docker daemon. Docker Desktop runs Linux containers on macOS and Windows;
use a POSIX shell such as WSL on Windows, or load the image and run Compose manually.

Checksums can also be checked manually in the downloads directory:

```sh
sha256sum --ignore-missing -c SHA256SUMS
```

On macOS use `shasum -a 256 FILE` and compare with its entry in SHA256SUMS.
The script retrieves public GitHub assets and needs no registry login. Keep
downloaded image archives for offline installs or rollback.

## Configure and upgrade

Copy `.env.example` to `.env` and edit it before the first start if needed. The
default port binds to loopback. Set the public origin and allowed editor origins,
and configure an HTTPS reverse proxy for a public deployment. See
[operations](operations.md) and [clients](clients.md).

The deployment bundle fixes the Compose project name to `audiocity`, so each
version reuses `audiocity_audiocity-data`. A source checkout started from a folder
named `audiocity` uses that same name by default. If migrating an existing install
with a different project name, set `COMPOSE_PROJECT_NAME=OLD_NAME` in your shell
before running deploy.sh and all other Compose commands, or migrate a
backup into the new volume before starting. Do not start two releases on the
same data volume.

Back up the stopped service before upgrading. Extract the new deployment bundle,
copy your existing `.env` into it, stop the old service, and run the new deploy.sh.
Keep the old bundle and backup. Roll back by stopping the new service and
restoring the backup into an empty volume using the previous release; do not
assume an older binary can read a newer database. `docker compose down` keeps
data, while `docker compose down -v` deletes it.

## Build packages locally

With the pinned Node.js and npm versions:

```sh
npm ci
npm run check
npm run package
npm run test:package
```

Archives and checksums are written to `dist/release/`. Source packaging uses an
explicit inventory and excludes `.env`, data, backups, dependencies, and local
Git history. The Node archive includes ready-to-run JavaScript and a matching
`dist/source.tar.gz`, served at `/source.tar.gz` for AGPL source availability.
It contains no platform-specific dependencies; `npm ci --omit=dev` installs
the locked dependencies on the target machine.

To export an image locally on its target architecture:

```sh
docker build -t audiocity:0.2.0 .
docker save audiocity:0.2.0 | gzip > dist/release/audiocity-0.2.0-docker-amd64.tar.gz
cd dist/release
sha256sum *.tar.gz > SHA256SUMS
```

Use `docker-arm64` in the filename when building on ARM64.

## Publish a release

The `.github/workflows/release.yaml` workflow runs for pushed `v*` tags. It checks
that the tag matches `package.json`, runs TypeScript, lint, integration, browser,
and compiled package tests, and builds Docker images on native amd64 and arm64
runners. Both images are loaded from their exported archives and tested using
the actual deployment bundle, including authentication, audio ranges, block
sync, whole-file archive round trips, and source availability. Only after all
checks pass does it publish a GitHub Release with all archives and checksums.

For the next release, update the version in `package.json` and the lockfile,
the service version in `src/app.ts`, `CHANGELOG.md`, and release notes in
`.github/release-notes.md`. Commit and push the release changes, then push the
matching tag:

```sh
git tag -a v0.2.0 -m 'Audiocity v0.2.0'
git push origin v0.2.0
```

Use the next version in place of `v0.2.0`. Published version tags and their
artifacts should remain immutable. The workflow uses GitHub's built-in token
with release write access only in the publishing job; no registry or npm
publishing credentials are required.
