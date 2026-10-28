'use strict';

const state = { data: null, month: null, editingDate: null };

const PUNCH_ERRORS = {
  already_in: '今天已经打过上班卡了',
  not_clocked_in: '还没有上班打卡',
  next_day_conflict: '有未完成的打卡记录，请先补录下班',
  invalid_type: '无效的打卡操作',
  bad_request: '请求有误，请刷新后重试',
};

const TOAST_MS = 3000;

let toastTimer = null;

const els = {
  toast: document.getElementById('toast'),
  loginView: document.getElementById('login-view'),
  loginForm: document.getElementById('login-form'),
  loginPassword: document.getElementById('login-password'),
  loginError: document.getElementById('login-error'),
  mainView: document.getElementById('main-view'),
  periodRange: document.getElementById('period-range'),
  periodTotal: document.getElementById('period-total'),
  todayOt: document.getElementById('today-ot'),
  btnIn: document.getElementById('btn-in'),
  btnOut: document.getElementById('btn-out'),
  settingsBtn: document.getElementById('settings-btn'),
  calTitle: document.getElementById('cal-title'),
  calPrev: document.getElementById('cal-prev'),
  calNext: document.getElementById('cal-next'),
  calGrid: document.getElementById('cal-grid'),
};

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDuration(totalMinutes) {
  const minutes = Math.max(0, Number(totalMinutes) || 0);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0 && rest > 0) return `${hours}小时${rest}分`;
  if (hours > 0) return `${hours}小时`;
  return `${rest}分`;
}

function cellDuration(totalMinutes) {
  const minutes = Math.max(0, Number(totalMinutes) || 0);
  return `${Math.floor(minutes / 60)}:${pad2(minutes % 60)}`;
}

function formatMonthDay(date) {
  const [, month, day] = date.split('-').map(Number);
  return `${month}月${day}日`;
}

function formatMonthTitle(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return `${year}年${monthNumber}月`;
}

function weekdayMon(date) {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function shiftMonth(month, delta) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
}

function showToast(message, kind = '') {
  if (!els.toast) return;
  if (toastTimer) clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.remove('success', 'error');
  if (kind) els.toast.classList.add(kind);
  els.toast.classList.add('show');
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
    toastTimer = null;
  }, TOAST_MS);
}

function showLogin() {
  els.mainView.hidden = true;
  els.loginView.hidden = false;
}

function showMain() {
  els.loginView.hidden = true;
  els.mainView.hidden = false;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers,
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.status === 401) {
    showLogin();
    throw { status: 401, error: body?.error || 'unauthorized' };
  }

  if (!response.ok) {
    throw { status: response.status, error: body?.error || 'unknown_error' };
  }

  return body;
}

async function load(month = state.month) {
  const query = month ? `?month=${encodeURIComponent(month)}` : '';
  try {
    state.data = await api(`/api/bootstrap${query}`);
    state.month = state.data.view.month;
    render();
    showMain();
  } catch (error) {
    if (error.status === 401) return;
    showToast('加载失败，请稍后重试', 'error');
  }
}

function renderPunch(punch, today) {
  const inAt = today?.inAt ?? null;
  const outAt = today?.outAt ?? null;
  const delayedOut = punch.delayedOutDate;

  els.btnIn.textContent = inAt ? `上班 ${inAt}` : '上班';
  els.btnIn.disabled = !punch.canIn;

  els.btnOut.classList.toggle('is-delayed', Boolean(delayedOut));
  if (delayedOut) {
    els.btnOut.textContent = '昨天 下班';
  } else {
    els.btnOut.textContent = outAt ? `下班 ${outAt}` : '下班';
  }
  els.btnOut.disabled = !punch.canOut;
}

function renderCalendar(data) {
  const { view, now } = data;
  const grid = els.calGrid;

  grid.textContent = '';
  els.calTitle.textContent = formatMonthTitle(view.month);

  for (const label of ['一', '二', '三', '四', '五', '六', '日']) {
    const weekday = document.createElement('div');
    weekday.className = 'cal-weekday';
    weekday.textContent = label;
    grid.appendChild(weekday);
  }

  const firstDay = view.days[0];
  if (!firstDay) return;

  const offset = weekdayMon(firstDay.date) - 1;
  for (let index = 0; index < offset; index += 1) {
    const blank = document.createElement('div');
    blank.className = 'cal-blank';
    blank.setAttribute('aria-hidden', 'true');
    grid.appendChild(blank);
  }

  const { start, end } = view.period;

  for (const day of view.days) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-cell';
    cell.dataset.date = day.date;

    if (day.date < start || day.date > end) cell.classList.add('dim');
    if (day.date === now.date) cell.classList.add('today');
    if (day.type === 'rest') cell.classList.add('rest');
    if (day.overtimeMinutes > 0) cell.classList.add('has-ot');

    const number = document.createElement('span');
    number.className = 'cal-day';
    number.textContent = String(Number(day.date.slice(8, 10)));
    cell.appendChild(number);

    if (day.overtimeMinutes > 0) {
      const overtime = document.createElement('span');
      overtime.className = 'cal-ot';
      overtime.textContent = cellDuration(day.overtimeMinutes);
      cell.appendChild(overtime);
    }

    if (day.incomplete) {
      const dot = document.createElement('span');
      dot.className = 'cal-dot';
      dot.setAttribute('aria-label', '记录不完整');
      cell.appendChild(dot);
    }

    if (day.holidayName) cell.title = day.holidayName;

    grid.appendChild(cell);
  }
}

function render() {
  const { data } = state;
  if (!data) return;

  const { view, today, punch } = data;

  els.periodRange.textContent = `${formatMonthDay(view.period.start)}–${formatMonthDay(view.period.end)}`;
  els.periodTotal.textContent = formatDuration(view.period.totalMinutes);
  els.todayOt.textContent = `今天 +${formatDuration(today?.overtimeMinutes ?? 0)}`;

  renderPunch(punch, today);
  renderCalendar(data);
}

async function doPunch(type) {
  try {
    const data = await api('/api/punch', {
      method: 'POST',
      body: JSON.stringify({ type }),
    });
    state.data = data;
    state.month = data.view.month;
    render();
    showToast(type === 'in' ? '上班打卡成功' : '下班打卡成功', 'success');
  } catch (error) {
    if (error.status === 401) return;
    showToast(PUNCH_ERRORS[error.error] || '操作失败，请稍后重试', 'error');
  }
}

async function onLogin(event) {
  event.preventDefault();
  els.loginError.textContent = '';

  const password = els.loginPassword.value;
  if (!password) {
    els.loginError.textContent = '请输入密码';
    return;
  }

  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    els.loginPassword.value = '';
    state.month = null;
    await load();
  } catch (error) {
    if (error.status === 401) {
      els.loginError.textContent = '密码错误，请重试';
    } else if (error.status === 429) {
      els.loginError.textContent = '尝试次数过多，请稍后再试';
    } else if (error.status === 503) {
      els.loginError.textContent = '尚未配置密码，请联系管理员';
    } else {
      els.loginError.textContent = '登录失败，请稍后重试';
    }
  }
}

function bindEvents() {
  els.loginForm.addEventListener('submit', onLogin);
  els.btnIn.addEventListener('click', () => doPunch('in'));
  els.btnOut.addEventListener('click', () => doPunch('out'));
  els.settingsBtn.addEventListener('click', () => showToast('设置功能即将上线'));
  els.calPrev.addEventListener('click', () => {
    if (!state.month) return;
    load(shiftMonth(state.month, -1));
  });
  els.calNext.addEventListener('click', () => {
    if (!state.month) return;
    load(shiftMonth(state.month, 1));
  });
}

bindEvents();
load();
