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

let editing: Todo | null = null;
let wallpaperUrl: string | null = null;

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
  document.body.style.setProperty("--base-alpha", String(settings.glassAlpha ?? 0.4));
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

async function setThemeMode(mode: Theme): Promise<void> {
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
  render();
}

function deleteTodo(t: Todo): void {
  todos = todos.filter((x) => x.id !== t.id);
  saveTodosSoon();
  render();
}

function clearDone(): void {
  const scope = new Set(currentScope().filter((t) => t.done).map((t) => t.id));
  todos = todos.filter((t) => !scope.has(t.id));
  saveTodosSoon();
  render();
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

function itemHtml(t: Todo): string {
  return `<div class="item${t.done ? " done" : ""}" data-id="${t.id}">
    <button class="check" data-act="toggle" title="${t.done ? "标记为未完成" : "确认完成"}"></button>
    <span class="content" data-act="open" title="点击编辑详情">${esc(t.content)}</span>
    <button class="del" data-act="del" title="删除">✕</button>
  </div>`;
}

function render(): void {
  const isToday = selectedDate === todayStr();
  dateRow.classList.toggle("hidden", view === "longterm");
  dateLabel.textContent = isToday ? "今天" : humanDate(selectedDate);
  dateLabel.title = isToday ? "回到今天" : `${selectedDate}，点击回到今天`;

  const scope = currentScope();
  const pending = scope.filter((t) => !t.done).sort((a, b) => a.createdAt - b.createdAt);
  const done = scope.filter((t) => t.done).sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0));

  let html = "";
  for (const t of pending) html += itemHtml(t);
  if (done.length > 0) {
    html += `<div class="done-head"><span>已完成 · ${done.length}</span><button class="clear-done" data-act="clear">清除</button></div>`;
    for (const t of done) html += itemHtml(t);
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
    selectedDate = todayStr();
    render();
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
    const order: Theme[] = ["system", "light", "dark"];
    const next = order[(order.indexOf(settings.theme) + 1) % order.length];
    void setThemeMode(next);
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
  api.getVersion().then((v) => {
    $("#about").textContent = `memoPad v${v}`;
  });
  api.getAutostart()
    .then((on) => $("#autostart-switch").classList.toggle("on", on))
    .catch(() => {});
}

void boot();
