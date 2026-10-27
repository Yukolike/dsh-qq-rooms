// dsh-qq-rooms · 策略（谁能进来、指令怎么认、群里算不算点名）
//
// 这一层是纯函数：不读盘、不碰网络、不碰 agent。所有「要不要接」的判断都在这里，
// 方便单测，也方便以后加「成员白名单」「按群速率限制」而不动传输层。

/** QQ 号 / 群号的统一校验：4–12 位纯数字。 */
export const 是号 = (v) => /^\d{4,12}$/u.test(String(v ?? '').trim())

/** 聊天键：私聊:1234567 / 群:123456789。非法 → ''。 */
export function 聊天键(类型, 号码) {
  const 类 = 类型 === '群' ? '群' : 类型 === '私聊' ? '私聊' : ''
  const 号 = String(号码 ?? '').trim()
  return 类 && 是号(号) ? 类 + ':' + 号 : ''
}

/** 把人从聊天键里拆回来：{ 类型, 号码 }。 */
export function 拆聊天键(键) {
  const m = /^(私聊|群):(\d{4,12})$/u.exec(String(键 || ''))
  return m ? { 类型: m[1], 号码: m[2] } : null
}

/** 是否在黑名单（拒绝过的人：静默丢弃，不再问主人）。 */
export function 已拉黑(配置, 号) {
  return Boolean((配置.黑名单 || {})[String(号)])
}

/** 访客许可是否仍有效（准到 = 0 表示长期）。 */
export function 已许可(配置, 号, 现在 = Date.now()) {
  const 行 = (配置.访客 || {})[String(号)]
  if (!行) return false
  return !行.准到 || Number(行.准到) > 现在
}

/** 群此刻的接入状态。 */
export function 群状态(配置, 群号, 现在 = Date.now()) {
  const 行 = (配置.群 || {})[String(群号)]
  if (!行) return { 接: false, 原因: '未加入' }
  if (行.enabled === false) return { 接: false, 原因: '已关闭' }
  if (Number(行.muteUntil) > 现在) return { 接: false, 原因: '静音中' }
  return { 接: true, 模式: 行.mode === 'all' ? 'all' : 'mention' }
}

/** 群成员名单判定：deny 优先于 allow；空 allow = 不限制。 */
export function 成员放行(群行, 号) {
  const 名单 = (群行 && 群行.members) || {}
  const deny = Array.isArray(名单.deny) ? 名单.deny : []
  const allow = Array.isArray(名单.allow) ? 名单.allow : []
  const 号文 = String(号)
  if (deny.includes(号文)) return false
  return allow.length === 0 || allow.includes(号文)
}

/**
 * 一条入站消息该往哪走。
 * @returns {{action: 'drop'|'askOwner'|'deliver', 原因: string, 模式?: 'mention'|'all'}}
 */
export function 判定入站({ 类型, 号码, 发送者, 配置, 点名 = false, 现在 = Date.now() }) {
  const 号 = String(号码 ?? '')
  if (!是号(号)) return { action: 'drop', 原因: '非法号码' }

  if (类型 === '私聊') {
    if (String(配置.主人) === 号) return { action: 'deliver', 原因: '主人' }
    if (已拉黑(配置, 号)) return { action: 'drop', 原因: '黑名单' }
    if (已许可(配置, 号, 现在)) return { action: 'deliver', 原因: '白名单' }
    return { action: 'askOwner', 原因: '陌生人' }
  }

  if (类型 !== '群') return { action: 'drop', 原因: '未知类型' }

  const 状态 = 群状态(配置, 号, 现在)
  if (!状态.接) return { action: 'drop', 原因: 状态.原因 }

  const 群行 = 配置.群[号]
  if (发送者 !== undefined && !成员放行(群行, 发送者)) {
    return { action: 'drop', 原因: '成员名单' }
  }

  // 主人在群里说话：无视模式，直接进（主人不需要先 @ 自己）
  if (String(配置.主人) === String(发送者)) {
    return { action: 'deliver', 原因: '主人在群', 模式: 状态.模式 }
  }

  if (状态.模式 === 'mention' && !点名) {
    return { action: 'drop', 原因: '未点名' }
  }
  return { action: 'deliver', 原因: 状态.模式 === 'all' ? '群全接' : '群点名', 模式: 状态.模式 }
}

/* ------------------------------------------------------------------
 * 主人指令
 * 只在「主人私聊」里解析，且必须整条消息匹配（去尾标点），避免日常聊天误吃。
 * ------------------------------------------------------------------ */

const 同意词 = new Set(['同意', '批准', '接'])
const 拒绝词 = new Set(['拒绝', '不理', '别理', '拉黑'])

const 尾标点 = /[\s!！。.~～?？,，、]+$/u
const 去掉包装 = (s) => String(s ?? '').trim().replace(尾标点, '')

/**
 * 解析一条可能是指令的消息。
 * @returns {null | {kind:'approve'|'deny', 号码:string}
 *                | {kind:'joinGroup', 群号:string, 模式:'mention'|'all'}
 *                | {kind:'leaveGroup', 群号:string}
 *                | {kind:'muteGroup', 群号:string, 分钟:number}
 *                | {kind:'unmuteGroup', 群号:string}
 *                | {kind:'list'} | {kind:'reset', 键:string} | {kind:'status'}}
 */
export function 解析指令(文字) {
  const s = 去掉包装(文字)
  if (!s) return null

  // 接群 123456789 [mention|all]
  let m = /^(接群|加群)\s*[:：]?\s*(\d{4,12})\s*(mention|all)?$/iu.exec(s)
  if (m) {
    return { kind: 'joinGroup', 群号: m[2], 模式: m[3] === 'all' ? 'all' : 'mention' }
  }

  // 退群 123456789
  m = /^(退群|移出群)\s*[:：]?\s*(\d{4,12})$/iu.exec(s)
  if (m) return { kind: 'leaveGroup', 群号: m[2] }

  // 静音 123456789 30 / 静音 123456789 2小时 / 取消静音 123456789
  m = /^静音\s*[:：]?\s*(\d{4,12})\s*(\d+)?\s*(分钟|分|小时|时|h|m)?$/iu.exec(s)
  if (m) {
    const 原始 = Number(m[2] || 30)
    const 单位 = String(m[3] || '').toLowerCase()
    const 分钟 = 单位 === '小时' || 单位 === '时' || 单位 === 'h' ? 原始 * 60 : 原始
    return { kind: 'muteGroup', 群号: m[1], 分钟: Math.max(1, Math.min(分钟, 30 * 24 * 60)) }
  }
  m = /^(取消静音|解除静音)\s*[:：]?\s*(\d{4,12})$/iu.exec(s)
  if (m) return { kind: 'unmuteGroup', 群号: m[2] }

  // 同意 / 拒绝 [号]  —— 允许「接」这种单字，但必须整条匹配
  m = /^(同意|批准|接|拒绝|不理|别理|拉黑)\s*[:：]?\s*(\d{4,12})?$/u.exec(s)
  if (m) {
    const 词 = m[1]
    return { kind: 同意词.has(词) ? 'approve' : 'deny', 号码: m[2] || '' }
  }

  // 解除拉黑 / 直接放行
  m = /^(解除|解封|放出)\s*[:：]?\s*(\d{4,12})$/u.exec(s)
  if (m) return { kind: 'unblock', 号码: m[2] }

  m = /^(放行|加白|白名单)\s*[:：]?\s*(\d{4,12})$/u.exec(s)
  if (m) return { kind: 'allow', 号码: m[2] }

  if (s === '房间' || s === '列表') return { kind: 'list' }
  if (s === '状态') return { kind: 'status' }

  m = /^重置\s*[:：]?\s*((?:私聊|群):\d{4,12})$/u.exec(s)
  if (m) return { kind: 'reset', 键: m[1] }

  return null
}

/**
 * 只有「主人 + 私聊 + 整条匹配」才把消息当指令。
 * @returns {null | ReturnType<typeof 解析指令>}
 */
export function 主人指令({ 文字, 发送者, 类型, 配置 }) {
  if (类型 !== '私聊') return null
  if (String(发送者) !== String(配置.主人 || '')) return null
  if (!配置.主人) return null
  return 解析指令(文字)
}

/* ------------------------------------------------------------------
 * 点名判定（群）
 * ------------------------------------------------------------------ */

/**
 * 从 OneBot 消息段里判断「这条是不是冲我来的」。
 * @param {Array} 段们 message 数组
 * @param {{ 自己号?: string, 己方消息?: Set<string>|string[], 名字?: string[], 听名字?: boolean }} 选项
 */
export function 点名判定(段们, 选项 = {}) {
  const 自己 = String(选项.自己号 || '')
  const 己方 = 选项.己方消息 instanceof Set ? 选项.己方消息 : new Set(选项.己方消息 || [])
  const 名字们 = (选项.名字 || []).map((x) => String(x)).filter(Boolean)
  const 听名字 = Boolean(选项.听名字)

  if (!Array.isArray(段们)) return false

  for (const 段 of 段们) {
    if (!段 || typeof 段 !== 'object') continue
    const 型 = String(段.type || '')
    const 数据 = 段.data || {}

    if (型 === 'at') {
      // at all（qq = 'all'）不算点名
      if (自己 && String(数据.qq) === 自己) return true
      continue
    }

    if (型 === 'reply') {
      const 被引 = String(数据.id ?? '')
      if (被引 && 己方.has(被引)) return true
      continue
    }

    if (型 === 'text' && 听名字 && 名字们.length) {
      const 文 = String(数据.text || '')
      if (名字们.some((名) => 文.includes(名))) return true
    }
  }

  return false
}
