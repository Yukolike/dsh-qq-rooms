import test from 'node:test'
import assert from 'node:assert/strict'
import {
  聊天键, 拆聊天键, 已许可, 群状态, 成员放行, 判定入站, 解析指令, 主人指令, 点名判定,
} from '../src/policy.js'
import { 归一化 } from '../src/config.js'

const 配置 = (补 = {}) => 归一化({
  主人: '10000',
  访客: { 20001: { 昵称: '小明', 准到: 0 } },
  群: {
    30001: { enabled: true, mode: 'mention' },
    30002: { enabled: true, mode: 'all' },
    30003: { enabled: false, mode: 'mention' },
    30004: { enabled: true, mode: 'mention', muteUntil: 9_999_999_999_999 },
    30005: { enabled: true, mode: 'mention', members: { deny: ['40001'], allow: [] } },
    30006: { enabled: true, mode: 'mention', members: { allow: ['40002'], deny: [] } },
  },
  ...补,
})

test('聊天键：合法与非法', () => {
  assert.equal(聊天键('私聊', '1234567'), '私聊:1234567')
  assert.equal(聊天键('群', '123456789'), '群:123456789')
  assert.equal(聊天键('私聊', '12'), '')
  assert.equal(聊天键('群', 'abc'), '')
  assert.deepEqual(拆聊天键('群:123456789'), { 类型: '群', 号码: '123456789' })
  assert.equal(拆聊天键('群:abc'), null)
})

test('访客许可：准到 0 长期，过期失效', () => {
  const c = 配置({ 访客: { 20001: { 昵称: '', 准到: 0 }, 20002: { 昵称: '', 准到: 1000 } } })
  assert.equal(已许可(c, '20001', 5000), true)
  assert.equal(已许可(c, '20002', 999), true)
  assert.equal(已许可(c, '20002', 1001), false)
  assert.equal(已许可(c, '29999'), false)
})

test('群状态：未加入 / 关闭 / 静音 / 两种模式', () => {
  const c = 配置()
  assert.deepEqual(群状态(c, '39999'), { 接: false, 原因: '未加入' })
  assert.deepEqual(群状态(c, '30003'), { 接: false, 原因: '已关闭' })
  assert.deepEqual(群状态(c, '30004', 1000), { 接: false, 原因: '静音中' })
  assert.deepEqual(群状态(c, '30004', 9_999_999_999_999), { 接: true, 模式: 'mention' })
  assert.deepEqual(群状态(c, '30002'), { 接: true, 模式: 'all' })
})

test('成员名单：deny 优先，空 allow 不限制', () => {
  const c = 配置()
  assert.equal(成员放行(c.群['30005'], '40001'), false)
  assert.equal(成员放行(c.群['30005'], '40009'), true)
  assert.equal(成员放行(c.群['30006'], '40002'), true)
  assert.equal(成员放行(c.群['30006'], '40009'), false)
})

test('入站：私聊主人 / 访客 / 陌生人', () => {
  const c = 配置()
  assert.equal(判定入站({ 类型: '私聊', 号码: '10000', 配置: c }).action, 'deliver')
  assert.equal(判定入站({ 类型: '私聊', 号码: '20001', 配置: c }).action, 'deliver')
  assert.equal(判定入站({ 类型: '私聊', 号码: '29999', 配置: c }).action, 'askOwner')
  assert.equal(判定入站({ 类型: '私聊', 号码: '12', 配置: c }).action, 'drop')
})

test('入站：群的四态 + 点名', () => {
  const c = 配置()
  const 群 = (号, 补 = {}) => 判定入站({ 类型: '群', 号码: 号, 配置: c, 发送者: '40009', ...补 })

  assert.equal(群('39999').action, 'drop')
  assert.equal(群('30003').action, 'drop')
  assert.equal(群('30004').action, 'drop')
  assert.equal(群('30001').action, 'drop', 'mention 未点名')
  assert.equal(群('30001', { 点名: true }).action, 'deliver')
  assert.equal(群('30002').action, 'deliver', 'all 不需要点名')
})

test('入站：主人在群里无视模式；成员名单优先', () => {
  const c = 配置()
  assert.equal(判定入站({ 类型: '群', 号码: '30001', 配置: c, 发送者: '10000' }).action, 'deliver')
  assert.equal(判定入站({ 类型: '群', 号码: '30001', 配置: c, 发送者: '40001' }).action, 'drop', 'deny 名单')
  assert.equal(判定入站({ 类型: '群', 号码: '30006', 配置: c, 发送者: '40009', 点名: true }).action, 'drop', '不在 allow')
})

test('指令：整条匹配才认，日常聊天不误吃', () => {
  assert.deepEqual(解析指令('同意'), { kind: 'approve', 号码: '' })
  assert.deepEqual(解析指令('同意 10001'), { kind: 'approve', 号码: '10001' })
  assert.deepEqual(解析指令('同意10001。'), { kind: 'approve', 号码: '10001' })
  assert.deepEqual(解析指令('拒绝 10001'), { kind: 'deny', 号码: '10001' })
  assert.deepEqual(解析指令('拉黑 10001'), { kind: 'deny', 号码: '10001' })
  assert.equal(解析指令('我同意你说的'), null)
  assert.equal(解析指令('同意，但是先等等'), null)
  assert.equal(解析指令('今天天气不错'), null)
})

test('指令：群管理', () => {
  assert.deepEqual(解析指令('接群 123456789'), { kind: 'joinGroup', 群号: '123456789', 模式: 'mention' })
  assert.deepEqual(解析指令('接群 123456789 all'), { kind: 'joinGroup', 群号: '123456789', 模式: 'all' })
  assert.deepEqual(解析指令('退群 123456789'), { kind: 'leaveGroup', 群号: '123456789' })
  assert.deepEqual(解析指令('静音 123456789'), { kind: 'muteGroup', 群号: '123456789', 分钟: 30 })
  assert.deepEqual(解析指令('静音 123456789 2小时'), { kind: 'muteGroup', 群号: '123456789', 分钟: 120 })
  assert.deepEqual(解析指令('取消静音 123456789'), { kind: 'unmuteGroup', 群号: '123456789' })
  assert.deepEqual(解析指令('房间'), { kind: 'list' })
  assert.deepEqual(解析指令('重置 群:123456789'), { kind: 'reset', 键: '群:123456789' })
})

test('主人指令：只认主人 + 私聊', () => {
  const c = 配置()
  assert.equal(主人指令({ 文字: '同意 20001', 发送者: '10000', 类型: '私聊', 配置: c }).kind, 'approve')
  assert.equal(主人指令({ 文字: '同意 20001', 发送者: '20001', 类型: '私聊', 配置: c }), null)
  assert.equal(主人指令({ 文字: '同意 20001', 发送者: '10000', 类型: '群', 配置: c }), null)
  assert.equal(主人指令({ 文字: '同意 20001', 发送者: '10000', 类型: '私聊', 配置: 归一化({}) }), null, '没设主人')
})

test('点名：@我 / at all / 引用我 / 引用别人 / 名字开关', () => {
  const 己方 = new Set(['900'])
  assert.equal(点名判定([{ type: 'at', data: { qq: '10001' } }], { 自己号: '10001' }), true)
  assert.equal(点名判定([{ type: 'at', data: { qq: 'all' } }], { 自己号: '10001' }), false)
  assert.equal(点名判定([{ type: 'reply', data: { id: '900' } }], { 己方消息: 己方 }), true)
  assert.equal(点名判定([{ type: 'reply', data: { id: '901' } }], { 己方消息: 己方 }), false)
  assert.equal(点名判定([{ type: 'text', data: { text: 'Mio 在吗' } }], { 名字: ['Mio'], 听名字: false }), false)
  assert.equal(点名判定([{ type: 'text', data: { text: 'Mio 在吗' } }], { 名字: ['Mio'], 听名字: true }), true)
})

test('私聊：黑名单优先于白名单，也比陌生人更早短路', () => {
  const c = 配置({
    黑名单: { 20001: { 拒绝于: 1 }, 20002: { 拒绝于: 1 } },
    访客: { 20002: { 昵称: '', 准到: 0 }, 20003: { 昵称: '', 准到: 0 } },
  })
  const 判 = (号) => 判定入站({ 类型: '私聊', 号码: 号, 配置: c })
  assert.deepEqual(判('20001'), { action: 'drop', 原因: '黑名单' })
  assert.deepEqual(判('20002'), { action: 'drop', 原因: '黑名单' }, '同时在白名单也以黑名单为准')
  assert.equal(判('20003').action, 'deliver')
  assert.equal(判('29999').action, 'askOwner')
  assert.equal(判('10000').action, 'deliver')
})

test('指令：解除 / 放行', () => {
  assert.deepEqual(解析指令('解除 10001'), { kind: 'unblock', 号码: '10001' })
  assert.deepEqual(解析指令('放出 10001'), { kind: 'unblock', 号码: '10001' })
  assert.deepEqual(解析指令('放行 10001'), { kind: 'allow', 号码: '10001' })
  assert.deepEqual(解析指令('白名单 10001'), { kind: 'allow', 号码: '10001' })
  assert.equal(解析指令('解除吧'), null)
})
