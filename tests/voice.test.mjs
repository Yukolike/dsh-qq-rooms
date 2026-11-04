import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 合成语音, 判断发语音, 洗语音文本, 语音段 } from '../src/voice.js'

test('判断发语音：off 不念、all 每条、mark 只认 [语音]', () => {
  assert.deepEqual(判断发语音({ 语音模式: 'off' }, '[语音]你好'), { 定: false, 文字: '你好', 有标记: true })
  assert.equal(判断发语音({ 语音模式: 'all' }, '你好').定, true)
  assert.equal(判断发语音({ 语音模式: 'mark' }, '你好').定, false)
  assert.equal(判断发语音({ 语音模式: 'mark' }, '嗯 [语音] 你好').定, true)
  assert.equal(判断发语音({ 语音模式: 'mark' }, '嗯 [语音] 你好').文字, '嗯 你好')
  assert.equal(判断发语音({ 语音模式: 'weird' }, '你好').定, false)
  assert.equal(判断发语音({ 语音模式: 'all' }, '   ').定, false)
})

test('判断发语音：random 按概率，[语音] 强制触发', () => {
  assert.equal(判断发语音({ 语音模式: 'random', 语音概率: 100 }, '你好', () => 0.99).定, true)
  assert.equal(判断发语音({ 语音模式: 'random', 语音概率: 0 }, '你好', () => 0).定, false)
  assert.equal(判断发语音({ 语音模式: 'random', 语音概率: 0 }, '[语音]你好', () => 0.99).定, true)
  assert.equal(判断发语音({ 语音模式: 'random', 语音概率: 50 }, '你好', () => 0.49).定, true)
  assert.equal(判断发语音({ 语音模式: 'random', 语音概率: 50 }, '你好', () => 0.5).定, false)
})

test('洗语音文本：代码 / markdown / 链接 / URL 都不念', () => {
  const 文 = 洗语音文本('看 [这个](https://x.test/a) 和 ![图](a.png)\n```js\nconsole.log(1)\n```\n**重点** https://x.test/b')
  assert.equal(文, '看 这个 和 重点')
})

test('语音段：OneBot record + file:/// 路径', () => {
  assert.deepEqual(语音段('C:\\Users\\a b\\x.wav'), { type: 'record', data: { file: 'file:///C:/Users/a b/x.wav' } })
  assert.deepEqual(语音段('/tmp/x.wav'), { type: 'record', data: { file: 'file:///tmp/x.wav' } })
})

test('合成语音：自定义命令拿到 {text}/{out} 并产出文件', async () => {
  const 家 = mkdtempSync(join(tmpdir(), 'qq-voice-'))
  const 脚本 = join(家, 'fake-tts.mjs')
  writeFileSync(脚本, [
    "import { readFileSync, writeFileSync } from 'node:fs'",
    "writeFileSync(process.argv[3], Buffer.concat([Buffer.from('RIFF'), readFileSync(process.argv[2])]))",
  ].join('\n'), 'utf8')
  const 命令 = `"${process.execPath}" "${脚本}" "{text}" "{out}"`
  const r = await 合成语音('你好 **世界**，看 https://x.test', { 配置: { 语音合成命令: 命令, 语音最长字: 30, 语音超时秒: 20 }, 家目录: 家 })
  assert.equal(r.ok, true, r.错)
  assert.ok(existsSync(r.文件))
  assert.ok(statSync(r.文件).size > 4)
  const 念的 = readFileSync(r.文件, 'utf8')
  assert.ok(念的.includes('你好 世界'))
  assert.equal(念的.includes('https://'), false)
})

test('合成语音：命令失败 / 没产出时报告错误', async () => {
  const 家 = mkdtempSync(join(tmpdir(), 'qq-voice-'))
  const 失败 = await 合成语音('你好', { 配置: { 语音合成命令: '"' + process.execPath + '" -e "process.exit(2)"', 语音超时秒: 20 }, 家目录: 家 })
  assert.equal(失败.ok, false)
  assert.match(失败.错, /退出码/u)

  const 空 = await 合成语音('你好', { 配置: { 语音合成命令: '"' + process.execPath + '" -e "0"', 语音超时秒: 20 }, 家目录: 家 })
  assert.equal(空.ok, false)
  assert.match(空.错, /没生成音频/u)
})
