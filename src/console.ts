import type { FastifyInstance } from 'fastify';
import type { Context } from './core.ts';
import { consoleClient } from './console-client.ts';

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Audiocity</title><link rel="stylesheet" href="/console.css"><script src="/console.js" defer></script></head>
<body><header><div><a class="brand" href="/">Audiocity</a><p>Your audio, on your server.</p></div>
<div class="header-actions"><button type="button" data-action="upload" data-auth hidden>+ Upload</button>
<details id="menu"><summary>Menu</summary><nav aria-label="Actions">
<button type="button" data-action="login" id="login-menu">Log in</button>
<button type="button" data-action="library" data-auth hidden>Library</button>
<button type="button" data-action="manage" data-auth hidden>Manage files</button>
<button type="button" data-action="categories" data-admin hidden>Categories</button>
<button type="button" data-action="account" id="admin-menu" hidden>Create account</button>
<button type="button" data-action="password" data-auth hidden>Change password</button>
<button type="button" data-action="help">API help</button>
<button type="button" data-action="logout" data-auth hidden>Log out</button>
</nav></details></div></header>
<main><p id="session">Not signed in</p><p id="message" role="status" aria-live="polite" hidden></p>
<section id="workspace" aria-labelledby="view-title"><h1 id="view-title">Welcome to Audiocity</h1>
<p>Keep your recordings and Audacity projects together. Open Menu to sign in.</p>
<p>Recordings stay private until you choose to share them.</p></section></main>
<footer>Self-hosted audio uploads and Audacity project synchronization.</footer></body></html>`;

const css = `:root{color-scheme:dark;font:16px/1.55 system-ui,sans-serif;background:#111820;color:#edf2f8}
*{box-sizing:border-box}body{max-width:1180px;margin:auto;padding:1.5rem}header{display:flex;justify-content:space-between;gap:1rem;align-items:start;border-bottom:1px solid #3b4958;padding-bottom:1rem}.header-actions,.toolbar,.form-actions{display:flex;gap:.65rem;align-items:center;flex-wrap:wrap}
a{color:#8fcaff}.brand{font-size:1.65rem;font-weight:750;text-decoration:none;color:#edf2f8}header p,footer{color:#aab9c9;margin:.25rem 0}main{min-height:65vh}h1,h2,h3{line-height:1.25}h1,h2{font-size:1.7rem}h3{font-size:1.1rem;margin-top:0}
button,input,select,textarea{font:inherit}button,summary,a.download{border:1px solid #62788f;border-radius:.4rem;background:#203247;color:#f3f7fc;padding:.55rem .85rem;cursor:pointer}button:hover,summary:hover{background:#2c4561}button:disabled{opacity:.55;cursor:default}button:focus-visible,summary:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,a:focus-visible,[tabindex]:focus-visible{outline:3px solid #8fcaff;outline-offset:3px}
summary{list-style:none;display:inline-block}summary::-webkit-details-marker{display:none}details>nav{display:grid;gap:.35rem;min-width:190px;background:#182431;border:1px solid #52667b;border-radius:.5rem;padding:.65rem;margin-top:.4rem}header details{position:relative}header nav{position:absolute;right:0;z-index:5}nav button{text-align:left}
[hidden]{display:none!important}#session,small{color:#aab9c9}#message{padding:.75rem 1rem;background:#203a4a;border-left:3px solid #8fcaff;border-radius:.25rem}#message.error{background:#45242b;border-color:#ff9b9b}
section{margin:1.75rem 0}form{max-width:680px;display:grid;gap:1rem}label{display:grid;gap:.3rem}input,select,textarea{width:100%;padding:.55rem;border:1px solid #62788f;border-radius:.35rem;background:#182431;color:#edf2f8}label.check{display:flex;align-items:center;gap:.6rem}input[type=checkbox]{width:auto}textarea{min-height:120px;resize:vertical}form>button{justify-self:start}article{padding:1.1rem 0;border-bottom:1px solid #3b4958}article h2{font-size:1.2rem;margin:.25rem 0}article p{margin:.4rem 0}article nav{max-width:290px}audio{display:block;width:100%;max-width:680px;margin-top:1rem}code{overflow-wrap:anywhere}footer{border-top:1px solid #3b4958;padding-top:1rem;font-size:.85rem}.muted,.hint{color:#aab9c9}.hint{font-size:.9rem}.description{white-space:pre-wrap;overflow-wrap:anywhere}.tags{display:flex;gap:.4rem;flex-wrap:wrap}.tag{padding:.1rem .55rem;border:1px solid #52667b;border-radius:1rem;font-size:.85rem}.tabs{display:flex;gap:.4rem;border-bottom:1px solid #52667b;margin:1rem 0;padding-bottom:.5rem}.tabs button[aria-selected=true]{background:#87c8ff;color:#111820;border-color:#87c8ff}.library-panel{margin:0}.toolbar{margin:1rem 0}.toolbar label{min-width:160px}.toolbar form{display:flex;align-items:end;gap:.5rem;max-width:none}.toolbar form label{min-width:200px}.toolbar .check{min-width:auto}.breadcrumbs{margin:.75rem 0}.metadata{display:grid;grid-template-columns:max-content 1fr;gap:.4rem 1rem}.metadata dt{color:#aab9c9}.metadata dd{margin:0;overflow-wrap:anywhere}.upload-queue{padding-left:1.3rem}.upload-queue li{padding:.4rem 0}.upload-queue [data-status=failed]{color:#ffabab}.upload-queue [data-status=done]{color:#9bdeb1}
.table-wrap{max-width:100%;overflow:auto;border:1px solid #52667b;border-radius:.4rem;max-height:65vh;margin:1rem 0;overscroll-behavior:contain}table{border-collapse:separate;border-spacing:0;width:100%;font-size:.9rem}th,td{padding:.55rem .65rem;text-align:left;vertical-align:top;border-right:1px solid #3b4958;border-bottom:1px solid #3b4958}th{background:#203247;position:sticky;top:0;z-index:2}td{background:#182431}table[role=grid] td{min-width:140px;max-width:300px;white-space:pre-wrap;overflow-wrap:anywhere;cursor:cell}table[role=grid] td[data-key=description]{min-width:240px}table[role=grid] td[aria-selected=true]{background:#25445f;box-shadow:inset 0 0 0 1px #6cb2e9}table[role=grid] td:focus{outline:2px solid #b3dcff;outline-offset:-2px}table[role=grid] td input,table[role=grid] td textarea{padding:.1rem;width:100%;min-width:125px;border-radius:0}table[role=grid] tr.readonly td{color:#aab9c9;background:#171e27}table[role=grid] tr.readonly td[aria-selected=true]{background:#283541}table[role=grid] td[aria-readonly=true]{color:#aab9c9}table[role=grid] td.dirty::after{content:' •';color:#ffd596}.row-heading{min-width:150px;max-width:220px;position:sticky;left:0;z-index:1;background:#203247}.row-heading small{display:block;font-weight:400}.category-table input{min-width:150px}.category-table td:last-child{white-space:nowrap}.category-table button{margin-right:.4rem}.file-summary{font-size:.9rem;color:#aab9c9}
@media(max-width:650px){body{padding:1rem}header{gap:.5rem}.brand{font-size:1.4rem}header p{max-width:150px;font-size:.85rem}.header-actions{gap:.4rem}h1,h2{font-size:1.4rem}.toolbar{align-items:stretch}.toolbar form{flex-wrap:wrap}.metadata{grid-template-columns:1fr;gap:.1rem}.metadata dd{margin-bottom:.7rem}button,summary{padding:.5rem .65rem}}`;

export function registerConsoleRoutes(app: FastifyInstance, ctx: Context): void {
	const shell = (_request: unknown, reply: import('fastify').FastifyReply) => reply
		.header('content-security-policy', `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; connect-src 'self' ${ctx.config.publicUrl}; media-src 'self' blob: ${ctx.config.publicUrl}; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`)
		.type('text/html; charset=utf-8').send(html);
	for (const path of ['/', '/library', '/upload', '/manage', '/help', '/account/new', '/account/password', '/admin/categories/manage', '/audio/:id/play', '/audio/:id/edit', '/:username/audio/:slug', '/:username/audio/:slug/edit']) app.get(path, shell);
	app.get('/console.js', (_request, reply) => reply.type('text/javascript; charset=utf-8').send(consoleClient));
	app.get('/console.css', (_request, reply) => reply.type('text/css; charset=utf-8').send(css));
	for (const path of ['/:username/projects', '/:username/projects/:id']) {
		app.get(path, (_request, reply) => reply.redirect('/?view=projects'));
	}
	app.get('/:username', (_request, reply) => reply.redirect('/'));
}
