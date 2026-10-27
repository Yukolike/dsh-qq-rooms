import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { 房间管理器, 房间标题, 房间工作区, 模型对 } from '../src/rooms.js'
import { 归一化, 默认配置 } from '../src/config.js'

/** 内存配置仓：读/改 都走同一份归一化对象。 */
function 配置仓(初始 = {}) {
  let 现在 = 归一化({ 主人: '10000', ...初始 })
  return {
    读: () => 现在,
    改: (变更) => {
      const 旧 = 现在
      const 新 = 归一化(typeof 变更 === 'function' ? 变更(旧) : { ...旧, ...变更 })
      现在 = 新
      return { 配置: 新, 成功: true }
    },
    当前: () => 现在,
  }
}

/** 假 agents：记录调用，按行为返回。 */
function 假agents({ 活 = new Map(), create, resume } = {}) {
  const 调用 = { get: [], create: [], resume: [] }
  const api = {
    get(id) {
      调用.get.push(id)
      return 活.get(id)
    },
    async create(参) {
      调用.create.push(参)
      if (create) return create(参)
      return 造Agent(参.sessionId)
    },
    async resume(参) {
      调用.resume.push(参)
      if (resume) return resume(参)
      return { agent: 造Agent(参.resumeSessionId) }
    },
  }
  return { api, 调用, 活 }
}

function 造Agent(sessionId) {
  const 标题 = []
  return {
    session: {
      id: sessionId,
      append: async (事件, 数据) => { 标题.push({ 事件, 数据 }) },
    },
    标题,
  }
}

test('模型对：provider/model 与非法输入', () => {
  assert.deepEqual(模型对('deepseek-account/deepseek-flash'), { provider: 'deepseek-account', model: 'deepseek-flash' })
  assert.deepEqual(模型对(''), {})
  assert.deepEqual(模型对('只有一段'), {})
  assert.deepEqual(模型对('/x'), {})
})

test('房间标题与工作区', () => {
  assert.equal(房间标题('私聊:1234567', '小明'), 'QQ 私聊 · 小明')
  assert.equal(房间标题('私聊:1234567', ''), 'QQ 私聊 · 1234567')
  assert.equal(房间标题('群:123456789'), 'QQ 群 · 123456789')
  assert.equal(房间工作区({ 房间工作区: 'D:/rooms' }, 'C:/home'), 'D:/rooms')
  assert.equal(房间工作区({ 房间工作区: '' }, 'C:/home'), join('C:/home', 'qq-rooms'))
})

test('首次确保：create 一次、写入房间映射、设置标题', async () => {
  const 仓 = 配置仓()
  const { api, 调用 } = 假agents()
  const 房 = new 房间管理器({ agents: api, 读: 仓.读, 改: 仓.改, 家目录: 'C:/home' })

  const 结果 = await 房.确保('私聊:20001', { 昵称: '小明' })
  assert.equal(结果.created, true)
  assert.equal(调用.create.length, 1)
  assert.equal(调用.create[0].agentOptions.provider, 'deepseek-account')
  assert.deepEqual(调用.create[0].meta, { cwd: join('C:/home', 'qq-rooms') })

  const 行 = 仓.当前().房间['私聊:20001']
  assert.ok(行 && 行.sessionId.startsWith('session-'))
  assert.equal(结果.agent.标题.at(-1).数据.title, 'QQ 私聊 · 小明')
  // 标题来源必须是 user（messageSeqs 为空 ↔ user），否则 DSH 下次加载会判日志损坏
  assert.equal(结果.agent.标题.at(-1).数据.source.kind, 'user')
  assert.deepEqual(结果.agent.标题.at(-1).数据.messageSeqs, [])
})

test('并发首条消息只建一间房（单飞）', async () => {
  const 仓 = 配置仓()
  let createCalls = 0
  const { api } = 假agents({
    create: async (参) => { createCalls++; await new Promise((r) => setTimeout(r, 20)); return 造Agent(参.sessionId) },
  })
  const 房 = new 房间管理器({ agents: api, 读: 仓.读, 改: 仓.改, 家目录: 'C:/home' })

  const [a, b, c] = await Promise.all([
    房.确保('群:123456789'),
    房.确保('群:123456789'),
    房.确保('群:123456789'),
  ])
  assert.equal(createCalls, 1)
  assert.equal(a.sessionId, b.sessionId)
  assert.equal(b.sessionId, c.sessionId)
})

test('已有活 agent：不 resume、不 create', async () => {
  const 仓 = 配置仓({ 房间: { '私聊:20001': { sessionId: 'session-aaaaaaaa-1111', createdAt: 1, lastAt: 1 } } })
  const 活 = new Map([['session-aaaaaaaa-1111', 造Agent('session-aaaaaaaa-1111')]])
  const { api, 调用 } = 假agents({ 活 })
  const 房 = new 房间管理器({ agents: api, 读: 仓.读, 改: 仓.改, 家目录: 'C:/home' })

  const 结果 = await 房.确保('私聊:20001')
  assert.equal(结果.created, false)
  assert.equal(调用.resume.length, 0)
  assert.equal(调用.create.length, 0)
})

test('宿主里没有：先 resume', async () => {
  const 仓 = 配置仓({ 房间: { '私聊:20001': { sessionId: 'session-bbbbbbbb-2222', createdAt: 1, lastAt: 1 } } })
  const { api, 调用 } = 假agents()
  const 房 = new 房间管理器({ agents: api, 读: 仓.读, 改: 仓.改, 家目录: 'C:/home' })

  const 结果 = await 房.确保('私聊:20001')
  assert.equal(调用.resume.length, 1)
  assert.equal(调用.resume[0].resumeSessionId, 'session-bbbbbbbb-2222')
  assert.equal(调用.create.length, 0)
  assert.equal(结果.created, false)
})

test('resume 失败：回落到 create，并换新 sessionId', async () => {
  const 仓 = 配置仓({ 房间: { '私聊:20001': { sessionId: 'session-cccccccc-3333', createdAt: 1, lastAt: 1 } } })
  const { api, 调用 } = 假agents({ resume: async () => { throw new Error('gone') } })
  const 房 = new 房间管理器({ agents: api, 读: 仓.读, 改: 仓.改, 家目录: 'C:/home' })

  const 结果 = await 房.确保('私聊:20001')
  assert.equal(调用.create.length, 1)
  assert.equal(结果.created, true)
  assert.notEqual(结果.sessionId, 'session-cccccccc-3333')
  assert.equal(仓.当前().房间['私聊:20001'].sessionId, 结果.sessionId)
})

test('重置：归档旧会话 + 删映射，下次消息重建', async () => {
  const 仓 = 配置仓({ 房间: { '群:123456789': { sessionId: 'session-dddddddd-4444', createdAt: 1, lastAt: 1 } } })
  const 归档 = []
  const { api } = 假agents()
  const 房 = new 房间管理器({
    agents: api, 读: 仓.读, 改: 仓.改, 家目录: 'C:/home',
    工作区: { archiveSession: (id) => 归档.push(id) },
  })

  房.重置('群:123456789')
  assert.deepEqual(归档, ['session-dddddddd-4444'])
  assert.equal(仓.当前().房间['群:123456789'], undefined)

  const 结果 = await 房.确保('群:123456789')
  assert.equal(结果.created, true)
})

test('列表：带存活标记', () => {
  const 仓 = 配置仓({
    房间: {
      '私聊:20001': { sessionId: 'session-eeeeeeee-5555', createdAt: 1, lastAt: 2 },
      '群:123456789': { sessionId: 'session-ffffffff-6666', createdAt: 3, lastAt: 4 },
    },
  })
  const { api } = 假agents({ 活: new Map([['session-eeeeeeee-5555', 造Agent('session-eeeeeeee-5555')]]) })
  const 房 = new 房间管理器({ agents: api, 读: 仓.读, 改: 仓.改, 家目录: 'C:/home' })
  const 表 = 房.列表()
  assert.equal(表.length, 2)
  assert.equal(表.find((x) => x.键 === '私聊:20001').活着, true)
  assert.equal(表.find((x) => x.键 === '群:123456789').活着, false)
})

test('非法键直接拒绝', async () => {
  const 仓 = 配置仓()
  const { api } = 假agents()
  const 房 = new 房间管理器({ agents: api, 读: 仓.读, 改: 仓.改, 家目录: 'C:/home' })
  await assert.rejects(() => 房.确保('群:abc'), /非法的房间键/)
  assert.equal(默认配置.总开关, false, '安全默认：总开关关')
})
