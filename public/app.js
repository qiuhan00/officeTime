'use strict';

const state = {
  data: null,
  month: null,
  editingDate: null,
  editingDay: null,
  editingRest: null,
};

const ERROR_MESSAGES = {
  already_in: '今天已经打过上班卡了',
  not_clocked_in: '还没有上班打卡',
  next_day_conflict: '有未完成的打卡记录，请先补录下班',
  invalid_type: '无效的打卡操作',
  bad_request: '请求有误，请刷新后重试',
  invalid_date: '日期无效，不能修改未来日期',
  invalid_time: '时间格式无效',
  future_time: '不能填晚于现在的时间',
  invalid_rest: '休息日设置无效',
  invalid_month: '月份无效',
  invalid_settings: '设置无效，请检查输入',
  weak_password: '新密码至少 8 位',
  bad_password: '原密码错误',
  not_configured: '尚未配置密码，请联系管理员',
  refresh_failed: '更新失败，继续使用现有数据',
  unauthorized: '登录已失效，请重新登录',
};

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

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
  sheetBackdrop: document.getElementById('sheet-backdrop'),
  daySheet: document.getElementById('day-sheet'),
  sheetTitle: document.getElementById('sheet-title'),
  sheetSub: document.getElementById('sheet-sub'),
  sheetIn: document.getElementById('sheet-in'),
  sheetOut: document.getElementById('sheet-out'),
  sheetRest: document.getElementById('sheet-rest'),
  sheetResetRest: document.getElementById('sheet-reset-rest'),
  sheetSave: document.getElementById('sheet-save'),
  sheetClose: document.getElementById('sheet-close'),
  sheetDelete: document.getElementById('sheet-delete'),
  settingsPanel: document.getElementById('settings-panel'),
  settingsClose: document.getElementById('settings-close'),
  settingsSave: document.getElementById('settings-save'),
  setPeriodStart: document.getElementById('set-period-start'),
  setOvertimeStart: document.getElementById('set-overtime-start'),
  setWorkdays: document.getElementById('set-workdays'),
  setAutoHoliday: document.getElementById('set-auto-holiday'),
  holidayMeta: document.getElementById('holiday-meta'),
  holidayRefresh: document.getElementById('holiday-refresh'),
  setPasswordOld: document.getElementById('set-password-old'),
  setPasswordNew: document.getElementById('set-password-new'),
  setPasswordSave: document.getElementById('set-password-save'),
  logout: document.getElementById('logout'),
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

function weekdayLabel(date) {
  return WEEKDAY_LABELS[weekdayMon(date) - 1];
}

function isoDate(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
}

function errorMessage(error, fallback = '操作失败，请稍后重试') {
  return ERROR_MESSAGES[error?.error] || fallback;
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
  closeDaySheet();
  closeSettings();
  els.mainView.hidden = true;
  els.loginView.hidden = false;
}

function showMain() {
  els.loginView.hidden = true;
  els.mainView.hidden = false;
}

async function api(path, options = {}) {
  const { noAuthRedirect = false, ...init } = options;
  const headers = { ...(init.headers || {}) };
  if (init.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers,
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.status === 401 && !noAuthRedirect) {
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
  renderHolidayMeta();
}

async function adoptBootstrap(data, viewMonth) {
  if (viewMonth && data.view.month !== viewMonth) {
    await load(viewMonth);
    return;
  }
  state.data = data;
  state.month = data.view.month;
  render();
}

function renderHolidayMeta() {
  const holiday = state.data?.holiday;
  if (!holiday || !holiday.coverageMin || !holiday.coverageMax) {
    els.holidayMeta.textContent = '暂无数据';
    return;
  }
  const updated = isoDate(holiday.updatedAt);
  const suffix = updated ? ` · 最后更新 ${updated}` : ' · 最后更新 暂无数据';
  els.holidayMeta.textContent = `数据覆盖 ${holiday.coverageMin} – ${holiday.coverageMax}${suffix}`;
}

function buildWeekdays() {
  els.setWorkdays.textContent = '';
  WEEKDAY_LABELS.forEach((label, index) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'weekday';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = String(index + 1);

    const text = document.createElement('span');
    text.textContent = label;

    wrapper.append(checkbox, text);
    els.setWorkdays.appendChild(wrapper);
  });
}

function workdayCheckboxes() {
  return Array.from(els.setWorkdays.querySelectorAll('input[type="checkbox"]'));
}

function populateSettings() {
  const settings = state.data?.settings;
  if (!settings) return;

  els.setPeriodStart.value = String(settings.periodStartDay);
  els.setOvertimeStart.value = settings.overtimeStart;

  const workdays = new Set(settings.workdays);
  for (const checkbox of workdayCheckboxes()) {
    checkbox.checked = workdays.has(Number(checkbox.value));
  }
  els.setAutoHoliday.checked = Boolean(settings.autoHoliday);
}

function openSettings() {
  if (!state.data) return;
  populateSettings();
  renderHolidayMeta();
  els.setPasswordOld.value = '';
  els.setPasswordNew.value = '';
  els.settingsPanel.hidden = false;
}

function closeSettings() {
  els.settingsPanel.hidden = true;
}

function findDay(date) {
  return state.data?.view.days.find((day) => day.date === date) ?? null;
}

function restLabel(isRest) {
  if (isRest === 1) return '休息日';
  if (isRest === 0) return '工作日';
  return '按设置（工作日/休息日）';
}

function updateSheetSub() {
  const day = state.editingDay;
  if (!day) return;

  let type;
  let holidayName = null;

  if (state.editingRest === 1) {
    type = 'rest';
  } else if (state.editingRest === 0) {
    type = 'work';
  } else if (day.isRest === null || day.isRest === undefined) {
    type = day.type;
    holidayName = day.holidayName;
  } else {
    const workdays = state.data?.settings?.workdays ?? [];
    type = workdays.includes(weekdayMon(day.date)) ? 'work' : 'rest';
  }

  const label = holidayName || (type === 'rest' ? '休息日' : '工作日');
  const overtimeStart = state.data?.settings?.overtimeStart ?? '19:00';
  const rule = type === 'rest' ? '全天算加班' : `${overtimeStart} 后算加班`;
  els.sheetSub.textContent = `${label} · ${rule}`;
}

function updateRestUi() {
  els.sheetRest.textContent = restLabel(state.editingRest);
  els.sheetResetRest.hidden = state.editingRest === null;
  updateSheetSub();
}

function updateEmptyHints() {
  for (const input of [els.sheetIn, els.sheetOut]) {
    const hint = input.parentElement?.querySelector('.sheet-row-empty');
    if (hint) hint.hidden = input.value !== '';
  }
}

function openDaySheet(date) {
  const data = state.data;
  if (!data) return;

  if (date > data.now.date) {
    showToast('不能修改未来日期', 'error');
    return;
  }

  const day = findDay(date);
  if (!day) return;

  state.editingDate = date;
  state.editingDay = day;
  state.editingRest = day.isRest ?? null;

  els.sheetTitle.textContent = `${formatMonthDay(date)} ${weekdayLabel(date)}`;
  els.sheetIn.value = day.inAt ?? '';
  els.sheetOut.value = day.outAt ?? '';
  updateRestUi();
  updateEmptyHints();

  els.sheetBackdrop.hidden = false;
  els.daySheet.hidden = false;
}

function closeDaySheet() {
  els.daySheet.hidden = true;
  els.sheetBackdrop.hidden = true;
  state.editingDate = null;
  state.editingDay = null;
  state.editingRest = null;
}

function cycleRest() {
  if (state.editingRest === null) state.editingRest = 1;
  else if (state.editingRest === 1) state.editingRest = 0;
  else state.editingRest = null;
  updateRestUi();
}

function resetRest() {
  state.editingRest = null;
  updateRestUi();
}

async function saveDay() {
  if (!state.editingDate) return;

  const date = state.editingDate;
  const viewMonth = state.month;
  const inAt = els.sheetIn.value || null;
  const outAt = els.sheetOut.value || null;
  const isRest = state.editingRest;

  els.sheetSave.disabled = true;
  try {
    const data = await api(`/api/days/${encodeURIComponent(date)}`, {
      method: 'PUT',
      body: JSON.stringify({ inAt, outAt, isRest }),
    });
    closeDaySheet();
    await adoptBootstrap(data, viewMonth);
    showToast('记录已保存', 'success');
  } catch (error) {
    if (error.status !== 401) {
      showToast(errorMessage(error, '保存失败，请稍后重试'), 'error');
    }
  } finally {
    els.sheetSave.disabled = false;
  }
}

async function deleteDay() {
  if (!state.editingDate) return;
  if (!window.confirm('确定删除这一天的记录吗？')) return;

  const date = state.editingDate;
  const viewMonth = state.month;

  els.sheetDelete.disabled = true;
  try {
    const data = await api(`/api/days/${encodeURIComponent(date)}`, { method: 'DELETE' });
    closeDaySheet();
    await adoptBootstrap(data, viewMonth);
    showToast('记录已删除', 'success');
  } catch (error) {
    if (error.status !== 401) {
      showToast(errorMessage(error, '删除失败，请稍后重试'), 'error');
    }
  } finally {
    els.sheetDelete.disabled = false;
  }
}

async function saveSettings() {
  const viewMonth = state.month;
  const periodStartDay = Number(els.setPeriodStart.value);
  const overtimeStart = els.setOvertimeStart.value;
  const workdays = workdayCheckboxes()
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => Number(checkbox.value))
    .sort((a, b) => a - b);
  const autoHoliday = els.setAutoHoliday.checked;
  const query = viewMonth ? `?month=${encodeURIComponent(viewMonth)}` : '';

  els.settingsSave.disabled = true;
  try {
    const data = await api(`/api/settings${query}`, {
      method: 'PUT',
      body: JSON.stringify({ periodStartDay, overtimeStart, workdays, autoHoliday }),
    });
    await adoptBootstrap(data, viewMonth);
    populateSettings();
    showToast('设置已保存', 'success');
  } catch (error) {
    if (error.status !== 401) {
      showToast(errorMessage(error, '保存失败，请稍后重试'), 'error');
    }
  } finally {
    els.settingsSave.disabled = false;
  }
}

async function refreshHolidays() {
  if (els.holidayRefresh.disabled) return;

  els.holidayRefresh.disabled = true;
  const originalLabel = els.holidayRefresh.textContent;
  els.holidayRefresh.textContent = '更新中…';

  try {
    const result = await api('/api/holidays/refresh', { method: 'POST' });
    if (state.data) state.data.holiday = result.holiday;
    renderHolidayMeta();
    showToast('节假日数据已更新', 'success');
    await load(state.month);
  } catch (error) {
    if (error.status !== 401) {
      showToast('更新失败，继续使用现有数据', 'error');
    }
  } finally {
    els.holidayRefresh.disabled = false;
    els.holidayRefresh.textContent = originalLabel;
  }
}

async function savePassword() {
  const oldPassword = els.setPasswordOld.value;
  const newPassword = els.setPasswordNew.value;

  els.setPasswordSave.disabled = true;
  try {
    await api('/api/password', {
      method: 'POST',
      noAuthRedirect: true,
      body: JSON.stringify({ oldPassword, newPassword }),
    });
    els.setPasswordOld.value = '';
    els.setPasswordNew.value = '';
    showToast('密码已修改', 'success');
  } catch (error) {
    if (error.error === 'unauthorized') {
      showLogin();
      return;
    }
    showToast(errorMessage(error, '密码修改失败，请稍后重试'), 'error');
  } finally {
    els.setPasswordSave.disabled = false;
  }
}

async function logout() {
  try {
    await api('/api/logout', { method: 'POST', noAuthRedirect: true });
  } catch {
    // Logging out is local-first; always return to the login view.
  }

  state.data = null;
  state.month = null;
  closeDaySheet();
  closeSettings();
  els.loginPassword.value = '';
  els.loginError.textContent = '';
  showLogin();
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
    showToast(errorMessage(error), 'error');
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
  buildWeekdays();

  els.loginForm.addEventListener('submit', onLogin);
  els.btnIn.addEventListener('click', () => doPunch('in'));
  els.btnOut.addEventListener('click', () => doPunch('out'));
  els.settingsBtn.addEventListener('click', openSettings);
  els.calPrev.addEventListener('click', () => {
    if (!state.month) return;
    load(shiftMonth(state.month, -1));
  });
  els.calNext.addEventListener('click', () => {
    if (!state.month) return;
    load(shiftMonth(state.month, 1));
  });
  els.calGrid.addEventListener('click', (event) => {
    const cell = event.target.closest('.cal-cell');
    if (!cell || !cell.dataset.date) return;
    openDaySheet(cell.dataset.date);
  });

  els.sheetClose.addEventListener('click', closeDaySheet);
  els.sheetBackdrop.addEventListener('click', closeDaySheet);
  els.sheetRest.addEventListener('click', cycleRest);
  els.sheetResetRest.addEventListener('click', resetRest);
  els.sheetSave.addEventListener('click', saveDay);
  els.sheetDelete.addEventListener('click', deleteDay);
  els.sheetIn.addEventListener('input', updateEmptyHints);
  els.sheetOut.addEventListener('input', updateEmptyHints);

  els.settingsClose.addEventListener('click', closeSettings);
  els.settingsSave.addEventListener('click', saveSettings);
  els.holidayRefresh.addEventListener('click', refreshHolidays);
  els.setPasswordSave.addEventListener('click', savePassword);
  els.logout.addEventListener('click', logout);
}

bindEvents();
load();
