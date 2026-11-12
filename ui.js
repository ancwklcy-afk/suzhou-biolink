/* BioLink visual layer: network background with page-wide mouse interaction, header shortcuts, and the two landing demos.
   It never touches the account or data logic in app.js. */
(function () {
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- header and demo links: pick the login or register tab, then focus the account field ---------- */
  function openAuth(mode) {
    var tab = $(mode + '-mode');
    if (tab) tab.click();
    setTimeout(function () {
      var field = $('identity');
      if (field && !field.closest('[hidden]')) field.focus({ preventScroll: true });
    }, 350);
  }
  document.querySelectorAll('[data-mode]').forEach(function (el) {
    el.addEventListener('click', function () { openAuth(el.getAttribute('data-mode')); });
  });

  /* ---------- landing demo 1: category switches the placeholder ---------- */
  var HINTS = {
    cap: '写清你能提供什么，例如：临床前评价',
    need: '写清你想找什么',
    res: '写清你手里有什么，例如：跨境 BD 渠道'
  };
  document.querySelectorAll('input[name="demo-kind"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      var area = $('demo-text');
      if (area) area.setAttribute('placeholder', HINTS[radio.value] || '');
    });
  });

  /* ---------- landing demo 2: the preview question box asks the visitor to log in ---------- */
  var demoQ = $('demo-q');
  var demoLog = $('demo-log');
  document.querySelectorAll('.chip-btn').forEach(function (button) {
    button.addEventListener('click', function () {
      if (!demoQ) return;
      demoQ.value = button.textContent.trim();
      demoQ.focus();
    });
  });
  var demoForm = $('demo-ask-form');
  if (demoForm && demoQ && demoLog) {
    demoForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var text = demoQ.value.trim();
      if (!text) { demoQ.focus(); return; }
      var empty = $('demo-log-empty');
      if (empty) empty.remove();
      var mine = document.createElement('div');
      mine.className = 'bubble me';
      mine.textContent = text;
      var reply = document.createElement('div');
      reply.className = 'bubble sys';
      var note = document.createElement('p');
      note.style.margin = '0 0 6px';
      note.textContent = '登录后才能查询你的资料和成员共享的内容。';
      var back = document.createElement('a');
      back.href = '#auth';
      back.textContent = '回到登录';
      back.addEventListener('click', function () { openAuth('login'); });
      reply.appendChild(note);
      reply.appendChild(back);
      demoLog.appendChild(mine);
      demoLog.appendChild(reply);
      demoLog.scrollTop = demoLog.scrollHeight;
      demoQ.value = '';
    });
  }

  /* ---------- network canvas ---------- */
  var cv = $('net');
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var W = 0, H = 0, nodes = [], pulses = [], ripples = [], strong = [];
  var spawn = 0, raf = 0, last = 0, running = false, inView = true;
  var cur = { x: 0, y: 0, on: false };
  var col = { cap: '#0a8f84', need: '#d23a6a', res: '#b9820a', ink: '#10282b', accent: '#0b6f68' };
  var REACH = 170;

  function readColors() {
    try {
      var style = getComputedStyle(document.documentElement);
      ['cap', 'need', 'res', 'ink', 'accent'].forEach(function (key) {
        var value = style.getPropertyValue('--' + key).trim();
        if (value) col[key] = value;
      });
    } catch (err) {}
    if (!running) draw();
  }
  function linkLength() { return Math.max(110, Math.min(170, W / 9)); }

  function seed() {
    var count = Math.round(Math.min(72, Math.max(22, (W * H) / 15000)));
    nodes = [];
    for (var i = 0; i < count; i++) {
      var roll = Math.random();
      nodes.push({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - .5) * .03, vy: (Math.random() - .5) * .03, ex: 0, ey: 0,
        t: roll < .3 ? 'need' : (roll < .68 ? 'cap' : 'res'),
        r: 2.6 + Math.random() * 2
      });
    }
    pulses = [];
  }
  function resize() {
    var rect = cv.getBoundingClientRect();
    var nw = rect.width, nh = rect.height;
    if (!nw || !nh) return;
    var keep = nodes.length && Math.abs(nw - W) < 1;
    W = nw; H = nh;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (keep) {
      nodes.forEach(function (n) { n.x = Math.min(n.x, W - 8); n.y = Math.min(n.y, H - 8); });
    } else {
      seed();
    }
    draw();
  }

  function step(dt) {
    var decay = Math.pow(.94, dt / 16);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (cur.on) {
        var dx = cur.x - n.x, dy = cur.y - n.y, d = Math.hypot(dx, dy) || 1;
        if (d < REACH) {
          var f = (1 - d / REACH) * .00035 * dt * (d < 46 ? -2.2 : 1);
          n.ex += dx / d * f; n.ey += dy / d * f;
        }
      }
      n.ex *= decay; n.ey *= decay;
      var speed = Math.hypot(n.ex, n.ey);
      if (speed > .35) { n.ex *= .35 / speed; n.ey *= .35 / speed; }
      n.x += (n.vx + n.ex) * dt; n.y += (n.vy + n.ey) * dt;
      if (n.x < 8 || n.x > W - 8) { n.vx *= -1; n.ex *= -1; n.x = Math.max(8, Math.min(W - 8, n.x)); }
      if (n.y < 8 || n.y > H - 8) { n.vy *= -1; n.ey *= -1; n.y = Math.max(8, Math.min(H - 8, n.y)); }
    }
    for (var k = ripples.length - 1; k >= 0; k--) {
      ripples[k].p += dt / 700;
      if (ripples[k].p >= 1) ripples.splice(k, 1);
    }
    spawn += dt;
    if (spawn > 900) { spawn = 0; addPulse(); }
    for (var j = pulses.length - 1; j >= 0; j--) {
      pulses[j].p += dt / 1500;
      if (pulses[j].p >= 1) pulses.splice(j, 1);
    }
  }
  function addPulse() {
    if (!strong.length || pulses.length > 6) return;
    var edge = strong[Math.floor(Math.random() * strong.length)];
    pulses.push({ from: edge.sup, to: edge.need, p: 0 });
  }

  function draw() {
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    var L = linkLength(), i, j, a, b, d, sup, need;
    strong = [];
    ctx.lineWidth = 1;
    for (i = 0; i < nodes.length; i++) {
      for (j = i + 1; j < nodes.length; j++) {
        a = nodes[i]; b = nodes[j];
        if ((a.t === 'need') === (b.t === 'need')) continue;
        d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > L) continue;
        need = a.t === 'need' ? a : b;
        sup = need === a ? b : a;
        var k = 1 - d / L;
        ctx.globalAlpha = k * .22;
        ctx.strokeStyle = col.ink;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        if (d < L * .6) {
          ctx.globalAlpha = k * .6;
          ctx.strokeStyle = col[sup.t];
          ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.lineWidth = 1;
          strong.push({ sup: sup, need: need });
        }
      }
    }
    for (i = 0; i < pulses.length; i++) {
      var p = pulses[i];
      ctx.globalAlpha = Math.sin(Math.PI * p.p) * .9;
      ctx.fillStyle = col[p.from.t];
      ctx.beginPath();
      ctx.arc(p.from.x + (p.to.x - p.from.x) * p.p, p.from.y + (p.to.y - p.from.y) * p.p, 2.4, 0, 6.2832);
      ctx.fill();
    }
    if (cur.on) {
      ctx.strokeStyle = col.accent; ctx.lineWidth = 1.2;
      for (i = 0; i < nodes.length; i++) {
        a = nodes[i];
        d = Math.hypot(a.x - cur.x, a.y - cur.y);
        if (d > REACH) continue;
        ctx.globalAlpha = (1 - d / REACH) * .65;
        ctx.beginPath(); ctx.moveTo(cur.x, cur.y); ctx.lineTo(a.x, a.y); ctx.stroke();
      }
      ctx.globalAlpha = .16; ctx.fillStyle = col.accent;
      ctx.beginPath(); ctx.arc(cur.x, cur.y, 16, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = 1; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(cur.x, cur.y, 5, 0, 6.2832); ctx.stroke();
      ctx.lineWidth = 1;
    }
    for (i = 0; i < ripples.length; i++) {
      var rp = ripples[i];
      ctx.globalAlpha = (1 - rp.p) * .6; ctx.strokeStyle = col.accent; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(rp.x, rp.y, 10 + rp.p * 200, 0, 6.2832); ctx.stroke();
      ctx.lineWidth = 1;
    }
    for (i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      ctx.globalAlpha = .14;
      ctx.fillStyle = col[n.t];
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 3.2, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = .95;
      if (n.t === 'need') {
        ctx.strokeStyle = col.need; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 6.2832); ctx.stroke();
        ctx.lineWidth = 1;
      } else {
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 6.2832); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function frame(ts) {
    if (!running) return;
    var dt = Math.min(48, ts - last || 16);
    last = ts;
    step(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (running || reduce.matches || !inView || document.hidden) return;
    running = true; last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; cancelAnimationFrame(raf); }
  function sync() {
    if (reduce.matches || !inView || document.hidden) { stop(); draw(); } else start();
  }

  /* mouse interaction across the whole page; opaque surfaces pause it so nodes never gather out of sight */
  var SOLID = 'header, .panel, .demo';
  function place(event) {
    var rect = cv.getBoundingClientRect();
    cur.x = event.clientX - rect.left; cur.y = event.clientY - rect.top;
  }
  document.addEventListener('pointermove', function (event) {
    if (reduce.matches || event.pointerType === 'touch') return;
    cur.on = !(event.target.closest && event.target.closest(SOLID));
    place(event);
  }, { passive: true });
  window.addEventListener('mouseout', function (event) { if (!event.relatedTarget) cur.on = false; });
  document.addEventListener('pointerdown', function (event) {
    if (reduce.matches) return;
    if (event.target.closest && event.target.closest(SOLID + ', a, button, input, textarea, label')) return;
    place(event);
    ripples.push({ x: cur.x, y: cur.y, p: 0 });
    nodes.forEach(function (n) {
      var dx = n.x - cur.x, dy = n.y - cur.y, d = Math.hypot(dx, dy) || 1;
      if (d < 240) { var f = .3 * (1 - d / 240); n.ex += dx / d * f; n.ey += dy / d * f; }
    });
  });

  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(cv); else window.addEventListener('resize', resize);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) { inView = entries[0].isIntersecting; sync(); }).observe(cv);
  }
  document.addEventListener('visibilitychange', sync);
  try { reduce.addEventListener('change', sync); } catch (err) {}
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors); } catch (err) {}

  readColors();
  resize();
  sync();
})();
