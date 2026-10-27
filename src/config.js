// dsh-qq-rooms · 配置（默认值 + 归一化 + 落盘）
//
// 与旧插件（dsh-qq-bridge）的关键差别：
//   · 没有「绑定」：聊天 → 房间是自动建立的，配置里只留「谁被许可」「哪些群」。
//   · 主人（owner）是一个 QQ 号：审批、加群、重置只认这个号，且只在这个号的私聊里。
//   · 所有未知字段一律丢弃 —— 配置是唯一真源，不把派生值写回文件。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const 配置文件名 = 'qq-rooms-config.json'

export const 默认配置 = Object.freeze({
  // ── 身份 ────────────────────────────────────────────────
  主人: '',                       // ⭐ 唯一的管理员 QQ 号；空 = 谁都不是主人（一切审批无人可问）
  主人称呼: '主人',

  // ── 连接（OneBot 11 HTTP）────────────────────────────────
  NapCat: 'http://127.0.0.1:3000',
  令牌: '',
  事件地址: 'ws://127.0.0.1:3001',
  事件令牌: '',
  轮询间隔毫秒: 2000,
  合并窗口秒: 1,
  合并最多秒: 20,
  补投窗口分: 10,
  审批冷却分: 10,

  // ── 安全闸 ──────────────────────────────────────────────
  总开关: false,                  // 关 = 一句都不发
  试运行: true,                   // 开 = 只记账，不真发

  // ── 房间 ────────────────────────────────────────────────
  房间工作区: '',                 // 访客/新房间的 cwd；空 = ~/.dsh/qq-rooms
  模型: 'deepseek-account/deepseek-flash',
  访客工具: 'none',                // 访客房间的工具：none = 全禁；safe = 只留 todo；standard = 不限制
  访客: {},                       // 白名单：'QQ号' -> { 昵称, 准到 }  准到 = 0 表示长期
  黑名单: {},                     // 黑名单：'QQ号' -> { 拒绝于 }  这些人再来直接静默丢弃，不再问主人
  群: {},                         // '群号' -> { enabled, mode, addedAt, muteUntil, members }
  房间: {},                       // '私聊:号' / '群:号' -> { sessionId, createdAt, lastAt }

  // ── 消息 ────────────────────────────────────────────────
  只发标记内: false,              // 只发 [QQ]…[/QQ] 里的内容
  只回QQ唤醒: false,              // 只发「被 QQ 消息叫醒的那一轮」（本机自己聊的不推手机）
  长回复拆段: true,
  拆段间隔毫秒: 450,
  收图: true,
  发图: true,
  收图最多: 4,
  图上限MB: 5,
  图片根目录: '',                 // 正文里 `![名](相对路径)` 的解析根；空 = 房间工作区
  语音转写: false,
  转写命令: '',
  转写超时秒: 60,
  群里听名字: false,              // 群里按「名字」算点名（默认关，误伤率高）
})

const 群模式 = new Set(['mention', 'all'])

const 是对象 = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const 字 = (v) => (typeof v === 'string' ? v.trim() : '')
const 布 = (v, 兜) => {
  if (v === true || v === 'true' || v === 1 || v === '1') return true
  if (v === false || v === 'false' || v === 0 || v === '0') return false
  return 兜
}
const 数 = (v, 兜, 低, 高) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return 兜
  return Math.max(低, Math.min(Math.round(n), 高))
}
const 号码 = (v) => (/^\d{4,12}$/.test(String(v || '').trim()) ? String(v).trim() : '')

/** 访客表：只留合法 QQ 号，准到 = 0（长期）或毫秒时间戳。 */
export function 规整访客(raw) {
  const 出 = {}
  if (!是对象(raw)) return 出
  for (const [k, v] of Object.entries(raw)) {
    const 号 = 号码(k)
    if (!号) continue
    const 准到 = Number((v && v.准到) || 0)
    出[号] = {
      昵称: 字(v && v.昵称).slice(0, 24),
      准到: Number.isFinite(准到) && 准到 > 0 ? 准到 : 0,
    }
  }
  return 出
}

/** 黑名单：只留合法 QQ 号 + 拉黑时间。 */
export function 规整黑名单(raw) {
  const 出 = {}
  if (!是对象(raw)) return 出
  for (const [k, v] of Object.entries(raw)) {
    const 号 = 号码(k)
    if (!号) continue
    出[号] = { 拒绝于: Number((v && v.拒绝于) || 0) }
  }
  return 出
}

/** 群表：enabled / mode / 静音截止 / 成员名单。 */
export function 规整群(raw) {
  const 出 = {}
  if (!是对象(raw)) return 出
  for (const [k, v] of Object.entries(raw)) {
    const 群号 = 号码(k)
    if (!群号) continue
    const 模式 = 群模式.has(String(v && v.mode)) ? String(v.mode) : 'mention'
    const 名单 = 是对象(v && v.members) ? v.members : {}
    const 洗名单 = (x) => (Array.isArray(x) ? [...new Set(x.map(号码).filter(Boolean))] : [])
    出[群号] = {
      enabled: 布(v && v.enabled, true),
      mode: 模式,
      addedAt: Number((v && v.addedAt) || 0),
      muteUntil: Number((v && v.muteUntil) || 0),
      members: { allow: 洗名单(名单.allow), deny: 洗名单(名单.deny) },
    }
  }
  return 出
}

/** 房间表：键必须是 私聊:号 / 群:号，值只留 sessionId 与时间。 */
export function 规整房间(raw) {
  const 出 = {}
  if (!是对象(raw)) return 出
  for (const [k, v] of Object.entries(raw)) {
    if (!/^(私聊|群):\d{4,12}$/u.test(String(k))) continue
    const sessionId = 字(v && v.sessionId)
    if (!/^session-[A-Za-z0-9-]{8,}$/u.test(sessionId)) continue
    出[String(k)] = {
      sessionId,
      createdAt: Number((v && v.createdAt) || 0),
      lastAt: Number((v && v.lastAt) || 0),
      personaHash: 字(v && v.personaHash).slice(0, 32),
    }
  }
  return 出
}

/** 一份配置 → 干净配置。未知键丢弃，数字夹取，非法条目丢弃。 */
export function 归一化(raw) {
  const 混 = 是对象(raw) ? raw : {}
  return {
    主人: 号码(混.主人),
    主人称呼: 字(混.主人称呼).slice(0, 16) || 默认配置.主人称呼,

    NapCat: 字(混.NapCat) || 默认配置.NapCat,
    令牌: 字(混.令牌),
    // 显式空串 = 不连事件源（测试/只要轮询的人用）；缺省才回落到默认地址
    事件地址: 混.事件地址 === undefined ? 默认配置.事件地址 : 字(混.事件地址),
    事件令牌: 字(混.事件令牌),
    轮询间隔毫秒: 数(混.轮询间隔毫秒, 默认配置.轮询间隔毫秒, 500, 60_000),
    合并窗口秒: 数(混.合并窗口秒, 默认配置.合并窗口秒, 0, 10),
    合并最多秒: 数(混.合并最多秒, 默认配置.合并最多秒, 5, 120),
    补投窗口分: 数(混.补投窗口分, 默认配置.补投窗口分, 0, 1440),
    审批冷却分: 数(混.审批冷却分, 默认配置.审批冷却分, 1, 1440),

    总开关: 布(混.总开关, 默认配置.总开关),
    试运行: 布(混.试运行, 默认配置.试运行),

    房间工作区: 字(混.房间工作区),
    模型: 字(混.模型) || 默认配置.模型,
    访客工具: ['none', 'safe', 'standard'].includes(字(混.访客工具)) ? 字(混.访客工具) : 默认配置.访客工具,
    访客: 规整访客(混.访客),
    黑名单: 规整黑名单(混.黑名单),
    群: 规整群(混.群),
    房间: 规整房间(混.房间),

    只发标记内: 布(混.只发标记内, 默认配置.只发标记内),
    只回QQ唤醒: 布(混.只回QQ唤醒, 默认配置.只回QQ唤醒),
    长回复拆段: 布(混.长回复拆段, 默认配置.长回复拆段),
    拆段间隔毫秒: 数(混.拆段间隔毫秒, 默认配置.拆段间隔毫秒, 0, 5000),
    收图: 布(混.收图, 默认配置.收图),
    发图: 布(混.发图, 默认配置.发图),
    收图最多: 数(混.收图最多, 默认配置.收图最多, 1, 10),
    图上限MB: 数(混.图上限MB, 默认配置.图上限MB, 1, 30),
    图片根目录: 字(混.图片根目录),
    语音转写: 布(混.语音转写, 默认配置.语音转写),
    转写命令: 字(混.转写命令),
    转写超时秒: 数(混.转写超时秒, 默认配置.转写超时秒, 5, 600),
    群里听名字: 布(混.群里听名字, 默认配置.群里听名字),
  }
}

/** 从磁盘读；不存在或损坏 → 默认配置。 */
export function 读配置(家目录, 文件名 = 配置文件名) {
  try {
    return 归一化(JSON.parse(readFileSync(join(家目录, 文件名), 'utf8')))
  } catch {
    return 归一化(null)
  }
}

/** 写盘（只写归一化后的干净配置）。返回是否成功。 */
export function 写配置(家目录, 配置, 文件名 = 配置文件名) {
  try {
    const 路径 = join(家目录, 文件名)
    mkdirSync(dirname(路径), { recursive: true })
    writeFileSync(路径, JSON.stringify(归一化(配置), null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

/** 便捷：读 → 改 → 写。改 = (旧配置) => 新配置，返回 { 配置, 成功 }。 */
export function 改配置(家目录, 变更, 文件名 = 配置文件名) {
  const 旧 = 读配置(家目录, 文件名)
  const 新 = 归一化(typeof 变更 === 'function' ? 变更(旧) : { ...旧, ...变更 })
  return { 配置: 新, 成功: 写配置(家目录, 新, 文件名) }
}
