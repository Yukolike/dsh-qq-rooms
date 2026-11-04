// dsh-qq-rooms · TTS 引擎表与命令生成
//
// 配置只存「引擎 + 每引擎自己的参数 + 当前音色」；这里把引擎翻译成
// 插件一直使用的命令模板：
//   读 {text} 文字文件 → 把音频写到 {out} → 退出码 0
//
// 普通用户不需要看到 shell；高级里的「命令覆盖」仍然优先，方便排错。

import { fileURLToPath } from 'node:url'

export const MiniMax音色 = [
  ['Chinese (Mandarin)_Warm_Bestie', 'Warm Bestie（温暖闺蜜）'],
  ['Chinese (Mandarin)_Warm_Girl', 'Warm Girl（温暖少女）'],
  ['Chinese (Mandarin)_Crisp_Girl', 'Crisp Girl（清脆少女）'],
  ['Chinese (Mandarin)_Sweet_Lady', 'Sweet Lady（甜美女声）'],
  ['Chinese (Mandarin)_Soft_Girl', 'Soft Girl（柔和少女）'],
  ['Chinese (Mandarin)_Gentle_Senior', 'Gentle Senior（温柔学姐）'],
  ['Chinese (Mandarin)_Wise_Women', 'Wise Women（阅历姐姐）'],
  ['Chinese (Mandarin)_Mature_Woman', 'Mature Woman（傲娇御姐）'],
  ['Chinese (Mandarin)_HK_Flight_Attendant', 'HK Flight Attendant（港普空姐）'],
  ['Arrogant_Miss', 'Arrogant Miss（嚣张小姐）'],
  ['Chinese (Mandarin)_News_Anchor', 'News Anchor（新闻女声）'],
  ['Chinese (Mandarin)_Kind-hearted_Antie', 'Kind-hearted Antie（热心大婶）'],
  ['Chinese (Mandarin)_Cute_Spirit', 'Cute Spirit（憨憨萌兽）'],
  ['Chinese (Mandarin)_Laid_BackGirl', 'Laid Back Girl（松弛）'],
  ['female-shaonv', 'female-shaonv（少女音色）'],
  ['female-yujie', 'female-yujie（御姐音色）'],
  ['female-chengshu', 'female-chengshu（成熟女性）'],
  ['female-tianmei', 'female-tianmei（甜美女性）'],
  ['qiaopi_mengmei', 'qiaopi_mengmei（俏皮萌妹）'],
  ['wumei_yujie', 'wumei_yujie（妩媚御姐）'],
  ['diadia_xuemei', 'diadia_xuemei（嗲嗲学妹）'],
  ['danya_xuejie', 'danya_xuejie（淡雅学姐）'],
  ['tianxin_xiaoling', 'tianxin_xiaoling（甜心小玲）'],

  // 男声
  ['male-qn-qingse', '男声 · 青涩青年'],
  ['male-qn-jingying', '男声 · 精英青年'],
  ['male-qn-badao', '男声 · 霸道青年'],
  ['male-qn-daxuesheng', '男声 · 青年大学生'],
  ['junlang_nanyou', '男声 · 俊朗男友'],
  ['chunzhen_xuedi', '男声 · 纯真学弟'],
  ['lengdan_xiongzhang', '男声 · 冷淡学长'],
  ['badao_shaoye', '男声 · 霸道少爷'],
  ['bingjiao_didi', '男声 · 病娇弟弟'],
  ['Chinese (Mandarin)_Gentleman', '男声 · 温润男声'],
  ['Chinese (Mandarin)_Male_Announcer', '男声 · 播报男声'],
  ['Chinese (Mandarin)_Radio_Host', '男声 · 电台男主播'],
  ['Chinese (Mandarin)_Lyrical_Voice', '男声 · 抒情男声'],
  ['Chinese (Mandarin)_Southern_Young_Man', '男声 · 南方小哥'],
  ['Chinese (Mandarin)_Straightforward_Boy', '男声 · 率真弟弟'],
  ['Chinese (Mandarin)_Pure-hearted_Boy', '男声 · 清澈邻家弟弟'],
  ['Chinese (Mandarin)_Unrestrained_Young_Man', '男声 · 不羁青年'],
  ['Chinese (Mandarin)_Gentle_Youth', '男声 · 温润青年'],
  ['Chinese (Mandarin)_Reliable_Executive', '男声 · 沉稳高管'],
  ['Chinese (Mandarin)_Sincere_Adult', '男声 · 真诚青年'],
  ['Chinese (Mandarin)_Stubborn_Friend', '男声 · 嘴硬竹马'],
  ['Chinese (Mandarin)_Humorous_Elder', '男声 · 搞笑大爷'],
]

export const Edge音色 = [
  ['zh-CN-XiaoxiaoNeural', 'Xiaoxiao（温暖女声）'],
  ['zh-CN-XiaoyiNeural', 'Xiaoyi（活泼女声）'],
  ['zh-CN-liaoning-XiaobeiNeural', 'Xiaobei（东北女声）'],
  ['zh-CN-shaanxi-XiaoniNeural', 'Xiaoni（陕西女声）'],
  ['zh-CN-YunxiNeural', 'Yunxi（年轻男声）'],
  ['zh-CN-YunjianNeural', 'Yunjian（男声）'],
  ['zh-CN-YunyangNeural', 'Yunyang（新闻男声）'],
]

export const Sapi音色 = [
  ['Microsoft Huihui Desktop', 'Microsoft Huihui（中文女声）'],
  ['Microsoft Zira Desktop', 'Microsoft Zira（英文女声）'],
]

export const 引擎们 = {
  minimax: {
    id: 'minimax',
    label: 'MiniMax',
    defaultVoice: 'Chinese (Mandarin)_Warm_Bestie',
    emotions: ['', 'happy', 'calm', 'sad', 'angry', 'surprised', 'whisper'],
    supportsTags: true,
    needsKey: true,
    voices: MiniMax音色,
  },
  edge: {
    id: 'edge',
    label: 'edge-tts',
    defaultVoice: 'zh-CN-XiaoyiNeural',
    emotions: [],
    supportsTags: false,
    needsKey: false,
    voices: Edge音色,
  },
  sapi: {
    id: 'sapi',
    label: 'Windows 朗读',
    defaultVoice: 'Microsoft Huihui Desktop',
    emotions: [],
    supportsTags: false,
    needsKey: false,
    voices: Sapi音色,
  },
  custom: {
    id: 'custom',
    label: '自定义命令',
    defaultVoice: '',
    emotions: [],
    supportsTags: false,
    needsKey: false,
    voices: [],
  },
}

export const 引擎ids = Object.keys(引擎们)

export const 默认引擎配置 = {
  minimax: { model: 'speech-2.8-hd', speed: 1.0, pitch: 0, python: 'python' },
  edge: { rate: '+0%', pitch: '+0Hz', python: 'python' },
  sapi: {},
  custom: {},
}

export function 引擎id(配置 = {}) {
  const id = String(配置.语音引擎 || '')
  return 引擎们[id] ? id : 'minimax'
}

export function 引擎信息(配置 = {}) {
  return 引擎们[引擎id(配置)] || 引擎们.minimax
}

export function 引擎支持标签(配置 = {}) {
  return Boolean(引擎信息(配置).supportsTags)
}

const 引 = (s) => '"' + String(s == null ? '' : s).replace(/"/gu, '') + '"'
const 数 = (v, 兜, 低, 高) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return 兜
  return Math.max(低, Math.min(n, 高))
}

/** 解析旧配置里的命令，迁移时用来保留 speed/pitch/model/python。 */
export function 解析旧命令(命令) {
  const s = String(命令 || '')
  const py = /^"([^"]+)"/u.exec(s.trim())
  const model = /--model\s+([^\s"]+)/u.exec(s)
  const speed = /--speed\s+(-?[\d.]+)/u.exec(s)
  const pitch = /--pitch\s+(-?\d+)/u.exec(s)
  const rate = /--rate[=\s]+([^\s"]+)/u.exec(s)
  const edgePitch = /--pitch[=\s]+([^\s"]+Hz)/u.exec(s)
  return {
    python: py ? py[1] : '',
    model: model ? model[1] : '',
    speed: speed ? Number(speed[1]) : null,
    pitch: pitch ? Number(pitch[1]) : null,
    rate: rate ? rate[1] : '',
    edgePitch: edgePitch ? edgePitch[1] : '',
  }
}

const 包装脚本 = fileURLToPath(new URL('../tools/tts_minimax.py', import.meta.url))

/**
 * 当前配置 → 实际 shell 命令。
 * 高级「命令覆盖」优先；其次按引擎生成；SAPI 返回空串（插件用内置脚本）。
 */
export function 构建语音命令(配置 = {}) {
  const 覆盖 = String(配置.语音合成命令 || '').trim()
  if (覆盖) return 覆盖

  const id = 引擎id(配置)
  const ep = (配置.引擎配置 && 配置.引擎配置[id]) || {}

  if (id === 'custom') return String(ep.命令 || '').trim()
  if (id === 'sapi') return ''

  const py = String(ep.python || 'python').trim() || 'python'
  const 超时 = 数(配置.语音超时秒, 45, 5, 600)

  if (id === 'minimax') {
    const model = String(ep.model || 'speech-2.8-hd').trim() || 'speech-2.8-hd'
    const speed = 数(ep.speed, 1.0, 0.5, 2)
    const pitch = Math.round(数(ep.pitch, 0, -12, 12))
    return 引(py) + ' ' + 引(包装脚本)
      + ' --text "{text}" --out "{out}" --voice "{voice}"'
      + ` --model ${model} --speed ${speed} --pitch ${pitch}`
      + ' --emotion "{emotion}" --timeout ' + 超时
  }

  if (id === 'edge') {
    const rate = /^[+-]?\d+(?:\.\d+)?%$/u.test(String(ep.rate || '')) ? String(ep.rate) : '+0%'
    const pitch = /^[+-]?\d+(?:\.\d+)?Hz$/u.test(String(ep.pitch || '')) ? String(ep.pitch) : '+0Hz'
    return 引(py) + ' -m edge_tts --voice "{voice}" --file "{text}" --write-media "{out}"'
      + ` --rate=${rate} --pitch=${pitch} --no-progress`
  }

  return ''
}
