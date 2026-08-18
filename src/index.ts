import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { prettyJSON } from 'hono/pretty-json';
// @ts-expect-error inline import
import index_html from 'inline:./index.html';
// @ts-expect-error inline import
import highlight_html from 'inline:./highlight.html';

type Bindings = { R2: R2Bucket };
const app = new Hono<{ Bindings: Bindings }>();

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
function requestedTtl(c: {
	req: { query: (n: string) => string | undefined; header: (n: string) => string | undefined };
}): number {
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
function expiryMetadata(expiresAt: number = Date.now() + EXPIRY_MS): R2PutOptions {
	return { customMetadata: { expires: String(expiresAt) } };
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

// Route to move a paste from one ID to another
app.post('/:id/:new_id', async (c) => {
	try {
		const id = c.req.param('id');
		const new_id = c.req.param('new_id');
		const file = await getLive(c.env.R2, id);
		if (file) {
			// Keep the original expiry so moving does not extend a paste's life.
			await c.env.R2.put(new_id, await file.blob(), expiryMetadata(expiryOf(file)));
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
		const id = crypto.randomUUID().slice(0, 5);
		await c.env.R2.put(id, await c.req.blob(), expiryMetadata(Date.now() + requestedTtl(c)));

		return c.text(getBaseUrl(c) + '/' + id + '\n');
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
		return c.json({
			key: file.key,
			size: file.size,
			uploaded: file.uploaded,
			expires: new Date(expiryOf(file)),
			etag: file.httpEtag,
		});
	} catch (error) {
		return c.text(`Error: ${error}\n`, 500);
	}
});

// Route to update a paste
app.post('/:id', async (c) => {
	try {
		await c.env.R2.put(c.req.param('id'), await c.req.blob(), expiryMetadata(Date.now() + requestedTtl(c)));
		return c.text(getBaseUrl(c) + '/' + c.req.param('id') + '\n');
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
			return new Response(await file.blob(), { headers: { etag: file.httpEtag } });
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
			return new Response(highlight_html, { headers: { 'Content-Type': 'text/html' } });
		}
		return new Response('file not found');
	} catch (error) {
		return c.text(`Error: ${error}\n`, 500);
	}
});

// Route for the main page
app.get('/', () => new Response(index_html, { headers: { 'Content-Type': 'text/html' } }));

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
