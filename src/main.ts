import "./styles.css";
import { api, type Blur, type Settings, type Theme, type Todo, type View } from "./api";
import { getCurrentWindow } from "@tauri-apps/api/window";

const win = getCurrentWindow();

const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  document.querySelector<T>(sel) as T;

// ---- 状态 ----
let settings: Settings = {
  dataDir: "",
  theme: "system",
  blur: "acrylic",
  glassAlpha: null,
  onboarded: false,
  alwaysOnTop: true,
  windowX: null,
  windowY: null,
  windowW: null,
  windowH: null,
};
let todos: Todo[] = [];
let view: View = "daily";
let selectedDate = todayStr();
let todosSaveTimer: ReturnType<typeof setTimeout> | undefined;
let posSaveTimer: ReturnType<typeof setTimeout> | undefined;

// ---- 元素 ----
const listEl = $("#list");
const newInput = $<HTMLInputElement>("#new-input");
const dateRow = $("#date-row");
const dateLabel = $("#date-label");
const carryRow = $("#carry-row");
const carryBtn = $("#carry-btn");
const drawer = $("#drawer");
const todoDrawer = $("#todo-drawer");
const wallpaperEl = $("#wallpaper");
const calendarEl = $("#calendar");
const onboardingEl = $("#onboarding");

let editing: Todo | null = null;
let wallpaperUrl: string | null = null;
let obPendingDir: string | null = null;
let calY = 0;
let calM = 0; // 0-based month
let knownIds = new Set<string>();

const REDUCE_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

// ---- FLIP 过渡：仅 transform 合成器动画，不触发重排 ----
function captureRects(): Map<string, DOMRect> {
  const map = new Map<string, DOMRect>();
  if (REDUCE_MOTION.matches) return map;
  listEl.querySelectorAll<HTMLElement>("[data-flip-key]").forEach((el) => {
    map.set(el.dataset.flipKey as string, el.getBoundingClientRect());
  });
  return map;
}

function playFlip(before: Map<string, DOMRect>): void {
  if (REDUCE_MOTION.matches || before.size === 0) return;
  listEl.querySelectorAll<HTMLElement>("[data-flip-key]").forEach((el) => {
    const key = el.dataset.flipKey as string;
    const prev = before.get(key);
    if (!prev) return;
    const now = el.getBoundingClientRect();
    const dx = prev.left - now.left;
    const dy = prev.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    );
  });
}

function renderFlip(): void {
  const before = captureRects();
  render();
  playFlip(before);
}

// ---- 日期工具 ----
function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayStr(): string {
  return fmtDate(new Date());
}
function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return fmtDate(new Date(y, m - 1, d + n));
}
function humanDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const wd = new Date(y, m - 1, d).toLocaleDateString("zh-CN", { weekday: "short" });
  return `${m}月${d}日 ${wd}`;
}

// ---- 主题 / 磨砂 ----
function systemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function effDark(): boolean {
  return settings.theme === "dark" || (settings.theme === "system" && systemDark());
}
function applyThemeClass(): void {
  document.body.dataset.theme = settings.theme === "system" ? (systemDark() ? "dark" : "light") : settings.theme;
  document.body.dataset.blur = settings.blur;
  // 关闭磨砂时保底 90%，保证可读性；其余模式直接使用滑杆值
  const raw = settings.glassAlpha ?? 0.4;
  const eff = settings.blur === "none" ? Math.max(raw, 0.9) : raw;
  document.body.style.setProperty("--base-alpha", String(eff));
}

async function refreshBlur(): Promise<void> {
  const applied = await api.setBlur(settings.blur, settings.theme === "system" ? effDark() : settings.theme === "dark");
  if (applied !== settings.blur) {
    settings.blur = applied;
    applyThemeClass();
    await persistSettings();
  }
  await updateWallpaperLayer();
}

// ---- 自绘毛玻璃（壁纸模糊层）----
async function ensureWallpaper(): Promise<void> {
  if (wallpaperUrl !== null) return;
  try {
    wallpaperUrl = await api.getWallpaper();
  } catch {
    wallpaperUrl = null;
  }
}

function updateWallpaperLayer(): void {
  if (settings.blur !== "acrylic" || !wallpaperUrl) {
    wallpaperEl.style.display = "none";
    return;
  }
  wallpaperEl.style.display = "block";
  wallpaperEl.style.backgroundImage = `url("${wallpaperUrl}")`;
  void alignWallpaper();
}

// 壁纸按窗口在屏幕上的逻辑坐标反向对齐，挪动便签时模糊背景保持贴合
async function alignWallpaper(): Promise<void> {
  if (settings.blur !== "acrylic") return;
  try {
    const [pos, sf] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
    wallpaperEl.style.backgroundSize = `${window.screen.width}px ${window.screen.height}px`;
    wallpaperEl.style.backgroundPosition = `${-pos.x / sf}px ${-pos.y / sf}px`;
  } catch {
    /* ignore */
  }
}

let themeBusy = false;
async function setThemeMode(mode: Theme): Promise<void> {
  if (themeBusy || settings.theme === mode) return; // 忙时/同模式忽略，防止连点卡顿
  themeBusy = true;
  settings.theme = mode;
  applyThemeClass();
  try {
    await win.setTheme(mode === "system" ? null : mode);
  } catch {
    /* 忽略 */
  }
  await refreshBlur();
  await persistSettings();
  renderSettingsState();
  themeBusy = false;
}

// ---- 日历 ----
function openCalendar(): void {
  const [y, m, d] = selectedDate.split("-").map(Number);
  const base = selectedDate === todayStr() ? new Date() : new Date(y, m - 1, d);
  calY = base.getFullYear();
  calM = base.getMonth();
  calendarEl.classList.remove("hidden");
  renderCalendar();
}

function renderCalendar(): void {
  const startOffset = (new Date(calY, calM, 1).getDay() + 6) % 7; // 周一为第一列
  const daysInMonth = new Date(calY, calM + 1, 0).getDate();
  const daysInPrev = new Date(calY, calM, 0).getDate();
  const todoDates = new Set(todos.filter((t) => t.kind === "daily" && t.date).map((t) => t.date));
  const today = todayStr();
  let html = `<div class="cal-head">
    <button class="nav-btn" data-cal="prev" title="上个月">‹</button>
    <span class="cal-title">${calY}年${calM + 1}月</span>
    <button class="nav-btn" data-cal="next" title="下个月">›</button>
  </div><div class="cal-grid">`;
  for (const w of ["一", "二", "三", "四", "五", "六", "日"]) html += `<span class="cal-wd">${w}</span>`;
  for (let i = 0; i < 42; i++) {
    const dayNum = i - startOffset + 1;
    let cls = "cal-day";
    let txt: string;
    let dateStr: string | null = null;
    if (dayNum < 1) {
      txt = String(daysInPrev + dayNum);
      cls += " dim";
    } else if (dayNum > daysInMonth) {
      txt = String(dayNum - daysInMonth);
      cls += " dim";
    } else {
      txt = String(dayNum);
      dateStr = `${calY}-${pad(calM + 1)}-${pad(dayNum)}`;
      if (dateStr === today) cls += " today";
      if (dateStr === selectedDate) cls += " sel";
      if (todoDates.has(dateStr)) cls += " has";
    }
    html += `<button class="${cls}"${dateStr ? ` data-date="${dateStr}"` : ""}>${txt}${cls.includes("has") ? '<i class="cal-dot"></i>' : ""}</button>`;
  }
  html += `</div>`;
  calendarEl.innerHTML = html;
}

// ---- 持久化 ----
async function persistSettings(): Promise<void> {
  try {
    await api.saveSettings(settings);
  } catch (e) {
    console.error("保存设置失败", e);
  }
}

let settingsSaveTimer: ReturnType<typeof setTimeout> | undefined;
function persistSettingsSoon(): void {
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(() => void persistSettings(), 300);
}

function saveTodosSoon(): void {
  clearTimeout(todosSaveTimer);
  todosSaveTimer = setTimeout(() => {
    api.saveTodos(todos).catch((e) => console.error("保存待办失败", e));
  }, 250);
}

async function saveWindowPos(): Promise<void> {
  try {
    const pos = await win.outerPosition();
    const size = await win.innerSize();
    const sf = await win.scaleFactor();
    settings.windowX = pos.x;
    settings.windowY = pos.y;
    settings.windowW = Math.round(size.toLogical(sf).width);
    settings.windowH = Math.round(size.toLogical(sf).height);
    await persistSettings();
  } catch {
    /* 窗口可能正在关闭 */
  }
}

// ---- 数据操作 ----
function currentScope(): Todo[] {
  if (view === "daily") {
    return todos.filter((t) => t.kind === "daily" && t.date === selectedDate);
  }
  return todos.filter((t) => t.kind === "longterm");
}

function addTodo(): void {
  const content = newInput.value.trim();
  if (!content) return;
  todos.push({
    id: crypto.randomUUID(),
    kind: view,
    date: view === "daily" ? selectedDate : null,
    content,
    detail: null,
    done: false,
    createdAt: Date.now(),
    doneAt: null,
  });
  newInput.value = "";
  newInput.focus();
  saveTodosSoon();
  render();
}

function toggleTodo(t: Todo): void {
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  saveTodosSoon();
  renderFlip();
}

function deleteTodo(t: Todo): void {
  const el = listEl.querySelector<HTMLElement>(`.item[data-id="${t.id}"]`);
  if (!el || REDUCE_MOTION.matches) {
    todos = todos.filter((x) => x.id !== t.id);
    saveTodosSoon();
    render();
    return;
  }
  // 退出动画：右滑淡出 + 高度塌陷（一次性小元素动画），剩余项随后滑升补位
  el.style.overflow = "hidden";
  el.style.pointerEvents = "none";
  const anim = el.animate(
    [
      { opacity: 1, height: `${el.offsetHeight}px`, marginBottom: "7px", transform: "none" },
      { opacity: 0, height: "0px", marginBottom: "0px", transform: "translateX(28px)" },
    ],
    { duration: 190, easing: "cubic-bezier(0.4, 0, 0.2, 1)" }
  );
  anim.onfinish = () => {
    todos = todos.filter((x) => x.id !== t.id);
    saveTodosSoon();
    renderFlip();
  };
}

function clearDone(): void {
  const scope = currentScope().filter((t) => t.done);
  if (scope.length === 0) return;
  const ids = new Set(scope.map((t) => t.id));
  const els = [...listEl.querySelectorAll<HTMLElement>(".item")].filter((el) =>
    ids.has(el.dataset.id ?? "")
  );
  if (REDUCE_MOTION.matches || els.length === 0) {
    todos = todos.filter((t) => !ids.has(t.id));
    saveTodosSoon();
    render();
    return;
  }
  els.forEach((el, i) => {
    el.style.overflow = "hidden";
    el.style.pointerEvents = "none";
    el.animate(
      [
        { opacity: 1, height: `${el.offsetHeight}px`, marginBottom: "7px", transform: "none" },
        { opacity: 0, height: "0px", marginBottom: "0px", transform: "translateX(28px)" },
      ],
      { duration: 170, delay: i * 40, easing: "ease-out", fill: "forwards" }
    );
  });
  setTimeout(
    () => {
      todos = todos.filter((t) => !ids.has(t.id));
      saveTodosSoon();
      renderFlip();
    },
    170 + (els.length - 1) * 40 + 40
  );
}

function carryOverToToday(): void {
  const today = todayStr();
  let n = 0;
  for (const t of todos) {
    if (t.kind === "daily" && t.date === selectedDate && !t.done) {
      t.date = today;
      n++;
    }
  }
  if (n) {
    selectedDate = today;
    saveTodosSoon();
    render();
  }
}

// ---- 渲染 ----
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

function itemHtml(t: Todo, enter: boolean): string {
  return `<div class="item${t.done ? " done" : ""}${enter ? " enter" : ""}" data-id="${t.id}" data-flip-key="${t.id}">
    <button class="check" data-act="toggle" title="${t.done ? "标记为未完成" : "确认完成"}"></button>
    <span class="content" data-act="open" title="点击编辑详情">${esc(t.content)}</span>
    <button class="del" data-act="del" title="删除">✕</button>
  </div>`;
}

function render(): void {
  const isToday = selectedDate === todayStr();
  dateRow.classList.toggle("hidden", view === "longterm");
  dateLabel.textContent = isToday ? "今天" : humanDate(selectedDate);
  dateLabel.title = "点击打开日历";

  const scope = currentScope();
  const pending = scope.filter((t) => !t.done).sort((a, b) => a.createdAt - b.createdAt);
  const done = scope.filter((t) => t.done).sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0));

  // 进度条
  const progressRow = $("#progress-row");
  if (scope.length === 0) {
    progressRow.style.visibility = "hidden";
  } else {
    progressRow.style.visibility = "visible";
    const pct = Math.round((done.length / scope.length) * 100);
    $("#progress-fill").style.width = `${pct}%`;
    $("#progress-text").innerHTML =
      done.length === scope.length
        ? `<b>全部完成</b> 🎉`
        : `<b>${done.length}/${scope.length}</b> · ${pct}%`;
  }

  let html = "";
  for (const t of pending) html += itemHtml(t, !knownIds.has(t.id));
  if (done.length > 0) {
    html += `<div class="done-head" data-flip-key="done-head"><span>已完成 · ${done.length}</span><button class="clear-done" data-act="clear">清除</button></div>`;
    for (const t of done) html += itemHtml(t, !knownIds.has(t.id));
  }
  if (scope.length === 0) {
    html += `<div class="empty">${
      view === "longterm"
        ? "还没有长期待办<br>在下方输入，回车添加"
        : isToday
          ? "今天还没有待办<br>在下方输入，回车添加"
          : "这一天没有待办"
    }</div>`;
  }
  listEl.innerHTML = html;
  knownIds = new Set(scope.map((t) => t.id));

  const pastPending = view === "daily" && !isToday ? pending.length : 0;
  carryRow.classList.toggle("hidden", pastPending === 0);
  if (pastPending > 0) carryBtn.textContent = `把 ${pastPending} 项未完成移到今天`;
}

function renderSettingsState(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-theme-opt]").forEach((b) => {
    b.classList.toggle("active", b.dataset.themeOpt === settings.theme);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-blur-opt]").forEach((b) => {
    b.classList.toggle("active", b.dataset.blurOpt === settings.blur);
  });
  $("#top-switch").classList.toggle("on", settings.alwaysOnTop);
  const alpha = settings.glassAlpha ?? 0.4;
  $<HTMLInputElement>("#glass-alpha").value = String(Math.round(alpha * 100));
  $("#glass-alpha-val").textContent = `${Math.round(alpha * 100)}%`;
  const pathEl = $("#data-path");
  pathEl.textContent = settings.dataDir;
  pathEl.title = settings.dataDir;
}

// ---- 事件绑定 ----
// ---- 详情抽屉 ----
function fmtTs(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderDetailState(): void {
  if (!editing) return;
  const btn = $("#detail-done");
  btn.textContent = editing.done ? "取消完成" : "标记完成";
  $("#detail-meta").textContent =
    `${editing.kind === "daily" ? `每日 · ${editing.date}` : "长期"} · 创建于 ${fmtTs(editing.createdAt)}` +
    (editing.doneAt ? ` · 完成于 ${fmtTs(editing.doneAt)}` : "");
}

function openTodoDetail(t: Todo): void {
  editing = t;
  $<HTMLInputElement>("#detail-title").value = t.content;
  $<HTMLTextAreaElement>("#detail-text").value = t.detail ?? "";
  renderDetailState();
  todoDrawer.classList.remove("hidden");
  $<HTMLInputElement>("#detail-title").focus();
}

function closeTodoDetail(): void {
  editing = null;
  todoDrawer.classList.add("hidden");
}

function syncListItem(t: Todo): void {
  const span = listEl.querySelector<HTMLElement>(`.item[data-id="${t.id}"] .content`);
  if (span) span.textContent = t.content;
}

async function bindEvents(): Promise<void> {
  // 页签
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((b) => {
    b.addEventListener("click", () => {
      view = (b.dataset.view as View) ?? "daily";
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      render();
    });
  });

  // 日期导航
  $("#date-prev").addEventListener("click", () => {
    selectedDate = addDays(selectedDate, -1);
    render();
  });
  $("#date-next").addEventListener("click", () => {
    selectedDate = addDays(selectedDate, 1);
    render();
  });
  dateLabel.addEventListener("click", () => {
    if (calendarEl.classList.contains("hidden")) openCalendar();
    else calendarEl.classList.add("hidden");
  });

  // 日历事件委托
  calendarEl.addEventListener("click", (e) => {
    const nav = (e.target as HTMLElement).closest<HTMLElement>("[data-cal]");
    if (nav) {
      if (nav.dataset.cal === "prev") {
        calM--;
        if (calM < 0) { calM = 11; calY--; }
      } else {
        calM++;
        if (calM > 11) { calM = 0; calY++; }
      }
      renderCalendar();
      return;
    }
    const day = (e.target as HTMLElement).closest<HTMLElement>(".cal-day[data-date]");
    if (day) {
      selectedDate = day.dataset.date as string;
      calendarEl.classList.add("hidden");
      render();
    }
  });

  // 列表事件委托
  listEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "clear") {
      clearDone();
      return;
    }
    const item = btn.closest<HTMLElement>(".item");
    if (!item) return;
    const t = todos.find((x) => x.id === item.dataset.id);
    if (!t) return;
    if (act === "toggle") toggleTodo(t);
    else if (act === "del") deleteTodo(t);
    else if (act === "open") openTodoDetail(t);
  });

  // 添加
  $("#add-btn").addEventListener("click", addTodo);
  newInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addTodo();
  });

  // 顺延
  carryBtn.addEventListener("click", carryOverToToday);

  // 窗口按钮
  $("#btn-hide").addEventListener("click", () => void win.hide());
  $("#btn-settings").addEventListener("click", () => {
    drawer.classList.remove("hidden");
    renderSettingsState();
  });
  $("#drawer-close").addEventListener("click", () => drawer.classList.add("hidden"));
  $("#btn-theme").addEventListener("click", () => {
    // 直接在明暗间切换，保证每次点击都有可见变化；「跟随系统」在设置面板选择
    void setThemeMode(effDark() ? "light" : "dark");
  });

  // 设置面板
  document.querySelectorAll<HTMLButtonElement>("[data-theme-opt]").forEach((b) => {
    b.addEventListener("click", () => void setThemeMode(b.dataset.themeOpt as Theme));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-blur-opt]").forEach((b) => {
    b.addEventListener("click", () => {
      settings.blur = b.dataset.blurOpt as Blur;
      applyThemeClass();
      void (async () => {
        if (settings.blur === "acrylic") await ensureWallpaper();
        await refreshBlur();
        persistSettings();
        renderSettingsState();
      })();
    });
  });
  $<HTMLInputElement>("#glass-alpha").addEventListener("input", () => {
    const v = Number($<HTMLInputElement>("#glass-alpha").value); // 20~90
    settings.glassAlpha = v / 100;
    document.body.style.setProperty("--base-alpha", String(v / 100));
    $("#glass-alpha-val").textContent = `${v}%`;
    persistSettingsSoon();
  });
  $("#top-switch").addEventListener("click", () => {
    settings.alwaysOnTop = !settings.alwaysOnTop;
    void win.setAlwaysOnTop(settings.alwaysOnTop);
    void persistSettings();
    renderSettingsState();
  });
  $("#autostart-switch").addEventListener("click", () => {
    const btn = $("#autostart-switch");
    const on = !btn.classList.contains("on");
    api.setAutostart(on)
      .then(() => {
        btn.classList.toggle("on", on);
      })
      .catch(() => {
        /* 状态保持不变 */
      });
  });
  $("#pick-dir").addEventListener("click", () => {
    api.pickDataFolder()
      .then(async (dir) => {
        if (!dir) return;
        const newTodos = await api.changeDataDir(dir);
        settings.dataDir = dir;
        todos = newTodos;
        await persistSettings();
        renderSettingsState();
        render();
      })
      .catch((e) => console.error("更改存储位置失败", e));
  });
  $("#open-dir").addEventListener("click", () => void api.openDataFolder());

  // 待办详情抽屉
  $<HTMLInputElement>("#detail-title").addEventListener("input", () => {
    if (!editing) return;
    editing.content = $<HTMLInputElement>("#detail-title").value;
    syncListItem(editing);
    saveTodosSoon();
  });
  $<HTMLTextAreaElement>("#detail-text").addEventListener("input", () => {
    if (!editing) return;
    const v = $<HTMLTextAreaElement>("#detail-text").value;
    editing.detail = v.trim() ? v : null;
    saveTodosSoon();
  });
  $("#detail-done").addEventListener("click", () => {
    if (!editing) return;
    toggleTodo(editing);
    renderDetailState();
  });
  $("#detail-delete").addEventListener("click", () => {
    if (!editing) return;
    const t = editing;
    closeTodoDetail();
    deleteTodo(t);
  });
  $("#todo-drawer-close").addEventListener("click", closeTodoDetail);
  [$("#detail-title"), $("#detail-text")].forEach((el) => {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeTodoDetail();
    });
  });

  // 首次启动向导
  $("#ob-pick").addEventListener("click", () => {
    api.pickDataFolder()
      .then((dir) => {
        if (!dir) return;
        obPendingDir = dir;
        $("#ob-path").textContent = dir;
      })
      .catch(() => {});
  });
  $("#ob-start").addEventListener("click", () => {
    void (async () => {
      if (obPendingDir && obPendingDir !== settings.dataDir) {
        settings.dataDir = obPendingDir;
        todos = await api.changeDataDir(obPendingDir);
        render();
      }
      settings.onboarded = true;
      await persistSettings();
      onboardingEl.classList.add("hidden");
    })();
  });

  // 调整大小
  $("#grip").addEventListener("mousedown", (e) => {
    e.preventDefault();
    void win.startResizeDragging("SouthEast");
  });

  // 窗口移动后保存位置（防抖）+ 壁纸层重新对齐
  let alignTimer: ReturnType<typeof setTimeout> | undefined;
  let lastX: number | null = null;
  let lastY: number | null = null;
  await win.onMoved(({ payload }) => {
    if (payload.x === lastX && payload.y === lastY) return;
    lastX = payload.x;
    lastY = payload.y;
    clearTimeout(alignTimer);
    alignTimer = setTimeout(() => void alignWallpaper(), 40);
    clearTimeout(posSaveTimer);
    posSaveTimer = setTimeout(saveWindowPos, 600);
  });

  // 跟随系统主题
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (settings.theme === "system") {
      applyThemeClass();
      void refreshBlur();
    }
  });
}

// ---- 启动 ----
async function boot(): Promise<void> {
  [settings, todos] = await Promise.all([api.getSettings(), api.getTodos()]);
  applyThemeClass();
  renderSettingsState();
  await bindEvents();
  render();
  if (settings.blur === "acrylic") {
    await ensureWallpaper();
  }
  updateWallpaperLayer();
  if (!settings.onboarded) {
    $("#ob-path").textContent = settings.dataDir;
    onboardingEl.classList.remove("hidden");
  }
  api.getVersion().then((v) => {
    $("#about").textContent = `memoPad v${v}`;
  });
  api.getAutostart()
    .then((on) => $("#autostart-switch").classList.toggle("on", on))
    .catch(() => {});
}

void boot();
