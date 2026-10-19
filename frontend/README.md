# 后端学习手记前端

将仓库 `summarize/` 中的 Redis、Kafka Markdown 学习记录展示为可搜索、按学习路线浏览的阅读站点。前端使用 React、TypeScript 和 Vite，无后端；阅读文章无需启动 Redis、Kafka 或数据库。

当前共有 **59 篇记录**：保留原有 40 篇 Redis 记录，Kafka 包含新建的 17 章详解、1 篇目录以及原有 1 篇用途笔记，共 19 篇。目录也作为文章展示，页面数量会随仓库新增记录自动更新。

## 启动项目

前置条件：Node.js **22.12.0 或更高版本**，以及 npm。在仓库根目录执行：

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 <http://localhost:5193>。开发服务绑定本机 `127.0.0.1`；若端口被占用，以终端实际打印的地址为准。

页面可以查看全部文章、切换专题、搜索标题与正文、收藏文章、标记读完和继续上次阅读。文章页提供章节导航、正文目录、阅读进度、代码高亮与复制、表格和 Mermaid 流程图。按 `⌘ K` 或 `Ctrl K` 可以定位搜索框。

侧栏“学习路线”提供两个独立入口：

- [Redis 学习路线](http://localhost:5193/#/topic/redis)：保留 Redis 系列与专题阅读。
- [Kafka 学习路线](http://localhost:5193/#/topic/kafka)：使用蓝灰配色，展示 Kafka 文章与三个阶段入口，分别从第 1、7、13 章开始，覆盖认识与收发、可靠性与存储、工程实践。

收藏、已读状态和最近阅读记录保存在当前浏览器当前站点的 `localStorage` 中。为兼容已有阅读记录，键名仍为 `redis-field-notes:v1`。刷新页面后会保留；清理站点数据、更换浏览器或访问地址后不会共享这些状态。状态不会写回原始 Markdown 文件。

## 构建、预览与测试

```bash
# TypeScript 类型检查与生产构建，输出到 dist/
npm run build

# 预览已经生成的 dist/，默认使用本机 5193 端口
npm run preview

# 运行 Playwright 浏览器测试
npm run test
```

首次测试若提示缺少 Chromium 浏览器，先执行：

```bash
npx playwright install chromium
npm run test
```

在运行 `preview` 前需要先运行 `build`。停止开发或预览服务时按 `Ctrl C`；清理生产构建产物时删除 `frontend/dist/` 即可，保留 `summarize/` 中的学习记录。

## 目录与文章导入

```text
frontend/
  public/favicon.svg             站点图标
  src/main.tsx                   应用入口
  src/App.tsx                    知识库、阅读页和本地阅读状态
  src/components/MarkdownContent.tsx  Markdown、代码与 Mermaid 渲染
  src/lib/articles.ts            文章导入、元数据、分类和相对链接解析
  src/styles.css                 桌面和移动端样式
  tests/                         浏览器测试
  vite.config.ts                 Vite 与仓库内文章访问配置
../summarize/                    原始 Markdown 学习记录
../summarize/assets/             文章本地图片
```

`src/lib/articles.ts` 通过 Vite 的 `import.meta.glob` 递归读取 `../../../summarize/**/*.md`。此路径相对于数据层文件；从 `frontend/` 项目目录看，文章源目录是 `../summarize/`。文章内容在开发和构建时作为文本导入，无需额外复制文章或维护文章列表。

每篇文章以仓库相对文件路径作为稳定标识，例如 `summarize/某个系列/某篇文章.md`。标题从正文的 H1 或首个独立粗体标题中提取；记录时间优先读取正文中的“记录时间”，缺失时尝试读取文件名中的时间戳。阅读时会将主标题和时间移到文章页头，并把仅使用独立粗体标题的旧格式整理成可导航的小节。此过程只作用于显示，不修改原始记录。

分类按照路径与文件名约定自动生成：

| 专题 | 集合 ID | 匹配规则 |
| --- | --- | --- |
| Kafka 入门详解 | `kafka-detailed` | 路径包含 `Kafka入门详解/` |
| Kafka 专题笔记 | `kafka-notes` | 其他路径或文件名包含 `Kafka` 的记录，不区分大小写 |
| Redis 入门详解 | `detailed` | 路径包含 `Redis入门详解/` |
| Redis 入门分章 | `chapters` | 路径包含 `Redis入门分章/` |
| Redis 入门文章 | `guide` | 路径包含 `Redis入门文章/` |
| Redis 专题笔记 | `notes` | 其余路径或文件名包含 `Redis` 的记录，不区分大小写 |
| 关联技术 | `related` | 其余 Markdown，归属 `other` 主题 |

识别时先检查 Kafka，再检查 Redis，因此同时含有两者名称的 Kafka 比较文章仍归入 Kafka。Redis 的四个集合保持原有 ID；没有内容的集合不显示，包括 `other` 主题下的“关联技术”。原 Kafka 用途笔记归入 `kafka-notes`。

系列内以带时间戳文件名中的章节编号排序，目录文章放在章节前。默认按 Redis 的四个集合、Kafka 的两个集合、关联技术排序，也可以在页面切换为最新记录排序。旧版文章与新版文章都会保留并展示。

Kafka 文章以订单支付事件贯穿，实验说明见 [Kafka 入门目录](../summarize/2026-10-19-231140-Kafka入门详解/2026-10-19-231140-Kafka入门目录.md)。其中 CLI 面向另行准备的单节点、单副本 KRaft 学习环境，教学版本固定为 Kafka 4.1.2，并不承诺它是最新版本。文章中的示例输出和教学推演应按正文标注理解，前端构建与浏览器测试不代表 Kafka CLI 已实测。

## 更新文章与部署

新增或修改文章时，继续遵循仓库根目录的 `AGENTS.md`：在 `summarize/` 中创建带上海时区时间戳的新记录，保留旧记录。使用开发服务时，文章内容修改会触发页面热更新；新增或删除匹配的 Markdown 文件时，Vite 会更新文章导入列表。

生产站点需要在修改文章后重新运行 `npm run build` 并更新部署文件。将 `dist/` 的全部内容部署到静态文件服务器即可；构建结果已包含文章内容和使用的本地资源，线上不需要额外提供原始 `summarize/` 目录。站点使用 hash 路由，学习路线地址为 `#/topic/redis` 与 `#/topic/kafka`，文章地址形如 `#/article/...`，无需配置后端文章接口或路由回退。Vite 的相对资源基路径允许部署在站点子目录中。

Markdown 中指向已有 `.md` 文件的相对链接会转换成站内文章导航，支持 `../`、中文路径、百分号编码和标题锚点。图片相对路径会映射到 `summarize/assets/` 中经 Vite 导入的资源。保持文件间相对关系即可保留旧记录之间的关联；重命名文章后，应同步修正引用它的链接。

流程图请使用 `mermaid` 代码块。图表接近视口时加载绘制；语法或加载失败时可展开查看源码并重试。普通 Markdown 支持表格、列表、代码高亮及代码复制。原始 HTML 会被跳过，Mermaid 使用严格安全模式。

## 常见问题

- **修改文章后线上没有变化**：生产站点使用构建时的文章内容，重新构建并完整替换 `dist/` 文件。
- **新文章没有进入预期专题**：检查目录命名是否符合上表规则；新增系列的分类规则集中在 `src/lib/articles.ts`。
- **本地图片没有显示**：将图片放在 `summarize/assets/`，检查 Markdown 相对路径和文件名大小写是否正确。
- **链接无法打开对应文章**：确认目标 `.md` 文件存在，链接相对于当前文章所在目录编写；不存在的文件不会生成站内导航。
- **代码复制失败**：检查浏览器剪贴板权限；本地 `localhost` 或 HTTPS 环境通常可使用剪贴板，也可以选择代码后手动复制。
- **收藏或已读记录未保存**：检查是否禁用了站点存储或使用隐私浏览；存储不可用时，页面仍可在当前会话中使用。
