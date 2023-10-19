import { Hono } from 'hono';

const app = new Hono();

app.post('/', async (c) => {
	const id = crypto.randomUUID();
	// @ts-ignore
	await c.env.R2.put(id, await c.req.blob());
	return new Response('https://r2.seanbehan.ca/' + id + '\n');
});

app.post('/:id', async (c) => {
	// @ts-ignore
	await c.env.R2.put(c.req.param('id'), await c.req.blob());
	return new Response('https://r2.seanbehan.ca/' + c.req.param('id') + '\n');
});

app.get('/list', async (c) => {
	// @ts-ignore
	const list = await c.env.R2.list();
	const files = list.objects.map((obj: { key: string }) => obj.key).join('\n');
	return new Response(files);
});

app.get('/:filename', async (c) => {
	// @ts-ignore
	const file = await c.env.R2.get(c.req.param('filename'));
	return new Response(await file.blob());
});

app.delete('/:filename', async (c) => {
	// @ts-ignore
	await c.env.R2.delete(c.req.param('filename'));
	return new Response('deleted\n');
});

app.get('/text/:filename', async (c) => {
	// @ts-ignore
	const file = await c.env.R2.get(c.req.param('filename'));
	return new Response(await file.text());
});

const index_page = `=== Sean's Pastebin ===

upload files:
curl --data-binary @- https://p.seanbehan.ca < file.txt
curl --data-binary @- https://p.seanbehan.ca/vanity < file.txt

access files:
https://r2.seanbehan.ca/34646744-9362-4c9c-9e39-969c2c14461f
https://p.seanbehan.ca/text/34646744-9362-4c9c-9e39-969c2c14461f

list files:
https://p.seanbehan.ca/list

delete files:
curl -X DELETE https://p.seanbehan.ca/34646744-9362-4c9c-9e39-969c2c14461f
`;

app.get('/', () => new Response(index_page));

export default app;
