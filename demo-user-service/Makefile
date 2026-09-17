# demo-user-service：一行命令启动全栈服务
#
# 常用命令：
#   make dev      一键启动 PostgreSQL + Redis + 后端 + 前端（开发模式）
#   make stop     停止前后端进程（Docker 容器保持运行）
#   make down     停止并删除 Docker 容器与数据卷
#   make logs     查看前后端运行日志
#   make status   查看各组件运行状态
#
# 说明：前后端通过 macOS 自带的 screen 在独立会话中运行，
# 与终端解耦，关闭终端不会中断服务；日志统一写入 .logs/ 目录。
# 后端依赖统一由仓库根目录的 pyproject.toml / uv.lock 管理，
# 共享根目录 .venv，本目录不再维护独立的 pyproject.toml / uv.lock。

SHELL := /bin/bash
MAKEFLAGS += --no-print-directory

ROOT_DIR       := $(abspath $(CURDIR)/..)
BACKEND_DIR    := backend
FRONTEND_DIR   := frontend
LOG_DIR        := .logs
BACKEND_SCREEN := demo-user-backend
FRONTEND_SCREEN := demo-user-frontend

DC := docker compose
UV := uv --project $(ROOT_DIR)

.PHONY: dev setup up wait-db backend frontend stop down logs status clean help

help: ## 显示帮助
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

dev: setup up wait-db backend frontend ## 一键启动所有服务（依赖安装 + Docker + 前后端）
	@echo ""
	@echo "==================================================="
	@echo "  所有服务已启动："
	@echo "    前端:        http://localhost:5173"
	@echo "    后端 API:    http://localhost:8000/docs"
	@echo "    PostgreSQL:  localhost:5432 (demo/demo123)"
	@echo "    Redis:       localhost:6379"
	@echo ""
	@echo "  查看日志: make logs    停止服务: make stop"
	@echo "==================================================="

setup: ## 安装前后端依赖并准备 .env
	@if [ ! -f $(BACKEND_DIR)/.env ]; then \
		cp $(BACKEND_DIR)/.env.example $(BACKEND_DIR)/.env; \
		echo "✔ 已从 .env.example 生成 backend/.env"; \
	fi
	@$(UV) sync --quiet && echo "✔ 后端依赖已安装（根目录 uv sync，共享根 .venv）"
	@if [ ! -d $(FRONTEND_DIR)/node_modules ]; then \
		cd $(FRONTEND_DIR) && npm install --silent && echo "✔ 前端依赖已安装 (npm install)"; \
	else \
		echo "✔ 前端依赖已存在，跳过 npm install"; \
	fi
	@mkdir -p $(LOG_DIR)

up: ## 启动 PostgreSQL 与 Redis 容器
	@$(DC) up -d
	@echo "✔ Docker 容器已启动 (postgres + redis)"

wait-db: ## 等待数据库与缓存就绪
	@echo "等待 PostgreSQL 与 Redis 就绪..."
	@until docker exec demo-user-pg pg_isready -U demo -d userdb >/dev/null 2>&1; do sleep 1; done
	@until docker exec demo-user-redis redis-cli ping 2>/dev/null | grep -q PONG; do sleep 1; done
	@echo "✔ PostgreSQL 与 Redis 已就绪"

backend: ## 后台启动 FastAPI 后端（端口 8000，screen 会话）
	@if screen -ls | grep -q "\.$(BACKEND_SCREEN)"; then \
		echo "✔ 后端已在运行 (screen: $(BACKEND_SCREEN))"; \
	else \
		screen -dmS $(BACKEND_SCREEN) \
			bash -c "cd $(CURDIR)/$(BACKEND_DIR) && exec $(UV) run uvicorn app.main:app --port 8000 >> $(CURDIR)/$(LOG_DIR)/backend.log 2>&1"; \
		sleep 2; \
		echo "✔ 后端已启动 (screen: $(BACKEND_SCREEN))，日志: $(LOG_DIR)/backend.log"; \
	fi

frontend: ## 后台启动 Vite 前端（端口 5173，screen 会话）
	@if screen -ls | grep -q "\.$(FRONTEND_SCREEN)"; then \
		echo "✔ 前端已在运行 (screen: $(FRONTEND_SCREEN))"; \
	else \
		screen -dmS $(FRONTEND_SCREEN) \
			bash -c "cd $(CURDIR)/$(FRONTEND_DIR) && exec npm run dev >> $(CURDIR)/$(LOG_DIR)/frontend.log 2>&1"; \
		sleep 2; \
		echo "✔ 前端已启动 (screen: $(FRONTEND_SCREEN))，日志: $(LOG_DIR)/frontend.log"; \
	fi

stop: ## 停止前后端进程（Docker 容器保持运行）
	@for s in $(BACKEND_SCREEN) $(FRONTEND_SCREEN); do \
		if screen -ls | grep -q "\.$$s"; then \
			screen -S $$s -X quit && echo "✔ 已停止 screen 会话: $$s"; \
		fi; \
	done
	@echo "✔ 前后端进程已停止"

down: stop ## 停止前后端并删除 Docker 容器与数据卷
	@$(DC) down -v
	@echo "✔ Docker 容器与数据卷已删除"

logs: ## 实时查看前后端日志（Ctrl+C 退出）
	@tail -f $(LOG_DIR)/backend.log $(LOG_DIR)/frontend.log

status: ## 查看各组件运行状态
	@echo "--- Docker 容器 ---"
	@$(DC) ps
	@echo ""
	@echo "--- screen 会话 ---"
	@screen -ls | grep -E "demo-user" || echo "  无前后端会话运行"

clean: down ## 清理容器、node_modules 与日志
	@rm -rf $(FRONTEND_DIR)/node_modules $(LOG_DIR)
	@echo "✔ 已清理 node_modules / .logs（Python 依赖由根目录 .venv 统一管理，不在此清理）"
