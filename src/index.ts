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
app.post('/:id/:new_id', async (c) => {
	const id = c.req.param('id');
	const new_id = c.req.param('new_id');
	const file = await c.env.R2.get(c.req.param('id'));
	if (file) {
		await c.env.R2.put(new_id, await file.blob());
		await c.env.R2.delete(id);
	}
	return c.text('moved\n');
});
app.post('/', async (c) => {
	const id = crypto.randomUUID().slice(0, 5);
	await c.env.R2.put(id, await c.req.blob());
	return c.text('https://p.seanbehan.ca/' + id + '\n');
});
app.get('/info/:id', async (c) => {
	const file = await c.env.R2.get(c.req.param('id'));
	return c.json(file);
});
app.post('/:id', async (c) => {
	await c.env.R2.put(c.req.param('id'), await c.req.blob());
	return c.text('https://p.seanbehan.ca/' + c.req.param('id') + '\n');
});
app.get('/list', async (c) => {
	const list = await c.env.R2.list();
	const files = list.objects.map((obj: { key: string }) => obj.key).join('\n');
	return c.text(files);
});
app.get('/:id', async (c) => {
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
});
app.delete('/:id', async (c: any) => {
	await c.env.R2.delete(c.req.param('id'));
	return c.text('deleted\n');
});
app.get('/text/:id', async (c) => {
	const id = c.req.param('id');
	const file = await c.env.R2.get(id);
	if (file) {
		return new Response(await file.text(), { headers: { etag: file.httpEtag } });
	}
	return new Response('file not found');
});
app.get('/:id/highlight', async (c) => {
	const file = await c.env.R2.get(c.req.param('id'));
	if (file) {
		return new Response(highlight_html, { headers: { 'Content-Type': 'text/html' } });
	}
	return new Response('file not found');
});
app.get('/', () => new Response(index_html, { headers: { 'Content-Type': 'text/html' } }));

export default app;
