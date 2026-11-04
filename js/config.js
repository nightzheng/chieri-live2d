// Character rig configuration. All coordinates are in sprite pixels (1024x1536).
// M maps chc expression-patch pixels -> sprite pixels (found by tools/align.html).

const EXPR_LABELS = {
  neutral: '平静', smile: '微笑', happy: '开心', surprised: '惊讶', shock: '震惊',
  troubled: '困扰', shy: '害羞', jito: '无语', sleepy: '困倦', closed: '闭眼',
  pout: '赌气', aside: '别过脸', yawn: '哈欠', gentle: '温柔', sad: '委屈', curious: '好奇', enjoy: '享受',
};

const POSES = {
  a: {
    name: '抱臂',
    sprite: '1.png',
    set: 'chi12A',
    M: [0.653, 0, 0, 0.653, 193.262, 8.224],
    ref: '104',                 // closest to the sprite's own face
    eyeBandMax: 445,            // chc-space y below which eye masks are cut (keeps mouths out)
    faceEllipse: { c: [510, 285], rx: 95, ry: 70 },
    blink: { half: '704', closed: '902' },
    // semantic -> [patch id, talk (mouth-open) alt or null]
    sem: {
      neutral: ['104', '104a'], smile: ['102', '101'], gentle: ['101', '101a'], happy: ['502', null],
      surprised: ['402', '402a'], shock: ['401', '401a'], troubled: ['201', '201a'], shy: ['504', '503'],
      jito: ['901', null], sleepy: ['704', '704a'], closed: ['902', null], yawn: ['703', null],
      pout: ['702', '702a'], curious: ['001', '001a'], sad: ['705', '705a'], enjoy: ['902', null],
    },
    noBlink: ['502', '902', '703'],
    head: { c: [505, 195], rx: 178, ry: 172, feather: 45 },
    neck: [510, 370],
    dome: { c: [512, 262], rx: 125, ry: 120 },
    hips: [512, 980],
    // torso/sleeves outline: stays on the body layer when the twin tails are cut out
    torso: [[365, 372], [645, 372], [648, 425], [650, 720], [600, 900], [420, 900], [362, 640]],
    upper: [400, 720],          // breath weight: 1 above y0 -> 0 at y1
    body: [700, 1040],
    skirt: { y: [880, 1080, 1135, 1175], x: [160, 820] },
    feetY: 1510,
    ears: [
      { pivot: [388, 145], tip: [306, 66], r: 42, side: -1 },
      { pivot: [612, 118], tip: [676, 18], r: 40, side: 1 },
    ],
    strands: [
      // poly: traced outline of the twin tail cut into the locks layer (tie at the top, the gap / line
      // art next to the side hair on the inside, background on the outside)
      // bend: pulled, it turns about its tie as one piece (rig.bendFor), and what it uncovers is rebuilt
      // as cloth or background (hairLayer); keep: how far down from the tie the body keeps the original
      { name: 'tailL', pts: [[365, 135], [335, 250], [292, 380], [252, 480], [222, 575]], r: 58, f: 35, back: true, k: 70, grab: true, layer: true, bend: true, keep: 0.24,
        // (inner side: the gap between the tail and the side lock's ends, which sweep out over the shoulder)
        poly: [[190, 118], [300, 118], [318, 124], [350, 146], [384, 158], [392, 180], [388, 206], [356, 214], [357, 232], [358, 260], [346, 280], [340, 300],
          [328, 320], [312, 340], [302, 360], [292, 380], [284, 400], [278, 420], [272, 440], [274, 460], [276, 472], [275, 482], [275, 492], [278, 502],
          [281, 510], [284, 516], [285, 521], [283, 530], [284, 550], [284, 575], [286, 590], [282, 610], [280, 640], [190, 640]] },
      { name: 'tailR', pts: [[676, 112], [690, 240], [700, 380], [690, 500], [672, 600]], r: 50, f: 30, back: true, k: 80, grab: true, layer: true, bend: true, keep: 0.24,
        // (inner side, lower down: round the whole loop the tail makes over her sleeve, so none of it stays on her arm)
        poly: [[650, 128], [668, 118], [690, 96], [720, 92], [820, 92], [820, 640], [628, 640], [636, 590], [630, 572], [625, 556], [623, 540],
          // (but not the crease shadow across the sleeve that the thin strand touches)
          [622, 525], [626, 516], [632, 512], [632, 497], [618, 494], [620, 486], [625, 476], [631, 466], [639, 456], [646, 446], [650, 400], [656, 330],
          [657, 260], [655, 200]] },
      { name: 'lockL', pts: [[438, 295], [425, 420], [405, 520], [385, 600]], r: 28, f: 18, k: 110 },
      { name: 'lockR', pts: [[588, 290], [608, 420], [628, 520]], r: 24, f: 16, k: 120 },
    ],
    // tail is cut out into its own layer: mr = mask radius, cut = root edge kept in the body layer, s0 = where motion starts
    tail: { pts: [[722, 1122], [745, 1170], [752, 1230], [745, 1290], [722, 1330], [690, 1352], [652, 1356]], r: 24, mr: 34, cut: { y: 1124 }, s0: 0, extra: [] },
    cheeks: [{ c: [455, 300], r: 30 }, { c: [570, 296], r: 30 }],
    crown: { c: [505, 130], rx: 150, ry: 90 },
    chest: { c: [512, 560], rx: 140, ry: 160 },
    hem: { c: [490, 1090], rx: 320, ry: 70 },
    // touch zones below the head, checked in order (first hit wins)
    zones: [
      { type: 'clip', c: [358, 182], rx: 34, ry: 34, head: true },
      { type: 'neck', c: [512, 382], rx: 56, ry: 30 },
      { type: 'hand', c: [556, 880], rx: 58, ry: 48 }, { type: 'hand', c: [660, 702], rx: 44, ry: 42 },
      { type: 'bow', c: [500, 742], rx: 52, ry: 72 },
      { type: 'arm', c: [480, 640], rx: 175, ry: 58 }, { type: 'arm', c: [612, 760], rx: 50, ry: 150 }, { type: 'arm', c: [395, 590], rx: 50, ry: 70 },
      { type: 'chest', c: [512, 470], rx: 120, ry: 80 },
      { type: 'belly', c: [520, 830], rx: 120, ry: 70 },
      { type: 'skirt', c: [490, 1090], rx: 320, ry: 70 }, { type: 'skirt', c: [500, 960], rx: 260, ry: 90 },
      { type: 'feet', c: [490, 1460], rx: 120, ry: 70 },
      { type: 'leg', c: [480, 1270], rx: 125, ry: 140 },
    ],
    bubble: [700, 180],
  },
  b: {
    name: '托腮',
    sprite: '2.png',
    set: 'chi11A',
    M: [0.592, 0, 0, 0.592, 237.116, 24.348],
    ref: '001',
    eyeBandMax: 455,
    faceEllipse: { c: [520, 285], rx: 95, ry: 62 },
    blink: { half: '502', closed: '301' },
    sem: {
      neutral: ['001', '002a'], smile: ['101', '101a'], gentle: ['303', '303a'], happy: ['102', '102a'],
      surprised: ['402', '402a'], shock: ['403', '401'], troubled: ['602', '602a'], shy: ['701', '701a'],
      jito: ['901', null], sleepy: ['502', null], closed: ['301', null], yawn: ['301', null],
      pout: ['202', '202a'], curious: ['201', '002'], sad: ['601', null], enjoy: ['102a', null], aside: ['302', '302a'],
    },
    noBlink: ['102', '102a', '301', '403', '401'],
    head: { c: [512, 190], rx: 172, ry: 168, feather: 40 },
    neck: [508, 358],
    dome: { c: [522, 262], rx: 120, ry: 115 },
    hips: [512, 920],
    // (left side: along the sleeve's own outline, so the twin tail's strands hanging beside it are all hair)
    torso: [[422, 362], [652, 362], [670, 560], [705, 720], [400, 720], [414, 640], [412, 626], [408, 622], [406, 612], [408, 602],
      [411, 592], [414, 584], [415, 568], [410, 560], [404, 553], [400, 550], [396, 545],
      [395, 541], [393, 530], [391, 500], [392, 470],
      [387, 466], [384, 462], [384, 452], [386, 447], [383, 444], [381, 440], [380, 430], [380, 412], [381, 405], [383, 392], [381, 388],
      [381, 385], [383, 383], [388, 382], [391, 380], [395, 379], [398, 377], [403, 375], [412, 372], [420, 366]],
    upper: [400, 700],
    body: [680, 980],
    skirt: { y: [800, 990, 1040, 1080], x: [200, 840] },
    feetY: 1500,
    ears: [
      { pivot: [428, 122], tip: [372, 36], r: 40, side: -1 },
      { pivot: [628, 140], tip: [668, 72], r: 34, side: 1 },
    ],
    strands: [
      { name: 'tailL', pts: [[385, 140], [332, 262], [292, 382], [266, 472], [250, 562]], r: 56, f: 35, back: true, k: 70, grab: true, layer: true, bend: true,
        poly: [[200, 110], [340, 110], [352, 128], [372, 128], [400, 140], [412, 165], [409, 250], [405, 350], [405, 372], [400, 380], [392, 388], [392, 440],
          [398, 452], [400, 470], [398, 500], [400, 530], [404, 542], [410, 556], [410, 566], [414, 570], [414, 584],
          [410, 590], [410, 640], [200, 640]] },
      { name: 'tailR', pts: [[652, 160], [700, 282], [740, 380], [770, 462], [790, 525]], r: 52, f: 30, back: true, k: 80, grab: true, layer: true, bend: true, keep: 0.24,
        poly: [[640, 152], [662, 140], [700, 120], [860, 120], [860, 640], [705, 640], [700, 560], [690, 500], [676, 420], [662, 340], [652, 280], [646, 220], [640, 170]] },
      { name: 'lockL', pts: [[438, 300], [410, 420], [388, 520]], r: 26, f: 16, k: 110 },
      { name: 'lockR', pts: [[600, 300], [628, 420], [655, 530]], r: 30, f: 18, k: 110 },
    ],
    tail: { pts: [[295, 1003], [262, 1022], [225, 1048], [203, 1090], [202, 1135], [215, 1170], [250, 1195]], r: 28, mr: 46, cut: { x: 238, yMax: 1075 }, s0: 0.26,
      extra: [{ c: [160, 1040], rx: 50, ry: 50 }, { c: [207, 1172], rx: 26, ry: 26 }, { c: [200, 1208], rx: 20, ry: 30 }] },
    cheeks: [{ c: [462, 296], r: 30 }, { c: [585, 302], r: 30 }],
    crown: { c: [515, 125], rx: 145, ry: 85 },
    chest: { c: [512, 560], rx: 140, ry: 150 },
    hem: { c: [520, 1010], rx: 300, ry: 60 },
    zones: [
      { type: 'clip', c: [378, 148], rx: 32, ry: 34, head: true },
      { type: 'hand', c: [440, 418], rx: 46, ry: 46 }, { type: 'hand', c: [652, 742], rx: 42, ry: 40 },
      { type: 'neck', c: [505, 382], rx: 50, ry: 26 },
      { type: 'bow', c: [560, 640], rx: 60, ry: 110 },
      { type: 'arm', c: [400, 540], rx: 70, ry: 150 }, { type: 'arm', c: [622, 640], rx: 52, ry: 120 },
      { type: 'chest', c: [520, 470], rx: 110, ry: 70 },
      { type: 'belly', c: [520, 750], rx: 115, ry: 70 },
      { type: 'skirt', c: [520, 1010], rx: 300, ry: 60 }, { type: 'skirt', c: [520, 880], rx: 250, ry: 90 },
      { type: 'feet', c: [505, 1450], rx: 110, ry: 70 },
      { type: 'leg', c: [505, 1230], rx: 120, ry: 150 },
    ],
    bubble: [700, 170],
  },
};

// The first line of each list is the one used in recording mode (it matches the video storyboard).
const LINES = {
  earPull: ['喵呜！？耳、耳朵不可以拽啦！', '呀啊——！好痛好痛！', '耳朵是很敏感的…！', '放、放手啦！'],
  earRelease: ['哼…下次不许这样了。', '呜…耳朵要被拉长了…', '…真是的。'],
  earFlick: ['嗯？', '耳朵痒痒的…', '……刚才碰我耳朵了吗？'],
  pat: ['呼噜呼噜……♪', '嗯…好舒服……', '再、再摸一会儿也可以哦…', '请、请不要把我当小孩子一样摸头！'],
  patEnd: ['……还想要再摸摸。', '嘿嘿～', '……才、才没有觉得舒服呢。', '……诶，不摸了吗？'],
  headTap: ['嗯？怎么了？', '有什么事吗？'],
  poke: ['脸、脸会变形的！', '唔…戳我干嘛啦', '呣——', '……？'],
  pokeMany: ['够了啦！再戳就生气了！', '哼！'],
  tail: ['尾巴…尾巴是禁止触摸区域！', '尾巴不要拽！！', '呜…！那、那里不行！'],
  tailEnd: ['尾巴的毛都炸起来了…', '…坏蛋。'],
  hair: ['好不容易才扎好的…', '头发会乱掉的啦…', '别、别扯我头发嘛'],
  body: ['怎么了？', '有什么想说的吗？', '嗯？'],
  skirt: ['……不可以哦。', '你、你在看哪里啊！'],
  clip: ['这个樱桃发夹好看吧？', '发夹是我的宝物哦～', '别弄掉了喔！'],
  neck: ['呀！脖子好痒…', '呜…那里好痒啦！', '咿——！'],
  hand: ['手…手怎么了？', '要…牵手吗？', '你的手好暖和～'],
  handHold: ['嘿嘿，牵着手呢…', '要带我去哪里吗？', '不、不许放开哦…'],
  arm: ['嗯？', '袖子怎么了吗？', '有什么事吗？'],
  armTug: ['别、别拉我啦～', '要去哪里嘛…', '呜哇，站不稳啦！'],
  bow: ['蝴蝶结要松掉了！', '这个蝴蝶结很难系的…', '不许解开哦！'],
  chest: ['…？', '你、你戳哪里呢！', '有什么想说的吗？'],
  belly: ['呜哇！肚子不可以！', '呀！好痒！', '肚子…是不是有点圆…？'],
  leg: ['腿、腿也不可以随便摸！', '咦？！', '…变态。'],
  feet: ['哈哈哈好痒～！', '脚、脚底不行啦！', '袜子要被你弄脏了！'],
  push: ['哇、哇——要倒了！', '不要推我嘛～'],
  tailHappy: ['尾巴在摇？才没有呢！', '哼哼～'],
  angry: ['哼！不理你了！', '我、我真的生气了！'],
  forgive: ['哼…摸摸的话就勉强原谅你。', '…这次就原谅你吧。'],
  idle: ['今天天气真好呢～', '♪～', '肚子有点饿了…', '要不要一起去散步？', '…你在看什么？', '今天的计划都完成了吗？'],
  yawn: ['哈啊～…', '有点困了…'],
  sleep: ['Zzz…', '呼…呼……'],
  wake: ['才、才没有在打瞌睡！', '啊、我没睡着！', '唔…？我刚刚睡着了吗…'],
  jump: ['嘿咻！', '嘿嘿～', '哼哼～♪'],
  skirtPull: ['笨蛋笨蛋！手拿开啦！', '呀啊？！不、不许拉裙子！', '要、要被看到了啦…！'],
  skirtLong: ['还不放手！真的要生气了喵！', '……变态。'],
  skirtEnd: ['……哼。', '皱掉了啦…真是的。', '下次再这样就挠你哦！'],
  carry: ['诶诶？！脚、脚离地了！', '哇啊？！要、要带我去哪里？', '放我下来啦～！', '呜哇…好高…'],
  drop: ['这里就是新家吗？', '呼…总算站稳了。', '下次要先说一声啦！', '嘿咻，落地～'],
  greet: ['欢迎回来喵♪', '你好呀～', '早安。今天的工作和学习计划都制定好了吗？'],
  pose: ['换个姿势～', '这样如何？'],
  // the affection meter filled up: her special moment (see ANIMS.love)
  loveMax: ['……既然你这么努力，作为前辈，就勉强承认你是特别的人吧。', '我、我才没有很开心！……只是想一直待在你身边而已。', '这种心情……都是你的错哦。要好好负起责任才行。'],
};
