# Knowledge Review Deck Market API

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
Copy-Item .env.example .env
# Edit .env before starting the containers.
docker compose up -d --build
docker compose exec api sh -c 'ADMIN_USERNAME=admin ADMIN_PASSWORD=change-this-to-a-long-password node dist/scripts/create-admin.js'
```

The PostgreSQL database and uploaded packages are stored in named Docker volumes. Back up both volumes before server maintenance.

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
- `GET /api/v1/decks/:id` - read deck metadata and latest version.
- `GET /api/v1/decks/:id/download` - stream a ZIP package.
- `GET /api/v1/my-decks` - list the authenticated user's uploaded decks.
- `POST /api/v1/my-decks` - upload a new deck using multipart fields `metadata` and `package`.
- `POST /api/v1/my-decks/:id/versions` - upload an immutable new version.
- `GET/POST /api/v1/admin/users` - manage licensed users.
- `PATCH /api/v1/admin/users/:id/enable|disable` - enable or disable a user.
- `GET /api/v1/admin/decks` - review uploaded decks and versions.
- `PATCH /api/v1/admin/decks/:id/publish|disable` - moderate a deck.

All routes except `/health` and login require `Authorization: Bearer <token>`.
