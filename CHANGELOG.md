# Release notes

## 0.1.0

Initial release of Audiocity, a self-hosted audio upload and project sync server.

- Audio uploads, sharing, playback and range downloads, with per-user quotas.
- Accounts, administrator console, OAuth with PKCE and password recovery.
- Audacity native block synchronization and byte-preserving AUP3/AUP4 archives.
- SQLite metadata and persistent local storage in a single unprivileged container.
- Prebuilt Docker images for Linux amd64 and arm64, a Compose deployment bundle,
  compiled Node.js package, complete source, and SHA-256 checksums.

Clients must be configured to use this server. Audacity desktop end-to-end testing
remains outstanding; protocol integration tests and browser workflows cover the
implemented behavior. Run one process against one local data volume. See the
client and operations guides for compatibility, HTTPS, backups, and recovery.
