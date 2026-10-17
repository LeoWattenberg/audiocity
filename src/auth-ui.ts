export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
}

export function authorizationHtml(flow: string, clientName: string, scope: string, error = ''): string {
	const access = scope.split(' ').includes('all') ? 'audio uploads, cloud projects, and any administration permitted to your account' : scope.split(' ').map(item => item === 'projects' ? 'cloud projects' : 'audio uploads').join(' and ');
	return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Link your Audiocity account</title><style>
body{font:16px/1.5 system-ui,sans-serif;background:#f3f5f8;color:#172536;margin:0;padding:2rem}
main{max-width:29rem;margin:5vh auto;padding:2rem;background:white;border-radius:1rem;box-shadow:0 12px 40px #17253612}
h1{font-size:1.6rem}label,input{display:block}input{box-sizing:border-box;width:100%;padding:.8rem;margin:.3rem 0 1rem;border:1px solid #9ca9b8;border-radius:.4rem}
button{padding:.8rem 1.2rem;border:0;border-radius:.4rem;font:inherit;background:#1855b3;color:white;cursor:pointer}button[value=deny]{background:#e6ebf2;color:#172536}.error{color:#a22025}
</style><main><h1>Link your Audiocity account</h1>
<p><strong>${escapeHtml(clientName)}</strong> requests access to your ${escapeHtml(access)} on this server.</p>
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
<form action="/auth/authorize" method="post"><input type="hidden" name="flow" value="${escapeHtml(flow)}">
<label>Email<input type="email" name="username" autocomplete="username" required maxlength="254"></label>
<label>Password<input type="password" name="password" autocomplete="current-password" required maxlength="256"></label>
<button type="submit" name="consent" value="allow">Allow access</button> <button type="submit" name="consent" value="deny" formnovalidate>Cancel</button>
</form><p>Only enter credentials for this Audiocity server.</p></main></html>`;
}

export function audacityLinkHtml(code: string): string {
	const token = `audacity://link?${new URLSearchParams({ authorization_code: code })}`;
	return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your Audacity linking token</title><style>
body{font:16px/1.5 system-ui,sans-serif;background:#f3f5f8;color:#172536;margin:0;padding:2rem}
main{max-width:36rem;margin:5vh auto;padding:2rem;background:white;border-radius:1rem}
textarea{box-sizing:border-box;width:100%;padding:1rem;font:inherit;overflow-wrap:anywhere}
</style><main><h1>Your Audacity linking token</h1>
<p>Copy the entire link below, paste it into Audacity's Token field, then choose Continue.</p>
<label for="audacity-token">Token</label><textarea id="audacity-token" rows="4" readonly spellcheck="false">${escapeHtml(token)}</textarea>
<p>This token can be used once and expires two minutes after sign-in. If it expires, use Sign-in and get the token again.</p>
</main></html>`;
}

export function browserHandoffHtml(token: string, target: string, nonce: string, email: string): string {
	const scriptValue = (value: string) => JSON.stringify(value).replace(/</g, '\\u003c');
	return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Opening Audiocity</title>
<h1>Open your Audiocity account</h1><button id="open-console">Continue as ${escapeHtml(email)}</button><script nonce="${escapeHtml(nonce)}">
history.replaceState(null,"","/auth/callback");
document.getElementById("open-console").addEventListener("click",()=>{
sessionStorage.setItem("audiocity.access-token",${scriptValue(token)});
location.replace(${scriptValue(target)});
});
</script><noscript><p>JavaScript is required to link the browser console. <a href="${escapeHtml(target)}">Continue to Audiocity</a> and sign in.</p></noscript></html>`;
}
