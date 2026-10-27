import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const 宿主路径 = resolve('src/host.js')
let 序号 = 0

const 等一拍 = () => new Promise((r) => setTimeout(r, 60))

function 环境(配置 = {}) {
  const 家 = mkdtempSync(join(tmpdir(), 'qq-rooms-'))
  process.env.DSH_HOME = 家
  writeFileSync(join(家, 'qq-rooms-config.json'), JSON.stringify({
    总开关: true,
    试运行: false,
    主人: '10000',
    NapCat: 'http://synthetic.invalid',
    事件地址: '',
    房间工作区: join(家, 'rooms'),
    ...配置,
  }), 'utf8')

  const 请求 = []
  const 原fetch = globalThis.fetch
  globalThis.fetch = async (url, opt) => {
    const u = String(url)
    const body = JSON.parse((opt && opt.body) || '{}')
    请求.push({ u, body, auth: opt && opt.headers && opt.headers.authorization })
    if (u.includes('get_login_info')) {
      return { ok: true, json: async () => ({ status: 'ok', retcode: 0, data: { user_id: 10001, nickname: 'me' } }) }
    }
    if (u.includes('_msg_history')) {
      return { ok: true, json: async () => ({ status: 'ok', retcode: 0, data: { messages: [] } }) }
    }
    return { ok: true, json: async () => ({ status: 'ok', retcode: 0, data: { message_id: 1 } }) }
  }

  const 跟进 = []
  const 事件handler = []
  const 效果 = []
  const 定时 = []
  const 路由 = []

  // 假宿主也要记得建过的会话，否则每轮都会 resume 失败 → 重建 → created 永远 true
  const 已知 = new Map()
  const 取 = (id) => {
    const s = String(id || '')
    return 已知.get(s) || 已知.get(s.replace(/^session-/u, '')) || 已知.get('session-' + s)
  }
  const 造 = (sessionId) => ({
    session: { id: sessionId, append: async () => {} },
    followup: async (m) => { 跟进.push(m) },
  })

  const ctx = {
    effect: (fn) => { const d = fn(); if (typeof d === 'function') 效果.push(d); return d },
    on: (名, fn) => { if (名 === 'session/event') 事件handler.push(fn); return () => {} },
    webServer: { register: (r) => { 路由.push(r); return () => {} } },
    interval: (fn, ms) => { 定时.push({ fn, ms }); return () => {} },
    agents: {
      get: (id) => 取(id),
      resume: async ({ resumeSessionId }) => {
        const 现 = 取(resumeSessionId)
        if (!现) throw new Error('no session')
        return { agent: 现 }
      },
      create: async ({ sessionId }) => {
        const agent = 造(sessionId)
        已知.set(sessionId, agent)
        return { agent }
      },
    },
    sessions: { flush: async () => {} },
    attachments: { admitPromptContent: async (c) => c },
    workspaceRegistry: { archiveSession: () => {} },
    logger: { info() {} },
    get: () => undefined,
  }

  return {
    家, 请求, 跟进, 事件handler, 效果, 定时, 路由, ctx,
    配置: () => JSON.parse(readFileSync(join(家, 'qq-rooms-config.json'), 'utf8')),
    清理: () => { globalThis.fetch = 原fetch },
  }
}

async function 载入() {
  序号 += 1
  return await import(pathToFileURL(宿主路径).href + '?case=' + 序号)
}

const 消息 = (补 = {}) => ({
  post_type: 'message', message_type: 'private', user_id: 20001, message_id: 1,
  sender: { nickname: '小明' },
  message: [{ type: 'text', data: { text: '你好' } }],
  ...补,
})

test('原版还开着：不注册监听、不轮询，只报冲突', async () => {
  const e = 环境()
  writeFileSync(join(e.家, 'qq-bridge-config.json'), JSON.stringify({ 总开关: true }), 'utf8')
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    assert.equal(e.事件handler.length, 0, '不应监听 session/event')
    assert.equal(e.定时.length, 0, '不应起轮询')
    const 概况 = await api.概况()
    assert.equal(概况.冲突, true)
    assert.equal(概况.原版状态, 'running')
    assert.match(概况.日志.map((x) => x.文本).join('\n'), /停用收发/u)
  } finally { e.清理() }
})

test('原版已停用：正常注册监听与轮询', async () => {
  const e = 环境()
  writeFileSync(join(e.家, 'qq-bridge-config.json'), JSON.stringify({ 总开关: false }), 'utf8')
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    assert.equal(e.事件handler.length, 1)
    assert.equal(e.定时.length, 1)
    const 概况 = await api.概况()
    assert.equal(概况.冲突, false)
    assert.equal(概况.原版状态, 'disabled')
  } finally { e.清理() }
})

test('陌生私聊：问主人，不建房间', async () => {
  const e = 环境()
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息())

    const 发给主人 = e.请求.filter((r) => r.u.endsWith('/send_private_msg'))
    assert.equal(发给主人.length, 1)
    assert.equal(发给主人[0].body.user_id, 10000)
    assert.match(JSON.stringify(发给主人[0].body), /有人私聊我/u)
    assert.equal(e.跟进.length, 0, '未批准不进房间')

    const 概况 = await api.概况()
    assert.equal(概况.待批.length, 1)
    assert.equal(概况.待批[0].号, '20001')
  } finally { e.清理() }
})

test('主人同意：加许可、补投原话、建房', async () => {
  const e = 环境()
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息())
    await api.处理消息(消息({ user_id: 10000, message_id: 2, message: [{ type: 'text', data: { text: '同意 20001' } }] }))
    await 等一拍()

    assert.ok(e.配置().访客['20001'], '许可已写入')
    assert.equal(e.跟进.length, 1, '补投了一条')
    assert.match(JSON.stringify(e.跟进[0]), /你好/u)
    assert.ok(e.配置().房间['私聊:20001'], '自动建了房间')
  } finally { e.清理() }
})

test('群：未加入丢弃；加入后未点名丢弃；@ 我才进', async () => {
  const e = 环境()
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)

    const 群消息 = (补 = {}) => 消息({
      message_type: 'group', group_id: 30001, user_id: 40001, message_id: 10,
      sender: { nickname: '群友' },
      message: [{ type: 'text', data: { text: '随便说' } }],
      ...补,
    })

    await api.处理消息(群消息({ message_id: 10 }))
    assert.equal(e.跟进.length, 0, '未加入的群丢弃')

    // 用主人指令接群
    await api.处理消息(消息({ user_id: 10000, message_id: 11, message: [{ type: 'text', data: { text: '接群 30001' } }] }))
    assert.ok(e.配置().群['30001'])

    await api.处理消息(群消息({ message_id: 12 }))
    assert.equal(e.跟进.length, 0, 'mention 模式未点名')

    await api.处理消息(群消息({
      message_id: 13,
      message: [{ type: 'at', data: { qq: '10001', name: 'Mio' } }, { type: 'text', data: { text: ' 在吗' } }],
    }))
    assert.equal(e.跟进.length, 1, '@我 进房')
  } finally { e.清理() }
})

test('出站：turn/end completed 才发，且按房间回对应聊天', async () => {
  const e = 环境()
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)

    // 先让 20001 成为许可访客并建房
    await api.处理消息(消息())
    await api.处理消息(消息({ user_id: 10000, message_id: 2, message: [{ type: 'text', data: { text: '同意 20001' } }] }))
    await 等一拍()
    const 房 = e.配置().房间['私聊:20001']
    assert.ok(房)

    const 前 = e.请求.filter((r) => r.u.endsWith('/send_private_msg')).length
    const 会话 = { id: 房.sessionId }
    const 派 = e.事件handler[0]

    派(会话, { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '回你的话' }] } } })
    派(会话, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await 等一拍()

    const 新发 = e.请求.filter((r) => r.u.endsWith('/send_private_msg')).slice(前)
    assert.equal(新发.length, 1)
    assert.equal(新发[0].body.user_id, 20001)
    assert.equal(新发[0].body.message[0].data.text, '回你的话')
  } finally { e.清理() }
})

test('出站：中断的轮 / 未完成不发；只发标记内无块不发', async () => {
  const e = 环境({ 只发标记内: true })
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息())
    await api.处理消息(消息({ user_id: 10000, message_id: 2, message: [{ type: 'text', data: { text: '同意 20001' } }] }))
    await 等一拍()
    const 房 = e.配置().房间['私聊:20001']
    const 会话 = { id: 房.sessionId }
    const 派 = e.事件handler[0]
    const 前 = e.请求.length

    派(会话, { type: 'assistant/message', data: { turn: 1, interrupted: true, message: { content: [{ type: 'text', text: '半截' }] } } })
    派(会话, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await 等一拍()
    assert.equal(e.请求.length, 前, '中断的轮不发')

    派(会话, { type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: '没有块' }] } } })
    派(会话, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
    await 等一拍()
    assert.equal(e.请求.length, 前, '只发标记内且无块 → 不发')

    派(会话, { type: 'assistant/message', data: { turn: 3, message: { content: [{ type: 'text', text: '[QQ]块里的话[/QQ]块外' }] } } })
    派(会话, { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } })
    await 等一拍()
    const 末 = e.请求.at(-1)
    assert.equal(末.body.message[0].data.text, '块里的话')
  } finally { e.清理() }
})

test('试运行：不真发，只记账', async () => {
  const e = 环境({ 试运行: true })
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息())
    const 发 = e.请求.filter((r) => r.u.endsWith('/send_private_msg'))
    assert.equal(发.length, 0, '试运行不该发 QQ')
    const 概况 = await api.概况()
    assert.match(概况.日志.map((x) => x.文本).join('\n'), /试运行/u)
  } finally { e.清理() }
})

test('房间重置：归档 + 删映射', async () => {
  const e = 环境()
  const 归档 = []
  e.ctx.workspaceRegistry = { archiveSession: (id) => 归档.push(id) }
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息())
    await api.处理消息(消息({ user_id: 10000, message_id: 2, message: [{ type: 'text', data: { text: '同意 20001' } }] }))
    await 等一拍()
    const 房 = e.配置().房间['私聊:20001']
    api.房间.重置('私聊:20001')
    assert.deepEqual(归档, [房.sessionId])
    assert.equal(e.配置().房间['私聊:20001'], undefined)
  } finally { e.清理() }
})

test('轮询：对已知房间拉历史，且不报 signal 未定义', async () => {
  const e = 环境({
    房间: { '私聊:20001': { sessionId: 'session-aaaaaaaa-1111', createdAt: 1, lastAt: 1 } },
  })
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    e.定时[0].fn()
    await 等一拍()

    const 拉历史 = e.请求.filter((r) => r.u.includes('get_friend_msg_history'))
    assert.equal(拉历史.length, 1, '应拉一次私聊历史')
    assert.equal(拉历史[0].body.user_id, 20001)

    const 概况 = await api.概况()
    assert.doesNotMatch(概况.日志.map((x) => x.文本).join('\n'), /signal is not defined/u)
  } finally { e.清理() }
})

test('user/message 的 source 在顶层：qq 不清唤醒，user 才清', async () => {
  const e = 环境({ 只回QQ唤醒: true, 访客: { 20001: { 昵称: '', 准到: 0 } } })
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息())
    await 等一拍()
    const 房 = e.配置().房间['私聊:20001']
    const 会话 = { id: 房.sessionId }
    const 派 = e.事件handler[0]
    const 发到访客 = () => e.请求.filter((r) => r.u.endsWith('/send_private_msg') && r.body.user_id === 20001)

    派(会话, { type: 'user/message', data: { source: { kind: 'qq' }, content: [] } })
    派(会话, { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '回一句' }] } } })
    派(会话, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await 等一拍()
    assert.equal(发到访客().length, 1, 'QQ 来源不该清掉唤醒')

    派(会话, { type: 'user/message', data: { source: { kind: 'user' }, content: [] } })
    派(会话, { type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: '本机聊' }] } } })
    派(会话, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
    await 等一拍()
    assert.equal(发到访客().length, 1, '本机输入清掉唤醒后不该发')
  } finally { e.清理() }
})


test('人格变化：老房间下一轮重新注入，不变则不重复', async () => {
  const e = 环境({ 访客: { 20001: { 昵称: '', 准到: 0 } } })
  const 房目录 = join(e.家, 'rooms')
  mkdirSync(房目录, { recursive: true })
  writeFileSync(join(房目录, 'AGENTS.md'), '人格版本一', 'utf8')
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息())
    await 等一拍()
    assert.match(JSON.stringify(e.跟进[0]), /人格版本一/u, '新房注入当前人格')

    writeFileSync(join(房目录, 'AGENTS.md'), '人格版本二', 'utf8')
    await api.处理消息(消息({ message_id: 2 }))
    await 等一拍()
    assert.match(JSON.stringify(e.跟进[1]), /人格版本二/u, '人格变了要重新注入')

    await api.处理消息(消息({ message_id: 3 }))
    await 等一拍()
    assert.doesNotMatch(JSON.stringify(e.跟进[2]), /人格版本二/u, '没变就不重复注入')
  } finally { e.清理() }
})

test('拒绝进黑名单：再来不询问；解除后恢复询问', async () => {
  const e = 环境()
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    const 问主人次数 = () =>
      e.请求.filter((r) => r.u.endsWith('/send_private_msg') && JSON.stringify(r.body).includes('有人私聊我')).length

    await api.处理消息(消息())
    assert.equal(问主人次数(), 1)

    await api.处理消息(消息({ user_id: 10000, message_id: 2, message: [{ type: 'text', data: { text: '拒绝 20001' } }] }))
    await 等一拍()
    assert.ok(e.配置().黑名单['20001'], '拒绝后进黑名单')

    await api.处理消息(消息({ message_id: 3 }))
    await 等一拍()
    assert.equal(问主人次数(), 1, '黑名单不再询问')

    await api.处理消息(消息({ user_id: 10000, message_id: 4, message: [{ type: 'text', data: { text: '解除 20001' } }] }))
    await 等一拍()
    assert.equal(e.配置().黑名单['20001'], undefined, '解除后移出黑名单')

    await api.处理消息(消息({ message_id: 5 }))
    await 等一拍()
    assert.equal(问主人次数(), 2, '解除后恢复询问')
  } finally { e.清理() }
})

test('同意进白名单：同时从黑名单移除', async () => {
  const e = 环境({ 黑名单: { 20001: { 拒绝于: 1 } } })
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    // 先解除，让他有机会被问
    await api.处理消息(消息({ user_id: 10000, message_id: 1, message: [{ type: 'text', data: { text: '解除 20001' } }] }))
    await 等一拍()
    await api.处理消息(消息({ message_id: 2 }))
    assert.equal(e.配置().待批, undefined)
    await api.处理消息(消息({ user_id: 10000, message_id: 3, message: [{ type: 'text', data: { text: '同意 20001' } }] }))
    await 等一拍()
    assert.ok(e.配置().访客['20001'], '进白名单')
    assert.equal(e.配置().黑名单['20001'], undefined, '从黑名单移除')
  } finally { e.清理() }
})

test('正文里的相对路径图按房间工作区解析并真的发出去', async () => {
  const e = 环境({ 访客: { 20001: { 昵称: '', 准到: 0 } } })
  const 贴纸目录 = join(e.家, 'rooms', '_stickers')
  mkdirSync(贴纸目录, { recursive: true })
  writeFileSync(
    join(贴纸目录, 'a.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  )
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息())
    await 等一拍()
    const 房 = e.配置().房间['私聊:20001']
    const 派 = e.事件handler[0]
    const 会话 = { id: 房.sessionId }

    派(会话, { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '看这个 ![猫](_stickers/a.png)' }] } } })
    派(会话, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await 等一拍()

    const 图 = e.请求.filter((r) => r.u.endsWith('/send_private_msg') && r.body.message && r.body.message[0] && r.body.message[0].type === 'image')
    assert.equal(图.length, 1, '应该发出一条图片消息')
    assert.match(图[0].body.message[0].data.file, /^base64:\/\//u)

    const 文本 = e.请求.filter((r) => r.u.endsWith('/send_private_msg') && r.body.message && r.body.message[0] && r.body.message[0].type === 'text')
    assert.equal(文本.length, 1)
    assert.doesNotMatch(文本[0].body.message[0].data.text, /!\[/u, 'markdown 不能泄漏到 QQ')
  } finally { e.清理() }
})
