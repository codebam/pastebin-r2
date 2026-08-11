import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { prettyJSON } from 'hono/pretty-json';
// @ts-expect-error inline import
import index_html from 'inline:./index.html';
// @ts-expect-error inline import
import highlight_html from 'inline:./highlight.html';

type Bindings = { R2: R2Bucket };
const app = new Hono<{ Bindings: Bindings }>();

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
		const file = await c.env.R2.get(c.req.param('id'));
		if (file) {
			await c.env.R2.put(new_id, await file.blob());
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
		await c.env.R2.put(id, await c.req.blob());

		return c.text(getBaseUrl(c) + '/' + id + '\n');
	} catch (error) {
		return c.text(`Error: ${error}\n`, 500);
	}
});

// Route to get information about a paste
app.get('/info/:id', async (c) => {
	try {
		const file = await c.env.R2.get(c.req.param('id'));
		return c.json(file);
	} catch (error) {
		return c.text(`Error: ${error}\n`, 500);
	}
});

// Route to update a paste
app.post('/:id', async (c) => {
	try {
		await c.env.R2.put(c.req.param('id'), await c.req.blob());
		return c.text(getBaseUrl(c) + '/' + c.req.param('id') + '\n');
	} catch (error) {
		return c.text(`Error: ${error}\n`, 500);
	}
});

// Route to list all paste IDs
app.get('/list', async (c) => {
	try {
		const list = await c.env.R2.list();
		const files = list.objects.map((obj: { key: string }) => obj.key).join('\n');
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
			file = await c.env.R2.get(name);
		} else {
			file = await c.env.R2.get(id);
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
		const file = await c.env.R2.get(id);
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
		const file = await c.env.R2.get(c.req.param('id'));
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

export default app;
