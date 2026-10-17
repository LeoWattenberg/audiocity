/** Browser source is served as a separate asset so the console needs no inline scripts. */
export const consoleClient = String.raw`'use strict';
(() => {
	const workspace = document.getElementById('workspace');
	const message = document.getElementById('message');
	const menu = document.getElementById('menu');
	const storageKey = 'audiocity.access-token';
	let user;
	const requestedView = new URLSearchParams(location.search).get('view');
	let pendingView = ['audio', 'projects'].includes(requestedView) ? requestedView : undefined;
	function token() { return sessionStorage.getItem(storageKey); }
	function node(tag, content) {
		const result = document.createElement(tag);
		if (content !== undefined) result.textContent = String(content);
		return result;
	}
	function tell(text, error = false) {
		message.textContent = text;
		message.className = error ? 'error' : '';
		message.hidden = !text;
	}
	function fail(error) { tell(error instanceof Error ? error.message : 'The request failed.', true); }
	function on(target, event, action) {
		target.addEventListener(event, e => {
			if (event === 'submit') e.preventDefault();
			Promise.resolve().then(() => action(e)).catch(fail);
		});
	}
	function begin(title) {
		tell('');
		const heading = node('h1', title);
		heading.id = 'view-title';
		workspace.replaceChildren(heading);
		return workspace;
	}
	function session(value) {
		user = value;
		document.getElementById('session').textContent = value ? 'Signed in as ' + value.name + ' (' + value.email + ')' : 'Not signed in';
		document.querySelectorAll('[data-auth]').forEach(button => { button.hidden = !value; });
		document.getElementById('login-menu').hidden = Boolean(value);
		document.getElementById('admin-menu').hidden = !value || !value.admin;
	}
	function clearSession() { sessionStorage.removeItem(storageKey); session(undefined); }
	async function responseData(response) {
		if (response.status === 204) return undefined;
		const text = await response.text();
		try { return text ? JSON.parse(text) : undefined; }
		catch { throw new Error('The server returned an invalid response.'); }
	}
	async function api(path, method = 'GET', body) {
		const authorization = token();
		const headers = { Accept: 'application/json' };
		if (authorization) headers.Authorization = 'Bearer ' + authorization;
		if (body !== undefined) headers['Content-Type'] = 'application/json';
		const response = await fetch(path, { method, headers, credentials: 'omit', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
		const data = await responseData(response);
		if (!response.ok) {
			if (response.status === 401 && authorization) {
				clearSession(); login();
				throw new Error('Your session expired. Log in to continue.');
			}
			throw new Error(data && typeof data.message === 'string' ? data.message : 'Request failed (' + response.status + ').');
		}
		return data;
	}
	function requireSession() {
		if (!user || !token()) { login(); throw new Error('Log in to continue.'); }
	}
	function field(form, title, type = 'text', value = '') {
		const label = node('label', title);
		const input = node('input'); input.type = type; input.value = value;
		if (type === 'checkbox') label.className = 'check';
		label.append(input); form.append(label);
		return input;
	}
	function select(form, title, values, current) {
		const label = node('label', title); const input = node('select');
		for (const [value, title] of values) { const option = node('option', title); option.value = value; input.append(option); }
		input.value = current; label.append(input); form.append(label); return input;
	}
	function submit(form, title, action) {
		const button = node('button', title); button.type = 'submit'; form.append(button);
		on(form, 'submit', async () => {
			button.disabled = true; tell('');
			try { await action(); } finally { button.disabled = false; }
		});
	}
	function actionMenu(card, actions) {
		const details = node('details'); details.append(node('summary', 'Actions'));
		const nav = node('nav'); nav.setAttribute('aria-label', 'Item actions');
		for (const [title, action] of actions) {
			const button = node('button', title); button.type = 'button';
			on(button, 'click', async () => { details.open = false; await action(); }); nav.append(button);
		}
		details.append(nav); card.append(details);
	}
	function card(title, description) {
		const result = node('article'); result.append(node('h2', title), node('p', description)); workspace.append(result); return result;
	}
	function safeUrl(value) {
		const url = new URL(value, location.href);
		if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The server returned an invalid media URL.');
		return url.href;
	}
	function download(url, name) {
		const link = node('a', 'Download'); link.href = safeUrl(url); link.download = name;
		link.rel = 'noreferrer noopener'; link.target = '_blank'; document.body.append(link); link.click(); link.remove();
	}
	async function transfer(policy, file) {
		try {
			const uploaded = await fetch(safeUrl(policy.url), { method: 'PUT', credentials: 'omit', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
			if (!uploaded.ok) { const data = await responseData(uploaded); throw new Error(data && data.message || 'The file upload failed.'); }
			const completed = await fetch(safeUrl(policy.success), { method: 'POST', credentials: 'omit' });
			if (!completed.ok) throw new Error('The uploaded file could not be confirmed.');
		} catch (error) {
			try { await fetch(safeUrl(policy.fail), { method: 'DELETE', credentials: 'omit' }); } catch { /* Keep the original error. */ }
			throw error;
		}
	}
	function login() {
		begin('Log in');
		workspace.append(node('p', 'Use the administrator account configured on your server, or an account created by its administrator.'));
		const form = node('form');
		const email = field(form, 'Email or username'); email.required = true; email.autocomplete = 'username';
		const password = field(form, 'Password', 'password'); password.required = true; password.autocomplete = 'current-password';
		submit(form, 'Log in', async () => {
			let grant;
			try { grant = await api('/auth/token', 'POST', { grant_type: 'password', username: email.value, password: password.value, scope: 'all' }); }
			finally { password.value = ''; }
			sessionStorage.setItem(storageKey, grant.access_token);
			try { session(await api('/auth/me')); }
			catch (error) { clearSession(); throw error; }
			await openRequestedView();
		});
		workspace.append(form); email.focus();
	}
	function audioUpload() {
		requireSession(); begin('Upload audio');
		workspace.append(node('p', 'Upload an original WAV, MP3, FLAC, WavPack, AIFF, Ogg or M4A file. Playback depends on your browser’s codec support.'));
		const form = node('form'); const file = field(form, 'Recording', 'file');
		file.accept = '.wav,.wave,.mp3,.flac,.wv,.aif,.aiff,.aifc,.ogg,.oga,.m4a,.mp4'; file.required = true;
		const title = field(form, 'Title (optional)'); title.maxLength = 256;
		const visibility = select(form, 'Visibility', [['private','Private'],['unlisted','Unlisted: direct link'],['public','Public: discoverable']], 'private');
		const downloadable = field(form, 'Allow other listeners to download', 'checkbox');
		submit(form, 'Upload audio', async () => {
			const source = file.files[0]; if (!source) throw new Error('Choose an audio file.');
			const extension = source.name.split('.').pop().toLowerCase();
			const mime = { wav:'audio/wav', wave:'audio/wav', mp3:'audio/mpeg', flac:'audio/flac', wv:'audio/x-wavpack', aif:'audio/aiff', aiff:'audio/aiff', aifc:'audio/aiff', ogg:'audio/ogg', oga:'audio/ogg', m4a:'audio/mp4', mp4:'audio/mp4' }[extension];
			if (!mime) throw new Error('Choose a supported audio file extension.');
			tell('Uploading original audio…');
			const policy = await api('/v1/audio/create', 'POST', { name: source.name, mime, size: source.size, category: 'recording', visibility: visibility.value, is_downloadable: downloadable.checked, ...(title.value.trim() ? { title: title.value.trim() } : {}) });
			await transfer(policy, source);
			if (form.isConnected) await audioList();
			tell('Audio uploaded.');
		});
		workspace.append(form);
	}
	async function audioList(page = 1) {
		requireSession(); const items = await api('/v1/audio/list?per-page=20&page=' + page);
		begin('Audio library');
		if (!items.length) workspace.append(node('p', page === 1 ? 'No audio yet. Choose Menu → Upload audio.' : 'No more recordings.'));
		for (const item of items) {
			const article = card(item.title, item.status + ' · ' + item.visibility + ' · ' + item.source.size.toLocaleString() + ' bytes');
			const actions = [['Edit sharing', () => editAudio(item)]];
			if (item.status === 'ready') {
				actions.push(['Preview', async () => {
					const fresh = await api('/v1/audio/view?id=' + encodeURIComponent(item.id));
					article.querySelector('audio')?.remove();
					const audio = node('audio'); audio.controls = true; audio.preload = 'metadata'; audio.src = safeUrl(fresh.play.url);
					on(audio, 'error', () => { tell('This source cannot play in this browser. Download the original into an audio editor.', true); }); article.append(audio);
				}], ['Download original', async () => {
					const result = await api('/download/' + encodeURIComponent(item.id)); download(result.items[0].url, item.name);
				}]);
			}
			actionMenu(article, actions);
		}
		pagination(page, items.length === 20, audioList);
	}
	function pagination(page, hasNext, load) {
		if (page === 1 && !hasNext) return;
		const article = node('article'); article.append(node('p', 'Page ' + page));
		const actions = [];
		if (page > 1) actions.push(['Previous page', () => load(page - 1)]);
		if (hasNext) actions.push(['Next page', () => load(page + 1)]);
		actionMenu(article, actions); workspace.append(article);
	}
	function editAudio(item) {
		requireSession(); begin('Sharing: ' + item.title);
		workspace.append(node('p', 'Unlisted recordings can be heard by anyone with the direct link. Public recordings also appear in discovery. Listening gives access to the source bytes.'));
		const form = node('form');
		const visibility = select(form, 'Visibility', [['private','Private'],['unlisted','Unlisted: direct link'],['public','Public: discoverable']], item.visibility);
		const downloadable = field(form, 'Allow other listeners to download', 'checkbox'); downloadable.checked = item.is_downloadable;
		submit(form, 'Save sharing', async () => {
			const result = await api('/v1/audio/update?id=' + encodeURIComponent(item.id), 'PATCH', { visibility: visibility.value, is_downloadable: downloadable.checked });
			if (form.isConnected) editAudio(result);
			tell('Sharing updated. Previously issued playback URLs expire within an hour.');
		});
		workspace.append(form);
		if (item.visibility !== 'private') {
			const link = node('a', 'Open shared metadata'); link.href = '/public/audio/' + encodeURIComponent(item.id); link.target = '_blank'; link.rel = 'noreferrer noopener'; workspace.append(node('p', 'Share URL:'), link);
		}
	}
	function projectUpload(project) {
		requireSession(); begin(project ? 'New revision: ' + project.name : 'Upload AUP3/AUP4');
		workspace.append(node('p', 'Close the project in Audacity first so all changes are written into the standalone file. Archive revisions preserve the whole file; native block snapshots use a separate transport.'));
		const form = node('form'); const file = field(form, 'Project file', 'file'); file.accept = '.aup3,.aup4'; file.required = true;
		const name = field(form, 'Project name (optional)', 'text', project ? project.name : ''); name.maxLength = 256;
		submit(form, 'Upload project revision', async () => {
			const source = file.files[0]; if (!source) throw new Error('Choose an AUP3 or AUP4 file.');
			const format = source.name.split('.').pop().toLowerCase();
			if (!['aup3', 'aup4'].includes(format)) throw new Error('Choose an AUP3 or AUP4 project file.');
			const body = { format, size: source.size, name: name.value.trim() || source.name.replace(/\.[^.]+$/, ''), blocks: [], ...(project ? { head_snapshot_id: project.head.id } : {}) };
			tell('Uploading project archive…');
			const result = await api(project ? '/project/' + encodeURIComponent(project.id) + '/snapshot' : '/project', 'POST', body);
			await transfer(result.sync.file, source);
			await api('/project/' + encodeURIComponent(result.project.id) + '/snapshot/' + encodeURIComponent(result.snapshot.id) + '/sync', 'POST');
			if (form.isConnected) await projectList();
			tell('Project revision uploaded and synchronized.');
		});
		workspace.append(form);
	}
	async function projectList(page = 1) {
		requireSession(); const result = await api('/project?transport=all&per-page=20&page=' + page);
		begin('Project library');
		if (!result.items.length) workspace.append(node('p', 'No projects on this page. Choose Menu → Upload AUP3/AUP4 to archive a project.'));
		for (const project of result.items) {
			const article = card(project.name, project.format.toUpperCase() + ' · ' + project.transport + ' transport · ' + project.size.toLocaleString() + ' bytes');
			const actions = [['Revisions', () => revisions(project)]];
			if (project.preview) {
				actions.push(['Preview audio', () => projectPreview(article, project)]);
				if (!project.preview.is_current) article.append(node('p', 'The audio preview is from an earlier revision. Use Update Cloud Audio Preview in Audacity to refresh it.'));
			} else if (project.transport === 'blocks') article.append(node('p', 'No audio preview yet. Use Update Cloud Audio Preview in Audacity to create one.'));
			if (project.transport === 'blocks') actions.push(['Update preview in Audacity', () => { location.href = 'audacity://generate-audio?projectId=' + encodeURIComponent(project.id); }]);
			if (project.transport === 'file') actions.push(['Upload revision', () => projectUpload(project)]);
			actionMenu(article, actions);
		}
		pagination(page, page < result.pagination.pages, projectList);
	}
	async function projectPreview(article, project, revision) {
		const path = '/project/' + encodeURIComponent(project.id) + (revision ? '/snapshot/' + encodeURIComponent(revision.id) : '');
		const fresh = await api(path);
		if (!fresh.preview) throw new Error('No audio preview is available. Use Update Cloud Audio Preview in Audacity.');
		let audio = article.querySelector('audio');
		if (!audio) {
			audio = node('audio'); audio.controls = true; audio.preload = 'metadata';
			audio.setAttribute('aria-label', 'Audio preview for ' + project.name);
			on(audio, 'error', () => { tell('This audio preview cannot play in this browser.', true); });
			article.append(audio);
		}
		audio.src = safeUrl(fresh.preview.url); audio.focus();
	}
	async function revisions(project, page = 1) {
		requireSession(); const result = await api('/project/' + encodeURIComponent(project.id) + '/snapshot?per-page=20&page=' + page);
		begin('Revisions: ' + project.name);
		for (const revision of result.items) {
			const date = new Date(revision.date_created * 1000).toLocaleString();
			const article = card(date, revision.format.toUpperCase() + ' · ' + (revision.date_synced ? 'synchronized' : 'incomplete') + ' · ' + revision.file_size.toLocaleString() + ' file bytes');
			article.append(node('p', 'Revision ' + revision.id));
			const actions = [];
			if (revision.preview) actions.push(['Preview audio', () => projectPreview(article, project, revision)]);
			if (revision.transport === 'file' && revision.date_synced && revision.file_url) actions.push(['Download archive', async () => {
				const fresh = await api('/project/' + encodeURIComponent(project.id) + '/snapshot/' + encodeURIComponent(revision.id));
				download(fresh.file_url, project.name.replace(/[\\/]/g, '-') + '.' + fresh.format);
			}]);
			else if (revision.transport === 'blocks') article.append(node('p', 'Open this cloud revision in Audacity to edit it.'));
			if (actions.length) actionMenu(article, actions);
		}
		pagination(page, page < result.pagination.pages, next => revisions(project, next));
	}
	function createAccount() {
		requireSession(); if (!user.admin) throw new Error('Administrator access is required.');
		begin('Create account');
		const form = node('form'); const email = field(form, 'Email', 'email'); email.required = true;
		const name = field(form, 'Display name'); name.maxLength = 100;
		const password = field(form, 'Initial password', 'password'); password.required = true; password.minLength = 12; password.maxLength = 256; password.autocomplete = 'new-password';
		submit(form, 'Create account', async () => {
			const result = await api('/admin/users', 'POST', { email: email.value, name: name.value, password: password.value });
			password.value = ''; form.reset(); tell('Account created for ' + result.email + '. Username: ' + result.username + '.');
		});
		workspace.append(form);
	}
	function changePassword() {
		requireSession(); begin('Change password');
		workspace.append(node('p', 'Changing your password signs out every current session, including this tab.'));
		const form = node('form');
		const current = field(form, 'Current password', 'password'); current.required = true; current.autocomplete = 'current-password';
		const next = field(form, 'New password', 'password'); next.required = true; next.minLength = 12; next.maxLength = 256; next.autocomplete = 'new-password';
		const confirm = field(form, 'Confirm new password', 'password'); confirm.required = true; confirm.autocomplete = 'new-password';
		submit(form, 'Change password', async () => {
			if (next.value !== confirm.value) throw new Error('The new passwords do not match.');
			await api('/auth/password', 'POST', { current_password: current.value, new_password: next.value });
			current.value = ''; next.value = ''; confirm.value = '';
			clearSession(); login(); tell('Password changed. Log in with your new password.');
		});
		workspace.append(form);
	}
	function help() {
		begin('API help');
		workspace.append(node('p', 'Use this server’s origin as the API base URL. Requests use a bearer token obtained from POST /auth/token, or authorization code with PKCE for registered public clients.'));
		const list = node('ul');
		for (const item of ['POST /v1/audio/create → PUT policy.url → POST policy.success', 'GET /v1/audio/list and PATCH /v1/audio/update?id=…', 'POST /project with format, size, name and blocks: [] for a whole-file AUP3/AUP4 archive', 'PUT sync.file.url → POST sync.file.success → POST /project/{id}/snapshot/{sid}/sync', 'GET /project?transport=all includes file archives and native Audacity block snapshots', 'Native Audacity clients exchange a project file plus missing blocks through the same snapshot API.', 'The server preserves originals. It does not transcode media or reconstruct block snapshots in this console.']) list.append(node('li', item));
		workspace.append(list);
		const discovery = node('a', 'Server capabilities and upload limits'); discovery.href = '/.well-known/audiocity'; workspace.append(discovery);
		const source = node('a', 'Download corresponding source (AGPL-3.0)'); source.href = '/source.tar.gz';
		workspace.append(node('p', 'Server source:'), source);
	}
	async function openRequestedView() {
		if (pendingView === 'audio') await audioList();
		else if (pendingView === 'projects') await projectList();
		else { begin('Welcome back'); workspace.append(node('p', 'Choose an action from Menu to open your library or upload a file.')); }
		pendingView = undefined;
	}
	const actions = { login, 'audio-upload': audioUpload, 'audio-list': audioList, 'project-upload': () => projectUpload(), 'project-list': projectList, account: createAccount, password: changePassword, help,
		logout: async () => { await api('/auth/logout', 'POST'); clearSession(); begin('Signed out'); workspace.append(node('p', 'Choose Menu → Log in to return to your library.')); }
	};
	document.querySelectorAll('[data-action]').forEach(button => on(button, 'click', async () => { menu.open = false; await actions[button.dataset.action](); }));
	if (token()) api('/auth/me').then(async value => { session(value); if (pendingView) await openRequestedView(); }).catch(error => { clearSession(); login(); fail(error); });
	else if (pendingView) login();
})();`;
