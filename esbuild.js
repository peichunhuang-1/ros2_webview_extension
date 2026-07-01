const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	const commonOptions = {
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		external: ['rclnodejs'],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	};

	const extensionCtx = await esbuild.context({
		...commonOptions,
		entryPoints: ['src/extension.ts'],
		outfile: 'dist/extension.js',
		external: ['vscode', 'rclnodejs'],
	});

	const mcpServerCtx = await esbuild.context({
		...commonOptions,
		entryPoints: ['src/mcpServer.ts'],
		outfile: 'dist/mcpServer.js',
	});

	if (watch) {
		await Promise.all([extensionCtx.watch(), mcpServerCtx.watch()]);
	} else {
		await Promise.all([extensionCtx.rebuild(), mcpServerCtx.rebuild()]);
		await Promise.all([extensionCtx.dispose(), mcpServerCtx.dispose()]);
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});