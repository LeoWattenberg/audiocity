# Operations and recovery

Audiocity uses one process, one SQLite database, and one local filesystem. The data directory contains `audiocity.sqlite`, SQLite WAL/SHM files while running, `signing.key`, and `blobs/`. All must be treated as confidential. The signing key protects temporary download URLs; keep it with backups. The container runs as UID/GID 1000 (`node`), and Docker initializes the named volume with that ownership. For a bind mount, create the directory with that owner before starting.

## Back up and restore

Stop the server before copying the volume so metadata and blob files form a consistent backup:

```sh
docker compose stop audiocity
mkdir -p backups
docker compose run --rm --no-deps -T --entrypoint tar audiocity -C /data -czf - . > backups/audiocity.tar.gz
docker compose start audiocity
```

The archive is confidential and unencrypted; encrypt it or place it in protected backup storage. Restore to an empty named volume, with the server stopped:

```sh
docker compose stop audiocity
docker compose run --rm --no-deps -T --entrypoint tar audiocity -C /data -xzf - < backups/audiocity.tar.gz
docker compose start audiocity
```

Do not overlay a backup onto a different populated database. Preserve filesystem ownership and use the same application release for the initial restore. Download URLs last one hour; restoring the signing key preserves valid outstanding URLs, while restoring metadata and blobs preserves account/project history.

## Recover a password

Changing an environment password after initialization does not change an existing account. Stop the server and use the recovery command against the same volume:

```sh
docker compose stop audiocity
read -rsp 'New password: ' AUDIOCITY_NEW_PASSWORD; echo
export AUDIOCITY_NEW_PASSWORD
docker compose run --rm --no-deps -e AUDIOCITY_NEW_PASSWORD audiocity \
  node dist/admin.js reset-password admin@audiocity.local
unset AUDIOCITY_NEW_PASSWORD
docker compose start audiocity
```

The password must have 12–256 characters. This revokes the account's existing access/refresh tokens and authorization codes. Replace `reset-password` with `create-user` to create an ordinary account offline. Administrator creation is restricted to the first startup; the API cannot grant administrator status through a registration field.

For a native Node checkout use `AUDIOCITY_NEW_PASSWORD=… node src/admin.ts reset-password EMAIL`, with the same `AUDIOCITY_DATA_DIR` and the running server stopped. Avoid entering credentials directly into shell history on a shared machine.

## Transfers and storage

Incoming uploads stream to temporary files on the data volume and become downloadable only after explicit completion. Declared sizes reserve account quota; unbounded native block uploads are metered while streaming. Original files, retained historical revisions, optional mixdowns, and confirmed blocks count toward quota. Deduplication is scoped to one account and the claimed Audacity block hash.

Transfers expire after 24 hours by default. Native GET `/sync` can renew missing transfer capabilities. Restart recovery removes incomplete temporary files; expired pending reservations are retired. Delete obsolete audio/projects through the API to release their bytes. Revision history is retained until explicitly deleted. There is no automatic history-retention policy, replication, or external object-store garbage collection.

When moving a complete backup to another data-directory location, startup rebases the stored blob paths. When the public origin changes, project GET `/sync` refreshes pending upload URLs to the new origin while preserving their bytes. Request fresh download URLs from the new server; old hostnames and URLs are not redirected automatically.

If a client changes an audio item from shared to private, new public metadata requests are denied immediately. Previously issued signed media URLs remain valid until their one-hour expiry. They are bearer capabilities and should not be logged or shared unintentionally. They identify an immutable blob, not an ongoing authorization session.

The service disables automatic HTTP request logging to avoid logging URL capabilities and redacts authorization/cookie fields from structured logs. A reverse proxy may log URLs independently; configure it to omit query strings for `/uploads/` and `/media/`.

## Shared audio directory

Set `AUDIOCITY_SHARED_DIR` to an existing directory visible to the server process.
For Docker, mount the host directory read-only and configure its path inside the
container. The shared library combines indexed folder recordings with ready
public uploads; uploads continue to use Audiocity's managed blob storage. See
[directory configuration and library API](library-api.md) for a Compose example.

Folder originals are read in place, without copying or rewriting them. Back up
that directory separately from Audiocity's data volume. Its titles, categories,
tags and other editable metadata live in SQLite and are covered by the normal
database backup. Folder bytes do not consume an uploader's blob quota. Symlinks
and files outside the configured directory are excluded. Folder recordings are
available to signed-in accounts, while public upload playback links also work
without signing in. Each account can hide shared recordings from its default
Audacity lists without changing other accounts' preferences.

Shared media uses expiring capability URLs under `/shared-media/`; exclude their
query strings from reverse-proxy logs just like `/media/` and `/uploads/`.

## HTTPS reverse proxy

Configure the external origin in `AUDIOCITY_PUBLIC_URL` so returned upload/download URLs match what clients can reach. The service does not infer this from forwarded headers. A proxy can terminate TLS and stream requests to `127.0.0.1:8080`. Allow the configured maximum file size and uploads lasting up to 30 minutes; avoid a short default proxy timeout. The application listens at the origin root and does not support a URL path prefix.

## Health and shutdown

Docker checks `/health` every 30 seconds. The process handles SIGTERM/SIGINT and stops accepting new work before closing its database. Compose allows 35 seconds for graceful shutdown; a larger file transfer may need retry/resume after a container stop. `docker compose restart` preserves the volume and account credentials.
