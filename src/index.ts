import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
	R2: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', cors());

app.post('/', async (c) => {
	const id = crypto.randomUUID();
	await c.env.R2.put(id, await c.req.blob());
	return new Response('https://r2.seanbehan.ca/' + id + '\n');
});

app.post('/:id', async (c) => {
	await c.env.R2.put(c.req.param('id'), await c.req.blob());
	return new Response('https://r2.seanbehan.ca/' + c.req.param('id') + '\n');
});

app.get('/list', async (c) => {
	const list = await c.env.R2.list();
	const files = list.objects.map((obj: { key: string }) => obj.key).join('\n');
	return new Response(files);
});

app.get('/:filename', async (c) => {
	const file = (await c.env.R2.get(c.req.param('filename'))) ?? new Response('file not found');
	return new Response(await file.blob());
});

app.delete('/:filename', async (c: any) => {
	await c.env.R2.delete(c.req.param('filename'));
	return new Response('deleted\n');
});

app.get('/text/:filename', async (c) => {
	const file = (await c.env.R2.get(c.req.param('filename'))) ?? new Response('file not found');
	return new Response(await file.text());
});

const index_page = `
<!DOCTYPE html>
<html lang="en">
	<head>
		<title>Sean's Pastebin</title>
    <meta name="viewport" content="width=device-width">
	</head>
<style>
	@media (prefers-color-scheme: dark) {
		body {
			background-color: black;
			color: white;
		}
	}
	body {
		font-family: sans-serif;
	}
	textarea {
		width: 100%;
	}
</style>
<body>
	<div id="container">
		<h1>=== Sean's Pastebin ===</h1>
		<textarea id="paste" rows="20"></textarea>
		<input type="file" name="file" id="file"/>
		<button id="submit">submit</button>
	</div>
</body>
<footer>
	<a href="https://github.com/codebam/pastebin-r2">source code</a>
</footer>
<script>
	const pastebin = async (container, data) => {
		const response = await fetch('https://p.seanbehan.ca', {method: 'POST', body: data})
		const url = await response.text();
		const url_element = document.createElement('p');
		url_element.innerHTML = url;
		container.appendChild(url_element);
	}
	window.onload = async (event) => {
		container = document.getElementById('container');
		paste = document.getElementById('paste').value;
		submit = document.getElementById('submit');
		file = await new Response(document.getElementById('file').files[0]).blob();
		submit.addEventListener('click', async (event) => {
			if (paste !== "") {
				pastebin(container, paste);
			} else if (file !== "") {
				pastebin(container, file);
			}
		});
	};
</script>
</html>
`;

app.get('/', () => new Response(index_page, { headers: { 'Content-Type': 'text/html' } }));

export default app;
