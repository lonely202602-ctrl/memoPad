import { invoke } from "@tauri-apps/api/core";

export type Theme = "system" | "light" | "dark";
export type Blur = "mica" | "acrylic" | "none";
export type View = "daily" | "longterm";

export interface Todo {
  id: string;
  kind: View;
  date: string | null; // YYYY-MM-DD，仅 daily
  content: string;
  done: boolean;
  createdAt: number;
  doneAt: number | null;
}

export interface Settings {
  dataDir: string;
  theme: Theme;
  blur: Blur;
  alwaysOnTop: boolean;
  windowX: number | null;
  windowY: number | null;
  windowW: number | null;
  windowH: number | null;
}

export const api = {
  getVersion: () => invoke<string>("get_version"),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  getTodos: () => invoke<Todo[]>("get_todos"),
  saveTodos: (todos: Todo[]) => invoke<void>("save_todos", { todos }),
  pickDataFolder: () => invoke<string | null>("pick_data_folder"),
  changeDataDir: (newDir: string) => invoke<Todo[]>("change_data_dir", { newDir }),
  openDataFolder: () => invoke<void>("open_data_folder"),
  setBlur: (mode: Blur, dark: boolean | null) => invoke<Blur>("set_blur", { mode, dark }),
  setAlwaysOnTop: (on: boolean) => invoke<void>("set_always_on_top", { on }),
  getAutostart: () => invoke<boolean>("get_autostart"),
  setAutostart: (on: boolean) => invoke<void>("set_autostart", { on }),
};
