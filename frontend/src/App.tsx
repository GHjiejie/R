import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownWideNarrow, ArrowLeft, ArrowRight, BookMarked, BookOpen,
  Bookmark, Check, ChevronLeft, ChevronRight, Clock3, Code2, Database,
  FileText, FolderOpen, GraduationCap, Layers3, Library, ListTree,
  Menu, Radio, Route as RouteIcon, Search, ShieldCheck, Sparkles, X,
} from 'lucide-react';
import { articles, collections, topics, getArticle, type Article, type TopicId } from './lib/articles';
import MarkdownContent from './components/MarkdownContent';

const MemoMarkdownContent = memo(MarkdownContent);

const STORAGE_KEY = 'redis-field-notes:v1';
type ReadingState = { saved: string[]; completed: string[]; recent: string | null };
type Route = { kind: 'library'; collection: string } | { kind: 'article'; id: string; anchor?: string };
const initialReading: ReadingState = { saved: [], completed: [], recent: null };

function loadReading(): ReadingState {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!value || typeof value !== 'object') return initialReading;
    const record = value as Record<string, unknown>;
    const validIds = (ids: unknown) => Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && !!getArticle(id)) : [];
    return {
      saved: validIds(record.saved), completed: validIds(record.completed),
      recent: typeof record.recent === 'string' && getArticle(record.recent) ? record.recent : null,
    };
  } catch { return initialReading; }
}

function readRoute(): Route {
  try {
    const hash = window.location.hash.slice(1);
    if (hash.startsWith('/article/')) {
      const [path, query] = hash.slice('/article/'.length).split('?');
      return { kind: 'article', id: decodeURIComponent(path), anchor: new URLSearchParams(query).get('section') || undefined };
    }
    if (hash.startsWith('/topic/')) return { kind: 'library', collection: `topic:${decodeURIComponent(hash.slice('/topic/'.length))}` };
    return { kind: 'library', collection: hash.startsWith('/collection/') ? decodeURIComponent(hash.slice('/collection/'.length)) : 'all' };
  } catch { return { kind: 'library', collection: 'all' }; }
}

function articleHref(id: string, anchor?: string) {
  return `#/article/${encodeURIComponent(id)}${anchor ? `?section=${encodeURIComponent(anchor)}` : ''}`;
}

const collectionIcons: Record<string, typeof BookOpen> = {
  detailed: GraduationCap, chapters: Layers3, guide: BookOpen, notes: FileText, 'kafka-detailed': Radio, 'kafka-notes': FileText, related: Database,
};

function RedisLogo({ large = false }: { large?: boolean }) {
  return <span className={`redis-logo ${large ? 'large' : ''}`} aria-hidden="true"><Layers3 strokeWidth={1.8} /></span>;
}

function Sidebar({ selected, reading, onNavigate, isOpen, onClose }: {
  selected: string; reading: ReadingState; onNavigate: (collection: string) => void; isOpen: boolean; onClose: () => void;
}) {
  return <>
    {isOpen && <button className="nav-backdrop" aria-label="关闭导航" onClick={onClose} />}
    <aside id="site-navigation" className={`sidebar ${isOpen ? 'is-open' : ''}`} role={isOpen ? 'dialog' : undefined} aria-modal={isOpen || undefined} aria-label="学习导航">
      {isOpen && <button className="icon-button sidebar-close" aria-label="关闭学习导航" onClick={onClose}><X size={16} /></button>}
      <a href="#/" className="brand" onClick={onClose}><RedisLogo /><span>后端学习手记<small>LEARN. CONNECT. BUILD.</small></span></a>
      <div className="sidebar-body">
        <p className="nav-label">我的知识库</p>
        <button className={`nav-item ${selected === 'all' ? 'active' : ''}`} onClick={() => onNavigate('all')} aria-current={selected === 'all' ? 'page' : undefined}>
          <Library size={18} /><span>全部文章</span><span className="nav-count">{articles.length}</span>
        </button>
        <button className={`nav-item ${selected === 'saved' ? 'active' : ''}`} onClick={() => onNavigate('saved')} aria-current={selected === 'saved' ? 'page' : undefined}>
          <Bookmark size={18} /><span>我的收藏</span><span className="nav-count">{reading.saved.length}</span>
        </button>
        <div className="nav-divider" />
        <p className="nav-label">学习路线</p>
        {topics.map(topic => <button key={topic.id} className={`nav-item topic-nav topic-nav-${topic.id} ${selected === `topic:${topic.id}` ? 'active' : ''}`} onClick={() => onNavigate(`topic:${topic.id}`)} aria-current={selected === `topic:${topic.id}` ? 'page' : undefined}>
          {topic.id === 'kafka' ? <Radio size={18} /> : <Database size={18} />}<span>{topic.title} 学习路线</span><span className="nav-count">{topic.articles.length}</span>
        </button>)}
        <div className="nav-divider" />
        <p className="nav-label">按专题探索</p>
        {collections.map(collection => {
          const Icon = collectionIcons[collection.id] || FolderOpen;
          return <button key={collection.id} className={`nav-item ${selected === collection.id ? 'active' : ''}`} onClick={() => onNavigate(collection.id)} aria-current={selected === collection.id ? 'page' : undefined}>
            <Icon size={18} /><span>{collection.title}</span><span className="nav-count">{collection.articles.length}</span>
          </button>;
        })}
        <div className="sidebar-note"><span className="note-mark">“</span><p>理解一个原理，<br />连接一个场景。</p><small>让每一条笔记，都成为实践的起点。</small></div>
      </div>
      <div className="sidebar-footer"><span className="status-dot" /><span>本地学习空间</span><span className="version">v1.0</span></div>
    </aside>
  </>;
}

function Hero({ onOpen, recent, topicId }: { onOpen: (id: string) => void; recent?: Article; topicId?: TopicId }) {
  const topic = topics.find(item => item.id === topicId);
  const isKafka = topicId === 'kafka';
  const first = collections.find(collection => collection.id === (isKafka ? 'kafka-detailed' : 'detailed'))?.articles.find(article => article.chapter === 1);
  const chapterCount = topic?.articles.filter(article => article.chapter !== null).length;
  return <section className={`hero ${isKafka ? 'kafka-hero' : ''}`}>
    <div className="hero-copy"><p className="eyebrow"><span />{isKafka ? 'KAFKA · FOLLOW THE EVENT' : topicId === 'redis' ? 'REDIS · UNDERSTAND THE CACHE' : 'A LITTLE LEARNING, EVERY DAY'}</p>
      <h1>{isKafka ? <>让每一条事件，<br />都找到自己的<span>方向。</span></> : <>把零散的知识，<br />连成自己的<span>体系。</span></>}</h1>
      <p className="hero-description">{isKafka ? <>沿着一条订单事件，走进 Kafka 的世界。<br />从发布与订阅，到可靠地流转。</> : topicId === 'redis' ? '从一条命令到一个真实场景，在这里慢慢读懂 Redis。' : '从 Redis 的缓存世界，到 Kafka 的事件流，慢慢把原理读懂。'}</p>
      {first && <button className="primary-button" onClick={() => onOpen(recent?.id || first.id)}>{recent ? '继续上次阅读' : '从第一章开始'}<ArrowRight size={16} /></button>}
      <div className="hero-meta"><span><strong>{topic?.articles.length ?? articles.length}</strong> 篇学习笔记</span><i /><span><strong>{isKafka ? chapterCount : topic?.collections.length ?? collections.length}</strong> {isKafka ? '个进阶章节' : '个阅读专题'}</span><i /><span>持续积累中 <span className="tiny-dot" /></span></div>
    </div>
    <div className="hero-art" aria-hidden="true">
      <div className="orbit orbit-one" /><div className="orbit orbit-two" />
      <div className="art-label art-label-top"><span className="tiny-dot" />{isKafka ? 'EVENT → POSSIBILITY' : 'MEMORY → POSSIBILITY'}</div>
      <div className="floating-token token-get"><span>01</span>{isKafka ? 'order.paid' : 'GET knowledge'}</div>
      {isKafka ? <div className="event-visual"><span className="event-node event-producer"><Code2 size={22} /><small>PRODUCER</small></span><span className="event-line event-line-one" /><span className="event-hub"><Radio size={40} strokeWidth={1.5} /><small>KAFKA</small></span><span className="event-line event-line-two" /><span className="event-node event-consumer"><Database size={22} /><small>CONSUMER</small></span><span className="event-packet packet-one" /><span className="event-packet packet-two" /></div> : <div className="stack-visual"><div className="stack-layer stack-bottom" /><div className="stack-layer stack-middle" /><div className="stack-layer stack-top"><Layers3 size={65} strokeWidth={1.25} /></div></div>}
      <div className="floating-token token-set"><Code2 size={14} />{isKafka ? 'offset: next chapter' : 'SET curiosity ∞'}</div>
      <div className="art-caption"><span />{isKafka ? '发布 · 存储 · 消费' : '理解 · 连接 · 实践'}</div>
    </div>
  </section>;
}

function CollectionCards({ onNavigate, onOpen, topicId }: { onNavigate: (id: string) => void; onOpen: (id: string) => void; topicId?: TopicId }) {
  if (topicId === 'kafka') {
    const stages = [
      { title: '认识与收发', chapters: '01 — 06', first: 1, icon: Radio, description: '从一条订单事件，理解消息的流转。' },
      { title: '可靠性与存储', chapters: '07 — 12', first: 7, icon: ShieldCheck, description: '理解位移、副本和消息交付的边界。' },
      { title: '走进工程实践', chapters: '13 — 17', first: 13, icon: RouteIcon, description: '面对重试、积压与跨系统的一致性。' },
    ];
    return <div className="collection-cards kafka-stages">{stages.map(stage => {
      const first = articles.find(article => article.collectionId === 'kafka-detailed' && article.chapter === stage.first);
      return <button key={stage.first} className="collection-card" onClick={() => { if (first) onOpen(first.id); }} disabled={!first}>
        <span className="collection-icon"><stage.icon size={21} strokeWidth={1.6} /></span><div><h2>{stage.title}<span>{stage.chapters}</span></h2><p>{stage.description}</p></div><ArrowRight className="collection-arrow" size={17} />
      </button>;
    })}</div>;
  }
  const ids = topicId === 'redis' ? ['detailed', 'chapters', 'notes'] : ['detailed', 'kafka-detailed', 'notes'];
  return <div className="collection-cards">{ids.map(id => {
    const collection = collections.find(item => item.id === id);
    if (!collection) return null;
    const Icon = collectionIcons[id];
    return <button key={id} className={`collection-card collection-${id}`} onClick={() => onNavigate(id)}>
      <span className="collection-icon"><Icon size={21} strokeWidth={1.6} /></span><div><h2>{collection.title}<span>{collection.articles.length} 篇</span></h2><p>{collection.description}</p></div><ArrowRight className="collection-arrow" size={17} />
    </button>;
  })}</div>;
}

function ArticleCard({ article, isSaved, completed, onSave }: { article: Article; isSaved: boolean; completed: boolean; onSave: (id: string) => void }) {
  const collection = collections.find(item => item.id === article.collectionId);
  const Icon = collectionIcons[article.collectionId] || FileText;
  return <article className="article-card">
    <div className="article-card-top"><span className={`article-category category-${article.collectionId}`}><Icon size={13} />{collection?.title}</span>
      <button className={`icon-button save-button ${isSaved ? 'is-saved' : ''}`} aria-label={isSaved ? `取消收藏：${article.title}` : `收藏：${article.title}`} aria-pressed={isSaved} onClick={() => onSave(article.id)}><Bookmark size={17} fill={isSaved ? 'currentColor' : 'none'} /></button>
    </div>
    <a className="article-link" href={articleHref(article.id)}>
      <div className="article-title-line">{article.chapter !== null && <span className="chapter-number">{String(article.chapter).padStart(2, '0')}</span>}<h3>{article.shortTitle}</h3></div>
      <p className="article-summary">{article.summary}</p>
      <div className="article-card-bottom"><span><Clock3 size={13} />{article.readMinutes} 分钟阅读</span><span className="article-date">{article.date.slice(0, 10).replaceAll('-', '.')}</span>{completed && <span className="read-badge"><Check size={12} />已读</span>}<ArrowRight className="article-arrow" size={17} /></div>
    </a>
  </article>;
}

function LibraryPage({ collectionId, query, reading, onSave, onOpen, onNavigate, onClearSearch }: {
  collectionId: string; query: string; reading: ReadingState; onSave: (id: string) => void;
  onOpen: (id: string) => void; onNavigate: (id: string) => void; onClearSearch: () => void;
}) {
  const [sort, setSort] = useState('recommended');
  const [limit, setLimit] = useState(12);
  const selected = collections.find(item => item.id === collectionId);
  const topic = topics.find(item => collectionId === `topic:${item.id}`);
  const currentTopic = topic?.id || selected?.topicId;
  const title = collectionId === 'saved' ? '我的收藏' : topic ? `${topic.title} 学习路线` : selected?.title || '全部文章';
  const normalizedQuery = query.trim().toLocaleLowerCase();
  let filtered = articles.filter(article => (collectionId === 'all' || collectionId === 'saved' && reading.saved.includes(article.id) || article.collectionId === collectionId || !!topic && article.topicId === topic.id) && (!normalizedQuery || normalizedQuery.split(/\s+/).every(term => article.searchText.includes(term))));
  if (sort === 'newest') filtered = [...filtered].sort((a, b) => b.date.localeCompare(a.date) || (a.chapter ?? 99) - (b.chapter ?? 99));
  useEffect(() => setLimit(12), [collectionId, query]);
  const lastArticle = reading.recent ? getArticle(reading.recent) : undefined;
  const recent = !topic || lastArticle?.topicId === topic.id ? lastArticle : undefined;
  const showHome = (collectionId === 'all' || !!topic) && !normalizedQuery;
  const tabTopic = topics.find(item => item.id === currentTopic);
  const filterTabs = tabTopic ? [{ id: `topic:${tabTopic.id}`, title: `全部 ${tabTopic.title} 文章` }, ...tabTopic.collections] : [{ id: 'all', title: '全部文章' }, ...collections];
  return <div className="library-page">
    {showHome && <><Hero onOpen={onOpen} recent={recent} topicId={topic?.id} /><CollectionCards onNavigate={onNavigate} onOpen={onOpen} topicId={topic?.id} /></>}
    {!showHome && <div className="collection-intro"><p className="eyebrow">YOUR PERSONAL KNOWLEDGE LIBRARY</p><h1>{normalizedQuery ? '找到下一次灵感。' : title}</h1><p>{normalizedQuery ? `搜索「${query.trim()}」的文章与正文` : collectionId === 'saved' ? '把值得回看的知识，留在手边。' : selected?.description}</p></div>}
    <section className="article-section" aria-label="文章列表">
      <div className="section-heading"><div><h2>{normalizedQuery ? '搜索结果' : showHome ? topic ? `${topic.title} 文章` : '探索文章' : title}<span>{filtered.length}</span></h2>{showHome && <p>读懂原理，也看见它在真实场景中的样子。</p>}</div>
        <label className="sort-control"><ArrowDownWideNarrow size={14} /><span className="sr-only">文章排序</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="recommended">推荐顺序</option><option value="newest">最新记录</option></select></label>
      </div>
      <div className="filter-tabs" aria-label="筛选专题">{filterTabs.map(item => <button key={item.id} className={collectionId === item.id ? 'selected' : ''} onClick={() => onNavigate(item.id)} aria-pressed={collectionId === item.id}>{item.title}</button>)}</div>
      <div className="results-announcement sr-only" role="status">找到 {filtered.length} 篇文章</div>
      {filtered.length > 0 ? <><div className="article-grid">{filtered.slice(0, limit).map(article => <ArticleCard key={article.id} article={article} isSaved={reading.saved.includes(article.id)} completed={reading.completed.includes(article.id)} onSave={onSave} />)}</div>{limit < filtered.length && <button className="load-more" onClick={() => setLimit(value => value + 12)}>再看一些文章<span>还有 {filtered.length - limit} 篇</span><ChevronRight size={15} /></button>}</> : <div className="empty-state"><span className="empty-icon">{collectionId === 'saved' ? <Bookmark size={28} /> : <Search size={28} />}</span><h3>{normalizedQuery ? '还没有找到相关文章' : '这里等待你的第一篇收藏'}</h3><p>{normalizedQuery ? '试试 String、缓存、Offset、消费组，或更简短的关键词。' : '点击文章右上角的书签，就能在这里再次找到它。'}</p><button className="secondary-button" onClick={() => { onClearSearch(); onNavigate('all'); }}>{normalizedQuery ? '清除搜索，浏览全部' : '去探索文章'}<ArrowRight size={15} /></button></div>}
    </section>
    <footer className="page-footer"><span>后端学习手记</span><span>保持好奇，让知识慢慢生长。<Sparkles size={12} /></span></footer>
  </div>;
}

function ArticlePage({ article, anchor, reading, onSave, onComplete, onNavigate, onCollection }: {
  article: Article; anchor?: string; reading: ReadingState; onSave: (id: string) => void;
  onComplete: (id: string) => void; onNavigate: (id: string, anchor?: string) => void; onCollection: (id: string) => void;
}) {
  const [activeHeading, setActiveHeading] = useState('');
  const [progress, setProgress] = useState(0);
  const collection = collections.find(item => item.id === article.collectionId);
  const siblings = collection?.articles.filter(item => item.chapter !== null) || [];
  const index = siblings.findIndex(item => item.id === article.id);
  const previous = index > 0 ? siblings[index - 1] : undefined;
  const next = index >= 0 ? siblings[index + 1] : undefined;
  const saved = reading.saved.includes(article.id);
  const complete = reading.completed.includes(article.id);
  useEffect(() => {
    const update = () => {
      const headings = article.headings.map(heading => document.getElementById(heading.id)).filter((node): node is HTMLElement => !!node);
      const current = headings.filter(node => node.getBoundingClientRect().top <= 150).at(-1);
      setActiveHeading(current?.id || article.headings[0]?.id || '');
      const total = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(total <= 0 ? 100 : Math.min(100, Math.round(window.scrollY / total * 100)));
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const observer = new ResizeObserver(update);
    observer.observe(document.body);
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); observer.disconnect(); };
  }, [article]);
  useEffect(() => {
    if (anchor) document.getElementById(anchor)?.scrollIntoView();
  }, [article.id, anchor]);
  const jumpToHeading = (id: string) => { document.getElementById(id)?.scrollIntoView(); setActiveHeading(id); };
  return <div className="reader-layout">
    <div className="reader-main"><button className="back-link" onClick={() => onCollection(article.collectionId)}><ArrowLeft size={15} />返回{collection?.title}</button>
      <header className="article-header"><div className="article-eyebrow"><span className={`article-category category-${article.collectionId}`}>{collection?.title}</span>{article.chapter !== null && <span>CHAPTER {String(article.chapter).padStart(2, '0')}</span>}</div><h1>{article.title.replace(/^第\d+章[｜|：:\s]*/, '')}</h1>
        <div className="reader-meta"><span><Clock3 size={14} />{article.readMinutes} 分钟阅读</span><span>{article.date.slice(0, 10).replaceAll('-', '.')}</span><span>{article.wordCount.toLocaleString()} 字</span><button className={`reader-save ${saved ? 'is-saved' : ''}`} onClick={() => onSave(article.id)} aria-pressed={saved}><Bookmark size={15} fill={saved ? 'currentColor' : 'none'} />{saved ? '已收藏' : '收藏文章'}</button></div>
      </header>
      <details className="mobile-toc"><summary><ListTree size={16} />本文目录<span>{article.headings.length} 节</span></summary><nav>{article.headings.map(heading => <button key={heading.id} onClick={() => jumpToHeading(heading.id)}>{heading.text}</button>)}</nav></details>
      <MemoMarkdownContent key={article.id} article={article} onNavigate={onNavigate} />
      <div className="reading-finish"><span className="finish-icon"><BookMarked size={23} /></span><div><strong>知识又多连接了一点。</strong><p>读完之后，不妨打开终端，把理解变成一次实践。</p></div><button className={complete ? 'secondary-button completed-button' : 'primary-button'} onClick={() => onComplete(article.id)}><Check size={15} />{complete ? '已标记读完' : '标记为读完'}</button></div>
      {(previous || next) && <nav className="chapter-navigation" aria-label="章节导航">{previous ? <a href={articleHref(previous.id)}><span><ChevronLeft size={14} />上一篇</span><strong>{previous.shortTitle}</strong></a> : <span />}{next && <a href={articleHref(next.id)}><span>下一篇<ChevronRight size={14} /></span><strong>{next.shortTitle}</strong></a>}</nav>}
      <footer className="reader-footer">记录于 {article.date} · Asia/Shanghai</footer>
    </div>
    <aside className="toc"><div className="toc-inner"><p className="nav-label"><ListTree size={15} />本文目录</p><nav aria-label="本文目录">{article.headings.map(heading => <button key={heading.id} className={`${activeHeading === heading.id ? 'active' : ''} ${heading.level > 2 ? 'toc-nested' : ''}`} onClick={() => jumpToHeading(heading.id)}>{heading.text}</button>)}</nav><div className="reading-progress"><div><span>阅读进度</span><span>{progress}%</span></div><progress max={100} value={progress} /></div><button className="back-to-top" onClick={() => window.scrollTo({ top: 0 })}>回到顶部 ↑</button></div></aside>
  </div>;
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [reading, setReading] = useState<ReadingState>(loadReading);
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const article = route.kind === 'article' ? getArticle(route.id) : undefined;
  const selected = route.kind === 'library' ? route.collection : article?.collectionId || 'all';
  const closeMenu = () => { setMenuOpen(false); menuRef.current?.focus(); };
  useEffect(() => {
    const handleHash = () => { setRoute(readRoute()); setMenuOpen(false); window.scrollTo({ top: 0 }); };
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setMenuOpen(false); requestAnimationFrame(() => searchRef.current?.focus()); }
      if (event.key === 'Escape') { setMenuOpen(false); if (document.activeElement === searchRef.current) searchRef.current?.blur(); }
    };
    window.addEventListener('hashchange', handleHash);
    window.addEventListener('keydown', handleKey);
    return () => { window.removeEventListener('hashchange', handleHash); window.removeEventListener('keydown', handleKey); };
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const sidebar = document.getElementById('site-navigation');
    if (!sidebar) return;
    const mobile = window.matchMedia('(max-width: 900px)');
    const controls = () => Array.from(sidebar.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')).filter(element => element.getClientRects().length > 0);
    controls()[0]?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = controls();
      const first = items[0];
      const last = items.at(-1);
      const outside = !sidebar.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first?.focus(); }
    };
    const closeOnDesktop = () => { if (!mobile.matches) setMenuOpen(false); };
    window.addEventListener('keydown', trapFocus);
    mobile.addEventListener('change', closeOnDesktop);
    return () => {
      window.removeEventListener('keydown', trapFocus);
      mobile.removeEventListener('change', closeOnDesktop);
      document.body.style.overflow = previousOverflow;
      if (mobile.matches) menuRef.current?.focus();
    };
  }, [menuOpen]);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(reading)); } catch { /* Reading remains available in this session when storage is disabled. */ }
  }, [reading]);
  useEffect(() => {
    const topic = topics.find(item => selected === `topic:${item.id}`);
    document.title = article ? `${article.shortTitle} · 后端学习手记` : topic ? `${topic.title} 学习路线 · 后端学习手记` : '后端学习手记 · 把知识连成体系';
    if (article) setReading(value => value.recent === article.id ? value : { ...value, recent: article.id });
  }, [article, selected]);
  const navigateCollection = (id: string) => { window.location.hash = id === 'all' ? '/' : id.startsWith('topic:') ? `/topic/${id.slice(6)}` : `/collection/${id}`; setMenuOpen(false); };
  const openArticle = useCallback((id: string, anchor?: string) => { window.location.hash = articleHref(id, anchor).slice(1); }, []);
  const toggleSaved = (id: string) => setReading(value => ({ ...value, saved: value.saved.includes(id) ? value.saved.filter(item => item !== id) : [...value.saved, id] }));
  const toggleCompleted = (id: string) => setReading(value => ({ ...value, completed: value.completed.includes(id) ? value.completed.filter(item => item !== id) : [...value.completed, id] }));
  const activeTopic = article?.topicId || topics.find(item => selected === `topic:${item.id}`)?.id || collections.find(item => item.id === selected)?.topicId;
  return <div className="app-shell" data-topic={activeTopic}><a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>跳转到正文</a>
    <Sidebar selected={selected} reading={reading} onNavigate={navigateCollection} isOpen={menuOpen} onClose={closeMenu} />
    <div className="workspace"><header className="topbar"><div className="breadcrumb"><button ref={menuRef} className="icon-button menu-toggle" aria-label={menuOpen ? '关闭导航菜单' : '打开导航菜单'} aria-controls="site-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button><BookOpen size={17} /><span>学习空间</span><ChevronRight size={13} /><strong>{article ? '文章阅读' : selected === 'saved' ? '我的收藏' : topics.find(item => selected === `topic:${item.id}`)?.title || collections.find(item => item.id === selected)?.title || '全部文章'}</strong></div>
      <div className="search-field"><Search size={16} /><input ref={searchRef} type="search" aria-label="搜索文章或知识点" placeholder="搜索文章、命令或知识点…" value={query} onChange={event => { setQuery(event.target.value); if (route.kind === 'article') navigateCollection('all'); }} />{query ? <button className="icon-button" aria-label="清除搜索" onClick={() => setQuery('')}><X size={14} /></button> : <kbd>⌘ K</kbd>}</div>
    </header>
    <main id="main-content" tabIndex={-1}>{route.kind === 'article' ? article ? <ArticlePage article={article} anchor={route.anchor} reading={reading} onSave={toggleSaved} onComplete={toggleCompleted} onNavigate={openArticle} onCollection={navigateCollection} /> : <div className="empty-state"><FileText size={32} /><h1>这篇文章暂时找不到了</h1><p>文件可能已移动。可以回到知识库重新查找。</p><button className="primary-button" onClick={() => navigateCollection('all')}>返回全部文章<ArrowRight size={15} /></button></div> : <LibraryPage collectionId={collections.some(item => item.id === route.collection) || topics.some(item => route.collection === `topic:${item.id}`) || route.collection === 'saved' ? route.collection : 'all'} query={query} reading={reading} onSave={toggleSaved} onOpen={openArticle} onNavigate={navigateCollection} onClearSearch={() => setQuery('')} />}</main>
    </div>
  </div>;
}
