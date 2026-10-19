import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

const summarizeDirectory = fileURLToPath(new URL('../../summarize/', import.meta.url))
function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? markdownFiles(path) : /\.md$/i.test(entry.name) ? [path] : []
  })
}
const summaryFiles = markdownFiles(summarizeDirectory)
const summaryPaths = summaryFiles.map((path) => relative(summarizeDirectory, path).replaceAll('\\', '/'))
const totalArticles = summaryFiles.length
const detailedCount = summaryPaths.filter((path) => path.includes('Redis入门详解/')).length
const redisPaths = summaryPaths.filter((path) => /Redis/i.test(path) && !/Kafka/i.test(path))
const notesCount = redisPaths.filter((path) => !/Redis入门(?:详解|分章|文章)\//.test(path)).length
const kafkaPaths = summaryPaths.filter((path) => /Kafka/i.test(path))
const kafkaDetailedPaths = kafkaPaths.filter((path) => path.includes('Kafka入门详解/'))
const kafkaNotesCount = kafkaPaths.length - kafkaDetailedPaths.length
const kafkaChapterNumbers = kafkaDetailedPaths.flatMap((path) => {
  const match = path.match(/-\d{6}-(\d+)-/)
  return match ? [Number(match[1])] : []
}).sort((left, right) => left - right)
const fullTextMatches = summaryFiles.filter((path) => {
  const content = readFileSync(path, 'utf8').toLowerCase()
  return ['fencing', 'token'].every((term) => content.includes(term))
}).length
const priceCentsMatches = summaryFiles.filter((path) => readFileSync(path, 'utf8').toLowerCase().includes('price_cents')).length

const firstChapter = 'summarize/2026-10-19-175139-Redis入门详解/2026-10-19-175139-01-认识Redis.md'
const secondChapter = 'summarize/2026-10-19-175139-Redis入门详解/2026-10-19-175139-02-Redis为什么快.md'
const architectureNote = 'summarize/2026-09-17-001524-Redis用途与架构位置.md'
const kafkaDirectory = 'summarize/2026-10-19-231140-Kafka入门详解/2026-10-19-231140-Kafka入门目录.md'
const kafkaNote = 'summarize/2026-09-22-112448-Kafka实际开发用途.md'
const articleURL = (id: string) => `/#/article/${encodeURIComponent(id)}`

function kafkaChapterId(chapter: number): string {
  const path = kafkaDetailedPaths.find((path) => Number(path.match(/-\d{6}-(\d+)-/)?.[1]) === chapter)
  if (!path) throw new Error(`Kafka 第 ${chapter} 章不存在`)
  return `summarize/${path}`
}

function kafkaSearchMatches(query: string): number {
  const terms = query.toLowerCase().split(/\s+/)
  return summaryFiles.filter((path) => /Kafka/i.test(relative(summarizeDirectory, path))).filter((path) => {
    const content = readFileSync(path, 'utf8').toLowerCase()
    return terms.every((term) => content.includes(term))
  }).length
}

function articleList(page: Page) {
  return page.getByRole('region', { name: '文章列表' })
}

function articleCard(page: Page, id: string) {
  return articleList(page).getByRole('article').filter({
    has: page.locator(`a[href="#/article/${encodeURIComponent(id)}"]`),
  })
}

async function showAllArticles(page: Page, count: number) {
  const list = articleList(page)
  for (let loaded = 12; loaded < count; loaded += 12) {
    await list.getByRole('button', { name: /再看一些文章/ }).click()
    await expect(list.getByRole('article')).toHaveCount(Math.min(loaded + 12, count))
  }
}

async function expectNoPageOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
}

test(`全部 ${totalArticles} 篇学习记录可以逐页浏览，且没有重复文章`, async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('后端学习手记 · 把知识连成体系')
  await expect(page.locator('#site-navigation').getByRole('link', { name: /后端学习手记/ })).toBeVisible()
  const list = articleList(page)
  await expect(list.getByRole('status')).toHaveText(`找到 ${totalArticles} 篇文章`)
  await expect(list.getByRole('article')).toHaveCount(Math.min(12, totalArticles))
  await page.screenshot({ path: 'test-results/home-desktop.png' })

  for (let loaded = 12; loaded < totalArticles; loaded += 12) {
    await list.getByRole('button', { name: /再看一些文章/ }).click()
    await expect(list.getByRole('article')).toHaveCount(Math.min(loaded + 12, totalArticles))
  }

  await expect(list.getByRole('button', { name: /再看一些文章/ })).toHaveCount(0)
  const destinations = await list.getByRole('article').getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('href')))
  expect(new Set(destinations).size).toBe(totalArticles)
})

test('侧边专题筛选、正文全文搜索与空结果清除', async ({ page }) => {
  await page.goto('/')
  const sidebar = page.locator('#site-navigation')
  const detailed = sidebar.getByRole('button', { name: /Redis 入门详解/ })
  await detailed.click()
  await expect(detailed).toHaveAttribute('aria-current', 'page')
  await expect(articleList(page).getByRole('status')).toHaveText(`找到 ${detailedCount} 篇文章`)
  await expect(articleList(page).getByRole('article')).toHaveCount(Math.min(12, detailedCount))

  await sidebar.getByRole('button', { name: /Kafka 专题笔记/ }).click()
  await expect(articleList(page).getByRole('status')).toHaveText(`找到 ${kafkaNotesCount} 篇文章`)
  await expect(articleList(page).getByRole('article')).toHaveCount(Math.min(12, kafkaNotesCount))
  await expect(articleList(page).getByRole('heading', { level: 3, name: /Kafka/ }).first()).toBeVisible()
  await expect(articleCard(page, kafkaNote)).toBeVisible()

  await sidebar.getByRole('button', { name: /全部文章/ }).click()
  // This phrase occurs inside three older articles, rather than in their titles.
  const search = page.getByRole('searchbox', { name: '搜索文章或知识点' })
  await search.fill('price_cents')
  await expect(articleList(page).getByRole('status')).toHaveText(`找到 ${priceCentsMatches} 篇文章`)
  await expect(articleList(page).getByRole('article')).toHaveCount(Math.min(12, priceCentsMatches))
  await search.fill('fencing token')
  expect(fullTextMatches).toBeGreaterThanOrEqual(3)
  await expect(articleList(page).getByRole('status')).toHaveText(`找到 ${fullTextMatches} 篇文章`)
  await expect(articleList(page).getByRole('article')).toHaveCount(Math.min(12, fullTextMatches))

  await search.fill('redis-不存在的学习关键词-987654321')
  await expect(page.getByRole('heading', { name: '还没有找到相关文章' })).toBeVisible()
  await expect(articleList(page).getByRole('article')).toHaveCount(0)
  await page.getByRole('button', { name: '清除搜索，浏览全部' }).click()
  await expect(search).toHaveValue('')
  await expect(articleList(page).getByRole('status')).toHaveText(`找到 ${totalArticles} 篇文章`)
  await expect(articleList(page).getByRole('article')).toHaveCount(Math.min(12, totalArticles))
})

test('收藏可在刷新后继续查看，并且可以取消收藏', async ({ page }) => {
  await page.goto('/')
  const firstCard = articleList(page).getByRole('article').first()
  const title = await firstCard.getByRole('heading', { level: 3 }).innerText()
  const save = firstCard.getByRole('button')
  await save.click()
  await expect(save).toHaveAttribute('aria-pressed', 'true')

  await page.locator('#site-navigation').getByRole('button', { name: /我的收藏/ }).click()
  await expect(articleList(page).getByRole('article')).toHaveCount(1)
  await page.reload()
  const savedArticle = articleList(page).getByRole('article')
  await expect(savedArticle).toHaveCount(1)
  await expect(savedArticle.getByRole('heading', { level: 3 })).toHaveText(title)
  await expect(savedArticle.getByRole('button', { name: /^取消收藏：/ })).toHaveAttribute('aria-pressed', 'true')
  await savedArticle.getByRole('button', { name: /^取消收藏：/ }).click()
  await expect(page.getByRole('heading', { name: '这里等待你的第一篇收藏' })).toBeVisible()
  await page.reload()
  await expect(articleList(page).getByRole('article')).toHaveCount(0)
})

test('首章可阅读、按目录定位、显示流程图并复制代码', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  await page.goto('/')
  await page.getByRole('button', { name: '从第一章开始' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('认识 Redis：为什么商品详情需要缓存')
  await expect(page.getByRole('heading', { name: '从一个商品详情页说起', exact: true })).toBeVisible()

  const routeBeforeJump = page.url()
  const sectionTitle = '它和浏览器、应用、数据库是什么关系'
  await page.getByRole('navigation', { name: '本文目录', exact: true }).getByRole('button', { name: sectionTitle, exact: true }).click()
  await expect(page.getByRole('heading', { name: sectionTitle, exact: true })).toBeInViewport()
  await expect(page).toHaveURL(routeBeforeJump)
  const diagram = page.getByRole('img', { name: '文章中的 Mermaid 流程图，文字源码可在下方展开' })
  await expect(diagram).toBeVisible()
  await expect(diagram.locator('svg')).toHaveCount(1)
  await page.getByText('查看 Mermaid 源码', { exact: true }).click()
  await expect(page.locator('details[open] code')).toContainText('flowchart LR')

  await page.getByRole('button', { name: '复制代码', exact: true }).first().click()
  await expect(page.getByRole('button', { name: '已复制代码', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('learn:redis:product:1001')
  const externalLink = page.getByRole('link', { name: 'Redis FAQ', exact: true })
  await expect(externalLink).toHaveAttribute('target', '_blank')
  await expect(externalLink).toHaveAttribute('rel', /noopener/)
})

test('复制受限时显示说明，重试后可以恢复', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  await page.goto(articleURL(firstChapter))
  await expect(page.getByRole('heading', { level: 1 })).toContainText('认识 Redis')
  await page.evaluate(() => {
    const writeText = navigator.clipboard.writeText.bind(navigator.clipboard)
    let attempts = 0
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: (text: string) => ++attempts === 1
        ? Promise.reject(new DOMException('Clipboard permission denied', 'NotAllowedError'))
        : writeText(text),
    })
  })
  await page.getByRole('button', { name: '复制代码', exact: true }).first().click()
  await expect(page.getByText('复制失败，也可以选择代码后手动复制', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '复制失败，重试复制代码', exact: true }).click()
  await expect(page.getByRole('button', { name: '已复制代码', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('learn:redis:product:1001')
})

test('Markdown 相对链接可跨章、返回目录并重新打开章节', async ({ page }) => {
  await page.goto(articleURL(firstChapter))
  await page.getByRole('link', { name: '下一章', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(secondChapter)))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Redis 为什么快')
  await page.getByRole('link', { name: '返回目录', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Redis 入门｜分章详解目录')
  await page.getByRole('link', { name: '第01章｜认识 Redis：为什么商品详情需要缓存', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('认识 Redis')
})

test('旧文章的本地架构图片、GFM 表格与代码标题边界正常', async ({ page }) => {
  await page.goto(articleURL(architectureNote))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Redis 的用途与在企业系统架构中的位置')
  const firstTable = page.getByRole('table').first()
  await expect(firstTable.getByRole('columnheader')).toHaveText(['层级', '组件', '职责', 'Redis 的角色'])
  await expect(firstTable.getByRole('row').filter({ hasText: '缓存层' })).toContainText('本层主角')
  await expect(page.getByRole('heading', { name: '1. 应用先查缓存', exact: true })).toHaveCount(0)

  const diagram = page.getByRole('img', { name: '企业级系统架构中的 Redis', exact: true })
  await diagram.scrollIntoViewIfNeeded()
  await expect.poll(() => diagram.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
  await expectNoPageOverflow(page)
})

test('失效文章链接给出返回入口，损坏的路由仍可浏览', async ({ page }) => {
  await page.goto(articleURL('summarize/不存在的文章.md'))
  await expect(page.getByRole('heading', { name: '这篇文章暂时找不到了', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回全部文章', exact: true }).click()
  await expect(articleList(page).getByRole('status')).toHaveText(`找到 ${totalArticles} 篇文章`)
  await page.goto('/#/article/%E0%A4%A')
  await expect(articleList(page).getByRole('article')).toHaveCount(Math.min(12, totalArticles))
})

test(`Kafka 独立路线完整展示 ${kafkaPaths.length} 篇记录，Redis 路线保留原文章`, async ({ page }) => {
  await page.goto('/#/topic/kafka')
  await expect(page).toHaveTitle('Kafka 学习路线 · 后端学习手记')
  const sidebar = page.locator('#site-navigation')
  await expect(sidebar.getByRole('button', { name: /Kafka 学习路线/ })).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.hero-meta')).toContainText(`${kafkaPaths.length} 篇学习笔记`)
  await expect(articleList(page).getByRole('status')).toHaveText(`找到 ${kafkaPaths.length} 篇文章`)
  await expect(articleList(page).getByRole('button', { name: '全部 Kafka 文章', exact: true })).toBeVisible()
  await expect(articleList(page).getByRole('button', { name: 'Redis 入门详解', exact: true })).toHaveCount(0)
  expect(kafkaChapterNumbers).toEqual(Array.from({ length: 17 }, (_, index) => index + 1))
  expect(kafkaDetailedPaths.length).toBe(kafkaChapterNumbers.length + 1)
  await expectNoPageOverflow(page)
  await page.screenshot({ path: 'test-results/kafka-desktop.png' })

  await showAllArticles(page, kafkaPaths.length)
  const destinations = await articleList(page).getByRole('article').getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('href')))
  expect(destinations.sort()).toEqual(kafkaPaths.map((path) => `#/article/${encodeURIComponent(`summarize/${path}`)}`).sort())
  await expect(articleCard(page, kafkaNote)).toBeVisible()
  await expect(articleCard(page, kafkaDirectory)).toBeVisible()

  await sidebar.getByRole('button', { name: /Kafka 入门详解/ }).click()
  await expect(page).toHaveURL(/#\/collection\/kafka-detailed$/)
  await expect(articleList(page).getByRole('status')).toHaveText(`找到 ${kafkaDetailedPaths.length} 篇文章`)
  await expect(articleCard(page, kafkaChapterId(1)).locator('.chapter-number')).toHaveText('01')

  await sidebar.getByRole('button', { name: /Redis 学习路线/ }).click()
  await expect(page).toHaveURL(/#\/topic\/redis$/)
  await expect(page).toHaveTitle('Redis 学习路线 · 后端学习手记')
  await expect(articleList(page).getByRole('status')).toHaveText(`找到 ${redisPaths.length} 篇文章`)
  await showAllArticles(page, redisPaths.length)
  const redisDestinations = await articleList(page).getByRole('article').getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('href')))
  expect(redisDestinations.sort()).toEqual(redisPaths.map((path) => `#/article/${encodeURIComponent(`summarize/${path}`)}`).sort())
})

test('Kafka 三张阶段牌分别打开第 01、07、13 章', async ({ page }) => {
  const stages = [
    { name: '认识与收发', chapter: 1, title: '认识 Kafka' },
    { name: '可靠性与存储', chapter: 7, title: 'Offset 与提交' },
    { name: '走进工程实践', chapter: 13, title: '重试与死信' },
  ]
  for (const stage of stages) {
    await page.goto('/#/topic/kafka')
    await page.getByRole('button', { name: new RegExp(stage.name) }).click()
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(kafkaChapterId(stage.chapter))))
    await expect(page.getByRole('heading', { level: 1 })).toContainText(stage.title)
    await expect(page.locator('.article-eyebrow')).toContainText(`CHAPTER ${String(stage.chapter).padStart(2, '0')}`)
  }
})

test('Kafka 首章、下一章、目录、旧稿与 Redis 对比的站内链接连通', async ({ page }) => {
  await page.goto('/#/topic/kafka')
  await page.getByRole('button', { name: '从第一章开始', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(kafkaChapterId(1))))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('认识 Kafka：订单事件为什么需要消息平台')
  await expect(page.locator('.article-eyebrow')).toContainText('CHAPTER 01')

  await page.getByRole('link', { name: '下一章', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(kafkaChapterId(2))))
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Topic 与 Partition')
  await page.getByRole('link', { name: '返回目录', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(kafkaDirectory)))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kafka 入门｜从订单事件到可靠消息系统')
  await page.getByRole('link', { name: '第01章｜认识 Kafka', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(kafkaChapterId(1))))
  await page.getByRole('link', { name: 'Kafka 在实际开发中的用途', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(kafkaNote)))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kafka 在实际开发中的用途')

  await page.goto(articleURL(kafkaDirectory))
  await page.getByRole('link', { name: '第17章｜Kafka 与 Redis 选型', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(kafkaChapterId(17))))
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Kafka 与 Redis 选型')
  await page.getByRole('link', { name: 'Redis 的用途与架构位置', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(architectureNote)))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Redis 的用途与在企业系统架构中的位置')
})

test('Kafka 正文配置项可以搜索，收藏刷新后仍保留且不会串到 Redis 路线', async ({ page }) => {
  await page.goto('/#/topic/kafka')
  const search = page.getByRole('searchbox', { name: '搜索文章或知识点' })
  for (const term of ['group.id', 'min.insync.replicas']) {
    const count = kafkaSearchMatches(term)
    expect(count, `${term} 应出现在 Kafka 正文中`).toBeGreaterThan(0)
    await search.fill(term)
    await expect(articleList(page).getByRole('status')).toHaveText(`找到 ${count} 篇文章`)
    await expect(articleList(page).getByRole('article')).toHaveCount(Math.min(12, count))
    const destinations = await articleList(page).getByRole('article').getByRole('link').evaluateAll((links) => links.map((link) => decodeURIComponent(link.getAttribute('href') || '')))
    expect(destinations.every((destination) => destination.includes('Kafka'))).toBe(true)
  }

  await search.fill('')
  const first = articleCard(page, kafkaChapterId(1))
  await first.getByRole('button', { name: /^收藏：/ }).click()
  await expect(first.getByRole('button', { name: /^取消收藏：/ })).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(articleCard(page, kafkaChapterId(1)).getByRole('button', { name: /^取消收藏：/ })).toHaveAttribute('aria-pressed', 'true')

  const sidebar = page.locator('#site-navigation')
  await sidebar.getByRole('button', { name: /我的收藏/ }).click()
  await expect(articleList(page).getByRole('article')).toHaveCount(1)
  await expect(articleCard(page, kafkaChapterId(1))).toBeVisible()
  await page.reload()
  await expect(articleCard(page, kafkaChapterId(1))).toBeVisible()
  await sidebar.getByRole('button', { name: /Redis 学习路线/ }).click()
  await expect(articleList(page).getByRole('status')).toHaveText(`找到 ${redisPaths.length} 篇文章`)
  await expect(articleCard(page, kafkaChapterId(1))).toHaveCount(0)
})

test(`巡检 ${totalArticles} 篇正文、标题目录与全部 Mermaid 图，无浏览器运行错误`, async ({ page }) => {
  test.setTimeout(150_000)
  const browserErrors: string[] = []
  const diagramErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(`${page.url()}: ${error.message}`))
  await page.goto('/')
  const list = articleList(page)
  for (let loaded = 12; loaded < totalArticles; loaded += 12) {
    await list.getByRole('button', { name: /再看一些文章/ }).click()
  }
  const documents = await list.getByRole('article').evaluateAll((cards) => cards.map((card) => ({
    href: card.querySelector('a')?.getAttribute('href') || '',
    title: card.querySelector('h3')?.textContent || '',
  })))
  expect(documents).toHaveLength(totalArticles)

  for (const document of documents) {
    await page.goto(`/${document.href}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(document.title)
    const headings = page.locator('.markdown-body').getByRole('heading')
    const ids = await headings.evaluateAll((nodes) => nodes.map((node) => node.id))
    const labels = await headings.allTextContents()
    expect(ids.every(Boolean), `${document.title} 的标题都有锚点`).toBe(true)
    expect(new Set(ids).size, `${document.title} 的标题锚点唯一`).toBe(ids.length)
    const tocItems = page.getByRole('navigation', { name: '本文目录', exact: true }).getByRole('button')
    await expect(tocItems).toHaveCount(ids.length)
    await expect(tocItems).toHaveText(labels)

    const diagrams = page.locator('.mermaid-block')
    for (let index = 0; index < await diagrams.count(); index += 1) {
      const diagram = diagrams.nth(index)
      await diagram.scrollIntoViewIfNeeded()
      const rendered = diagram.getByRole('img', { name: '文章中的 Mermaid 流程图，文字源码可在下方展开', exact: true }).locator('svg')
      await expect.poll(async () => (
        await rendered.count() > 0 ||
        await diagram.getByText('流程图暂时无法显示，可以展开查看源码。', { exact: true }).count() > 0
      ), { message: `${document.title} 第 ${index + 1} 张图应完成加载` }).toBe(true)
      if (await rendered.count() === 0) {
        diagramErrors.push(`${document.title} 第 ${index + 1} 张图：${await diagram.locator('code').textContent()}`)
      }
    }
  }

  expect(browserErrors, '所有文章均没有浏览器运行错误').toEqual([])
  expect(diagramErrors, '所有 Mermaid 源码均可渲染').toEqual([])
})

test.describe('390px 手机阅读', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('键盘打开导航后焦点留在菜单内，Escape 归还打开按钮', async ({ page }) => {
    await page.goto('/')
    const openMenu = page.getByRole('button', { name: '打开导航菜单', exact: true })
    await openMenu.focus()
    await page.keyboard.press('Enter')
    const navigation = page.getByRole('dialog', { name: '学习导航', exact: true })
    await expect(navigation).toBeVisible()
    const close = navigation.getByRole('button', { name: '关闭学习导航', exact: true })
    await expect(close).toBeFocused()
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')

    await page.keyboard.press('Shift+Tab')
    await expect(navigation.getByRole('button', { name: /Kafka 专题笔记/ })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(close).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(navigation.getByRole('link', { name: /后端学习手记/ })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(navigation).toHaveCount(0)
    await expect(openMenu).toBeFocused()
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden')
  })

  test('导航可打开关闭，文章图表和阅读目录不撑宽页面', async ({ page }) => {
    await page.goto('/')
    await expectNoPageOverflow(page)
    await page.screenshot({ path: 'test-results/mobile.png' })
    await page.getByRole('button', { name: '打开导航菜单', exact: true }).click()
    await expect(page.getByRole('button', { name: '关闭导航菜单', exact: true })).toHaveAttribute('aria-expanded', 'true')
    await page.locator('#site-navigation').getByRole('button', { name: /Redis 专题笔记/ }).click()
    await expect(page.getByRole('button', { name: '打开导航菜单', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await expect(articleList(page).getByRole('article')).toHaveCount(Math.min(12, notesCount))
    for (let loaded = 12; loaded < notesCount; loaded += 12) {
      await articleList(page).getByRole('button', { name: /再看一些文章/ }).click()
    }
    await articleList(page).getByRole('article').filter({
      has: page.getByRole('heading', { name: 'Redis 的用途与在企业系统架构中的位置', exact: true, level: 3 }),
    }).getByRole('link').click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Redis 的用途')
    await page.getByText('本文目录', { exact: false }).filter({ hasText: /节/ }).click()
    await page.locator('details[open]').getByRole('button', { name: '各层职责', exact: true }).click()
    await expect(page.getByRole('heading', { name: '各层职责', exact: true })).toBeInViewport()
    await expect(page.getByRole('table').first()).toBeVisible()
    await expectNoPageOverflow(page)
    const architecture = page.getByRole('img', { name: '企业级系统架构中的 Redis', exact: true })
    await architecture.scrollIntoViewIfNeeded()
    await expect.poll(() => architecture.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
    await expectNoPageOverflow(page)
  })

  test('Kafka 手机路线、导航、分章与 Mermaid 不撑宽页面', async ({ page }) => {
    await page.goto('/#/topic/kafka')
    await expect(articleList(page).getByRole('status')).toHaveText(`找到 ${kafkaPaths.length} 篇文章`)
    await expectNoPageOverflow(page)
    await page.screenshot({ path: 'test-results/kafka-mobile.png' })

    await page.getByRole('button', { name: '打开导航菜单', exact: true }).click()
    const navigation = page.getByRole('dialog', { name: '学习导航', exact: true })
    await expect(navigation).toBeVisible()
    await navigation.getByRole('button', { name: /Kafka 入门详解/ }).click()
    await expect(navigation).toHaveCount(0)
    await expect(page.getByRole('button', { name: '打开导航菜单', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await expect(articleList(page).getByRole('status')).toHaveText(`找到 ${kafkaDetailedPaths.length} 篇文章`)
    await articleCard(page, kafkaChapterId(1)).getByRole('link').click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('认识 Kafka')
    await expectNoPageOverflow(page)

    await page.locator('.mobile-toc summary').click()
    const section = '核心机制：保存一份事实，供多个系统读取'
    await page.locator('.mobile-toc[open]').getByRole('button', { name: section, exact: true }).click()
    await expect(page.getByRole('heading', { name: section, exact: true })).toBeInViewport()
    const diagram = page.locator('.mermaid-block').first()
    await diagram.scrollIntoViewIfNeeded()
    await expect(diagram.getByRole('img', { name: '文章中的 Mermaid 流程图，文字源码可在下方展开', exact: true }).locator('svg')).toHaveCount(1)
    await expectNoPageOverflow(page)

    await page.getByRole('button', { name: '打开导航菜单', exact: true }).click()
    await page.getByRole('dialog', { name: '学习导航', exact: true }).getByRole('button', { name: /Redis 学习路线/ }).click()
    await expect(page).toHaveURL(/#\/topic\/redis$/)
    await expect(articleList(page).getByRole('status')).toHaveText(`找到 ${redisPaths.length} 篇文章`)
    await expectNoPageOverflow(page)
  })
})
