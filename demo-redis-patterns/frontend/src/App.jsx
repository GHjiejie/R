import { useCallback, useEffect, useMemo, useState } from 'react'

const API_BASE = '/api'

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.detail || `请求失败（HTTP ${response.status}）`)
  }

  return response.json()
}

function formatClock(value) {
  if (!value) return '--:--:--'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function formatCountdown(milliseconds) {
  if (milliseconds <= 0) return '已到期'
  const totalSeconds = Math.ceil(milliseconds / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

function statusLabel(status) {
  return {
    pending: '等待中',
    processing: '处理中',
    completed: '已完成',
  }[status] || status
}

function App() {
  const [health, setHealth] = useState(null)
  const [leaderboard, setLeaderboard] = useState({ items: [], total: 0 })
  const [priorityQueue, setPriorityQueue] = useState({
    jobs: [],
    consumed: [],
    total: 0,
  })
  const [delayedTasks, setDelayedTasks] = useState({ items: [], stats: {} })
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState('')
  const [notice, setNotice] = useState(null)
  const [now, setNow] = useState(Date.now())

  const [player, setPlayer] = useState('Eve')
  const [scoreDelta, setScoreDelta] = useState(100)
  const [jobName, setJobName] = useState('导出订单')
  const [jobPriority, setJobPriority] = useState(8)
  const [taskName, setTaskName] = useState('发送优惠券')
  const [taskDelay, setTaskDelay] = useState(3)
  const [taskDuration, setTaskDuration] = useState(2)

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [healthData, rankingData, queueData, taskData] = await Promise.all([
        api('/health'),
        api('/leaderboard?limit=12'),
        api('/priority/queue?limit=12'),
        api('/delayed/tasks'),
      ])
      setHealth(healthData)
      setLeaderboard(rankingData)
      setPriorityQueue(queueData)
      setDelayedTasks(taskData)
      if (!silent) setNotice(null)
    } catch (error) {
      setNotice({ type: 'error', text: error.message })
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const refreshTimer = window.setInterval(() => refresh(true), 1000)
    const clockTimer = window.setInterval(() => setNow(Date.now()), 250)
    return () => {
      window.clearInterval(refreshTimer)
      window.clearInterval(clockTimer)
    }
  }, [refresh])

  const flash = (text, type = 'success') => {
    setNotice({ type, text })
    window.setTimeout(() => setNotice(null), 2600)
  }

  const runAction = async (name, action, successText) => {
    setBusyAction(name)
    try {
      await action()
      await refresh(true)
      flash(successText)
    } catch (error) {
      setNotice({ type: 'error', text: error.message })
    } finally {
      setBusyAction('')
    }
  }

  const submitScore = (event) => {
    event.preventDefault()
    runAction(
      'score',
      () =>
        api('/leaderboard/score', {
          method: 'POST',
          body: JSON.stringify({
            player: player.trim(),
            score: Number(scoreDelta),
          }),
        }),
      `${player} 的积分已更新`,
    )
  }

  const submitJob = (event) => {
    event.preventDefault()
    runAction(
      'job',
      () =>
        api('/priority/jobs', {
          method: 'POST',
          body: JSON.stringify({
            name: jobName.trim(),
            priority: Number(jobPriority),
          }),
        }),
      `已提交「${jobName}」`,
    )
  }

  const submitTask = (event) => {
    event.preventDefault()
    runAction(
      'task',
      () =>
        api('/delayed/tasks', {
          method: 'POST',
          body: JSON.stringify({
            name: taskName.trim(),
            delay_seconds: Number(taskDelay),
            duration_seconds: Number(taskDuration),
          }),
        }),
      `延迟任务「${taskName}」已创建`,
    )
  }

  const maxScore = Math.max(...leaderboard.items.map((item) => item.score), 1)
  const redisOnline = health?.redis === 'up'
  const taskStats = health?.delayed || {}
  const workerEnabled = health?.worker?.enabled ?? true

  const taskRows = useMemo(() => {
    return delayedTasks.items.map((task) => {
      let progress = 0
      if (task.status === 'pending') {
        const started = new Date(task.created_at).getTime()
        const span = Math.max(task.run_at_ms - started, 1)
        progress = Math.min(1, Math.max(0, (now - started) / span))
      } else if (task.status === 'processing') {
        const started = new Date(task.started_at).getTime()
        const span = Math.max((task.duration_seconds || 0.1) * 1000, 1)
        progress = Math.min(1, Math.max(0, (now - started) / span))
      } else {
        progress = 1
      }

      return {
        ...task,
        progress,
        remaining: task.run_at_ms - now,
      }
    })
  }, [delayedTasks.items, now])

  return (
    <main className="app-shell">
      <div className="aurora aurora-one" />
      <div className="aurora aurora-two" />

      <header className="hero">
        <div>
          <p className="eyebrow">REDIS PATTERN WORKBENCH</p>
          <h1>把抽象数据结构变成可观察的业务能力</h1>
          <p className="hero-copy">
            排行榜、优先级队列和延迟任务共用一份 Redis 实例，前端每秒同步
            ZSET、HASH 与后台 worker 的最新状态。
          </p>
        </div>
        <div className={`connection ${redisOnline ? 'online' : 'offline'}`}>
          <span className="pulse" />
          <div>
            <strong>{redisOnline ? 'Redis 已连接' : 'Redis 未连接'}</strong>
            <small>{health?.server_time ? formatClock(health.server_time) : '等待健康检查'}</small>
          </div>
        </div>
      </header>

      {notice && <div className={`notice ${notice.type}`}>{notice.text}</div>}

      <section className="summary-grid">
        <article>
          <span>排行榜玩家</span>
          <strong>{leaderboard.total}</strong>
          <small>ZSET · ZREVRANGE</small>
        </article>
        <article>
          <span>待处理任务</span>
          <strong>{priorityQueue.total}</strong>
          <small>ZSET 复合分数</small>
        </article>
        <article>
          <span>延迟任务</span>
          <strong>{taskStats.completed || 0}</strong>
          <small>已完成 / 共 {taskStats.total || 0}</small>
        </article>
        <article>
          <span>Worker 状态</span>
          <strong className={workerEnabled ? 'positive' : 'warning'}>
            {workerEnabled ? '运行中' : '已暂停'}
          </strong>
          <small>已处理 {health?.worker?.processed_count || 0}</small>
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="panel leaderboard-panel">
          <PanelHeading
            index="01"
            title="实时排行榜"
            description="ZINCRBY 累加积分，ZREVRANGE 读取 Top N"
            tag="Sorted Set"
          />

          <form className="compact-form" onSubmit={submitScore}>
            <label>
              玩家
              <input
                value={player}
                maxLength={32}
                onChange={(event) => setPlayer(event.target.value)}
                placeholder="例如 Eve"
                required
              />
            </label>
            <label>
              积分变化
              <input
                type="number"
                value={scoreDelta}
                min="-100000"
                max="100000"
                onChange={(event) => setScoreDelta(event.target.value)}
                required
              />
            </label>
            <button disabled={busyAction === 'score'} type="submit">
              {busyAction === 'score' ? '写入中…' : '更新积分'}
            </button>
          </form>

          <div className="ranking-list">
            {leaderboard.items.map((item) => (
              <div className="ranking-row" key={item.player}>
                <div className={`rank rank-${item.rank}`}>{item.rank}</div>
                <div className="ranking-main">
                  <div className="ranking-meta">
                    <strong>{item.player}</strong>
                    <b>{item.score.toLocaleString()}</b>
                  </div>
                  <div className="bar-track">
                    <span
                      style={{
                        width: `${Math.max(5, (Math.max(item.score, 0) / maxScore) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
            {!leaderboard.items.length && <EmptyState text="还没有玩家数据" />}
          </div>

          <div className="panel-footer">
            <code>ZINCRBY patterns:leaderboard 100 Eve</code>
            <button
              className="ghost"
              onClick={() =>
                runAction(
                  'leaderboard-reset',
                  () => api('/leaderboard/reset', { method: 'POST' }),
                  '排行榜已重置',
                )
              }
              disabled={busyAction === 'leaderboard-reset'}
            >
              重置数据
            </button>
          </div>
        </article>

        <article className="panel queue-panel">
          <PanelHeading
            index="02"
            title="优先级队列"
            description="优先级越高越先出队；同优先级按提交顺序 FIFO"
            tag="ZSET + HASH"
          />

          <form className="compact-form" onSubmit={submitJob}>
            <label>
              任务名称
              <input
                value={jobName}
                maxLength={80}
                onChange={(event) => setJobName(event.target.value)}
                placeholder="例如 导出订单"
                required
              />
            </label>
            <label>
              优先级
              <select
                value={jobPriority}
                onChange={(event) => setJobPriority(event.target.value)}
              >
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => (
                  <option key={value} value={value}>
                    P{value}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={busyAction === 'job'} type="submit">
              {busyAction === 'job' ? '提交中…' : '入队'}
            </button>
          </form>

          <div className="queue-visual">
            {priorityQueue.jobs.map((job, index) => (
              <div className="queue-item" key={job.id}>
                <div className={`priority-pill priority-${job.priority}`}>
                  P{job.priority}
                </div>
                <div className="queue-content">
                  <strong>{job.name}</strong>
                  <small>
                    #{index + 1} · seq {job.sequence} · {formatClock(job.created_at)}
                  </small>
                </div>
                <div className="score-chip">{job.score.toExponential(2)}</div>
              </div>
            ))}
            {!priorityQueue.jobs.length && <EmptyState text="队列为空，请添加任务" />}
          </div>

          <div className="action-row">
            <button
              className="primary"
              onClick={() =>
                runAction(
                  'consume',
                  () => api('/priority/consume', { method: 'POST' }),
                  '已消费最高优先级任务',
                )
              }
              disabled={busyAction === 'consume' || !priorityQueue.jobs.length}
            >
              消费队首
            </button>
            <button
              className="ghost"
              onClick={() =>
                runAction(
                  'queue-reset',
                  () => api('/priority/reset', { method: 'POST' }),
                  '队列已恢复示例数据',
                )
              }
              disabled={busyAction === 'queue-reset'}
            >
              重置队列
            </button>
          </div>

          {priorityQueue.consumed.length > 0 && (
            <div className="consumed-strip">
              <span>最近消费</span>
              {priorityQueue.consumed.slice(0, 4).map((job) => (
                <code key={`${job.id}-${job.consumed_at}`}>
                  P{job.priority} {job.name}
                </code>
              ))}
            </div>
          )}
        </article>

        <article className="panel delayed-panel">
          <PanelHeading
            index="03"
            title="延迟任务时间轴"
            description="ZSET 保存执行时间，后台 worker 扫描到期任务"
            tag="ZSET + HASH + Worker"
          />

          <form className="task-form" onSubmit={submitTask}>
            <label>
              任务名称
              <input
                value={taskName}
                maxLength={80}
                onChange={(event) => setTaskName(event.target.value)}
                required
              />
            </label>
            <label>
              延迟秒数
              <input
                type="number"
                value={taskDelay}
                min="0"
                max="3600"
                step="0.5"
                onChange={(event) => setTaskDelay(event.target.value)}
                required
              />
            </label>
            <label>
              执行耗时
              <input
                type="number"
                value={taskDuration}
                min="0"
                max="30"
                step="0.5"
                onChange={(event) => setTaskDuration(event.target.value)}
                required
              />
            </label>
            <button disabled={busyAction === 'task'} type="submit">
              {busyAction === 'task' ? '创建中…' : '创建延迟任务'}
            </button>
          </form>

          <div className="worker-bar">
            <div>
              <span className={`live-dot ${workerEnabled ? 'active' : ''}`} />
              <strong>{workerEnabled ? '自动消费已开启' : '自动消费已暂停'}</strong>
              <small>每 0.4 秒扫描一次到期任务</small>
            </div>
            <div className="worker-actions">
              <button
                className="ghost"
                onClick={() =>
                  runAction(
                    'worker-toggle',
                    () =>
                      api('/delayed/worker', {
                        method: 'POST',
                        body: JSON.stringify({ enabled: !workerEnabled }),
                      }),
                    workerEnabled ? '自动消费已暂停' : '自动消费已恢复',
                  )
                }
                disabled={busyAction === 'worker-toggle'}
              >
                {workerEnabled ? '暂停' : '恢复'}
              </button>
              <button
                className="ghost"
                onClick={() =>
                  runAction(
                    'run-due',
                    () => api('/delayed/run-due', { method: 'POST' }),
                    '已手动扫描到期任务',
                  )
                }
                disabled={busyAction === 'run-due'}
              >
                立即扫描
              </button>
            </div>
          </div>

          <div className="task-list">
            {taskRows.map((task) => (
              <div className={`task-card ${task.status}`} key={task.id}>
                <div className="task-card-head">
                  <div>
                    <strong>{task.name}</strong>
                    <small>
                      计划 {formatClock(task.run_at_ms)} · 耗时 {task.duration_seconds}s
                    </small>
                  </div>
                  <span className={`status-badge ${task.status}`}>
                    {statusLabel(task.status)}
                  </span>
                </div>
                <div className="progress-track">
                  <span style={{ width: `${task.progress * 100}%` }} />
                </div>
                <div className="task-card-foot">
                  <span>
                    {task.status === 'pending'
                      ? `倒计时 ${formatCountdown(task.remaining)}`
                      : task.status === 'processing'
                        ? 'Worker 正在模拟业务处理'
                        : `完成于 ${formatClock(task.completed_at)}`}
                  </span>
                  <code>{task.id}</code>
                </div>
              </div>
            ))}
            {!taskRows.length && (
              <EmptyState text="还没有延迟任务，创建一个 3 秒后执行的任务试试" />
            )}
          </div>

          <div className="panel-footer">
            <span>
              待处理 {taskStats.pending || 0} · 处理中 {taskStats.processing || 0} · 已完成{' '}
              {taskStats.completed || 0}
            </span>
            <button
              className="ghost"
              onClick={() =>
                runAction(
                  'task-reset',
                  () => api('/delayed/reset', { method: 'POST' }),
                  '延迟任务已清空',
                )
              }
              disabled={busyAction === 'task-reset'}
            >
              清空记录
            </button>
          </div>
        </article>
      </section>

      <footer>
        <span>FastAPI :8001</span>
        <span>React :5174</span>
        <span>Redis :6380</span>
        {loading && <span>正在同步…</span>}
      </footer>
    </main>
  )
}

function PanelHeading({ index, title, description, tag }) {
  return (
    <div className="panel-heading">
      <div className="panel-index">{index}</div>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <span className="tech-tag">{tag}</span>
    </div>
  )
}

function EmptyState({ text }) {
  return (
    <div className="empty-state">
      <span>∅</span>
      <p>{text}</p>
    </div>
  )
}

export default App
