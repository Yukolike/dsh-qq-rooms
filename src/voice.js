// dsh-qq-rooms · 语音回复（TTS）
//
// 把 assistant 的正文念成一条 QQ 语音（OneBot `record` 消息段）。
// 插件不捆绑模型：
//   · 默认用 Windows 自带的 SAPI（tools/tts_sapi.ps1，离线、零依赖）；
//   · 想换更好的声音（edge-tts / GPT-SoVITS / 云端接口）就填「语音合成命令」，
//     模板里用 {text}（UTF-8 文字文件）、{out}（wav 输出路径）、{voice}（音色）。
//
// 这里只负责「文字 → wav」，不碰 QQ；发送在 transport.js 的 OneBot.发语音。

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { 构建语音命令, 引擎id, 引擎支持标签 } from './tts.js'

/** 正文里写了这个标记才发语音（「语音模式 = 标记」时）。 */
export const 语音标记 = '[语音]'

/** 内置朗读脚本（Windows PowerShell + System.Speech）。 */
export const 内置脚本 = fileURLToPath(new URL('../tools/tts_sapi.ps1', import.meta.url))

const 模式们 = new Set(['off', 'all', 'mark', 'random'])
const 数 = (v, 兜, 低, 高) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return 兜
  return Math.max(低, Math.min(Math.round(n), 高))
}

/** 清掉朗读时不该念的东西：代码块、markdown、链接、URL、标记。 */
export function 洗语音文本(文字) {
  return String(文字 || '')
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`([^`]*)`/gu, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/https?:\/\/[^\s)）]+/giu, ' ')
    .replace(/[*_~#>]+/gu, '')
    .replace(/\[语音\]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * 这一条该不该发语音。
 * @returns {{定: boolean, 文字: string, 有标记: boolean}}
 *   文字 = 去掉 [语音] 标记后的原文（不管发不发语音，标记都不该露到 QQ）。
 */
export function 判断发语音(配置, 文字, 随机 = Math.random) {
  const 原文 = String(文字 || '')
  const 有标记 = 原文.includes(语音标记)
  const 净 = 原文.split(语音标记).join('').replace(/[ \t]{2,}/gu, ' ').trim()
  const 模式 = String((配置 && 配置.语音模式) || 'off')
  const 模式对 = 模式们.has(模式) ? 模式 : 'off'
  const 概率 = Math.max(0, Math.min(Number(配置?.语音概率 ?? 20), 100))
  let 定 = false
  if (模式对 === 'all') 定 = Boolean(净)
  else if (模式对 === 'mark') 定 = 有标记 && Boolean(净)
  else if (模式对 === 'random') 定 = Boolean(净) && (有标记 || 随机() * 100 < 概率)
  return { 定, 文字: 净, 有标记 }
}

/** 跑一条命令；只看退出码，stdout/stderr 报错时带回来。 */
function 跑命令(命令, 超时秒) {
  return new Promise((resolve) => {
    let 出 = ''
    let 定 = null
    let 子 = null
    const 收 = (v) => {
      clearTimeout(定)
      resolve(v)
    }
    try {
      子 = spawn(命令, {
        shell: true,
        windowsHide: true,
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      })
    } catch (error) {
      return 收({ ok: false, 错: String((error && error.message) || error) })
    }
    子.stdout?.on('data', (b) => { 出 += String(b) })
    子.stderr?.on('data', (b) => { 出 += String(b) })
    子.on('error', (error) => 收({ ok: false, 错: String((error && error.message) || error) }))
    子.on('close', (码) => 收(码 === 0 ? { ok: true } : { ok: false, 错: 出.trim() || '退出码 ' + 码 }))
    定 = setTimeout(() => {
      try { 子.kill() } catch { /* 已经退出 */ }
      收({ ok: false, 错: '超时' })
    }, Math.max(5, 数(超时秒, 45, 5, 600)) * 1000)
  })
}

/** 顺手清掉一天前的旧音频，免得目录越涨越大。 */
function 清旧文件(目录) {
  try {
    const 线 = Date.now() - 24 * 3600 * 1000
    for (const 名 of readdirSync(目录)) {
      const 路径 = join(目录, 名)
      try {
        const 信息 = statSync(路径)
        if (信息.isFile() && 信息.mtimeMs < 线) unlinkSync(路径)
      } catch {
        /* 删不掉就算了 */
      }
    }
  } catch {
    /* 目录还不存在 / 读不了 */
  }
}

const 引 = (s) => '"' + String(s || '').replace(/"/gu, '') + '"'

function 内置命令(文本文件, 输出, 音色) {
  if (process.platform !== 'win32') return ''
  const 加音色 = 音色 ? ' -Voice ' + 引(音色) : ''
  return 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File ' + 引(内置脚本)
    + ' -TextFile ' + 引(文本文件) + ' -Out ' + 引(输出) + 加音色
}

/**
 * 文字 → 语音文件。
 * @returns {Promise<{ok: boolean, 文件?: string, 文本?: string, 字节?: number, 错?: string}>}
 */
export async function 合成语音(文字, { 配置 = {}, 家目录 } = {}) {
  let 念 = 洗语音文本(文字)
  if (!引擎支持标签(配置)) {
    念 = 念.replace(/\((?:laughs|chuckle|coughs|clear-throat|groans|breath|pant|inhale|exhale|gasps|sniffs|sighs|snorts|burps|lip-smacking|humming|hissing|emm|sneezes)\)/giu, ' ').replace(/\s+/gu, ' ').trim()
  }
  if (!念) return { ok: false, 错: '没有可念的字' }
  if (!家目录) return { ok: false, 错: '没有家目录' }

  const 最长 = 数(配置.语音最长字, 200, 10, 2000)
  const 全部 = Array.from(念)
  const 文 = 全部.slice(0, 最长).join('')
  const 截断 = 全部.length > 最长
  const 目录 = join(家目录, 'qq-rooms-voice')
  try {
    mkdirSync(目录, { recursive: true })
  } catch {
    return { ok: false, 错: '建不了音频目录：' + 目录 }
  }
  清旧文件(目录)

  const 名 = 'tts-' + Date.now() + '-' + randomUUID().slice(0, 8)
  const 文本文件 = join(目录, 名 + '.txt')
  const 输出 = join(目录, 名 + '.wav')
  try {
    writeFileSync(文本文件, 文, 'utf8')
  } catch {
    return { ok: false, 错: '写不了文字文件' }
  }

  const 模板 = 构建语音命令(配置)
  let 命令 = ''
  if (模板) {
    命令 = 模板
      .replace(/\{text\}/gu, 文本文件)
      .replace(/\{out\}/gu, 输出)
      .replace(/\{voice\}/gu, String(配置.语音音色 || '').trim())
      .replace(/\{emotion\}/gu, String(配置.语音情绪 || '').trim())
  } else {
    const 引擎 = 引擎id(配置)
    if (引擎 === 'custom') return { ok: false, 错: '自定义 TTS 引擎没填命令（高级 → 命令覆盖）' }
    if (引擎 !== 'sapi') return { ok: false, 错: `${引擎} 引擎没生成可用的合成命令` }
    if (process.platform !== 'win32') {
      return { ok: false, 错: '内置朗读只支持 Windows；请换引擎或填命令覆盖' }
    }
    if (!existsSync(内置脚本)) return { ok: false, 错: '内置朗读脚本不在：' + 内置脚本 }
    命令 = 内置命令(文本文件, 输出, String(配置.语音音色 || '').trim())
  }

  const 结果 = await 跑命令(命令, 配置.语音超时秒)
  if (!结果.ok) return { ok: false, 错: 结果.错 || '合成失败' }

  let 字节 = 0
  try { 字节 = statSync(输出).size } catch { 字节 = 0 }
  if (!字节) return { ok: false, 错: '命令跑完了但没生成音频（检查 {out}）' }
  return { ok: true, 文件: 输出, 文本: 文, 字节, 截断 }
}

/** OneBot `record` 消息段：file:/// 本地路径 —— SnowLuma/NapCat 会自己转 silk。 */
export function 语音段(文件) {
  const 路径 = String(文件 || '').replace(/\\/gu, '/')
  const 前缀 = 路径.startsWith('/') ? 'file://' : 'file:///'
  return { type: 'record', data: { file: 前缀 + 路径 } }
}
