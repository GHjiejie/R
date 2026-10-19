export type TopicId = 'redis' | 'kafka' | 'other'
export type CollectionId = 'detailed' | 'chapters' | 'guide' | 'notes' | 'kafka-detailed' | 'kafka-notes' | 'related'

export interface ArticleHeading {
  id: string
  text: string
  level: number
}

export interface Article {
  /** Stable, repository-relative path. */
  id: string
  title: string
  shortTitle: string
  collectionId: CollectionId
  topicId: TopicId
  /** Recorded local time in Asia/Shanghai, without browser timezone conversion. */
  date: string
  summary: string
  content: string
  headings: ArticleHeading[]
  readMinutes: number
  wordCount: number
  chapter: number | null
  searchText: string
}

export interface ArticleCollection {
  id: CollectionId
  title: string
  description: string
  topicId: TopicId
  articles: Article[]
}

export interface ArticleLink {
  article: Article
  /** Decoded fragment, without the leading #. */
  hash: string
}

const markdownFiles = import.meta.glob<string>('../../../summarize/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const assetFiles = import.meta.glob<string>('../../../summarize/assets/**/*', {
  query: '?url',
  import: 'default',
  eager: true,
})

const collectionDefinitions: Omit<ArticleCollection, 'articles'>[] = [
  {
    id: 'detailed',
    topicId: 'redis',
    title: 'Redis 入门详解',
    description: '以商品缓存为线索，深入理解 17 个核心知识点。',
  },
  {
    id: 'chapters',
    topicId: 'redis',
    title: 'Redis 入门分章',
    description: '按主题拆分的简明章节，适合快速回顾与查阅。',
  },
  {
    id: 'guide',
    topicId: 'redis',
    title: 'Redis 入门文章',
    description: '从零开始，建立 Redis 的完整知识地图。',
  },
  {
    id: 'notes',
    topicId: 'redis',
    title: 'Redis 专题笔记',
    description: '从核心原理、生产实践到系统架构的学习记录。',
  },
  {
    id: 'kafka-detailed',
    topicId: 'kafka',
    title: 'Kafka 入门详解',
    description: '沿着订单事件，读懂 17 个消息系统核心知识点。',
  },
  {
    id: 'kafka-notes',
    topicId: 'kafka',
    title: 'Kafka 专题笔记',
    description: '回到实际开发，理解异步处理、解耦和数据流转。',
  },
  {
    id: 'related',
    topicId: 'other',
    title: '关联技术',
    description: '延伸阅读，理解不同技术在系统中的分工。',
  },
]

function repositoryPath(path: string): string {
  return path.slice(path.indexOf('summarize/'))
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function normalizePath(path: string): string {
  const parts: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

function plainMarkdown(value: string): string {
  const codeSpans: string[] = []
  return value
    .replace(/(`+)([^\n]*?)\1/g, (_match, _fence: string, code: string) => {
      codeSpans.push(code)
      return `\u0000${codeSpans.length - 1}\u0000`
    })
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*~]/g, '')
    // Markdown retains underscores within identifiers such as read_committed.
    .replace(/(^|[^\p{L}\p{N}_])(_{1,2})(\S(?:.*?\S)?)\2(?=$|[^\p{L}\p{N}_])/gu, '$1$3')
    .replace(/\\([\\`*{}\[\]()#+\-.!_>])/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\u0000(\d+)\u0000/g, (_match, index: string) => codeSpans[Number(index)] ?? '')
    .trim()
}

/** Keep this shared with the renderer so Chinese headings have stable anchors. */
export function slugHeading(text: string, occurrence = 0): string {
  const base = plainMarkdown(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-') || 'section'
  return occurrence > 0 ? `${base}-${occurrence}` : base
}

/** Start a new slugger for each document; even existing suffixed names stay unique. */
export function createHeadingSlugger(): (text: string) => string {
  const used = new Set<string>()
  return (text: string) => {
    let occurrence = 0
    let id = slugHeading(text)
    while (used.has(id)) id = slugHeading(text, ++occurrence)
    used.add(id)
    return id
  }
}

interface MarkdownLine {
  text: string
  inCode: boolean
}

function markdownLines(content: string): MarkdownLine[] {
  let fence: { marker: string; length: number } | null = null
  return content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n').map((text) => {
    const match = text.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/)
    const inCode = fence !== null || match !== null
    if (match) {
      const marker = match[1][0]
      if (!fence) fence = { marker, length: match[1].length }
      else if (marker === fence.marker && match[1].length >= fence.length && !match[2].trim()) fence = null
    }
    return { text, inCode }
  })
}

function collectionForPath(path: string): CollectionId {
  if (path.includes('Kafka入门详解/')) return 'kafka-detailed'
  if (/Kafka/i.test(path)) return 'kafka-notes'
  if (path.includes('Redis入门详解/')) return 'detailed'
  if (path.includes('Redis入门分章/')) return 'chapters'
  if (path.includes('Redis入门文章/')) return 'guide'
  return /Redis/i.test(path) ? 'notes' : 'related'
}

function dateFrom(content: string, filename: string): string {
  const recorded = content.match(/记录时间\s*[：:]\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/)
  if (recorded) return `${recorded[1]} ${recorded[2]}`
  const timestamp = filename.match(/^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})(\d{2})-/)
  return timestamp ? `${timestamp[1]} ${timestamp[2]}:${timestamp[3]}:${timestamp[4]}` : ''
}

function summaryFrom(content: string): string {
  const prose = markdownLines(content)
    .filter(({ inCode }) => !inCode)
    .map(({ text }) => text)
    .join('\n')
  const paragraphs = prose.split(/\n\s*\n/)
  const paragraph = paragraphs.find((value) => {
    const text = value.trim()
    return text.length > 24 && !/^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|\||!\[|\[|---|扩写关联[：:]|旧稿关联[：:]|来源[：:])/.test(text)
  }) || ''
  const characters = Array.from(plainMarkdown(paragraph.replace(/^>\s?/gm, '')).replace(/\s+/g, ' '))
  return characters.length > 126 ? `${characters.slice(0, 126).join('')}…` : characters.join('')
}

function parseArticle(path: string, rawContent: string): Article {
  const id = repositoryPath(path)
  const filename = id.split('/').at(-1) || id
  const lines = markdownLines(rawContent)
  const hasHeadings = lines.some(({ text, inCode }) => !inCode && /^\s{0,3}#{1,6}\s/.test(text))
  const titleIndex = lines.findIndex(({ text, inCode }) => !inCode && (
    /^#\s+\S/.test(text) || (!hasHeadings && /^\*\*\S.*\*\*\s*$/.test(text))
  ))
  const fallbackTitle = filename.replace(/^\d{4}-\d{2}-\d{2}-\d{6}-/, '').replace(/\.md$/i, '')
  const title = titleIndex >= 0
    ? plainMarkdown(lines[titleIndex].text.replace(/^#\s+/, '').replace(/\s+#+\s*$/, ''))
    : fallbackTitle
  const chapterMatch = filename.match(/^\d{4}-\d{2}-\d{2}-\d{6}-(\d+)-/)
  const content = lines
    .filter(({ text, inCode }, index) => index !== titleIndex && (inCode || !/^记录时间\s*[：:]/.test(text)))
    .map(({ text, inCode }) => {
      // Early learning records use standalone bold paragraphs as their section titles.
      if (!hasHeadings && !inCode && /^\*\*\S.*\*\*\s*$/.test(text)) return `## ${text.trim().slice(2, -2)}`
      return text
    })
    .join('\n')
    .trim()
  const nextSlug = createHeadingSlugger()
  const headings: ArticleHeading[] = []
  for (const { text, inCode } of markdownLines(content)) {
    const heading = !inCode && text.match(/^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+\s*)?$/)
    if (heading) {
      const headingText = plainMarkdown(heading[2])
      headings.push({ id: nextSlug(headingText), text: headingText, level: heading[1].length })
    }
  }
  const searchableContent = plainMarkdown(content)
  const chineseCharacters = searchableContent.match(/\p{Script=Han}/gu)?.length || 0
  const otherWords = searchableContent.replace(/\p{Script=Han}/gu, ' ').match(/[\p{L}\p{N}]+/gu)?.length || 0
  const wordCount = chineseCharacters + otherWords
  const shortTitle = title.replace(/^第\s*\d+\s*章\s*[｜|:：-]?\s*/, '').split(/[：:]/)[0]
  const collectionId = collectionForPath(id)
  return {
    id,
    title,
    shortTitle,
    collectionId,
    topicId: collectionDefinitions.find(collection => collection.id === collectionId)?.topicId || 'other',
    date: dateFrom(rawContent, filename),
    summary: summaryFrom(content),
    content,
    headings,
    readMinutes: Math.max(1, Math.ceil(wordCount / 450)),
    wordCount,
    chapter: chapterMatch ? Number(chapterMatch[1]) : null,
    searchText: `${title}\n${fallbackTitle}\n${content}\n${searchableContent}`.toLowerCase(),
  }
}

const collectionOrder = new Map(collectionDefinitions.map(({ id }, index) => [id, index]))

export const articles: Article[] = Object.entries(markdownFiles)
  .map(([path, content]) => parseArticle(path, content))
  .sort((left, right) => {
    const collectionDifference = (collectionOrder.get(left.collectionId) || 0) - (collectionOrder.get(right.collectionId) || 0)
    if (collectionDifference) return collectionDifference
    if (left.chapter !== null || right.chapter !== null) return (left.chapter || 0) - (right.chapter || 0)
    return right.date.localeCompare(left.date) || left.id.localeCompare(right.id, 'zh-CN')
  })

export const collections: ArticleCollection[] = collectionDefinitions.map((definition) => ({
  ...definition,
  articles: articles.filter((article) => article.collectionId === definition.id),
})).filter(collection => collection.articles.length > 0)

export const topics = [
  { id: 'redis' as const, title: 'Redis', description: '从一条命令到一个真实场景，读懂缓存与数据结构。' },
  { id: 'kafka' as const, title: 'Kafka', description: '从一条订单事件出发，理解消息如何可靠地流转。' },
].map(topic => ({
  ...topic,
  articles: articles.filter(article => article.topicId === topic.id),
  collections: collections.filter(collection => collection.topicId === topic.id),
}))

const articleById = new Map(articles.map((article) => [article.id, article]))
const assetByPath = new Map(Object.entries(assetFiles).map(([path, url]) => [repositoryPath(path), url]))

export function getArticle(id: string): Article | undefined {
  return articleById.get(normalizePath(decode(id)))
}

function resolvePath(article: Article, path: string): string {
  const decodedPath = decode(path)
  return normalizePath(decodedPath.startsWith('/') || decodedPath.startsWith('summarize/')
    ? decodedPath
    : `${article.id.slice(0, article.id.lastIndexOf('/') + 1)}${decodedPath}`)
}

/** Resolve only existing local Markdown documents; external URLs stay normal links. */
export function resolveArticleLink(article: Article, href: string): ArticleLink | null {
  if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return null
  const hashIndex = href.indexOf('#')
  const linkPath = (hashIndex >= 0 ? href.slice(0, hashIndex) : href).split('?')[0]
  const hash = hashIndex >= 0 ? decode(href.slice(hashIndex + 1)) : ''
  if (!linkPath && hashIndex >= 0) return { article, hash }
  if (!/\.md$/i.test(decode(linkPath))) return null
  const destination = articleById.get(resolvePath(article, linkPath))
  return destination ? { article: destination, hash } : null
}

/** Vite emits imported assets with the correct deployment base and hashed filename. */
export function resolveAssetLink(article: Article, src: string): string {
  if (!src || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(src)) return src
  const suffixIndex = src.search(/[?#]/)
  const path = suffixIndex >= 0 ? src.slice(0, suffixIndex) : src
  const suffix = suffixIndex >= 0 ? src.slice(suffixIndex) : ''
  const asset = assetByPath.get(resolvePath(article, path))
  return asset ? `${asset}${suffix}` : src
}
