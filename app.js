(() => {
  const STORAGE_KEY = 'taskManagerTasks';
  const THEME_KEY = 'taskManagerTheme';
  const reminderTimers = {};

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

  // ---- Storage ----
  function loadTasks() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { return []; }
  }
  function saveTasks(tasks) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
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
  function ensureAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
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
    osc.start(startTime);
    osc.stop(startTime + dur + 0.05);
  }
  function playAlarm() {
    try {
      ensureAudio();
      if (!audioCtx) return;
      const t0 = audioCtx.currentTime;
      for (let i = 0; i < 4; i++) {
        const start = t0 + i * 0.55;
        beep(987.77, start, 0.32, 0.38); // B5
        beep(659.25, start + 0.18, 0.32, 0.32); // E5
      }
    } catch (e) {}
  }
  document.addEventListener('pointerdown', ensureAudio, { once: true });

  // ---- Reminder ----
  function clearReminder(id) {
    if (reminderTimers[id]) { clearTimeout(reminderTimers[id]); delete reminderTimers[id]; }
  }
  function markReminded(task) {
    const tasks = loadTasks();
    const idx = tasks.findIndex(t => t.id === task.id);
    if (idx !== -1) {
      tasks[idx].reminded = true;
      saveTasks(tasks);
    }
  }
  function fireReminder(task) {
    playAlarm();
    showToast(`Reminder: "${task.title}" deadline dalam ${task.reminderMinutes} menit!`, 'reminder');
    if (Notification.permission === 'granted') {
      new Notification('Task Reminder', { body: `"${task.title}" deadline dalam ${task.reminderMinutes} menit!` });
    }
    markReminded(task);
  }
  function scheduleReminder(task) {
    clearReminder(task.id);
    if (!task.deadline || task.reminderMinutes <= 0 || task.status === 'done' || task.reminded) return;
    const now = Date.now();
    const deadline = new Date(task.deadline).getTime();
    const remindAt = deadline - task.reminderMinutes * 60 * 1000;
    if (remindAt > now) {
      reminderTimers[task.id] = setTimeout(() => {
        const t = loadTasks().find(x => x.id === task.id);
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
    return loadTasks().filter(t => {
      if (status !== 'all' && t.status !== status) return false;
      if (priority !== 'all' && t.priority !== priority) return false;
      if (search && !t.title.toLowerCase().includes(search) && !t.description.toLowerCase().includes(search)) return false;
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
    const allTasks = loadTasks();

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

    // Sort: overdue first, then by deadline
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

    const tasks = loadTasks();
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
    tasks.unshift(task);
    saveTasks(tasks);
    scheduleReminder(task);
    taskForm.reset();
    taskPriority.value = 'medium';
    taskStatus.value = 'todo';
    taskReminder.value = '30';
    render();
    showToast('Task berhasil ditambahkan!');
  });

  taskList.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    const tasks = loadTasks();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return;

    if (btn.classList.contains('btn-delete')) {
      clearReminder(id);
      tasks.splice(idx, 1);
      saveTasks(tasks);
      render();
      showToast('Task dihapus.');
    } else if (btn.classList.contains('btn-start')) {
      tasks[idx].status = 'in-progress';
      saveTasks(tasks);
      scheduleReminder(tasks[idx]);
      render();
      showToast('Task dimulai!');
    } else if (btn.classList.contains('btn-done')) {
      tasks[idx].status = 'done';
      clearReminder(id);
      saveTasks(tasks);
      render();
      showToast('Task selesai!');
    } else if (btn.classList.contains('btn-todo')) {
      tasks[idx].status = 'todo';
      saveTasks(tasks);
      scheduleReminder(tasks[idx]);
      render();
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

  // ---- Init ----
  initTheme();
  loadTasks().forEach(scheduleReminder);
  render();
})();
