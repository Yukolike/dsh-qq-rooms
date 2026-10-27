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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { 读配置, 改配置, 归一化 } from './config.js'
import { 判定入站, 主人指令, 点名判定, 聊天键, 拆聊天键 } from './policy.js'
import { 房间管理器, 房间标题, 房间工作区 } from './rooms.js'
import {
  OneBot, 解析消息, 抠QQ标记, 抠正文图, 按段拆, 提取正文, 提取图块,
  取图字节, 看图类, 存图, 转写语音,
} from './transport.js'

export const name = 'qq-rooms'
export const inject = ['agents', 'sessions', 'webServer', 'timer', 'workspaceRegistry', 'attachments']

const 路由前缀 = '/dsh-qq-rooms'
const 日志上限 = 80
const 唤醒窗口毫秒 = 10 * 60 * 1000

export function apply(ctx) {
  const 家目录 = process.env.DSH_HOME || join(homedir(), '.dsh')
  const 收图目录 = join(家目录, 'qq-rooms-inbox')
  const 状态文件 = join(家目录, 'qq-rooms-state.json')

  /* ---------------- 状态 ---------------- */

  const 日志 = []
  const 上一轮 = new Map() // 键 -> { 轮号, 文本, 图们 }
  const 已发轮 = new Set() // 键:轮号
  const 已转消息 = new Set()
  const 上次时间 = new Map()
  const 唤醒 = new Map() // 键 -> 时间戳
  const 待批 = new Map() // 号 -> { 时, 昵称, 文字, 条 }
  const 己方消息 = new Set()
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
    日志.push({
      时间: `${补(d.getMonth() + 1)}-${补(d.getDate())} ${补(d.getHours())}:${补(d.getMinutes())}:${补(d.getSeconds())}`,
      文本: String(文本),
    })
    if (日志.length > 日志上限) 日志.shift()
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

  const 房间 = new 房间管理器({
    agents: 服务('agents'),
    读,
    改,
    家目录,
    日志: 记账,
    工作区: 服务('workspaceRegistry'),
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
    } catch {
      /* 第一次跑 */
    }
  }

  const 存水位 = () => {
    try {
      mkdirSync(家目录, { recursive: true })
      writeFileSync(
        状态文件,
        JSON.stringify({ 上次: Object.fromEntries(上次时间), 已转: [...已转消息].slice(-300) }, null, 2),
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

  /** 发到一间房对应的聊天。返回结果数组（试运行/关闸 → 空数组）。 */
  async function 发送(配置, 键, 段们, 图数据) {
    if (!配置.总开关) {
      记账('总开关关着，这条没发')
      return []
    }
    if (配置.试运行) {
      记账(`试运行：本来要发到 ${键} →「${String(段们[0] || '').slice(0, 40)}」${图数据.length ? `（还有 ${图数据.length} 张图）` : ''}`)
      return []
    }
    const 拆 = 拆聊天键(键)
    if (!拆) return []
    const 传 = 传输(配置)
    const 结果 = []
    if (段们.length) 结果.push(...(await 传.发文字(拆.类型, 拆.号码, 段们, { 间隔毫秒: 配置.拆段间隔毫秒 })))
    if (图数据.length) 结果.push(...(await 传.发图片(拆.类型, 拆.号码, 图数据, { 间隔毫秒: 配置.拆段间隔毫秒 })))
    const 好 = 结果.length > 0 && 结果.every((r) => r.ok)
    记账(`${好 ? '✅ 已发到' : '⚠ 发送有问题'} ${键}：「${String(段们[0] || '').slice(0, 50)}」${图数据.length ? `（含 ${图数据.length} 张图）` : ''}`)
    for (const r of 结果) if (!r.ok) 记账('   ' + r.action + ' 失败：' + JSON.stringify(r.数据).slice(0, 140))
    return 结果
  }

  /** 私聊直发（回执、审批、测试用）；同样受试运行约束。 */
  async function 发私聊(配置, 号码, 文字) {
    const 段们 = 配置.长回复拆段 ? 按段拆(文字) : [String(文字 || '').trim()].filter(Boolean)
    return 发送(配置, 聊天键('私聊', 号码), 段们, [])
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

    const 抠过 = 配置.发图 ? 抠正文图(标记.文字) : { 净文字: 标记.文字, 图: [] }
    const 段们 = 配置.长回复拆段
      ? 按段拆(抠过.净文字)
      : [String(抠过.净文字 || '').trim()].filter(Boolean)
    const 图数据 = 配置.发图 ? 出站图片(配置, 图块们, 抠过.图) : []
    if (!段们.length && !图数据.length) return 记账('这一轮既没文字也没图，不发')
    await 发送(配置, 键, 段们, 图数据)
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
      }
      记({ 轮号: -1, 文本: '', 图们: [] })
    }
  }

  /* ---------------- 入站 ---------------- */

  const 昵称 = (条) => String((条.sender && (条.sender.card || 条.sender.nickname)) || '')

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

    const 收下 = await 收图(配置, 图们, 条.message_id)
    const 署名 = 类型 === '群'
      ? (昵称(条) || '某人') + '（' + 发送者 + '）：'
      : ''
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

    // 人格注入：新房必注入；老房只在人格文件内容变了时重新注入一次
    const 人设文本 = 读人格(配置)
    const 人设哈希 = 人设文本 ? createHash('sha1').update(人设文本).digest('hex').slice(0, 12) : ''
    const 房记录 = (配置.房间 || {})[键] || {}
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
    let content = [{ type: 'text', text: 人生块 + 正文 + 块提示 }]
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
        content = [{ type: 'text', text: 正文 + 块提示 }]
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

  async function 问主人(配置, 号, 谁, 文字, 条) {
    if (!配置.主人) return 记账(`陌生人 ${号} 私聊，但没设主人，没人可问`)
    const 旧 = 待批.get(号)
    const 冷却 = Math.max(1, Number(配置.审批冷却分) || 10) * 60 * 1000
    if (旧 && Date.now() - 旧.时 < 冷却) {
      旧.条 = 条
      旧.文字 = 文字
      return
    }
    待批.set(号, { 时: Date.now(), 昵称: 谁, 文字, 条 })
    const 文 = [
      `【有人私聊我】${谁 || 'QQ ' + 号}（${号}）说：${String(文字 || '').slice(0, 200) || '（没字）'}`,
      `要我接吗？回「同意」或「同意 ${号}」，不想接就回「拒绝」。`,
    ].join('\n')
    记账(`陌生人 ${号} 私聊，去问主人了`)
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
        放行(目标, (缓存 && 缓存.昵称) || '')
        待批.delete(目标)
        记账(`主人同意了 ${目标}`)
        await 回(`好，我接 ${目标} 了。`)
        if (缓存 && 缓存.条) {
          void 处理消息({ ...缓存.条, _补投: true }, '补投').catch(() => {})
        }
        return
      }
      case 'deny': {
        const 目标 = 指令.号码 || 最近待批()
        if (!目标) return 回('现在没有人在等批准。要拉黑就回「拒绝 QQ号」。')
        拉黑(目标)
        待批.delete(目标)
        记账(`主人拒绝了 ${目标}（已拉黑）`)
        return 回(`好，不理 ${目标} 了。他再来不会问你。`)
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
        放行(号, '')
        待批.delete(号)
        记账(`主人直接放行了 ${号}`)
        return 回(`好，${号} 进白名单了，以后直接聊。`)
      }
      case 'joinGroup': {
        改((旧) => ({
          ...旧,
          群: { ...旧.群, [指令.群号]: { ...(旧.群[指令.群号] || {}), enabled: true, mode: 指令.模式, addedAt: Date.now(), muteUntil: 0, members: (旧.群[指令.群号] && 旧.群[指令.群号].members) || { allow: [], deny: [] } } },
        }))
        记账(`主人接群 ${指令.群号}（${指令.模式}）`)
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

  async function 处理消息(条, 来源) {
    if (已停止) return
    const 配置 = 读()
    if (!配置.总开关) return
    if (!条 || 条.post_type && 条.post_type !== 'message') return

    const 类型 = 条.message_type === 'group' ? '群' : '私聊'
    const 号码 = String(类型 === '群' ? 条.group_id : 条.user_id)
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
    if (判定.action === 'drop') return
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
          await 处理消息(条, '轮询')
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
      配置,
      房间: 房间.列表(),
      待批: [...待批.entries()].map(([号, v]) => ({ 号, 昵称: v.昵称, 文字: String(v.文字 || '').slice(0, 120), 时: v.时 })),
      日志,
      NapCat: 登录 ? { ok: true, 号: 登录 } : { ok: false, 错: '连不上或没登录' },
      自己号,
    }
  }

  const 路线 = (路径, handler) =>
    ctx.effect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: 路径,
        handler: async (req, res) => {
          try {
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
      回(res, { ok: false, 说: '状态读不出来：' + String((error && error.message) || error), 配置: 读(), 日志 })
    }
  })

  路线(`${路由前缀}/save`, async (req, res) => {
    const 来 = await 读体(req)
    const 旧 = 读()
    const 新 = 归一化({ ...旧, ...(来 && typeof 来 === 'object' ? 来 : {}) })
    const { 成功 } = 改(() => 新)
    if (!成功) return 回(res, { ok: false, 说: '写不进配置文件' })
    记账('设置已保存')
    回(res, await 概况())
  })

  路线(`${路由前缀}/test-send`, async (req, res) => {
    const 来 = await 读体(req)
    const 配置 = 读()
    if (!配置.主人) return 回(res, { ok: false, 说: '先设置主人 QQ 号' })
    const 结果 = await 发私聊(配置, 配置.主人, '（这是一条测试消息：DSH → QQ 通了）')
    回(res, { ok: 结果.length > 0 && 结果.every((r) => r.ok), 说: 结果.length ? '已发' : '没发（看日志：试运行/总开关）', 日志 })
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
    放行(号, (缓存 && 缓存.昵称) || '')
    待批.delete(号)
    if (缓存 && 缓存.条) void 处理消息({ ...缓存.条, _补投: true }, '补投').catch(() => {})
    回(res, { ok: true, 说: '已同意 ' + 号 })
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
    回(res, { ok: true, 房间: 房间.列表() })
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
