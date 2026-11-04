import test from 'node:test'
import assert from 'node:assert/strict'
import { 构建语音命令, 引擎id, 引擎支持标签 } from '../src/tts.js'
import { 归一化 } from '../src/config.js'

test('MiniMax 引擎生成 wrapper 命令，带模型/语速/音高/情绪', () => {
  const 命令 = 构建语音命令({
    语音引擎: 'minimax',
    引擎配置: { minimax: { model: 'speech-2.8-turbo', speed: 0.95, pitch: 2, python: 'py' } },
    语音超时秒: 50,
  })
  assert.match(命令, /tts_minimax\.py/u)
  assert.match(命令, /--model speech-2\.8-turbo/u)
  assert.match(命令, /--speed 0\.95/u)
  assert.match(命令, /--pitch 2/u)
  assert.match(命令, /--emotion "\{emotion\}"/u)
  assert.match(命令, /--timeout 50/u)
})

test('edge / SAPI / 自定义 / 命令覆盖', () => {
  const edge = 构建语音命令({ 语音引擎: 'edge', 引擎配置: { edge: { rate: '+10%', pitch: '+20Hz' } } })
  assert.match(edge, /-m edge_tts/u)
  assert.match(edge, /--rate=\+10%/u)
  assert.match(edge, /--pitch=\+20Hz/u)

  assert.equal(构建语音命令({ 语音引擎: 'sapi' }), '')
  assert.equal(构建语音命令({ 语音引擎: 'custom', 引擎配置: { custom: { 命令: 'mycmd "{text}"' } } }), 'mycmd "{text}"')
  assert.equal(构建语音命令({ 语音引擎: 'minimax', 语音合成命令: 'override "{text}"' }), 'override "{text}"')
})

test('引擎识别与标签能力', () => {
  assert.equal(引擎id({ 语音引擎: 'edge' }), 'edge')
  assert.equal(引擎id({ 语音引擎: 'nope' }), 'minimax')
  assert.equal(引擎支持标签({ 语音引擎: 'minimax' }), true)
  assert.equal(引擎支持标签({ 语音引擎: 'edge' }), false)
})

test('旧配置迁移：从旧命令识别 MiniMax 并保留参数', () => {
  const c = 归一化({
    语音合成命令: '"C:\\Python\\python.exe" "D:\\x\\tools\\tts_minimax.py" --text "{text}" --out "{out}" --voice "{voice}" --model speech-2.6-hd --speed 0.9 --pitch -1',
    语音音色: 'Chinese (Mandarin)_Warm_Bestie',
  })
  assert.equal(c.语音引擎, 'minimax')
  assert.equal(c.引擎配置.minimax.model, 'speech-2.6-hd')
  assert.equal(c.引擎配置.minimax.speed, 0.9)
  assert.equal(c.引擎配置.minimax.pitch, -1)
  assert.equal(c.引擎配置.minimax.python, 'C:\\Python\\python.exe')
  assert.equal(c.引擎音色.minimax, 'Chinese (Mandarin)_Warm_Bestie')
})

test('切换引擎：默认音色和每引擎配置', () => {
  const c = 归一化({ 语音引擎: 'edge', 语音音色: '' })
  assert.equal(c.语音引擎, 'edge')
  assert.equal(c.语音音色, 'zh-CN-XiaoyiNeural')
  assert.equal(c.引擎音色.edge, 'zh-CN-XiaoyiNeural')
  assert.equal(c.引擎配置.edge.rate, '+0%')
})
