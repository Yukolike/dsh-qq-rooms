// dsh-qq-rooms · 宿主半边
//
// 一条链路：QQ 消息 → 策略判定 → 房间（自动建/续）→ agent.followup
//            agent 说完一轮 → 回到这间房绑定的聊天 → OneBot 发送
//
// 与旧插件（dsh-qq-bridge）的区别：
//   · 没有「绑定」：聊天第一次出现就自动建房（私聊一人一间，群一群一间）
//   · 主人是一个 QQ 号：审批 / 加群 / 重置只认这个号的私聊
//   · 入站以 WebSocket 事件为主（否则无法发现陌生私聊），HTTP 轮询只补已知房间的漏

import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { 读配置, 改配置, 可保存键 } from './config.js'
import { 判定入站, 主人指令, 点名判定, 聊天键, 拆聊天键 } from './policy.js'
import { 房间管理器, 房间标题, 房间工作区 } from './rooms.js'
import {
  OneBot, 解析消息, 抠QQ标记, 抠正文图, 按段拆, 提取正文, 提取图块,
  取图字节, 看图类, 存图, 转写语音,
} from './transport.js'
import { 合成语音, 判断发语音 } from './voice.js'
import { 生成图片, 洗生图提示, 选尺寸 } from './image.js'
import { 引擎们 } from './tts.js'

export const name = 'qq-rooms'
export const inject = ['agents', 'sessions', 'webServer', 'timer', 'workspaceRegistry', 'attachments']

const 路由前缀 = '/dsh-qq-rooms'
const 日志上限 = 80
const 唤醒窗口毫秒 = 10 * 60 * 1000

/** 令牌回给前端时的遮罩：原样回传 = 「这个令牌没动」。 */
const 令牌遮罩 = '********'

/**
 * DSH 会在你那句话后面再塞几条 user/message（运行环境、时间等）。
 * 它们不是人打的字，不能拿来判断「这一轮是不是 QQ 叫醒的」。
 */
const 搭车注入 = new Set([
  'runtime-context', 'time-context', 'skill-catalog', 'compact-checkpoint',
  'model-selection', 'her-words', 'memory',
])
const 搭车前缀 = /^(?:repeat-tool-reminder|plugin:)/u

export function apply(ctx) {
  const 家目录 = process.env.DSH_HOME || join(homedir(), '.dsh')
  const 收图目录 = join(家目录, 'qq-rooms-inbox')
  const 状态文件 = join(家目录, 'qq-rooms-state.json')
  const 生图用量文件 = join(家目录, 'qq-rooms-image-usage.json')
  const 日志目录 = join(家目录, 'qq-rooms-logs')
  const 日志文件 = join(日志目录, 'plugin.log')

  /* ---------------- 状态 ---------------- */

  const 日志 = []
  let 日志写次数 = 0

  /** 日志落盘（超过 2MB 轮转成 plugin.1.log）；写不进去也不影响收发。 */
  const 落日志 = (行) => {
    try {
      mkdirSync(日志目录, { recursive: true })
      appendFileSync(日志文件, 行 + '\n', 'utf8')
      日志写次数 += 1
      if (日志写次数 % 200 !== 0) return
      try {
        if (statSync(日志文件).size > 2 * 1024 * 1024) {
          const 旧 = join(日志目录, 'plugin.1.log')
          try {
            unlinkSync(旧)
          } catch {
            /* 没有旧的 */
          }
          renameSync(日志文件, 旧)
        }
      } catch {
        /* 轮转失败不影响继续写 */
      }
    } catch {
      /* 磁盘写不进去就算了 */
    }
  }
  const 上一轮 = new Map() // 键 -> { 轮号, 文本, 图们 }
  const 已发轮 = new Set() // 键:轮号
  const 已转消息 = new Set()
  const 上次时间 = new Map()
  const 房间语音模式 = new Map() // 键 -> 'all' | 'off'（这间房之后的语音偏好）
  const 唤醒 = new Map() // 键 -> 时间戳
  const 待批 = new Map() // 号 -> { 时, 昵称, 文字, 条 }
  const 己方消息 = new Set() // 自己发出去的 message_id —— 群里「引用我」靠它对上
  const 记己方消息 = (id) => {
    const v = String(id ?? '').trim()
    if (!v) return
    己方消息.add(v)
    if (己方消息.size > 800) 己方消息.clear()
  }
  let 自己号 = ''
  let 轮询中 = false
  let 已停止 = false
  let 当前控制 = null
  let 当前ws = null
  let 重连定时 = null
  let 重连次数 = 0

  const 服务 = (名) => {
    try {
      return (ctx[名] && typeof ctx[名] === 'object') ? ctx[名] : ctx.get?.(名)
    } catch {
      return undefined
    }
  }

  const 记账 = (文本) => {
    const d = new Date()
    const 补 = (n) => String(n).padStart(2, '0')
    const 时间 = `${补(d.getMonth() + 1)}-${补(d.getDate())} ${补(d.getHours())}:${补(d.getMinutes())}:${补(d.getSeconds())}`
    const 文 = String(文本)
    日志.push({ 时间, 文本: 文 })
    if (日志.length > 日志上限) 日志.shift()
    落日志(`${时间} ${文}`)
    try {
      ctx.logger?.info?.(`qq-rooms: ${文本}`)
    } catch {
      /* 宿主没有 logger */
    }
  }

  /* ---------------- 与原版共存 ---------------- */

  const 原版状态 = (() => {
    try {
      const j = JSON.parse(readFileSync(join(家目录, 'qq-bridge-config.json'), 'utf8'))
      return j && j.总开关 === true ? 'running' : 'disabled'
    } catch {
      return 'absent'
    }
  })()

  const 冲突 = 原版状态 === 'running'
  if (冲突) {
    记账('⚠ 原版 dsh-qq-bridge 的总开关还是开的 —— 为免双发，本插件已停用收发。把它关掉并重启 DSH。')
  }

  /* ---------------- 配置 / 房间 ---------------- */

  const 读 = () => 读配置(家目录)
  const 改 = (变更) => 改配置(家目录, 变更)

  const 工作区 = 服务('workspaceRegistry')
  /** DSH 的归档清单：归档的会话侧栏里看不到，房间不该再续它。 */
  const 已归档 = (sessionId) => {
    try {
      const 集 = 工作区 && 工作区.archivedSessionIds
      if (!集) return false
      const 号 = String(sessionId || '')
      return typeof 集.has === 'function' ? 集.has(号) : Array.from(集).map(String).includes(号)
    } catch {
      return false
    }
  }

  const 同路径 = (a, b) =>
    String(a || '').replace(/[\\/]+$/u, '').toLowerCase() === String(b || '').replace(/[\\/]+$/u, '').toLowerCase()

  /** 把会话登记进「房间工作区」对应的 workspace —— 侧栏才会归到那一栏，而不是「未分组」。 */
  async function 登记工作区(sessionId, cwd) {
    if (已归档(sessionId)) return
    if (!工作区 || typeof 工作区.list !== 'function') return
    let 目标 = null
    try {
      目标 = (工作区.list() || []).find((w) => 同路径(w.path, cwd))
    } catch {
      return
    }
    if (!目标 || (目标.sessionIds || []).includes(sessionId)) return

    // 行上的字段是 id（不是 workspaceId）；加入会话用 Workspace 实体的 attachSession
    const 区id = 目标.workspaceId || 目标.id
    try {
      const 实体 = typeof 工作区.get === 'function' ? 工作区.get(区id) : null
      if (实体 && typeof 实体.attachSession === 'function') {
        await 实体.attachSession(sessionId)
        记账(`会话 ${String(sessionId).slice(-8)} 已归到工作区「${目标.title || 目标.path}」`)
        return
      }
      if (实体 && typeof 实体.insertSessionBefore === 'function') {
        await 实体.insertSessionBefore(sessionId)
        记账(`会话 ${String(sessionId).slice(-8)} 已归到工作区「${目标.title || 目标.path}」`)
        return
      }
      记账('登记工作区失败：实体没有 attachSession')
    } catch (error) {
      记账('登记工作区失败：' + String((error && error.message) || error))
    }
  }

  /** 启动/保存时把已有房间补登记一遍（只对同名工作区）。 */
  async function 补工作区(配置) {
    const cwd = 房间工作区(配置, 家目录)
    for (const 行 of Object.values(配置.房间 || {})) {
      if (行.sessionId) await 登记工作区(行.sessionId, cwd)
    }
  }

  const 房间 = new 房间管理器({
    agents: 服务('agents'),
    读,
    改,
    家目录,
    日志: 记账,
    工作区,
    已归档,
    登记: 登记工作区,
  })

  const 传输 = (配置 = 读()) => new OneBot({ 地址: 配置.NapCat, 令牌: 配置.令牌, 日志: 记账 })

  /* ---------------- 状态持久化 ---------------- */

  const 读水位 = () => {
    try {
      const j = JSON.parse(readFileSync(状态文件, 'utf8'))
      if (j && j.上次 && typeof j.上次 === 'object') {
        for (const [k, v] of Object.entries(j.上次)) 上次时间.set(String(k), Number(v) || 0)
      }
      if (j && Array.isArray(j.已转)) for (const id of j.已转.slice(-300)) 已转消息.add(String(id))
      if (j && j.语音模式 && typeof j.语音模式 === 'object') {
        for (const [k, v] of Object.entries(j.语音模式)) {
          if (v === 'all' || v === 'off') 房间语音模式.set(String(k), v)
        }
      }
    } catch {
      /* 第一次跑 */
    }
  }

  const 存水位 = () => {
    try {
      mkdirSync(家目录, { recursive: true })
      writeFileSync(
        状态文件,
        JSON.stringify({
          上次: Object.fromEntries(上次时间),
          已转: [...已转消息].slice(-300),
          语音模式: Object.fromEntries(房间语音模式),
        }, null, 2),
        'utf8',
      )
    } catch {
      /* 存不下不影响收发 */
    }
  }

  读水位()

  /* ---------------- 图片 ---------------- */

  const 图上限字节 = (配置) => Math.max(1, Math.min(Number(配置.图上限MB) || 5, 30)) * 1024 * 1024

  async function 收图(配置, 图们, 消息id) {
    if (!配置.收图 || !Array.isArray(图们) || !图们.length) return []
    const 上限 = Math.max(1, Math.min(Number(配置.收图最多) || 4, 10))
    const 最大 = 图上限字节(配置)
    const 出 = []
    let 序 = 0
    for (const 段 of 图们.slice(0, 上限)) {
      序 += 1
      const 字节 = await 取图字节(段 && 段.data ? 段.data : 段)
      if (!字节 || !字节.length) {
        记账(`第 ${序} 张图下载失败，跳过`)
        continue
      }
      if (字节.length > 最大) {
        记账(`第 ${序} 张图太大（${Math.round(字节.length / 1048576)}MB），跳过`)
        continue
      }
      const 类 = 看图类(字节)
      出.push({ 类, b64: 字节.toString('base64'), 存: 存图(收图目录, `${消息id || 'qq'}-${序}`, 字节, 类), 字节: 字节.length })
    }
    return 出
  }

  /**
   * 相对路径按「图片根目录 → 房间工作区 → 进程 cwd → 家目录」找（照原版 dsh-qq-bridge 的顺序）；
   * 绝对路径直接用。找不到返回 ''。
   */
  function 找本地图(配置, p) {
    const 原 = String(p || '').trim()
    if (!原) return ''
    if (/^[a-zA-Z]:[\\/]/u.test(原) || 原.startsWith('\\\\') || 原.startsWith('/')) {
      try {
        return existsSync(原) ? 原 : ''
      } catch {
        return ''
      }
    }
    const 根们 = [
      String(配置.图片根目录 || '').trim(),
      房间工作区(配置, 家目录),
      process.cwd(),
      家目录,
    ].filter(Boolean)
    for (const 根 of 根们) {
      const 全 = join(String(根), 原)
      try {
        if (existsSync(全)) return 全
      } catch {
        /* 继续试下一个根 */
      }
    }
    return ''
  }

  /** 出站图片：附件块拿本地文件；正文图可以是路径或 URL。 */
  function 出站图片(配置, 附件块们, 正文图) {
    const 最大 = 图上限字节(配置)
    const 出 = []
    for (const 源 of 正文图 || []) {
      if (出.length >= 4) break
      if (源.kind === 'url') {
        出.push({ url: 源.value })
        continue
      }
      const 全 = 找本地图(配置, 源.value)
      if (!全) {
        记账('正文图找不到，跳过：' + 源.value)
        continue
      }
      try {
        const 字节 = readFileSync(全)
        if (字节.length > 最大) {
          记账('正文图太大，跳过：' + 源.value)
          continue
        }
        出.push({ b64: 字节.toString('base64') })
      } catch {
        记账('正文图读不到，跳过：' + 源.value)
      }
    }
    const 附件服务 = 服务('attachments')
    for (const 块 of 附件块们 || []) {
      if (出.length >= 4) break
      try {
        const p = 附件服务 && typeof 附件服务.imageHostPath === 'function'
          ? 附件服务.imageHostPath(块.attachment)
          : undefined
        if (!p) continue
        const 字节 = readFileSync(p)
        if (字节.length > 最大) {
          记账('附件图太大，跳过')
          continue
        }
        出.push({ b64: 字节.toString('base64') })
      } catch {
        记账('附件图读不到，跳过')
      }
    }
    return 出
  }

  /* ---------------- 发送 ---------------- */

  /**
   * 真的发出去：不看总开关 / 试运行（「发送」和「测试」共用）。返回结果数组。
   * 选项.语音 = true 时先合成语音；成功就发语音条，失败自动退回文字。
   */
  async function 裸发(配置, 键, 段们, 图数据, 选项 = {}) {
    const 拆 = 拆聊天键(键)
    if (!拆) return []
    const 传 = 传输(配置)
    const 结果 = []
    const 念 = String(选项.语音文字 || '').trim()
    let 发了语音 = false
    if (选项.语音 && 念) {
      const 合成 = await 合成语音(念, { 配置, 家目录 })
      if (合成.ok) {
        const 语音结果 = await 传.发语音(拆.类型, 拆.号码, 合成.文件)
        结果.push(...语音结果.map((r) => ({ ...r, 语音: true })))
        if (语音结果.length && 语音结果.every((r) => r.ok)) {
          发了语音 = true
          // 念的时候截断了就别把后半段吞掉；「附带文字」开着也照发。
          if (!配置.语音附带文字 && !合成.截断) 段们 = []
        } else {
          记账('语音发出去了但后端回了失败 —— 这一条再补发文字')
        }
      } else {
        记账('语音合成失败：' + 合成.错 + ' —— 这一条改发文字')
      }
    }
    if (段们.length) 结果.push(...(await 传.发文字(拆.类型, 拆.号码, 段们, { 间隔毫秒: 配置.拆段间隔毫秒 })))
    if (图数据.length) 结果.push(...(await 传.发图片(拆.类型, 拆.号码, 图数据, { 间隔毫秒: 配置.拆段间隔毫秒 })))
    // 记住自己发出去的 message_id —— 群里「引用我」就是靠它认出来的
    for (const r of 结果) {
      const id = r && r.ok && r.数据 && r.数据.data ? r.数据.data.message_id : undefined
      if (id !== undefined && id !== null) 记己方消息(id)
    }
    const 好 = 结果.length > 0 && 结果.every((r) => r.ok)
    const 首句 = String((段们[0] || 念 || '')).slice(0, 50)
    记账(`${好 ? '✅ 已发到' : '⚠ 发送有问题'} ${键}${发了语音 ? '（语音）' : ''}：「${首句}」${图数据.length ? `（含 ${图数据.length} 张图）` : ''}`)
    for (const r of 结果) if (!r.ok) 记账('   ' + r.action + ' 失败：' + JSON.stringify(r.数据).slice(0, 140))
    return 结果
  }

  /** 带闸的发送：总开关 + 试运行。返回结果数组（试运行/关闸 → 空数组）。 */
  async function 发送(配置, 键, 段们, 图数据, 选项 = {}) {
    if (!配置.总开关) {
      记账('总开关关着，这条没发')
      return []
    }
    if (配置.试运行) {
      记账(`试运行：本来要发到 ${键}${选项.语音 ? '（语音）' : ''} →「${String(段们[0] || 选项.语音文字 || '').slice(0, 40)}」${图数据.length ? `（还有 ${图数据.length} 张图）` : ''}`)
      return []
    }
    return 裸发(配置, 键, 段们, 图数据, 选项)
  }

  /** 私聊直发（回执、审批用）；同样受试运行约束。 */
  async function 发私聊(配置, 号码, 文字) {
    const 段们 = 配置.长回复拆段 ? 按段拆(文字) : [String(文字 || '').trim()].filter(Boolean)
    return 发送(配置, 聊天键('私聊', 号码), 段们, [])
  }

  /** 私聊直发，不看总开关和试运行 —— 只有设置页的「测试」用它。 */
  async function 私聊裸发(配置, 号码, 文字, 选项 = {}) {
    const 段们 = 配置.长回复拆段 ? 按段拆(文字) : [String(文字 || '').trim()].filter(Boolean)
    return 裸发(配置, 聊天键('私聊', 号码), 段们, [], 选项)
  }

  /* ---------------- 语音工具（主人私聊） ---------------- */

  /** 给主人的私聊挂上 qq_voice：用户说“发条语音”时直接合成一条。 */
  function 挂语音工具(agent, 键) {
    if (!agent || !agent.ctx || !agent.ctx.tools || typeof agent.ctx.tools.register !== 'function') return
    if (已挂语音.has(agent)) return
    已挂语音.add(agent)
    try {
      agent.ctx.tools.register({
        name: 'qq_voice',
        description: '把一句话合成语音发到当前 QQ 聊天。用户说“发条语音 / 用语音说 / 念出来”时调用。text 里可以少量加 (laughs)/(sighs)/(breath)/(emm)，最多一个。调用后回复里不要再写 [语音]，也不用重复这句话。',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '要念的内容（中文即可）' },
          },
          required: ['text'],
          additionalProperties: false,
        },
        output: {
          schema: {
            type: 'object',
            properties: { ok: { type: 'boolean' }, 说: { type: 'string' } },
            additionalProperties: true,
          },
          render: (_参数, 值) => [{ type: 'text', text: String((值 && 值.说) || '') }],
        },
        execute: async (参数 = {}) => 开说(键, 参数),
      })
      记账(`语音工具已挂上：${键}`)
    } catch (error) {
      记账('语音工具挂不上：' + String((error && error.message) || error))
    }
  }

  const 有效语音模式 = (配置, 键) => 房间语音模式.get(键) || 配置.语音模式

  /** 兜底：主人明确说「接下来都用语音」时，不依赖模型一定要调工具。 */
  function 识别语音偏好(文字) {
    const t = String(文字 || '').trim().replace(/[。！!，,]+$/u, '')
    if (!t || t.length > 40) return ''
    if (/(?:别|不要|不用|停止|关掉|关了).{0,4}语音/u.test(t)) return 'off'
    if (/^(?:都|全都|一直|全程|接下来|以后|之后|下面|往后).{0,8}(?:语音|念)/u.test(t)) return 'all'
    if (/^(?:请)?(?:用|发)?语音(?:回复|回|说)?$/u.test(t)) return 'all'
    if (/^(?:都|全都|一直|全程|接下来|以后|之后|下面|往后).{0,8}(?:文字|打字)/u.test(t)) return 'off'
    if (/^(?:请)?(?:用|发|改|换)?文字(?:回复|回)?$/u.test(t)) return 'off'
    if (/^(?:恢复|回到)(?:自动|默认)$/u.test(t) || /^你自己判断$/u.test(t)) return 'auto'
    return ''
  }

  /** 记住「这间房之后都用语音 / 都用文字」。 */
  function 挂语音模式工具(agent, 键) {
    if (!agent || !agent.ctx || !agent.ctx.tools || typeof agent.ctx.tools.register !== 'function') return
    if (已挂语音模式.has(agent)) return
    已挂语音模式.add(agent)
    try {
      agent.ctx.tools.register({
        name: 'qq_voice_mode',
        description: '记住当前 QQ 房间之后的语音偏好。用户说“接下来都用语音 / 都用语音回复”时 mode=voice；说“用文字 / 别用语音”时 mode=text；说“恢复自动 / 你自己判断”时 mode=auto。只对主人私聊有效。',
        parameters: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              enum: ['voice', 'text', 'auto'],
              description: 'voice = 之后都用语音；text = 之后都用文字；auto = 恢复全局设置',
            },
          },
          required: ['mode'],
          additionalProperties: false,
        },
        output: {
          schema: {
            type: 'object',
            properties: { ok: { type: 'boolean' }, 说: { type: 'string' } },
            additionalProperties: true,
          },
          render: (_参数, 值) => [{ type: 'text', text: String((值 && 值.说) || '') }],
        },
        execute: async (参数 = {}) => 设房间语音(键, 参数),
      })
      记账(`语音偏好工具已挂上：${键}`)
    } catch (error) {
      记账('语音偏好工具挂不上：' + String((error && error.message) || error))
    }
  }

  async function 设房间语音(键, 参数 = {}) {
    const 配置 = 读()
    const 拆 = 拆聊天键(键)
    if (!拆 || 拆.类型 !== '私聊' || 拆.号码 !== String(配置.主人)) {
      return { ok: false, 说: '语音偏好只给主人私聊设置' }
    }
    const mode = String(参数.mode || '')
    if (mode === 'voice') 房间语音模式.set(键, 'all')
    else if (mode === 'text') 房间语音模式.set(键, 'off')
    else if (mode === 'auto') 房间语音模式.delete(键)
    else return { ok: false, 说: 'mode 只能是 voice / text / auto' }
    存水位()
    记账(`语音偏好已设为 ${mode === 'voice' ? '都用语音' : mode === 'text' ? '都用文字' : '跟随全局'}：${键}`)
    return {
      ok: true,
      说: mode === 'voice' ? '记住了：这间房之后都用语音' : mode === 'text' ? '记住了：这间房之后都用文字' : '记住了：恢复全局语音设置',
    }
  }

  async function 开说(键, 参数 = {}) {
    const 配置 = 读()
    const 拆 = 拆聊天键(键)
    if (!拆 || 拆.类型 !== '私聊' || 拆.号码 !== String(配置.主人)) {
      return { ok: false, 说: '语音只给主人私聊用' }
    }
    if (!配置.总开关) return { ok: false, 说: '总开关关着，不发' }
    if (配置.试运行) return { ok: false, 说: '试运行中，不真的发' }
    if (有效语音模式(配置, 键) === 'all') {
      return { ok: false, 说: '现在是每条都念，直接正常回复就会发语音，不用调这个工具' }
    }
    const 文字 = String(参数.text || '').trim()
    if (!文字) return { ok: false, 说: '要念什么？给一句文字' }
    const 结果 = await 发送(配置, 键, [], [], { 语音: true, 语音文字: 文字 })
    const 好 = 结果.some((r) => r.ok && r.语音)
    if (好) 工具发语音.set(键, Date.now())
    return { ok: 好, 说: 好 ? '语音发了，回复里不用再重复这句话' : '语音没发出去（看日志）' }
  }

  /* ---------------- 生图（主人私聊） ---------------- */

  const 今天 = () => {
    const d = new Date()
    const 补 = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${补(d.getMonth() + 1)}-${补(d.getDate())}`
  }

  function 读生图用量() {
    try {
      const j = JSON.parse(readFileSync(生图用量文件, 'utf8'))
      return j && j.日期 === 今天() ? Math.max(0, Number(j.次数) || 0) : 0
    } catch {
      return 0
    }
  }

  function 加生图用量() {
    try {
      writeFileSync(生图用量文件, JSON.stringify({ 日期: 今天(), 次数: 读生图用量() + 1 }), 'utf8')
    } catch {
      /* 记不上也不影响画图 */
    }
  }

  /** 给主人的私聊挂上 qq_draw（每间房只挂一次）。 */
  function 挂生图工具(agent, 键, 配置) {
    if (!配置.生图) return
    if (!agent || !agent.ctx || !agent.ctx.tools || typeof agent.ctx.tools.register !== 'function') return
    if (已挂生图.has(agent)) return
    已挂生图.add(agent)
    try {
      agent.ctx.tools.register({
        name: 'qq_draw',
        description: '让 MiniMax 画一张图并发到当前 QQ 聊天。用户说“画一张 / 来张图 / 生成图片”时调用。prompt 写清楚画面；aspect_ratio 可选。',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: '画面描述（中文即可）' },
            aspect_ratio: {
              type: 'string',
              enum: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'],
              description: '图片比例；不填就用设置里的默认值',
            },
          },
          required: ['prompt'],
          additionalProperties: false,
        },
        output: {
          schema: {
            type: 'object',
            properties: { ok: { type: 'boolean' }, 说: { type: 'string' } },
            additionalProperties: true,
          },
          render: (_参数, 值) => [{ type: 'text', text: String((值 && 值.说) || '') }],
        },
        execute: async (参数 = {}) => 开画(键, 参数),
      })
      记账(`生图工具已挂上：${键}`)
    } catch (error) {
      记账('生图工具挂不上：' + String((error && error.message) || error))
    }
  }

  async function 开画(键, 参数 = {}) {
    const 配置 = 读()
    const 拆 = 拆聊天键(键)
    if (!拆 || 拆.类型 !== '私聊' || 拆.号码 !== String(配置.主人)) {
      return { ok: false, 说: '生图只给主人私聊用' }
    }
    if (!配置.生图) return { ok: false, 说: '生图没开（设置 → 通到 QQ → 总览）' }
    if (!配置.总开关) return { ok: false, 说: '总开关关着，不画' }
    if (配置.试运行) return { ok: false, 说: '试运行中，不真的画' }
    if (!配置.发图) return { ok: false, 说: '「发图」关着，画了也发不出去' }

    const 提示 = 洗生图提示((配置.生图提示前缀 || '') + String(参数.prompt || ''))
    if (!提示) return { ok: false, 说: '要画什么？给一句画面描述' }
    const 上限 = Number(配置.生图每日上限) || 0
    if (上限 > 0 && 读生图用量() >= 上限) {
      return { ok: false, 说: `今天的生图次数用完了（${上限} 张）` }
    }
    if (生图中.has(键)) return { ok: false, 说: '上一张还在画，等它出来' }

    生图中.add(键)
    const 尺寸 = 选尺寸(参数.aspect_ratio || 配置.生图尺寸)
    const 画配置 = { ...配置, 生图尺寸: 尺寸 }
    void (async () => {
      try {
        记账(`🎨 开始生图（${键}，${尺寸}）：${提示.slice(0, 60)}`)
        const 图 = await 生成图片(提示, { 配置: 画配置, 家目录 })
        if (!图.ok) {
          记账('生图失败：' + 图.错)
          await 发送(读(), 键, [`图没画出来：${图.错}`], [])
          return
        }
        加生图用量()
        const b64 = readFileSync(图.文件).toString('base64')
        const 结果 = await 发送(读(), 键, [], [{ b64 }])
        const 好 = 结果.length > 0 && 结果.every((r) => r.ok)
        记账(`${好 ? '✅ 生图已发' : '⚠ 生图发送有问题'} ${键}（${Math.round(图.字节 / 1024)}KB）`)
        if (!好 && 结果.length) await 发送(读(), 键, ['图画好了，但发到 QQ 失败了（看日志）'], [])
      } catch (error) {
        记账('生图异常：' + String((error && error.message) || error))
        await 发送(读(), 键, ['生图出错了：' + String((error && error.message) || error)], [])
      } finally {
        生图中.delete(键)
      }
    })()
    return { ok: true, 说: '开始画了，画好会直接发到这边；不用再回复。' }
  }

  /* ---------------- 出站 ---------------- */

  function 反查键(配置, sessionId) {
    const 目标 = String(sessionId || '')
    const 去前缀 = (s) => String(s || '').replace(/^session-/u, '')
    for (const 键 of Object.keys(配置.房间 || {})) {
      if (去前缀(配置.房间[键].sessionId) === 去前缀(目标)) return 键
    }
    return ''
  }

  async function 落地一发(配置, 键, 文字, 图块们) {
    if (已发轮.size > 300) 已发轮.clear()
    if (!配置.总开关) return 记账('总开关关着，这一轮没发')
    if (配置.只回QQ唤醒) {
      const 醒 = 唤醒.get(键) || 0
      if (!醒 || Date.now() - 醒 > 唤醒窗口毫秒) {
        return 记账('这一轮不是 QQ 消息叫醒的（「只回 QQ 唤醒」开着）—— 只在本机说')
      }
    }
    唤醒.delete(键)

    const 标记 = 抠QQ标记(文字, 配置.只发标记内)
    if (!标记.发) return 记账('这一轮没写 [QQ] 块（「只发标记内」开着）—— 不往 QQ 发')
    if (标记.原因) 记账(标记.原因)

    const 语音判 = 判断发语音({ ...配置, 语音模式: 有效语音模式(配置, 键) }, 标记.文字)
    const 工具发过 = 工具发语音.get(键) || 0
    if (工具发过) {
      工具发语音.delete(键)
      if (Date.now() - 工具发过 < 2 * 60 * 1000) 语音判.定 = false
    }
    const 抠过 = 配置.发图 ? 抠正文图(语音判.文字) : { 净文字: 语音判.文字, 图: [] }
    const 净文字 = String(抠过.净文字 || '').trim()
    const 段们 = 配置.长回复拆段 ? 按段拆(净文字) : [净文字].filter(Boolean)
    const 图数据 = 配置.发图 ? 出站图片(配置, 图块们, 抠过.图) : []
    if (!段们.length && !图数据.length) return 记账('这一轮既没文字也没图，不发')
    const 选项 = 语音判.定 && 净文字 ? { 语音: true, 语音文字: 净文字 } : {}
    await 发送(配置, 键, 段们, 图数据, 选项)
  }

  function 收到事件(session, event) {
    const 配置 = 读()
    const 键 = 反查键(配置, session && session.id)
    if (!键) return
    if (!event) return

    const 上 = 上一轮.get(键) || { 轮号: -1, 文本: '', 图们: [] }
    const 记 = (v) => 上一轮.set(键, v)

    if (event.type === 'user/message') {
      // 本机手动说话 → 不再算「QQ 叫醒的」。
      // 注意：user/message 的 data 就是消息本身（source 在顶层），
      // assistant/message 的 data 才是 { turn, step, message }，两种都要兼容。
      const 数据 = event.data || {}
      const 源 = 数据.source || (数据.message && 数据.message.source)
      const 类 = String((源 && 源.kind) || '')
      // 搭车的注入也是 user/message —— 它们不是人打的字，不能拿来判「这一轮是谁起的头」
      if (搭车注入.has(类) || 搭车前缀.test(类)) return
      if (!类 || 类 === 'user') 唤醒.delete(键)
      return
    }

    if (event.type === 'assistant/message') {
      const d = event.data || {}
      if (d.interrupted) return 记({ 轮号: -1, 文本: '', 图们: [] })
      const 文 = String(提取正文(d.message) || '').trim()
      const 图们 = 提取图块(d.message)
      if (文) 记({ 轮号: d.turn, 文本: 文, 图们 })
      else if (图们.length) {
        记({
          轮号: d.turn,
          文本: 上.轮号 === d.turn ? 上.文本 : '',
          图们: (上.轮号 === d.turn ? 上.图们 : []).concat(图们).slice(0, 10),
        })
      }
      return
    }

    if (event.type === 'turn/end') {
      const d = event.data || {}
      const 完成 = Boolean(d.reason && d.reason.kind === 'completed')
      const 有东西 = 上.文本 || (上.图们 && 上.图们.length)
      const 轮标 = 键 + ':' + String((session && session.id) || '') + ':' + String(d.turn)
      if (完成 && 上.轮号 === d.turn && 有东西 && !已发轮.has(轮标)) {
        已发轮.add(轮标)
        void 落地一发(配置, 键, 上.文本, 上.图们)
        // 落地一发 在第一个 await 前已经读过这个标记；这里兜底清掉，
        // 避免「这一轮只调了 qq_voice、最终没文字」时压住下一轮的随机语音。
        工具发语音.delete(键)
      }
      记({ 轮号: -1, 文本: '', 图们: [] })
    }
  }

  /* ---------------- 入站 ---------------- */

  /** agent id -> { 策略, 摘遮罩, 摘守卫 }。留着 disposer 才能实时换档：restrictions 是相交的，不撤旧的松不开。 */
  const 已限工具 = new Map()
  /** 房间键 -> 活着的 agent：保存设置时用它立刻套用，不用等下一句。 */
  const 键agent = new Map()
  /** 生图 / 语音工具每间房只挂一次（agent 对象身份）。 */
  const 已挂生图 = new WeakSet()
  const 已挂语音 = new WeakSet()
  const 已挂语音模式 = new WeakSet()
  /** 同一间房同时只画一张。 */
  const 生图中 = new Set()
  /** 这一轮已经用 qq_voice 发过语音：自动语音就别再发一遍。 */
  const 工具发语音 = new Map()

  /**
   * 访客房间的工具闸门。
   *
   * DSH 的 `ctx.tools.restrict({ allow })` 只遮 **agent 从全局继承来的工具**；
   * 别的插件注册在 agent 自己 scope 上的工具遮不住（官方文档原话：scoped registrations stay visible）。
   * 而 DeepSeek 的接口要求请求里**至少有一个非 deferred 工具** —— 中途新增的工具是按 deferred 发的。
   *
   * 所以「真·零工具」没法表达：第一轮 tools 为空能过，第二轮只要谁中途塞进一个 scoped 工具，
   * 整个请求就变成「全是 deferred」→ 400 INVALID_REQUEST（实测：dsh-fish-memory 的 remember）。
   *
   * 做法：allow 一个**全局**占位工具让请求合法；`none` 再用 `tools.guard()` 把执行全部拒掉。
   * 占位只影响 schema，不带来任何能力 —— 选谁都被 guard 拒。
   */
  const 占位候选 = ['list_mcp_resources', 'list_mcp_resource_templates', 'load_workspace_dependencies', 'get_goal', 'todo_write']

  /**
   * 用 allow 名单把可见工具收到「只剩一个占位」。
   * @returns {{名: string, 摘: Function} | null} 占位名和撤掉这道遮罩的 disposer；点不到名 → null
   */
  function 装遮罩(器) {
    let 最后错 = ''
    for (const 名 of 占位候选) {
      try {
        return { 名, 摘: 器.restrict({ allow: [名] }) }
      } catch (error) {
        最后错 = String((error && error.message) || error)
      }
    }
    // 候选都不在：错误信息里带着「known global tools: a, b, c …」，从里面挑一个只读的
    const m = /known global tools:\s*([^)]*)/u.exec(最后错)
    const 已知 = m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : []
    const 挑 = 已知.find((名) => /^list_mcp_resources?$/u.test(名) || /__list_/u.test(名)) || 已知[0]
    if (挑) {
      try {
        return { 名: 挑, 摘: 器.restrict({ allow: [挑] }) }
      } catch {
        /* 还是不行，走回落 */
      }
    }
    return null
  }

  /** 撤掉某个 agent 上的旧限制（换档 / 改成主人 / 房间重建时用）。 */
  function 释放工具限制(id) {
    const 记 = 已限工具.get(String(id || ''))
    if (!记) return
    for (const 摘 of [记.摘遮罩, 记.摘守卫]) {
      try {
        摘?.()
      } catch {
        /* 已经失效 */
      }
    }
    已限工具.delete(String(id || ''))
  }

  /** 这一间该用哪档：单房覆盖 > 按聊天类型的默认（群 / 访客）。 */
  const 房间策略 = (配置, 键) => {
    const 覆盖 = (配置.房间工具 || {})[键]
    if (覆盖) return 覆盖
    return String(键).startsWith('群:') ? (配置.群工具 || 'none') : 配置.访客工具
  }

  /** 套用（或换掉）一间房当前的工具档。同一档重复调用是空操作。 */
  function 限制访客工具(agent, 策略) {
    if (!agent) return
    const id = agent.id || (agent.session && agent.session.id)
    if (!id) return
    const 现 = 已限工具.get(id)
    if (现 && 现.策略 === 策略) return

    const 器 = agent.ctx && agent.ctx.tools
    if (!器 || typeof 器.restrict !== 'function') {
      记账('访客工具限制：宿主没有 tools.restrict')
      return
    }
    // 档位变了：先摘旧的 —— restrictions 相交，累加只会越限越死（standard 也放不开）
    释放工具限制(id)

    const 记 = { 策略, 摘遮罩: null, 摘守卫: null }
    try {
      if (策略 === 'standard') {
        已限工具.set(id, 记)
        记账(`访客工具已放开到 standard：${id}`)
        return
      }
      const 遮 = 装遮罩(器)
      if (遮) 记.摘遮罩 = 遮.摘
      else {
        记.摘遮罩 = 器.restrict({ allow: [] })
        记账('没找到能点名的占位工具 —— 回落到零工具（这一间第二轮可能被 DeepSeek 拒）')
      }
      if (typeof 器.guard === 'function') {
        try {
          记.摘守卫 = 策略 === 'none'
            ? 器.guard(() => '访客房间：工具已禁用')
            : 器.guard((exec) => (exec && exec.name === 'todo_write' ? undefined : '访客房间：只允许 todo_write'))
        } catch (error) {
          记账('工具守卫装不上：' + String((error && error.message) || error))
        }
      } else if (策略 === 'none') {
        记账('访客工具限制：宿主没有 tools.guard —— 占位工具仍可被执行')
      }
      已限工具.set(id, 记)
      记账(`访客房间工具已限制（${策略}${遮 ? `，占位 ${遮.名}` : '，零工具'}）：${id}`)
    } catch (error) {
      记账('访客工具限制失败：' + String((error && error.message) || error))
    }
  }

  const 昵称 = (条) => String((条.sender && (条.sender.card ||条.sender.nickname)) || '')

  /** 当前房间和对方是谁；只在新房/身份变化时注入一次。 */
  function 身份上下文(配置, 键, 条) {
    const 拆 = 拆聊天键(键)
    if (!拆) return ''
    const 发送者 = String(条.user_id || 拆.号码 || '')
    const 名 = 昵称(条) || String((配置.房间 || {})[键]?.昵称 || '')
    if (拆.类型 === '私聊') {
      const 是主人 = 拆.号码 === String(配置.主人)
      const 是访客 = Boolean(配置.访客 && 配置.访客[拆.号码])
      const 关系 = 是主人 ? '主人（管理员）' : 是访客 ? '已批准的访客' : '普通私聊对象'
      return `（QQ 私聊房间。对方 QQ：${拆.号码}；昵称：${名 || '未知'}；关系：${关系}。这段是身份信息，不用向对方复述。）`
    }
    const 群 = (配置.群 || {})[拆.号码] || {}
    const 成员 = 群.members || {}
    const 是主人 = 发送者 === String(配置.主人)
    const 是白名单 = Array.isArray(成员.allow) && 成员.allow.includes(发送者)
    const 关系 = 是主人 ? '主人（管理员）' : 是白名单 ? '群白名单成员' : '普通群成员'
    const 群名 = 群.名称 || '未知群'
    return `（QQ 群聊房间。群：${群名}（${拆.号码}）；当前发言者：${名 || '未知'}（QQ ${发送者}）；关系：${关系}。这段是身份信息，不用向对方复述。）`
  }

  /** 新房间的人格设定：从房间工作区的 AGENTS.md 读（agents.create 不会自动注入）。 */
  function 读人格(配置) {
    try {
      const t = readFileSync(join(房间工作区(配置, 家目录), 'AGENTS.md'), 'utf8').trim()
      if (!t) return ''
      return t.length > 6000 ? t.slice(0, 6000) + '\n…（太长，后面截断）' : t
    } catch {
      return ''
    }
  }

  async function 转入(配置, { 键, 类型, 号码, 发送者, 文字, 图们, 条 }) {
    const 房 = await 房间.确保(键, { 昵称: 昵称(条) })
    const 拆 = 拆聊天键(键)
    // 房间是私聊就把对方昵称记到配置里，设置页直接显示（群名走启动补昵称）
    if (拆 && 拆.类型 === '私聊') 记昵称(键, 昵称(条))
    if (拆 && 拆.类型 === '私聊' && 拆.号码 === String(配置.主人)) {
      挂语音工具(房.agent, 键)
      挂语音模式工具(房.agent, 键)
      挂生图工具(房.agent, 键, 配置)
    }
    // 除了「主人的私聊」，所有房间都上闸门：群成员不可信，群房默认全禁；档位改了当场换
    const 是主人私聊 = 拆 && 拆.类型 === '私聊' && 拆.号码 === String(配置.主人)
    if (是主人私聊) {
      const 偏好 = 识别语音偏好(文字)
      if (偏好 === 'all') 房间语音模式.set(键, 'all')
      else if (偏好 === 'off') 房间语音模式.set(键, 'off')
      else if (偏好 === 'auto') 房间语音模式.delete(键)
      if (偏好) {
        存水位()
        记账(`语音偏好：${偏好 === 'all' ? '都用语音' : 偏好 === 'off' ? '都用文字' : '跟随全局'}（按消息识别）`)
      }
    }
    if (!是主人私聊) {
      键agent.set(键, 房.agent)
      限制访客工具(房.agent, 房间策略(配置, 键))
    }

    const 收下 = await 收图(配置, 图们, 条.message_id)
    const 署名 = (昵称(条) || '某人') + '（' + 发送者 + '）：'
    const 图说明 = 收下.length
      ? '\n（' + (类型 === '群' ? '发来' : '你发来') + ` ${收下.length} 张图：`
        + 收下.map((x, i) => `第${i + 1}张 ${Math.round(x.字节 / 1024)}KB` + (x.存 ? `，要发回去用 ${x.存}` : '')).join('；')
        + '）'
      : ''
    const 块提示 = 配置.只发标记内
      ? '\n\n（这台机器只把正文里 `[QQ]…[/QQ]` 中间那段发到 QQ —— 想让手机收到的就写在里面；块外的话只在本机看。）'
      : ''
    const 正文 = (文字 ? 署名 + 文字 : (收下.length ? 署名 + '（发来了图片，没有配字）' : '')) + 图说明
    if (!正文.trim()) {
      已转消息.add(String(条.message_id))
      return false
    }

    // 身份注入：新房 / 昵称或关系变了时，告诉模型“这是谁”
    const 身份 = 身份上下文(配置, 键, 条)
    const 身份哈希 = 身份 ? createHash('sha1').update(身份).digest('hex').slice(0, 12) : ''
    const 房记录 = (配置.房间 || {})[键] || {}
    const 要注入身份 = Boolean(身份) && (房.created || 房记录.identityHash !== 身份哈希)
    const 身份块 = 要注入身份
      ? '（下面是当前房间和对方身份，按这个理解谁在说话；不用向对方解释这段。）\n\n' + 身份 + '\n\n----\n\n'
      : ''
    if (要注入身份) {
      改((旧) => {
        const 行们 = { ...(旧.房间 || {}) }
        const 现行 = 行们[键] || { sessionId: 房.sessionId, createdAt: Date.now(), lastAt: Date.now() }
        行们[键] = { ...现行, identityHash: 身份哈希 }
        return { ...旧, 房间: 行们 }
      })
      记账(`身份已注入到 ${键}：${身份}`)
    }

    // 人格注入：新房必注入；老房只在人格文件内容变了时重新注入一次
    const 人设文本 = 读人格(配置)
    const 人设哈希 = 人设文本 ? createHash('sha1').update(人设文本).digest('hex').slice(0, 12) : ''
    const 要注入 = Boolean(人设文本) && (房.created || 房记录.personaHash !== 人设哈希)
    const 人设 = 要注入 ? 人设文本 : ''
    const 人生块 = 人设
      ? (房.created ? '' : '（人格设定有更新，后面按这份新的来。）\n\n')
        + '（下面是这个工作区的人格设定，从现在起按它说话；不用向对方解释这段。）\n\n'
        + 人设 + '\n\n----\n\n'
      : ''
    if (要注入) {
      改((旧) => {
        const 行们 = { ...(旧.房间 || {}) }
        const 现行 = 行们[键] || { sessionId: 房.sessionId, createdAt: Date.now(), lastAt: Date.now() }
        行们[键] = { ...现行, personaHash: 人设哈希 }
        return { ...旧, 房间: 行们 }
      })
      if (!房.created) 记账(`人格已更新，注入到 ${键}`)
    }
    let content = [{ type: 'text', text: 身份块 + 人生块 + 正文 + 块提示 }]
    const 附件 = 服务('attachments')
    if (收下.length && 附件 && typeof 附件.admitPromptContent === 'function') {
      try {
        content = await 附件.admitPromptContent([
          ...content,
          ...收下.map((x, i) => ({
            type: 'image',
            data: x.b64,
            mediaType: x.类,
            name: `qq-${条.message_id || 'x'}-${i + 1}.${x.类.split('/')[1] || 'jpg'}`,
          })),
        ])
      } catch (error) {
        记账('图交给 DSH 没成功（这轮只转文字）：' + String((error && error.message) || error))
        content = [{ type: 'text', text: 身份块 + 人生块 + 正文 + 块提示 }]
      }
    }

    try {
      await 房.agent.followup({ id: randomUUID(), role: 'user', content, source: { kind: 'qq' } })
      唤醒.set(键, Date.now())
      已转消息.add(String(条.message_id))
      try {
        if (ctx.sessions && typeof ctx.sessions.flush === 'function') await ctx.sessions.flush(房.agent.session)
      } catch {
        /* flush 失败不影响投递 */
      }
      记账(`收到 ${键} → 转进房间：「${(文字 || '（图）').slice(0, 50)}」`)
      return true
    } catch (error) {
      记账(`转进房间失败 ${键}：${String((error && error.message) || error)}（下一跳重试）`)
      return false
    }
  }

  /** 查一个人的昵称（先问后端，拿不到返回空）。 */
  async function 查昵称(配置, 号) {
    const 传 = 传输(配置)
    for (const 动作 of ['get_stranger_info', 'get_friend_info']) {
      const d = await 传.拉任意(动作, { user_id: Number(号) })
      const 名 = d && (d.nickname || d.card || d.remark)
      if (名) return String(名).trim().slice(0, 24)
    }
    return ''
  }

  /** 查群名。 */
  async function 查群名(配置, 群号) {
    const d = await 传输(配置).拉任意('get_group_info', { group_id: Number(群号) })
    return String((d && (d.group_name || d.name)) || '').trim().slice(0, 24)
  }

  /** 把昵称记到房间行上（设置页直接显示，不用每次现查）。 */
  function 记昵称(键, 名) {
    const 净 = String(名 || '').trim().slice(0, 24)
    const 行 = (读().房间 || {})[键]
    if (!净 || !行 || 行.昵称 === 净) return
    改((旧) => ({ ...旧, 房间: { ...旧.房间, [键]: { ...(旧.房间 || {})[键], 昵称: 净 } } }))
  }

  /** 群表里没名称的问后端补上（只补缺的）。 */
  async function 补群名(配置) {
    for (const [号, 行] of Object.entries(配置.群 || {})) {
      if (行.名称) continue
      const 名 = await 查群名(配置, 号)
      if (!名) continue
      改((旧) => ({ ...旧, 群: { ...旧.群, [号]: { ...(旧.群 || {})[号], 名称: 名 } } }))
    }
  }

  /** 启动后补一轮：老房间 / 老白名单的配置里还没有昵称，逐个问后端（只补缺的）。 */
  async function 补昵称(配置) {
    for (const [键, 行] of Object.entries(配置.房间 || {})) {
      if (行.昵称) continue
      const 拆 = 拆聊天键(键)
      if (!拆) continue
      const 名 = 拆.类型 === '群' ? await 查群名(配置, 拆.号码) : await 查昵称(配置, 拆.号码)
      if (名) 记昵称(键, 名)
    }
    for (const [号, 行] of Object.entries(配置.访客 || {})) {
      if (行.昵称) continue
      const 名 = await 查昵称(配置, 号)
      if (!名) continue
      改((旧) => ({ ...旧, 访客: { ...旧.访客, [号]: { ...(旧.访客 || {})[号], 昵称: 名 } } }))
    }
    await 补群名(配置)
  }

  async function 问主人(配置, 号, 谁, 文字, 条) {
    if (!配置.主人) return 记账(`陌生人 ${号} 私聊，但没设主人，没人可问`)
    const 旧 = 待批.get(号)
    const 冷却 = Math.max(1, Number(配置.审批冷却分) || 10) * 60 * 1000
    if (旧 && Date.now() - 旧.时 < 冷却) {
      旧.条 = 条
      旧.文字 = 文字
      return
    }
    let 名 = String(谁 || '').trim()
    if (!名) 名 = await 查昵称(配置, 号)
    待批.set(号, { 时: Date.now(), 昵称: 名, 文字, 条 })
    const 文 = [
      '【有人私聊我】',
      `昵称：${名 || '（取不到昵称）'}`,
      `QQ：${号}`,
      `说：${String(文字 || '').slice(0, 200) || '（没字）'}`,
      `回「同意」接他，回「拒绝」拉黑；要指定人就「同意 ${号}」。`,
    ].join('\n')
    记账(`陌生人 ${号}${名 ? `（${名}）` : ''} 私聊，去问主人了`)
    await 发私聊(配置, 配置.主人, 文)
  }

  /* ---------------- 白名单 / 黑名单 ---------------- */

  /** 放进白名单（并从黑名单移除）。 */
  const 放行 = (号, 昵称) =>
    改((旧) => {
      const 白 = { ...(旧.访客 || {}) }
      const 黑 = { ...(旧.黑名单 || {}) }
      白[号] = { 昵称: String(昵称 || (白[号] && 白[号].昵称) || '').slice(0, 24), 准到: 0 }
      delete 黑[号]
      return { ...旧, 访客: 白, 黑名单: 黑 }
    })

  /** 拉黑（并从白名单移除）。 */
  const 拉黑 = (号) =>
    改((旧) => {
      const 白 = { ...(旧.访客 || {}) }
      delete 白[号]
      return { ...旧, 访客: 白, 黑名单: { ...(旧.黑名单 || {}), [号]: { 拒绝于: Date.now() } } }
    })

  /** 解除拉黑：回到「会来问你」的状态。 */
  const 解除拉黑 = (号) =>
    改((旧) => {
      const 黑 = { ...(旧.黑名单 || {}) }
      delete 黑[号]
      return { ...旧, 黑名单: 黑 }
    })

  /* ---------------- 主人指令 ---------------- */

  async function 执行指令(配置, 指令) {
    const 主人 = 配置.主人
    const 回 = (文本) => 发私聊(配置, 主人, 文本)

    switch (指令.kind) {
      case 'approve': {
        const 目标 = 指令.号码 || 最近待批()
        if (!目标) return 回('现在没有人在等批准。要直接放行就回「同意 QQ号」。')
        const 缓存 = 待批.get(目标)
        const 名 = (缓存 && 缓存.昵称) || (await 查昵称(配置, 目标))
        放行(目标, 名)
        待批.delete(目标)
        记账(`主人同意了 ${目标}${名 ? `（${名}）` : ''}`)
        await 回(`好，我接 ${名 ? `${名}（${目标}）` : 目标} 了。`)
        if (缓存 && 缓存.条) {
          void 处理消息({ ...缓存.条, _补投: true }, '补投').catch(() => {})
        }
        return
      }
      case 'deny': {
        const 目标 = 指令.号码 || 最近待批()
        if (!目标) return 回('现在没有人在等批准。要拉黑就回「拒绝 QQ号」。')
        const 缓存 = 待批.get(目标)
        const 名 = (缓存 && 缓存.昵称) || ''
        拉黑(目标)
        待批.delete(目标)
        记账(`主人拒绝了 ${目标}${名 ? `（${名}）` : ''}（已拉黑）`)
        return 回(`好，不理 ${名 ? `${名}（${目标}）` : 目标} 了。他再来不会问你。`)
      }
      case 'unblock': {
        const 号 = 指令.号码
        if (!号) return 回('要解除谁？回「解除 QQ号」。')
        解除拉黑(号)
        记账(`主人解除了 ${号} 的黑名单`)
        return 回(`好，${号} 放出黑名单了；他再来会重新问你。`)
      }
      case 'allow': {
        const 号 = 指令.号码
        if (!号) return 回('要放行谁？回「放行 QQ号」。')
        const 名 = await 查昵称(配置, 号)
        放行(号, 名)
        待批.delete(号)
        记账(`主人直接放行了 ${号}${名 ? `（${名}）` : ''}`)
        return 回(`好，${名 ? `${名}（${号}）` : 号} 进白名单了，以后直接聊。`)
      }
      case 'joinGroup': {
        改((旧) => ({
          ...旧,
          群: { ...旧.群, [指令.群号]: { ...(旧.群[指令.群号] || {}), enabled: true, mode: 指令.模式, addedAt: Date.now(), muteUntil: 0, members: (旧.群[指令.群号] && 旧.群[指令.群号].members) || { allow: [], deny: [] } } },
        }))
        记账(`主人接群 ${指令.群号}（${指令.模式}）`)
        void 补群名(读()).catch(() => {})
        return 回(`好，接群 ${指令.群号} 了，模式：${指令.模式 === 'all' ? '听所有人' : '只回点名'}。`)
      }
      case 'leaveGroup': {
        改((旧) => {
          const 群 = { ...旧.群 }
          delete 群[指令.群号]
          return { ...旧, 群 }
        })
        记账(`主人退群 ${指令.群号}`)
        return 回(`好，退群 ${指令.群号} 了。`)
      }
      case 'muteGroup': {
        const 到 = Date.now() + 指令.分钟 * 60 * 1000
        改((旧) => ({ ...旧, 群: { ...旧.群, [指令.群号]: { ...(旧.群[指令.群号] || {}), muteUntil: 到 } } }))
        return 回(`好，群 ${指令.群号} 静音 ${指令.分钟} 分钟。`)
      }
      case 'unmuteGroup': {
        改((旧) => ({ ...旧, 群: { ...旧.群, [指令.群号]: { ...(旧.群[指令.群号] || {}), muteUntil: 0 } } }))
        return 回(`好，群 ${指令.群号} 解除静音。`)
      }
      case 'reset': {
        房间.重置(指令.键)
        return 回(`好，${指令.键} 已重置，下条消息会开新房。`)
      }
      case 'list': {
        const 表 = 房间.列表()
        if (!表.length) return 回('还没有房间。')
        const 文 = 表.map((x) => `${x.键} ${x.活着 ? '（活）' : '（睡）'}`).join('\n')
        return 回('房间：\n' + 文)
      }
      case 'status': {
        const c = 读()
        return 回(`总开关 ${c.总开关 ? '开' : '关'}｜试运行 ${c.试运行 ? '开' : '关'}｜房间 ${Object.keys(c.房间).length}｜群 ${Object.keys(c.群).length}｜访客 ${Object.keys(c.访客).length}`)
      }
      default:
        return
    }
  }

  const 最近待批 = () => {
    const 限 = 30 * 60 * 1000
    return [...待批.entries()]
      .filter(([, v]) => Date.now() - (v && v.时 ? v.时 : 0) < 限)
      .sort((a, b) => (b[1].时 || 0) - (a[1].时 || 0))
      .map(([k]) => k)[0] || ''
  }

  /* ---------------- 一条消息的完整判定 ---------------- */

  /**
   * 一条消息进来。
   * @param 条     OneBot 消息（WS 事件 / 历史条目）
   * @param 来源   'ws' | '轮询' | '补投'（只用来记日志）
   * @param 指定   轮询时由调用方给出 { 类型, 号码 }：历史条目不一定带 message_type，
   *               反推会把群消息当成「发送者的私聊」（于是每条群里的话都跑去问主人）。
   */
  async function 处理消息(条, 来源, 指定) {
    if (已停止) return
    const 配置 = 读()
    if (!配置.总开关) return
    if (!条 || 条.post_type && 条.post_type !== 'message') return

    const 类型 = 指定 && 指定.类型 ? 指定.类型 : (条.message_type === 'group' ? '群' : '私聊')
    const 号码 = String(指定 && 指定.号码 ? 指定.号码 : (类型 === '群' ? 条.group_id : 条.user_id))
    const 发送者 = String(条.user_id || '')
    const 键 = 聊天键(类型, 号码)
    if (!键) return

    const id = String(条.message_id)
    if (已转消息.has(id) && !条._补投) return

    // WS 路径不会经过轮询，登录号要在这儿补一次（否则群里 @ 判定永远为假）
    if (!自己号) {
      try {
        自己号 = (await 传输(配置).登录号()) || ''
      } catch {
        自己号 = ''
      }
    }
    if (自己号 && 发送者 === 自己号) {
      已转消息.add(id)
      return
    }

    const 解析 = await 解析消息(条, {
      拉任意: (action, 体) => 传输(配置).拉任意(action, 体),
      收图: 配置.收图,
      转写: (段) => 转写语音(段, { 拉任意: (action, 体) => 传输(配置).拉任意(action, 体), 家目录, 配置 }),
    })

    // 主人私聊里的管理指令：吃掉，不转给模型
    if (类型 === '私聊' && 发送者 === String(配置.主人) && 配置.主人) {
      const 指令 = 主人指令({ 文字: 解析.文字, 发送者, 类型, 配置 })
      if (指令) {
        已转消息.add(id)
        await 执行指令(配置, 指令)
        return
      }
    }

    const 点名 = 点名判定(条.message, {
      自己号,
      己方消息,
      听名字: 配置.群里听名字,
      名字: [配置.主人称呼],
    })

    const 判定 = 判定入站({ 类型, 号码, 发送者, 配置, 点名 })
    if (判定.action === 'drop') {
      // 丢掉也要记账：轮询的水位只在「进过已转消息」时才前进，
      // 否则群里一条没点名的闲聊会被每 2 秒重新解析一遍（转发展开、语音转写跟着重跑）。
      已转消息.add(id)
      return
    }
    if (判定.action === 'askOwner') {
      await 问主人(配置, 号码, 昵称(条), 解析.文字 || (解析.图们.length ? '（发来图片）' : ''), 条)
      已转消息.add(id)
      return
    }

    await 转入(配置, { 键, 类型, 号码, 发送者, 文字: 解析.文字, 图们: 解析.图们, 条 })
  }

  /* ---------------- WebSocket 事件源 ---------------- */

  const 排重连 = () => {
    if (已停止 || 重连定时 || 冲突) return
    重连次数 += 1
    const 等待 = Math.min(60_000, 1000 * 2 ** Math.min(重连次数, 6))
    重连定时 = setTimeout(() => {
      重连定时 = null
      连事件()
    }, 等待)
    try {
      重连定时.unref?.()
    } catch {
      /* 无 unref */
    }
  }

  function 连事件() {
    if (已停止 || 冲突) return
    const 配置 = 读()
    const 基 = String(配置.事件地址 || '').trim()
    if (!基) return
    if (typeof WebSocket !== 'function') {
      记账('宿主没有 WebSocket —— 陌生私聊发现不了，已知房间仍靠轮询')
      return
    }
    let u
    try {
      u = new URL(基)
      if (配置.事件令牌) u.searchParams.set('access_token', 配置.事件令牌)
    } catch {
      记账('事件地址不合法：' + 基)
      return 排重连()
    }
    try {
      记账('正在连事件源 ' + u.origin + ' …')
      const ws = new WebSocket(u.toString())
      当前ws = ws
      ws.onopen = () => {
        重连次数 = 0
        记账('事件源已连上 ' + u.host)
      }
      ws.onmessage = (m) => {
        try {
          const 件 = JSON.parse(typeof m.data === 'string' ? m.data : String(m.data))
          if (件 && 件.post_type === 'message') void 处理消息(件, 'ws').catch((e) => 记账('处理事件出错：' + String((e && e.message) || e)))
        } catch {
          /* 非 JSON 心跳 */
        }
      }
      ws.onclose = (e) => {
        if (当前ws === ws) 当前ws = null
        if (重连次数 < 3) {
          const 码 = e && e.code !== undefined ? e.code : '?'
          const 因 = e && e.reason ? String(e.reason).slice(0, 80) : ''
          记账(`事件源断开（code ${码}${因 ? '：' + 因 : ''}），稍后重连`)
        }
        排重连()
      }
      ws.onerror = (e) => {
        if (重连次数 < 3) {
          记账('事件源出错：' + String((e && (e.message || e.type)) || '未知错误'))
        }
        try {
          ws.close()
        } catch {
          /* 已关 */
        }
      }
    } catch (error) {
      记账('事件源连不上：' + String((error && error.message) || error))
      排重连()
    }
  }

  /* ---------------- 轮询（已知房间补漏） ---------------- */

  async function 轮询() {
    if (已停止 || 冲突 || 轮询中) return
    const 配置 = 读()
    if (!配置.总开关) return

    轮询中 = true
    当前控制 = new AbortController()
    const 信号 = 当前控制.signal
    try {
      自己号 = 自己号 || (await 传输(配置).登录号({ signal: 信号 }))
      const 目标 = []
      for (const 群号 of Object.keys(配置.群 || {})) {
        if (配置.群[群号].enabled !== false) 目标.push({ 类型: '群', 号码: 群号 })
      }
      for (const 键 of Object.keys(配置.房间 || {})) {
        const 拆 = 拆聊天键(键)
        if (拆 && 拆.类型 === '私聊') 目标.push(拆)
      }
      if (!目标.length) return

      const 传 = 传输(配置)
      for (const t of 目标) {
        if (信号.aborted) return
        const 键 = 聊天键(t.类型, t.号码)
        const 新见 = !上次时间.has(键)
        let 上次 = 新见 ? Math.floor(Date.now() / 1000) : 上次时间.get(键)
        if (新见) 上次时间.set(键, 上次)

        const 列表 = await 传.拉历史(t.类型, t.号码, t.类型 === '群' ? 30 : 10, { signal: 信号 })
        if (信号.aborted) return
        for (const 条 of 列表.slice().sort((a, b) => (a.time || 0) - (b.time || 0))) {
          if (信号.aborted) return
          if (!条) continue
          const 时 = 条.time || 0
          if (时 < 上次) continue
          if (已转消息.has(String(条.message_id))) {
            上次 = Math.max(上次, 时)
            continue
          }
          const 太旧 = 时 > 0 && Math.floor(Date.now() / 1000) - 时 > (Number(配置.补投窗口分) || 10) * 60
          if (太旧) {
            已转消息.add(String(条.message_id))
            上次 = Math.max(上次, 时)
            continue
          }
          await 处理消息(条, '轮询', { 类型: t.类型, 号码: t.号码 })
          if (已转消息.has(String(条.message_id))) 上次 = Math.max(上次, 时)
        }
        上次时间.set(键, 上次)
      }
      存水位()
    } catch (error) {
      if (!信号.aborted) 记账('轮询出错：' + String((error && error.message) || error))
    } finally {
      轮询中 = false
      当前控制 = null
    }
  }

  /* ---------------- 路由 ---------------- */

  const 回 = (res, 数据) => {
    try {
      res.setHeader?.('content-type', 'application/json; charset=utf-8')
      res.end?.(JSON.stringify(数据))
    } catch {
      /* 连接已断 */
    }
  }

  const 读体 = async (req) => {
    let body = ''
    try {
      for await (const chunk of req) body += chunk
    } catch {
      /* 读失败当空体 */
    }
    try {
      return JSON.parse(body || '{}')
    } catch {
      return {}
    }
  }

  /** 回给浏览器之前把令牌遮掉：设置页只用来显示「设过了没」，不需要明文。 */
  const 遮令牌 = (配置) => ({
    ...配置,
    令牌: 配置.令牌 ? 令牌遮罩 : '',
    事件令牌: 配置.事件令牌 ? 令牌遮罩 : '',
  })

  async function 概况() {
    const 配置 = 读()
    const 传 = 传输(配置)
    const 登录 = await 传.登录号()
    return {
      ok: true,
      版本: 读包版本(),
      协议: 1,
      冲突,
      原版状态,
      配置: 遮令牌(配置),
      语音: {
        引擎: 配置.语音引擎,
        引擎们: Object.fromEntries(Object.entries(引擎们).map(([id, e]) => [id, {
          id, label: e.label, defaultVoice: e.defaultVoice,
          emotions: e.emotions, supportsTags: e.supportsTags,
          needsKey: e.needsKey, voices: e.voices,
        }])),
      },
      房间: 房间.列表(),
      待批: [...待批.entries()].map(([号, v]) => ({ 号, 昵称: v.昵称, 文字: String(v.文字 || '').slice(0, 120), 时: v.时 })),
      日志,
      NapCat: 登录 ? { ok: true, 号: 登录 } : { ok: false, 错: '连不上或没登录' },
      自己号,
    }
  }

  /**
   * 管理接口只认「本人」：插件挂在 webServer 上的地址不会自动带 DSH 的登录校验，
   * 随便一个网页都能 POST 到 /save 改配置、或者 /test-send 替你发消息。
   * 一律「失败就放行」：拿不到 connection 服务、老宿主没这个接口、检查本身抛错 —— 全当没事，
   * 免得宿主换个版本把设置页锁死；只有宿主**明确**说 401 / 403 才拒。
   */
  const 只认本人 = async (req, res) => {
    try {
      const 连接 = 服务('connection')
      let 拒 = 连接 && typeof 连接.requestRejection === 'function' ? 连接.requestRejection(req) : undefined
      if (拒 && typeof 拒.then === 'function') 拒 = await 拒
      if (拒 === 401 || 拒 === 403) {
        记账(`管理接口拒了一次外来请求（${拒}）：${String((req && req.url) || '')}`)
        回(res, { ok: false, 说: 拒 === 401 ? '需要先登录 DSH' : '这个来源不允许改设置' })
        return false
      }
    } catch {
      /* 鉴权这条路自己坏了 → 放行 */
    }
    return true
  }

  const 路线 = (路径, handler) =>
    ctx.effect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: 路径,
        handler: async (req, res) => {
          try {
            if (!(await 只认本人(req, res))) return
            await handler(req, res)
          } catch (error) {
            回(res, { ok: false, 说: String((error && error.message) || error) })
          }
        },
      }),
    )

  路线(`${路由前缀}/state`, async (_req, res) => {
    try {
      回(res, await 概况())
    } catch (error) {
      回(res, { ok: false, 说: '状态读不出来：' + String((error && error.message) || error), 配置: 遮令牌(读()), 日志 })
    }
  })

  路线(`${路由前缀}/save`, async (req, res) => {
    const 来 = await 读体(req)
    const 旧 = 读()
    const 新 = { ...旧 }
    if (来 && typeof 来 === 'object') {
      // 只收「设置项」：房间 / 访客 / 黑名单由宿主维护，前端拿的是旧快照，写回会把它们冲掉
      for (const k of 可保存键) if (k in 来) 新[k] = 来[k]
      // 前端看到的是遮罩，原样回传 = 这个令牌没动
      if (来.令牌 === 令牌遮罩) 新.令牌 = 旧.令牌
      if (来.事件令牌 === 令牌遮罩) 新.事件令牌 = 旧.事件令牌
    }
    const { 成功 } = 改(() => 新)
    if (!成功) return 回(res, { ok: false, 说: '写不进配置文件' })
    记账('设置已保存')
    // 立刻套用到活着的房间（访客私聊 + 群）：不用等对方再发一条
    const 新读 = 读()
    // 新加的群还没名字：后台问一次（不挡保存）
    void 补群名(新读).catch(() => {})
    // 工作区可能换了：把房间会话补登记过去
    void 补工作区(新读).catch(() => {})
    for (const [键, agent] of [...键agent]) {
      const 拆 = 拆聊天键(键)
      const 是主人私聊 = 拆 && 拆.类型 === '私聊' && 拆.号码 === String(新读.主人)
      if (!拆 || 是主人私聊) {
        释放工具限制(agent.id || (agent.session && agent.session.id))
        键agent.delete(键)
        continue
      }
      限制访客工具(agent, 房间策略(新读, 键))
    }
    回(res, await 概况())
  })

  路线(`${路由前缀}/test-send`, async (req, res) => {
    const 配置 = 读()
    if (!配置.主人) return 回(res, { ok: false, 说: '先设置主人 QQ 号' })
    // 手动测试是**真发**：总开关和试运行都绕过（否则测试永远测不出通不通）
    const 结果 = await 私聊裸发(配置, 配置.主人, '（这是一条测试消息：DSH → QQ 通了）')
    回(res, { ok: 结果.length > 0 && 结果.every((r) => r.ok), 说: 结果.length ? '已发' : '没发（看日志）', 日志 })
  })

  路线(`${路由前缀}/test-voice`, async (req, res) => {
    const 配置 = 读()
    if (!配置.主人) return 回(res, { ok: false, 说: '先设置主人 QQ 号' })
    const 话 = '（语音测试：DSH 到 QQ 的语音通了）'
    const 结果 = await 私聊裸发(配置, 配置.主人, 话, { 语音: true, 语音文字: 话 })
    const 语音 = 结果.some((r) => r.ok && r.语音)
    const 好 = 结果.length > 0 && 结果.every((r) => r.ok)
    回(res, { ok: 好, 说: 语音 ? '已发语音（看 QQ）' : 好 ? '只发出了文字（合成失败，看日志）' : '没发出去（看日志）', 日志 })
  })

  路线(`${路由前缀}/approve`, async (req, res) => {
    const 来 = await 读体(req)
    const 号 = String((来 && 来.号) || '')
    if (!/^\d{4,12}$/u.test(号)) return 回(res, { ok: false, 说: 'QQ 号不合法' })
    if (来.允许 === false) {
      拉黑(号)
      待批.delete(号)
      回(res, { ok: true, 说: '已拒绝并拉黑 ' + 号 })
      return
    }
    const 缓存 = 待批.get(号)
    let 名 = (缓存 && 缓存.昵称) || ''
    if (!名) 名 = await 查昵称(读(), 号)
    放行(号, 名)
    待批.delete(号)
    if (缓存 && 缓存.条) void 处理消息({ ...缓存.条, _补投: true }, '补投').catch(() => {})
    回(res, { ok: true, 说: 名 ? `已同意 ${名}（${号}）` : '已同意 ' + 号 })
  })

  路线(`${路由前缀}/unblock`, async (req, res) => {
    const 来 = await 读体(req)
    const 号 = String((来 && 来.号) || '')
    if (!/^\d{4,12}$/u.test(号)) return 回(res, { ok: false, 说: 'QQ 号不合法' })
    解除拉黑(号)
    回(res, { ok: true, 说: '已解除 ' + 号 + ' 的黑名单' })
  })

  路线(`${路由前缀}/room`, async (req, res) => {
    const 来 = await 读体(req)
    const 键 = String((来 && 来.键) || '')
    if (!拆聊天键(键)) return 回(res, { ok: false, 说: '房间键不合法' })
    if (来.操作 === 'reset') 房间.重置(键)
    else if (来.操作 === 'forget') 房间.遗忘(键)
    else return 回(res, { ok: false, 说: '未知操作' })
    键agent.delete(键)
    回(res, { ok: true, 房间: 房间.列表() })
  })

  路线(`${路由前缀}/logs`, async (_req, res) => {
    try {
      mkdirSync(日志目录, { recursive: true })
      const [命令, 参数] =
        process.platform === 'win32'
          ? ['explorer.exe', [日志目录]]
          : process.platform === 'darwin'
            ? ['open', [日志目录]]
            : ['xdg-open', [日志目录]]
      const 子 = spawn(命令, 参数, { detached: true, stdio: 'ignore' })
      子.on('error', () => {})
      子.unref()
      回(res, { ok: true, 目录: 日志目录 })
    } catch (error) {
      回(res, { ok: false, 说: String((error && error.message) || error) })
    }
  })

  /* ---------------- 挂监听 ---------------- */

  if (!冲突) {
    ctx.effect(() => {
      const 摘 = ctx.on('session/event', (session, event) => {
        try {
          收到事件(session, event)
        } catch (error) {
          记账('转发时出错：' + String((error && error.message) || error))
        }
      })
      return () => {
        try {
          摘?.()
        } catch {
          /* 已摘 */
        }
      }
    }, 'qq-rooms: 盯房间说话')

    ctx.effect(() => {
      连事件()
      return () => {
        已停止 = true
        clearTimeout(重连定时)
        重连定时 = null
        try {
          当前ws?.close()
        } catch {
          /* 已关 */
        }
        当前ws = null
      }
    }, 'qq-rooms: 事件源')

    ctx.effect(() => {
      if (typeof ctx.interval !== 'function') {
        记账('拿不到 timer（ctx.interval 不在）—— 已知房间的补漏轮询跑不起来')
        return () => {}
      }
      const 停 = ctx.interval(() => {
        void 轮询()
      }, Math.max(500, 读().轮询间隔毫秒))
      return () => {
        try {
          当前控制?.abort()
        } catch {
          /* 已结束 */
        }
        try {
          停?.()
        } catch {
          /* 已停 */
        }
      }
    }, 'qq-rooms: 补漏轮询')

    // 老房间的配置里没有昵称 / 没归到工作区：启动 2 秒后各补一轮（失败就算了）
    ctx.effect(() => {
      const 定 = setTimeout(() => {
        void 补昵称(读()).catch(() => {})
        void 补工作区(读()).catch(() => {})
      }, 2000)
      定.unref?.()
      return () => clearTimeout(定)
    }, 'qq-rooms: 补昵称')
  }

  记账(
    `已装好 v${读包版本()}｜总开关 ${读().总开关 ? '开' : '关'}｜试运行 ${读().试运行 ? '开（只记账）' : '关'}`
    + `｜主人 ${读().主人 || '未设置'}｜房间 ${Object.keys(读().房间).length}｜群 ${Object.keys(读().群).length}`
    + `｜原版 ${原版状态}${冲突 ? '（冲突，已停用收发）' : ''}`,
  )

  return { 记账, 概况, 处理消息, 执行指令, 房间, 日志 }
}

/** 版本号：从自己的 package.json 读（读不到就 '?'）。 */
function 读包版本() {
  try {
    const p = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return String(p.version || '?')
  } catch {
    return '?'
  }
}
