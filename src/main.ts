import { createApp } from './app.ts';

process.umask(0o077);
const { app, ctx, bootstrapPassword } = await createApp();
try {
	await app.listen({ host: ctx.config.host, port: ctx.config.port });
	process.stdout.write(`Audiocity is available at ${ctx.config.publicUrl}\n`);
	if (bootstrapPassword) {
		process.stdout.write(`First-run administrator: ${ctx.config.adminEmail}\nGenerated password (shown only once): ${bootstrapPassword}\nSave this password before rotating container logs.\n`);
	}
} catch (error) {
	app.log.error(error); await app.close(); process.exitCode = 1;
}
let closing = false;
const close = () => {
	if (closing) return;
	closing = true;
	void app.close().catch((error: unknown) => { app.log.error(error); process.exitCode = 1; });
};
process.once('SIGTERM', close);
process.once('SIGINT', close);
