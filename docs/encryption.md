# Encrypted pastes

Optional, client-side ChaCha20-Poly1305 encryption for pastebin-r2.

## Design

Encryption happens in the browser before upload. The worker stores opaque
bytes and a marker in R2 custom metadata; it has no key and cannot decrypt.

- Cipher: ChaCha20-Poly1305 RFC 8439 (IETF 12-byte nonce, 16-byte tag).
- Key: fresh 32 random bytes per paste, shared as unpadded base64url in the
  URL fragment (`#k=...`). The fragment is never sent in HTTP requests.
- Files: a browser attachment is encrypted as its raw `ArrayBuffer`; the
  original filename is carried separately as `&n=<url-encoded>` in the same
  fragment so the viewer can download under the original name. Filename bytes
  are not stored server-side.
- Container: `PBR2` (4) || version `0x01` (1) || nonce (12) ||
  ciphertext || tag (16).
- AAD: the 5-byte header (magic + version). The nonce is read from the
  container and is cryptographically bound because the Poly1305 tag is
  computed under it, so a changed header, nonce, or ciphertext byte fails
  authentication.
- Metadata: `enc: chacha20poly1305`, `encv: 1`, alongside `expires`.
- No compression in v1. Ciphertext size is plaintext size plus 33 bytes.

The create flow:

```
browser  -> random key + nonce, container = Encrypt(plaintext)
browser  -> POST /?enc=1 (body = container)
worker   -> R2.put(id, container, { expires, enc, encv })
worker   -> 200 https://host/view/<id>
browser  -> final URL = https://host/view/<id>#k=<base64url(key)>[&n=<filename>]
```

The viewer flow:

```
viewer   -> GET /info/<id>      # encrypted: true, no key
viewer   -> GET /<id>           # ciphertext bytes, no key
viewer   -> read #k=... locally
viewer   -> plaintext = Decrypt(container, key)
```

## API

| Request | Behavior |
| --- | --- |
| `POST /?enc=1` | Store body verbatim, set the encryption marker, return `<base>/view/<id>` |
| `POST /:id?enc=1` | Replace content as encrypted |
| `POST /:id` | Preserve the existing marker unless `enc=1` / `enc=0` is given |
| `POST /:id/:new_id` | Preserve all custom metadata; the static AAD means the link still decrypts after a rename |
| `GET /info/:id` | Adds `encrypted`, `algorithm`, `formatVersion` |
| `GET /:id` | Ciphertext bytes; `application/octet-stream` and `x-paste-encrypted: 1` when encrypted |
| `GET /text/:id` | Plaintext for normal pastes; raw ciphertext bytes for encrypted pastes |
| `GET /view/:id` | Viewer page; decrypts locally when `#k=...` is present |
| `GET /:id/highlight` | Same viewer; plaintext highlighting is unchanged |
| `GET /crypto.js` | Same-origin client bundle (no CDN, `Cache-Control: no-store`) |

## Security properties

Protects:

- R2 objects, backups, and Worker/Cloudflare request logs never contain the
  plaintext or the key.
- Modified ciphertext is detected by Poly1305 and rejected.
- A moved paste stays decryptable because the AAD does not include the ID.

Does not protect:

- Anyone with the full link can decrypt the paste (bearer capability).
- A compromised/changed Worker deployment could serve viewer code that
  exfiltrates keys. The served JS is the trust anchor.
- Metadata: ciphertext size, upload time, expiry, and existence are visible.
  Filenames in the fragment are visible to anyone holding the link, but not to
  the server or its logs.
- Key loss: there is no recovery or password mode. No padding, so length is
  approximately revealed.

## CLI and testing

Binary files work through the UI attach button (encryption on) and through any
API client that sends raw bytes. `scripts/paste-crypt.mjs` wraps the same
container format for files:

```bash
KEY=$(node scripts/paste-crypt.mjs keygen)
node scripts/paste-crypt.mjs encrypt file.txt --key "$KEY" > body.bin
URL=$(curl -s --data-binary @body.bin 'https://example.com/?enc=1')
echo "$URL#k=$KEY"

curl -s 'https://example.com/text/Ab3xZ' | node scripts/paste-crypt.mjs decrypt - --key "$KEY"
```

Checks used while building this:

- `node --test` unit tests: round-trips, wrong key, tampering, malformed
  containers, base64url encoding, fragment parsing.
- Local `wrangler dev`: plaintext create/read unchanged; encrypted create
  returns `/view/<id>`; info reports the marker; raw bytes match the uploaded
  container; move preserves the marker; update preserves it; `/crypto.js` is
  served same-origin.
- jsdom load of the built HTML: create-page encryption produces the correct
  `#k=` URL and decryptable container; attached binary files round-trip through
  the exact raw bytes and get an `&n=...` fragment name; viewer auto-decrypts
  text, shows binary files with a download name, displays the unlock form when
  the key is missing, and errors without leaking plaintext on a wrong key.
