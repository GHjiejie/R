import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Element, ElementContent, Root } from 'hast'
import { AlertCircle, Check, Copy, GitBranch, RotateCcw } from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import {
  createHeadingSlugger,
  resolveArticleLink,
  resolveAssetLink,
  type Article,
} from '../lib/articles'

type MarkdownContentProps = {
  article: Article
  onNavigate: (id: string, anchor?: string) => void
}

type CopyState = 'idle' | 'copying' | 'copied' | 'error'
type DiagramState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; svg: string }
  | { status: 'error' }

type MermaidApi = (typeof import('mermaid'))['default']

let mermaidModule: Promise<MermaidApi> | undefined
let mermaidQueue: Promise<void> = Promise.resolve()
let diagramNumber = 0

function loadMermaid() {
  if (!mermaidModule) {
    mermaidModule = import('mermaid')
      .then(({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          theme: 'base',
          fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
          themeVariables: {
            primaryColor: '#f5f7f8',
            primaryTextColor: '#263238',
            primaryBorderColor: '#c2ced0',
            lineColor: '#8b9b9e',
            secondaryColor: '#fff0ee',
            tertiaryColor: '#f8f9fa',
          },
          flowchart: { htmlLabels: false },
        })
        return mermaid
      })
      .catch((error: unknown) => {
        mermaidModule = undefined
        throw error
      })
  }
  return mermaidModule
}

function renderDiagram(source: string, isCurrent: () => boolean) {
  // Mermaid uses shared configuration and temporary DOM; render one diagram at a time.
  const task = mermaidQueue.then(async () => {
    if (!isCurrent()) return null
    const mermaid = await loadMermaid()
    if (!isCurrent()) return null

    const host = document.createElement('div')
    host.className = 'mermaid-render-host'
    host.setAttribute('aria-hidden', 'true')
    document.body.append(host)

    try {
      const { svg } = await mermaid.render(`redis-diagram-${++diagramNumber}`, source, host)
      return isCurrent() ? svg : null
    } finally {
      host.remove()
    }
  })
  // A malformed diagram must not stop later diagrams from rendering.
  mermaidQueue = task.then(() => undefined, () => undefined)
  return task
}

function nodeText(node: ElementContent): string {
  if (node.type === 'text') return node.value
  if (node.type === 'element') return node.children.map(nodeText).join('')
  return ''
}

function CopyButton({ source }: { source: string }) {
  const [state, setState] = useState<CopyState>('idle')
  const request = useRef(0)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    request.current += 1
    setState('idle')
    return () => {
      request.current += 1
      clearTimeout(resetTimer.current)
    }
  }, [source])

  async function copyCode() {
    const currentRequest = ++request.current
    clearTimeout(resetTimer.current)
    setState('copying')

    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(source)
      if (request.current !== currentRequest) return
      setState('copied')
      resetTimer.current = setTimeout(() => setState('idle'), 2200)
    } catch {
      if (request.current === currentRequest) setState('error')
    }
  }

  const label = {
    idle: '复制',
    copying: '复制中',
    copied: '已复制',
    error: '重试复制',
  }[state]

  return (
    <span className="code-copy-control">
      <button
        className="code-copy-button"
        data-state={state}
        type="button"
        disabled={state === 'copying'}
        onClick={() => void copyCode()}
        aria-label={state === 'error' ? '复制失败，重试复制代码' : `${label}代码`}
      >
        {state === 'copied' ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        <span aria-live="polite">{label}</span>
      </button>
      {state === 'error' && (
        <span className="copy-feedback" role="status">复制失败，也可以选择代码后手动复制</span>
      )}
    </span>
  )
}

function CodeBlock({ source, language, children }: {
  source: string
  language: string
  children: ReactNode
}) {
  return (
    <div className="code-block">
      <div className="code-toolbar">
        <span>{language || 'CODE'}</span>
        <CopyButton source={source} />
      </div>
      <pre>{children}</pre>
    </div>
  )
}

function MermaidBlock({ source }: { source: string }) {
  const block = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [retry, setRetry] = useState(0)
  const [diagram, setDiagram] = useState<DiagramState>({ status: 'idle' })

  useEffect(() => {
    const element = block.current
    if (!element) return
    if (!('IntersectionObserver' in window)) {
      setVisible(true)
      return
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '240px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let current = true
    setDiagram({ status: 'loading' })

    void renderDiagram(source, () => current).then((svg) => {
      if (current && svg) setDiagram({ status: 'ready', svg })
    }).catch(() => {
      if (current) setDiagram({ status: 'error' })
    })

    return () => { current = false }
  }, [source, visible, retry])

  return (
    <div className="mermaid-block" ref={block}>
      <div className="code-toolbar">
        <span className="mermaid-label"><GitBranch size={13} aria-hidden="true" /> 流程图</span>
        <CopyButton source={source} />
      </div>
      {diagram.status === 'ready' ? (
        <div
          className="mermaid-canvas"
          role="img"
          aria-label="文章中的 Mermaid 流程图，文字源码可在下方展开"
          // Only Mermaid's SVG generated in strict security mode enters this container.
          dangerouslySetInnerHTML={{ __html: diagram.svg }}
        />
      ) : (
        <div className={`mermaid-status${diagram.status === 'error' ? ' mermaid-error' : ''}`} role="status">
          {diagram.status === 'error' ? (
            <>
              <AlertCircle size={16} aria-hidden="true" />
              <span>流程图暂时无法显示，可以展开查看源码。</span>
              <button className="mermaid-retry" type="button" onClick={() => setRetry((value) => value + 1)}>
                <RotateCcw size={13} aria-hidden="true" /> 重新加载
              </button>
            </>
          ) : <span>{diagram.status === 'loading' ? '正在绘制流程图…' : '接近此处时加载流程图'}</span>}
        </div>
      )}
      <details className="mermaid-source">
        <summary>查看 Mermaid 源码</summary>
        <pre><code>{source}</code></pre>
      </details>
    </div>
  )
}

function scrollToHeading(anchor: string) {
  let id = anchor.replace(/^#/, '')
  try { id = decodeURIComponent(id) } catch { /* Keep malformed percent sequences readable. */ }
  const target = document.getElementById(id)
  if (!target) return
  target.scrollIntoView({ block: 'start', behavior: 'auto' })
  target.setAttribute('tabindex', '-1')
  target.focus({ preventScroll: true })
}

export default function MarkdownContent({ article, onNavigate }: MarkdownContentProps) {
  const headingPlugin = useMemo(() => function assignHeadingIds() {
    return (tree: Root) => {
      let index = 0
      const slug = createHeadingSlugger()
      function walk(node: Root | Element) {
        for (const child of node.children) {
          if (child.type !== 'element') continue
          if (/^h[1-6]$/.test(child.tagName)) {
            const fallbackId = slug(child.children.map(nodeText).join(''))
            child.properties.id = article.headings[index]?.id ?? fallbackId
            index += 1
          }
          walk(child)
        }
      }
      walk(tree)
    }
  }, [article.headings])

  const components = useMemo<Components>(() => ({
    pre({ node, children }) {
      const code = node?.children.find((child): child is Element => child.type === 'element' && child.tagName === 'code')
      if (!code) return <pre>{children}</pre>
      const classes = code.properties.className
      const languageClass = (Array.isArray(classes) ? classes.map(String) : String(classes ?? '').split(' '))
        .find((value) => value.startsWith('language-'))
      const language = languageClass?.slice('language-'.length) ?? ''
      const source = code.children.map(nodeText).join('').replace(/\n$/, '')
      if (language.toLowerCase() === 'mermaid') {
        return <MermaidBlock key={`${article.id}:${node?.position?.start.offset ?? source}`} source={source} />
      }
      return <CodeBlock source={source} language={language}>{children}</CodeBlock>
    },
    a({ href, children, title }) {
      const destination = href ? resolveArticleLink(article, href) : null
      if (destination) {
        return (
          <a
            href={`#/article/${encodeURIComponent(destination.article.id)}${destination.hash ? `?section=${encodeURIComponent(destination.hash)}` : ''}`}
            title={title}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              event.preventDefault()
              if (destination.article.id === article.id && destination.hash) {
                scrollToHeading(destination.hash)
              } else {
                onNavigate(destination.article.id, destination.hash || undefined)
              }
            }}
          >{children}</a>
        )
      }
      return <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>
    },
    img({ src, alt, title }) {
      return <img src={src ? resolveAssetLink(article, src) : undefined} alt={alt ?? ''} title={title} loading="lazy" decoding="async" />
    },
    table({ children }) {
      return <div className="markdown-table-wrap"><table>{children}</table></div>
    },
  }), [article, onNavigate])

  return (
    <div className="markdown-body">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          headingPlugin,
          [rehypeHighlight, { plainText: ['mermaid', 'text', 'txt'], aliases: { bash: ['redis'] } }],
        ]}
        components={components}
      >{article.content}</ReactMarkdown>
    </div>
  )
}
