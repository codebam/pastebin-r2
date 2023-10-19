import { Hono } from 'hono';

const app = new Hono();

app.post('/', async (c) => {
	const id = crypto.randomUUID();
	// @ts-ignore
	await c.env.R2.put(id, await c.req.blob());
	return new Response('https://r2.seanbehan.ca/' + id + '\n');
});

app.get('/list', async (c) => {
	// @ts-ignore
	const list = await c.env.R2.list();
	const files = list.objects.map((obj) => obj.key);
	return new Response(files);
});

app.get('/:filename', async (c) => {
	// @ts-ignore
	const file = await c.env.R2.get(c.req.param('filename'));
	return new Response(await file.blob());
});

app.get('/text/:filename', async (c) => {
	// @ts-ignore
	const file = await c.env.R2.get(c.req.param('filename'));
	return new Response(await file.text());
});

const index_page = `=== Sean's Pastebin ===

paste:
curl --data-binary @- https://p.seanbehan.ca < file.txt

access files:
https://r2.seanbehan.ca/34646744-9362-4c9c-9e39-969c2c14461f
https://p.seanbehan.ca/text/34646744-9362-4c9c-9e39-969c2c14461f

list files:
https://p.seanbehan.ca/list
`;

app.get('/', (c) => new Response(index_page));

export default app;
