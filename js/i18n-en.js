'use strict';

const ENGLISH = Object.fromEntries(`
千绘莉|Chieri
取消安装|Cancel installation
重新安装环境|Reinstall environment
继续安装|Resume installation
不使用语音|Off
抱臂|Crossed arms
托腮|Chin in hand
头部 X|Head X
头部 Y|Head Y
头部 Z|Head Z
身体 X|Body X
闭眼|Closed eyes
张嘴|Open mouth
左耳|Left ear
右耳|Right ear
尾巴|Tail
脸红|Blush
呼吸|Breathing
平静|Calm
微笑|Smile
开心|Happy
惊讶|Surprised
震惊|Shocked
困扰|Troubled
害羞|Shy
无语|Speechless
困倦|Sleepy
赌气|Sulking
别过脸|Look away
哈欠|Yawn
温柔|Gentle
委屈|Hurt
好奇|Curious
享受|Content
原文（不翻译）|Original language
先翻译成日语再朗读|Translate to Japanese
参考音频|Reference audio
参考音频在服务器上的路径|Server path to reference audio
参考文本|Reference transcript
参考音频里说的话|Words spoken in the reference audio
参考语言|Reference language
朗读语言|Speech language
日语|Japanese
中文|Chinese
英语|English
韩语|Korean
粤语|Cantonese
音色|Voice
音色 ID|Voice ID
区域|Region
密钥|Key
硅基流动|SiliconFlow
通义千问|Qwen
智谱 GLM|Zhipu GLM
Ollama 本地|Ollama (local)
自定义（OpenAI 兼容）|Custom (OpenAI-compatible)
千绘莉声线 · 本地 GPT-SoVITS（日语）|Chieri voice · Local GPT-SoVITS (Japanese)
GPT-SoVITS 接口（api_v2）|GPT-SoVITS endpoint (api_v2)
OpenAI 兼容（/audio/speech）|OpenAI-compatible (/audio/speech)
Azure 语音服务|Azure Speech
在 fish.audio 的音色页面复制 ID|Copy the ID from the voice page on fish.audio
拽猫耳 · 摸摸头 · 戳脸蛋 · 拉尾巴 · 扯头发 · 双击跳跃|Pull ears · Pat head · Poke cheeks · Pull tail or hair · Double-click to jump
好感|Affection
不满|Annoyance
对话|Chat
桌面模式|Desktop mode
设置|Settings
控制面板|Controls
互动|Play
参数|Rig
显示|View
姿势|Pose
表情|Expression
动作|Actions
说句话|Speak
跳一下|Jump
抖耳朵|Twitch ears
甩尾巴|Swish tail
睡觉|Sleep
好感满|Full affection
恢复自动|Reset
背景|Background
白天是咖啡店的白天，晚上是夜晚|Follow the local time
自动|Auto
白天|Day
夜晚|Night
纯色|Plain
视线跟随鼠标|Follow the mouse
微风|Breeze
自动待机行为|Idle behavior
显示变形网格|Show mesh
录制模式（F8）|Recording mode (F8)
在线|Online
正在输入…|Typing…
清空对话|Clear chat
收起|Hide
收起（Esc）|Hide (Esc)
和她说点什么…（Enter 发送）|Talk to Chieri… (Enter to send)
发送|Send
按住菜单拖动，带她去别处|Drag here to move Chieri
调整大小|Resize
回到主窗口|Open main window
更多|More
拖动这个角调整大小|Drag this corner to resize
放大|Larger
缩小|Smaller
完成|Done
关闭|Close
保存全部|Save all
设置分类|Settings sections
AI 与角色|AI & character
AI 服务|AI provider
语音|Voice
提醒|Reminders
主动互动|Proactive
视觉|Vision
记忆与数据|Memory & data
桌宠|Desktop pet
桌面宠物|Desktop pet
服务商|Provider
接口地址|API URL
模型|Model
模型名称|Model name
测试连接|Test connection
角色|Character
名字|Name
人设|Persona
鼠标 1 分钟不动后犯困入睡|After 1 minute of inactivity
鼠标 3 分钟不动后犯困入睡|After 3 minutes of inactivity
鼠标 5 分钟不动后犯困入睡|After 5 minutes of inactivity
鼠标 10 分钟不动后犯困入睡|After 10 minutes of inactivity
从不睡觉|Never
用 AI 和她对话|Use AI for chat
用 AI 生成触摸反应（代替固定台词）|Generate touch reactions with AI
隐藏聊天栏（只留输入框，她的回复只显示在气泡里）|Show replies in the bubble and keep only the chat box
语音引擎|Voice engine
运行环境|Environment
检测中…|Checking…
留空 = 使用一键安装的环境|Blank uses the bundled environment
浏览|Browse
运行设备|Device
自动（有 NVIDIA 显卡就用显卡）|Auto (prefer NVIDIA GPU)
NVIDIA 显卡（CUDA）|NVIDIA GPU (CUDA)
CPU（很慢）|CPU (slow)
一键安装环境|Install environment
检测环境|Check environment
加载 / 重启模型|Load / restart model
使用国内镜像|Use China mirrors
安装进度|Installation progress
感谢模型提供者，B站id：雪村落雪提供的模型|Voice model by 雪村落雪 (Bilibili)
音量|Volume
朗读聊天回复|Read chat replies aloud
朗读触摸反应和日常台词|Voice touch reactions and idle lines
试听|Preview voice
预生成固定台词|Pre-generate fixed lines
提前合成全部固定台词并缓存，反应时立刻出声|Cache fixed lines for immediate playback
提醒与日程|Reminders & schedule
生活提醒|Wellness reminders
喝水和起身按电脑活跃时间累计。夜深提醒每天最多一次，离开电脑时会等你回来。用「保存全部」应用选项。|Hydration and stretch reminders count computer activity. The late-night reminder appears once per night while you are active. Select Save all to apply.
喝水提醒|Hydration reminders
起身活动|Stand and move
开启夜深提醒|Enable late-night reminder
夜深时间|Late-night time
夜深提醒时间|Late-night reminder time
朗读生活提醒|Read wellness reminders aloud
千绘莉运行时会提醒，包括隐藏到托盘时。睡眠或退出期间错过的提醒会在这里列出。|Reminders work while Chieri runs, including in the tray. Missed reminders appear here.
标题|Title
内容|Notes
日期|Date
时间|Time
时区|Time zone
重复|Repeat
单次|Once
每天|Daily
每周同一天|Weekly
工作日|Weekdays
自定义每周|Custom days
播放提醒语音|Play reminder voice
显示系统通知|Show system notifications
创建提醒|Create reminder
清除表单|Clear form
刷新|Refresh
待处理及错过的提醒|Pending and missed reminders
所有提醒|All reminders
开启主动闲聊|Enable proactive chat
闲聊频率|Chat interval
偶尔（约 45–90 分钟）|Occasionally (45–90 min)
适中（约 20–40 分钟）|Moderate (20–40 min)
频繁（约 10–20 分钟）|Often (10–20 min)
自定义|Custom
最小间隔|Minimum
最小间隔（分钟）|Minimum interval (minutes)
安静开始|Quiet from
安静结束|Quiet until
每日上限|Daily limit
用聊天模型生成主动台词|Generate proactive lines with AI
主动闲聊时查看屏幕|Check the screen during proactive chat
查看频率|Check interval
每次主动闲聊|Every proactive chat
每 2 次主动闲聊|Every 2 proactive chats
每 3 次主动闲聊|Every 3 proactive chats
每 5 次主动闲聊|Every 5 proactive chats
每 10 次主动闲聊|Every 10 proactive chats
屏幕来源与隐私|Screen source & privacy
选定来源并确认一次即可记住授权。锁屏时暂停，可随时撤销；更换来源或服务需要重新授权。|Choose a source and confirm once. Capture pauses on lock. Revoke any time or approve again after changing the source or service.
共享范围|Share type
显示器|Display
窗口|Window
共享来源|Source
隐私关键词|Privacy keywords
每行一个词|One keyword per line
匹配窗口标题会跳过截图。匹配视觉描述会跳过转发。图片里出现但标题没有的文字可能已发送给视觉服务。|Matching window titles block capture. Matching descriptions block forwarding. Text visible only in the image may reach the vision provider.
主动观察的共享预览|Proactive screen preview
刷新来源|Refresh sources
预览截图|Preview screenshot
记住授权|Remember permission
撤销授权|Revoke permission
允许给聊天模型附带相关长期记忆|Include relevant long-term memories
根据回应调整主动频率|Adapt frequency to your responses
调节强度|Adjustment
轻度|Gentle
适中|Moderate
明显|Strong
陪伴偏好|Companionship
日常|Normal
保持安静|Stay quiet
保持专注|Focus
同时朗读主动台词|Read proactive lines aloud
动作与语气词|Idle acts & voice
频繁（约 1–2 分钟）|Often (1–2 min)
适中（约 5–10 分钟）|Moderate (5–10 min)
偶尔（约 15–30 分钟）|Sometimes (15–30 min)
很少（约 30–60 分钟）|Rarely (30–60 min)
伸懒腰、哼歌等日常动作与语气词一起触发。安静、休眠或忙碌时会顺延。|Stretching, humming and other idle actions play with their sounds. Quiet, sleep or busy periods may delay them.
视觉感知|Screen vision
启用独立视觉 API|Enable a separate vision API
自定义 OpenAI 兼容|Custom OpenAI-compatible
视觉模型|Vision model
清除已存的视觉密钥|Remove stored vision key
尺寸|Image size
JPEG 质量|JPEG quality
超时|Timeout
10 秒|10 seconds
20 秒|20 seconds
30 秒|30 seconds
分析合成测试图|Analyze test image
所选画面可能包含密码或私人信息。单次发送和开始观察都需要确认。截图仅在内存中处理，描述默认不写入聊天或长期记忆。|The selected area may contain private information. Confirm before sending or observing. Screenshots are processed in memory.
范围|Capture type
想问什么|Question
列出共享来源|List sources
发送这张截图|Send this screenshot
停止 / 丢弃截图|Stop / discard
将发送的截图预览|Preview of the outgoing screenshot
限时定时查看|Timed observation
开始前先预览和确认。隐藏窗口、锁屏、休眠或到期时结束。|Preview and confirm first. Observation stops on hide, lock, sleep or expiry.
时长|Duration
每隔几分钟|Interval (min)
开始观察|Start observing
用角色语气回应|Respond as Chieri
朗读描述|Read description
保存到长期记忆|Save to memory
清除视觉上下文|Clear vision context
启用长期记忆保存和 AI 对话引用|Enable long-term memory and retrieval
自动保存|Auto-save
关闭自动提取|Explicit requests only
本地规则|Local rules
AI 辅助|AI-assisted
本地规则类别|Local rule categories
偏好（我喜欢…）|Preferences (I like…)
习惯或技能（我经常…）|Habits and skills (I often…)
长期目标|Long-term goals
重要经历（我曾经参加…）|Significant experiences
住处或职业|Residence or occupation
引用条数|Memory limit
引用字节|Byte budget
记忆和聊天保存在本机。开启长期记忆后，相关记忆可随聊天请求发送给已配置的 AI 服务。数据库备份包含聊天原文。|Chat and memories are stored locally. Relevant memories may accompany AI requests when enabled. Backups contain chat text.
重试 / 刷新|Retry / refresh
打开文件夹|Open folder
迁移到新目录|Move database
迁回默认目录|Move to default
重新定位已有库|Locate database
创建数据库备份|Back up database
恢复数据库备份|Restore backup
导入记忆|Import memories
导出记忆|Export memories
导入提醒|Import reminders
导出提醒|Export reminders
打开记忆与聊天管理|Manage memories and chat
最近一次 AI 聊天使用的记忆|Memories used in the last AI chat
显示层级|Window level
最前（盖过全屏程序和任务栏）|Above full-screen apps
置顶（在普通窗口上面）|Always on top
普通（和其他窗口一样）|Normal
大小|Size
鼠标穿透（完全不挡操作，从托盘图标关闭）|Click through (turn off in the tray)
启动时直接进入桌面模式|Start in desktop mode
开机自动启动（按上一项打开桌面宠物或主窗口）|Launch at sign-in
录制模式快捷键|Recording shortcuts
录制模式|Recording mode
F8 退出|F8 to exit
她不会自己乱动，台词固定为分镜里那句。|Idle action is paused and scripted lines are fixed.
别的窗口在前台时，按 Ctrl+Alt+同一个键。|Use Ctrl+Alt with the shortcut from another window.
屏幕观察进行中|Screen observation active
正在观察屏幕|Observing screen
停止|Stop
正在烘焙表情差分|Preparing expressions
记忆与聊天记录|Memories & chat history
数据分类|Data sections
长期记忆|Memories
聊天记录|Chat history
记忆搜索|Search memories
内容、标签或类型|Text, tags or type
状态|Status
当前|Active
已归档|Archived
记忆类型|Memory type
全部类型|All types
事实|Fact
偏好|Preference
兴趣|Interest
事项|Item
约定|Commitment
关系|Relationship
其他|Other
搜索|Search
上一页|Previous
下一页|Next
添加或编辑记忆|Add or edit a memory
记忆内容|Memory
类型|Type
标签|Tags
重要性|Importance
一般|Normal
常用|Frequent
重要|High
有效至|Expires
有效至，留空表示不限时|Expiry date, optional
添加记忆|Add memory
取消编辑|Cancel editing
清除全部长期记忆|Clear all memories
桌面记录按轮保存。AI 只使用近期消息作为上下文。|Desktop chat is saved by turn. AI uses recent messages as context.
聊天搜索|Search chat
搜索历史消息|Search past messages
搜索 / 最新|Search / latest
较新|Newer
较早|Older
清除聊天记录|Clear chat history
打开对话|Open chat
设置…|Settings…
暂停主动互动|Pause proactive chat
停止屏幕观察|Stop screen observation
最前（盖过全屏和任务栏）|Above full-screen apps
无级调节…|Custom size…
小|Small
中|Medium
大|Large
特大|Extra large
鼠标穿透|Click through
开机自动启动|Launch at sign-in
隐藏到托盘|Hide to tray
显示桌面宠物|Show desktop pet
退出|Quit
自定义（OpenAI 兼容）|Custom (OpenAI-compatible)
Ollama 本地|Local Ollama
通义千问|Qwen
智谱 GLM|Zhipu GLM
还没有配置 AI，她只会说固定台词。|AI is not configured. Chieri will use fixed replies.
去设置|Open settings
旧聊天格式无法读取，原记录仍保留。|The old chat format could not be read. Original records were kept.
聊天数据库暂不可用。可在记忆与数据设置中重试或恢复。|Chat storage is unavailable. Retry or restore in Memory & data.
上一条消息未写入聊天数据库。|The last message could not be saved.
请等待当前对话结束|Please wait for the current chat to finish.
清除全部聊天记录？长期记忆保留。|Clear all chat history? Long-term memories will be kept.
清除失败，请检查记忆数据库状态|Could not clear chat. Check the database.
还有未保存的设置，放弃修改并关闭？|Discard unsaved settings and close?
设置已保存|Settings saved
无法保存语言设置|Could not save the language setting.
成功|Success
异常|Error
隐藏|Hide
显示密钥|Show
连接中…|Connecting…
合成中…|Generating audio…
取消|Cancel
继续|Continue
同意发送|Allow sending
保存修改|Save changes
编辑|Edit
编辑并恢复|Edit & restore
删除|Delete
删除这轮对话|Delete this turn
删除这轮对话中的全部消息？长期记忆保留。|Delete this conversation turn? Long-term memories will be kept.
删除这条长期记忆？|Delete this memory?
删除全部长期记忆（含已归档记忆）？聊天记录及备份文件保留。|Delete all long-term memories, including archived ones? Chats and backups will be kept.
记忆已保存|Memory saved
迁移当前库到默认目录？|Move the active library back to the default location?
如果默认目录仍有这个库的旧副本，会移动到保留文件夹。当前库也会保留。|Any older copy at the default location moves to a retained folder. The current library is also kept.
使用所选位置的现有数据库？|Use the existing database at the selected location?
这个操作会切换当前库。之前的文件会保留。|This switches the active library and keeps the existing files.
恢复备份中的记忆、聊天和提醒？|Restore memories, chats and reminders from this backup?
目标文件夹内原有的库会保存在 retained 文件夹内。|The previous library in the destination folder is saved in the retained folder.
已保存长期记忆。|Long-term memory saved.
未能保存长期记忆。请检查记忆与数据设置。|Could not save the memory. Check Memory & data.
长期记忆已清除|All memories cleared
聊天记录已清除|Chat history cleared
没有匹配的聊天记录|No matching chats
没有匹配的记忆|No matching memories
暂无|None yet
暂无提醒|No reminders yet
没有待处理的提醒|No pending reminders
查看提醒|View reminders
提醒已保存。|Reminder saved.
启用|Enable
暂停|Pause
已暂停 / 完成|Paused / done
待显示|Pending
错过|Missed
待完成|Shown
稍后提醒|Snoozed
补发|Show again
10 分钟后提醒|Snooze for 10 min
跳过|Skip
安静|Quiet
专注|Focus
活跃交流|Active chat
关心提醒|Reminder
低打扰|Low interruptions
正在处理交互、语音或处于互动冷却期|Busy with chat, audio or a cooldown
当前处于安静时段|Quiet hours
系统锁定或休眠|System locked or sleeping
主动闲聊已关闭|Proactive chat is off
按设置的间隔等待主动发言|Waiting for the next scheduled chat
有正式提醒等待处理|A reminder is pending
手动设置|Set manually
近期主动发言未获得聊天回应，正在延长间隔|Waiting longer after unanswered chats
括号内是主动闲聊的基础间隔。安静时段、连续未回应或达到每日上限时可能更久。|These are base intervals. Quiet hours, unanswered chats and the daily limit can delay the next chat.
已暂停候选提取和对话引用。你仍可管理已有记忆。|Extraction and retrieval are paused. You can still manage saved memories.
你主动说「记住」或明确更正时，符合要求的内容会直接保存。|Qualifying “remember” requests and explicit corrections save immediately.
在本机按勾选类别识别「我喜欢」「我经常」等固定句式。符合条件的内容直接保存。临时事项、明显的假设和敏感信息会过滤。|Local rules save qualifying phrases in selected categories. Temporary plans, obvious hypotheticals and sensitive information are filtered.
保留本地规则。当旧消息超出 16 条或 6000 字符的聊天上下文预算时，可将最多三条筛选过的用户消息交给聊天服务。每 10 分钟最多一次，每 24 小时最多六次。通过检查后自动保存。|Runs local rules and can send up to three filtered older messages when they leave the 16-message or 6,000-character context. At most once per 10 minutes and six times per day. Validated results save automatically.
视觉设置独立于聊天服务|Vision uses a separate provider.
当前平台不支持屏幕查看|Screen capture is unavailable on this platform.
视觉设置已保存|Vision settings saved
已加密保存，留空保留|Encrypted. Leave blank to keep.
已经处理截图|Screenshot processed
已完成截图分析|Screenshot analyzed
已取消发送|Send canceled
已取消授权。|Permission canceled.
已撤销主动观察授权|Proactive screen permission revoked
视觉会话已停止|Vision session stopped
已清除视觉上下文|Vision context cleared
已保存到长期记忆|Saved to long-term memory
没有可分享的来源。|No shareable sources.
已更新共享来源，选好后可预览。|Sources updated. Choose one to preview.
请先保存全部设置，再预览。|Save settings before previewing.
请先保存全部设置，再选择共享来源。|Save settings before selecting a source.
请先保存全部设置，再授权。|Save settings before granting permission.
请先保存全部设置，再测试视觉服务。|Save settings before testing vision.
已生成本地预览。请检查画面，两分钟内可以确认。|Local preview ready. Check it and confirm within two minutes.
测试已取消|Test canceled
唔……耳朵有点痒。|Mm… my ears tickle.
尾巴怎么又动啦……|Why is my tail moving again?
呼啊～…|Yaaawn…
哼～哼哼♪|Hmm-hmm ♪
嗯嗯～♪|Hehe ♪
哈啊～…|Yawn…
我看完啦，描述在视觉感知里。|I'm done. The description is in Screen vision.
唔…刚刚没听清，能再说一遍吗？|Mm… I missed that. Could you say it again?
要不要伸个懒腰？我才没有在催你呢。|How about a stretch? I'm not trying to rush you.
我在这里陪你哦。有想聊的就说吧。|I'm right here. If you want to talk, go ahead.
早上好呀，今天也按自己的节奏来吧。|Good morning. Take today at your own pace.
中午好呀，要不要给自己留一点休息时间？|It’s around noon. How about taking a little break?
下午好呀，歇一会儿也没关系。|Good afternoon. It’s fine to take a little break.
晚上好呀，今天过得怎么样？|Good evening. How was your day?
夜深啦。我还在这儿，有想说的就说吧。|It’s late. I’m still here if you feel like talking.
喝口水吧，先歇一下。|Time for a sip of water and a short break.
要不要起身走几步，活动一下？|How about standing up and moving around a little?
时间不早了，有空就准备休息吧。|It’s getting late. Start winding down when you can.
你今天过得怎么样？我只是随口问问啦。|How's your day going? I'm just asking, that's all.
`.trim().split('\n').map(line => line.split('|')));

if (typeof module !== 'undefined') module.exports = ENGLISH;

const ENGLISH_LINES = {
  earPull: "Wha?! Don't pull my ears!|Ow! That hurts!|My ears are sensitive, you know!|L-let go!",
  earRelease: "Hmph… don't do that again.|Ugh… you'll stretch my ears out.|Honestly…",
  earFlick: "Hmm?|My ears tickle…|…Did you just touch my ear?",
  pat: "Prrr… ♪|Mm… that feels nice…|I suppose you could keep going a little longer…|P-please don't treat me like a child!",
  patEnd: "…A little more would be nice.|Hehe.|…It's not like I enjoyed that.|Oh… are you stopping?",
  headTap: "Hmm? What's wrong?|Do you need something?",
  poke: "M-my face will get squished!|Mm… why are you poking me?|Mmph!|…?",
  pokeMany: "Enough! One more poke and I'm getting mad!|Hmph!",
  tail: "My tail… my tail is off-limits!|Don't pull my tail!|N-no, not there!",
  tailEnd: "My tail's all puffed up…|…Meanie.",
  hair: "I spent ages tying it up…|You'll mess up my hair…|D-don't pull my hair.",
  body: "What's up?|Something you want to say?|Hmm?",
  skirt: "…You can't do that.|W-where are you looking?!",
  clip: "My cherry hair clip looks nice, doesn't it?|That clip is precious to me.|Don't knock it off!",
  neck: "Ah! My neck tickles…|Eep… that tickles!|Eek!",
  hand: "M-my hand?|Do you… want to hold hands?|Your hand is so warm.",
  handHold: "Hehe, we're holding hands…|Where are you taking me?|D-don't let go…",
  arm: "Hmm?|Is something wrong with my sleeve?|Do you need something?",
  armTug: "D-don't tug on me!|Where are we going…?|Whoa, I'm losing my balance!",
  bow: "My bow's coming undone!|This bow is hard to tie…|Don't undo it!",
  chest: "…?|W-where are you poking?!|Something you want to say?",
  belly: "Whoa! Not my belly!|Ah! That tickles!|Does my tummy look a little round…?",
  leg: "Y-you can't just touch my legs!|Huh?!|…Pervert.",
  feet: "Hahaha, that tickles!|N-not the soles of my feet!|You'll get my socks dirty!",
  push: "W-whoa! I'm falling!|Don't push me!",
  tailHappy: "My tail's wagging? It is not!|Hmm-hmm.",
  angry: "Hmph! I'm ignoring you!|I-I'm really mad now!",
  forgive: "Hmph… a pat might persuade me to forgive you.|…I'll forgive you this time.",
  idle: "It's lovely out today.|♪～|I'm a little hungry…|Shall we go for a walk?|…What are you looking at?|Have you finished today's plans?",
  yawn: "Yaaawn…|I'm getting sleepy…",
  sleep: "Zzz…|Zzz…",
  wake: "I-I wasn't dozing off!|Ah! I wasn't asleep!|Mm…? Did I just fall asleep?",
  jump: "Here we go!|Hehe.|Hmm-hmm ♪",
  skirtPull: "Idiot! Get your hands off!|Eek?! D-don't pull my skirt!|Y-you'll see underneath…!",
  skirtLong: "Let go! I'm really going to get mad!|…Pervert.",
  skirtEnd: "…Hmph.|Now it's all wrinkled. Honestly…|Do that again and I'll scratch you!",
  carry: "Huh?! M-my feet are off the ground!|Whoa! Where are you taking me?|Put me down!|Whoa… so high up…",
  drop: "Is this my new home?|Phew… finally on solid ground.|Next time, warn me first.|There we go. Landed!",
  greet: "Welcome back! ♪|Hello there!|Good morning. Have you made your plans for today?",
  pose: "Let's try another pose.|How's this?",
  loveMax: "…You've worked so hard. I suppose I can admit you're someone special to me.|I-I'm not that happy! …I just want to stay by your side.|These feelings… they're all your fault. You'd better take responsibility.",
};
