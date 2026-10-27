// dsh-qq-rooms · OneBot 11 传输层
//
// 只做四件事：调 HTTP、拉历史、发消息、把消息段翻译成文字。
// 不认识房间、不认识指令、不写配置 —— 那些在 host / policy / rooms。
//
// ── 来源 ────────────────────────────────────────────────────────────
// 以下函数移植 / 改写自 dsh-qq-bridge
// (https://github.com/Yuuyuko-uu/dsh-qq-bridge, MIT, Copyright (c) 2026 Yuuyuko-uu)：
//   提取正文、提取图块、私人消息体、群消息体、图片段、按段拆、
//   抠正文图、抠QQ标记、看图类、卡片文字、取图字节、转发文字
// 为保持与原版行为一致（标记剥离、卡片抽取、正文图、转发展开），保留原实现语义。
// 其余（OneBot 客户端、超时、发送、语音转写接线）为本项目实现。
// 完整许可与原版权声明见仓库根目录 LICENSE。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const 睡 = (毫秒) => new Promise((r) => setTimeout(r, Math.max(0, 毫秒)))

/* ------------------------------------------------------------------ */
/* 纯函数                                                              */
/* ------------------------------------------------------------------ */

/** 从一条 assistant 消息里只抽正文（text 块），reasoning / image 不要。 */
export function 提取正文(message) {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

/** 从一条 assistant 消息里挑出图片块。 */
export function 提取图块(message) {
  if (!message || !Array.isArray(message.content)) return []
  return message.content.filter((b) => b && b.type === 'image' && b.attachment).slice(0, 10)
}

export function 私人消息体(文字) {
  return { user_id: 0, message: [{ type: 'text', data: { text: String(文字 || '') } }] }
}

export function 群消息体(文字) {
  return { group_id: 0, message: [{ type: 'text', data: { text: String(文字 || '') } }] }
}

/** OneBot 图片段：base64 直塞，不依赖 QQ 端访问本机文件。 */
export function 图片段(base64) {
  return { type: 'image', data: { file: 'base64://' + String(base64) } }
}

/** 按空行拆自然段；没有空行就是整段。 */
export function 按段拆(文字) {
  return String(文字 || '')
    .split(/\n\s*\n/u)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 正文里的 markdown 图 `![名字](路径)` 当图片发。
 * @returns {{净文字: string, 图: Array<{kind:'url'|'path', value:string}>}}
 */
export function 抠正文图(文字) {
  const 图 = []
  const 净文字 = String(文字 || '')
    .replace(/!\[[^\]]*\]\(\s*([^)\s]+)\s*\)/gu, (_全, 路径) => {
      const p = String(路径 || '').trim()
      if (!p) return ''
      if (/^https?:\/\//iu.test(p)) {
        if (!图.some((x) => x.value === p)) 图.push({ kind: 'url', value: p })
        return ''
      }
      if (!图.some((x) => x.value === p)) 图.push({ kind: 'path', value: p })
      return ''
    })
    .replace(/[ \t]+$/gmu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
  return { 净文字, 图 }
}

/**
 * `[QQ]…[/QQ]` 的处理。三种情况见原版注释：
 * 关 → 整段发但剥掉标记；开 + 完整块 → 只发块；开 + 只有开头 → 发 `[QQ]` 之后。
 */
export function 抠QQ标记(文字, 只发标记内) {
  const 全 = String(文字 || '')
  const 洗 = (s) =>
    String(s || '')
      .replace(/\[\s*\/?\s*QQ\s*\]/giu, '')
      .replace(/\n{3,}/gu, '\n\n')
      .trim()
  if (!只发标记内) return { 发: true, 文字: 洗(全) }
  const 块 = /\[QQ\]([\s\S]*?)\[\/QQ\]/u.exec(全)
  if (块 && String(块[1] || '').trim()) return { 发: true, 文字: 洗(块[1]) }
  const 开 = 全.indexOf('[QQ]')
  const 尾 = 开 >= 0 ? 全.slice(开 + 4) : ''
  if (String(尾).trim()) {
    return { 发: true, 文字: 洗(尾), 原因: '只写了 [QQ] 没写 [/QQ]，按「[QQ] 之后全是要发的」处理' }
  }
  return { 发: false, 文字: '', 原因: '没写 [QQ] 块' }
}

/** 图片 MIME 嗅探（认 png / gif / webp，其余按 jpeg）。 */
export function 看图类(字节) {
  try {
    if (字节[0] === 0x89 && 字节[1] === 0x50) return 'image/png'
    if (字节[0] === 0x47 && 字节[1] === 0x49) return 'image/gif'
    if (字节[0] === 0x52 && 字节[1] === 0x49 && 字节[8] === 0x57) return 'image/webp'
  } catch {
    /* 空 buffer */
  }
  return 'image/jpeg'
}

export function 扩展名(类) {
  if (类 === 'image/png') return 'png'
  if (类 === 'image/gif') return 'gif'
  if (类 === 'image/webp') return 'webp'
  return 'jpg'
}

const 反斜 = (t) =>
  String(t || '')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, '&')

const 抽BV号 = (文) => {
  const m = /BV[0-9A-Za-z]{10}/u.exec(String(文 || ''))
  return m ? m[0] : ''
}

/** 分享卡片（json / xml）→ 可读文字。抽不到也给一句看得懂的话。 */
export function 卡片文字(段) {
  const d = (段 && 段.data) || {}
  let 原 = d.data != null ? d.data : d.content != null ? d.content : d.xml != null ? d.xml : ''
  if (原 && typeof 原 === 'object') 原 = JSON.stringify(原)
  原 = 反斜(String(原 || ''))
  const 题们 = []
  let 链接 = ''
  try {
    const j = JSON.parse(原)
    const 摸 = (o, 层 = 0) => {
      if (!o || typeof o !== 'object' || 层 > 6) return
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string') {
          const 值 = 反斜(v).trim()
          if (/^(title|desc|summary|prompt)$/iu.test(k) && 值) 题们.push(值)
          if (/^(jumpUrl|qqdocurl|url)$/iu.test(k) && /^https?:/iu.test(值) && !链接) 链接 = 值
        } else 摸(v, 层 + 1)
      }
    }
    摸(j)
  } catch {
    /* 不是 JSON，按 XML 抓 */
  }
  if (!题们.length || !链接) {
    const 标题 = /<title>([\s\S]{0,100}?)<\/title>/iu.exec(原)
    if (标题 && 反斜(标题[1]).trim()) 题们.push(反斜(标题[1]).trim())
    const 摘要 = /<summary>([\s\S]{0,140}?)<\/summary>/iu.exec(原)
    if (摘要 && 反斜(摘要[1]).trim()) 题们.push(反斜(摘要[1]).trim())
    const 链 = /(https?:\/\/[^\s"'<>&]+)/u.exec(原)
    if (链 && !链接) 链接 = 链[1]
  }
  const 题 = [...new Set(题们)].slice(0, 2).join(' —— ')
  const bv = 抽BV号(原 + ' ' + 链接)
  const 尾 = [链接 ? '链接 ' + 链接 : '', bv ? 'BV号 ' + bv : ''].filter(Boolean).join('　')
  if (!题 && !尾) return '[分享卡片（里面没抓到内容）]'
  const 头 = bv ? '[分享视频卡片]' : '[分享卡片]'
  return 头 + ' ' + (题 || '（没标题）') + (尾 ? '\n  ' + 尾 : '')
}

/* ------------------------------------------------------------------ */
/* 图片                                                                */
/* ------------------------------------------------------------------ */

/** 从 OneBot 图片段里取字节：url → file(base64:// / 本地路径)。 */
export async function 取图字节(数据) {
  const d = 数据 || {}
  const url = typeof d.url === 'string' ? d.url.trim() : ''
  if (url) {
    if (url.startsWith('file://')) {
      try {
        return readFileSync(new URL(url))
      } catch {
        /* 读不到就继续试 file */
      }
    } else if (/^https?:/iu.test(url)) {
      try {
        const r = await fetch(url)
        if (r.ok) return Buffer.from(await r.arrayBuffer())
      } catch {
        /* 网络失败 */
      }
    }
  }
  const f = typeof d.file === 'string' ? d.file.trim() : ''
  if (f.startsWith('base64://')) {
    try {
      return Buffer.from(f.slice('base64://'.length), 'base64')
    } catch {
      /* 坏 base64 */
    }
  }
  if (f && (f.includes('\\') || f.includes('/'))) {
    try {
      return readFileSync(f)
    } catch {
      /* 本机文件不存在 */
    }
  }
  return null
}

/** 把收到的图存一份原图（回发时用它，避免 DSH 副本把 GIF 转成静态图）。 */
export function 存图(目录, 名字, 字节, 类) {
  try {
    mkdirSync(目录, { recursive: true })
    const p = join(目录, `${String(名字).replace(/[^\w-]/gu, '')}.${扩展名(类)}`)
    writeFileSync(p, 字节)
    return p
  } catch {
    return ''
  }
}

/* ------------------------------------------------------------------ */
/* 消息段 → 文字                                                       */
/* ------------------------------------------------------------------ */

const 掐短 = (s, n = 120) => {
  const t = String(s || '').replace(/\s+/gu, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

/**
 * 一条 OneBot 消息 → { 文字, 图们 }。
 * @param {object} 条  历史接口返回的一条
 * @param {object} 选项 { 拉任意, 收图, 收图最多, 转写, 图袋 }
 */
export async function 解析消息(条, 选项 = {}) {
  const 段们 = Array.isArray(条 && 条.message) ? 条.message : []
  const 文们 = []
  const 图们 = []

  for (const 段 of 段们) {
    if (!段 || !段.data) continue
    const 型 = String(段.type || '')
    const 数据 = 段.data

    if (型 === 'text') {
      文们.push(String(数据.text || ''))
      continue
    }
    if (型 === 'at') {
      const 谁 = String(数据.name || 数据.qq || '')
      if (String(数据.qq) === 'all') 文们.push('@全体成员')
      else 文们.push('@' + 谁)
      continue
    }
    if (型 === 'reply') {
      文们.push('[引用了一条消息]')
      continue
    }
    if (型 === 'image' || 型 === 'mface') {
      const 有图 = String(数据.url || 数据.file || 数据.path || 数据.thumb || '')
      if (型 === 'mface' && !有图) {
        文们.push('[表情:' + 掐短(数据.summary || 数据.emoji_id || '大表情', 20) + ']')
        continue
      }
      if (选项.收图 !== false) 图们.push(段)
      else 文们.push('[图片]')
      continue
    }
    if (型 === 'face') {
      文们.push('[表情]')
      continue
    }
    if (型 === 'json' || 型 === 'xml') {
      文们.push(卡片文字(段))
      continue
    }
    if (型 === 'forward') {
      文们.push(await 转发文字(段, 选项.拉任意))
      continue
    }
    if (型 === 'record') {
      文们.push(选项.转写 ? await 选项.转写(段) : '[语音]')
      continue
    }
    if (型 === 'video') {
      文们.push('[视频]')
      continue
    }
    文们.push('[' + (型 || '未知') + ']')
  }

  return { 文字: 文们.join('\n').trim(), 图们 }
}

/** 合并转发 → 几行文字（最多 12 条、2 层）。 */
export async function 转发文字(段, 拉任意) {
  const 行们 = await 转发行们(段, 拉任意, 0, { 行: 40 })
  let 文 = 行们.join('\n')
  if (文.length > 2500) 文 = 文.slice(0, 2500) + '\n…（太长，剩下的没展开）'
  return 文
}

async function 转发行们(段, 拉任意, 层, 预算) {
  const 缩 = '  '.repeat(层 + 1)
  const d = (段 && 段.data) || {}
  const id = String(d.id != null ? d.id : d.message_id != null ? d.message_id : d.content != null ? d.content : '')
  if (!id) return [缩 + '[合并转发的聊天记录（没有 id，读不出来）]']
  if (typeof 拉任意 !== 'function') return [缩 + '[合并转发的聊天记录（传输层没接上）]']

  let 节点们 = []
  for (const 体 of [{ message_id: id }, { id }]) {
    const 结果 = await 拉任意('get_forward_msg', 体)
    const 候选 = (结果 && (结果.messages || 结果.message)) || null
    if (Array.isArray(候选) && 候选.length) {
      节点们 = 候选
      break
    }
  }
  if (!节点们.length) return [缩 + '[合并转发的聊天记录（内容取不到）]']

  const 行 = [缩 + `[合并转发的聊天记录 · 共 ${节点们.length} 条]`]
  for (const 节 of 节点们.slice(0, 12)) {
    if (预算.行 <= 0) {
      行.push(缩 + '  …（后面的没展开）')
      break
    }
    预算.行--
    const 谁 = String((节 && 节.sender && (节.sender.card || 节.sender.nickname)) || (节 && 节.nickname) || '某人')
    const 段们 = Array.isArray(节 && 节.content) ? 节.content : Array.isArray(节 && 节.message) ? 节.message : []
    const 文本块 = []
    const 内层 = []
    for (const x of 段们) {
      if (!x) continue
      const 型 = String(x.type || '')
      if (型 === 'text') 文本块.push(String((x.data && x.data.text) || ''))
      else if (型 === 'image' || 型 === 'mface') 文本块.push('[图片]')
      else if (型 === 'face') 文本块.push('[表情]')
      else if (型 === 'record') 文本块.push('[语音]')
      else if (型 === 'video') 文本块.push('[视频]')
      else if (型 === 'json' || 型 === 'xml') 文本块.push('[卡片]')
      else if (型 === 'at') 文本块.push('@' + String((x.data && (x.data.name || x.data.qq)) || ''))
      else if (型 === 'forward') 内层.push(x)
    }
    const 头 = 缩 + '  ' + 掐短(谁, 20) + '：'
    const 文本 = 文本块.join('').replace(/[ \t]+/gu, ' ').replace(/[\r\n]+/gu, ' ').trim()
    if (文本) 行.push(头 + 掐短(文本, 240))
    else if (内层.length && 层 === 0) 行.push(头 + '（转发的聊天记录）')

    for (const 内 of 内层) {
      if (层 >= 1) {
        行.push(头 + '[里面还套着转发（太深，没展开）]')
        continue
      }
      行.push(...(await 转发行们(内, 拉任意, 层 + 1, 预算)))
    }
  }
  return 行
}

/* ------------------------------------------------------------------ */
/* 语音转写（可选：外部命令模板）                                      */
/* ------------------------------------------------------------------ */

function 跑命令(模板, 文件, 超时秒) {
  return new Promise((resolve) => {
    const 命令 = String(模板 || '').replace(/\{file\}/gu, 文件)
    let 出 = ''
    let 定 = null
    let 子 = null
    const 收 = (v) => {
      clearTimeout(定)
      resolve(v)
    }
    try {
      子 = spawn(命令, {
        shell: true,
        windowsHide: true,
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      })
    } catch (error) {
      return 收({ ok: false, 错: String((error && error.message) || error) })
    }
    子.stdout.on('data', (b) => {
      出 += String(b)
    })
    子.on('error', (error) => 收({ ok: false, 错: String((error && error.message) || error) }))
    子.on('close', (码) => {
      const 文字 = 出.trim()
      收(码 === 0 && 文字 ? { ok: true, 文字 } : { ok: false, 错: 文字 || '退出码 ' + 码 })
    })
    定 = setTimeout(() => {
      try {
        子.kill()
      } catch {
        /* 已经退出 */
      }
      收({ ok: false, 错: '超时' })
    }, Math.max(5, Number(超时秒) || 60) * 1000)
  })
}

/** 语音条 → 文字：拿音频 → 交给用户配置的命令 → 取回文字。没配就退回 [语音]。 */
export async function 转写语音(段, { 拉任意, 家目录, 配置 }) {
  const 模板 = String((配置 && 配置.转写命令) || '')
  if (!配置 || !配置.语音转写 || !模板.includes('{file}')) return '[语音]'
  const d = 段.data || {}
  const 原 = String(d.file || d.url || '')
  const 目录 = join(家目录, 'audio')

  let 本地 = ''
  // ① 先问后端要 wav（它会解 silk）
  if (原 && typeof 拉任意 === 'function') {
    const r = await 拉任意('get_record', { file: 原, out_format: 'wav' })
    const 路径 = r && (r.file || r.path)
    if (路径) {
      try {
        if (readFileSync(路径)) 本地 = String(路径)
      } catch {
        /* 后端给的是远端路径 */
      }
    }
    if (!本地 && r && r.base64) {
      try {
        mkdirSync(目录, { recursive: true })
        本地 = join(目录, `voice-${Date.now()}.wav`)
        writeFileSync(本地, Buffer.from(String(r.base64).replace(/^data:[^,]*,/u, ''), 'base64'))
      } catch {
        本地 = ''
      }
    }
  }
  // ② 直链下载
  if (!本地 && /^https?:/iu.test(d.url || '')) {
    try {
      const r = await fetch(d.url)
      if (r.ok) {
        mkdirSync(目录, { recursive: true })
        本地 = join(目录, `voice-${Date.now()}.wav`)
        writeFileSync(本地, Buffer.from(await r.arrayBuffer()))
      }
    } catch {
      本地 = ''
    }
  }
  if (!本地) return '[语音（没下到音频）]'

  const 结果 = await 跑命令(模板, 本地, (配置 && 配置.转写超时秒) || 60)
  return 结果.ok && 结果.文字 ? '（语音）' + 结果.文字 : '[语音（转写失败）]'
}

/* ------------------------------------------------------------------ */
/* HTTP 客户端                                                         */
/* ------------------------------------------------------------------ */

export class OneBot {
  #地址
  #令牌
  #日志

  constructor({ 地址, 令牌 = '', 日志 } = {}) {
    this.#地址 = String(地址 || 'http://127.0.0.1:3000').replace(/\/+$/u, '')
    this.#令牌 = String(令牌 || '').trim()
    this.#日志 = typeof 日志 === 'function' ? 日志 : () => {}
  }

  get 地址() {
    return this.#地址
  }

  #头(带体) {
    const h = 带体
      ? { 'content-type': 'application/json', 'user-agent': 'dsh-qq-rooms' }
      : { 'user-agent': 'dsh-qq-rooms' }
    if (this.#令牌) h.authorization = 'Bearer ' + this.#令牌
    return h
  }

  /** 一次 action 调用。返回 { ok, data, 错? }。 */
  async 调用(action, 体 = {}, { signal, 超时毫秒 = 8000 } = {}) {
    const 控 = new AbortController()
    const 信号 = signal ? AbortSignal.any([signal, 控.signal]) : 控.signal
    const 定时 = setTimeout(() => {
      try {
        控.abort(new Error('QQ 请求超时（' + 超时毫秒 + 'ms）'))
      } catch {
        /* 已结束 */
      }
    }, Math.max(500, 超时毫秒))

    try {
      const r = await fetch(`${this.#地址}/${action}`, {
        method: 'POST',
        headers: this.#头(true),
        body: JSON.stringify(体 || {}),
        signal: 信号,
      })
      const j = await r.json()
      const ok = Boolean(j && j.status === 'ok' && j.retcode === 0)
      if (!ok) this.#日志(`${action} 失败：${JSON.stringify(j).slice(0, 160)}`)
      return { ok, data: j && j.data, 原始: j }
    } catch (error) {
      if (error && error.name === 'AbortError' && signal && signal.aborted) throw error
      return { ok: false, 错: String((error && error.message) || error) }
    } finally {
      clearTimeout(定时)
    }
  }

  /** 发一条（文字 / 图片 / 其它段）。 */
  发一个(action, 体 = {}) {
    return this.调用(action, 体)
  }

  /** 拉任意接口的 data（合并转发、语音、登录号用）。 */
  async 拉任意(action, 体 = {}, 选项 = {}) {
    const r = await this.调用(action, 体, { ...选项, 超时毫秒: 选项.超时毫秒 || 8000 })
    return r.ok ? r.data : null
  }

  /** 拉历史：私聊 count=10 / 群 count=30（与原版一致）。 */
  async 拉历史(类型, 号码, 数量, 选项 = {}) {
    const 是群 = 类型 === '群'
    const r = await this.调用(
      是群 ? 'get_group_msg_history' : 'get_friend_msg_history',
      是群 ? { group_id: Number(号码), count: 数量 } : { user_id: Number(号码), count: 数量 },
      { ...选项, 超时毫秒: 8000 },
    )
    return r.ok && Array.isArray(r.data && r.data.messages) ? r.data.messages : []
  }

  /** 登录号（判断 @ 的是不是自己）。 */
  async 登录号(选项 = {}) {
    const data = await this.拉任意('get_login_info', {}, { ...选项, 超时毫秒: 5000 })
    return data && data.user_id ? String(data.user_id) : ''
  }

  /**
   * 发文字（自动拆段）。
   * @returns {Promise<Array<{ok: boolean, action: string}>>}
   */
  async 发文字(类型, 号码, 段们, { 间隔毫秒 = 450 } = {}) {
    const 是群 = 类型 === '群'
    const action = 是群 ? 'send_group_msg' : 'send_private_msg'
    const 出 = []
    for (let i = 0; i < 段们.length; i++) {
      const 体 = 是群 ? 群消息体(段们[i]) : 私人消息体(段们[i])
      if (是群) 体.group_id = Number(号码)
      else 体.user_id = Number(号码)
      const r = await this.发一个(action, 体)
      出.push({ action, ok: r.ok, 数据: r.原始 })
      if (i < 段们.length - 1 && 间隔毫秒) await 睡(间隔毫秒)
    }
    return 出
  }

  /** 发图片（每张一条消息）。 */
  async 发图片(类型, 号码, 图们, { 间隔毫秒 = 450 } = {}) {
    const 是群 = 类型 === '群'
    const action = 是群 ? 'send_group_msg' : 'send_private_msg'
    const 出 = []
    for (let i = 0; i < 图们.length; i++) {
      const 段 = 图们[i]
      const 体 = {
        [是群 ? 'group_id' : 'user_id']: Number(号码),
        message: [段.url ? { type: 'image', data: { file: 段.url, url: 段.url } } : 图片段(段.b64)],
      }
      const r = await this.发一个(action, 体)
      出.push({ action, ok: r.ok, 数据: r.原始 })
      if (i < 图们.length - 1 && 间隔毫秒) await 睡(间隔毫秒)
    }
    return 出
  }
}
