import { Hono } from 'hono';
import { poweredBy } from 'hono/powered-by';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { jwt } from 'hono/jwt';
import jwt_ from '@tsndr/cloudflare-worker-jwt';

const app = new Hono();

app.use('*', poweredBy());
app.use('*', logger());
app.use('*', cors());
app.use('/auth/*', jwt({ secret: 'secret_string', cookie: 'jwt' }));

const hash = async (str: string) => {
	const password = new TextEncoder().encode(str);
	const digest = await crypto.subtle.digest({ name: 'SHA-256' }, password);
	return new Uint8Array(digest).join('');
};

app.get('/register', async (c) => {
	const email = c.req.query('email');
	const password = c.req.query('password');
	const token = await jwt_.sign({ email }, 'secret_string');
	const password_hash = await hash(password ?? '');
	// @ts-ignore
	await c.env.DB.prepare('INSERT INTO Users (username, password) VALUES (?, ?)').bind(email, password_hash).run();
	return new Response('ok', { headers: { 'Set-Cookie': `jwt=${token}` } });
});

function getCookie(cookieString, key) {
	if (cookieString) {
		const allCookies = cookieString.split('; ');
		const targetCookie = allCookies.find((cookie) => cookie.includes(key));
		if (targetCookie) {
			const [_, value] = targetCookie.split('=');
			return value;
		}
	}
	return null;
}

app.get('/login', async (c) => {
	const email = c.req.query('email');
	const password = c.req.query('password');
	// @ts-ignore
	const { results } = await c.env.DB.prepare('SELECT * FROM Users WHERE username=?').bind(email).all();
	const db_password_hash = results[0].password;
	const password_hash = await hash(password ?? '');
	if (db_password_hash === password_hash) {
		const token = await jwt_.sign({ email }, 'secret_string');
		return new Response('ok', { headers: { 'Set-Cookie': `jwt=${token}` } });
	}
	return new Response('login failed');
});

app.get('/auth/page', (c) => {
	const payload = c.get('jwtPayload');
	return c.json(payload);
});

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
