# Mozi

本地优先的桌面工具箱：API 调试、记事本、待办任务、Markdown 写作，加上 9 个常用的编码 / 文本工具，
全部在一个窗口里，数据不出本机。

![Mozi 工具箱](.github/screenshot-home.png)

## 工具一览

首页按 **开发 / 记录与任务 / 编码与转换 / 文本与生成** 四组排列，支持搜索过滤。

### 开发

| 工具 | 能力 |
|---|---|
| **请求工具** | HTTP 全方法、GraphQL、表单/文件上传、WebSocket、SSE（任意方法，含 POST body）；集合与历史、环境变量、**Cookie 管理**、cURL 导入导出、认证助手、响应树 |
| **JWT 解析** | 拆 Header / Payload（UTF-8 安全）、`exp`/`nbf`/`iat` 时间状态与倒计时、HS256 验签（常数时间比较） |
| **正则测试** | 实时匹配计数、分组与命名捕获、替换预览、正则错误提示、8 个常用正则收藏、g/im/s/u 开关 |
| **cURL 转代码** | cURL 一键生成 Python(requests) / JS(fetch) / Node(axios) / Go(net/http) / Java(OkHttp) 代码，可直接用请求工具当前请求或粘贴 cURL |

### 记录与任务

| 工具 | 能力 |
|---|---|
| **记事本** | 富文本笔记（加粗 / 斜体 / 删除线、标题、列表、引用、代码、链接）；**三种方式插图**（选文件 / 粘贴 / 拖入），**可编辑标题**，多笔记列表、草稿自动保存、导出 HTML |
| **待办任务** | 主题（必填）+ 描述（可选）+ 预期完成时间（默认当天）；**逾期标红**并显示天数，行内改期、勾选完成、编辑、二次确认删除；按月份归档，当月铺开、往月收进折叠的「归档」 |

### 编码与转换

| 工具 | 能力 |
|---|---|
| **字符转义** | JavaScript 字符串、JSON 字符串、URL、HTML 实体、Unicode `\uXXXX`，每个方向都支持转义与去转义 |
| **Base64 工具箱** | 一页三个标签：文本加解密（UTF-8 / URL-safe）、图片 → Base64、Base64 → 图片（预览、尺寸、体积、存图） |
| **Hash 摘要** | MD5 / SHA-1 / SHA-256 / SHA-512，文本（UTF-8/Hex/Base64 输入）与文件流式计算，一键复制 |
| **时间戳转换** | Unix 秒/毫秒自动识别 ↔ 日期、本地/UTC/多时区对照、实时时钟、相对时间（3 分钟前） |

### 文本与生成

| 工具 | 能力 |
|---|---|
| **JSON 格式化** | 2/4 空格格式化、压缩、键名排序、语法校验（错误带行列）、键/节点统计 |
| **Markdown 编辑器** | 左右分栏实时预览 + **全屏预览**；**编辑框内快捷操作栏**（行内标记、列表、26 种语言的代码块、格式、插入）；**保存 / 另存为**（红点标示未写入）；草稿跨重启保留；相对路径图片、Mermaid 流程图、导出 HTML |
| **UUID / 密码** | UUID v4 与 v7（时间有序）、批量、大写/花括号；随机密码（字符集与长度可调、排除易混淆字符）与熵估算 |

![请求工具](.github/screenshot-http.png)

![Markdown 编辑器](.github/screenshot-md.png)

![正则测试](.github/screenshot-regex.png)

![时间戳转换](.github/screenshot-timestamp.png)

## Cookie 管理

请求工具新增 **Cookies** 标签页：

- 响应里的 `Set-Cookie` 自动存入 Cookie Jar（Domain / Path / Secure / HttpOnly / Expires / Max-Age 全解析）
- 下一次请求按**域名后缀 + 路径边界**自动匹配附加；手动写了 `Cookie` 头则不覆盖
- 每条可勾选启用 / 停用、改名改值、删除；支持手动添加与一键清空
- Jar 随 data.json 持久化，启动时自动清理过期项

## 保存语义

- 点 **「保存」**（或 `⌘S`）才会把请求写入集合并命名——编辑过程中不会自动改集合
- 当前所有标签页、集合、历史、Cookie、环境等**工作状态**始终自动持久化到本地文件，重启后原样恢复

## 记事本

- 富文本编辑：加粗 / 斜体 / 下划线 / 删除线、H1 / H2、有序与无序列表、引用、代码块、链接、清除格式
- **插入图片**三种方式：工具栏或顶栏选择本地文件、直接**粘贴**剪贴板图片、把图片**拖进**编辑器
- 左侧多笔记列表（按更新时间排序，显示摘要），自动保存，可导出为 HTML
- 内容存进本地 data.json 前会过一遍白名单净化：只保留排版标签，
  `<script>`/`<style>` 连同内容一起删除，`on*` 事件属性与 `javascript:` 链接一律剥离，
  图片只允许 `data:image` / http(s) / 本地路径

## 待办任务

- 新建待办：**主题**（必填）、**描述**（可选）、**预期完成时间**（默认当天）
- 列表上直接改期（日期选择器）、勾选完成、编辑内容、删除（二次确认）
- **逾期标红**：未完成且到期日已过的条目，边框与标题都用红色，并显示「逾期 N 天」
- **按月份归档**：当月与未来的任务直接铺开；
  往月任务进入可折叠的「归档」，按月份倒序分组并显示完成数（如 `2026 年 10 月 · 1/1`）
- 归档规则刻意保证「未完成的逾期任务永远可见」：往月**未完成**的任务留在逾期区，
  只有**已完成**的往月任务才会归档，避免旧任务被藏起来
- 「隐藏已完成」可只看未完成项；统计行显示全部 / 未完成 / 逾期 / 已完成

## Markdown 编辑器

- **头部操作是图标按钮**（悬停显示提示）：另存为… / 打开 Markdown 文件… / 全屏预览 /
  插入示例 / 复制 HTML / 导出 HTML
- **编辑框内快捷操作栏**（点击即插入对应语法，光标与选区会被正确保留）：
  - `B` `I` `H` `S`：加粗 / 斜体 / 标题 / 删除线
  - `列表 ▾`：无序、有序、任务清单
  - `代码块 ▾`：行内代码、围栏代码块、引用，另附 **26 种代码语言**（选择后插入 ` ```lang `）
  - `格式 ▾`：H1–H3、分隔线、清除标记
  - `插入 ▾`：表格、折叠块、当前日期、当前时间
  - 🖼 插入图片、🔗 插入链接
- **下拉菜单同时只展开一个**：打开新菜单会自动收起其他，点击别处或按 `Esc` 全部关闭
- **保存与另存为**：`⌘S` 写回已打开的 `.md`，没有文件则弹出保存框；「另存为…」换路径。
  保存按钮上的**红点**表示当前内容还没写进文件
- **草稿自动保存**：内容与来源文件一起持久化，**重启后自动恢复**，关闭前不会丢
- **全屏预览**：预览铺满整个窗口，编辑器与工具栏隐藏；浮动按钮或 `Esc` 退出
  （`Esc` 在全屏时只退出全屏，不会跳回工具箱）
- **相对路径图片**：打开本地 `.md` 后，`![](./img/sss.png)`、`![](../assets/a.jpg)`
  会按 **该 md 文件所在目录** 解析成绝对 `file://` 地址并回显；解析目录显示在预览栏标题旁
- 若粘贴的 Markdown 含相对路径但还没打开过文件，图片会以虚线框标出并提示先打开本地文件
- 粘贴截图或拖入图片会内联为 data URL，随笔记一起保存

## 主题与语言

首页右上角切换：

- **主题**：浅色 / 跟随系统 / 深色（默认跟随系统），窗口底色与 Mermaid 流程图配色同步
- **语言**：中文 / English，界面文案与 macOS/Windows 原生菜单同步切换，选择持久化

> 当前英文覆盖界面主体（首页、工具名与描述、面板与按钮、原生菜单）；少数动态提示
> （toast、错误详情）仍为中文，词典缺项时自动回退中文而不会显示 key。

## 打开本地 Markdown

Markdown 编辑器工具栏的「打开 .md 文件…」直接加载本机文件（md / markdown / txt）。

## 布局可拖拽

所有分栏都能用鼠标拖动调整，双击分隔条恢复默认，尺寸按分栏记忆（重启后保持）：

- **左右**：侧栏宽度；转义 / JSON / Base64（文本与两个图片面板）/ JWT / Hash / 密码 / 正则 / cURL 转代码 / Markdown 的双栏
- 工具箱首页：头部与搜索固定，只有工具列表滚动
- **上下**：请求工具里请求区与响应区的高度
- 分隔条获得焦点后可用方向键微调，`Home` / `End` 到边界

## 设计取向

- **本地优先**：所有数据只写入本机 `userData/data.json`，不发任何统计请求
- **零框架**：渲染层是原生 HTML/CSS/JS，没有 React/Vite/打包步骤；运行时依赖只有 `ws`
- **一个窗口**：工具箱首页 → 工具页，返回即回首页，工具状态各自保留

## 导航

- 首页搜索框可按名称/描述/拼音关键词过滤工具
- 任意工具页左上角统一的 **M 图标**按钮返回工具选择页
- 快捷键 **`Esc`** 返回工具箱（有弹窗时先关闭弹窗）
- **`⌘/Ctrl + 1`** 回工具箱，**`⌘/Ctrl + 2…9`** 直达各工具（菜单 **Go**）
- **`⌘/Ctrl + E`** 回工具箱并聚焦搜索框
- 请求工具里点侧栏左上角的 **M** 也能返回

## 快捷键

`⌘/Ctrl + S` 是**按视图分流**的：请求工具里保存到集合，Markdown 里写回 `.md` 文件，
记事本/待办里落盘当前内容。原生菜单加速键先于页面脚本触发，所以由渲染层的视图调度器
统一接管，不会出现「在 Markdown 里按 ⌘S 却跳去请求工具」的情况。

请求工具内：

| 快捷键 | 动作 |
|---|---|
| `⌘/Ctrl + Enter` | 发送请求 / 连接流 |
| `⌘/Ctrl + N` | 新建请求标签页 |
| `⌘/Ctrl + S` | 保存到集合 |
| `⌘/Ctrl + I` | 导入 cURL |
| `⌘/Ctrl + K` | 聚焦搜索框 |
| `⌘/Ctrl + W` | 关闭当前标签页 |

## 开发

```bash
npm install
npm start      # 启动
npm test       # 单元测试：HTTP / WS / SSE / cURL / codec / jwt / codegen / markdown
               #           / cookies / todos / notepad / i18n / css
npm run smoke  # 端到端：起本地服务，走完全部工具的断言并截图
```

单测 **170 项**，端到端 **193 项**。`npm run smoke` 覆盖：首页四组与 13 个工具卡片、
HTTP 请求与 JSON 树、WS 收发、SSE 流（GET 与 POST body）、集合保存落盘、cURL 导入导出、
转义 / JSON / Base64（文本 + 图片三标签）/ 时间戳 / Hash（含已知向量校验）/ UUID 与密码 /
正则 / JWT / 代码生成、Cookie 自动收集与回发（grant → jar → whoami 往返）、
记事本（富文本入库、净化、标题编辑、真实文件走 IPC 插图、粘贴插图）、
待办（逾期红色、改期、完成、按月归档）、
Markdown（快捷操作、下拉互斥与实底面板、相对路径图片、`⌘S` 不误跳视图、全屏预览、Mermaid 重绘）、
返回工具箱（统一 M 图标）、首页搜索、最近使用、`⌘1…⌘9` 直达、
分栏拖拽 / 双击重置 / 重启后恢复、中英双语切换。

CI 上跑 smoke 时会带 `MOZI_SMOKE_NO_SHOTS=1`（跳过截图，`capturePage` 在无头 runner 上
容易卡住）并启用看门狗：单步 25s、整体 7 分钟，超时会打印诊断并快速失败，
而不是拖满 job 超时。

```bash
npm run smoke -- --no-sandbox --disable-gpu   # 沙箱 / CI 环境
```

## 打包

```bash
npm run dist:mac   # macOS dmg + zip
npm run dist:win   # Windows NSIS + 便携版
```

只保留 `en` 与 `zh_CN` 语言包（`electronLanguages`），Electron 自带的其余 60 多个
locale 会被裁掉，安装体积减少约 9 MB。

### Windows 提示「未知发布者」

发布物是**未签名**的，所以 Windows 会说「未知发布者」——这是缺证书，不是打包错误。
Windows 只根据 Authenticode 签名判断发布者，没有签名就一定这样显示（已验证：发布出的
`Mozi-0.4.6.exe` 的 PE 证书表大小为 0）。

装之前先选一种方式：

1. **点掉提示**：安装器窗口 →「更多信息」→「仍要运行」。「仍要运行」默认藏在「更多信息」里，
   不展开就只看到「未知发布者」和一个「不运行」按钮。
2. **解除文件锁定**（下载来的文件带 Mark-of-the-Web）：右键 exe →「属性」→ 勾选「解除锁定」→ 确定。
   命令行等价：`Unblock-File .\Mozi-Setup-0.4.6.exe`
3. **免安装**：用 `Mozi-0.4.6.exe`（便携版，双击即用）或 `Mozi-0.4.6-win-x64.zip`（解压后运行
   `Mozi.exe`），都不经过安装器。安装器是**按当前用户安装**、不需要管理员权限的。

如果公司策略直接拦截（「此应用已被阻止」），需要管理员放行，或改用已签名构建。

### 想彻底去掉提示

| 方式 | 适用 | 说明 |
|---|---|---|
| 购买代码签名证书（OV/EV） | 正式发布 | 把证书配到 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`，CI 会自动签名；EV 证书可直接获得 SmartScreen 信誉 |
| [Azure Trusted Signing](https://azure.microsoft.com/products/trusted-signing) | 正式发布 | 订阅制，需通过主体身份验证 |
| 自签名 | 个人/内网自用 | 运行 `tools/sign-windows.ps1`：生成代码签名证书、在当前用户下信任它、给 `release/` 里的产物签名 |

```powershell
# 自签名（Windows PowerShell，项目根目录）
powershell -ExecutionPolicy Bypass -File tools/sign-windows.ps1 -CreateCert -Trust
powershell -ExecutionPolicy Bypass -File tools/sign-windows.ps1 -Path release
```

自签名会让**信任了该证书的机器**把发布者显示成证书主体、不再以「未知发布者」拦截；
它不会积累 SmartScreen 信誉，别人机器上仍是未知发布者。该脚本未在本仓库的 CI 中执行过
（CI 不装 PowerShell 运行时），请在 Windows 上按其输出核对结果。

### 签名与公证

签名是**凭据驱动**的：仓库 Secrets 配好就自动签名 + 公证，没配就照常产出未签名包，
CI 不需要改。

| Secret | 用途 |
|---|---|
| `CSC_LINK` | macOS Developer ID 证书（base64 的 .p12） |
| `CSC_KEY_PASSWORD` | 上面对应的密码 |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | 公证（notarytool），三者齐备才启用 |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | Windows 代码签名证书 |

配置了证书后，macOS 首次打开不再需要 `xattr -dr com.apple.quarantine`，
Windows 也不会再弹 SmartScreen 警告。未签名时的替代命令：

```bash
xattr -dr com.apple.quarantine /Applications/Mozi.app
```

产物在 `release/`：

- macOS：`Mozi-<version>-arm64-mac.zip`（解压即用）+ `mac-arm64/Mozi.app`
- Windows：NSIS 安装包 + 便携版 `.exe`

**DMG 说明**：`hdiutil` 需要挂载磁盘，在受限/沙箱环境会失败（`操作不被允许`）。
普通 macOS 或 CI 上 `npm run dist:mac` 会自动产出 dmg；受限环境用 zip 分发。

**Windows 说明**：`electron-builder` 不能从 macOS 交叉打 NSIS 包，需在 Windows 或 CI 构建。
仓库内置 [.github/workflows/build.yml](.github/workflows/build.yml)，打 tag 即同时产出 macOS 与 Windows 安装包。

## 数据位置

- macOS: `~/Library/Application Support/Mozi/data.json`
- Windows: `%APPDATA%/Mozi/data.json`

## 结构

```
src/
  main/
    main.js      窗口、菜单、IPC（含文本/图片文件读写、语言切换）
    http.js      node:http(s) 请求引擎：重定向、gzip/br、TLS、计时、截断
    ws.js        WebSocket 客户端
    sse.js       EventSource 流式解析
    store.js     userData/data.json 原子写入
    smoke.js     端到端冒烟测试（仅在 --smoke 时加载）
  preload/       contextBridge 白名单
  renderer/
    index.html   工具箱首页 + 13 个工具视图
    app.js       请求工具 + 状态/持久化 + 工具注册表 + 主题与语言 + 菜单调度
    tools.js     转义 / JSON / Base64 / Markdown（含快捷操作与保存）
    tools2.js    时间戳 / Hash / UUID / 正则 / JWT / 代码生成
    tools3.js    记事本 / 待办任务视图
    lib/         json-tree、curl、codec、jwt、codegen、split、markdown、
                 cookies、todos、notepad、i18n、i18n-dict、mermaid.min.js（按需加载）
test/            node:test 单元测试（含 css.test.js：未声明的 CSS 变量会直接失败）
```

## 常见问题

**Electron 二进制下载失败**（国内网络）：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export electron_config_cache="$PWD/.electron-cache"
node node_modules/electron/install.js
```

**macOS 提示“已损坏，无法打开”**：安装包未签名，执行
`xattr -dr com.apple.quarantine /Applications/Mozi.app` 即可。

## License

MIT
