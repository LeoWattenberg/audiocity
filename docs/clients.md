# Configure editor clients

The server implements audio.com-style storage APIs at your own origin. It does not replace DNS, use audio.com accounts, or intercept the real service. Each editor needs a way to configure its API and authorization origins. Keep its local project backup until you have tested upload, reopen, and download against your server.

## Audacity

The compatibility target is the native client source at commit [`b482a5e3ee5443c0a438908aaf1caf09250171a9`](https://github.com/audacity/audacity/tree/b482a5e3ee5443c0a438908aaf1caf09250171a9). The unversioned project endpoints and legacy audio upload endpoints match its DTO and transfer sequence. Audacity creates native snapshots and WavPack blocks itself; Audiocity stores and returns those bytes.

Audacity's `ServiceConfig.cpp` exposes these string settings under `/CloudServices/AudioCom/`. Use your server's externally reachable origin in place of `http://localhost:8080`:

| Setting | Local server value |
|---|---|
| `ApiEndpoint` | `http://localhost:8080` |
| `OAuthClientID` | `audiocity-desktop` |
| `OAuthClientSecret` | `audiocity-local-desktop` |
| `OAuthRedirectURL` | `http://localhost:8080/auth/callback` |
| `OAuthLoginPage` | `http://localhost:8080/auth/authorize?response_type=code&client_id={auth_client_id}&redirect_uri=audacity%3A%2F%2Flink&scope=all` |
| `FrontendURL` | `http://localhost:8080` |
| `AuthWithRedirectURL` | `http://localhost:8080/auth/check-and-redirect` |
| `TourPage` | `http://localhost:8080/` |
| `FinishUploadPage` | `http://localhost:8080/` |

The login-page `{auth_client_id}` placeholder is expanded by Audacity. Configure the same local client ID/secret in the server and the client. These are local compatibility values, not credentials copied from audio.com. User passwords and bearer tokens remain separate.

For a legacy build using `audacity.cfg`, close Audacity before editing its preferences and set the equivalent `[CloudServices/AudioCom]` entries. Back up its preferences first. For newer builds, use the settings backend or build-time defaults that the selected Audacity revision actually reads. Preference-file location and settings backend differ across versions/platforms; this repository has not validated a particular desktop installation. If an official binary does not expose or honor those overrides, a custom build is needed.

Change all relevant origins together. The browser-link, post-upload, tour, and authenticated browser-redirect defaults also point at audio.com; changing only the API origin is insufficient. In particular, Audacity's browser-session redirect carries a token and must point to your server.

Audacity 4's inspected password sign-in and optional registration use `/auth/token` and `/auth/register`. Its OAuth flow may use an ephemeral `http://127.0.0.1:PORT/` callback. The configured compatibility client supports that exact loopback-host/root-path pattern as well as `audacity://link`; dynamic browser clients retain exact registered redirects and PKCE.

Native cloud-project list/open uses `/project` without a format filter. Whole-file AUP3/AUP4 archives are intentionally absent from that list because the native downloader expects its serialized metadata plus separate blocks. Importing a whole-file archive into Audacity is a normal file-open operation after downloading the file through the console or archive API.

Native desktop end-to-end validation remains outstanding. Tests in this repository verify the source-derived HTTP contract, rather than launching or modifying Audacity.

## Soundscaper or another browser editor

No Soundscaper checkout is changed by this repository. Configure or add its service integration to use this server's base URL and OAuth endpoints. A hardcoded audio.com integration needs that client-side change before it can use Audiocity. Add the editor's origin to `AUDIOCITY_CORS_ORIGINS` and recreate the server container.

Register a public OAuth client once:

```http
POST /auth/client
Content-Type: application/json

{"client_name":"My Soundscaper","redirect_uris":["https://editor.example/auth/audiocity/callback"]}
```

Use the returned `client_id`. Authorization uses code flow with PKCE S256; retain a fresh verifier and state for each attempt, and validate state on return. See the [authentication guide](authentication.md) for the exact exchange.

- Scope `public` permits regular audio operations.
- Scope `projects` permits project upload/list/sync/download.
- Scope `public projects` grants both without administrator APIs; prefer this for third-party editors.
- Scope `all` is required by the native Audacity compatibility flow and also grants the user's administrative capabilities when that user is an administrator.

Audio upload and library APIs are documented in [audio-api.md](audio-api.md). For complete editor project files, create a project with `format: "aup3"` or `format: "aup4"`, upload the standalone checkpointed SQLite export, and complete the revision as described in [project-protocol.md](project-protocol.md). List with `/project?transport=all` or a format filter. Download the signed `file_url` and pass the bytes to the editor's supported project importer.

Store the OAuth refresh token using the editor's normal credential storage. Signed upload/download URLs are bearer capabilities and should not be embedded in permanent saved project data. A project ID/snapshot ID can be retained and used to request fresh URLs later.
