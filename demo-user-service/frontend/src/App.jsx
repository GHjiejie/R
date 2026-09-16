import { useEffect, useState } from 'react'

const API = '/api'

export default function App() {
  const [total, setTotal] = useState(null)
  const [queryId, setQueryId] = useState('')
  const [dbResult, setDbResult] = useState(null)
  const [cacheResult, setCacheResult] = useState(null)
  const [log, setLog] = useState([])

  const addLog = (msg) => setLog((l) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...l.slice(0, 19)])

  useEffect(() => {
    fetch(`${API}/stats`).then(r => r.json()).then(d => setTotal(d.total_users))
  }, [])

  async function queryBoth() {
    if (!queryId) return
    const [dbRes, cacheRes] = await Promise.all([
      fetch(`${API}/users/db/${queryId}`).then(r => r.json()),
      fetch(`${API}/users/cache/${queryId}`).then(r => r.json()),
    ])
    setDbResult(dbRes)
    setCacheResult(cacheRes)
    addLog(`DB: ${dbRes.elapsed_ms}ms | Cache: ${cacheRes.elapsed_ms}ms (${cacheRes.source})`)
  }

  async function warmCache() {
    if (!queryId) return
    await fetch(`${API}/users/cache/${queryId}`)
    addLog(`已预热 id=${queryId} 的缓存，再点"查询对比"看差异`)
  }

  return (
    <div className="page">
      <h1>DB vs Redis 缓存对比</h1>
      <p className="hint">
        数据库共 <b>{total ?? '…'}</b> 条用户。
        两个接口同时查询同一 ID：<b>左 / 上 = 直接查库</b>，<b>右 / 下 = 走 Redis 缓存</b>。
        第一次未命中时两者接近，预热或重复查询后缓存接口明显更快。
      </p>

      <section className="card">
        <h2>输入用户 ID（1 ~ {total ?? '…'}）</h2>
        <div className="row">
          <input type="number" placeholder="用户 ID" value={queryId} onChange={(e) => setQueryId(e.target.value)} />
          <button onClick={queryBoth}>查询对比</button>
          <button className="secondary" onClick={warmCache}>先预热缓存</button>
        </div>
      </section>

      <div className="grid">
        <section className="card">
          <h2>① 直接访问数据库 <code>GET /users/db/:id</code></h2>
          {dbResult ? (
            <>
              <div className="time">{dbResult.elapsed_ms} ms</div>
              <pre>{JSON.stringify(dbResult.user, null, 2)}</pre>
            </>
          ) : <p className="empty">尚未查询</p>}
        </section>

        <section className="card highlight">
          <h2>② 从 Redis 缓存获取 <code>GET /users/cache/:id</code></h2>
          {cacheResult ? (
            <>
              <div className="time">{cacheResult.elapsed_ms} ms</div>
              <pre>{JSON.stringify(cacheResult.user, null, 2)}</pre>
              <p className="source">来源：{cacheResult.source}</p>
            </>
          ) : <p className="empty">尚未查询</p>}
        </section>
      </div>

      <section className="card">
        <h2>对比日志</h2>
        <ul className="log">
          {log.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      </section>
    </div>
  )
}
