const get = id => document.getElementById(id);
let mode = 'login';
let generation = 0;

async function api(path, payload) {
  const options = payload === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
  const response = await fetch(`/api/${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || '服务暂不可用，请稍后重试。'), { status: response.status });
  if (!Object.keys(data).length) throw new Error('服务暂不可用，请稍后重试。');
  return data;
}
function message(id, text = '', error = false) {
  const element = get(id);
  element.textContent = text;
  element.classList.toggle('error', error);
}
function show(user) {
  generation++;
  get('loading').hidden = true;
  get('auth').hidden = Boolean(user);
  get('workspace').hidden = !user;
  get('account').hidden = !user;
  get('username').textContent = user?.name || '';
  get('auth-form').reset();
  get('entry-form').reset();
  get('ask-form').reset();
  get('thread').querySelectorAll('.bubble').forEach(node => node.remove());
  get('welcome').hidden = false;
  message('entry-message');
}
function selectMode(next) {
  mode = next;
  const registering = next === 'register';
  get('login-mode').setAttribute('aria-pressed', !registering);
  get('register-mode').setAttribute('aria-pressed', registering);
  get('auth-title').textContent = registering ? '注册账号' : '登录工作空间';
  get('auth-submit').textContent = registering ? '注册并进入' : '登录';
  get('password').autocomplete = registering ? 'new-password' : 'current-password';
  get('confirm-field').hidden = !registering;
  get('confirm-password').required = registering;
  message('auth-message');
}
function failed(error, target) {
  if (error.status === 401) { show(null); message('auth-message', '登录已过期，请重新登录。', true); }
  else message(target, error.message, true);
}
function bubble(text, type = 'answer') {
  const item = document.createElement('div');
  item.className = `bubble ${type}`;
  item.textContent = text;
  get('welcome').hidden = true;
  get('thread').append(item);
  get('thread').scrollTop = get('thread').scrollHeight;
  return item;
}
function source(item, parent) {
  const card = document.createElement('div');
  card.className = 'source';
  const title = document.createElement('strong');
  title.textContent = `【${item.type}】${item.title}`;
  const detail = document.createElement('p');
  detail.textContent = item.detail;
  const visibility = document.createElement('small');
  visibility.textContent = item.own ? (item.shared ? '我的资料 · 已共享' : '我的资料 · 仅自己可见') : '成员共享资料';
  card.append(title, detail, visibility);
  if (item.own && item.shared) {
    const button = document.createElement('button');
    button.textContent = '取消共享';
    button.type = 'button';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await api('unshare', { id: item.id }); visibility.textContent = '我的资料 · 仅自己可见'; button.remove(); }
      catch (error) { failed(error, 'entry-message'); button.disabled = false; }
    });
    card.append(' ', button);
  }
  parent.append(card);
}

get('login-mode').onclick = () => selectMode('login');
get('register-mode').onclick = () => selectMode('register');
get('auth-form').onsubmit = async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const action = mode;
  if (action === 'register' && data.password !== get('confirm-password').value) return message('auth-message', '两次密码不一致。', true);
  const button = get('auth-submit');
  message('auth-message');
  button.disabled = true;
  try { show(await api(action, data)); }
  catch (error) { message('auth-message', error.message, true); }
  finally { button.disabled = false; }
};
get('entry-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget, button = form.querySelector('button');
  const fields = new FormData(form), data = Object.fromEntries(fields);
  const version = generation;
  button.disabled = true;
  message('entry-message');
  try {
    await api('cards', { ...data, shared: fields.has('shared') });
    if (version === generation) { form.reset(); message('entry-message', '已保存。你现在可以在右侧问答中查找这条资料。'); }
  } catch (error) { if (version === generation) failed(error, 'entry-message'); }
  finally { button.disabled = false; }
};
get('ask-form').onsubmit = async event => {
  event.preventDefault();
  const question = get('question').value.trim(), button = event.currentTarget.querySelector('button');
  if (!question || button.disabled) return;
  const version = generation;
  get('question').value = '';
  button.disabled = true;
  bubble(question, 'user');
  const reply = bubble('正在查找资料…');
  try {
    const result = await api('ask', { question });
    if (version !== generation) return;
    reply.textContent = result.text;
    result.sources.forEach(item => source(item, reply));
  } catch (error) {
    if (version === generation) {
      if (error.status === 401) failed(error, 'entry-message');
      else reply.textContent = error.message;
    }
  } finally { button.disabled = false; }
};
get('welcome').addEventListener('click', event => {
  const question = event.target.dataset.question;
  if (question) { get('question').value = question; get('ask-form').requestSubmit(); }
});
get('logout').onclick = async () => {
  const button = get('logout');
  button.disabled = true;
  try { await api('logout', {}); show(null); selectMode('login'); }
  catch (error) { failed(error, 'entry-message'); }
  finally { button.disabled = false; }
};
api('me').then(show).catch(error => {
  show(null);
  if (error.status !== 401) message('auth-message', '暂时无法连接账号服务。你可以稍后重试。', true);
});
