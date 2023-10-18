import { Hono } from 'hono';

const app = new Hono();

app.post('/upload', async (c) => {
	const id = crypto.randomUUID();
	// @ts-ignore
	await c.env.R2.put(id, await c.req.blob());
	return new Response(id);
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

app.get('/', (c) => new Response("Sean's Pastebin"));

export default app;
