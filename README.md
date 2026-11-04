# Study Notes Markdown Reader

This repository publishes its Markdown study notes as a small, installable GitHub Pages reader. The Markdown files remain the source of truth; the site discovers and renders them rather than duplicating their content.

## Enable GitHub Pages

1. Push these files to the repository's default `main` branch.
2. On GitHub, open **Settings > Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Run the **Deploy Markdown reader to Pages** workflow, or push a commit to `main`.
5. Open `https://guptanitesh-ng.github.io/study/` after the workflow completes.

GitHub Pages is public for a public repository and may also be externally visible depending on the repository and organization Pages settings. Do not add secrets, private notes, credentials, or confidential files expecting Pages to make them private. The deployment script uses an allowlist and publishes only the reader assets and discovered note files.

## Install on Android

Open the Pages URL in Chrome, then use **Install app** or **Add to Home screen** from the browser menu. Visit the site online once after each deployment so the app shell and current notes can be cached. Notes can then be reopened offline.

Reading progress and the last-opened note are stored only in that browser's local storage. They are not committed, uploaded, or synchronized between devices. Clearing site data removes that progress.

## Add or update notes

Add Markdown files anywhere in the repository, including nested folders, then run:

```shell
python scripts/build_site.py
```

Commit the updated `notes-manifest.json` with the note changes. The Pages workflow regenerates the manifest and builds an allowlisted `_site` artifact on every deployment.

The generator excludes hidden folders, tooling folders, `.github`, `vendor`, and common project documents such as `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `CHANGELOG.md`. Update the exclusion sets in `scripts/build_site.py` if another Markdown support document should not appear in the library.

## Offline behavior

The service worker precaches the reader and every note listed in the generated manifest. When online, opened resources are refreshed in the cache. If a note was added after the last visit, connect once and reload or open it before relying on offline access.

The app vendors [marked 15.0.12](https://github.com/markedjs/marked) and [DOMPurify 3.2.6](https://github.com/cure53/DOMPurify), including their license files, so rendering and sanitization do not require a runtime CDN connection.
