(() => {
  const THEME_KEY = 'taskManagerTheme';
  const reminderTimers = {};
  let allTasks = [];

  const $ = id => document.getElementById(id);

  // Elements
  const taskForm = $('taskForm');
  const taskTitle = $('taskTitle');
  const taskDesc = $('taskDesc');
  const taskPriority = $('taskPriority');
  const taskStatus = $('taskStatus');
  const taskDeadline = $('taskDeadline');
  const taskReminder = $('taskReminder');
  const taskList = $('taskList');
  const emptyMsg = $('emptyMsg');
  const filterStatus = $('filterStatus');
  const filterPriority = $('filterPriority');
  const filterSearch = $('filterSearch');
  const themeToggle = $('themeToggle');
  const themeIcon = $('themeIcon');
  const toast = $('toast');

  // ---- Firebase Init ----
  const firebaseConfig = {
    apiKey: "AIzaSyDqrKCtRct2OY23uN_HzryY59o9JVZbHbc",
    authDomain: "task-manager-d51df.firebaseapp.com",
    databaseURL: "https://task-manager-d51df-default-rtdb.firebaseio.com",
    projectId: "task-manager-d51df",
    storageBucket: "task-manager-d51df.firebasestorage.app",
    messagingSenderId: "466475661819",
    appId: "1:466475661819:web:73cb9e3bd68d40844cb35e"
  };
  firebase.initializeApp(firebaseConfig);
  const db = firebase.database();

  // ---- Storage ----
  function saveTasks(tasks) {
    db.ref("tasks").set(tasks);
  }

  // ---- Theme ----
  function applyTheme(dark) {
    document.body.classList.toggle('dark', dark);
    themeIcon.innerHTML = dark ? '&#9790;' : '&#9788;';
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  }
  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    applyTheme(saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches));
  }
  themeToggle.addEventListener('click', () => {
    applyTheme(!document.body.classList.contains('dark'));
  });

  const testAlarmBtn = $('testAlarm');
  if (testAlarmBtn) testAlarmBtn.addEventListener('click', () => {
    queueAlarm({ id: 'test', title: 'Tes Alarm', reminderMinutes: 0 }, 'test');
    showToast('Alarm dicoba! Tekan DONE untuk menghentikan.');
  });

  // ---- Toast ----
  let toastTimeout;
  function showToast(msg, type = '') {
    toast.textContent = msg;
    toast.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.className = 'toast', 3500);
  }

  // ---- Alarm Sound ----
  let audioCtx = null;
  let audioPrimed = false;
  let wakeLock = null;
  const alarmGains = new Set();
  function ensureAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return Promise.resolve(false);
    if (!audioCtx) {
      try { audioCtx = new AC(); } catch (e) { return Promise.resolve(false); }
    }
    if (audioCtx.state === 'suspended') {
      return audioCtx.resume().then(() => true).catch(() => false);
    }
    return Promise.resolve(true);
  }
  function playSilentBlock() {
    if (!audioCtx || audioCtx.state !== 'running' || audioPrimed) return;
    audioPrimed = true;
    try {
      const buf = audioCtx.createBuffer(1, 1, 22050);
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(audioCtx.destination);
      src.start(0);
    } catch (e) {}
  }
  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      try { Notification.requestPermission(); } catch (e) {}
    }
  }
  function requestWakeLock() {
    if (!('wakeLock' in navigator) || wakeLock) return;
    try {
      const p = navigator.wakeLock.request('screen');
      if (p && typeof p.then === 'function') {
        p.then(l => { wakeLock = l; }).catch(() => {});
      }
    } catch (e) {}
  }
  function releaseWakeLock() {
    if (!wakeLock) return;
    const l = wakeLock;
    wakeLock = null;
    l.release().catch(() => {});
  }
  function beep(freq, startTime, dur, vol = 0.35) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(vol, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);
    osc.connect(gain).connect(audioCtx.destination);
    alarmGains.add(gain);
    osc.addEventListener('ended', () => alarmGains.delete(gain));
    osc.start(startTime);
    osc.stop(startTime + dur + 0.05);
  }
  function stopAllBeeps() {
    if (!audioCtx || alarmGains.size === 0) return;
    const t = audioCtx.currentTime;
    alarmGains.forEach(g => {
      try {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      } catch (e) {}
    });
    alarmGains.clear();
  }
  function vibrateAlarm() {
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 350]);
  }
  function stopVibration() {
    if (navigator.vibrate) navigator.vibrate(0);
  }
  function playAlarmChime() {
    vibrateAlarm();
    ensureAudio().then(active => {
      if (!audioCtx || !active) { updateAlarmHint(); return; }
      const t0 = audioCtx.currentTime;
      try {
        for (let i = 0; i < 4; i++) {
          const start = t0 + i * 0.55;
          beep(987.77, start, 0.32, 0.38);
          beep(659.25, start + 0.18, 0.32, 0.32);
        }
      } catch (e) {}
    });
  }
  function unlockAndRing() {
    requestNotificationPermission();
    ensureAudio().then(active => {
      if (!active) { updateAlarmHint(); return; }
      playSilentBlock();
      if (alarmState.ringing) startAlarmSound();
      updateAlarmHint();
    });
  }
  document.addEventListener('pointerdown', unlockAndRing);
  document.addEventListener('touchstart', unlockAndRing);
  document.addEventListener('keydown', unlockAndRing);

  // ---- Alarm Overlay ----
  let alarmModal = $('alarmModal');
  let alarmTitleEl = $('alarmTitle');
  let alarmTaskTitleEl = $('alarmTaskTitle');
  let alarmMsgEl = $('alarmMsg');
  let alarmHintEl = $('alarmHint');
  let alarmSoundBtn = $('alarmSound');
  let alarmDoneBtn = $('alarmDone');
  const alarmQueue = [];
  const alarmState = { ringing: false, current: null };
  let alarmSoundTimer = null;

  function ensureAlarmUI() {
    if (alarmModal && alarmDoneBtn) return;
    const css = `
.alarm-modal{position:fixed;top:0;left:0;right:0;bottom:0;height:100vh;height:100dvh;background:rgba(36,23,33,.55);backdrop-filter:blur(4px);display:flex;overflow-y:auto;overscroll-behavior:contain;z-index:999;padding:1.2rem}
.alarm-modal[hidden]{display:none}
.alarm-box{margin:auto;width:100%;max-width:380px;background:#fff;border-radius:22px;padding:1.7rem 1.6rem 1.4rem;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.35);border:2px solid var(--accent-deep);animation:alarmPulse 1.1s ease-in-out infinite}
body.dark .alarm-box{background:#37242f}
@keyframes alarmPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.03)}}
.alarm-icon{font-size:2.6rem;margin-bottom:.5rem;animation:alarmSwing 1s ease-in-out infinite}
@keyframes alarmSwing{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(10deg)}}
.alarm-box h2{font-size:1.25rem;font-weight:800;margin-bottom:.5rem;color:var(--accent-deep)}
.alarm-task-title{font-size:1.15rem;font-weight:800;color:var(--text);background:var(--accent-soft);border:1.5px dashed var(--accent);border-radius:12px;padding:.7rem 1rem;margin-bottom:1rem;word-break:break-word}
#alarmMsg{font-size:.9rem;color:var(--text-muted);margin-bottom:1rem;line-height:1.5}
.alarm-hint{font-size:.78rem;font-weight:700;color:var(--warning);margin-bottom:1rem}
.alarm-hint[hidden]{display:none}
.alarm-actions{display:flex;flex-direction:column;gap:.7rem}
.alarm-sound-btn{padding:.8rem;background:var(--accent-soft);color:var(--accent-deep);border:1.5px solid var(--accent);border-radius:12px;font-size:.95rem;font-weight:700;cursor:pointer}
.alarm-sound-btn:hover{transform:translateY(-2px)}
.alarm-done-btn{padding:1.2rem;background:linear-gradient(135deg,#35c98d,#1fae76);color:#fff;border:none;border-radius:16px;font-size:1.35rem;font-weight:900;cursor:pointer;letter-spacing:.03em;box-shadow:0 6px 20px rgba(53,201,141,.4)}
.alarm-done-btn:hover{transform:translateY(-2px)}
.alarm-done-btn:active{transform:translateY(0) scale(.98)}
`;
    const styleTag = document.createElement('style');
    styleTag.textContent = css;
    document.head.appendChild(styleTag);
    const overlay = document.createElement('div');
    overlay.id = 'alarmModal';
    overlay.className = 'alarm-modal';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="alarm-box">
        <div class="alarm-icon">&#9203;</div>
        <h2 id="alarmTitle">Alarm Deadline</h2>
        <h3 id="alarmTaskTitle" class="alarm-task-title"></h3>
        <p id="alarmMsg"></p>
        <p id="alarmHint" class="alarm-hint">Tap layar atau tekan &#128276; Bunyikan Suara supaya alarm berbunyi di HP.</p>
        <div class="alarm-actions">
          <button id="alarmSound" class="alarm-sound-btn">&#128276; Bunyikan Suara</button>
          <button id="alarmDone" class="alarm-done-btn">&#10003; DONE</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    alarmModal = overlay;
    alarmTitleEl = $('alarmTitle');
    alarmTaskTitleEl = $('alarmTaskTitle');
    alarmMsgEl = $('alarmMsg');
    alarmHintEl = $('alarmHint');
    alarmSoundBtn = $('alarmSound');
    alarmDoneBtn = $('alarmDone');
  }
  ensureAlarmUI();
  const hasAlarmUI = !!(alarmModal && alarmDoneBtn);

  function updateAlarmHint() {
    if (!hasAlarmUI) return;
    const active = !!(audioCtx && audioCtx.state === 'running');
    alarmHintEl.hidden = active || !alarmState.ringing;
  }

  function startAlarmSound() {
    stopAlarmSound();
    playAlarmChime();
    alarmSoundTimer = setInterval(playAlarmChime, 2500);
  }
  function stopAlarmSound() {
    if (alarmSoundTimer) { clearInterval(alarmSoundTimer); alarmSoundTimer = null; }
    stopAllBeeps();
    stopVibration();
  }
  function showAlarm(title, taskName, message) {
    if (!hasAlarmUI) {
      playAlarmChime();
      showToast((taskName ? taskName + ': ' : '') + message, 'reminder');
      return;
    }
    alarmTitleEl.textContent = title;
    alarmTaskTitleEl.textContent = taskName;
    alarmMsgEl.textContent = message;
    alarmModal.hidden = false;
    requestWakeLock();
    startAlarmSound();
    unlockAndRing();
    updateAlarmHint();
  }
  function hideAlarm() {
    if (alarmModal) alarmModal.hidden = true;
    stopAlarmSound();
    releaseWakeLock();
    updateAlarmHint();
  }
  function ringNext() {
    if (alarmState.ringing) return;
    const next = alarmQueue.shift();
    if (!next) { hideAlarm(); return; }
    alarmState.ringing = true;
    alarmState.current = next;
    showAlarm(next.title, next.name, next.message);
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(next.title, { tag: 'alarm-' + next.taskId, body: next.name });
      } catch (e) {}
    }
  }
  function queueAlarm(task, type) {
    if (alarmState.current && alarmState.current.taskId === task.id) return;
    if (alarmQueue.some(a => a.taskId === task.id)) return;
    const overdue = type === 'overdue';
    const isTest = type === 'test';
    alarmQueue.push({
      taskId: task.id,
      title: overdue ? 'Deadline Terlewat' : (isTest ? 'Tes Alarm' : 'Reminder Deadline'),
      name: task.title,
      message: isTest
        ? 'Ini alarm percobaan. Tekan DONE untuk menghentikan alarm.'
        : overdue
          ? 'Task ini sudah melewati deadline. Alarm akan berhenti setelah kamu menekan DONE.'
          : `Deadline dalam ${task.reminderMinutes} menit. Alarm akan berhenti setelah kamu menekan DONE.`
    });
    ringNext();
  }
  function closeTaskNotifications(current) {
    if (!current || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistration().then(reg => {
      if (!reg) return;
      reg.getNotifications({ tag: 'alarm-' + current.taskId }).then(list => list.forEach(n => n.close()));
    }).catch(() => {});
  }
  function stopCurrentAlarm() {
    alarmState.ringing = false;
    alarmState.current = null;
    ringNext();
  }
  if (alarmDoneBtn) alarmDoneBtn.addEventListener('click', () => {
    const current = alarmState.current;
    if (current) {
      const idx = allTasks.findIndex(t => t.id === current.taskId);
      if (idx !== -1) {
        allTasks[idx].reminded = true;
        clearReminder(current.taskId);
        saveTasks(allTasks);
        showToast('Alarm dihentikan.');
      }
    }
    closeTaskNotifications(current);
    stopCurrentAlarm();
  });
  if (alarmSoundBtn) alarmSoundBtn.addEventListener('click', () => {
    unlockAndRing();
    showToast('Alarm dibunyikan.');
  });

  // ---- Reminder ----
  function clearReminder(id) {
    if (reminderTimers[id]) { clearTimeout(reminderTimers[id]); delete reminderTimers[id]; }
  }
  function fireReminder(task, type = 'upcoming') {
    queueAlarm(task, type);
  }
  function checkDueReminders() {
    if (alarmState.ringing) return;
    const now = Date.now();
    allTasks.forEach(t => {
      if (!t.deadline || t.status === 'done' || t.reminded) return;
      const deadline = new Date(t.deadline).getTime();
      if (deadline <= now) {
        fireReminder(t, 'overdue');
      } else {
        const remindAt = deadline - (t.reminderMinutes || 30) * 60 * 1000;
        if (remindAt <= now) fireReminder(t, 'upcoming');
      }
    });
  }
  function scheduleReminder(task) {
    clearReminder(task.id);
    if (!task.deadline || task.reminderMinutes <= 0 || task.status === 'done' || task.reminded) return;
    const now = Date.now();
    const deadline = new Date(task.deadline).getTime();
    const remindAt = deadline - task.reminderMinutes * 60 * 1000;
    if (remindAt > now) {
      reminderTimers[task.id] = setTimeout(() => {
        const t = allTasks.find(x => x.id === task.id);
        if (t && t.status !== 'done' && !t.reminded && Date.now() < new Date(t.deadline).getTime()) {
          fireReminder(t);
        }
      }, remindAt - now);
    }
  }

  // ---- Render ----
  function getFilteredTasks() {
    const status = filterStatus.value;
    const priority = filterPriority.value;
    const search = filterSearch.value.toLowerCase().trim();
    return allTasks.filter(t => {
      if (status !== 'all' && t.status !== status) return false;
      if (priority !== 'all' && t.priority !== priority) return false;
      if (search && !t.title.toLowerCase().includes(search) && !(t.description || '').toLowerCase().includes(search)) return false;
      return true;
    });
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hour}:${min}`;
  }

  function deadlineClass(iso, status) {
    if (!iso || status === 'done') return '';
    const now = Date.now();
    const dl = new Date(iso).getTime();
    if (dl < now) return 'overdue';
    if (dl - now < 24 * 60 * 60 * 1000) return 'soon';
    return '';
  }

  function statusLabel(s) {
    return { 'todo': 'Todo', 'in-progress': 'In Progress', 'done': 'Done' }[s] || s;
  }
  function priorityLabel(p) {
    return { 'low': 'Rendah', 'medium': 'Sedang', 'high': 'Tinggi' }[p] || p;
  }

  function render() {
    const tasks = getFilteredTasks();

    // Stats
    $('statTodo').querySelector('.stat-num').textContent = allTasks.filter(t => t.status === 'todo').length;
    $('statProgress').querySelector('.stat-num').textContent = allTasks.filter(t => t.status === 'in-progress').length;
    $('statDone').querySelector('.stat-num').textContent = allTasks.filter(t => t.status === 'done').length;

    const totalCount = allTasks.length;
    const doneCount = allTasks.filter(t => t.status === 'done').length;
    const progress = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
    const pBar = $('progressBar');
    const pText = $('progressText');
    if (pBar) pBar.style.width = progress + '%';
    if (pText) pText.textContent = progress + '% selesai';

    if (tasks.length === 0) {
      taskList.innerHTML = '';
      emptyMsg.style.display = 'block';
      return;
    }
    emptyMsg.style.display = 'none';

    tasks.sort((a, b) => {
      if (a.status === 'done' && b.status !== 'done') return 1;
      if (a.status !== 'done' && b.status === 'done') return -1;
      if (a.deadline && b.deadline) return new Date(a.deadline) - new Date(b.deadline);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return 0;
    });

    taskList.innerHTML = tasks.map(t => {
      const dlClass = deadlineClass(t.deadline, t.status);
      return `
        <div class="task-card priority-${t.priority} ${t.status === 'done' ? 'done' : ''}" data-id="${t.id}">
          <div class="task-info">
            <div class="task-title">${escapeHtml(t.title)}</div>
            ${t.description ? `<div class="task-desc">${escapeHtml(t.description)}</div>` : ''}
            <div class="task-meta">
              <span class="badge badge-${t.status}">${statusLabel(t.status)}</span>
              <span class="badge badge-${t.priority}">${priorityLabel(t.priority)}</span>
              ${t.deadline ? `<span class="task-deadline ${dlClass}">${dlClass === 'overdue' ? '&#9888; ' : ''}Deadline: ${formatDate(t.deadline)}</span>` : ''}
            </div>
          </div>
          <div class="task-actions">
            ${t.status !== 'in-progress' && t.status !== 'done' ? `<button class="btn-start" data-id="${t.id}">&#9654; Start</button>` : ''}
            ${t.status === 'in-progress' ? `<button class="btn-done" data-id="${t.id}">&#10003; Done</button>` : ''}
            ${t.status !== 'todo' ? `<button class="btn-todo" data-id="${t.id}">&#8634; Todo</button>` : ''}
            <button class="btn-delete" data-id="${t.id}">&#10005;</button>
          </div>
        </div>`;
    }).join('');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Actions ----
  taskForm.addEventListener('submit', e => {
    e.preventDefault();
    const title = taskTitle.value.trim();
    if (!title) return;

    const task = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      title,
      description: taskDesc.value.trim(),
      priority: taskPriority.value,
      status: taskStatus.value,
      deadline: taskDeadline.value || null,
      reminderMinutes: parseInt(taskReminder.value) || 30,
      createdAt: new Date().toISOString()
    };
    allTasks.unshift(task);
    saveTasks(allTasks);
    scheduleReminder(task);
    taskForm.reset();
    taskPriority.value = 'medium';
    taskStatus.value = 'todo';
    taskReminder.value = '30';
    showToast('Task berhasil ditambahkan!');
  });

  taskList.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    const idx = allTasks.findIndex(t => t.id === id);
    if (idx === -1) return;

    if (btn.classList.contains('btn-delete')) {
      clearReminder(id);
      allTasks.splice(idx, 1);
      saveTasks(allTasks);
      showToast('Task dihapus.');
    } else if (btn.classList.contains('btn-start')) {
      allTasks[idx].status = 'in-progress';
      allTasks[idx].reminded = false;
      saveTasks(allTasks);
      scheduleReminder(allTasks[idx]);
      showToast('Task dimulai!');
    } else if (btn.classList.contains('btn-done')) {
      allTasks[idx].status = 'done';
      clearReminder(id);
      saveTasks(allTasks);
      showToast('Task selesai!');
    } else if (btn.classList.contains('btn-todo')) {
      allTasks[idx].status = 'todo';
      allTasks[idx].reminded = false;
      saveTasks(allTasks);
      scheduleReminder(allTasks[idx]);
      showToast('Task dikembalikan ke Todo.');
    }
  });

  filterStatus.addEventListener('change', render);
  filterPriority.addEventListener('change', render);
  filterSearch.addEventListener('input', render);

  // ---- Notifications ----
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // ---- Init Firebase & Real-time Sync ----
  initTheme();
  db.ref("tasks").on("value", snap => {
    allTasks = snap.val() || [];
    checkDueReminders();
    allTasks.forEach(scheduleReminder);
    render();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      releaseWakeLock();
      return;
    }
    if (alarmState.ringing) { startAlarmSound(); requestWakeLock(); }
    checkDueReminders();
    allTasks.forEach(scheduleReminder);
    render();
  });
  window.addEventListener('pageshow', () => {
    if (alarmState.ringing) { startAlarmSound(); requestWakeLock(); }
    checkDueReminders();
    allTasks.forEach(scheduleReminder);
  });
  window.addEventListener('focus', () => {
    if (alarmState.ringing) { startAlarmSound(); requestWakeLock(); }
    checkDueReminders();
    allTasks.forEach(scheduleReminder);
  });
  window.addEventListener('online', () => {
    checkDueReminders();
    allTasks.forEach(scheduleReminder);
  });
  setInterval(checkDueReminders, 30000);
})();