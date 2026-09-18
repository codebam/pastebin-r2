import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { prettyJSON } from 'hono/pretty-json';
// @ts-expect-error inline import
import index_html from 'inline:./index.html';
// @ts-expect-error inline import
import highlight_html from 'inline:./highlight.html';
// @ts-expect-error inline import
import crypto_bundle from 'inline:./crypto.bundle.js';

type Bindings = { R2: R2Bucket };
const app = new Hono<{ Bindings: Bindings }>();

const ENC_ALG = 'chacha20poly1305';
const ENC_VERSION = '1';

// Pastes expire. R2 has no per-object TTL we can set from a Worker, so the
// expiry time is stamped into the object's custom metadata at write time,
// enforced lazily on read, and swept by the scheduled handler below.
const MAX_EXPIRY_MS = 48 * 60 * 60 * 1000; // hard ceiling, also the default
const MIN_EXPIRY_MS = 60 * 1000;
const EXPIRY_MS = MAX_EXPIRY_MS;

// Lifetime requested by the client, via `?ttl=` (or `?expires=`) or the
// X-Expires-In header. Accepts plain seconds or a duration suffix (s/m/h/d);
// anything unparseable falls back to the default, and every value is clamped
// to at most 48 hours.
function requestedTtl(c: { req: { query: (n: string) => string | undefined; header: (n: string) => string | undefined } }): number {
	const raw = (c.req.query('ttl') || c.req.query('expires') || c.req.header('x-expires-in') || '').trim();
	const match = raw.toLowerCase().match(/^(\d+(?:\.\d+)?)(s|m|h|d)?$/);
	if (!match) return MAX_EXPIRY_MS;
	const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] || 's'] as number;
	const ms = Number(match[1]) * unit;
	if (!Number.isFinite(ms) || ms <= 0) return MAX_EXPIRY_MS;
	return Math.min(Math.max(ms, MIN_EXPIRY_MS), MAX_EXPIRY_MS);
}

// Metadata to attach when writing a paste. Pass an existing expiry to preserve
// it (e.g. when moving a paste) instead of restarting the clock.
function expiryMetadata(expiresAt: number = Date.now() + EXPIRY_MS, extra: Record<string, string> = {}): R2PutOptions {
	return { customMetadata: { expires: String(expiresAt), ...extra } };
}

// Encryption is chosen and performed client-side; the worker only records the
// marker so viewers and the raw endpoint know the bytes are a ciphertext.
function encryptionMetadata(encrypted: boolean): Record<string, string> {
	return encrypted ? { enc: ENC_ALG, encv: ENC_VERSION } : {};
}

// `?enc=1` (or `enc=true` / `enc=chacha20poly1305`) marks a create/update as
// encrypted. `?enc=0` explicitly clears the marker on update.
function explicitEncryption(c: {
	req: { query: (n: string) => string | undefined; header: (n: string) => string | undefined };
}): boolean | null {
	const raw = (c.req.query('enc') || c.req.header('x-encrypted') || '').trim().toLowerCase();
	if (raw === '1' || raw === 'true' || raw === ENC_ALG) return true;
	if (raw === '0' || raw === 'false' || raw === 'none') return false;
	return null;
}

// Expiry of a stored object. Objects written before expiry existed have no
// `expires` metadata, so fall back to their upload time plus the same window.
function expiryOf(obj: R2Object): number {
	const stamped = Number(obj.customMetadata?.expires);
	return Number.isFinite(stamped) && stamped > 0 ? stamped : obj.uploaded.getTime() + EXPIRY_MS;
}

// The installed workers-types predates `include`, but the runtime honours it —
// without it, list() omits custom metadata and every object looks legacy.
const LIST_WITH_METADATA = { include: ['customMetadata'] } as unknown as R2ListOptions;

function isExpired(obj: R2Object): boolean {
	return expiryOf(obj) <= Date.now();
}

// Fetch a paste, treating an expired one as absent and deleting it on the way
// out so the bucket does not accumulate dead objects between sweeps.
async function getLive(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
	const file = await bucket.get(key);
	if (!file) return null;
	if (isExpired(file)) {
		await bucket.delete(key);
		return null;
	}
	return file;
}

app.use('*', cors());
app.use('/info/*', prettyJSON());

// Build the correct origin for the paste URL. Cloudflare Workers populate the
// host and x-forwarded-proto headers with what the client actually requested,
// so this returns the right domain AND scheme no matter which hostname hits the
// worker (p.seanbehan.ca, paste.codebam.ca, localhost, etc.).
function getBaseUrl(c: { req: { url: string; header: (n: string) => string | undefined } }): string {
	const proto = c.req.header('x-forwarded-proto') || new URL(c.req.url).protocol.replace(':', '');
	const host = c.req.header('host') || new URL(c.req.url).host;
	return `${proto}://${host}`;
}

function htmlPage(html: string): Response {
	return new Response(html, {
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'referrer-policy': 'no-referrer',
			'x-content-type-options': 'nosniff',
		},
	});
}

// Same-origin ChaCha20-Poly1305 client. The create page uses it to encrypt,
// the viewer uses it to decrypt. Never load crypto from a third-party CDN.
app.get(
	'/crypto.js',
	() =>
		new Response(crypto_bundle, {
			headers: {
				'content-type': 'text/javascript; charset=utf-8',
				'cache-control': 'no-store',
			},
		}),
);

// Viewer for pastes. For encrypted pastes the key is read from `#k=...` in the
// URL fragment, which browsers never send to the server.
app.get('/view/:id', async (c) => {
	const file = await getLive(c.env.R2, c.req.param('id'));
	if (!file) return new Response('file not found', { status: 404 });
	return htmlPage(highlight_html);
});

// Route to move a paste from one ID to another
app.post('/:id/:new_id', async (c) => {
	try {
		const id = c.req.param('id');
		const new_id = c.req.param('new_id');
		const file = await getLive(c.env.R2, id);
		if (file) {
			// Keep the original expiry and every custom metadata field (notably
			// the encryption marker) so a move does not lose them.
			await c.env.R2.put(new_id, await file.blob(), {
				customMetadata: { ...(file.customMetadata || {}), expires: String(expiryOf(file)) },
			});
			await c.env.R2.delete(id);
		}
		return c.text('moved\n');
	} catch (error) {
		return c.text(`Error: ${error}\n`, 500);
	}
});

// Route to create a new paste
app.post('/', async (c) => {
	try {
		const encrypted = explicitEncryption(c) === true;
		const id = crypto.randomUUID().slice(0, 5);
		await c.env.R2.put(id, await c.req.blob(), expiryMetadata(Date.now() + requestedTtl(c), encryptionMetadata(encrypted)));

		return c.text(getBaseUrl(c) + (encrypted ? '/view/' : '/') + id + '\n');
	} catch (error) {
		return c.text(`Error: ${error}\n`, 500);
	}
});

// Route to get information about a paste. R2Object exposes its fields via
// getters, so it does not survive JSON.stringify — pick them out explicitly.
app.get('/info/:id', async (c) => {
	try {
		const file = await c.env.R2.head(c.req.param('id'));
		if (!file || isExpired(file)) {
			return c.json({ error: 'not found' }, 404);
		}
		const encrypted = Boolean(file.customMetadata?.enc);
		return c.json({
			key: file.key,
			size: file.size,
			uploaded: file.uploaded,
			expires: new Date(expiryOf(file)),
			etag: file.httpEtag,
			encrypted,
			...(encrypted
				? {
						algorithm: file.customMetadata?.enc || ENC_ALG,
						formatVersion: Number(file.customMetadata?.encv) || Number(ENC_VERSION),
					}
				: {}),
		});
	} catch (error) {
		return c.text(`Error: ${error}\n`, 500);
	}
});

// Route to update a paste
app.post('/:id', async (c) => {
	try {
		const id = c.req.param('id');
		// Preserve the existing encryption marker unless the caller picks
		// explicitly with `enc=1` or `enc=0`.
		const existing = await c.env.R2.head(id);
		const encrypted = explicitEncryption(c) ?? Boolean(existing?.customMetadata?.enc);
		await c.env.R2.put(id, await c.req.blob(), expiryMetadata(Date.now() + requestedTtl(c), encryptionMetadata(encrypted)));
		return c.text(getBaseUrl(c) + (encrypted ? '/view/' : '/') + id + '\n');
	} catch (error) {
		return c.text(`Error: ${error}\n`, 500);
	}
});

// Route to list all paste IDs
app.get('/list', async (c) => {
	try {
		const list = await c.env.R2.list(LIST_WITH_METADATA);
		const files = list.objects
			.filter((obj) => !isExpired(obj))
			.map((obj) => obj.key)
			.join('\n');
		return c.text(files);
	} catch (error) {
		return c.text(`Error: ${error}\n`, 500);
	}
});

// Route to retrieve a paste by ID
app.get('/:id', async (c) => {
	try {
		const id = c.req.param('id');
		let name: string, ext: string;
		let file: R2ObjectBody | null;
		if (id.match(/.*\..*/)) {
			[name, ext] = id.split('.');
			file = await getLive(c.env.R2, name);
		} else {
			file = await getLive(c.env.R2, id);
		}
		if (file) {
			const encrypted = Boolean(file.customMetadata?.enc);
			return new Response(await file.blob(), {
				headers: {
					etag: file.httpEtag,
					...(encrypted ? { 'content-type': 'application/octet-stream', 'x-paste-encrypted': '1' } : {}),
				},
			});
		}
		return c.text('file not found');
	} catch (error) {
		return c.text(`Error: ${error}\n`, 500);
	}
});

// Route to delete a paste by ID
app.delete('/:id', async (c: any) => {
	try {
		await c.env.R2.delete(c.req.param('id'));
		return c.text('deleted\n');
	} catch (error) {
		return c.text(`Error: ${error}\n`, 500);
	}
});

// Route to get text content of a paste by ID
app.get('/text/:id', async (c) => {
	try {
		const id = c.req.param('id');
		const file = await getLive(c.env.R2, id);
		if (file) {
			if (file.customMetadata?.enc) {
				// Do not quietly corrupt binary ciphertext with a UTF-8 decode.
				return new Response(await file.arrayBuffer(), {
					headers: {
						etag: file.httpEtag,
						'content-type': 'application/octet-stream',
						'x-paste-encrypted': '1',
					},
				});
			}
			return new Response(await file.text(), { headers: { etag: file.httpEtag } });
		}
		return new Response('file not found');
	} catch (error) {
		return c.text(`Error: ${error}\n`, 500);
	}
});

// Route to get highlighted view of a paste
app.get('/:id/highlight', async (c) => {
	try {
		const file = await getLive(c.env.R2, c.req.param('id'));
		if (file) {
			return htmlPage(highlight_html);
		}
		return new Response('file not found');
	} catch (error) {
		return c.text(`Error: ${error}\n`, 500);
	}
});

// Route for the main page
app.get('/', () => htmlPage(index_html));

// Sweep expired pastes out of the bucket. Reads are already safe without this;
// the cron just keeps storage from growing with pastes nobody fetches again.
async function purgeExpired(bucket: R2Bucket): Promise<number> {
	let cursor: string | undefined;
	let deleted = 0;
	do {
		const list = await bucket.list({ ...LIST_WITH_METADATA, cursor });
		const stale = list.objects.filter(isExpired).map((obj) => obj.key);
		// R2 caps a batch delete at 1000 keys, which is also the list page size.
		if (stale.length) {
			await bucket.delete(stale);
			deleted += stale.length;
		}
		cursor = list.truncated ? list.cursor : undefined;
	} while (cursor);
	return deleted;
}

export default {
	fetch: app.fetch,
	async scheduled(_event: ScheduledController, env: Bindings, _ctx: ExecutionContext) {
		await purgeExpired(env.R2);
	},
};
