import * as esbuild from 'esbuild';
import inlineImportPlugin from 'esbuild-plugin-inline-import';

await esbuild.build({
	entryPoints: ['dist/index.js'],
	format: 'esm',
	bundle: true,
	minify: true,
	outfile: 'dist/index.mjs',
	plugins: [inlineImportPlugin()],
});
