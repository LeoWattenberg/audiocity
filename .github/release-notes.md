Self-hosted audio uploads and project synchronization, with accounts, a browser console, Audacity block transport, and whole-file AUP3/AUP4 archives.

### Download and deploy

1. Download and extract the **deploy.tar.gz** bundle below.
2. Install Docker with Compose, then run **`./deploy.sh`** inside the extracted folder. It downloads and verifies the image for your Docker server (Linux amd64 or arm64) and starts Audiocity.
3. Open **http://localhost:8080**. Run `docker compose logs audiocity` to retrieve the generated first-run administrator password, then change it after signing in.

Copy `.env.example` to `.env` before starting to customize the URL, administrator, quotas, or allowed editor origins. Use an HTTPS reverse proxy for a public deployment. Data persists in a Docker volume; back up before upgrades.

### Other packages

- **docker-amd64.tar.gz / docker-arm64.tar.gz**: prebuilt Linux images for offline installation using `docker load -i FILE`; use the deployment bundle's Compose file to start them.
- **node.tar.gz**: compiled JavaScript; requires Node.js 26.5.0 and npm 12.0.1. Extract, run `npm ci --omit=dev`, then follow the included README.
- **source.tar.gz**: full corresponding source and build instructions (AGPL-3.0-only). Running deployments also serve it at `/source.tar.gz`.
- **SHA256SUMS**: verify downloaded archives using `sha256sum --ignore-missing -c SHA256SUMS`, or `shasum -a 256 FILE` and compare with the matching entry.

Clients must be configured to use Audiocity; see the included `docs/clients.md`. Native Audacity desktop end-to-end validation remains outstanding. Run one server process against one local data volume. The included operations guide covers HTTPS, backup, password recovery, and upgrades.
