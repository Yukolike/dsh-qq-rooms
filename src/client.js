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

    const S = {
      wrap: {
        padding: '12px 14px 24px',
        fontSize: 13,
        lineHeight: 1.7,
        background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,.92))',
        border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))',
        borderRadius: 12,
      },
      h: { fontSize: 14, fontWeight: 600, margin: '16px 0 8px' },
      dim: { opacity: 0.62, fontSize: 12 },
      card: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 8,
        padding: '10px 12px',
        marginBottom: 10,
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      row: { display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8, flexWrap: 'wrap' },
      lab: { minWidth: 190, paddingTop: 3, fontSize: 12.5 },
      ctl: { flex: '1 1 260px', minWidth: 220 },
      hint: { opacity: 0.6, fontSize: 11.5, marginTop: 2 },
      input: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '4px 8px',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
        width: '100%',
        boxSizing: 'border-box',
      },
      small: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '4px 8px',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
        width: 150,
        boxSizing: 'border-box',
      },
      tab: (开) => ({
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '3px 10px',
        cursor: 'pointer',
        fontSize: 12.5,
        background: 开 ? 'var(--dsw-alias-state-business-primary, #2f6feb)' : 'transparent',
        color: 开 ? '#fff' : 'inherit',
      }),
      btn: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '4px 10px',
        cursor: 'pointer',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
      },
      danger: { color: '#c0392b' },
      ok: { color: 'var(--dsw-alias-state-business-primary, #2f6feb)', fontSize: 12 },
      log: {
        fontFamily: 'ui-monospace, Consolas, monospace',
        fontSize: 11.5,
        maxHeight: 180,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        opacity: 0.85,
      },
      悬浮保存条: {
        position: 'sticky',
        bottom: 0,
        marginTop: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '8px 12px',
        borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,.95))',
      },
    }

    const 行 = (标, 提示, 控件) =>
      h(
        'div',
        { style: S.row },
        h('div', { style: S.lab }, h('div', null, 标), 提示 ? h('div', { style: S.hint }, 提示) : null),
        h('div', { style: S.ctl }, 控件),
      )

    const 开关 = (值, 变更, 标) =>
      h('input', { type: 'checkbox', checked: Boolean(值), onChange: (e) => 变更(e.target.checked), 'aria-label': 标 })

    const 输入 = (值, 变更, 占位, 类型) =>
      h('input', {
        style: S.input,
        type: 类型 || 'text',
        value: 值 === undefined || 值 === null ? '' : String(值),
        placeholder: 占位 || '',
        onChange: (e) => 变更(e.target.value),
      })

    function Section() {
      const [态, 设态] = React.useState(null)
      const [页, 设页] = React.useState('总览')
      const [忙, 设忙] = React.useState(false)
      const [脏, 设脏] = React.useState(false)
      const [说, 设说] = React.useState('')
      const [新群, 设新群] = React.useState('')
      const [新群模式, 设新群模式] = React.useState('mention')

      const 配置 = (态 && 态.配置) || {}
      const 群表 = 配置.群 || {}
      const 访客表 = 配置.访客 || {}
      const 黑名单表 = 配置.黑名单 || {}
      const 房间表 = (态 && 态.房间) || []
      const 待批 = (态 && 态.待批) || []
      const 日志 = (态 && 态.日志) || []

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

      /* ── 总览 ── */

      const 总览块 = h(
        'div',
        null,
        h(
          'div',
          { style: S.card },
          h('div', { style: S.h }, '开关'),
          行('总开关', '关 = 一句都不发', 开关(配置.总开关, (v) => 改('总开关', v), '总开关')),
          行('试运行', '开 = 只记账，不真发到 QQ', 开关(配置.试运行, (v) => 改('试运行', v), '试运行')),
          h('div', { style: S.h }, '主人'),
          行('主人 QQ 号', '审批、加群、重置只认这个号的私聊', 输入(配置.主人, (v) => 改('主人', v), '例如 10001')),
          行('主人称呼', '群里按名字点名时用（默认关）', 输入(配置.主人称呼, (v) => 改('主人称呼', v), '主人')),
        ),
        h(
          'div',
          { style: S.card },
          h('div', { style: S.h }, '连接'),
          行('NapCat 地址', 'OneBot 11 HTTP，默认 127.0.0.1:3000', 输入(配置.NapCat, (v) => 改('NapCat', v), 'http://127.0.0.1:3000')),
          行('接口令牌', '后端开了鉴权才填', 输入(配置.令牌, (v) => 改('令牌', v), '可空')),
          行('事件地址', 'WebSocket（SnowLuma wsServers / NapCat 正向 WS）；陌生私聊只能靠它发现', 输入(配置.事件地址, (v) => 改('事件地址', v), 'ws://127.0.0.1:3001')),
          行('事件令牌', '可空', 输入(配置.事件令牌, (v) => 改('事件令牌', v), '')),
          行('轮询间隔（毫秒）', '已知房间补漏；改完重启 DSH 生效', 输入(配置.轮询间隔毫秒, (v) => 改('轮询间隔毫秒', Number(v) || 2000), '', 'number')),
        ),
        h(
          'div',
          { style: S.card },
          h('div', { style: S.h }, '房间'),
          行('模型', 'provider/model', 输入(配置.模型, (v) => 改('模型', v), 'deepseek-account/deepseek-flash')),
          行('房间工作区', '留空 = ~/.dsh/qq-rooms；建议指到一个空目录', 输入(配置.房间工作区, (v) => 改('房间工作区', v), '可空')),
          行(
            '访客工具',
            'none = 全禁（默认）；safe = 只留 todo；standard = 不限制',
            h(
              'select',
              { style: { ...S.small, width: 170 }, value: 配置.访客工具 || 'none', onChange: (e) => 改('访客工具', e.target.value) },
              h('option', { value: 'none' }, '全禁（推荐）'),
              h('option', { value: 'safe' }, '只留 todo'),
              h('option', { value: 'standard' }, '不限制'),
            ),
          ),
          行('只发 [QQ] 块', '开 = 只发正文里 [QQ]…[/QQ] 中间那段', 开关(配置.只发标记内, (v) => 改('只发标记内', v), '只发标记内')),
          行('只回 QQ 唤醒的那一轮', '你在 DSH 里自己聊的不推到手机', 开关(配置.只回QQ唤醒, (v) => 改('只回QQ唤醒', v), '只回QQ唤醒')),
        ),
      )

      /* ── 访客 ── */

      const 待批块 = 待批.length
        ? 待批.map((x) =>
          h(
            'div',
            { key: x.号, style: { marginBottom: 8 } },
            h('div', null, `${x.昵称 || 'QQ ' + x.号}（${x.号}）：${x.文字 || '（没字）'}`),
            h(
              'div',
              { style: { display: 'flex', gap: 8, marginTop: 4 } },
              h('button', { style: S.btn, disabled: 忙, onClick: () => 审批(x.号, true) }, '同意'),
              h('button', { style: { ...S.btn, ...S.danger }, disabled: 忙, onClick: () => 审批(x.号, false) }, '拒绝'),
            ),
          ))
        : h('div', { style: S.dim }, '现在没有人在等。')

      const 许可块 = Object.keys(访客表).length
        ? Object.entries(访客表).map(([号, v]) =>
          h(
            'div',
            { key: 号, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 } },
            h('span', null, `${v.昵称 || 'QQ ' + 号}（${号}）${v.准到 ? ' 到 ' + new Date(v.准到).toLocaleString() : ' 长期'}`),
            h('button', { style: { ...S.btn, ...S.danger }, onClick: () => 审批(号, false) }, '移除'),
          ))
        : h('div', { style: S.dim }, '还没有。')

      const 黑名单块 = Object.keys(黑名单表).length
        ? Object.entries(黑名单表).map(([号, v]) =>
          h(
            'div',
            { key: 号, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 } },
            h('span', null, `${号}${v && v.拒绝于 ? ' · ' + new Date(v.拒绝于).toLocaleDateString() : ''}`),
            h('button', { style: S.btn, disabled: 忙, onClick: () => 解除拉黑(号) }, '解除'),
          ))
        : h('div', { style: S.dim }, '还没有。')

      const 访客块 = h(
        'div',
        null,
        h(
          'div',
          { style: S.card },
          h('div', { style: S.h }, '等你拍板'),
          h('div', { style: S.hint }, '同意 = 进白名单，以后直接聊；拒绝 = 进黑名单，以后不再问你。'),
          待批块,
        ),
        h(
          'div',
          { style: S.card },
          h('div', { style: S.h }, '白名单（直接聊，不用问）'),
          许可块,
        ),
        h(
          'div',
          { style: S.card },
          h('div', { style: S.h }, '黑名单（再来不问你）'),
          黑名单块,
        ),
      )

      /* ── 群 ── */

      const 群列表块 = Object.keys(群表).length
        ? Object.entries(群表).map(([号, v]) =>
          h(
            'div',
            { key: 号, style: { borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: 8, marginTop: 8 } },
            h(
              'div',
              { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              h('b', null, '群 ' + 号),
              h(
                'div',
                { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                h(
                  'select',
                  { style: { ...S.small, width: 120 }, value: v.mode, onChange: (e) => 切群模式(号, e.target.value) },
                  h('option', { value: 'mention' }, '只回点名'),
                  h('option', { value: 'all' }, '听所有人'),
                ),
                h('button', { style: S.btn, onClick: () => 静音(号, 120) }, '静音 2h'),
                h('button', { style: S.btn, onClick: () => 静音(号, 0) }, '解除静音'),
                h('button', { style: { ...S.btn, ...S.danger }, onClick: () => 删群(号) }, '移除'),
              ),
            ),
            h('div', { style: S.hint }, v.muteUntil > Date.now() ? '静音到 ' + new Date(v.muteUntil).toLocaleString() : '未静音'),
          ))
        : h('div', { style: S.dim }, '还没有。')

      const 群块 = h(
        'div',
        null,
        h(
          'div',
          { style: S.card },
          h('div', { style: S.h }, '接一个群'),
          h(
            'div',
            { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
            输入(新群, 设新群, '群号'),
            h(
              'select',
              { style: { ...S.small, width: 120 }, value: 新群模式, onChange: (e) => 设新群模式(e.target.value) },
              h('option', { value: 'mention' }, '只回点名'),
              h('option', { value: 'all' }, '听所有人'),
            ),
            h('button', { style: S.btn, onClick: 加群 }, '加入'),
          ),
          h('div', { style: S.hint }, '默认不接任何群；未加入的群消息一律丢弃，不会来问你。'),
        ),
        h('div', { style: S.card }, h('div', { style: S.h }, '已接入的群'), 群列表块),
      )

      /* ── 房间 ── */

      const 房间块 = h(
        'div',
        { style: S.card },
        h('div', { style: S.h }, '房间'),
        房间表.length
          ? 房间表.map((x) =>
            h(
              'div',
              { key: x.键, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: 8, marginTop: 8 } },
              h(
                'div',
                null,
                h('b', null, x.键),
                h('div', { style: S.hint }, `${x.活着 ? '活着' : '睡着'}｜${String(x.sessionId).slice(-8)}｜最近 ${x.lastAt ? new Date(x.lastAt).toLocaleString() : '—'}`),
              ),
              h('button', { style: { ...S.btn, ...S.danger }, disabled: 忙, onClick: () => 房间操作(x.键, 'reset') }, '重置上下文'),
            ))
          : h('div', { style: S.dim }, '还没有房间。聊天里第一条消息会自动建房。'),
      )

      const 内容 = 页 === '总览' ? 总览块 : 页 === '访客' ? 访客块 : 页 === '群' ? 群块 : 房间块
      const 页签 = ['总览', '访客', '群', '房间']

      return h(
        'div',
        { style: S.wrap },
        h('div', { style: { fontSize: 16, fontWeight: 700 } }, '通到 QQ · 房间'),
        h(
          'div',
          { style: S.dim },
          '聊天即房间：私聊一人一间，群一群一间，不用再手动绑定会话。'
          + (态 ? ` 版本 ${态.版本}｜主人 ${配置.主人 || '未设置'}｜` : '')
          + (态 && 态.NapCat && 态.NapCat.ok ? `✓ 连着的 QQ：${态.NapCat.号}` : '⚠ 连不上 NapCat'),
        ),
        态 && 态.冲突
          ? h(
            'div',
            { style: { ...S.card, borderColor: '#c0392b' } },
            h('b', { style: S.danger }, '⚠ 原版 dsh-qq-bridge 还开着'),
            h('div', { style: S.dim }, '为避免双发，本插件已停用收发。把原版总开关关掉并重启 DSH。'),
          )
          : null,
        h(
          'div',
          { style: { display: 'flex', gap: 8, margin: '10px 0 4px' } },
          ...页签.map((名) => h('button', { key: 名, style: S.tab(页 === 名), onClick: () => 设页(名) }, 名)),
        ),
        h(
          'div',
          { style: 脏 ? { ...S.dim, color: '#c0392b', fontWeight: 600 } : S.dim },
          脏 ? '⚠ 有改动还没保存' : '设置已同步 ✓',
        ),
        内容,
        h(
          'div',
          { style: S.card },
          h('div', { style: S.h }, '自己动手'),
          h(
            'div',
            { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h('button', { style: S.btn, disabled: 忙, onClick: 存 }, '保存设置'),
            h('button', {
              style: S.btn,
              disabled: 忙,
              onClick: async () => {
                const r = await post('/test-send', {})
                设说((r && r.说) || '')
                await 刷新()
              },
            }, '测试一句（发给主人）'),
            h('button', { style: S.btn, disabled: 忙, onClick: 刷新 }, '刷新'),
          ),
          h('div', { style: S.hint }, '测试句会绕过试运行直接发 —— 确认主人号填对了再点。'),
        ),
        h(
          'div',
          { style: S.card },
          h('div', { style: S.h }, '记录'),
          h('div', { style: S.log }, 日志.map((x) => `${x.时间}  ${x.文本}`).join('\n') || '（空）'),
        ),
        脏
          ? h(
            'div',
            { style: S.悬浮保存条 },
            h('span', { style: { fontWeight: 600, color: '#c0392b' } }, '⚠ 有改动还没保存'),
            h('button', { style: S.btn, disabled: 忙, onClick: 存 }, '保存设置'),
            h('span', { style: S.dim }, 说),
          )
          : null,
        说 && !脏 ? h('div', { style: S.ok }, 说) : null,
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
