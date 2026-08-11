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

## API Endpoints

- `POST /` - Create new paste, returns URL with ID
- `GET /:id` - Retrieve paste by ID  
- `POST /:id` - Update paste content
- `DELETE /:id` - Delete paste
- `GET /list` - List all paste IDs
- `GET /info/:id` - Get metadata about paste
- `GET /:id/highlight` - View with syntax highlighting
- `GET /text/:id` - Get text content