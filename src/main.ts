import "./styles.css";
import { api, type Blur, type Settings, type Theme, type Todo, type View } from "./api";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";

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
  lanView: false,
  lanPort: null,
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

// ---- 自绘滚动条：滚动/拖动时淡入，停止后淡出（不依赖原生滚动条） ----
function setupFancyScroll(container: HTMLElement, host: HTMLElement) {  const bar = document.createElement("div");
  bar.className = "fancy-scroll";
  const thumb = document.createElement("div");
  thumb.className = "fancy-thumb";
  bar.appendChild(thumb);
  host.appendChild(bar);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let dragging = false;
  let rafId = 0;

  function update(): void {
    rafId = 0;
    const sh = container.scrollHeight;
    const ch = container.clientHeight;
    const rect = container.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    bar.style.top = `${rect.top - hostRect.top}px`;
    bar.style.left = `${rect.right - hostRect.left - 10}px`;
    bar.style.height = `${rect.height}px`;
    if (sh <= ch + 1) {
      bar.style.opacity = "0";
      thumb.style.display = "none";
      return;
    }
    thumb.style.display = "block";
    const th = Math.max(28, (ch / sh) * rect.height);
    const trackH = rect.height - th;
    thumb.style.height = `${th}px`;
    thumb.style.top = `${(container.scrollTop / (sh - ch)) * trackH}px`;
  }

  function scheduleUpdate(): void {
    if (!rafId) rafId = requestAnimationFrame(update);
  }

  function show(): void {
    scheduleUpdate();
    if (thumb.style.display === "none") return;
    bar.style.opacity = "1";
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!dragging) bar.style.opacity = "0";
    }, 700);
  }

  thumb.addEventListener("pointerdown", (e) => {
    dragging = true;
    thumb.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startScroll = container.scrollTop;
    const sh = container.scrollHeight - container.clientHeight;
    const trackH = bar.clientHeight - thumb.offsetHeight;
    if (sh <= 0 || trackH <= 0) return;
    const onMove = (ev: PointerEvent) => {
      container.scrollTop = startScroll + ((ev.clientY - startY) / trackH) * sh;
    };
    const onUp = () => {
      dragging = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      show();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  container.addEventListener("scroll", show);
  new ResizeObserver(update).observe(container);
  update();
  return { update, show };
}

const listScroll = setupFancyScroll(listEl, document.querySelector<HTMLElement>(".base")!);
const drawerScroll = setupFancyScroll($<HTMLElement>(".drawer-body"), $<HTMLElement>(".drawer"));

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
  const raw = settings.glassAlpha ?? 0.45;
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
  sizeWallpaperLayer();
  void alignWallpaper();
}

// 壁纸按窗口所在屏幕坐标反向对齐，挪动便签时模糊背景保持贴合。
// 性能关键：模糊只光栅化一次，拖动中每帧仅写 transform（纯合成器搬运，
// 不重跑 44px 模糊）。对齐基准是窗口所在显示器的原点；跨显示器拖动时
// 从移动事件负载发现越界，再异步刷新显示器信息（低频路径）
let scaleCache = 1;
const monCache = { x: 0, y: 0, w: 0, h: 0 }; // 当前显示器物理坐标与尺寸
const WALL_M = 120; // 外扩余量，与 styles.css 的 .wallpaper inset 保持一致

async function refreshMonitor(): Promise<void> {
  try {
    const pos = await win.outerPosition();
    const mons = await availableMonitors();
    const cur =
      mons.find(
        (m) =>
          pos.x >= m.position.x &&
          pos.x < m.position.x + m.size.width &&
          pos.y >= m.position.y &&
          pos.y < m.position.y + m.size.height
      ) ?? mons[0];
    if (cur) {
      monCache.x = cur.position.x;
      monCache.y = cur.position.y;
      monCache.w = cur.size.width;
      monCache.h = cur.size.height;
      scaleCache = cur.scaleFactor;
    }
  } catch {
    /* 沿用旧值 */
  }
}

function sizeWallpaperLayer(): void {
  const sw = window.screen.width;
  const sh = window.screen.height;
  wallpaperEl.style.width = `${sw + WALL_M * 2}px`;
  wallpaperEl.style.height = `${sh + WALL_M * 2}px`;
  wallpaperEl.style.backgroundSize = `${sw}px ${sh}px`;
  wallpaperEl.style.backgroundPosition = "0 0";
}

function alignWallpaper(x?: number, y?: number): void {
  if (settings.blur !== "acrylic") return;
  const apply = (px: number, py: number) => {
    const tx = WALL_M + (monCache.x - px) / scaleCache;
    const ty = WALL_M + (monCache.y - py) / scaleCache;
    wallpaperEl.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
  };
  if (x !== undefined && y !== undefined) {
    apply(x, y);
    if (
      x < monCache.x ||
      x >= monCache.x + monCache.w ||
      y < monCache.y ||
      y >= monCache.y + monCache.h
    ) {
      void refreshMonitor().then(() => {
        sizeWallpaperLayer();
        alignWallpaper(x, y);
      });
    }
    return;
  }
  void win.outerPosition().then((p) => apply(p.x, p.y)).catch(() => {});
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

// 删除：数据立即移除并让列表滑升补位（FLIP），
// 被删条目以「替身」在原位淡出滑出——与条目数量无关，全程只走合成器动画
function deleteTodo(t: Todo): void {
  const el = listEl.querySelector<HTMLElement>(`.item[data-id="${t.id}"]`);
  if (!el || REDUCE_MOTION.matches) {
    todos = todos.filter((x) => x.id !== t.id);
    saveTodosSoon();
    render();
    return;
  }
  const rect = el.getBoundingClientRect();
  const clone = el.cloneNode(true) as HTMLElement;
  clone.style.position = "fixed";
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.width = `${rect.width}px`;
  clone.style.margin = "0";
  clone.style.zIndex = "60";
  clone.style.pointerEvents = "none";
  document.body.appendChild(clone);
  todos = todos.filter((x) => x.id !== t.id);
  saveTodosSoon();
  renderFlip();
  clone
    .animate(
      [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "translateX(26px)" },
      ],
      { duration: 170, easing: "cubic-bezier(0.4, 0, 0.2, 1)" }
    )
    .onfinish = () => clone.remove();
}

function clearDone(): void {
  const ids = new Set(currentScope().filter((t) => t.done).map((t) => t.id));
  if (ids.size === 0) return;
  const els = [...listEl.querySelectorAll<HTMLElement>(".item")].filter((el) =>
    ids.has(el.dataset.id ?? "")
  );
  // 替身级联淡出
  els.forEach((el, i) => {
    const rect = el.getBoundingClientRect();
    const clone = el.cloneNode(true) as HTMLElement;
    clone.style.position = "fixed";
    clone.style.left = `${rect.left}px`;
    clone.style.top = `${rect.top}px`;
    clone.style.width = `${rect.width}px`;
    clone.style.margin = "0";
    clone.style.zIndex = "60";
    clone.style.pointerEvents = "none";
    document.body.appendChild(clone);
    clone
      .animate(
        [
          { opacity: 1, transform: "none" },
          { opacity: 0, transform: "translateX(26px)" },
        ],
        { duration: 160, delay: i * 30, easing: "ease-out" }
      )
      .onfinish = () => clone.remove();
  });
  todos = todos.filter((t) => !ids.has(t.id));
  saveTodosSoon();
  renderFlip();
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
  listScroll.update();
}

function renderSettingsState(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-theme-opt]").forEach((b) => {
    b.classList.toggle("active", b.dataset.themeOpt === settings.theme);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-blur-opt]").forEach((b) => {
    b.classList.toggle("active", b.dataset.blurOpt === settings.blur);
  });
  $("#top-switch").classList.toggle("on", settings.alwaysOnTop);
  $("#btn-pin").classList.toggle("on", settings.alwaysOnTop);
  $("#lan-switch").classList.toggle("on", settings.lanView);
  $<HTMLInputElement>("#lan-port").value = String(settings.lanPort ?? 9600);
  const alpha = settings.glassAlpha ?? 0.45;
  $<HTMLInputElement>("#glass-alpha").value = String(Math.round(alpha * 100));
  // 「关闭」模式下表面为实色，透明度无意义——置灰并说明
  const alphaDisabled = settings.blur === "none";
  $<HTMLInputElement>("#glass-alpha").disabled = alphaDisabled;
  $("#alpha-hint").textContent = alphaDisabled ? "已关闭磨砂：便签为实色，无透明度可调。" : "";
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

  // 卸载：打开设置时即判定安装版/便携版——便携版按钮直接置灰说明，
  // 不再走两步确认后才告知；安装版保持两步确认并拉起系统卸载器
  const ub = $<HTMLButtonElement>("#uninstall-btn");
  const uh = $("#uninstall-hint");
  let uninstallArmed = false;
  let uninstallArmTimer: ReturnType<typeof setTimeout> | undefined;
  function applyUninstallState(): void {
    uninstallArmed = false;
    clearTimeout(uninstallArmTimer);
    void api
      .uninstallerAvailable()
      .then((ok) => {
        ub.disabled = !ok;
        if (ok) {
          ub.textContent = "卸载 memoPad";
          uh.textContent = "";
        } else {
          ub.textContent = "便携版 · 删除 exe 即可卸载";
          uh.textContent =
            "当前以便携方式运行（单文件程序）。卸载 = 直接删除 memoPad.exe 本体，不要删整个文件夹（里面可能有你的其他文件）；待办数据存于 %APPDATA%\\memoPad，不会被动。";
        }
      })
      .catch(() => {});
  }
  ub.addEventListener("click", () => {
    if (!uninstallArmed) {
      uninstallArmed = true;
      ub.textContent = "确认卸载？再点一次";
      uninstallArmTimer = setTimeout(() => {
        uninstallArmed = false;
        ub.textContent = "卸载 memoPad";
      }, 2500);
      return;
    }
    clearTimeout(uninstallArmTimer);
    ub.disabled = true;
    ub.textContent = "正在启动卸载器…";
    api
      .runUninstaller()
      .then((msg) => {
        uh.textContent = msg + "，应用即将退出…";
      })
      .catch((e) => {
        uh.textContent = String(e);
        uninstallArmed = false;
        ub.disabled = false;
        ub.textContent = "卸载 memoPad";
      });
  });

  // 窗口按钮
  // 标题栏置顶
  $("#btn-pin").addEventListener("click", () => {
    settings.alwaysOnTop = !settings.alwaysOnTop;
    void win.setAlwaysOnTop(settings.alwaysOnTop);
    $("#btn-pin").classList.toggle("on", settings.alwaysOnTop);
    $("#top-switch").classList.toggle("on", settings.alwaysOnTop);
    persistSettings();
  });
  $("#btn-hide").addEventListener("click", () => void win.hide());
  $("#btn-settings").addEventListener("click", () => {
    drawer.classList.remove("hidden");
    renderSettingsState();
    drawerScroll.show();
    void applyUninstallState();
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
        if (settings.blur === "acrylic") {
          await ensureWallpaper();
          await refreshMonitor();
        }
        await refreshBlur();
        persistSettings();
        renderSettingsState();
      })();
    });
  });
  $<HTMLInputElement>("#glass-alpha").addEventListener("input", () => {
    const v = Number($<HTMLInputElement>("#glass-alpha").value); // 20~90
    settings.glassAlpha = v / 100;
    applyThemeClass(); // 统一口径：none 模式保底 90% 的可读性钳制
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

  // 局域网查看
  $("#lan-switch").addEventListener("click", () => {
    settings.lanView = !settings.lanView;
    $("#lan-switch").classList.toggle("on", settings.lanView);
    $("#lan-hint").textContent = settings.lanView
      ? "已保存，重启应用后生效。设备可通过 http://电脑IP:端口 访问只读视图。"
      : "已关闭，重启应用后生效。";
    persistSettings();
  });
  $<HTMLInputElement>("#lan-port").addEventListener("change", () => {
    let v = parseInt($<HTMLInputElement>("#lan-port").value, 10);
    if (isNaN(v) || v < 1024 || v > 65535) v = 9600;
    $<HTMLInputElement>("#lan-port").value = String(v);
    settings.lanPort = v;
    $("#lan-hint").textContent = "端口已保存，重启应用后生效。";
    persistSettings();
  });

  // 首次启动向导
  $("#ob-lan-switch").addEventListener("click", () => {
    $("#ob-lan-switch").classList.toggle("on");
  });
  $("#ob-path").addEventListener("click", () => $("#ob-pick").click());
  $("#data-path").addEventListener("click", () => $("#pick-dir").click());
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
      settings.lanView = $("#ob-lan-switch").classList.contains("on");
      const port = parseInt($<HTMLInputElement>("#ob-lan-port").value, 10);
      settings.lanPort = isNaN(port) || port < 1024 || port > 65535 ? 9600 : port;
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

  // 窗口移动后保存位置（防抖）+ 壁纸层实时对齐（transform 直写，无需节流）
  let lastX: number | null = null;
  let lastY: number | null = null;
  await win.onMoved(({ payload }) => {
    if (payload.x === lastX && payload.y === lastY) return;
    lastX = payload.x;
    lastY = payload.y;
    alignWallpaper(payload.x, payload.y);
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
    await refreshMonitor();
  }
  updateWallpaperLayer();
  if (!settings.onboarded) {
    $("#ob-path").textContent = settings.dataDir;
    $("#ob-lan-switch").classList.toggle("on", settings.lanView);
    $<HTMLInputElement>("#ob-lan-port").value = String(settings.lanPort ?? 9600);
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
