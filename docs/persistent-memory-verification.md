# Windows 功能验证报告

版本 1.2.8 · Windows x64 · Electron 45.2.1 · 内置 Node 24.22.1

## 审计与实现

| 1.2.7 的行为 | 1.2.8 的变更 |
|---|---|
| 桌面和网页只用 `l2d.chat` 保存最近 60 条 | 桌面在主进程用 SQLite 持久化聊天和长期记忆，并导入旧聊天。网页沿用原浏览器存储 |
| AI 聊天只使用 `AI.history` | 角色人设、近期上下文和检索到的记忆分别处理。真实聊天请求最多引用 4 条记忆，记忆数据预算约 1,400 UTF-8 字节 |
| 配置和 DPAPI 密钥位于原 Electron 用户目录 | 保留原配置身份。记忆位置和开关分别写入 `%APPDATA%\千绘莉\memory-location.json` 和 `memory-options.json`。默认库为 `%LOCALAPPDATA%\千绘莉\memory\memory.sqlite` |
| 没有桌面 SQLite 库 | 单实例主进程持有连接，使用事务、WAL 和完整同步。首版 schema 1，拒绝未知版本。迁移和恢复验证一致性快照后切换，保留原数据 |
| 应用和 NSIS 都有按 Python 名及脚本名扫描并结束进程的逻辑 | Python 在模型加载前监控私有输入管道。已有管道关闭时退出，超时只处理当前持有的子进程。NSIS 用原生 Windows API 匹配桌宠完整镜像路径、请求退出、检查关键文件锁并提示重试 |

SQLite 备份包含聊天和归档记忆。JSON 导出包含当前长期记忆。可把备份复制到另一块磁盘。跨 Windows 用户使用原 DPAPI 密钥时，可能需要重新配置 API Key。恢复中断时，可用「重新定位」打开保留文件夹中的原库，或用经过验证的备份恢复。

### 安装身份和首次升级风险

两种安装包保留 `com.lizitcxyz.nekomimi`、安装注册表身份及原 Electron 用户目录。锁定的 electron-builder 26.18.0 根据稳定应用 GUID 读取 `InstallLocation` 和 `UninstallString`，从临时目录运行旧卸载器，失败时还会尝试原位置。正常升级参数包括 `/S /KEEP_APP_DATA ... --updated _?=<原路径>`。

**1.2.7 已安装的卸载器仍可能执行其原有 PowerShell Python 扫描。** 新脚本替换了 electron-builder 默认的 PowerShell 应用检查，也移除了新应用和安装器中的 `-ExecutionPolicy Bypass` 路径。运行环境安装取消仍可调用 `taskkill /T /F`，目标限于当前存活的安装子进程 PID。普通语音启动和退出走私有管道。安装包未签名，Windows 仍可能显示 SmartScreen 提示。

## 可重复验证

```powershell
npm ci
node node_modules/electron/install.js
npm test
$env:CHIERI_TEST_PYTHON = 'D:\miniconda\envs\Chieri\python.exe'
node tests/voice-lifecycle.cjs
.\node_modules\.bin\electron.cmd tests/electron-smoke.cjs
npm run dist:lite
npm run dist
```

完整版构建和 GPU 测试需要将完整模型副本放到 `voice\Chieri_GPTSoVITS_20261103`。桌面测试使用隔离用户目录、合成记录、本地模拟 AI 和在线 TTS。测试代码自动确认记忆保存。

| 用例 | 结果与复测 |
|---|---|
| M01–M07 | 自动化验证明确保存、中文检索、重开、超过 60 条聊天、纠正归档、去重、删除和关闭后停用注入 |
| D01–D03 | 自动化验证原聊天顺序、导入幂等和默认目录结构。Windows 桌面测试重定向了用户目录 |
| D04 | 文件迁移、校验和旧库保留已通过。实盘 `D:\ChieriData\memory` **Not Run**。选该空目录迁移，重启并核对新库和旧库 |
| D05–D06 | 模拟目录移走、位置配置丢失、源库损坏和无效备份。验证无空库回退和保留原文件 |
| U01–U04 | **Not Run**。当前机器已有实际 1.2.7 安装，未提供隔离 Windows 安装环境。下方列出升级、重装和版本切换步骤 |
| S01 | Conda GPU 合成和应用路径退出已验证。安装器发起关闭 **Not Run** |
| S02 | Windows 同时启动两个 Python 的测试已通过，应退出的子进程正常退出，无关 Python 继续运行。与安装器同场 **Not Run** |
| S03 | 新项目及打包脚本已审计。真实安全软件和旧卸载器行为跟踪 **Not Run**，可在隔离系统使用 Process Monitor |
| T01 | 指定 Conda Python 3.11 使用原模型副本完成 CUDA 合成，返回 WAV |
| T02 | Electron 在线 TTS IPC 通过本地模拟服务验证。真实第三方在线服务 **Not Run**，可在设置中试听 |
| T03 | 无 AI 配置时桌面收到固定回复并写入聊天数据库。手动测试桌宠点击、拖动和托盘菜单 **Not Run** |
| T04 | 两种 Windows x64 NSIS 安装包均已构建。两版打包后的 `app.asar` 均通过隔离 Electron 测试。核对完整版 GPT 与 SoVITS 权重哈希和现有安装一致。交互式安装和启动 **Not Run** |

### 本地安装包 SHA-256

| 安装包 | SHA-256 |
|---|---|
| 千绘莉-在线版-Setup-1.2.8.exe | `129691A63684C286F7EE04719B4FC0ACE7FDDF6BB1343E5BF72F39B8360E0E3F` |
| 千绘莉-完整版-Setup-1.2.8.exe | `9E56BC7F7F04748C2C4A85F92B27CC75E08AB219FCA9EC2DCE04B581D06E03C8` |

### 隔离 Windows 安装复测

1. 在可还原的测试机或 VM 安装 1.2.7，分别准备默认和自定义目录快照。记录 API 模型和测试密钥、人设、聊天、Python 路径、声线、窗口位置和自启状态。完成旧版到 1.2.8 的升级后，添加并备份一条记忆，作为后续测试基线。
2. 覆盖安装完整版 → 完整版、在线版 → 在线版以及双向切换。至少一次选择另一安装盘符的空文件夹。核对配置、同 Windows 用户 DPAPI 解密、聊天和记忆。检查 Run 项指向新 exe，任务管理器的禁用状态保持原值。
3. 卸载并在新目录重装，核对用户数据仍可用。尝试同时启动两个目录的新版，确认同用户只保留一个写入实例。
4. 同时运行无关的测试 Python，再执行新版覆盖和正常卸载。确认无关 Python 继续运行、原桌宠和其语音子进程退出。占用关键文件后确认安装器可重试或取消。旧卸载器的扫描只在可还原环境中观察。

## 关键文件

- `electron/memory-store.js` 和 `electron/memory-ipc.js` 管理 SQLite、迁移、检索和受限访问。
- `js/ai.js`、`js/ui.js`、`js/memory-ui.js` 和 `index.html` 接入 AI、聊天和设置，主进程与 preload 提供桥接。
- `electron/voice.js` 和 `voice/chieri_server.py` 管理本地语音生命周期。
- `build/installer.nsh`、`build/full.config.js` 和 `package.json` 配置安装检查和两种打包目标。
