import type { FastifyInstance } from 'fastify';
import type { Context } from './core.ts';
import { consoleClient } from './console-client.ts';

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Audiocity</title><link rel="stylesheet" href="/console.css"><script src="/console.js" defer></script></head>
<body><header><div><a class="brand" href="/">Audiocity</a><p>Your audio, on your server.</p></div>
<details id="menu"><summary>Menu</summary><nav aria-label="Actions">
<button type="button" data-action="login" id="login-menu">Log in</button>
<button type="button" data-action="audio-upload" data-auth hidden>Upload audio</button>
<button type="button" data-action="audio-list" data-auth hidden>Audio library</button>
<button type="button" data-action="project-upload" data-auth hidden>Upload AUP3/AUP4</button>
<button type="button" data-action="project-list" data-auth hidden>Project library</button>
<button type="button" data-action="account" id="admin-menu" hidden>Create account</button>
<button type="button" data-action="password" data-auth hidden>Change password</button>
<button type="button" data-action="help">API help</button>
<button type="button" data-action="logout" data-auth hidden>Log out</button>
</nav></details></header>
<main><p id="session">Not signed in</p><p id="message" role="status" aria-live="polite" hidden></p>
<section id="workspace" aria-labelledby="view-title"><h1 id="view-title">Welcome to Audiocity</h1>
<p>Open Menu to sign in, upload recordings or manage project revisions.</p>
<p>Recordings stay private until you choose to share them.</p></section></main>
<footer>Self-hosted audio uploads and Audacity project synchronization.</footer></body></html>`;

const css = `:root{color-scheme:light dark;font:16px/1.55 system-ui,sans-serif;background:#111820;color:#edf2f8}
*{box-sizing:border-box}body{max-width:980px;margin:auto;padding:1.5rem}header{display:flex;justify-content:space-between;gap:1rem;align-items:start;border-bottom:1px solid #3b4958;padding-bottom:1rem}
a{color:#8fcaff}.brand{font-size:1.65rem;font-weight:750;text-decoration:none;color:#edf2f8}header p,footer{color:#aab9c9;margin:.25rem 0}main{min-height:65vh}h1,h2,h3{line-height:1.25}h1,h2{font-size:1.7rem}h3{font-size:1.1rem;margin-top:0}
button,input,select,textarea{font:inherit}button,summary,a.download{border:1px solid #62788f;border-radius:.4rem;background:#203247;color:#f3f7fc;padding:.55rem .85rem;cursor:pointer}button:hover,summary:hover{background:#2c4561}button:disabled{opacity:.55;cursor:wait}button:focus-visible,summary:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible{outline:3px solid #8fcaff;outline-offset:3px}
summary{list-style:none;display:inline-block}summary::-webkit-details-marker{display:none}details>nav{display:grid;gap:.35rem;min-width:190px;background:#182431;border:1px solid #52667b;border-radius:.5rem;padding:.65rem;margin-top:.4rem}header details{position:relative}header nav{position:absolute;right:0;z-index:2}nav button{text-align:left}
[hidden]{display:none!important}#session,small{color:#aab9c9}#message{padding:.75rem 1rem;background:#203a4a;border-left:3px solid #8fcaff;border-radius:.25rem}#message.error{background:#45242b;border-color:#ff9b9b}
section{margin:1.75rem 0}form{max-width:600px;display:grid;gap:1rem}label{display:grid;gap:.3rem}input,select,textarea{width:100%;padding:.55rem;border:1px solid #62788f;border-radius:.35rem;background:#182431;color:#edf2f8}label.check{display:flex;align-items:center;gap:.6rem}input[type=checkbox]{width:auto}textarea{min-height:90px}form>button{justify-self:start}article{padding:1.1rem 0;border-bottom:1px solid #3b4958}article p{margin:.4rem 0}article nav{max-width:260px}audio{display:block;max-width:100%;margin-top:1rem}code{overflow-wrap:anywhere}footer{border-top:1px solid #3b4958;padding-top:1rem;font-size:.85rem}.muted{color:#aab9c9}
@media(max-width:540px){body{padding:1rem}header{gap:.5rem}.brand{font-size:1.4rem}header p{max-width:180px}h1,h2{font-size:1.4rem}}`;

export function registerConsoleRoutes(app: FastifyInstance, ctx: Context): void {
	app.get('/', (_request, reply) => reply
		.header('content-security-policy', `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ${ctx.config.publicUrl}; media-src 'self' ${ctx.config.publicUrl}; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`)
		.type('text/html; charset=utf-8').send(html));
	app.get('/console.js', (_request, reply) => reply.type('text/javascript; charset=utf-8').send(consoleClient));
	app.get('/console.css', (_request, reply) => reply.type('text/css; charset=utf-8').send(css));
	for (const path of ['/:username/projects', '/:username/projects/:id']) {
		app.get(path, (_request, reply) => reply.redirect('/?view=projects'));
	}
	app.get('/:username/audio/:slug/edit', (_request, reply) => reply.redirect('/?view=audio'));
	app.get('/:username', (_request, reply) => reply.redirect('/'));
}
