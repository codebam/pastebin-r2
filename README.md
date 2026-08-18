# pastebin-r2 - Cloudflare Worker Pastebin Service

This is a simple pastebin service implemented as a Cloudflare Worker using Hono framework.
It supports storing text content in R2 bucket storage with API endpoints for creating, retrieving and managing pastes.

## Features

- Upload paste snippets (text files)
- Retrieve paste by ID
- View paste with syntax highlighting
- Delete paste functionality
- List all pastes
- Paste information endpoint
- Automatic expiry (48 hours by default, configurable per paste)
- Web UI for easy access

## Building & Running

### Using Nix (recommended for NixOS)

This project works as a Nix package:

1. Enter development shell:
```bash
cd ~/Documents/git/pastebin-r2
nix develop
```

2. Build the project:
```bash
yarn build
```

3. Run in development mode:
```bash
yarn dev
```

4. Deploy to Cloudflare Workers:
```bash
yarn deploy
```

### Direct Nix Builds

Build using Nix directly without entering shell:

```bash
nix build .#packages.default
```

## Project Structure

- `src/index.ts` - Main application code with API routes
- `dist/` - Build outputs including bundled JavaScript and HTML files
- `wrangler.toml` - Cloudflare Workers configuration
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration

## Expiry

Pastes expire automatically. The lifetime is stamped into the object's custom
metadata when it is written, enforced on every read, and an hourly cron trigger
(`[triggers]` in `wrangler.toml`) sweeps expired objects out of the bucket.

The default and the maximum are both **48 hours**. A shorter lifetime can be
requested with the `ttl` query parameter (or the `X-Expires-In` header) on
create/update, as plain seconds or with an `s`/`m`/`h`/`d` suffix. Values above
48 hours are clamped down, and the minimum is 60 seconds.

```bash
curl --data-binary @- 'https://example.com/?ttl=2h' < file.txt
curl -H 'X-Expires-In: 900' --data-binary @- https://example.com < file.txt
```

## API Endpoints

- `POST /` - Create new paste, returns URL with ID (`?ttl=` sets lifetime)
- `GET /:id` - Retrieve paste by ID  
- `POST /:id` - Update paste content (`?ttl=` sets lifetime)
- `DELETE /:id` - Delete paste
- `GET /list` - List all paste IDs
- `GET /info/:id` - Get metadata about paste, including its `expires` time
- `GET /:id/highlight` - View with syntax highlighting
- `GET /text/:id` - Get text content