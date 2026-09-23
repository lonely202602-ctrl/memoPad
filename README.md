<div align="center">
  <img src="assets/logo.png" width="150" alt="memoPad"/>
  <h1>memoPad</h1>
  <p><b>桌面上的一张磨砂玻璃便签 · 待办与备忘</b></p>
  <p>
    <img src="https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4?logo=windows95" alt="platform"/>
    <img src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri" alt="tauri"/>
    <img src="https://img.shields.io/badge/%E5%86%85%E5%AD%98-%3C40MB-46C018" alt="memory"/>
    <a href="https://github.com/lonely202602-ctrl/memoPad/releases/latest"><img src="https://img.shields.io/badge/%E4%B8%8B%E8%BD%BD-Releases-F0A52A" alt="download"/></a>
  </p>
</div>

---

原生 Windows 桌面便签（Tauri 2 构建，**不是网页应用**）：一张常驻桌面的磨砂玻璃便签纸，写下待办、点一下完成。安装包 1.4MB，内存占用约 30MB，完全离线运行。

## ✨ 功能

- 🗒️ **磨砂玻璃便签**：无边框玻璃质感窗口，可随意拖动、调整大小；毛玻璃观感恒定，与窗口焦点无关
- ✅ **待办管理**：点击圆圈确认完成（丝滑过渡动画），已完成自动沉底，双击进入详情编辑，支持补充说明
- 📅 **每日待办**：日期导航 + 日历弹层快速选择，有待办的日期带圆点标记，过期未完成一键「移到今天」
- ♾️ **长期待办**：独立分区，放不设期限的事项
- 📊 **任务进度**：按视图实时统计已完成/总数与百分比
- 🎨 **三种主题**：跟随系统 / 浅色 / 深色；磨砂不透明度 20%-90% 自由调节
- ⚙️ **贴心细节**：窗口置顶、开机自启、托盘常驻、单实例、位置尺寸记忆
- 📡 **局域网查看**：手机等设备可通过端口只读查看待办（可选，默认关闭)

## 📦 下载安装

| 文件 | 说明 |
|------|------|
| [memoPad_0.4.1_x64-setup.exe · 1.4MB](https://github.com/lonely202602-ctrl/memoPad/releases/download/v0.4.1/memoPad_0.4.1_x64-setup.exe) | 安装版（推荐），按当前用户安装，无需管理员 |
| [memoPad_0.4.1_x64_portable.exe · 4.5MB](https://github.com/lonely202602-ctrl/memoPad/releases/download/v0.4.1/memoPad_0.4.1_x64_portable.exe) | 便携版，单文件双击即用，删除即卸载 |

更多版本请见 [Releases](https://github.com/lonely202602-ctrl/memoPad/releases) 页面。

系统要求：Windows 10/11 x64（Win11 体验最佳，支持 Mica / Acrylic 系统材质）。

## 🚀 上手

1. 在输入框输入待办，回车添加
2. 点击圆圈确认完成，条目自动沉底；双击条目可编辑详情
3. 点「今天」打开日历，快速查看和选择日期
4. 拖动标题栏移动便签，右下角拖拽调整大小
5. 点 ⚙ 打开设置：主题 / 磨砂 / 置顶 / 开机自启 / 存储位置

## 🗃️ 数据与隐私

- **完全本地**：不联网、不上传任何数据
- 待办数据：`<存储位置>\memoPad-data.json`（纯 JSON，可直接备份），默认位于 `%APPDATA%\memoPad\data`，可在设置中更改并自动迁移
- 设置文件：`%APPDATA%\memoPad\settings.json`
- 写入采用「临时文件 + 原子改名」，不会因崩溃损坏

## 🛠️ 技术栈

| 层 | 技术 |
|----|------|
| 框架 | [Tauri 2](https://tauri.app)（Rust + 系统 WebView2） |
| 前端 | TypeScript + Vite，无框架 |
| 毛玻璃 | DWM 系统材质 + 自绘壁纸模糊（与焦点解耦） |
| 存储 | JSON 原子写入，位置可自定义 |
| 分发 | NSIS 安装包（1.4MB）+ 便携 exe |

## 💻 本地开发

```bash
npm install
npm run tauri dev    # 调试运行
npm run tauri build  # 发布构建（NSIS 安装包 + 独立 exe）
```

## 📄 卸载

- 安装版：Windows「设置 → 应用」中卸载，会自动清理开机自启项
- 便携版：直接删除 exe 即可
- 用户数据保留于 `%APPDATA%\memoPad`（及自定义存储位置），卸载不会删除

---

<div align="center">Made with 🧡 by <a href="https://github.com/lonely202602-ctrl">LonelyCat</a></div>
