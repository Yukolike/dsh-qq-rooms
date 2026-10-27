// dsh-qq-rooms · 房间（一个聊天 = 一间 DSH 会话）
//
// 职责只有三件：
//   1. 聊天键 → 房间的持久映射（写进配置的 房间 表）
//   2. 拿到一个活着的 agent：内存/宿主里已有 → 直接用；磁盘上有 → resume；都没有 → create
//   3. 同一聊天并发首次消息只建一间房（单飞）
//
// 不认识 OneBot、不认识消息内容、不认识指令 —— 那些在 policy / transport。

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { 聊天键, 拆聊天键 } from './policy.js'

/** 'provider/model' → AgentOptions 对。空串 → 空对象。 */
export function 模型对(文本) {
  const s = String(文本 || '').trim()
  if (!s) return {}
  const i = s.indexOf('/')
  if (i <= 0 || i === s.length - 1) return {}
  return { provider: s.slice(0, i), model: s.slice(i + 1) }
}

/** 房间的默认 cwd：配置优先，否则 ~/.dsh/qq-rooms。 */
export function 房间工作区(配置, 家目录) {
  const 设 = String(配置.房间工作区 || '').trim()
  return 设 || join(家目录, 'qq-rooms')
}

/** 会话标题：列表里一眼能认出是哪个聊天。 */
export function 房间标题(键, 昵称) {
  const 拆 = 拆聊天键(键)
  if (!拆) return 'QQ 房间'
  if (拆.类型 === '群') return 'QQ 群 · ' + 拆.号码
  const 谁 = String(昵称 || '').trim().slice(0, 20)
  return 谁 ? `QQ 私聊 · ${谁}` : 'QQ 私聊 · ' + 拆.号码
}

/** 宿主里找 agent：带不带 session- 前缀都试。 */
function 找agent(agents, id) {
  const 原 = String(id || '').trim()
  if (!原) return undefined
  const 候选 = [原]
  if (原.startsWith('session-')) 候选.push(原.slice('session-'.length))
  else 候选.push('session-' + 原)
  for (const 一个 of 候选) {
    try {
      const a = agents.get(一个)
      if (a !== undefined && a !== null) return a
    } catch {
      /* 宿主不认识这个 id */
    }
  }
  return undefined
}

export class 房间管理器 {
  #agents
  #读
  #改
  #日志
  #家目录
  #句柄 = new Map()
  #进行中 = new Map()

  /**
   * @param {object} 依赖
   * @param {object} 依赖.agents      ctx.agents（需要 get / create / resume）
   * @param {() => object} 依赖.读    读配置
   * @param {(变更: any) => {配置: object, 成功: boolean}} 依赖.改  读改写
   * @param {string} 依赖.家目录
   * @param {(文本: string) => void} [依赖.日志]
   * @param {object} [依赖.工作区]      ctx.workspaceRegistry（可选，用于归档）
   */
  constructor({ agents, 读, 改, 家目录, 日志, 工作区 }) {
    this.#agents = agents
    this.#读 = 读
    this.#改 = 改
    this.#家目录 = 家目录
    this.#日志 = typeof 日志 === 'function' ? 日志 : () => {}
    this.工作区 = 工作区
  }

  /** 这句聊天现在有没有一间房（不建）。 */
  有(键) {
    const 行 = (this.#读().房间 || {})[键]
    return Boolean(行 && 行.sessionId)
  }

  /** 房间列表：给设置页/「房间」指令用。 */
  列表() {
    const 配置 = this.#读()
    return Object.entries(配置.房间 || {}).map(([键, 行]) => {
      const 拆 = 拆聊天键(键)
      const 活 = 找agent(this.#agents, 行.sessionId)
      return {
        键,
        类型: 拆 ? 拆.类型 : '?',
        号码: 拆 ? 拆.号码 : '?',
        sessionId: 行.sessionId,
        活着: Boolean(活),
        createdAt: Number(行.createdAt || 0),
        lastAt: Number(行.lastAt || 0),
      }
    })
  }

  /**
   * 拿一间可用的房：复用 → resume → 新建。
   * 同一键并发调用共享同一个 promise（单飞）。
   * @returns {Promise<{键: string, sessionId: string, agent: object, created: boolean}>}
   */
  async 确保(键, 选项 = {}) {
    if (!拆聊天键(键)) throw new Error('非法的房间键：' + 键)
    const 在跑 = this.#进行中.get(键)
    if (在跑) return 在跑
    const 任务 = this.#确保(键, 选项).finally(() => this.#进行中.delete(键))
    this.#进行中.set(键, 任务)
    return 任务
  }

  async #确保(键, { 昵称 = '', 模型 = '' } = {}) {
    const 配置 = this.#读()
    const 行 = (配置.房间 || {})[键]

    if (行 && 行.sessionId) {
      const 复用 = await this.#复用(键, 行.sessionId, 模型 || 配置.模型)
      if (复用) {
        this.#触达(键)
        return 复用
      }
      this.#日志(`房间 ${键} 的会话 ${行.sessionId} 续不上，重建`)
    }

    return await this.#新建(键, { 昵称, 模型: 模型 || 配置.模型 })
  }

  /** 已有 sessionId：活着的直接用，否则 resume。失败返回 null。 */
  async #复用(键, sessionId, 模型) {
    const 活 = 找agent(this.#agents, sessionId)
    if (活) {
      this.#句柄.set(键, 活)
      return { 键, sessionId, agent: 活, created: false }
    }

    const 缓存 = this.#句柄.get(键)
    if (缓存 && 找agent(this.#agents, 缓存.session?.id) === 缓存) {
      return { 键, sessionId, agent: 缓存, created: false }
    }

    try {
      const 句柄 = await this.#agents.resume({
        resumeSessionId: sessionId,
        agentOptions: 模型对(模型),
      })
      const agent = 句柄 && 句柄.agent ? 句柄.agent : 句柄
      if (agent) {
        this.#句柄.set(键, agent)
        this.#日志(`房间 ${键} 续上了 ${sessionId}`)
        return { 键, sessionId, agent, created: false }
      }
    } catch (error) {
      this.#日志(`续房间失败 ${键}：${String((error && error.message) || error)}`)
    }
    return null
  }

  async #新建(键, { 昵称, 模型 }) {
    const 配置 = this.#读()
    const sessionId = 'session-' + randomUUID()
    const 参 = { sessionId, agentOptions: 模型对(模型) }
    const cwd = 房间工作区(配置, this.#家目录)
    if (cwd) 参.meta = { cwd }

    const 句柄 = await this.#agents.create(参)
    const agent = 句柄 && 句柄.agent ? 句柄.agent : 句柄
    if (!agent) throw new Error('宿主没有返回 agent')

    this.#句柄.set(键, agent)
    const 现在 = Date.now()
    const { 成功 } = this.#改((旧) => ({
      ...旧,
      房间: {
        ...(旧.房间 || {}),
        [键]: { sessionId, createdAt: 现在, lastAt: 现在 },
      },
    }))
    if (!成功) this.#日志(`房间 ${键} 建好了，但写配置失败（重启后会重建）`)

    try {
      // ⚠ 标题规则（dsh-session-format 校验）：
      //   source.kind === "user" ⟺ messageSeqs 为空。
      //   用 fallback + 空数组会被判成损坏日志，下次 resume 直接失败并重建房间。
      await agent.session.append('session/title', {
        title: 房间标题(键, 昵称),
        messageSeqs: [],
        source: { kind: 'user' },
      })
    } catch (error) {
      this.#日志(`房间 ${键} 起名失败（不影响用）：${String((error && error.message) || error)}`)
    }

    this.#日志(`房间 ${键} 开好了 ${sessionId}（cwd ${cwd}）`)
    return { 键, sessionId, agent, created: true }
  }

  #触达(键) {
    this.#改((旧) => {
      const 行 = (旧.房间 || {})[键]
      if (!行) return 旧
      return { ...旧, 房间: { ...旧.房间, [键]: { ...行, lastAt: Date.now() } } }
    })
  }

  /** 只解除映射，不动宿主里的会话（下次消息会重新开工）。 */
  遗忘(键) {
    this.#句柄.delete(键)
    return this.#改((旧) => {
      const 房间 = { ...(旧.房间 || {}) }
      delete 房间[键]
      return { ...旧, 房间 }
    })
  }

  /** 重置：归档宿主里的会话 + 解除映射。下次消息开新房。 */
  重置(键) {
    const 行 = (this.#读().房间 || {})[键]
    const sessionId = 行 && 行.sessionId
    if (sessionId) {
      try {
        if (this.工作区 && typeof this.工作区.archiveSession === 'function') {
          this.工作区.archiveSession(sessionId)
        }
      } catch (error) {
        this.#日志(`归档 ${键} 失败：${String((error && error.message) || error)}`)
      }
    }
    this.#日志(`房间 ${键} 已重置${sessionId ? '（旧会话 ' + sessionId + ' 已归档）' : ''}`)
    return this.遗忘(键)
  }
}
