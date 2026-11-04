import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
    if (u.includes('get_stranger_info') || u.includes('get_friend_info')) {
      return { ok: true, json: async () => ({ status: 'ok', retcode: 0, data: { user_id: 20001, nickname: '远端昵称' } }) }
    }
    if (u.includes('get_group_info')) {
      return { ok: true, json: async () => ({ status: 'ok', retcode: 0, data: { group_id: 30001, group_name: '测试群' } }) }
    }
    if (u.includes('/v1/image_generation')) {
      return {
        ok: true,
        json: async () => ({
          data: { image_base64: [Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')] },
          base_resp: { status_code: 0, status_msg: 'success' },
        }),
      }
    }
    if (u.includes('_msg_history')) {
      return { ok: true, json: async () => ({ status: 'ok', retcode: 0, data: { messages: [] } }) }
    }
    return { ok: true, json: async () => ({ status: 'ok', retcode: 0, data: { message_id: 1 } }) }
  }

  const 跟进 = []
  const 限制 = []
  const 守卫 = []
  const 撤销 = []
  const 注册工具 = []
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
    id: sessionId,
    session: { id: sessionId, append: async () => {} },
    followup: async (m) => { 跟进.push(m) },
    ctx: {
      tools: {
        restrict: (f) => {
          限制.push(f)
          let 关 = false
          return () => {
            if (关) return
            关 = true
            撤销.push(['restrict', f])
          }
        },
        guard: (g) => {
          守卫.push(g)
          let 关 = false
          return () => {
            if (关) return
            关 = true
            撤销.push(['guard'])
          }
        },
        register: (工具) => {
          注册工具.push(工具)
          return () => {}
        },
      },
    },
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
    家, 请求, 跟进, 限制, 守卫, 撤销, 注册工具, 事件handler, 效果, 定时, 路由, ctx,
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

test('语音：all 发成 record；mark 只认 [语音]，标记不泄露', async () => {
  const e = 环境()
  const 脚本 = join(e.家, 'fake-tts.mjs')
  writeFileSync(脚本, "import { writeFileSync } from 'node:fs'\nwriteFileSync(process.argv[3], Buffer.from('fake-wav'))", 'utf8')
  const 命令 = `"${process.execPath}" "${脚本}" "{text}" "{out}"`
  const 存配置 = (补) => writeFileSync(join(e.家, 'qq-rooms-config.json'), JSON.stringify({ ...e.配置(), ...补 }, null, 2), 'utf8')
  const 等够 = () => new Promise((r) => setTimeout(r, 600))
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息())
    await api.处理消息(消息({ user_id: 10000, message_id: 2, message: [{ type: 'text', data: { text: '同意 20001' } }] }))
    await 等一拍()
    const 房 = e.配置().房间['私聊:20001']
    const 派 = e.事件handler[0]
    const 发到房间 = () => e.请求.filter((r) => r.u.endsWith('/send_private_msg') && r.body.user_id === 20001)
    const 一言 = (turn, 文字) => {
      派({ id: 房.sessionId }, { type: 'assistant/message', data: { turn, message: { content: [{ type: 'text', text: 文字 }] } } })
      派({ id: 房.sessionId }, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
    }

    存配置({ 语音模式: 'all', 语音合成命令: 命令, 语音超时秒: 20 })
    const 前 = 发到房间().length
    一言(1, '念这一句')
    await 等够()
    const 发1 = 发到房间().slice(前)
    assert.equal(发1.length, 1, '语音模式 all 只发一条语音')
    assert.equal(发1[0].body.message[0].type, 'record')
    assert.ok(existsSync(fileURLToPath(发1[0].body.message[0].data.file)), '音频文件真的生成了')

    存配置({ 语音模式: 'mark' })
    const 前2 = 发到房间().length
    一言(2, '这条只发文字')
    await 等够()
    const 发2 = 发到房间().slice(前2)
    assert.equal(发2.length, 1)
    assert.equal(发2[0].body.message[0].type, 'text')
    assert.equal(发2[0].body.message[0].data.text, '这条只发文字')

    存配置({ 语音模式: 'mark', 语音附带文字: true })
    const 前3 = 发到房间().length
    一言(3, '[语音]这条要念')
    await 等够()
    const 发3 = 发到房间().slice(前3)
    assert.deepEqual(发3.map((r) => r.body.message[0].type), ['record', 'text'])
    assert.equal(发3[1].body.message[0].data.text, '这条要念', '[语音] 标记不能露到 QQ')

    // 念的太长被截断 → 剩余正文仍要发出来（不能吞字）
    存配置({ 语音模式: 'all', 语音最长字: 10, 语音附带文字: false })
    const 前4 = 发到房间().length
    一言(4, '这一句明显超过十个字了吧')
    await 等够()
    const 发4 = 发到房间().slice(前4)
    assert.deepEqual(发4.map((r) => r.body.message[0].type), ['record', 'text'])
    assert.equal(发4[1].body.message[0].data.text, '这一句明显超过十个字了吧')
  } finally { e.清理() }
})

test('随机语音：概率 100 发 record，概率 0 发文字', async () => {
  const e = 环境({ 总开关: true, 试运行: false, 主人: '10000' })
  const 脚本 = join(e.家, 'fake-tts.mjs')
  writeFileSync(脚本, "import { writeFileSync } from 'node:fs'\nwriteFileSync(process.argv[3], Buffer.from('fake-wav'))", 'utf8')
  const 存配置 = (补) => writeFileSync(join(e.家, 'qq-rooms-config.json'), JSON.stringify({
    ...e.配置(),
    总开关: true,
    试运行: false,
    主人: '10000',
    NapCat: 'http://synthetic.invalid',
    事件地址: '',
    语音模式: 'random',
    语音概率: 100,
    语音合成命令: `"${process.execPath}" "${脚本}" "{text}" "{out}"`,
    语音超时秒: 20,
    ...补,
  }), 'utf8')
  const 等够 = () => new Promise((r) => setTimeout(r, 500))
  try {
    存配置({})
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息({ user_id: 10000, message_id: 2, message: [{ type: 'text', data: { text: '在吗' } }] }))
    await 等一拍()
    const 房 = e.配置().房间['私聊:10000']
    const 派 = (turn, 文) => {
      const h = e.事件handler[0]
      h({ id: 房.sessionId }, { type: 'assistant/message', data: { turn, message: { content: [{ type: 'text', text: 文 }] } } })
      h({ id: 房.sessionId }, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
    }
    const 前 = e.请求.filter((r) => r.u.endsWith('/send_private_msg')).length
    派(1, '这条抽中了')
    await 等够()
    const 抽中 = e.请求.filter((r) => r.u.endsWith('/send_private_msg')).slice(前)
    assert.equal(抽中.length, 1)
    assert.equal(抽中[0].body.message[0].type, 'record')

    存配置({ 语音概率: 0 })
    const 前2 = e.请求.filter((r) => r.u.endsWith('/send_private_msg')).length
    派(2, '这条没抽中')
    await 等够()
    const 没抽 = e.请求.filter((r) => r.u.endsWith('/send_private_msg')).slice(前2)
    assert.equal(没抽.length, 1)
    assert.equal(没抽[0].body.message[0].type, 'text')
  } finally { e.清理() }
})

test('身份：私聊首条注入 QQ/关系，之后每条带 QQ 前缀', async () => {
  const e = 环境({ 总开关: true, 试运行: false, 主人: '10000' })
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息({ user_id: 10000, message_id: 2, sender: { nickname: '老大' }, message: [{ type: 'text', data: { text: '你好' } }] }))
    await 等一拍()
    const 首条 = JSON.stringify(e.跟进[0])
    assert.match(首条, /QQ 私聊房间/u)
    assert.match(首条, /对方 QQ：10000/u)
    assert.match(首条, /关系：主人/u)
    assert.match(首条, /老大（10000）：/u)

    await api.处理消息(消息({ user_id: 10000, message_id: 3, sender: { nickname: '老大' }, message: [{ type: 'text', data: { text: '再说一句' } }] }))
    await 等一拍()
    const 第二条 = JSON.stringify(e.跟进[1])
    assert.doesNotMatch(第二条, /QQ 私聊房间/u, '身份块只注入一次')
    assert.match(第二条, /老大（10000）：/u, '每条私聊都带昵称和 QQ')
  } finally { e.清理() }
})

test('语音偏好：qq_voice_mode 记住整间房都用语音/文字', async () => {
  const e = 环境({ 总开关: true, 试运行: false, 主人: '10000', 语音模式: 'mark' })
  const 脚本 = join(e.家, 'fake-tts.mjs')
  writeFileSync(脚本, "import { writeFileSync } from 'node:fs'\nwriteFileSync(process.argv[3], Buffer.from('fake-wav'))", 'utf8')
  writeFileSync(join(e.家, 'qq-rooms-config.json'), JSON.stringify({
    总开关: true,
    试运行: false,
    主人: '10000',
    NapCat: 'http://synthetic.invalid',
    事件地址: '',
    语音模式: 'mark',
    语音合成命令: `"${process.execPath}" "${脚本}" "{text}" "{out}"`,
    语音超时秒: 20,
  }), 'utf8')
  const 等够 = () => new Promise((r) => setTimeout(r, 500))
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息({ user_id: 10000, message_id: 2, message: [{ type: 'text', data: { text: '在吗' } }] }))
    await 等一拍()

    const 工具 = e.注册工具.find((x) => x.name === 'qq_voice_mode')
    assert.ok(工具, '主人私聊应挂 qq_voice_mode')
    const 房 = e.配置().房间['私聊:10000']
    const 派 = (turn, 文) => {
      const h = e.事件handler[0]
      h({ id: 房.sessionId }, { type: 'assistant/message', data: { turn, message: { content: [{ type: 'text', text: 文 }] } } })
      h({ id: 房.sessionId }, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
    }

    const 开 = await 工具.execute({ mode: 'voice' })
    assert.equal(开.ok, true)
    const 前 = e.请求.filter((r) => r.u.endsWith('/send_private_msg')).length
    派(1, '没有标记也应该语音')
    await 等够()
    const 发1 = e.请求.filter((r) => r.u.endsWith('/send_private_msg')).slice(前)
    assert.equal(发1.length, 1)
    assert.equal(发1[0].body.message[0].type, 'record')

    const 关 = await 工具.execute({ mode: 'text' })
    assert.equal(关.ok, true)
    const 前2 = e.请求.filter((r) => r.u.endsWith('/send_private_msg')).length
    派(2, '现在只发文字')
    await 等够()
    const 发2 = e.请求.filter((r) => r.u.endsWith('/send_private_msg')).slice(前2)
    assert.equal(发2.length, 1)
    assert.equal(发2[0].body.message[0].type, 'text')
  } finally { e.清理() }
})

test('语音偏好：主人说「接下来都用语音」也能记住', async () => {
  const e = 环境({ 总开关: true, 试运行: false, 主人: '10000', 语音模式: 'mark' })
  const 脚本 = join(e.家, 'fake-tts.mjs')
  writeFileSync(脚本, "import { writeFileSync } from 'node:fs'\nwriteFileSync(process.argv[3], Buffer.from('fake-wav'))", 'utf8')
  writeFileSync(join(e.家, 'qq-rooms-config.json'), JSON.stringify({
    总开关: true,
    试运行: false,
    主人: '10000',
    NapCat: 'http://synthetic.invalid',
    事件地址: '',
    语音模式: 'mark',
    语音合成命令: `"${process.execPath}" "${脚本}" "{text}" "{out}"`,
    语音超时秒: 20,
  }), 'utf8')
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息({ user_id: 10000, message_id: 2, message: [{ type: 'text', data: { text: '接下来都用语音回复' } }] }))
    await 等一拍()
    const 房 = e.配置().房间['私聊:10000']
    const h = e.事件handler[0]
    h({ id: 房.sessionId }, { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '这句应该自动语音' }] } } })
    h({ id: 房.sessionId }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await new Promise((r) => setTimeout(r, 500))
    const 发 = e.请求.filter((r) => r.u.endsWith('/send_private_msg'))
    assert.equal(发.length, 1)
    assert.equal(发[0].body.message[0].type, 'record')
    const 概况 = await api.概况()
    assert.match(概况.日志.map((x) => x.文本).join('\n'), /语音偏好：都用语音/u)
  } finally { e.清理() }
})

test('语音工具：主人私聊挂 qq_voice，调用后发 record', async () => {
  const e = 环境({ 总开关: true, 试运行: false, 主人: '10000' })
  const 脚本 = join(e.家, 'fake-tts.mjs')
  writeFileSync(脚本, "import { writeFileSync } from 'node:fs'\nwriteFileSync(process.argv[3], Buffer.from('fake-wav'))", 'utf8')
  writeFileSync(join(e.家, 'qq-rooms-config.json'), JSON.stringify({
    总开关: true,
    试运行: false,
    主人: '10000',
    NapCat: 'http://synthetic.invalid',
    事件地址: '',
    语音合成命令: `"${process.execPath}" "${脚本}" "{text}" "{out}"`,
    语音超时秒: 20,
  }), 'utf8')
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息({ user_id: 10000, message_id: 2, message: [{ type: 'text', data: { text: '在吗' } }] }))
    await 等一拍()

    const 工具 = e.注册工具.find((x) => x.name === 'qq_voice')
    assert.ok(工具, '主人私聊应挂 qq_voice')
    const 回 = await 工具.execute({ text: '这条用语音说' })
    assert.equal(回.ok, true, 回.说)
    const 发 = e.请求.filter((r) => r.u.endsWith('/send_private_msg') && r.body.user_id === 10000)
    assert.equal(发.length, 1)
    assert.equal(发[0].body.message[0].type, 'record')
  } finally { e.清理() }
})

test('生图：主人私聊挂 qq_draw，异步出图并发到 QQ', async () => {
  const e = 环境({ 生图: true, 总开关: true, 试运行: false, 主人: '10000', 发图: true })
  writeFileSync(join(e.家, 'minimax-api-key.txt'), 'test-key', 'utf8')
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息({ user_id: 10000, message_id: 2, message: [{ type: 'text', data: { text: '在吗' } }] }))
    await 等一拍()

    const 工具 = e.注册工具.find((x) => x.name === 'qq_draw')
    assert.ok(工具, '主人私聊应挂 qq_draw')
    const 回 = await 工具.execute({ prompt: '一只蓝发小鲸鱼在吃大白饭' })
    assert.equal(回.ok, true)
    assert.match(回.说, /开始画/u)

    await new Promise((r) => setTimeout(r, 500))
    const 图 = e.请求.filter((r) => r.u.endsWith('/send_private_msg') && r.body.user_id === 10000 && r.body.message?.[0]?.type === 'image')
    assert.equal(图.length, 1, '画好后应发一条图片')
    assert.match(图[0].body.message[0].data.file, /^base64:\/\//u)
    const 概况 = await api.概况()
    const 日志 = 概况.日志.map((x) => x.文本).join('\n')
    assert.match(日志, /开始生图/u)
    assert.match(日志, /生图已发/u)
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

test('访客房间自动锁工具；主人私聊不锁', async () => {
  const e = 环境({ 访客: { 20001: { 昵称: '', 准到: 0 } } })
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息())
    await 等一拍()
    assert.equal(e.限制.length, 1, '访客房间应调用一次 restrict')
    assert.deepEqual(e.限制[0], { allow: ['list_mcp_resources'] }, '必须留一个可点名的全局占位工具')
    assert.equal(e.守卫.length, 1, '默认 none：再装一道执行守卫')
    assert.match(String(e.守卫[0]({ name: 'remember' })), /禁用/u, '守卫要拒绝执行')
    assert.match(String(e.守卫[0]({ name: 'list_mcp_resources' })), /禁用/u, '占位工具自身也不许执行')
    const 前 = e.限制.length
    await api.处理消息(消息({ user_id: 10000, message_id: 2 }))
    await 等一拍()
    assert.equal(e.限制.length, 前, '主人私聊不锁工具')
  } finally { e.清理() }
})

test('访客工具 safe：占位工具之外只放行 todo_write', async () => {
  const e = 环境({ 访客工具: 'safe', 访客: { 20001: { 昵称: '', 准到: 0 } } })
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息())
    await 等一拍()
    assert.deepEqual(e.限制[0], { allow: ['list_mcp_resources'] })
    assert.equal(e.守卫.length, 1)
    assert.equal(e.守卫[0]({ name: 'todo_write' }), undefined, 'safe 允许 todo_write')
    assert.match(String(e.守卫[0]({ name: 'remember' })), /只允许/u)
  } finally { e.清理() }
})

test('占位候选全点不到名时回落到零工具，绝不裸奔', async () => {
  const e = 环境({ 访客: { 20001: { 昵称: '', 准到: 0 } } })
  const 调用 = []
  const 原create = e.ctx.agents.create
  e.ctx.agents.create = async ({ sessionId }) => {
    const 句柄 = await 原create({ sessionId })
    句柄.agent.ctx.tools.restrict = (f) => {
      调用.push(f)
      if (Array.isArray(f.allow) && f.allow.length) throw new Error('tools.restrict() names unknown global tool')
      return () => {}
    }
    return 句柄
  }
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息())
    await 等一拍()
    assert.ok(调用.length > 1, '应该逐个试过占位候选')
    assert.deepEqual(调用.at(-1), { allow: [] }, '全都点不到名时必须回落到零工具，不能一个掩码都没装上')
    assert.match(api.日志.map((x) => x.文本).join('\n'), /回落到零工具/u)
  } finally { e.清理() }
})

test('占位候选不在时，从 restrict 报错里的全局清单挑一个', async () => {
  const e = 环境({ 访客: { 20001: { 昵称: '', 准到: 0 } } })
  const 调用 = []
  const 原create = e.ctx.agents.create
  e.ctx.agents.create = async ({ sessionId }) => {
    const 句柄 = await 原create({ sessionId })
    句柄.agent.ctx.tools.restrict = (f) => {
      调用.push(f)
      const 名 = Array.isArray(f.allow) ? f.allow[0] : ''
      if (名 === 'mcp__x__list_pages') return () => {}
      throw new Error(
        `tools.restrict() names unknown global tool "${名}"; known global tools: android_app_info, mcp__x__list_pages, android_backtrace`,
      )
    }
    return 句柄
  }
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息())
    await 等一拍()
    assert.deepEqual(调用.at(-1), { allow: ['mcp__x__list_pages'] }, '按清单挑一个只读型占位')
    assert.match(api.日志.map((x) => x.文本).join('\n'), /占位 mcp__x__list_pages/u)
  } finally { e.清理() }
})

test('实时换档：保存后立刻撤掉旧遮罩与守卫（none → standard）', async () => {
  const e = 环境({ 访客: { 20001: { 昵称: '', 准到: 0 } } })
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息())
    await 等一拍()
    assert.equal(e.限制.length, 1)
    assert.equal(e.守卫.length, 1)

    // 不重启、不等新消息：保存设置就当场换档
    const 存 = await 打路由(e, '/dsh-qq-rooms/save', { 房间工具: { '私聊:20001': 'standard' } })
    assert.equal(存.ok, true)
    assert.deepEqual(e.撤销, [
      ['restrict', { allow: ['list_mcp_resources'] }],
      ['guard'],
    ], '先撤旧的：restrictions 相交，不撤松不开')
    assert.equal(e.限制.length, 1, 'standard 不该再装新遮罩')
    assert.equal(e.守卫.length, 1, 'standard 不该再装守卫')

    // 再发一条也不会重复装
    await api.处理消息(消息({ message_id: 2 }))
    await 等一拍()
    assert.equal(e.限制.length, 1)
    assert.equal(e.守卫.length, 1)
  } finally { e.清理() }
})

test('实时换档：standard → none 会重新装上限制', async () => {
  const e = 环境({ 访客: { 20001: { 昵称: '', 准到: 0 } }, 房间工具: { '私聊:20001': 'standard' } })
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息())
    await 等一拍()
    assert.equal(e.限制.length, 0, '覆盖为 standard：建房时不装')

    await 打路由(e, '/dsh-qq-rooms/save', { 房间工具: {} })
    assert.equal(e.限制.length, 1, '改回默认 none 应立刻装回')
    assert.deepEqual(e.限制[0], { allow: ['list_mcp_resources'] })
    assert.equal(e.守卫.length, 1)
  } finally { e.清理() }
})

test('每房覆盖：safe 与 none 各自生效，互不影响', async () => {
  const e = 环境({
    访客: { 20001: { 昵称: '', 准到: 0 }, 20002: { 昵称: '', 准到: 0 } },
    房间工具: { '私聊:20002': 'safe' },
  })
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息())
    await api.处理消息(消息({ user_id: 20002, message_id: 2 }))
    await 等一拍()
    assert.equal(e.限制.length, 2)
    assert.equal(e.守卫.length, 2)
    assert.match(String(e.守卫[0]({ name: 'todo_write' })), /禁用/u, '20001 默认 none')
    assert.equal(e.守卫[1]({ name: 'todo_write' }), undefined, '20002 覆盖为 safe')
  } finally { e.清理() }
})

test('日志落盘：apply 之后就有 plugin.log，页面不再需要显示日志', async () => {
  const e = 环境()
  try {
    const host = await 载入()
    host.apply(e.ctx)
    const p = join(e.家, 'qq-rooms-logs', 'plugin.log')
    assert.ok(existsSync(p), '应该建出日志文件')
    assert.match(readFileSync(p, 'utf8'), /已装好/u)
  } finally { e.清理() }
})

test('房间列表显示昵称，并写进配置', async () => {
  const e = 环境({ 访客: { 20001: { 昵称: '', 准到: 0 } } })
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息({ sender: { nickname: '小明' } }))
    await 等一拍()
    const 态 = await 打路由(e, '/dsh-qq-rooms/state')
    const 房 = 态.房间.find((x) => x.键 === '私聊:20001')
    assert.equal(房.昵称, '小明')
    assert.equal(e.配置().房间['私聊:20001'].昵称, '小明')
  } finally { e.清理() }
})

test('陌生人来信：审批消息带昵称、QQ、原话', async () => {
  const e = 环境()
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息({ sender: { nickname: '小明' } }))
    const 文 = e.请求.filter((r) => r.u.endsWith('/send_private_msg')).map((r) => JSON.stringify(r.body)).join('\n')
    assert.match(文, /昵称：小明/u)
    assert.match(文, /QQ：20001/u)
    assert.match(文, /说：你好/u)
    assert.doesNotMatch(文, /QQ 20001（20001）/u, '不该再出现重复号码的旧格式')
  } finally { e.清理() }
})

test('来信没带昵称：审批消息用后端查到的昵称', async () => {
  const e = 环境()
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息({ sender: {} }))
    const 文 = e.请求.filter((r) => r.u.endsWith('/send_private_msg')).map((r) => JSON.stringify(r.body)).join('\n')
    assert.match(文, /昵称：远端昵称/u)
  } finally { e.清理() }
})

test('同意：回执带昵称，昵称也写进白名单', async () => {
  const e = 环境()
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息({ sender: { nickname: '小明' } }))
    await api.处理消息(消息({ user_id: 10000, message_id: 2, message: [{ type: 'text', data: { text: '同意' } }] }))
    await 等一拍()
    const 文 = e.请求.filter((r) => r.u.endsWith('/send_private_msg')).map((r) => JSON.stringify(r.body)).join('\n')
    assert.match(文, /好，我接 小明（20001） 了/u)
    assert.equal(e.配置().访客['20001'].昵称, '小明')
  } finally { e.清理() }
})

test('手动加白名单：顺手查昵称并写进配置', async () => {
  const e = 环境()
  try {
    const host = await 载入()
    host.apply(e.ctx)
    const 回 = await 打路由(e, '/dsh-qq-rooms/approve', { 号: '20009', 允许: true })
    assert.equal(回.ok, true)
    assert.match(回.说, /远端昵称/u)
    assert.equal(e.配置().访客['20009'].昵称, '远端昵称')
  } finally { e.清理() }
})

test('群名称：接群后自动查群名并写进配置', async () => {
  const e = 环境()
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息({ user_id: 10000, message_id: 2, message: [{ type: 'text', data: { text: '接群 30001' } }] }))
    await 等一拍()
    const 态 = await 打路由(e, '/dsh-qq-rooms/state')
    assert.equal(态.配置.群['30001'].名称, '测试群')
  } finally { e.清理() }
})

test('建房后把会话登记进「房间工作区」对应的 workspace', async () => {
  const e = 环境({ 访客: { 20001: { 昵称: '', 准到: 0 } }, 房间工作区: 'D:\\MioWork\\dfyQQ' })
  const 登记 = []
  e.ctx.workspaceRegistry = {
    archiveSession: () => {},
    list: () => [{ id: 'w-dfyqq', title: 'dfyQQ', path: 'D:\\MioWork\\dfyQQ', sessionIds: [] }],
    get: (id) => ({
      attachSession: async (sessionId) => {
        登记.push({ workspaceId: id, sessionId })
      },
    }),
  }
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息())
    await 等一拍()
    assert.equal(登记.length, 1, '建房后应登记一次')
    assert.equal(登记[0].workspaceId, 'w-dfyqq')
    assert.match(登记[0].sessionId, /^session-/u)
  } finally { e.清理() }
})

test('群房也上工具闸门：默认 none', async () => {
  const e = 环境({ 群: 群表() })
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息({
      message_type: 'group', group_id: 30001, user_id: 40001, message_id: 10,
      sender: { nickname: '群友' },
      message: [{ type: 'at', data: { qq: '10001' } }, { type: 'text', data: { text: ' 在吗' } }],
    }))
    await 等一拍()
    assert.equal(e.限制.length, 1, '群房也要装遮罩')
    assert.deepEqual(e.限制[0], { allow: ['list_mcp_resources'] })
    assert.equal(e.守卫.length, 1, '默认 none 要装执行守卫')
    assert.match(String(e.守卫[0]({ name: 'remember' })), /禁用/u)
  } finally { e.清理() }
})

test('群工具 safe 生效；单群覆盖保存后立刻换档', async () => {
  const e = 环境({ 群: 群表(), 群工具: 'safe' })
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息({
      message_type: 'group', group_id: 30001, user_id: 40001, message_id: 10,
      sender: { nickname: '群友' },
      message: [{ type: 'at', data: { qq: '10001' } }, { type: 'text', data: { text: ' 在吗' } }],
    }))
    await 等一拍()
    assert.equal(e.守卫[0]({ name: 'todo_write' }), undefined, 'safe 允许 todo_write')

    await 打路由(e, '/dsh-qq-rooms/save', { 房间工具: { '群:30001': 'none' } })
    assert.equal(e.限制.length, 2, '换档要重新装遮罩')
    assert.match(String(e.守卫[1]({ name: 'todo_write' })), /禁用/u, '覆盖成 none 后连 todo 也拒')
  } finally { e.清理() }
})

/* ---------------- 回归：走查出来那几个 ---------------- */

/** 直接调一条 /dsh-qq-rooms/* 路由（假 req/res）。 */
async function 打路由(e, 路径, 体) {
  const 路 = e.路由.find((r) => r.path === 路径)
  assert.ok(路, '路由没注册：' + 路径)
  let 出 = ''
  const req = {
    url: 路径,
    headers: {},
    [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify(体 || {})) },
  }
  const res = { setHeader() {}, end(v) { 出 = String(v) } }
  await 路.handler(req, res)
  return JSON.parse(出)
}

const 等干完 = (ms = 200) => new Promise((r) => setTimeout(r, ms))

const 群表 = (号 = '30001') => ({ [号]: { enabled: true, mode: 'mention', addedAt: 1, muteUntil: 0, members: { allow: [], deny: [] } } })

test('群：引用我发过的那条也算点名（发送后要记住 message_id）', async () => {
  const e = 环境({ 群: 群表() })
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    const 群消息 = (补) => 消息({ message_type: 'group', group_id: 30001, user_id: 40001, sender: { nickname: '群友' }, ...补 })

    await api.处理消息(群消息({
      message_id: 10,
      message: [{ type: 'at', data: { qq: '10001' } }, { type: 'text', data: { text: ' 在吗' } }],
    }))
    assert.equal(e.跟进.length, 1, '@我 进房')

    const 房 = e.配置().房间['群:30001']
    const 派 = e.事件handler[0]
    const 会话 = { id: 房.sessionId }
    派(会话, { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '在' }] } } })
    派(会话, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await 等干完()

    // 假后端对所有发送都回 message_id: 1
    await api.处理消息(群消息({
      message_id: 11,
      user_id: 40002,
      message: [{ type: 'reply', data: { id: '1' } }, { type: 'text', data: { text: '这句呢' } }],
    }))
    assert.equal(e.跟进.length, 2, '引用我发的那条应该进房')
  } finally { e.清理() }
})

test('轮询：群历史条目没有 message_type 时按请求目标判定，不当成私聊', async () => {
  const e = 环境({ 群: 群表() })
  const 原fetch = globalThis.fetch
  globalThis.fetch = async (url, opt) => {
    if (String(url).includes('get_group_msg_history')) {
      return {
        ok: true,
        json: async () => ({
          status: 'ok', retcode: 0, data: {
            messages: [{
              message_id: 700, time: Math.floor(Date.now() / 1000), user_id: 40001,
              sender: { nickname: '群友' }, message: [{ type: 'text', data: { text: '随便说' } }],
            }],
          },
        }),
      }
    }
    return 原fetch(url, opt)
  }
  try {
    const host = await 载入()
    host.apply(e.ctx)
    e.定时[0].fn()
    await 等干完()

    const 问主人 = e.请求.filter((r) => r.u.endsWith('/send_private_msg') && JSON.stringify(r.body).includes('有人私聊我'))
    assert.equal(问主人.length, 0, '群历史不能当成发送者的私聊去问主人')
    assert.equal(e.跟进.length, 0, 'mention 模式未点名 → 丢弃')
  } finally { globalThis.fetch = 原fetch; e.清理() }
})

test('轮询：丢弃的消息记进已转，下一跳不再重解析', async () => {
  const e = 环境({ 群: 群表() })
  const 原fetch = globalThis.fetch
  let 转发 = 0
  globalThis.fetch = async (url, opt) => {
    const u = String(url)
    if (u.includes('get_group_msg_history')) {
      return {
        ok: true,
        json: async () => ({
          status: 'ok', retcode: 0, data: {
            messages: [{
              message_id: 701, time: Math.floor(Date.now() / 1000), message_type: 'group',
              group_id: 30001, user_id: 40001, sender: { nickname: '群友' },
              message: [{ type: 'text', data: { text: '闲聊' } }, { type: 'forward', data: { id: 'F1' } }],
            }],
          },
        }),
      }
    }
    if (u.includes('get_forward_msg')) {
      转发 += 1
      return { ok: true, json: async () => ({ status: 'ok', retcode: 0, data: { messages: [] } }) }
    }
    return 原fetch(url, opt)
  }
  try {
    const host = await 载入()
    host.apply(e.ctx)
    e.定时[0].fn()
    await 等干完()
    const 一次 = 转发
    assert.ok(一次 > 0, '第一次应该解析转发')

    e.定时[0].fn()
    await 等干完()
    assert.equal(转发, 一次, '丢弃后不该每跳重解析（转发接口会被重复调用）')
  } finally { globalThis.fetch = 原fetch; e.清理() }
})

test('测试一句：绕过总开关和试运行，真发一条给主人', async () => {
  const e = 环境({ 总开关: false, 试运行: true })
  try {
    const host = await 载入()
    host.apply(e.ctx)
    const 回 = await 打路由(e, '/dsh-qq-rooms/test-send')
    const 发 = e.请求.filter((r) => r.u.endsWith('/send_private_msg'))
    assert.equal(发.length, 1, '手动测试要真发')
    assert.equal(发[0].body.user_id, 10000)
    assert.equal(回.ok, true)
  } finally { e.清理() }
})

test('测试语音：绕过总开关和试运行，真发一条 record 给主人', async () => {
  const e = 环境({ 总开关: false, 试运行: true })
  const 脚本 = join(e.家, 'fake-tts.mjs')
  writeFileSync(脚本, "import { writeFileSync } from 'node:fs'\nwriteFileSync(process.argv[3], Buffer.from('fake-wav'))", 'utf8')
  writeFileSync(join(e.家, 'qq-rooms-config.json'), JSON.stringify({
    总开关: false,
    试运行: true,
    主人: '10000',
    NapCat: 'http://synthetic.invalid',
    事件地址: '',
    语音合成命令: `"${process.execPath}" "${脚本}" "{text}" "{out}"`,
    语音超时秒: 20,
  }), 'utf8')
  try {
    const host = await 载入()
    host.apply(e.ctx)
    const 回 = await 打路由(e, '/dsh-qq-rooms/test-voice')
    const 发 = e.请求.filter((r) => r.u.endsWith('/send_private_msg'))
    assert.equal(发.length, 1, '手动测试要真发')
    assert.equal(发[0].body.user_id, 10000)
    assert.equal(发[0].body.message[0].type, 'record')
    assert.equal(回.ok, true)
    assert.match(回.说, /语音/u)
  } finally { e.清理() }
})

test('保存设置：不清房间表、不回滚访客、遮罩不会写掉令牌', async () => {
  const e = 环境({
    令牌: 'SECRET-TOKEN',
    房间: { '私聊:20001': { sessionId: 'session-bbbbbbbb-2222', createdAt: 1, lastAt: 1 } },
    访客: { 20003: { 昵称: '老朋友', 准到: 0 } },
  })
  try {
    const host = await 载入()
    host.apply(e.ctx)
    const 状态 = await 打路由(e, '/dsh-qq-rooms/state')
    assert.equal(状态.配置.令牌, '********', '令牌只回遮罩')
    assert.doesNotMatch(JSON.stringify(状态), /SECRET-TOKEN/u, '/state 不能漏明文令牌')

    // 前端把页面打开时那份旧快照整份回传（房间 / 访客都是空的）
    await 打路由(e, '/dsh-qq-rooms/save', { ...状态.配置, 房间: {}, 访客: {}, 总开关: true })
    const 盘 = e.配置()
    assert.ok(盘.房间['私聊:20001'], '房间表不能被前端快照冲掉')
    assert.ok(盘.访客['20003'], '访客表不能被前端快照回滚')
    assert.equal(盘.令牌, 'SECRET-TOKEN', '遮罩原样回传 = 令牌没动')
  } finally { e.清理() }
})

test('管理接口：宿主明确 403 就拒绝，不写配置', async () => {
  const e = 环境()
  e.ctx.get = (名) => (名 === 'connection' ? { requestRejection: () => 403 } : undefined)
  try {
    const host = await 载入()
    host.apply(e.ctx)
    const 回 = await 打路由(e, '/dsh-qq-rooms/save', { 总开关: false })
    assert.equal(回.ok, false)
    assert.equal(e.配置().总开关, true, '被拒的请求不该写配置')
  } finally { e.清理() }
})

test('搭车注入（runtime-context）不清「QQ 唤醒」', async () => {
  const e = 环境({ 只回QQ唤醒: true, 访客: { 20001: { 昵称: '', 准到: 0 } } })
  try {
    const host = await 载入()
    const api = host.apply(e.ctx)
    await api.处理消息(消息())
    await 等干完()
    const 房 = e.配置().房间['私聊:20001']
    const 派 = e.事件handler[0]
    const 会话 = { id: 房.sessionId }
    const 发到访客 = () => e.请求.filter((r) => r.u.endsWith('/send_private_msg') && r.body.user_id === 20001)

    派(会话, { type: 'user/message', data: { source: { kind: 'runtime-context' }, content: [] } })
    派(会话, { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '回一句' }] } } })
    派(会话, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await 等干完()

    assert.equal(发到访客().length, 1, '注入不该把这一轮判成本机手打')
  } finally { e.清理() }
})
