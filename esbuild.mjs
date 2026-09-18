import * as esbuild from 'esbuild';
import inlineImportPlugin from 'esbuild-plugin-inline-import';

// Browser-side crypto core. The Worker serves this file at /crypto.js and the
// create/view pages load it as a classic script exposing `PasteCrypt`.
await esbuild.build({
	entryPoints: ['src/crypto.client.mjs'],
	format: 'iife',
	globalName: 'PasteCrypt',
	platform: 'browser',
	bundle: true,
	minify: true,
	outfile: 'dist/crypto.bundle.js',
});

await esbuild.build({
	entryPoints: ['dist/index.js'],
	format: 'esm',
	bundle: true,
	minify: true,
	outfile: 'dist/index.mjs',
	plugins: [inlineImportPlugin()],
});
