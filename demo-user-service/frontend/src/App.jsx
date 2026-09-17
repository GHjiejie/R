import { useEffect, useState } from 'react'

const API = '/api'

function fmt(res) {
  if (!res) return '…'
  if (res.user) return `${res.elapsed_ms}ms (${res.source})`
  if (res.detail) return `404 ${res.detail}`
  return `${res.elapsed_ms}ms | ${res.db_hit ? '⚠️ 打到数据库' : '✅ 缓存拦截'} (${res.source})`
}

export default function App() {
  const [total, setTotal] = useState(null)
  const [queryId, setQueryId] = useState('')
  const [dbResult, setDbResult] = useState(null)
  const [unsafeResult, setUnsafeResult] = useState(null)
  const [cacheResult, setCacheResult] = useState(null)
  const [attackId, setAttackId] = useState('')
  const [attackRunning, setAttackRunning] = useState(false)
  const [attackReport, setAttackReport] = useState(null)
  const [log, setLog] = useState([])
  const [avalancheRunning, setAvalancheRunning] = useState(false)
  const [ttlDist, setTtlDist] = useState(null)
  const [avalancheMode, setAvalancheMode] = useState(null)

  const addLog = (msg) => setLog((l) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...l.slice(0, 19)])

  useEffect(() => {
    fetch(`${API}/stats`).then(r => r.json()).then(d => setTotal(d.total_users))
  }, [])

  async function queryBoth() {
    if (!queryId) return
    const [dbRes, unsafeRes, cacheRes] = await Promise.all([
      fetch(`${API}/users/db/${queryId}`).then(r => r.json()),
      fetch(`${API}/users/cache-unsafe/${queryId}`).then(r => r.json()),
      fetch(`${API}/users/cache/${queryId}`).then(r => r.json()),
    ])
    setDbResult(dbRes)
    setUnsafeResult(unsafeRes)
    setCacheResult(cacheRes)
    addLog(`id=${queryId} DB: ${fmt(dbRes)} | 无防护: ${fmt(unsafeRes)} | 有防护: ${fmt(cacheRes)}`)
  }

  async function warmCache() {
    if (!queryId) return
    await fetch(`${API}/users/cache/${queryId}`)
    addLog(`已预热 id=${queryId} 的缓存，再点"查询对比"看差异`)
  }

  async function simulateAttack() {
    const id = Number(attackId)
    if (!id) return
    setAttackRunning(true)
    setAttackReport(null)
    try {
      const [unsafeJson, safeJson] = await Promise.all([
        fetch(`${API}/users/cache-unsafe/${id}`).then(r => r.json()),
        fetch(`${API}/users/cache/${id}`).then(r => r.json()),
      ])
      // 有防护侧第一次请求会写入空值缓存，第二次请求直接命中
      const safe2 = await fetch(`${API}/users/cache/${id}`).then(r => r.json())
      const report = {
        id,
        unsafe: unsafeJson,
        safeFirst: safeJson,
        safeSecond: safe2,
      }
      setAttackReport(report)
      addLog(
        `穿透测试 id=${id} | 无防护每次打库: ${unsafeJson.db_hit ? '是 ⚠️' : '否'} | ` +
        `有防护第1次: ${safeJson.db_hit ? '打库(写空值缓存)' : '缓存拦截'}，第2次: ${safe2.db_hit ? '打库 ⚠️' : '缓存拦截 ✅'}`
      )
    } finally {
      setAttackRunning(false)
    }
  }

  async function runAvalanche(jitter) {
    setAvalancheRunning(true)
    setAvalancheMode(jitter ? 'safe' : 'danger')
    try {
      const warm = await fetch(`${API}/cache/warm-batch?start=1&end=200&jitter=${jitter}`, { method: 'POST' }).then(r => r.json())
      const dist = await fetch(`${API}/cache/ttl-distribution`).then(r => r.json())
      setTtlDist(dist)
      addLog(
        `雪崩演示（${jitter ? '错峰 TTL ✅' : '统一 TTL ⚠️'}）：预热 ${warm.warmed} 个键，` +
        `TTL 范围 ${warm.ttl_min}~${warm.ttl_max}s，共 ${dist.total_keys} 个键`
      )
    } finally {
      setAvalancheRunning(false)
    }
  }

  async function clearCache() {
    const res = await fetch(`${API}/cache/all`, { method: 'DELETE' }).then(r => r.json())
    setTtlDist(null)
    setAvalancheMode(null)
    addLog(`已清空 ${res.deleted} 个缓存键`)
  }

  return (
    <div className="page">
      <h1>DB vs Redis 缓存对比（含缓存穿透防护）</h1>
      <p className="hint">
        数据库共 <b>{total ?? '…'}</b> 条用户。
        三个接口同时查询同一 ID：<b>① 直接查库</b>、<b>② 缓存无防护</b>、<b>③ 缓存 + 空值缓存防穿透</b>。
        查询不存在的 ID 时，② 每次都会打到数据库，③ 第一次写空值缓存、后续请求被 Redis 直接拦截。
      </p>

      <section className="card">
        <h2>输入用户 ID（1 ~ {total ?? '…'}）</h2>
        <div className="row">
          <input type="number" placeholder="用户 ID" value={queryId} onChange={(e) => setQueryId(e.target.value)} />
          <button onClick={queryBoth}>查询对比</button>
          <button className="secondary" onClick={warmCache}>先预热缓存</button>
        </div>
      </section>

      <div className="grid3">
        <section className="card">
          <h2>① 直接访问数据库 <code>GET /users/db/:id</code></h2>
          {dbResult ? (
            <>
              <div className="time">{dbResult.elapsed_ms} ms</div>
              <pre>{JSON.stringify(dbResult.user, null, 2)}</pre>
            </>
          ) : <p className="empty">尚未查询</p>}
        </section>

        <section className="card warn">
          <h2>② 缓存（无穿透防护） <code>GET /users/cache-unsafe/:id</code></h2>
          {unsafeResult ? (
            <>
              <div className="time">{unsafeResult.elapsed_ms} ms</div>
              <pre>{JSON.stringify(unsafeResult.user, null, 2)}</pre>
              <p className="source">来源：{unsafeResult.source}</p>
              {unsafeResult.message && <p className="alert">{unsafeResult.message}</p>}
            </>
          ) : <p className="empty">尚未查询</p>}
        </section>

        <section className="card highlight">
          <h2>③ 缓存 + 空值缓存（防穿透） <code>GET /users/cache/:id</code></h2>
          {cacheResult ? (
            <>
              <div className="time">{cacheResult.elapsed_ms} ms</div>
              <pre>{JSON.stringify(cacheResult.user, null, 2)}</pre>
              <p className="source">来源：{cacheResult.source}</p>
              {cacheResult.message && <p className="ok">{cacheResult.message}</p>}
            </>
          ) : <p className="empty">尚未查询</p>}
        </section>
      </div>

      <section className="card">
        <h2>缓存穿透测试（查询不存在的用户）</h2>
        <p className="hint">
          输入一个不存在的 ID（例如 {total ? total + 1 : '…'} 以上），连续请求并对比两条路径是否打到数据库。
        </p>
        <div className="row">
          <input type="number" placeholder={`不存在的 ID，如 ${total ? total + 1 : ''}`} value={attackId} onChange={(e) => setAttackId(e.target.value)} />
          <button onClick={simulateAttack} disabled={attackRunning}>
            {attackRunning ? '请求中…' : '发起穿透测试'}
          </button>
        </div>
        {attackReport && (
          <table className="report">
            <thead>
              <tr><th>路径</th><th>结果</th><th>耗时</th><th>是否打到数据库</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>② 缓存（无防护）</td>
                <td>{attackReport.unsafe.user ? '命中' : '用户不存在'}</td>
                <td>{attackReport.unsafe.elapsed_ms} ms</td>
                <td className="bad">是（每次请求都打库）⚠️</td>
              </tr>
              <tr>
                <td>③ 有防护（第 1 次）</td>
                <td>{attackReport.safeFirst.user ? '命中' : '用户不存在'}</td>
                <td>{attackReport.safeFirst.elapsed_ms} ms</td>
                <td>{attackReport.safeFirst.db_hit ? '是（已写入空值缓存）' : '否'}</td>
              </tr>
              <tr>
                <td>③ 有防护（第 2 次）</td>
                <td>{attackReport.safeSecond.user ? '命中' : '用户不存在'}</td>
                <td>{attackReport.safeSecond.elapsed_ms} ms</td>
                <td className="good">{attackReport.safeSecond.db_hit ? '是 ⚠️' : '否（空值缓存拦截）✅'}</td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>缓存雪崩演示（TTL 分布）</h2>
        <p className="hint">
          批量预热 200 个用户的缓存后查看 TTL 分布：<b>统一 TTL</b> 会让所有键同时过期（雪崩诱因），
          <b>错峰 TTL</b> 在基础 TTL 上叠加随机扰动，让过期时间点散开。
        </p>
        <div className="row">
          <button className="danger" onClick={() => runAvalanche(false)} disabled={avalancheRunning}>
            模拟雪崩（统一 TTL）
          </button>
          <button className="success" onClick={() => runAvalanche(true)} disabled={avalancheRunning}>
            防雪崩预热（错峰 TTL）
          </button>
          <button className="secondary" onClick={clearCache}>清空缓存</button>
        </div>
        {ttlDist && (
          <>
            <p className={avalancheMode === 'danger' ? 'alert' : 'ok'}>
              当前 {ttlDist.total_keys} 个键 | 模式：{avalancheMode === 'danger' ? '统一 TTL，所有键将同时过期 ⚠️' : '错峰 TTL，过期时间已散开 ✅'}
            </p>
            <div className="ttl-chart">
              {Object.entries(ttlDist.ttl_distribution).map(([ttl, count]) => (
                <div key={ttl} className="ttl-bar-row">
                  <span className="ttl-label">{ttl}s</span>
                  <div
                    className={`ttl-bar ${avalancheMode === 'danger' ? 'danger' : ''}`}
                    style={{ width: `${Math.max(2, (count / ttlDist.total_keys) * 100)}%` }}
                  />
                  <span className="ttl-count">{count}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>对比日志</h2>
        <ul className="log">
          {log.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      </section>
    </div>
  )
}
