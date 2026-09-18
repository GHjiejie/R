import { useCallback, useEffect, useState } from 'react'

const API = '/api'

async function requestJson(path, options = {}) {
  const response = await fetch(API + path, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.detail || '请求失败（HTTP ' + response.status + '）')
  }
  return data
}

function formatTime(timestamp) {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleString('zh-CN', {
    hour12: false,
  })
}

export default function App() {
  const [health, setHealth] = useState(null)
  const [messages, setMessages] = useState([])
  const [message, setMessage] = useState('')
  const [key, setKey] = useState('greeting')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [healthData, messageData] = await Promise.all([
        requestJson('/health'),
        requestJson('/messages?limit=20'),
      ])
      setHealth(healthData)
      setMessages(messageData.messages)
      setError('')
    } catch (requestError) {
      setHealth(null)
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => window.clearInterval(timer)
  }, [refresh])

  async function handleSubmit(event) {
    event.preventDefault()
    const value = message.trim()
    if (!value) return

    setSending(true)
    setError('')
    try {
      await requestJson('/messages', {
        method: 'POST',
        body: JSON.stringify({
          key: key.trim() || 'greeting',
          message: value,
        }),
      })
      setMessage('')
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">REACT · FASTAPI · KAFKA</p>
          <h1>Kafka 消息控制台</h1>
          <p className="subtitle">
            用 React 发起 HTTP 请求，由 FastAPI 将消息写入 Kafka，再从 Topic 中读取最近事件。
          </p>
        </div>
        <div className={'status ' + (health ? 'online' : 'offline')}>
          <span className="status-dot" />
          {health ? 'Kafka 已连接' : '等待后端连接'}
        </div>
      </section>

      <section className="stats">
        <div className="stat-card">
          <span>Topic</span>
          <strong>{health?.topic || 'demo-events'}</strong>
        </div>
        <div className="stat-card">
          <span>Partition</span>
          <strong>{health?.partitions?.join(', ') || '—'}</strong>
        </div>
        <div className="stat-card">
          <span>读取方式</span>
          <strong>最近 20 条</strong>
        </div>
      </section>

      <section className="content-grid">
        <form className="card composer" onSubmit={handleSubmit}>
          <div className="card-heading">
            <div>
              <p className="section-label">PRODUCER</p>
              <h2>发送一条消息</h2>
            </div>
            <span className="method post">POST</span>
          </div>
          <label>
            Key
            <input
              value={key}
              maxLength={128}
              onChange={(event) => setKey(event.target.value)}
              placeholder="greeting"
            />
          </label>
          <label>
            Message
            <textarea
              value={message}
              maxLength={2000}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="输入要发送到 Kafka 的内容"
              rows={5}
            />
          </label>
          <button type="submit" disabled={sending || !message.trim()}>
            {sending ? '发送中…' : '发送到 Kafka'}
          </button>
          <p className="api-hint">POST /api/messages</p>
        </form>

        <section className="card messages-card">
          <div className="card-heading">
            <div>
              <p className="section-label">CONSUMER VIEW</p>
              <h2>最近消息</h2>
            </div>
            <button className="refresh-button" type="button" onClick={refresh} disabled={loading}>
              {loading ? '刷新中…' : '刷新'}
            </button>
          </div>
          {error && <div className="error">{error}</div>}
          {messages.length === 0 ? (
            <div className="empty">
              <span className="empty-icon">◎</span>
              <p>暂时没有消息</p>
              <span>发送一条消息后，它会出现在这里</span>
            </div>
          ) : (
            <div className="message-list">
              {messages.map((item) => (
                <article className="message-row" key={item.partition + '-' + item.offset}>
                  <div className="message-meta">
                    <span className="offset">#{item.offset}</span>
                    <span>Partition {item.partition}</span>
                    <span>{formatTime(item.timestamp)}</span>
                  </div>
                  <p className="message-text">{item.message}</p>
                  <span className="message-key">key: {item.key || '—'}</span>
                </article>
              ))}
            </div>
          )}
          <p className="api-hint">GET /api/messages · 每 5 秒自动刷新</p>
        </section>
      </section>

      <footer>
        <span>FastAPI 负责 HTTP 接口</span>
        <span className="footer-arrow">→</span>
        <span>Kafka 负责事件存储</span>
        <span className="footer-arrow">→</span>
        <span>React 负责交互展示</span>
      </footer>
    </main>
  )
}
