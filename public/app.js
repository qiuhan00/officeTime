'use strict';

const state = {
  data: null,
  month: null,
  editingDate: null,
  editingDay: null,
  editingRest: null,
  editingIn: null,
  editingOut: null,
  pickerKind: null,
};

const ERROR_MESSAGES = {
  already_in: '今天已经打过上班卡了',
  not_clocked_in: '还没有上班打卡',
  next_day_conflict: '次日已有记录，请先处理次日记录',
  invalid_type: '无效的打卡操作',
  bad_request: '请求有误，请刷新后重试',
  invalid_date: '日期格式无效',
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

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const HOLIDAY_DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

const TOAST_MS = 3000;
const WHEEL_ITEM_HEIGHT = 38;
const TOKEN_KEY = 'overtime-token';

let toastTimer = null;
let activeDialog = null;
let dialogReturnFocus = null;

const els = {
  app: document.querySelector('.app'),
  toast: document.getElementById('toast'),
  loginView: document.getElementById('login-view'),
  loginForm: document.getElementById('login-form'),
  loginPassword: document.getElementById('login-password'),
  loginRemember: document.getElementById('login-remember'),
  loginError: document.getElementById('login-error'),
  mainView: document.getElementById('main-view'),
  periodRange: document.getElementById('period-range'),
  periodTotal: document.getElementById('period-total'),
  todayOt: document.getElementById('today-ot'),
  punchRow: document.querySelector('.punch-row'),
  btnIn: document.getElementById('btn-in'),
  btnOut: document.getElementById('btn-out'),
  punchDone: document.getElementById('punch-done'),
  settingsBtn: document.getElementById('settings-btn'),
  calTitle: document.getElementById('cal-title'),
  calPrev: document.getElementById('cal-prev'),
  calNext: document.getElementById('cal-next'),
  calGrid: document.getElementById('cal-grid'),
  sheetBackdrop: document.getElementById('sheet-backdrop'),
  daySheet: document.getElementById('day-sheet'),
  sheetTitle: document.getElementById('sheet-title'),
  sheetSub: document.getElementById('sheet-sub'),
  sheetFields: document.getElementById('sheet-fields'),
  sheetIn: document.getElementById('sheet-in'),
  sheetOut: document.getElementById('sheet-out'),
  rowIn: document.getElementById('row-in'),
  rowOut: document.getElementById('row-out'),
  timePicker: document.getElementById('time-picker'),
  pickerTitle: document.getElementById('picker-title'),
  wheelHour: document.getElementById('wheel-hour'),
  wheelMinute: document.getElementById('wheel-minute'),
  pickerOk: document.getElementById('picker-ok'),
  pickerCancel: document.getElementById('picker-cancel'),
  pickerClear: document.getElementById('picker-clear'),
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
  setLoginRequired: document.getElementById('set-login-required'),
  loginRequiredWarning: document.getElementById('login-required-warning'),
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

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage can be unavailable in private modes; the cookie still works.
  }
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

function shiftDate(date, delta) {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

function shiftMonth(month, delta) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
}

function weekdayLabel(date) {
  return WEEKDAY_LABELS[weekdayMon(date) - 1];
}

function formatChineseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!match) return '';
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`;
}

function formatChineseTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const parts = {};
  for (const part of HOLIDAY_DATE_FORMATTER.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return `${parts.year}年${Number(parts.month)}月${Number(parts.day)}日`;
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
  els.mainView.hidden = true;
  closeDaySheet();
  closeSettings();
  els.loginView.hidden = false;
}

function showMain() {
  els.loginView.hidden = true;
  els.mainView.hidden = false;
}

function setBackgroundInert(inert) {
  if (!els.app) return;
  els.app.inert = inert;
  if (inert) {
    els.app.setAttribute('aria-hidden', 'true');
  } else {
    els.app.removeAttribute('aria-hidden');
  }
}

function focusableIn(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.disabled && element.getClientRects().length > 0,
  );
}

function activateDialog(dialog, opener = document.activeElement) {
  if (activeDialog === dialog) return;
  activeDialog = dialog;
  dialogReturnFocus = opener && opener !== document.body ? opener : null;
  setBackgroundInert(true);
  dialog.focus();
}

function deactivateDialog(dialog) {
  if (activeDialog !== dialog) return;
  activeDialog = null;
  setBackgroundInert(false);

  const target = dialogReturnFocus;
  dialogReturnFocus = null;
  if (target && target.isConnected && target.offsetParent !== null) {
    target.focus();
  }
}

function closeActiveDialog() {
  if (activeDialog === els.daySheet) closeDaySheet();
  else if (activeDialog === els.settingsPanel) closeSettings();
}

function onDocumentKeydown(event) {
  if (!activeDialog) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    if (activeDialog === els.daySheet && state.pickerKind) {
      closeTimePicker();
      return;
    }
    closeActiveDialog();
    return;
  }

  if (event.key !== 'Tab') return;

  const focusables = focusableIn(activeDialog);
  if (focusables.length === 0) {
    event.preventDefault();
    activeDialog.focus();
    return;
  }

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const current = document.activeElement;

  if (current === activeDialog || !activeDialog.contains(current)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }

  if (event.shiftKey && current === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && current === last) {
    event.preventDefault();
    first.focus();
  }
}

async function api(path, options = {}) {
  const { noAuthRedirect = false, ...init } = options;
  const headers = { ...(init.headers || {}) };
  if (init.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const token = readToken();
  if (token) headers.Authorization = `Bearer ${token}`;

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
    storeToken(null);
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

function renderPunch(punch, today, now) {
  const inAt = today?.inAt ?? null;
  const outAt = today?.outAt ?? null;
  const delayedOut = punch.delayedOutDate;
  const complete = Boolean(inAt && outAt && !delayedOut);

  els.punchRow.classList.toggle('is-complete', complete);
  els.btnIn.hidden = complete;
  els.btnOut.hidden = complete;
  if (els.punchDone) els.punchDone.hidden = !complete;

  if (complete) return;

  els.btnIn.textContent = inAt ? `上班 ${inAt}` : '上班';
  els.btnIn.disabled = !punch.canIn;

  els.btnOut.classList.toggle('is-delayed', Boolean(delayedOut));
  if (delayedOut) {
    const yesterday = now?.date ? shiftDate(now.date, -1) : null;
    els.btnOut.textContent = delayedOut === yesterday
      ? '昨天 下班'
      : `${formatMonthDay(delayedOut)} 下班`;
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

    if (day.inAt || day.outAt) {
      const kind = day.incomplete ? 'incomplete' : day.overtimeMinutes > 0 ? 'ot' : 'ok';
      const label = kind === 'incomplete' ? '记录不完整' : kind === 'ot' ? '有加班' : '正常出勤';
      const dot = document.createElement('span');
      dot.className = `cal-dot cal-dot-${kind}`;
      dot.setAttribute('aria-label', label);
      dot.title = label;
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
  els.todayOt.textContent = `今日 +${cellDuration(today?.overtimeMinutes ?? 0)}`;

  renderPunch(punch, today, data.now);
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
  const coverageMin = formatChineseDate(holiday?.coverageMin);
  const coverageMax = formatChineseDate(holiday?.coverageMax);

  if (!coverageMin || !coverageMax) {
    els.holidayMeta.textContent = '暂无数据';
    return;
  }

  const updated = formatChineseTimestamp(holiday.updatedAt);
  const suffix = holiday.bundled
    ? ' · 内置快照'
    : updated
      ? ` · 最后更新 ${updated}`
      : ' · 最后更新 暂无数据';
  els.holidayMeta.textContent = `数据覆盖 ${coverageMin} – ${coverageMax}${suffix}`;
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
  els.setLoginRequired.checked = settings.loginRequired !== false;
  updateLoginWarning();
}

function updateLoginWarning() {
  els.loginRequiredWarning.hidden = els.setLoginRequired.checked;
}

function openSettings() {
  if (!state.data) return;
  populateSettings();
  renderHolidayMeta();
  els.setPasswordOld.value = '';
  els.setPasswordNew.value = '';
  els.settingsPanel.hidden = false;
  activateDialog(els.settingsPanel);
}

function closeSettings() {
  els.settingsPanel.hidden = true;
  deactivateDialog(els.settingsPanel);
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

  const hasOverride = day.isRest === 0 || day.isRest === 1;
  let type;
  let holidayName = null;

  if (state.editingRest === 1) {
    type = 'rest';
  } else if (state.editingRest === 0) {
    type = 'work';
  } else {
    type = day.baseType ?? day.type;
    holidayName = hasOverride ? null : (day.baseHolidayName ?? day.holidayName);
  }

  const resetting = state.editingRest === null && hasOverride;
  const typeLabel = type === 'rest' ? '休息日' : '工作日';
  const label = resetting ? `按设置 · ${typeLabel}` : (holidayName || typeLabel);
  const overtimeStart = state.data?.settings?.overtimeStart;
  const rule = type === 'rest'
    ? '全天算加班'
    : overtimeStart
      ? `${overtimeStart} 后算加班`
      : '按设置算加班';
  els.sheetSub.textContent = `${label} · ${rule}`;
}

function updateRestUi() {
  els.sheetRest.textContent = restLabel(state.editingRest);
  els.sheetResetRest.hidden = state.editingRest === null;
  updateSheetSub();
}

function renderTimeRows() {
  for (const [value, valueEl, row] of [
    [state.editingIn, els.sheetIn, els.rowIn],
    [state.editingOut, els.sheetOut, els.rowOut],
  ]) {
    valueEl.textContent = value ?? '';
    const hint = row.querySelector('.sheet-row-empty');
    if (hint) hint.hidden = value != null;
  }
}

function fillWheel(wheel, count) {
  if (wheel.childElementCount > 0) return;
  for (let index = 0; index < count; index += 1) {
    const item = document.createElement('div');
    item.className = 'wheel-item';
    item.setAttribute('role', 'option');
    item.textContent = pad2(index);
    wheel.appendChild(item);
  }
}

function wheelIndex(wheel) {
  const max = wheel.childElementCount - 1;
  const index = Math.round(wheel.scrollTop / WHEEL_ITEM_HEIGHT);
  return Math.min(max, Math.max(0, index));
}

function updateWheelHighlight(wheel) {
  const index = wheelIndex(wheel);
  Array.from(wheel.children).forEach((item, itemIndex) => {
    const active = itemIndex === index;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-selected', String(active));
  });
}

function selectWheelValue(wheel, value) {
  wheel.scrollTop = value * WHEEL_ITEM_HEIGHT;
  updateWheelHighlight(wheel);
}

function openTimePicker(kind) {
  if (!state.editingDate) return;
  const current = kind === 'in' ? state.editingIn : state.editingOut;
  const [hour, minute] = current ? current.split(':').map(Number) : kind === 'in' ? [9, 0] : [18, 0];

  state.pickerKind = kind;
  els.daySheet.classList.add('is-picking');
  els.sheetFields.hidden = true;
  els.timePicker.hidden = false;
  els.pickerTitle.textContent = `${formatMonthDay(state.editingDate)} ${weekdayLabel(state.editingDate)} · ${kind === 'in' ? '上班时间' : '下班时间'}`;
  fillWheel(els.wheelHour, 24);
  fillWheel(els.wheelMinute, 60);
  requestAnimationFrame(() => {
    selectWheelValue(els.wheelHour, hour);
    selectWheelValue(els.wheelMinute, minute);
    els.wheelHour.focus();
  });
}

function closeTimePicker({ restoreFocus = true } = {}) {
  const kind = state.pickerKind;
  state.pickerKind = null;
  els.daySheet.classList.remove('is-picking');
  els.timePicker.hidden = true;
  els.sheetFields.hidden = false;
  if (restoreFocus && kind) {
    (kind === 'in' ? els.rowIn : els.rowOut).focus();
  }
}

function confirmTimePicker({ clear = false } = {}) {
  const kind = state.pickerKind;
  if (!kind) return;
  const value = clear
    ? null
    : `${pad2(wheelIndex(els.wheelHour))}:${pad2(wheelIndex(els.wheelMinute))}`;
  if (kind === 'in') state.editingIn = value;
  else state.editingOut = value;
  renderTimeRows();
  closeTimePicker();
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
  state.editingIn = day.inAt ?? null;
  state.editingOut = day.outAt ?? null;
  state.pickerKind = null;
  els.daySheet.classList.remove('is-picking');
  els.timePicker.hidden = true;
  els.sheetFields.hidden = false;

  els.sheetTitle.textContent = `${formatMonthDay(date)} ${weekdayLabel(date)}`;
  renderTimeRows();
  els.sheetDelete.disabled = !(day.inAt || day.outAt || day.isRest !== null);
  updateRestUi();

  els.sheetBackdrop.hidden = false;
  els.daySheet.hidden = false;
  activateDialog(els.daySheet);
}

function closeDaySheet() {
  els.daySheet.hidden = true;
  els.sheetBackdrop.hidden = true;
  state.pickerKind = null;
  els.daySheet.classList.remove('is-picking');
  els.timePicker.hidden = true;
  els.sheetFields.hidden = false;
  deactivateDialog(els.daySheet);
  state.editingDate = null;
  state.editingDay = null;
  state.editingRest = null;
  state.editingIn = null;
  state.editingOut = null;
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
  const inAt = state.editingIn;
  const outAt = state.editingOut;
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
  if (!state.editingDate || els.sheetDelete.disabled) return;
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
  const loginRequired = els.setLoginRequired.checked;
  const query = viewMonth ? `?month=${encodeURIComponent(viewMonth)}` : '';

  els.settingsSave.disabled = true;
  try {
    const data = await api(`/api/settings${query}`, {
      method: 'PUT',
      body: JSON.stringify({ periodStartDay, overtimeStart, workdays, autoHoliday, loginRequired }),
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
    const result = await api('/api/password', {
      method: 'POST',
      noAuthRedirect: true,
      body: JSON.stringify({ oldPassword, newPassword }),
    });
    storeToken(result?.token ?? null);
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
  storeToken(null);
  els.loginPassword.value = '';
  els.loginError.textContent = '';
  showLogin();
}

let punchInFlight = false;

async function doPunch(type) {
  if (punchInFlight) return;
  punchInFlight = true;

  const viewMonth = state.month;
  els.btnIn.disabled = true;
  els.btnOut.disabled = true;

  try {
    const data = await api('/api/punch', {
      method: 'POST',
      body: JSON.stringify({ type }),
    });
    await adoptBootstrap(data, viewMonth);
    showToast(type === 'in' ? '上班打卡成功' : '下班打卡成功', 'success');
  } catch (error) {
    if (error.status === 401) return;
    showToast(errorMessage(error), 'error');
  } finally {
    punchInFlight = false;
    if (state.data) {
      renderPunch(state.data.punch, state.data.today, state.data.now);
    } else {
      els.btnIn.disabled = false;
      els.btnOut.disabled = false;
    }
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
    const remember = els.loginRemember.checked;
    const result = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ password, remember }),
    });
    storeToken(remember ? result?.token ?? null : null);
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
  els.rowIn.addEventListener('click', () => openTimePicker('in'));
  els.rowOut.addEventListener('click', () => openTimePicker('out'));
  els.pickerOk.addEventListener('click', () => confirmTimePicker());
  els.pickerCancel.addEventListener('click', () => closeTimePicker());
  els.pickerClear.addEventListener('click', () => confirmTimePicker({ clear: true }));
  for (const wheel of [els.wheelHour, els.wheelMinute]) {
    wheel.addEventListener('scroll', () => updateWheelHighlight(wheel), { passive: true });
    wheel.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      wheel.scrollTop = (wheelIndex(wheel) + step) * WHEEL_ITEM_HEIGHT;
      updateWheelHighlight(wheel);
    });
  }

  els.settingsClose.addEventListener('click', closeSettings);
  els.settingsSave.addEventListener('click', saveSettings);
  els.holidayRefresh.addEventListener('click', refreshHolidays);
  els.setLoginRequired.addEventListener('change', updateLoginWarning);
  els.setPasswordSave.addEventListener('click', savePassword);
  els.logout.addEventListener('click', logout);
  document.addEventListener('keydown', onDocumentKeydown);
}

bindEvents();
load();
