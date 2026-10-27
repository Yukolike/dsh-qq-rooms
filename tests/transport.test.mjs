import test from 'node:test'
import assert from 'node:assert/strict'
import {
  OneBot, 抠QQ标记, 抠正文图, 按段拆, 卡片文字, 看图类, 扩展名,
  解析消息, 转发文字, 私人消息体, 群消息体, 图片段,
} from '../src/transport.js'

test('抠QQ标记：关 → 剥标记发全文；开 → 只发块；只写开头 → 发后面', () => {
  assert.deepEqual(抠QQ标记('前 [QQ]要发的[/QQ] 后', false), { 发: true, 文字: '前 要发的 后' })
  assert.deepEqual(抠QQ标记('前 [QQ]要发的[/QQ] 后', true), { 发: true, 文字: '要发的' })
  const 半 = 抠QQ标记('说明\n[QQ]要发的', true)
  assert.equal(半.发, true)
  assert.equal(半.文字, '要发的')
  assert.equal(抠QQ标记('只有说明', true).发, false)
})

test('抠正文图：本地与网络，正文被清干净', () => {
  const r = 抠正文图('看这个 ![猫](_stickers/a.webp)\n\n还有 ![图](https://x.test/b.png)')
  assert.equal(r.净文字, '看这个\n\n还有')
  assert.deepEqual(r.图, [
    { kind: 'path', value: '_stickers/a.webp' },
    { kind: 'url', value: 'https://x.test/b.png' },
  ])
})

test('按段拆：空行分段', () => {
  assert.deepEqual(按段拆('一\n\n二\n\n\n三'), ['一', '二', '三'])
  assert.deepEqual(按段拆('只有一段\n换行'), ['只有一段\n换行'])
})

test('卡片文字：B 站 JSON 抽出标题/BV，XML 兜底', () => {
  const json = JSON.stringify({ meta: { detail: { title: '某视频标题', qqdocurl: 'https://b23.tv/BV1xx411c7mD' } } })
  const a = 卡片文字({ type: 'json', data: { data: json } })
  assert.match(a, /某视频标题/u)
  assert.match(a, /BV1xx411c7mD/u)

  const xml = '<msg><title>XML 标题</title><summary>摘要</summary><url>https://e.test/x</url></msg>'
  const b = 卡片文字({ type: 'xml', data: { data: xml } })
  assert.match(b, /XML 标题/u)
})

test('看图类 / 扩展名', () => {
  assert.equal(看图类(Buffer.from([0x89, 0x50, 0x4e, 0x47])), 'image/png')
  assert.equal(看图类(Buffer.from([0x47, 0x49, 0x46])), 'image/gif')
  assert.equal(看图类(Buffer.from([0xff, 0xd8])), 'image/jpeg')
  assert.equal(扩展名('image/webp'), 'webp')
})

test('消息体拼装', () => {
  assert.deepEqual(私人消息体('hi'), { user_id: 0, message: [{ type: 'text', data: { text: 'hi' } }] })
  assert.deepEqual(群消息体('hi'), { group_id: 0, message: [{ type: 'text', data: { text: 'hi' } }] })
  assert.deepEqual(图片段('AAA'), { type: 'image', data: { file: 'base64://AAA' } })
})

test('解析消息：文本 / @ / 图片 / 表情 / 视频', async () => {
  const 条 = {
    message: [
      { type: 'text', data: { text: '你好 ' } },
      { type: 'at', data: { qq: '10001', name: 'Mio' } },
      { type: 'image', data: { url: 'https://x.test/a.png' } },
      { type: 'face', data: {} },
      { type: 'video', data: {} },
    ],
  }
  const r = await 解析消息(条, { 收图: true })
  assert.equal(r.文字, '你好 \n@Mio\n[表情]\n[视频]')
  assert.equal(r.图们.length, 1)
})

test('解析消息：关收图 → 只留占位', async () => {
  const r = await 解析消息({ message: [{ type: 'image', data: { url: 'x' } }] }, { 收图: false })
  assert.equal(r.文字, '[图片]')
  assert.equal(r.图们.length, 0)
})

test('解析消息：合并转发展开两行', async () => {
  const 拉任意 = async (action, 体) => {
    if (action !== 'get_forward_msg') return null
    return {
      messages: [
        { sender: { nickname: '甲' }, content: [{ type: 'text', data: { text: '第一句' } }] },
        { sender: { nickname: '乙' }, content: [{ type: 'text', data: { text: '第二句' } }, { type: 'image', data: {} }] },
      ],
    }
  }
  const 文 = await 转发文字({ type: 'forward', data: { id: 'f1' } }, 拉任意)
  assert.match(文, /共 2 条/u)
  assert.match(文, /甲：第一句/u)
  assert.match(文, /乙：第二句\[图片\]/u)
})

test('OneBot 发文字：拆段、action、鉴权头、间隔', async () => {
  const 记录 = []
  const 原fetch = globalThis.fetch
  globalThis.fetch = async (url, opt) => {
    记录.push({ url: String(url), body: JSON.parse(opt.body), auth: opt.headers.authorization })
    return { ok: true, json: async () => ({ status: 'ok', retcode: 0, data: { message_id: 1 } }) }
  }
  try {
    const 传 = new OneBot({ 地址: 'http://x.test/', 令牌: 'tok' })
    await 传.发文字('私聊', '1234567', ['a', 'b'], { 间隔毫秒: 0 })
    assert.equal(记录.length, 2)
    assert.equal(记录[0].url, 'http://x.test/send_private_msg')
    assert.equal(记录[0].body.user_id, 1234567)
    assert.equal(记录[0].body.message[0].data.text, 'a')
    assert.equal(记录[0].auth, 'Bearer tok')

    await 传.发文字('群', '123456789', ['c'], { 间隔毫秒: 0 })
    assert.equal(记录.at(-1).url, 'http://x.test/send_group_msg')
    assert.equal(记录.at(-1).body.group_id, 123456789)
  } finally {
    globalThis.fetch = 原fetch
  }
})

test('OneBot 发图片：每张一条，base64 段', async () => {
  const 记录 = []
  const 原fetch = globalThis.fetch
  globalThis.fetch = async (url, opt) => {
    记录.push({ url: String(url), body: JSON.parse(opt.body) })
    return { ok: true, json: async () => ({ status: 'ok', retcode: 0, data: {} }) }
  }
  try {
    const 传 = new OneBot({ 地址: 'http://x.test' })
    await 传.发图片('群', '123456789', [{ b64: 'AAA' }, { url: 'https://e.test/b.png' }], { 间隔毫秒: 0 })
    assert.equal(记录.length, 2)
    assert.equal(记录[0].body.message[0].data.file, 'base64://AAA')
    assert.equal(记录[1].body.message[0].data.file, 'https://e.test/b.png')
  } finally {
    globalThis.fetch = 原fetch
  }
})

test('OneBot 拉历史：按类型选接口与数量', async () => {
  const 记录 = []
  const 原fetch = globalThis.fetch
  globalThis.fetch = async (url, opt) => {
    记录.push({ url: String(url), body: JSON.parse(opt.body) })
    return { ok: true, json: async () => ({ status: 'ok', retcode: 0, data: { messages: [{ message_id: 1 }] } }) }
  }
  try {
    const 传 = new OneBot({ 地址: 'http://x.test' })
    const 私 = await 传.拉历史('私聊', '1234567', 10)
    assert.equal(记录[0].url, 'http://x.test/get_friend_msg_history')
    assert.equal(记录[0].body.count, 10)
    assert.equal(私.length, 1)

    await 传.拉历史('群', '123456789', 30)
    assert.equal(记录[1].url, 'http://x.test/get_group_msg_history')
    assert.equal(记录[1].body.group_id, 123456789)
  } finally {
    globalThis.fetch = 原fetch
  }
})
