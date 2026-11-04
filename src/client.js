// dsh-qq-rooms · 网页半边
//
// 设置 → 通到 QQ（房间）：总览 / 访客 / 群 / 房间。
// 这里不碰会话、不发消息，只读写宿主那几条 /dsh-qq-rooms/* 路由。

window.__ModuleLoader__.load({
  id: 'dsh-qq-rooms',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const inject = ['slots']
    const h = React.createElement

    const B = '/dsh-qq-rooms'
    const get = (p) => fetch(B + p, { cache: 'no-store' }).then((r) => r.json()).catch(() => null)
    const post = (p, body) =>
      fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
        .then((r) => r.json())
        .catch(() => null)

    /* ── 设计 token：全部走宿主主题变量，带暗色兜底 ── */
    const 主色 = 'var(--dsw-alias-state-business-primary, #4c8dff)'
    const 主按钮底 = 'var(--dsw-alias-state-business-primary, #2f6feb)'
    const 边框 = 'var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l2, rgba(127,127,127,.24)))'
    const 细边 = 'var(--dsw-alias-separator-primary, var(--dsw-alias-border-l1, rgba(127,127,127,.14)))'
    const 卡底 = 'var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06)))'
    const 弹层底 = 'var(--dsw-alias-bg-layer-3, #2b2b2b)'
    const 正文 = 'var(--dsw-alias-label-primary, inherit)'
    const 次文 = 'var(--dsw-alias-label-secondary, var(--dsw-alias-label-tertiary, rgba(127,127,127,.9)))'
    const 红 = 'var(--dsw-alias-state-error-primary, #e56767)'
    const 橙 = 'var(--dsw-alias-state-warn-primary, #e8a33d)'

    /** 原生 select 的弹出层不继承页面配色，必须给 option 显式底色，否则暗色主题下白底白字。 */
    const 选项样式 = { background: 弹层底, color: 正文 }

    /** 状态还没回来时的 MiniMax 兜底列表。 */
    const 兜底音色 = [
      ['Chinese (Mandarin)_Warm_Bestie', 'Warm Bestie（温暖闺蜜）'],
      ['Chinese (Mandarin)_Warm_Girl', 'Warm Girl（温暖少女）'],
      ['Chinese (Mandarin)_Crisp_Girl', 'Crisp Girl（清脆少女）'],
      ['Chinese (Mandarin)_Sweet_Lady', 'Sweet Lady（甜美女声）'],
      ['Chinese (Mandarin)_Soft_Girl', 'Soft Girl（柔和少女）'],
      ['Chinese (Mandarin)_Gentle_Senior', 'Gentle Senior（温柔学姐）'],
      ['Chinese (Mandarin)_Wise_Women', 'Wise Women（阅历姐姐）'],
      ['Chinese (Mandarin)_Mature_Woman', 'Mature Woman（傲娇御姐）'],
      ['Chinese (Mandarin)_HK_Flight_Attendant', 'HK Flight Attendant（港普空姐）'],
      ['Arrogant_Miss', 'Arrogant Miss（嚣张小姐）'],
      ['Chinese (Mandarin)_News_Anchor', 'News Anchor（新闻女声）'],
      ['Chinese (Mandarin)_Reliable_Executive', 'Reliable Executive（沉稳高管）'],
      ['Chinese (Mandarin)_Kind-hearted_Antie', 'Kind-hearted Antie（热心大婶）'],
      ['Chinese (Mandarin)_Cute_Spirit', 'Cute Spirit（憨憨萌兽）'],
      ['Chinese (Mandarin)_Laid_BackGirl', 'Laid Back Girl（松弛）'],
      ['female-shaonv', 'female-shaonv（少女音色）'],
      ['female-yujie', 'female-yujie（御姐音色）'],
      ['female-chengshu', 'female-chengshu（成熟女性）'],
      ['female-tianmei', 'female-tianmei（甜美女性）'],
      ['qiaopi_mengmei', 'qiaopi_mengmei（俏皮萌妹）'],
      ['wumei_yujie', 'wumei_yujie（妩媚御姐）'],
      ['diadia_xuemei', 'diadia_xuemei（嗲嗲学妹）'],
      ['danya_xuejie', 'danya_xuejie（淡雅学姐）'],
      ['tianxin_xiaoling', 'tianxin_xiaoling（甜心小玲）'],
    ]

    const 调色 = (调) => {
      if (调 === 'ok') return { 底: `color-mix(in srgb, ${主色} 16%, transparent)`, 字: 主色 }
      if (调 === 'warn') return { 底: `color-mix(in srgb, ${橙} 18%, transparent)`, 字: 橙 }
      if (调 === 'bad') return { 底: `color-mix(in srgb, ${红} 18%, transparent)`, 字: 红 }
      return { 底: 'rgba(127,127,127,.14)', 字: 次文 }
    }

    const S = {
      页: { maxWidth: 1060, margin: '0 auto', padding: '10px 14px 22px', fontSize: 12.5, lineHeight: 1.55, color: 正文 },

      头: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 },
      标题: { fontSize: 17, fontWeight: 700, letterSpacing: '.01em' },
      副题: { marginTop: 2, fontSize: 12, color: 次文, maxWidth: 560 },
      徽们: { display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', paddingTop: 2 },
      徽: (调) => {
        const c = 调色(调)
        return {
          display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 999,
          fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', background: c.底, color: c.字,
        }
      },

      页签条: { display: 'inline-flex', gap: 2, padding: 2, borderRadius: 10, background: 'rgba(127,127,127,.10)', border: `1px solid ${细边}` },
      页签: (开) => ({
        border: 0, borderRadius: 7, padding: '4px 11px', cursor: 'pointer', fontSize: 12, color: 开 ? 正文 : 次文,
        fontWeight: 开 ? 600 : 400, background: 开 ? 卡底 : 'transparent',
        boxShadow: 开 ? '0 1px 2px rgba(0,0,0,.14)' : 'none', display: 'inline-flex', alignItems: 'center', gap: 5,
      }),
      页数: (开) => ({ fontSize: 10.5, opacity: 开 ? 0.7 : 0.45, fontVariantNumeric: 'tabular-nums' }),

      卡: { border: `1px solid ${细边}`, borderRadius: 11, background: 卡底, marginBottom: 9, overflow: 'hidden' },
      卡头: { padding: '8px 12px 6px', borderBottom: `1px solid ${细边}` },
      卡题: { fontSize: 13.5, fontWeight: 650, color: 正文 },
      卡注: { marginTop: 1, fontSize: 11, color: 次文 },
      卡体: { padding: '0 12px 6px' },

      行: { display: 'flex', gap: 10, alignItems: 'center', padding: '4px 0', flexWrap: 'wrap' },
      标: { flex: '0 0 150px', minWidth: 120, paddingTop: 0, fontSize: 12, fontWeight: 500, color: 正文 },
      注: { marginTop: 1, fontSize: 10.8, color: 次文, fontWeight: 400, lineHeight: 1.4 },
      控: { flex: '1 1 200px', minWidth: 150, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },

      输入: {
        border: `1px solid ${边框}`, borderRadius: 7, padding: '4px 8px', background: 'transparent',
        color: 正文, fontSize: 12, width: '100%', boxSizing: 'border-box', outline: 'none',
      },
      小: { width: 130 },
      窄: { width: 110 },

      开关: (开) => ({
        width: 38, height: 22, padding: 0, border: 0, borderRadius: 999, cursor: 'pointer', position: 'relative',
        background: 开 ? 主色 : 'rgba(127,127,127,.34)', transition: 'background .15s',
      }),
      开关圆: (开) => ({
        position: 'absolute', top: 3, left: 开 ? 19 : 3, width: 16, height: 16, borderRadius: '50%',
        background: 'var(--dsw-alias-switch-thumb, #fff)', boxShadow: '0 1px 2px rgba(0,0,0,.28)', transition: 'left .15s',
      }),

      按钮: (种) => {
        const 填 = 种 === 'primary'
        return {
          border: `1px solid ${填 ? 主按钮底 : 边框}`, borderRadius: 7, padding: '4px 10px', cursor: 'pointer',
          fontSize: 12, fontWeight: 500, background: 填 ? 主按钮底 : 'transparent', color: 填 ? '#fff' : 正文,
        }
      },
      危险: { border: `1px solid color-mix(in srgb, ${红} 45%, transparent)`, color: 红, background: 'transparent' },

      条目: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderTop: `1px solid ${细边}`, flexWrap: 'wrap' },
      条目首: { borderTop: 'none', paddingTop: 3 },
      条目主: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
      条目名: { display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
      等宽: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11, color: 次文 },
      空: { padding: '8px 2px', fontSize: 12, color: 次文 },

      告警: {
        border: `1px solid color-mix(in srgb, ${红} 45%, transparent)`,
        background: `color-mix(in srgb, ${红} 10%, transparent)`,
        borderRadius: 10, padding: '8px 12px', marginBottom: 9, fontSize: 12,
      },

      悬浮: {
        position: 'sticky', bottom: 10, marginTop: 5, display: 'flex', alignItems: 'center', gap: 10,
        flexWrap: 'wrap', padding: '8px 12px', borderRadius: 10, border: `1px solid ${边框}`,
        background: 卡底, backdropFilter: 'blur(10px)', boxShadow: '0 10px 28px rgba(0,0,0,.18)',
      },
      跳: {
        border: `1px solid ${细边}`, borderRadius: 999, padding: '2px 9px', background: 'transparent',
        color: 次文, fontSize: 11.5, cursor: 'pointer',
      },
    }

    /* ── 原子组件 ── */

    const 行 = (标, 提示, 控件) =>
      h(
        'div',
        { style: S.行 },
        h('div', { style: S.标 }, 标, 提示 ? h('div', { style: S.注 }, 提示) : null),
        h('div', { style: S.控 }, 控件),
      )

    const 卡 = (题, 注, 孩子们, 键) =>
      h(
        'section',
        { style: S.卡, 'data-qq-card': 键 || undefined },
        h('div', { style: S.卡头 }, h('div', { style: S.卡题 }, 题), 注 ? h('div', { style: S.卡注 }, 注) : null),
        h('div', { style: S.卡体 }, 孩子们),
      )

    const 开关 = (值, 变更, 标) => {
      const 开 = Boolean(值)
      return h(
        'button',
        {
          type: 'button', role: 'switch', 'aria-checked': 开, 'aria-label': 标, 'data-on': 开,
          onClick: () => 变更(!开), style: S.开关(开),
        },
        h('span', { style: S.开关圆(开) }),
      )
    }

    const 输入 = (值, 变更, 占位, 类型) =>
      h('input', {
        style: S.输入,
        type: 类型 || 'text',
        value: 值 === undefined || 值 === null ? '' : String(值),
        placeholder: 占位 || '',
        onChange: (e) => 变更(e.target.value),
      })

    const 选 = (值, 选项, 变更, 标) =>
      h(
        'select',
        { style: { ...S.输入, ...S.小 }, value: 值, onChange: (e) => 变更(e.target.value), 'aria-label': 标 },
        ...选项.map(([v, 名]) => h('option', { key: v, value: v, style: 选项样式 }, 名)),
      )

    const 按钮 = (文, 点, 种, 附加) =>
      h(
        'button',
        {
          type: 'button', disabled: Boolean(附加 && 附加.关), onClick: 点,
          style: { ...S.按钮(种), ...(种 === 'danger' ? S.危险 : null), ...(附加 && 附加.关 ? { opacity: 0.55, cursor: 'default' } : null) },
        },
        文,
      )

    const 徽 = (文, 调) => h('span', { style: S.徽(调) }, 文)

    function Section() {
      const [态, 设态] = React.useState(null)
      const [页, 设页] = React.useState('总览')
      const [忙, 设忙] = React.useState(false)
      const [脏, 设脏] = React.useState(false)
      const [说, 设说] = React.useState('')
      const [新群, 设新群] = React.useState('')
      const [新群模式, 设新群模式] = React.useState('mention')
      const [新白, 设新白] = React.useState('')

      const 配置 = (态 && 态.配置) || {}
      const 群表 = 配置.群 || {}
      const 访客表 = 配置.访客 || {}
      const 黑名单表 = 配置.黑名单 || {}
      const 房间表 = (态 && 态.房间) || []
      const 待批 = (态 && 态.待批) || []
      const 语音元 = (态 && 态.语音 && 态.语音.引擎们) || {}
      const 当前引擎 = 配置.语音引擎 || 'minimax'
      const 当前引擎元 = 语音元[当前引擎] || { label: 当前引擎, defaultVoice: '', emotions: [], voices: [] }
      const 音色选项 = (当前引擎元.voices && 当前引擎元.voices.length)
        ? 当前引擎元.voices
        : (当前引擎 === 'minimax' ? 兜底音色 : [])
      const 当前引擎配置 = (配置.引擎配置 && 配置.引擎配置[当前引擎]) || {}
      const 引擎选项 = Object.keys(语音元).length
        ? Object.entries(语音元).map(([id, e]) => [id, e.label || id])
        : [[当前引擎, 当前引擎]]
      const 情绪名 = { '': '自动', happy: '开心', calm: '平静', sad: '难过', angry: '生气', surprised: '惊讶', whisper: '耳语' }
      const 情绪值 = (当前引擎元.emotions || []).includes(配置.语音情绪) ? 配置.语音情绪 : ''

      const 刷新 = async () => {
        const s = await get('/state')
        if (s) {
          设态(s)
          设脏(false)
        }
      }

      React.useEffect(() => {
        void 刷新()
      }, [])

      const 改 = (k, v) => {
        设态((旧) => (旧 ? { ...旧, 配置: { ...(旧.配置 || {}), [k]: v } } : 旧))
        设脏(true)
      }

      const 改引擎配置 = (id, k, v) => {
        设态((旧) => {
          if (!旧) return 旧
          const 旧配 = (旧.配置 && 旧.配置.引擎配置) || {}
          return {
            ...旧,
            配置: {
              ...(旧.配置 || {}),
              引擎配置: { ...旧配, [id]: { ...(旧配[id] || {}), [k]: v } },
            },
          }
        })
        设脏(true)
      }

      const 设音色 = (v) => {
        改('语音音色', v)
        改('引擎音色', { ...(配置.引擎音色 || {}), [当前引擎]: v })
      }

      const 换语音引擎 = (id) => {
        const 信息 = 语音元[id] || {}
        const 音 = (配置.引擎音色 && 配置.引擎音色[id]) || 信息.defaultVoice || ''
        改('语音引擎', id)
        改('语音音色', 音)
        改('引擎音色', { ...(配置.引擎音色 || {}), [id]: 音 })
        改('语音合成命令', '')
      }

      const 存 = async () => {
        设忙(true)
        const s = await post('/save', 配置)
        设忙(false)
        if (s && s.ok) {
          设态(s)
          设脏(false)
          设说('保存好了')
        } else {
          设说((s && s.说) || '保存失败')
        }
      }

      const 审批 = async (号, 允许) => {
        设忙(true)
        const r = await post('/approve', { 号, 允许 })
        设忙(false)
        设说((r && r.说) || '')
        await 刷新()
      }

      const 解除拉黑 = async (号) => {
        设忙(true)
        const r = await post('/unblock', { 号 })
        设忙(false)
        设说((r && r.说) || '')
        await 刷新()
      }

      const 房间操作 = async (键, 操作) => {
        设忙(true)
        await post('/room', { 键, 操作 })
        设忙(false)
        await 刷新()
      }

      const 加群 = () => {
        const 号 = 新群.trim()
        if (!/^\d{4,12}$/u.test(号)) {
          设说('群号要 4–12 位数字')
          return
        }
        改('群', {
          ...群表,
          [号]: { enabled: true, mode: 新群模式, addedAt: Date.now(), muteUntil: 0, members: { allow: [], deny: [] } },
        })
        设新群('')
        设说('已加入待保存（点下面的保存）')
      }

      const 删群 = (号) => {
        const 群 = { ...群表 }
        delete 群[号]
        改('群', 群)
      }

      const 切群模式 = (号, 模式) => 改('群', { ...群表, [号]: { ...群表[号], mode: 模式 } })

      const 静音 = (号, 分钟) => {
        const 到 = 分钟 > 0 ? Date.now() + 分钟 * 60 * 1000 : 0
        改('群', { ...群表, [号]: { ...群表[号], muteUntil: 到 } })
      }

      /** 单房工具档：空串 = 跟随全局默认。 */
      const 设房间工具 = (键, 值) => {
        const 表 = { ...(配置.房间工具 || {}) }
        if (值) 表[键] = 值
        else delete 表[键]
        改('房间工具', 表)
      }

      const 测试一句 = async () => {
        设忙(true)
        const r = await post('/test-send', {})
        设忙(false)
        设说((r && r.说) || '')
        await 刷新()
      }

      const 测试语音 = async () => {
        设忙(true)
        const r = await post('/test-voice', {})
        设忙(false)
        设说((r && r.说) || '')
        await 刷新()
      }

      const 跳卡 = (键, 名) =>
        h('button', {
          type: 'button', style: S.跳, onClick: () => {
            try {
              document.querySelector('[data-qq-card="' + 键 + '"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            } catch { /* 没有 document 就算了 */ }
          },
        }, 名)

      const 打开日志 = async () => {
        const r = await post('/logs', {})
        设说(r && r.目录 ? '日志目录：' + r.目录 : (r && r.说) || '打不开日志目录')
      }

      /** 手动拉一个人进白名单（后端会顺手查昵称）。 */
      const 加白名单 = async () => {
        const 号 = 新白.trim()
        if (!/^\d{4,12}$/u.test(号)) {
          设说('QQ 号要 4–12 位数字')
          return
        }
        设忙(true)
        const r = await post('/approve', { 号, 允许: true })
        设忙(false)
        设说((r && r.说) || '')
        设新白('')
        await 刷新()
      }

      const 连上了 = Boolean(态 && 态.NapCat && 态.NapCat.ok)

      /* ── 总览 ── */

      const 总览块 = h(
        'div',
        null,
        h(
          'div',
          { style: { display: 'flex', gap: 6, flexWrap: 'wrap', margin: '0 0 8px' } },
          跳卡('switches', '开关'),
          跳卡('identity', '身份'),
          跳卡('connection', '连接'),
          跳卡('rooms', '房间'),
          跳卡('voice', '语音'),
          跳卡('draw', '生图'),
        ),
        卡('开关', '两句都能随时改，保存即生效', [
          行('总开关', '关 = 一句都不发', 开关(配置.总开关, (v) => 改('总开关', v), '总开关')),
          行('试运行', '开 = 只记账，不真发到 QQ', 开关(配置.试运行, (v) => 改('试运行', v), '试运行')),
        ], 'switches'),
        卡('身份', '审批、加群、重置只认这个号的私聊', [
          行('主人 QQ 号', null, 输入(配置.主人, (v) => 改('主人', v), '例如 10001')),
          行('主人称呼', '群里按名字点名时用（默认关）', 输入(配置.主人称呼, (v) => 改('主人称呼', v), '主人')),
        ], 'identity'),
        卡('连接', 'OneBot 11：HTTP 收发 + WebSocket 事件', [
          行('NapCat 地址', '默认 127.0.0.1:3000', 输入(配置.NapCat, (v) => 改('NapCat', v), 'http://127.0.0.1:3000')),
          行(
            '接口令牌',
            '后端开了鉴权才填；******** = 已设置（原样保存不会覆盖），清空 = 删掉',
            输入(配置.令牌, (v) => 改('令牌', v), '可空'),
          ),
          行(
            '事件地址',
            'SnowLuma wsServers / NapCat 正向 WS；陌生私聊只能靠它发现',
            输入(配置.事件地址, (v) => 改('事件地址', v), 'ws://127.0.0.1:3001'),
          ),
          行('事件令牌', '可空；******** = 已设置', 输入(配置.事件令牌, (v) => 改('事件令牌', v), '')),
          行(
            '轮询间隔',
            '已知房间补漏（毫秒）；改完要重启 DSH',
            输入(配置.轮询间隔毫秒, (v) => 改('轮询间隔毫秒', Number(v) || 2000), '', 'number'),
          ),
        ], 'connection'),
        卡('房间', '新建房间时套用', [
          行('模型', 'provider/model', 输入(配置.模型, (v) => 改('模型', v), 'deepseek-account/deepseek-flash')),
          行('房间工作区', '留空 = ~/.dsh/qq-rooms；建议指到一个空目录', 输入(配置.房间工作区, (v) => 改('房间工作区', v), '可空')),
          行(
            '访客工具',
            '默认档；单间可在「房间」页单独覆盖',
            选(配置.访客工具 || 'none', [['none', '全禁（推荐）'], ['safe', '只留 todo'], ['standard', '不限制']], (v) => 改('访客工具', v), '访客工具'),
          ),
          行(
            '群工具',
            '群房默认档；群成员不可信，建议保持全禁',
            选(配置.群工具 || 'none', [['none', '全禁（推荐）'], ['safe', '只留 todo'], ['standard', '不限制']], (v) => 改('群工具', v), '群工具'),
          ),
          行('只发 [QQ] 块', '开 = 只发正文里 [QQ]…[/QQ] 中间那段', 开关(配置.只发标记内, (v) => 改('只发标记内', v), '只发标记内')),
          行('只回 QQ 唤醒的那一轮', '你在 DSH 里自己聊的不推到手机', 开关(配置.只回QQ唤醒, (v) => 改('只回QQ唤醒', v), '只回QQ唤醒')),
        ], 'rooms'),
        卡('语音回复（TTS）', '选引擎和音色；命令由插件生成，原始命令收在「高级」里', [
          行(
            '语音模式',
            '关 = 只发文字；随机 = 按概率；由她判断 = 她写 [语音] 才念；每条都念 = 全语音',
            选(配置.语音模式 || 'off', [['off', '关'], ['random', '随机'], ['mark', '由她判断（[语音]）'], ['all', '每条都念']], (v) => 改('语音模式', v), '语音模式'),
          ),
          行('随机概率', '随机模式下每条回复发语音的几率（0–100）', 输入(配置.语音概率, (v) => 改('语音概率', Number(v) || 0), '20', 'number')),
          行(
            '语音引擎',
            '切换引擎会清掉旧命令覆盖；音色跟着引擎走',
            选(当前引擎, 引擎选项, 换语音引擎, '语音引擎'),
          ),
          行(
            '音色',
            '当前引擎的音色；不在列表里的克隆音色直接填右边',
            h(
              'div',
              { style: { display: 'flex', gap: 8, flexWrap: 'wrap', width: '100%' } },
              选(
                音色选项.some(([v]) => v === 配置.语音音色) ? 配置.语音音色 : '',
                [['', '自定义 / 当前'], ...音色选项],
                (v) => { if (v) 设音色(v) },
                '音色预设',
              ),
              输入(配置.语音音色, (v) => 设音色(v), 当前引擎元.defaultVoice || 'voice ID'),
            ),
          ),
          ...(当前引擎元.emotions && 当前引擎元.emotions.length
            ? [行(
              '情绪',
              '自动通常最好；也可以强制开心 / 平静 / 耳语',
              选(
                情绪值,
                当前引擎元.emotions.map((v) => [v, 情绪名[v] || v]),
                (v) => 改('语音情绪', v),
                '语音情绪',
              ),
            )]
            : []),
          ...(当前引擎 === 'minimax'
            ? [
              行(
                '模型',
                'hd 更自然，turbo 更快',
                选(
                  当前引擎配置.model || 'speech-2.8-hd',
                  [['speech-2.8-hd', 'speech-2.8-hd'], ['speech-2.8-turbo', 'speech-2.8-turbo'], ['speech-2.6-hd', 'speech-2.6-hd'], ['speech-2.6-turbo', 'speech-2.6-turbo'], ['speech-02-hd', 'speech-02-hd']],
                  (v) => 改引擎配置('minimax', 'model', v),
                  '语音模型',
                ),
              ),
              行('语速', '0.5–2；1.0 是原速', 输入(当前引擎配置.speed ?? 1, (v) => 改引擎配置('minimax', 'speed', Number(v) || 1), '1.0', 'number')),
              行('音高', '-12–12；0 是原音高', 输入(当前引擎配置.pitch ?? 0, (v) => 改引擎配置('minimax', 'pitch', Number(v) || 0), '0', 'number')),
            ]
            : []),
          ...(当前引擎 === 'edge'
            ? [
              行('语速', 'edge 格式：+0%、+10%、-5%', 输入(当前引擎配置.rate || '+0%', (v) => 改引擎配置('edge', 'rate', v), '+0%')),
              行('音高', 'edge 格式：+0Hz、+20Hz', 输入(当前引擎配置.pitch || '+0Hz', (v) => 改引擎配置('edge', 'pitch', v), '+0Hz')),
            ]
            : []),
          ...(当前引擎 === 'custom'
            ? [行('自定义引擎', '在下方「高级」里填命令覆盖；普通引擎不用管', h('span', { style: S.等宽 }, '命令覆盖'))]
            : []),
          h('details', { style: { marginTop: 4 }, open: 当前引擎 === 'custom' },
            h('summary', { style: { cursor: 'pointer', padding: '8px 0', fontSize: 12.5, color: 次文 } }, '高级：命令覆盖 / 超时 / 长度'),
            行('命令覆盖', '非空时优先于引擎生成的命令；只给排错或自定义引擎用', 输入(配置.语音合成命令, (v) => 改('语音合成命令', v), '留空 = 用当前引擎生成')),
            ...(当前引擎 === 'minimax' || 当前引擎 === 'edge'
              ? [行('Python 路径', '一般不用改；默认 python', 输入(当前引擎配置.python || 'python', (v) => 改引擎配置(当前引擎, 'python', v), 'python'))]
              : []),
            行('最长字', '超过就截断，避免一条念太久（10–2000）', 输入(配置.语音最长字, (v) => 改('语音最长字', Number(v) || 200), '', 'number')),
            行('超时（秒）', '合成命令跑太久就杀掉，退回文字', 输入(配置.语音超时秒, (v) => 改('语音超时秒', Number(v) || 45), '', 'number')),
            行('语音附带文字', '开 = 语音条之外再发一遍文字', 开关(配置.语音附带文字, (v) => 改('语音附带文字', v), '语音附带文字')),
          ),
        ], 'voice'),
        卡('生图（MiniMax）', '只给主人私聊：在 QQ 里说“画一张…”，画好直接发到聊天', [
          行('生图开关', '关 = 模型看不到 qq_draw 工具', 开关(配置.生图, (v) => 改('生图', v), '生图')),
          行(
            '模型',
            'image-01 通用；image-01-live 偏漫画/元气/水彩',
            选(配置.生图模型 || 'image-01', [['image-01', 'image-01'], ['image-01-live', 'image-01-live']], (v) => 改('生图模型', v), '生图模型'),
          ),
          行(
            '默认尺寸',
            '模型没给比例时用这个',
            选(配置.生图尺寸 || '1:1', [['1:1', '1:1'], ['16:9', '16:9'], ['4:3', '4:3'], ['3:4', '3:4'], ['9:16', '9:16']], (v) => 改('生图尺寸', v), '生图尺寸'),
          ),
          行('提示前缀', '每条提示词前面自动加，比如“二次元插画，干净线条，”；可空', 输入(配置.生图提示前缀, (v) => 改('生图提示前缀', v), '可空')),
          行('每日上限', '0 = 不限制；按成功出图计数', 输入(配置.生图每日上限, (v) => 改('生图每日上限', Number(v) || 0), '', 'number')),
          行('超时（秒）', '出图最长等多久，默认 180', 输入(配置.生图超时秒, (v) => 改('生图超时秒', Number(v) || 180), '', 'number')),
        ], 'draw'),
      )

      /* ── 访客 ── */

      const 待批块 = 待批.length
        ? 待批.map((x) =>
          h(
            'div',
            { key: x.号, style: S.条目 },
            h(
              'div',
              { style: { ...S.条目主, flex: '1 1 260px' } },
              h('div', { style: S.条目名 }, h('b', null, x.昵称 || 'QQ ' + x.号), h('span', { style: S.等宽 }, x.号)),
              h('div', { style: { fontSize: 12, opacity: 0.72 } }, x.文字 || '（没字）'),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 8 } },
              按钮('同意', () => 审批(x.号, true), 'primary', { 关: 忙 }),
              按钮('拒绝', () => 审批(x.号, false), 'danger', { 关: 忙 }),
            ),
          ))
        : h('div', { style: S.空 }, '现在没有人在等。')

      const 许可块 = Object.keys(访客表).length
        ? Object.entries(访客表).map(([号, v], i) =>
          h(
            'div',
            { key: 号, style: { ...S.条目, ...(i === 0 ? S.条目首 : null) } },
            h(
              'div',
              { style: S.条目主 },
              h('div', { style: S.条目名 }, h('b', null, v.昵称 || 'QQ ' + 号), h('span', { style: S.等宽 }, 号)),
              h('div', { style: S.注 }, v.准到 ? '有效期到 ' + new Date(v.准到).toLocaleString() : '长期有效'),
            ),
            按钮('移出白名单', () => 审批(号, false), 'danger'),
          ))
        : h('div', { style: S.空 }, '还没有。')

      const 黑名单块 = Object.keys(黑名单表).length
        ? Object.entries(黑名单表).map(([号, v], i) =>
          h(
            'div',
            { key: 号, style: { ...S.条目, ...(i === 0 ? S.条目首 : null) } },
            h(
              'div',
              { style: S.条目主 },
              h('div', { style: S.条目名 }, h('b', null, 号)),
              h('div', { style: S.注 }, v && v.拒绝于 ? '拉黑于 ' + new Date(v.拒绝于).toLocaleDateString() : '已拉黑'),
            ),
            按钮('解除', () => 解除拉黑(号), 'ghost', { 关: 忙 }),
          ))
        : h('div', { style: S.空 }, '还没有。')

      const 访客块 = h(
        'div',
        null,
        卡('等你拍板', '同意 = 进白名单，以后直接聊；拒绝 = 进黑名单，以后不再问你', 待批块),
        卡('白名单', '这些号私聊直接进房，不再问你；也可以直接在这里加', [
          h(
            'div',
            { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '10px 0 8px', borderBottom: `1px solid ${细边}` } },
            h('div', { style: { flex: '1 1 200px', minWidth: 180 } }, 输入(新白, 设新白, 'QQ 号（4–12 位数字）')),
            按钮('加入白名单', 加白名单, 'primary', { 关: 忙 }),
          ),
          许可块,
        ]),
        卡('黑名单', '拒绝过的号再来直接丢弃，不会打扰你', 黑名单块),
      )

      /* ── 群 ── */

      const 群列表块 = Object.keys(群表).length
        ? Object.entries(群表).map(([号, v], i) =>
          h(
            'div',
            { key: 号, style: { ...S.条目, ...(i === 0 ? S.条目首 : null) } },
            h(
              'div',
              { style: S.条目主 },
              h(
                'div',
                { style: S.条目名 },
                h('b', null, v.名称 || '群 ' + 号),
                v.名称 ? h('span', { style: S.等宽 }, 号) : null,
                v.muteUntil > Date.now() ? 徽('静音中', 'warn') : null,
              ),
              h('div', { style: S.注 }, v.muteUntil > Date.now() ? '静音到 ' + new Date(v.muteUntil).toLocaleString() : '未静音'),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
              选(v.mode, [['mention', '只回点名'], ['all', '听所有人']], (m) => 切群模式(号, m), '群模式'),
              按钮('静音 2h', () => 静音(号, 120), 'ghost'),
              按钮('解除静音', () => 静音(号, 0), 'ghost'),
              按钮('移除', () => 删群(号), 'danger'),
            ),
          ))
        : h('div', { style: S.空 }, '还没有。')

      const 群块 = h(
        'div',
        null,
        卡('接一个群', '默认不接任何群；未加入的群消息一律丢弃，不会来问你', [
          h(
            'div',
            { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '4px 0 2px' } },
            h('div', { style: { flex: '1 1 200px', minWidth: 180 } }, 输入(新群, 设新群, '群号')),
            选(新群模式, [['mention', '只回点名'], ['all', '听所有人']], 设新群模式, '新群模式'),
            按钮('加入', 加群, 'primary'),
          ),
        ]),
        卡('已接入的群', null, 群列表块),
      )

      /* ── 房间 ── */

      const 房间块 = h(
        'div',
        null,
        卡('房间', '聊天里第一条消息会自动建房；改完工具档点保存就当场生效', 房间表.length
          ? 房间表.map((x, i) =>
            h(
              'div',
              { key: x.键, style: { ...S.条目, ...(i === 0 ? S.条目首 : null) } },
              h(
                'div',
                { style: S.条目主 },
                h(
                  'div',
                  { style: S.条目名 },
                  h('b', null, x.昵称 || x.键),
                  x.昵称 ? h('span', { style: S.等宽 }, x.键) : null,
                  徽(x.活着 ? '活着' : '睡着', x.活着 ? 'ok' : 'muted'),
                  x.归档 ? 徽('已归档 · 下条消息重建', 'warn') : null,
                ),
                h('div', { style: S.等宽 }, `${String(x.sessionId).slice(-8)}｜最近 ${x.lastAt ? new Date(x.lastAt).toLocaleString() : '—'}`),
              ),
              h(
                'div',
                { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                x.类型 === '群' || (x.类型 === '私聊' && x.号码 !== String(配置.主人))
                  ? h('div', { style: { width: 150 } }, 选(
                    (配置.房间工具 || {})[x.键] || '',
                    [
                      ['', `跟随默认（${(x.类型 === '群' ? 配置.群工具 : 配置.访客工具) || 'none'}）`],
                      ['none', '工具全禁'],
                      ['safe', '只留 todo'],
                      ['standard', '不限制'],
                    ],
                    (v) => 设房间工具(x.键, v),
                    '房间工具档',
                  ))
                  : null,
                按钮('重置上下文', () => 房间操作(x.键, 'reset'), 'danger', { 关: 忙 }),
              ),
            ))
          : h('div', { style: S.空 }, '还没有房间。聊天里第一条消息会自动建房。')),
      )

      const 内容 = 页 === '总览' ? 总览块 : 页 === '访客' ? 访客块 : 页 === '群' ? 群块 : 房间块

      const 页签们 = [
        ['总览', null],
        ['访客', 待批.length + Object.keys(访客表).length + Object.keys(黑名单表).length],
        ['群', Object.keys(群表).length],
        ['房间', 房间表.length],
      ]

      return h(
        'div',
        { style: S.页 },

        h(
          'div',
          { style: S.头 },
          h(
            'div',
            null,
            h('div', { style: S.标题 }, '通到 QQ'),
            h('div', { style: S.副题 }, '聊天即房间：私聊一人一间，群一群一间，不用再手动绑定会话。'),
          ),
          h(
            'div',
            { style: S.徽们 },
            徽('v' + (态 ? 态.版本 : '—'), 'muted'),
            徽(连上了 ? `● 已连接 ${(态.NapCat.号 || '')}` : '● 连不上 NapCat', 连上了 ? 'ok' : 'bad'),
            徽(配置.总开关 ? '总开关开' : '总开关关', 配置.总开关 ? 'ok' : 'muted'),
            配置.试运行 ? 徽('试运行', 'warn') : null,
          ),
        ),

        态 && 态.冲突
          ? h(
            'div',
            { style: S.告警 },
            h('b', { style: { color: 红 } }, '原版 dsh-qq-bridge 还开着'),
            h('div', { style: { opacity: 0.7, marginTop: 2 } }, '为避免双发，本插件已停用收发。把原版总开关关掉并重启 DSH。'),
          )
          : null,

        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 } },
          h(
            'div',
            { style: S.页签条 },
            ...页签们.map(([名, 数]) =>
              h(
                'button',
                { key: 名, type: 'button', style: S.页签(页 === 名), onClick: () => 设页(名) },
                名,
                数 != null ? h('span', { style: S.页数(页 === 名) }, String(数)) : null,
              )),
          ),
          徽(脏 ? '有改动未保存' : '已同步', 脏 ? 'warn' : 'ok'),
        ),

        内容,

        卡('操作', '测试会绕过总开关和试运行直接发 —— 确认主人号填对了再点；日志写在磁盘上，不再显示在页面里', [
          h(
            'div',
            { style: { display: 'flex', gap: 8, flexWrap: 'wrap', padding: '4px 0 2px' } },
            按钮('保存设置', 存, 'primary', { 关: 忙 }),
            按钮('测试一句（发给主人）', 测试一句, 'ghost', { 关: 忙 }),
            按钮('测试语音（发给主人）', 测试语音, 'ghost', { 关: 忙 }),
            按钮('打开日志目录', 打开日志, 'ghost', { 关: 忙 }),
            按钮('刷新', 刷新, 'ghost', { 关: 忙 }),
          ),
        ]),

        脏
          ? h(
            'div',
            { style: S.悬浮 },
            徽('有改动未保存', 'warn'),
            按钮('保存设置', 存, 'primary', { 关: 忙 }),
            说 ? h('span', { style: { fontSize: 12, opacity: 0.6 } }, 说) : null,
          )
          : 说
            ? h('div', { style: { fontSize: 12, color: 主色, padding: '2px 2px 0' } }, 说)
            : null,
      )
    }

    const apply = (ctx) => {
      const slots = ctx.slots
      slots.inject('settings.section', () =>
        slots.register(
          { name: 'settings.section', id: 'qq-rooms', order: 55, label: () => '通到 QQ' },
          Section,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
