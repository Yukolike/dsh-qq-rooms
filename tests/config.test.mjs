import test from 'node:test'
import assert from 'node:assert/strict'
import { 归一化, 规整房间, 规整群, 规整访客 } from '../src/config.js'

test('默认配置：事件源字段存在', () => {
  const c = 归一化({})
  assert.equal(c.事件地址, 'ws://127.0.0.1:3001')
  assert.equal(c.事件令牌, '')
})

test('事件地址：显式空串保持空（不再回落默认）', () => {
  assert.equal(归一化({ 事件地址: '' }).事件地址, '')
  assert.equal(归一化({ 事件地址: 'ws://x:1' }).事件地址, 'ws://x:1')
  assert.equal(归一化({ 事件地址: undefined }).事件地址, 'ws://127.0.0.1:3001')
})

test('归一化：未知键丢弃 / 数字夹取 / 非法号码过滤', () => {
  const c = 归一化({
    未知: 1,
    轮询间隔毫秒: 10,
    访客: { 12: {}, abc: {}, 20001: { 准到: 5 } },
  })
  assert.equal('未知' in c, false)
  assert.equal(c.轮询间隔毫秒, 500)
  assert.deepEqual(Object.keys(c.访客), ['20001'])
})

test('房间：非法键与非法 sessionId 丢弃', () => {
  const r = 规整房间({
    '群:123456789': { sessionId: 'session-abcdefgh-1' },
    '私聊:abc': { sessionId: 'session-abcdefgh-1' },
    '私聊:1234567': { sessionId: 'bad' },
  })
  assert.deepEqual(Object.keys(r), ['群:123456789'])
})

test('群：mode 兜底 mention，成员名单去重', () => {
  const g = 规整群({ 30001: { mode: 'weird', members: { deny: ['40001', '40001', 'x'], allow: [] } } })
  assert.equal(g['30001'].mode, 'mention')
  assert.deepEqual(g['30001'].members.deny, ['40001'])
})

test('访客：昵称裁剪、负数准到归 0', () => {
  const v = 规整访客({ 20001: { 昵称: ' 小明 ', 准到: -1 }, 20002: { 准到: 123 } })
  assert.equal(v['20001'].昵称, '小明')
  assert.equal(v['20001'].准到, 0)
  assert.equal(v['20002'].准到, 123)
})

test('黑名单：只留合法号码，拒绝于保留', () => {
  const c = 归一化({ 黑名单: { 20001: { 拒绝于: 123 }, abc: {}, 12: {} } })
  assert.deepEqual(Object.keys(c.黑名单), ['20001'])
  assert.equal(c.黑名单['20001'].拒绝于, 123)
})

test('生图：默认关、模型/尺寸兜底、上限夹取', () => {
  const c = 归一化({})
  assert.equal(c.生图, false)
  assert.equal(c.生图模型, 'image-01')
  assert.equal(c.生图尺寸, '1:1')
  assert.equal(c.生图每日上限, 10)
  assert.equal(c.生图超时秒, 180)

  const 坏 = 归一化({ 生图模型: 'nope', 生图尺寸: '7:3', 生图每日上限: 999, 生图超时秒: 1 })
  assert.equal(坏.生图模型, 'image-01')
  assert.equal(坏.生图尺寸, '1:1')
  assert.equal(坏.生图每日上限, 100)
  assert.equal(坏.生图超时秒, 30)

  const 好 = 归一化({ 生图: 'true', 生图模型: 'image-01-live', 生图尺寸: '9:16', 生图每日上限: 0 })
  assert.equal(好.生图, true)
  assert.equal(好.生图模型, 'image-01-live')
  assert.equal(好.生图尺寸, '9:16')
  assert.equal(好.生图每日上限, 0)
})

test('语音：默认关、非法模式回落 off、数字夹取', () => {
  const c = 归一化({})
  assert.equal(c.语音模式, 'off')
  assert.equal(c.语音概率, 20)
  assert.equal(c.语音合成命令, '')
  assert.equal(c.语音最长字, 200)
  assert.equal(归一化({ 语音模式: 'random', 语音概率: 999 }).语音概率, 100)
  assert.equal(归一化({ 语音概率: -1 }).语音概率, 0)
  assert.equal(归一化({ 语音模式: 'random' }).语音模式, 'random')
  assert.equal(c.语音超时秒, 45)
  assert.equal(c.语音附带文字, false)

  const 坏 = 归一化({ 语音模式: 'weird', 语音最长字: 99999, 语音超时秒: 0 })
  assert.equal(坏.语音模式, 'off')
  assert.equal(坏.语音最长字, 2000)
  assert.equal(坏.语音超时秒, 5)

  const 好 = 归一化({ 语音模式: 'mark', 语音音色: ' Microsoft Huihui Desktop ', 语音情绪: 'happy', 语音附带文字: 'true' })
  assert.equal(好.语音模式, 'mark')
  assert.equal(好.语音音色, 'Microsoft Huihui Desktop')
  assert.equal(好.语音情绪, 'happy')
  assert.equal(好.语音附带文字, true)
  assert.equal(归一化({ 语音情绪: 'weird' }).语音情绪, '')
})
