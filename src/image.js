// dsh-qq-rooms · 生图（MiniMax image-01）
//
// 只负责「提示词 → 本地图片」；发送由 host 走现有的 OneBot 发图管道。
// key 读 ~/.dsh/minimax-api-key.txt（或 MINIMAX_API_KEY），不写进设置页。

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const 生图尺寸们 = ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9']
const 默认主机 = 'https://api.minimaxi.com'

const 数 = (v, 兜, 低, 高) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return 兜
  return Math.max(低, Math.min(Math.round(n), 高))
}

/** 提示词清洗：去首尾空白，最长 1500（MiniMax 的上限）。 */
export function 洗生图提示(文字) {
  return String(文字 || '').replace(/\s+/gu, ' ').trim().slice(0, 1500)
}

export function 选尺寸(值) {
  return 生图尺寸们.includes(String(值)) ? String(值) : '1:1'
}

/** 从环境变量 / DSH 家目录读 MiniMax key。 */
export function 读MiniMaxKey(家目录) {
  const env = String(process.env.MINIMAX_API_KEY || '').trim()
  if (env) return env
  const 候选 = [
    家目录 ? join(家目录, 'minimax-api-key.txt') : '',
    join(homedir(), '.dsh', 'minimax-api-key.txt'),
  ].filter(Boolean)
  for (const p of 候选) {
    try {
      const k = readFileSync(p, 'utf8').trim()
      if (k) return k
    } catch {
      /* 试下一个 */
    }
  }
  return ''
}

function 错话(码, 原话) {
  const 表 = {
    1002: 'MiniMax 限流了，等一会儿再试',
    1004: 'MiniMax 鉴权失败（key 不对）',
    1008: 'MiniMax 余额不足',
    1026: '提示词被 MiniMax 审核拦了',
    2013: 'MiniMax 参数不对',
    2049: 'MiniMax API key 无效',
  }
  const 说 = 表[Number(码)]
  return 说 ? 说 + (原话 ? `（${原话}）` : '') : `MiniMax ${码}：${原话 || '未知错误'}`
}

/** 清掉 7 天前的旧图，避免目录无限涨。 */
function 清旧图(目录) {
  try {
    const 线 = Date.now() - 7 * 24 * 3600 * 1000
    for (const 名 of readdirSync(目录)) {
      const p = join(目录, 名)
      try {
        const st = statSync(p)
        if (st.isFile() && st.mtimeMs < 线) unlinkSync(p)
      } catch {
        /* 删不掉就算了 */
      }
    }
  } catch {
    /* 目录不存在 */
  }
}

/**
 * 文字 → 图片文件。
 * @returns {Promise<{ok: boolean, 文件?: string, 字节?: number, 错?: string}>}
 */
export async function 生成图片(提示词, { 配置 = {}, 家目录 } = {}) {
  const 提示 = 洗生图提示(提示词)
  if (!提示) return { ok: false, 错: '提示词是空的' }
  if (!家目录) return { ok: false, 错: '没有家目录' }

  const key = 读MiniMaxKey(家目录)
  if (!key) return { ok: false, 错: '没有 MiniMax key（~/.dsh/minimax-api-key.txt）' }

  const 主机 = String(process.env.MINIMAX_API_HOST || 默认主机).replace(/\/+$/u, '')
  const 模型 = String(配置.生图模型 || 'image-01').trim() === 'image-01-live' ? 'image-01-live' : 'image-01'
  const 尺寸 = 选尺寸(配置.生图尺寸)
  const 超时 = 数(配置.生图超时秒, 180, 30, 300)

  let 响 = null
  try {
    响 = await fetch(主机 + '/v1/image_generation', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: 模型,
        prompt: 提示,
        aspect_ratio: 尺寸,
        response_format: 'base64',
        n: 1,
        prompt_optimizer: true,
        aigc_watermark: false,
      }),
      signal: AbortSignal.timeout(超时 * 1000),
    })
  } catch (error) {
    const 名 = String((error && error.name) || '')
    if (名 === 'TimeoutError' || 名 === 'AbortError') return { ok: false, 错: `MiniMax ${超时} 秒没回` }
    return { ok: false, 错: '连不上 MiniMax：' + String((error && error.message) || error) }
  }

  let 数据 = null
  try {
    数据 = await 响.json()
  } catch {
    return { ok: false, 错: 'MiniMax 回的看不懂（不是 JSON）' }
  }
  const 底 = 数据 && 数据.base_resp
  if (!响.ok || !底 || Number(底.status_code) !== 0) {
    return { ok: false, 错: 错话(底 && 底.status_code, 底 && 底.status_msg) }
  }

  let 字节 = null
  const b64 = 数据 && 数据.data && Array.isArray(数据.data.image_base64) ? 数据.data.image_base64[0] : ''
  if (b64) {
    try {
      字节 = Buffer.from(String(b64).replace(/^data:[^,]*,/u, ''), 'base64')
    } catch {
      字节 = null
    }
  }
  if (!字节 && 数据 && 数据.data && Array.isArray(数据.data.image_urls) && 数据.data.image_urls[0]) {
    try {
      const 图响 = await fetch(数据.data.image_urls[0], { signal: AbortSignal.timeout(超时 * 1000) })
      if (图响.ok) 字节 = Buffer.from(await 图响.arrayBuffer())
    } catch {
      字节 = null
    }
  }
  if (!字节 || !字节.length) return { ok: false, 错: 'MiniMax 没返回图片' }

  const 目录 = join(家目录, 'qq-rooms-images')
  try {
    mkdirSync(目录, { recursive: true })
  } catch {
    return { ok: false, 错: '建不了图片目录' }
  }
  清旧图(目录)
  const 文件 = join(目录, 'draw-' + Date.now() + '-' + randomUUID().slice(0, 8) + '.jpg')
  try {
    writeFileSync(文件, 字节)
  } catch {
    return { ok: false, 错: '写不了图片文件' }
  }
  if (!existsSync(文件)) return { ok: false, 错: '图片文件没落盘' }
  return { ok: true, 文件, 字节: 字节.length }
}
