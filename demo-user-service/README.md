# demo-user-service：Python + React + Redis + PostgreSQL 用户服务

## Demo 目的

搭建一个全栈用户服务（含 **10000 条种子数据**），通过两个并列接口直观对比
**直接查 PostgreSQL** 与 **走 Redis 缓存** 的响应时间差异，演示
Cache-Aside 模式在大数据量场景下的价值。

## 系统架构设计图

![用户服务系统架构图](assets/系统架构图.png)

## 涉及的 Redis 知识点

- **缓存（Cache-Aside 模式）**：读请求先查 Redis，未命中回源 PostgreSQL 并回填缓存
- **缓存写策略**：写库后 `SETEX` 预热；删库后 `DEL` 失效，保证最终一致
- **过期时间（TTL）**：缓存键 `user:{id}` 默认 60 秒自动过期
- **数据一致性**：先更新数据库再删除缓存
- **键命名规范**：`user:{id}` 冒号分隔的层级命名
- **性能对比**：同一数据分别走"直连数据库"与"Redis 缓存"两条路径，量化延迟差异

## 目录与关键文件

```text
demo-user-service/
├── docker-compose.yml        # PostgreSQL + Redis 一键启动
├── backend/                  # FastAPI 后端
│   ├── requirements.txt
│   ├── .env.example          # 示例配置（无真实密码）
│   └── app/
│       ├── main.py           # API 路由（含缓存逻辑）
│       ├── config.py         # 配置（环境变量）
│       ├── database.py       # PostgreSQL 连接
│       ├── models.py         # User ORM 模型
│       ├── schemas.py        # Pydantic 模型
│       └── cache.py          # Redis 客户端与缓存键约定
├── frontend/                 # React (Vite) 前端
│   ├── vite.config.js        # /api 代理到后端 8000 端口
│   └── src/App.jsx           # 创建/查询用户界面，对比查询耗时
└── assets/
    └── 系统架构图.png        # 系统架构设计图
```

## 运行前置条件

- Docker 与 Docker Compose（启动 PostgreSQL / Redis）
- Python 3.11+（建议用 `uv` 或 venv 创建虚拟环境）
- Node.js 18+

## 启动方式

```bash
# 1. 启动 PostgreSQL 和 Redis
cd demo-user-service
docker compose up -d

# 2. 启动后端（虚拟环境安装依赖）
cd backend
uv venv .venv && source .venv/bin/activate
uv pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000

# 3. 启动前端（新开终端）
cd frontend
npm install
npm run dev        # http://localhost:5173
```

## 预期输出与可观察现象

1. 打开 `http://localhost:5173`，页面顶部显示数据库总用户数（10000 条）。
2. 输入任意用户 ID（1~10000），点击 **"查询对比"**：
   - 两个卡片分别显示 `GET /users/db/:id` 与 `GET /users/cache/:id` 的耗时与数据。
   - 第一次未命中时两者耗时接近；再次查询或点 **"先预热缓存"** 后，
     缓存接口耗时显著下降（通常 < 5ms）。
3. 可用命令行直接观察 Redis 中的缓存键：

   ```bash
   docker exec -it demo-user-redis redis-cli
   > KEYS user:*
   > GET user:1          # JSON 缓存内容
   > TTL user:1          # 剩余过期秒数
   ```

4. 后端 API 文档：`http://localhost:8000/docs`（Swagger UI），其中
   `/users/db/{id}` 与 `/users/cache/{id}` 分别对应"直连数据库"与"Redis 缓存"两条路径。

## 清理方式

```bash
docker compose down -v          # 停止并删除容器与数据卷
rm -rf backend/.venv frontend/node_modules
```

## 常见问题

- **端口占用**：5432 / 6379 / 8000 / 5173 被占用时，修改 `docker-compose.yml`
  的端口映射或 `.env` / `vite.config.js` 中的配置。
- **后端连不上数据库**：确认 `docker compose ps` 中两个容器均 healthy，
  且 `.env` 中 `DATABASE_URL` 与 compose 中的账号一致。
- **种子数据重复**：种子数据仅在 `users` 表为空时写入；如需重置，执行
  `docker compose down -v` 后重新启动。
- **前端跨域报错**：开发环境通过 Vite 的 `/api` 代理转发，请勿直接请求
  `http://localhost:8000`。
