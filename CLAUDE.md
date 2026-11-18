# 千绘莉 · 给 Claude 的项目说明

「雪村千绘莉」是一个 **Live2D 风格**的互动角色兼 Windows 桌面宠物。没有 Cubism、没有 `.moc3`、没有任何运行时依赖：
两张平面立绘（`1.png`、`2.png`）在浏览器里被切成几个图层、铺上网格，由手写的形变器（`js/rig.js`）实时变形，
WebGL2 画出来；表情来自 `chc/` 里的表情差分，加载时自动对齐、裁出变化区域、羽化后贴回脸上。
同一套页面既能在浏览器里跑，也被 Electron 包成带托盘的桌面宠物，还能接用户自己的大模型 API 来聊天、生成反应，
并用在线 TTS 或内置的千绘莉 GPT-SoVITS 本地模型把台词读出来。

面向用户的功能说明（每种互动的反应、快捷键、录制模式、AI 设置）在 `README.md`，这里讲的是代码怎么组织、怎么改、哪些坑已经踩过。

## 文件地图

| 路径 | 内容 |
|---|---|
| `1.png` / `2.png` | 原始立绘，1024×1536，透明底。姿势 a（抱臂）/ 姿势 b（托腮）。**所有配置坐标都是这两张图的像素坐标** |
| `chc/` | 表情差分素材（见下文「素材」）。代码只用到 `chi12A_*`（配 1.png）和 `chi11A_*`（配 2.png） |
| `index.html` / `data-manager.html` | 主窗口和桌宠共用首页，独立窗口管理长期记忆和聊天。脚本标签直接加载浏览器 JS |
| `js/i18n.js` / `js/i18n-en.js` | 界面语言、固定台词和数据窗口的英文映射 |
| `js/user-profile.js` | 浏览器与 Electron 共用的称呼清理、生日月日校验和本机日期匹配 |
| `js/config.js` | 角色绑定数据：两个姿势的部位坐标、表情映射、触摸区域、马尾轮廓；全部台词 `LINES` |
| `js/lines_ja.js` | `VOICE_JA`：每句固定台词（`LINES` + app.js / ui.js 里直接写的几句）的日语版，键是中文原文；`''` 表示这句不出声 |
| `js/voice.js` | 语音的页面一侧：引擎表 `TTS_ENGINES`、默认设置 `DEFAULT_TTS`、`Voice`（翻译成日语、请求、WebAudio 播放、口型响度、预生成） |
| `js/rig.js` | `Rig` 类：给网格顶点预计算各形变器权重（`weights`），每帧按参数变形（`deform`）。纯数学，不碰 DOM/GL |
| `js/app.js` | 主体（约 1400 行）：烘焙图层与表情、WebGL 网格、状态与弹簧物理、互动行为、待机动画、录制模式、渲染、输入、右侧面板、启动 |
| `js/ai.js` | 设置存储 `Store`、默认人设 `DEFAULT_PERSONA`（= `rg.txt`）和 AI 客户端 `AI`（OpenAI 兼容 `/chat/completions` 或 Anthropic Messages；`ask` / `translate` 共用 `complete`） |
| `js/ui.js` | 角色以外的界面：对话窗 `Chat`、设置 `Settings`、语音设置 `VoiceUI`、桌宠窗口行为（悬停菜单、空白处鼠标穿透、无级缩放 `Sizer`）、录制模式按键 |
| `css/style.css` | 全部样式。`html.desktop`（Electron 里）、`html.pet`（桌宠窗口）、`html.rec-clean`（录制时隐藏界面）、`html.bg-day / bg-night / bg-plain`（舞台背景，`ui.js` 的 `applyBg`）切换外观。`.deco` 是大面板的底纹 + 金色内框（`::before` / `::after`，`z-index: -1`，所以元素自己必须是层叠上下文） |
| `img/` | 界面图片（`tools/ui-art.ps1` 生成，**别手改**）：背景 `bg_day/bg_night.jpg`、加载图 `loading.png`、对话框和设置框上探头的 `peek_chat/peek_settings.png`、表情贴纸 `st_happy/pout/think/shy.png`、粒子图集 `fx.png`（8 格 × 96 px，顺序 = `app.js` 的 `FX_SPRITES`）、标题徽章 `emblem.png`（也是网页图标）、气泡上的樱桃 `charm.png`、面板底纹 `pattern.png` |
| `art/` | GPT Image 生成的界面原图和提示词 `千绘莉化_提示词.md`。不打包进程序，`img/` 由它生成 |
| `electron/main.js` | 桌面外壳：主窗口（studio）和透明桌宠窗口二选一、托盘、右键菜单、设置文件（API Key 用 `safeStorage` 加密）、代发 AI 请求、全屏光标轮询、开机自启（`loginItem` / `setLoginItem`） |
| `electron/voice.js` | 语音的主进程一侧：`tts:fetch`（在线请求 + 磁盘缓存）、本地模型进程（启动 `voice/chieri_server.py`、排队、过期请求跳过）、运行环境的检测和一键安装 |
| `electron/preload.js` / `electron/data-preload.js` | 页面与外壳之间的接口。管理窗口用独立、受限的数据接口 |
| `electron/memory-store.js` / `electron/memory-ipc.js` | SQLite 迁移、备份、长期记忆提取与检索，以及历史对话管理 |
| `electron/companion-ipc.js` / `electron/agenda.js` / `electron/proactive.js` | 日程提醒、主动互动调度和自适应陪伴状态 |
| `electron/vision-ipc.js` / `electron/vision.js` | 共享来源与预览、屏幕授权、隐私关键词与视觉 API |
| `electron/pet-layer.js` / `electron/pet-fullscreen.ps1` | Windows 普通置顶的全屏避让。用 Win32 前台窗口与显示器边界判断，只在该层级启动检测 |
| `voice/chieri_server.py` | 本地声线服务：加载模型包一次，`POST /tts {text}` 返回 WAV，只听 127.0.0.1，启动它的 App 进程（`--parent`）不在了就退出；加载的每一步超过 90 秒会把 Python 调用栈打到日志里 |
| `voice/Chieri_GPTSoVITS_20261103/` | 千绘莉 GPT-SoVITS 模型包（权重、参考音频、固定版本的 GPT-SoVITS 源码和全部预训练模型，约 1.4 GB）。**只装进完整版**。读它自己的 `README.md` / `handoff.json`。1.2.5 起两个权重都是 **B站 雪村落雪** 提供的 v2ProPlus 模型（见「历史」）；界面、README、完整版安装包都要注明「感谢模型提供者，B站id：雪村落雪提供的模型」 |
| `io/` | 用户放进来的雪村落雪模型原件：`千绘莉-e50.ckpt`（GPT）、`千绘莉_e20_s6420.pth`（SoVITS v2ProPlus），已复制进模型包的 `delivery/` |
| `rg.txt` | 用户写的角色设定，就是默认人设的来源（内容复制在 `ai.js` 里，改了要同步） |
| `build/` | 图标、托盘图标 `tray.png` / `tray@2x.png`（`ui-art.ps1` 从徽章生成）、NSIS 安装界面图（`tools/installer-art.ps1` 生成）、`installer.nsh`（安装页文字、现有目录识别和应用退出检查。正在使用的文件会提示重试，真正卸载时清理开机启动项）、`installer-full.nsh`（完整版用：定义 `CHIERI_FULL` 再 `!include "${__FILEDIR__}\installer.nsh"`，完成页多一行模型致谢）、`full.config.js` / `lite.config.js`（两个版本的 electron-builder 配置） |
| `tools/align.html` | 求表情差分 → 立绘的对齐矩阵（梯度 NCC 粗到细搜索），结果就是 `config.js` 里的 `M` |
| `tools/sheet.html` | 把一套差分拼成网格图，挑表情时看 |
| `tools/ui-art.ps1` + `tools/Img.cs` | 把 `art/` 的原图做成 `img/`：抠图图片的 alpha 拉伸（生成图内部只有 252–254，外面有一圈淡雾）、去掉零散小点、裁到内容、高质量缩放（预乘 alpha，没有黑边）；粒子去掉光晕后按格切开拼成图集。`Img.cs` 是 System.Drawing + LockBits 的小工具类，脚本用 `Add-Type` 编译 |
| `tools/installer-art.ps1` | 从 `art/installer.png`（咖啡店门口）切安装包侧边图，用徽章画页眉图 |
| `serve.ps1` / `start.bat` | 零依赖的本地静态服务器（端口 8765）/ 双击启动网页版 |
| `README.md` / `README.en.md` | 中文 / 英文使用说明，内容一一对应，改一份就同步另一份；`docs/screenshot.jpg` 是两份 README 顶上的截图 |
| `tools/github-push.js` | 没有 git 的机器上推送到 GitHub：按 `.gitignore` 收集文件，只上传 GitHub 还没有的 blob，在分支顶上做一个提交（本地删掉的文件在仓库里也会删掉）。Token 读 `githubkey.txt`（已忽略）。`node tools/github-push.js lizitc/chieri-live2d "说明" [--dry]`，`--dry` 只列出要推送的文件 |
| `.gitignore` / `.gitattributes` | 不进仓库的东西（`video/`、模型包、`io/`、所有 zip、安装包、`githubkey.txt`……）/ `* -text`：文件按 Windows 上的原样（部分是 CRLF）存，git 不转换换行 |
| `.claude/launch.json` | Claude 预览面板用的服务器配置（`live2d` → serve.ps1:8765） |

不在这个包里（体积或用途原因）：`art/art.zip`（`art/` 里那些图的原始压缩包）、`voice/Chieri_GPTSoVITS_20261103/` 和它的压缩包 `Chieri_GPTSoVITS_20261103.zip`（1.2 GB，解压到 `voice/` 下；压缩包里是**最早的**权重，恢复后还要按「历史」里 1.2.5 那条换上 `io/` 的两个权重并改哈希）、`io/`（雪村落雪的模型原件，约 330 MB）、`node_modules/`（`npm install` 恢复）、`dist/`（安装包输出）、`.tools/`（开发机上的便携 Node 和 ffmpeg）、`video/`（宣传片渲染项目）、`seq/` 和 `Live2D_两套动作流程/`、`tools/frames.html`（已删除的「坐下 / 脱袜」功能的参考图和烘焙产物，见「历史」）。`serve.ps1` 里 `L2D_DEV` 那段 POST 保存逻辑就是给 frames.html 用的，现在没有用处。

## 运行与验证

- **网页版**：`powershell -File serve.ps1`，打开 http://localhost:8765/ 。必须走 http：加载时要读图片像素算遮罩，`file://` 下会被浏览器拦。在 Claude 桌面应用里直接用预览面板启动 `live2d` 配置即可。
  - `?pose=b` 以托腮姿势启动；`?pet` 模拟桌宠窗口的样式。
  - 调试句柄：`window.__L2D = { S, poses, pose, setFace, say, hop, toScreen, view, hitTest, Voice }`。例：`__L2D.setFace('shy', 3)`、`__L2D.S.opt.mesh = true`（显示网格）、`__L2D.say('测试', 'smile')`。
- **桌面版**：需要 Node 22+。`npm install` 后 `npm start`（= `electron .`）。Electron 版本锁在 45.2.1。
  - `L2D_START=pet|studio` 强制以桌宠 / 主窗口启动；`L2D_SHOT=<目录>` 会在 9 秒、16 秒各截一次所有窗口、打印页面日志，26 秒后自动退出，配合 `L2D_EVAL='js…'` 在页面里先执行代码——没有屏幕时验证桌面版就靠它。
  - 设置文件：`%APPDATA%\千绘莉\settings.json`（`app.getPath('userData')`），API Key 存成 `apiKeyEnc`、语音服务的 Key 一起存成 `ttsKeysEnc`（DPAPI）。网页版存在 localStorage。
  - **测试时别动用户的真实设置**：给 electron 加 `--user-data-dir=<临时目录>`（设 `APPDATA` 环境变量没用，Electron 不看它）；`LOCALAPPDATA` 环境变量则能把本地语音环境目录 `chieri-tts` 指到别处。
- **打包**：`npm run dist` → `dist/千绘莉-完整版-Setup-<版本>.exe`（带 `voice/` 模型，约 1.2 GB，打包约 10 分钟；压缩用 normal，maximum 要压很久还几乎不变小）；`npm run dist:lite` → `dist/千绘莉-在线版-Setup-<版本>.exe`（不带模型）。版本号取自 `package.json`，改版本时 `package-lock.json` 顶部两处一起改。electron-builder，NSIS，仅 x64，中文安装界面。两个配置（`build/full.config.js`、`build/lite.config.js`）都从 `package.json` 的 `build` 继承：`build.files` 决定装进去哪些文件，新增资源目录要加到那里；`voice/` 走完整版的 `extraResources`，装到 `resources/voice`。NSIS 安装包上限约 2 GB，所以 Python 环境和 PyTorch 不能打进去，由程序在用户机器上安装。
- 安装包里的 `build.files` 已经包含 `img/**` 和托盘图标；新增图片目录时别忘了加。
- 用 `npm test` 跑 SQLite、日程、主动互动和视觉逻辑测试。Windows 集成检查用 `tests/settings-ui-smoke.cjs` 和 `tests/assistant-smoke.cjs`，安装目录用 `tests/installer-location-smoke.ps1`。测试使用隔离的配置和库。涉及动作时再实际看画面：用预览/截图检查，拖一拖相关部位，再看 `S.opt.mesh` 下网格是否撕裂。
  - 预览面板在后台时 requestAnimationFrame 几乎不跑（2 秒只走 0.1 秒），动画会像卡住一样。要看某个时刻，就在页面里手动推进：循环调用 `simulate(dt/3)` 三次 + `render(dt)`，再截图。
  - 语音的整条链路可以不接真服务来测：起一个本地 mock（`/v1/audio/speech` 返回一段 WAV，带 CORS 头），把 OpenAI 兼容引擎的地址指过去，看它收到的文字（中文 / 日语、神态描写有没有去掉）。本地模型（`chieri_server.py`）只能在有 Python 环境的机器上测，最好有 NVIDIA 显卡。

## 架构：从两张图到会动的角色

1. **烘焙**（`bakePose`，每个姿势第一次用到时做一次，之后缓存在 `poses`）
   - 读立绘像素，生成「头发概率图」`hairMap`：从每缕头发的中心线出发，在冷灰色像素上泛洪，遇到深色线稿停止。
   - 从立绘上切出独立图层，各自有自己的网格：**尾巴**（`tail` 折线 + 半径）、**双马尾**（`locks`，按 `strands[].poly` 手描轮廓整块切走，`hairLayer`）、**下半截裙摆**（`skirt`，只取布料色，`skirtLayer`）。切走后身体层上的空洞用周围颜色补（push-pull），腿在裙子里按列向上延伸，所以掀裙子露出的是腿。
   - 表情：把 `chc/<set>_base.png` 上的各差分与参考表情 `ref` 比较，求出真正变化的区域（眼、眉、嘴、红晕），膨胀 + 模糊成羽化遮罩；另求一张只含眼睛的遮罩给眨眼用（闭眼帧 / 半闭眼帧叠在任意表情上）。
2. **网格**（`buildPose` / `Mesh`）：身体 12 px 一格、各图层 8 px 一格，全透明的格子剔掉。表情贴片网格在 chc 坐标里建，经 `M` 映射到立绘坐标——所以它和身体共用同一套形变，转头时脸跟着走。另有一块程序画的脸红贴图。
3. **形变**（`Rig.weights` 一次性 → `Rig.deform` 每帧）：每个顶点对每个形变器有一个 0–1 的软权重：头（椭圆 + 羽化，脖子以下归零）、头顶穹面（伪 3D 转头视差）、双耳（绕根部转 + 被拽长）、发束（弹簧摆）、尾巴（沿弧长渐进弯曲 + 拖拽）、呼吸、身体绕髋摇摆、裙摆滞后与被拉、戳脸凹陷、跳跃挤压（以脚为锚）。`deform` 的顺序就是叠加顺序：尾巴 → 耳朵 → 头发 → 后发视差 → 戳脸 → 头 → 呼吸 → 身体 → 裙子 → 跳跃。
4. **模拟**（`app.js` 的 `S` 状态 + `simulate(dt)`）：几乎所有量都是临界阻尼附近的弹簧（`spr()` + `stepSpring`）。每帧 `params()` 把 `S` 压成一个参数对象交给 `deform`。视线、呼吸、发束惯性与风、耳朵姿态、尾巴节奏（随心情变，并和身体运动耦合）、眨眼、口型、好感 `aff` / 不满 `ang` 的衰减都在这里。
5. **绘制**（`render` / `drawRig`）：`#under` 画布画脚下阴影 → WebGL `#stage`：尾巴（在后）→ 身体 → 裙摆层 → 马尾层 → 表情（旧表情、交叉淡入的新表情、说话时的张嘴差分）→ 眨眼遮罩 → 脸红 → 可选网格线 → `#over` 画布画粒子（爱心、音符、汗滴……）。说话气泡是 DOM（`#bubble`），每帧跟着头顶定位。

### 语音

- **一句话的路线**：`say(text, sem, dur, { ja, kind })`（app.js）→ `Voice.speak` → `make`：要日语就 `toJa`（显式的 `ja` → `VOICE_JA[text]` → 已经含假名就原样 → localStorage 里的译文缓存 → `AI.translate`），否则 `spoken(text)`（去掉（神态描写）、♪、～、Zzz）→ `synth` → `decode` → WebAudio `play`。新的一句会打断旧的（`seq`），晚到的音频丢掉（反应 15 秒、聊天 40 秒）。
- **AI 回复**先 `Voice.prepare` 再显示文字（聊天最多等 10 秒，触摸反应 6 秒），这样字和声音一起出来；`prepare` 产生的音频由随后同一句的 `speak` 取走。要日语时，系统提示让模型在 JSON 里多回一个 `ja` 字段，省一次翻译请求。
- **口型**：`frame()` 每帧把 `Voice.meter()`（分析器的 RMS）平滑进 `Voice.lvl`；`Voice.playing` 时 `S.mouth` 用它，否则照旧按打字节奏开合。
- **引擎**：`TTS_ENGINES`（字段表驱动设置界面）。`local: true` 的（`chieri`、`gsv`）只在 `Voice.caps.local` 为真时出现，也就是桌面完整版：主进程看 `voice/Chieri_GPTSoVITS_20261103/delivery/chieri-gpt.ckpt` 和 `voice/chieri_server.py` 在不在。网页版和在线版只有在线引擎。
- **桌面版**：在线请求走 `tts:fetch`（主进程发，没有 CORS），音频按「引擎配置（不含 Key）+ 文字」的 sha1 缓存在 `userData/tts-cache`（LRU，400 MB）。本地模型走 `tts:chieri`：先查缓存，再进队列；正在说的话插到预生成任务前面，同一窗口里被新一句取代的旧请求直接跳过（id 用 `performance.timeOrigin + now()`，重载页面后也递增）。本地模型的缓存键带 `modelId()`：模型包记录的哈希 + 两个权重文件的大小和修改时间（每句都重新 stat，很便宜），所以换了权重就不会再用旧模型合成的音频；`startServer` 发现 `modelId()` 和正在运行的服务启动时不一样，也会重启它。
- **本地模型进程**：`startServer` 用 `pythonFor()`（设置里的 python.exe，否则 `%LOCALAPPDATA%\chieri-tts\env`）跑 `chieri_server.py --model … --cache %LOCALAPPDATA%\chieri-tts\cache --device auto|cuda|cpu`，等标准输出里的 `CHIERI_READY {port, device, gpu, model, seconds}`（`model` = 实际加载的权重：GPT / SoVITS 的 sha256 前 8 位、`verified` 是否和 `training-summary.json` 记录的一致、`label` 一致时取 `model_update.info`（旧包是 `gpt_update.info`），界面上显示成「雪村落雪 · GPT-e50 / SoVITS-e20 afb37bc7」）；状态（off / starting / ready / error，ready 时带 `model`）推给页面（`tts:state`），日志推 `tts:log`。
  - 重启（1.2.6）：已有服务时，Python / 设备 / `modelId()` 变了才换掉它，换的时候日志写「■ 停止语音进程：原因（它加载了 N 秒，还没加载完）」；只是要求重启（「加载 / 重启模型」、保存语音设置）而设置没变、服务还在加载且不到 `LOAD_PATIENCE`（3 分钟）时不动它，只提示「模型还在加载」——导入 PyTorch 和 GPT-SoVITS 要一分钟以上且没有输出，以前用户以为卡住了去点重启，正好把它杀掉重来，永远加载不完。被换掉的服务的 promise 带 `stopped: true` 拒绝：`tts:start` 不再记成「✘ 语音进程已停止」也不置 error（以前会弹「本地语音：语音进程已停止」，引人再点重启），排队等它的台词改交给新服务。加载中每 20 秒提示一次「仍在加载」（`note()`：不进 `tail`，免得崩溃信息引用的最后两行变成它）；服务自己也打印阶段（导入 PyTorch / 导入 GPT-SoVITS / 加载权重 / 预热）。
  - 卡住时（1.2.7）：每个阶段用 `stage()` 开始，它重新挂上 `faulthandler.dump_traceback_later(STALL=90, repeat=True)`——一步超过 90 秒，所有线程的 Python 调用栈就打到 stderr（C 层的看门狗，主线程卡在 DLL 加载之类持有 GIL 的地方也能打出来），之后每 90 秒再打一次；预热完成后取消。日志里遇到 `Timeout (` 开头的行，前面会先插一句中文说明。超过 `LOAD_TIMEOUT`（10 分钟）还没就绪就杀掉，状态置 error，消息指向这些调用栈。拿到用户日志时先看最后一段调用栈的最内层几帧。
  - 服务端：权重哈希不一致会提示，权重缺失或回退到底模则报错。当前桌面端用 `--watch-stdin` 启动语音子进程，关闭管道时它退出。Windows 监听的是管道状态，不用阻塞读。超时只尝试结束当前实例的语音子进程。取消运行环境安装时只处理当前跟踪的安装命令及其子进程。
  - NSIS 根据所选安装目录请求对应的应用窗口退出，并检查程序和模型文件是否还被占用。占用时提示等待或取消。程序和安装器用现有的安装文件识别覆盖目录。旧卸载器的 Python 扫描行为见「历史」。
  - 服务参数跟随模型包中的参考音频和推理设置。工作目录切到 `vendor/GPT-SoVITS`，模型路径兼容含中文的安装位置。
- **一键安装**（`setup`）：找 64 位 Python 3.12（py 启动器或常见安装目录，不碰 `python` 别名，以免弹出应用商店）→ `venv` → PyTorch 2.7.1（`nvidia-smi` 能列出显卡就装 cu128，否则 CPU 版）→ 模型包的 `requirements-locked.txt`（可选清华镜像）→ 检测。检测通过才写 `env\chieri-ready.json`（开始安装时先删掉），默认环境**有这个标记才算就绪**（`pythonFor`），安装进行中 `startServer` 直接拒绝——venv 在第一步就建好了，以前只看 `python.exe` 在不在，装 PyTorch 的时候她一说话就会把服务拉起来，报 `No module named 'jieba'`（1.2.2 修）。**进度条**（1.2.5）：`progressBar(job)` 把五步（查找 Python / venv / PyTorch / 依赖 / 检测）按大致耗时分成份额（显卡版 PyTorch 占 62%），`tts:progress {pct, step, steps, title, detail, pulse, done, ok}` 最多 200 ms 推一次（最后的状态一定会发出），`info().progress` 让中途打开的设置也能看到；`pipMeter` 解析 pip 的输出：pip 24.1+ 加 `--progress-bar raw`（先 `pip --version` 判断），它每 0.25 秒打一行 `Progress <已下> of <总数>`（只针对 > 512 KB 的文件），这些行不进日志；PyTorch 一步按字节（估计 3.35 GB / CPU 0.28 GB，看到更大的文件就上调），依赖一步按包数（`requirements-locked.txt` 的行数，每个包解析时算 1/4、下载完算 3/4——新 pip 先只拿 metadata 解析完，再统一下载 wheel），`Building wheel` 90%、`Installing collected packages` 93%（`pulse` 条纹），没有 raw 进度时每个文件只跳一次并显示条纹。页面一侧是 `VoiceUI.progress`（`#vProg`）。只有 venv、没有标记的是「没装完」（`envPartial`，界面显示「继续安装」）；1.2.1 以前装好的环境没有标记，启动时 `adoptEnv` 跑一次检测，通过就补上。设置里填了自己的 python.exe 时不受标记和安装状态影响。主进程这一侧的逻辑可以 mock 掉 `electron` 和 `child_process` 在纯 Node 里测（不需要 Python）。

### 坐标系

- **立绘坐标**：1024×1536 像素，`config.js` 里所有点、椭圆、折线、轮廓都用它。两个姿势都是这个尺寸。
- **chc 坐标**：差分图自己的像素。`M = [a, b, c, d, e, f]` 是 canvas `transform` 形式的仿射矩阵，chc → 立绘（`X = a·u + c·v + e`，`Y = b·u + d·v + f`）。由 `tools/align.html` 求出：`tools/align.html?tgt=1.png&set=chi12A&exp=001&reg=x,y,w,h`。
- **屏幕坐标**：`toScreen` / `toSprite` 互转，`view.s` 是缩放。点击判定（`hitTest`）在立绘的静止坐标里做，并补偿当前的头部位移。

### `config.js` 里一个姿势的字段

`sprite` 立绘文件；`set` 差分套；`M` 对齐矩阵；`ref` 最接近立绘原脸的差分；`sem` 语义表情 → `[差分编号, 说话时的张嘴版或 null]`；`blink` 半闭 / 全闭眼差分；`noBlink` 本身就闭眼、不该再叠眨眼的差分；`eyeBandMax` 眼部遮罩的下界（chc 坐标，防止把嘴算进去）；`faceEllipse` 立绘自己的脸部区域；`head` / `neck` / `dome` / `hips` 头、颈（转头支点）、头顶穹面、髋（身体摇摆支点）；`torso` 躯干轮廓（切马尾时留在身体上的部分）；`upper` / `body` 呼吸与身体摇摆的权重渐变区间（y）；`skirt` 裙摆的 y 分段与 x 范围；`feetY` 脚底（跳跃锚点、阴影位置）；`ears` 耳根、耳尖、半径；`strands` 发束（`pts` 中心线、`r` 半径、`f` 羽化、`k` 弹簧刚度、`back` 是否后发、`grab` 能否拖、`layer` 是否切成独立图层、`poly` 切图层用的手描轮廓、`bend` 拉动时绕发绳整束转动（否则平移 + `stIn`）、`keep` 发绳下身体层保留原图的弧长比例）；`tail` 尾巴中心线、遮罩半径 `mr`、根部切口 `cut`、运动起点 `s0`、额外椭圆 `extra`；`cheeks` 脸红位置；`crown` 摸头区域；`chest`、`hem`；`zones` 头部以下的触摸区域（**按顺序，先命中先算**）；`bubble` 气泡锚点。

## 素材：`chc/` 的命名

`chi<姿势><构图><服装>_<编号>.png`
- 构图：`0x` 全身小图，`1x` 半身大图；姿势：`x1` 托腮（对应 2.png），`x2` 抱臂（对应 1.png）。
- 服装：`A` 女仆裙，`B` 学生制服，`C` 开衫 + 深蓝连衣裙（就是 1.png / 2.png 的服装）。三套的**脸部像素完全一样**，所以代码用 A 套，只取脸。
- `_base.png` 是没有表情的底图（对齐用），其余编号是只含表情变化的差分层，叠在 base 上。编号带 `a` 后缀的是同一表情的张嘴版（说话时切换）。`chi_x001.png` 未使用。
- 想挑表情：`tools/sheet.html?set=chi12A` 把整套拼出来看。

## 常见改动怎么做

- **换 / 加表情**：在 `POSES.<k>.sem` 里把语义名映射到差分编号（两个姿势都要配），在 `EXPR_LABELS` 加中文名；右侧面板的表情按钮由 `sem` 自动生成。要让 AI 也能选它，再加进 `ai.js` 的 `AI_EMOTIONS`。新编号会在烘焙时自动参与遮罩计算。
- **改台词**：`LINES`。**每组的第一句是录制模式固定说的那句**，和宣传片分镜、配音文件一一对应，不要随便改第一句或调换顺序。新台词（包括 app.js / ui.js 里直接写的）要在 `js/lines_ja.js` 里配上日语，否则日语声线会现场找 AI 翻译（没配 AI 就不出声）。检查：`Object.values(LINES).flat().filter(t => !(t in VOICE_JA))` 应该是空的。
- **改人设**：默认人设 `DEFAULT_PERSONA` 是 `rg.txt` 的内容（只整理了换行）。改了默认值，要把旧的默认值加进 `OLD_PERSONAS`，`Store.load` 才会把用户存着的旧默认换成新的（用户自己改过的不动）。
- **好感满的特别动作**：`ANIMS.love`。`please()` 让 `aff` 到 1 时置 `S.lovePending`，`frame()` 等没有拖拽 / 拎起时开始；`aff` 掉到 0.85 以下才会再次触发（`loveArmed`）。台词组 `loveMax`，身后的光和大爱心画在 `drawUnder`（`S.loveGlow`），爱心圈是 `heartBurst()`。
- **加语音引擎**：在 `TTS_ENGINES` 加一项（`fields` 自动生成设置项）、`DEFAULT_TTS` 加默认值、`Voice.request` 里拼请求；有 `apiKey` 字段的会被主进程自动加密保存。本地类的引擎标 `local: true`。
- **改某个部位的反应**：点击在 `TAPS`，拖拽在 `DRAGS`（都在 `app.js`），按下 / 移动 / 抬起分别在 `onDown` / `onMove` / `onUp`。部位范围在 `config.js` 的 `zones`、`ears`、`strands`、`tail`、`crown`。
- **加待机小动作**：`ANIMS`（时间轴函数，`u` 是动作内的秒数，用 `env()` 做淡入淡出），`idleMoment` 配对动作和语气词，由同一个随机间隔触发；录制模式的数字键映射在 `REC_ACTS`。
- **调头发 / 尾巴手感**：发束的 `k`（刚度）、`r` / `f`（影响范围）；摆动和风在 `simulate` 的「hair pendulums」段；尾巴节奏在「tail」段。改了 `poly` / `torso` 一定要在两个姿势下都打开网格拖一拖。
- **加一个姿势**：在 `POSES` 加一项（立绘、差分套、`M`、全部部位坐标），`M` 用 `tools/align.html` 求；面板按钮会自动出现。工作量主要在描 `strands[].poly` 和 `zones`。
- **AI**：提示词在 `AI.systemPrompt`，模型必须只回一个 JSON：`{reply, emotion, action, affection}`（要日语语音时再加 `ja`）；`AI.parse` 容错（找不到 JSON 就把整段当台词）。可选表情 `AI_EMOTIONS`、动作 `AI_ACTIONS`（落到 `doAction`）。新增服务商在 `AI_PRESETS`。桌面版请求从主进程发（`ai:request`），所以没有 CORS 问题。
- **桌宠窗口**：窗口尺寸、层级、缩放、拖动都在 `electron/main.js`；页面一侧在 `ui.js` 的 `initPet`。页面不能直接碰 Node，新能力要同时加 IPC（main.js）和 `petAPI`（preload.js）。

## 约定与坑

- 无构建步骤、无依赖：浏览器原生 JS（全局函数和常量），改完刷新即可。Electron 里通过自定义协议 `app://local/` 加载同一套文件。
- 加载时要做大量像素运算（`getImageData`），第二个姿势第一次切换时会再烘焙一次（几百毫秒到几秒）。
- 头发弹簧只作用于「像头发」的像素（`rig.hairAt`），所以挨着头发的袖子不会被带走；改发束范围时要考虑这一点。双马尾是另外切出的图层，靠 `poly` 决定归属，只有和 `torso` 重叠的地方才按颜色区分。
- 表情贴片只覆盖脸部变化区域，眨眼只覆盖眼睛，脸红是程序画的——三者都在同一张网格上跟着头动。
- 桌宠窗口：只有她身上的像素挡鼠标，透明处由页面实时 `setIgnoreMouse` 放行；菜单只在悬停时显示；只有按住菜单条才能拖动（直接拖身体是互动，不是搬窗口）。对话和设置会把窗口往左加宽一栏，不能盖住她（「隐藏聊天栏」时这一栏里只有底部的输入框）。
- 录制模式（F8）：她不再自己做小动作、不睡着，每个互动只说每组第一句，方便按分镜拍；桌面版还会注册 Ctrl+Alt+键 的全局快捷键（只在录制模式开着时占用）。
- 用户的语言是中文；界面文字、台词、文档都用中文（README 另有英文版 `README.en.md`）。代码注释用英文。
- 此工作区的 Git 远程是 `nightzheng/chieri-live2d`。大体积模型和密钥等私有文件按 `.gitignore` 排除。

## 当前功能

- 中英文界面与固定台词在 `js/i18n-en.js`，日语声线仍走 `js/lines_ja.js`。界面语言随设置保存，聊天原文不做回填翻译。
- 桌面 SQLite 保存聊天、长期记忆和提醒。默认按本地规则自动保存，AI 辅助可在旧消息移出上下文时提取。迁移前生成一致性快照。
- 主动闲聊支持自适应间隔和屏幕授权。日常动作与语气词同步触发。NSIS 支持识别已有安装目录，正式覆盖安装和真实服务按需在隔离环境复测。
- 生活提醒复用桌面提醒轮询。`electron/wellness.js` 按系统空闲时间累计喝水和起身间隔，并用本机时区记录每晚的夜深提醒。`localClock` 给即时问时、AI 回复和主动问候提供当前时段。
- 角色设置保存可选的 `userName` 和 `birthday`。生日格式是 `MM-DD`。开场按设备本地日期匹配，AI 提示词只包含称呼和当天是否生日。
- 中英文 README 记录当前用法，版本变更和测试细节可查 Git 历史。

## 历史：用户明确要求过 / 否决过的事

- 「坐下」「坐下脱袜」动作做过一版（参考 `Live2D_两套动作流程` 的分镜图，逐帧烘焙 + 光流补间），**效果不佳，已按用户要求删除**。不要在没被要求的情况下再加回来。
- 「拉头发会把胳膊 / 衣服一起拉走」反复出现过三次，最后的解决办法就是现在的：头发概率图 + 马尾按手描轮廓整块切层 + 躯干轮廓保护。动这块之前先理解为什么是这样。
- 「拖裙子导致腿部扭曲」→ 裙摆切成只含布料的独立图层，腿在下面延伸补齐。
- 「掀开裙子后右腿贴图缺角」（1.1.0）→ 大腿外侧轮廓是斜的，那几列最底下是裙子衬里而不是皮肤，原来认不出是腿、没往上补。现在 `skirtLayer` 会往上找夹在裙摆和衬里之间的那段皮肤；延伸时只取皮肤色，线稿单独存，只画在每条腿最外侧一列（否则斜轮廓会被拉成几道竖条）；裙摆下沿的深色描边跟着布料走，不会留在原地。
- 「头发图层太琐碎、底色残留」→ 马尾按轮廓整块切，而不是按颜色逐像素切。
- 「角色右侧头发与主体头发出现位移」（1.1.0）→ 马尾一摆，内侧和鬓发之间露出背景，还留着一条马尾自己的边。现在 `hairLayer` 在切口后面把相邻的鬓发颜色往里延伸约 20 px（暗一点，像在阴影里），靠躯干的地方把补好的袖子往外延伸一点；不再保留马尾原图的边。
- 1.1.0 新增设置「隐藏聊天栏」（`bubbleOnly`，`<html>` 上的 `bubble-only` 类）：对话只剩输入框，回复只在气泡里；聊天记录照常保存，关掉设置就能看到。聊天框头像改成整张脸的头像（`.avatar` 用百分比定位，尺寸变了也不会错位）。
- 「拉右侧马尾时头发还是和主体分离」（1.2.0）→ 补色只能遮住静止时的缝；拉的时候马尾整块往外走，内侧边缘把缝拉开。现在每条马尾的顶点有 `stIn` 权重（到轮廓内侧边缘的水平距离，`innerOffset`）：往外拉时，贴着内侧的那一圈只跟着走 8%，80 px 以外才完全跟随，所以马尾是被「拉长」而不是「拉走」。
- 「头发修复失败了：拉动后角色右侧（画面左侧）马尾的根部和发梢有断裂感」（1.2.1，用户要求**只改这一条**，另一条保持 1.2.0 的 `stIn` 做法）→ `stIn` 只把内侧一圈压住、外侧照走，马尾被撕成两层；平移时根部原地不动、发梢整块走，也会断。现在这条马尾标了 `bend: true`：
  - 形变（`rig.bendFor`）：拉动变成绕发夹 `pts[0]` 的转动，角度让抓点到手的位置，伸缩限制在 -6%～+10%，权重沿弧长 `smooth(0.03, max(0.35, s))`，抓点以下整体跟着转。
  - 轮廓：两个姿势的 `poly` 内侧都沿着马尾和鬓发外缘之间真正的空隙重描（鬓发外侧那几缕不属于马尾）；姿势 b 的 `torso` 左缘沿袖子自己的轮廓线描（包括荷叶边上角、下摆斜边），否则轮廓外的袖子边会被当成马尾带走，或者触发鬓发补色在袖子旁画出马尾形状的暗影。
  - 露出的袖子（`hairLayer`，只对 `bend` 部分）：每行取最外侧的布料像素当袖子外缘，对这条轮廓做闭运算（±8 行，补上发丝压出的缺口，真实的凸出不动），再平均成亚像素边；边内用布料色 push-pull 补满，被头发挡住的边补 2 px 轮廓线（软边），边外透明。布料色的小块不算头发的「针孔」，不会被马尾带走。发夹下 `keep: 0.24` 保留原图，鬓发补色只在马尾实心处画（不留发梢残影），阴影从切口往里几 px 才压暗（切口处没有暗线）。
  - 还剩的小瑕疵：姿势 b 里被泛洪标成头发的几小块（荷叶边上角压着的头发、荷叶边下的冷灰阴影）会跟着马尾走，拉开很远时马尾内缘有几处约 5 px 的小凸起。
- 「左侧头发（角色左侧 = 画面右侧）和左胳膊粘在一起」（1.2.1，紧接上一条）→ 这条马尾也改成 `bend: true, keep: 0.24`（两个姿势），现在两条马尾都不再用 `stIn`（代码还在，给以后不标 `bend` 的发束用）。
  - 姿势 a 这条马尾在下面绕了一圈、压在左袖上，原来的 `poly` 内缘直直地从这一圈中间切过去，袖子上那半圈留在身体层上 → 重描内缘，把整圈（连同外侧一缕细发）包进来，但绕开袖子上一道被泛洪误标成头发的褶皱阴影（约 612–631, 496–512），否则它会被马尾带走。`torso` 右缘加一点（`[648, 425]`），把袖子自己的轮廓线留在身体上。
  - `hairLayer` 的袖子重建因此多了一步：某一行布料外缘往外 5 px 内有头发，就说明真正的袖子边被头发盖住了，这些行的外缘取上下最近的「露出来的」行之间的直线（只往外推，不往里收）。补布料的颜色只从离头发 2 px 以外的干净布料取（否则会染上发丝软边的蓝灰）。
  - `bend` 马尾切口下的鬓发补色只延伸 3–7 px（原来 8–20 px）：整束甩开后，宽的那条补色会像一条粘在胳膊旁边的灰带。
- 「拉裙子时尾巴不动」（1.2.0）→ 尾巴根部在裙摆后面，原来只在身体层上跟着裙摆动，尾巴层不动，露出一截。现在尾巴层靠近根部的顶点（`tailHem`，沿弧长渐弱）按根部所在位置的裙摆权重跟着裙摆滞后和被拉；被裙子挡住的尾巴碎块（「Г」形残留）在烘焙时整块移到尾巴层。拉裙摆时尾巴还会进入 `flustered` 节奏（快速小幅抖动）。
- 1.2.0：好感满的特别动作；语音（在线 TTS + 内置千绘莉 GPT-SoVITS，分完整版 / 在线版两个安装包）；默认人设换成 `rg.txt`（不说「喵」，用（）写神态）。为配合新人设改了一些台词里的「喵」，但**每组第一句没动**（录制模式和宣传片要用），所以 `earPull`、`skirtLong`、`greet` 的第一句还带「喵」。
- 「更换自带 GPT-SoVITS 模型：Chieri_v2_models_only_20261103」（1.2.2 之后）→ 那个压缩包只有两个权重：`chieri-gpt.ckpt` 是以原第 4 轮 GPT 为底模续训 1 轮的新版（`chieri_register_v2`，`GPT-e1`，结构不变），`chieri-sovits.pth` 和原来的逐字节相同。只替换了 `delivery/chieri-gpt.ckpt`，参考音频 / 参考原文 / seed 不变。**换权重要同步改哈希**：`chieri_server.py` 启动时拿 `delivery/training-summary.json` 的 `weights_sha256` 校验权重（1.2.4 起不一致只警告，见下一条；包里的 `scripts/speak.py` 仍然直接退出）；`verify.py` 校验 `MANIFEST.json` 里每个文件（包括 README、JSON 自己），所以改过的文件都要刷新条目；`handoff.json` 也记着哈希。包里的文本文件是 CRLF。新增的 `training-summary.json` 的 `gpt_update` 记录了来源。语音缓存的模型键 `MODEL_ID` 改成两个权重哈希合起来的 sha1，换哪个权重旧缓存都会失效（预生成的固定台词要重新生成）。
- 「旧模型存在时默认不会切换到新模型，更新后模型无法正常加载」（1.2.3 → 1.2.4，没拿到用户的日志，按可能的原因全部堵上）：
  - 覆盖安装时旧版本的语音服务可能还活着：1.2.3 以前的服务加载完才开始监听 stdin，被中途关掉的 App 留下的服务会继续加载、占着显存和安装目录（它的工作目录就在 `vendor/GPT-SoVITS`），而且 `proc.kill()` 只杀得掉 venv 的启动器。安装程序换不掉被占用的文件，就会留下旧权重或新旧混杂；混杂时服务因为哈希对不上直接退出。现在：服务一启动就监听 stdin；停止时杀整棵进程树；第一次启动前和安装 / 卸载前都清掉残留的服务；哈希不一致只警告；`TTS_Config` 回退到底模时明确报错；缓存键和重启判断都看磁盘上的权重文件（`modelId()`）；设置里显示实际加载的权重。
  - 用户自己的 Python（设置里填的 python.exe）可能低于 3.11，原来用的 `hashlib.file_digest` 会直接报错，换成了分块读。
- 1.2.4 界面「千绘莉化」：用户用 GPT Image 按 `art/千绘莉化_提示词.md` 生成了一套图（`art/`），`tools/ui-art.ps1` 做成 `img/`。深藏青 + 樱花粉 + 金色细线的配色（`:root` 里的变量），大面板有底纹和金色内框（`.deco`）；咖啡店背景（白天 / 夜晚 / 自动 / 纯色，`Store.data.bg`，面板「显示」页）；标题徽章；奶油色气泡别着樱桃发夹；对话框顶上趴着她（`#chat` 因此不能 `overflow: hidden`，桌宠里对话栏从 86 px 处开始）、设置框上她探头（`.sheet` 留出 `--peek × 0.775` 的上边距）；`toast(msg, ms, mood)` 带表情贴纸；对话里欢迎 / 出错是贴纸卡片（`Chat.card`），等 AI 时是思考贴纸（`Chat.typing`）；加载画面是搅奶油的 Q 版；粒子用 `img/fx.png`（加载完之前用原来的矢量画法，新增 `paw` 粒子，摸头时和音符一起冒）；图标换成猫耳 / 肉球风格；托盘图标、网页图标、安装界面图都换了。
- 「将模型更换为工作区 io 目录下的模型，并注明：感谢模型提供者，B站id：雪村落雪提供的模型」（1.2.5）→ `io/千绘莉-e50.ckpt` → `delivery/chieri-gpt.ckpt`（以 `s1v3.ckpt` 为底模训练 50 轮，`GPT-e50`，张量和原来的一样），`io/千绘莉_e20_s6420.pth` → `delivery/chieri-sovits.pth`（**v2ProPlus**：文件头 `06`，原来的是 `05` = v2Pro；`upsample_initial_channel` 768、更多残差块，结构参数在权重自带的 config 里）。固定版本的 GPT-SoVITS 按文件头识别版本（`process_ckpt.get_sovits_version_from_path_fast`），推理只多用到包里已有的 `sv/pretrained_eres2netv2w24s4ep4.ckpt`，不需要 `s2Gv2ProPlus.pth` 底模；`chieri_server.py` 里 `TTS_Config` 的 `version: 'v2Pro'` 和环境变量 `version=v2Pro` 不影响（前者只决定路径回退，后者只选 v1 / v2 音素表）。参考音频 / 参考原文 / seed 不变。`training-summary.json` 的 `gpt_update` 换成 `model_update`（来源、致谢、被替换的哈希），`profile.json` / `handoff.json` / 包 README / `MANIFEST.json` 同步。致谢写在：语音设置（`#vChieri` 底部的 `.note.credit`）、README、模型包 README、`handoff.json`、完整版安装包完成页。新模型同样**没在这台机器上跑过**（没有 Python）。同一次加了一键安装的进度条（见「语音」）。
- 1.2.5 装好后日志反复出现「加载声线模型 → weights: … → 加载声线模型 → ✘ 语音进程已停止」（1.2.6）→ 每次都在加载途中被重启。代码里同一 Python / 设备下能停掉服务的只有：要求重启、模型文件变了、开始安装环境；加载中长时间没输出 + 被替换的旧服务误报成错误，让人一再点「加载 / 重启模型」。修法见「语音 → 本地模型进程 → 重启」；以后再出现，日志里的「■ 停止语音进程：原因」会说明是谁触发的。
- 1.2.6 的日志停在「导入 PyTorch 和 GPT-SoVITS…」之后 240 秒以上没动静（设备 cuda）（1.2.7）→ 一键安装最后的检测只 `import torch`，而且通过了（cuda 可用），所以卡在 GPT-SoVITS 的导入链里，这条链在这台开发机上从没跑过（没有 Python），从日志看不出卡在哪。1.2.7 不猜原因，先让下一份日志说清楚：分成「导入 PyTorch」「导入 GPT-SoVITS」两段并记时间、每段超过 90 秒打调用栈、10 分钟放弃（见「语音 → 本地模型进程 → 卡住时」）。同时去掉两个可疑点：服务不再有 stdin（读 stdin 的线程会让子进程启动时卡住），gradio 换成假模块。下次用户发来日志，先看 `Timeout` 那段调用栈最内层的几帧。
- 「开机自启的选项」（1.2.6）：设置「桌面宠物」里的 `#sAutoStart` 和托盘 / 右键菜单的「开机自动启动」。
  - 状态不存在 `settings.json` 里，系统里的登录项本身就是设置：`app.setLoginItemSettings({ path: execPath, args: ['--autostart'], openAtLogin })`。注册表值写在 `HKCU\…\CurrentVersion\Run` 下，值名默认是 AppUserModelId `com.lizitcxyz.nekomimi`；读的时候必须带同样的 `path` / `args`，否则对不上。
  - 任务管理器「启动应用」里禁用的，在 `StartupApproved\Run` 里，`getLoginItemSettings` 的 `executableWillLaunchAtLogin` 会是 false。这种情况设置里显示为没勾、并有提示；勾上保存时 `setLoginItemSettings`（`enabled` 默认为 true）会把它重新打开。设置只在勾选状态和系统不一致时才去改。
  - 带 `--autostart` 启动时，主窗口用 `showInactive`（桌宠窗口本来就是），不抢焦点。
  - 开发模式（`!app.isPackaged`）只记在内存里，绝不写注册表，否则会把 `node_modules\electron\dist\electron.exe` 注册成开机启动。
  - 卸载：`installer.nsh` 的 `customUnInstall` 删掉这两个值；`${isUpdated}`（覆盖安装时旧版本的卸载程序带 `--updated` 运行）时不删，安装路径不变，原来的值继续有效。
- 桌宠：拖动太灵敏 → 改成只能按住菜单拖；菜单只在鼠标放到小圆点上时展开；文本框不能挡住人物；大小要无级可调；眼睛要跟随全屏鼠标；长时间不动鼠标才睡，动鼠标就醒并有醒来动画。
