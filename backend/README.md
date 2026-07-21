# Knowledge Review Deck Market API

中文接口和功能文档见 [`API-DOCUMENTATION.md`](./API-DOCUMENTATION.md)。

Standalone backend for the deck market. It is intentionally separate from the Electron renderer and does not read or write the user's local `state.json`.

## Local setup

```powershell
cd backend
Copy-Item .env.example .env
# Edit .env and set long random MARKET_ACCESS_KEY and JWT_SECRET values.
npm install
npm run db:generate
npm run db:deploy
$env:ADMIN_USERNAME = 'admin'
$env:ADMIN_PASSWORD = 'change-this-to-a-long-password'
npm run admin:create
npm run dev
```

The API listens on `http://localhost:4000` by default. The health endpoint is `GET /health`.

## Docker setup

```powershell
cd backend
# Keep the existing .env values for the PostgreSQL container that already
# contains the market data: admin / mydb / yang12345.
# DOCKER_DATABASE_URL must use host.docker.internal, not 127.0.0.1.
docker compose up -d --build
Invoke-RestMethod http://127.0.0.1:4000/health
```

The API container connects to the existing PostgreSQL container through
`host.docker.internal:5432` and mounts the existing `backend/storage` folder.
This Compose file does not create or replace a PostgreSQL container, so it
does not create a second empty market database and does not delete existing
accounts, decks, versions, or review data.

The container runs `prisma migrate deploy` automatically, retries while the
database is unavailable, and then starts the API. The health endpoint should
return `apiVersion: 0.3.0-phase3`.

If Docker cannot pull `node:22-bookworm-slim`, retry the build after Docker
Desktop's registry connection is restored. A TLS timeout while pulling the
base image is a network/registry issue, not an application or database error.

## Deck package format

Uploads are ZIP files containing at least:

```text
deck.zip
├── manifest.json
├── cards.json
└── assets/
```

Example `manifest.json`:

```json
{
  "format": "knowledge-review-deck",
  "title": "JavaScript Core",
  "description": "Core JavaScript concepts",
  "category": "Programming",
  "version": 1,
  "cardCount": 2
}
```

`cards.json` is an array of cards. Images can be referenced by the card content using relative paths under `assets/`. Each uploaded version is immutable. An update creates a new version and does not overwrite the previous package.

## Initial API

- `POST /api/v1/auth/login` - validate market key and licensed account.
- `GET /api/v1/decks` - list published decks.
- `GET /api/v1/categories` - list administrator-approved market categories.
- `GET /api/v1/decks/:id` - read deck metadata and latest version.
- `GET /api/v1/decks/:id/update` - check the latest published version.
- `GET /api/v1/decks/:id/download` - stream a ZIP package.
- `GET /api/v1/my-decks` - list the authenticated user's uploaded decks.
- `GET /api/v1/decks?page=1&pageSize=20` - paginated published deck search.
- `PATCH /api/v1/me/password` - change the current user's password.
- `POST /api/v1/my-decks` - upload a new deck using multipart fields `metadata` and `package`.
- `POST /api/v1/my-decks/:id/versions` - upload an immutable new version.
- Each version can include `manifest.changelog`; new categories remain pending until administrator approval.
- Uploads validate ZIP paths, entry count, per-entry size and total uncompressed size.
- Login, download and upload routes have in-memory per-process rate limits configured by environment variables.
- Disabled decks cannot receive new versions, and downloads verify that the published package still exists on disk.
- `GET/POST /api/v1/admin/users` - manage licensed users.
- `GET/POST /api/v1/admin/categories` and `PATCH /api/v1/admin/categories/:id/approve|reject` - manage market categories.
- `PATCH /api/v1/admin/decks/:id/category` - adjust a deck category.
- `PATCH /api/v1/admin/users/:id/enable|disable` - enable or disable a user.
- `GET /api/v1/admin/decks` - review uploaded decks and versions.
- `PATCH /api/v1/admin/decks/:id/publish|disable` - moderate a deck.
- `PATCH /api/v1/admin/decks/:id/versions/:version/publish|reject` - review a specific uploaded version.
- `DELETE /api/v1/admin/decks/:id` - permanently delete a disabled deck and its server-side files.
- `GET /api/v1/admin/stats` - read administrator dashboard statistics.
- `GET /api/v1/admin/audit-logs` - query audit logs with filters and pagination.
- `GET /api/v1/admin/storage/health` - check database/package file consistency.
- `POST /api/v1/admin/storage/cleanup` - clean old temporary files; orphan and quarantine deletion require explicit flags.

`GET /health` also returns `apiVersion` and capability flags. The Electron client uses these flags to avoid sending permanent-delete requests to an older backend process. After updating the backend, rebuild it and restart the process that owns port `4000`; otherwise the client will continue to receive the old process's routes and may show `404 Not Found` for audit logs or storage health.

All routes except `/health` and login require `Authorization: Bearer <token>`.
