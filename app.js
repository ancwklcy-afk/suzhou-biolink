const get = id => document.getElementById(id);
let mode = 'login';
let generation = 0;
let registration;
let resendAt = 0;
let resendTimer;
let sending = false;
let submitting = false;

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
  const wasLanding = document.body.classList.contains('is-landing');
  generation++;
  get('loading').hidden = true;
  get('auth').hidden = Boolean(user);
  get('workspace').hidden = !user;
  get('account').hidden = !user;
  document.body.classList.toggle('is-landing', !user);
  if (wasLanding !== !user) window.scrollTo({ top: 0, behavior: 'instant' });
  get('username').textContent = user?.name || '';
  get('auth-form').reset();
  get('entry-form').reset();
  get('ask-form').reset();
  get('thread').querySelectorAll('.bubble').forEach(node => node.remove());
  get('welcome').hidden = false;
  message('entry-message');
}

function contactChannel(value = get('identity').value) {
  return value.includes('@') ? 'email' : 'sms';
}
function updateSendButton() {
  const remaining = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
  const button = get('send-code');
  button.disabled = sending || submitting || remaining > 0 || !get('identity').value.trim() || !registration?.[contactChannel()];
  button.textContent = sending ? '发送中…' : remaining ? `${remaining} 秒后重发` : '发送验证码';
  if (!remaining) { clearInterval(resendTimer); resendTimer = undefined; }
}
function updateRegistrationAvailability() {
  const value = get('identity').value.trim();
  const channel = contactChannel(value);
  const unavailable = !registration ? '暂时无法确认验证码服务。' :
    !registration.email && !registration.sms ? '邮箱和短信验证码服务暂未开通。' :
    value && !registration[channel] ? `${channel === 'email' ? '邮箱' : '短信'}验证码服务暂未开通。` : '';
  message('verification-message', mode === 'register' ? unavailable : '');
  get('auth-submit').disabled = submitting || (mode === 'register' && (!value || !registration?.[channel]));
  updateSendButton();
}
function updateRegistrationFields() {
  const registering = mode === 'register';
  const identity = get('identity');
  const code = get('verification-code');
  get('identity-label').textContent = registering ? '邮箱或手机号' : '账号';
  identity.placeholder = registering ? '输入邮箱地址或手机号' : '用户名、邮箱或手机号';
  get('verification-field').hidden = !registering;
  code.required = registering;
  code.disabled = !registering;
  code.value = '';
  updateRegistrationAvailability();
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
  updateRegistrationFields();
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
get('identity').oninput = () => {
  if (mode === 'register') get('verification-code').value = '';
  updateRegistrationAvailability();
};
get('send-code').onclick = async () => {
  const input = get('identity');
  const name = input.value.trim();
  const channel = contactChannel(name);
  if (mode !== 'register' || !name || !registration?.[channel] || !input.reportValidity()) return;
  sending = true;
  updateSendButton();
  message('verification-message');
  try {
    const result = await api('send-code', { name });
    resendAt = Date.now() + result.retryAfter * 1000;
    resendTimer = setInterval(updateSendButton, 250);
    if (mode === 'register' && input.value.trim() === name) {
      message('verification-message', channel === 'email' ? '已请求发送，请查看收件箱和垃圾邮件。' : '已请求发送，请留意短信。');
      get('verification-code').focus();
    }
  } catch (error) {
    if (mode === 'register' && input.value.trim() === name) message('verification-message', error.message, true);
  } finally {
    sending = false;
    updateSendButton();
  }
};
get('auth-form').onsubmit = async event => {
  event.preventDefault();
  if (submitting || get('auth-submit').disabled) return;
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const action = mode;
  if (action === 'register' && data.password !== get('confirm-password').value) return message('auth-message', '两次密码不一致。', true);
  message('auth-message');
  submitting = true;
  get('auth-submit').disabled = true;
  updateSendButton();
  try { show(await api(action, data)); }
  catch (error) { message('auth-message', error.message, true); }
  finally { submitting = false; updateRegistrationAvailability(); }
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
api('auth-config').then(config => {
  registration = config;
  if (mode === 'register') updateRegistrationAvailability();
}).catch(() => {});
api('me').then(show).catch(error => {
  show(null);
  if (error.status !== 401) message('auth-message', '暂时无法连接账号服务。你可以稍后重试。', true);
});
