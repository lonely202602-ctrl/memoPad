# memoPad — 桌面磨砂玻璃便签待办

一个原生 Windows 桌面便签应用（Tauri 2 构建，**不是网页应用**）：常驻桌面的磨砂玻璃便签纸，支持每日待办、长期待办、三种主题、自定义数据存储位置。

## 下载安装

| 文件 | 说明 |
|------|------|
| [memoPad_0.1.1_x64-setup.exe · ~1.4MB](https://github.com/lonely202602-ctrl/memoPad/releases/download/v0.1.1/memoPad_0.1.1_x64-setup.exe) | 安装版（推荐），按当前用户安装，无需管理员 |
| [memoPad_0.1.1_x64_portable.exe · ~4.5MB](https://github.com/lonely202602-ctrl/memoPad/releases/download/v0.1.1/memoPad_0.1.1_x64_portable.exe) | 便携版，单文件双击即用，删除即卸载 |

更多版本请见 [Releases](https://github.com/lonely202602-ctrl/memoPad/releases) 页面。

## 功能

- 🗒️ 无边框磨砂玻璃便签窗口：可随意拖动、调整大小、窗口置顶（可关）
- ✅ 待办事项：点击圆圈手动确认完成，已完成自动排到未完成之后；双击文字可编辑
- 📅 按日期组织：‹ 今天 › 可翻看前后日期，过期未完成可一键「移到今天」
- ♾️ 「长期」页签：不带日期的长期待办
- 🎨 三种主题：跟随系统 / 浅色 / 深色
- ✨ 三种磨砂效果：Mica（Win11 推荐，自动吸取桌面色调）/ Acrylic / 关闭
- 💾 数据持久化：存储位置可自定义（默认 `%APPDATA%\memoPad\data`），更改位置自动迁移
- 🫥 托盘图标：隐藏/显示便签、退出；单实例运行；开机自启（可选）

## 开发

```bash
npm install
npm run tauri dev    # 调试运行
npm run tauri build  # 发布构建（NSIS 安装包 + 独立 exe）
```

构建产物：
- 安装包：`src-tauri/target/release/bundle/nsis/memoPad_0.1.1_x64-setup.exe`
- 独立程序：`src-tauri/target/release/memoPad.exe`（单文件可直接运行）

## 安装 / 卸载

- **安装**：双击 `memoPad_x.y.z_x64-setup.exe`，按当前用户安装（无需管理员）
- **卸载**：Windows「设置 → 应用 → 安装的应用」中卸载 memoPad，卸载时会自动清理开机自启注册表项
- **用户数据**：位于 `%APPDATA%\memoPad`（设置 + 默认数据目录），卸载不会删除；如已把存储位置改到别处，数据完全在你的目录里

## 数据说明

- 设置文件：`%APPDATA%\memoPad\settings.json`（固定，很小，记录数据位置与偏好）
- 待办数据：`<存储位置>\memoPad-data.json`（纯 JSON，可直接备份）
- 写入采用「临时文件 + 原子改名」，不会因崩溃损坏
