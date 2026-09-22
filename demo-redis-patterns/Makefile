# Redis 模式实验台：排行榜、优先级队列、延迟任务
#
# 常用命令：
#   make dev       一键启动 Redis + FastAPI + React（后台 screen）
#   make api       前台启动 Redis + FastAPI
#   make frontend  前台启动 React
#   make stop      停止 FastAPI / React 进程
#   make down      停止并删除 Redis 容器与数据卷
#   make logs      查看前后端日志

SHELL := /bin/bash
MAKEFLAGS += --no-print-directory

ROOT_DIR       := $(abspath $(CURDIR)/..)
BACKEND_DIR    := backend
FRONTEND_DIR   := frontend
LOG_DIR        := .logs
BACKEND_SCREEN := demo-redis-patterns-backend
FRONTEND_SCREEN := demo-redis-patterns-frontend
COMPOSE        := docker compose -f "$(CURDIR)/docker-compose.yml"
UV             := uv --project "$(ROOT_DIR)"

API_PORT       ?= 8001
FRONTEND_PORT  ?= 5174
REDIS_PORT     ?= 6380

.DEFAULT_GOAL := help
.PHONY: help setup sync up frontend-install api frontend dev stop logs status down clean cli

help:
	@echo "Redis Patterns Demo"
	@echo ""
	@echo "  make dev       一键启动 Redis、FastAPI 与 React（后台运行）"
	@echo "  make api       前台启动 Redis + FastAPI (http://localhost:$(API_PORT))"
	@echo "  make frontend  前台启动 React (http://localhost:$(FRONTEND_PORT))"
	@echo "  make up        仅启动 Redis (localhost:$(REDIS_PORT))"
	@echo "  make stop      停止前后端 screen 会话"
	@echo "  make logs      实时查看前后端日志"
	@echo "  make status    查看容器与进程状态"
	@echo "  make cli       打开 Redis CLI"
	@echo "  make down      停止并删除 Redis 容器与数据卷"
	@echo "  make clean     down + 清理 node_modules / .logs"
	@echo ""
	@echo "可覆盖变量：API_PORT、FRONTEND_PORT、REDIS_PORT"

setup:
	@if [ ! -f "$(CURDIR)/.env" ]; then \
		cp "$(CURDIR)/.env.example" "$(CURDIR)/.env"; \
		echo "✔ 已生成 .env"; \
	fi
	@$(UV) sync --quiet
	@echo "✔ Python 依赖已同步（根目录 .venv）"

sync:
	@$(UV) sync --quiet

up:
	@REDIS_PORT="$(REDIS_PORT)" $(COMPOSE) up -d --wait
	@echo "✔ Redis 已就绪：localhost:$(REDIS_PORT)"

frontend-install:
	@if [ ! -d "$(FRONTEND_DIR)/node_modules" ]; then \
		cd "$(FRONTEND_DIR)" && npm install --silent; \
	fi
	@echo "✔ React 依赖已就绪"

api: setup up
	@cd "$(CURDIR)" && set -a && source .env && set +a && \
		REDIS_URL="redis://localhost:$(REDIS_PORT)/0" \
		$(UV) run uvicorn $(BACKEND_DIR).main:app \
		--host 0.0.0.0 --port "$(API_PORT)" --reload

frontend: frontend-install
	@cd "$(FRONTEND_DIR)" && VITE_API_PROXY_TARGET="http://localhost:$(API_PORT)" \
		npm run dev -- --host 0.0.0.0 --port "$(FRONTEND_PORT)"

dev: setup up frontend-install
	@mkdir -p "$(LOG_DIR)"
	@if screen -ls | grep -q "\.$(BACKEND_SCREEN)"; then \
		echo "✔ FastAPI 已在运行"; \
	else \
		screen -dmS $(BACKEND_SCREEN) bash -c \
			"cd '$(CURDIR)' && set -a && source .env && set +a && REDIS_URL='redis://localhost:$(REDIS_PORT)/0' $(UV) run uvicorn $(BACKEND_DIR).main:app --host 0.0.0.0 --port '$(API_PORT)' >> '$(CURDIR)/$(LOG_DIR)/backend.log' 2>&1"; \
		echo "✔ FastAPI 已后台启动"; \
	fi
	@if screen -ls | grep -q "\.$(FRONTEND_SCREEN)"; then \
		echo "✔ React 已在运行"; \
	else \
		screen -dmS $(FRONTEND_SCREEN) bash -c \
			"cd '$(CURDIR)/$(FRONTEND_DIR)' && VITE_API_PROXY_TARGET='http://localhost:$(API_PORT)' npm run dev -- --host 0.0.0.0 --port '$(FRONTEND_PORT)' >> '$(CURDIR)/$(LOG_DIR)/frontend.log' 2>&1"; \
		echo "✔ React 已后台启动"; \
	fi
	@sleep 2
	@echo ""
	@echo "=================================================="
	@echo "  可视化页面：http://localhost:$(FRONTEND_PORT)"
	@echo "  API 文档：  http://localhost:$(API_PORT)/docs"
	@echo "  Redis：      localhost:$(REDIS_PORT)"
	@echo "  查看日志：   make logs"
	@echo "  停止进程：   make stop"
	@echo "=================================================="

stop:
	@for session in $(BACKEND_SCREEN) $(FRONTEND_SCREEN); do \
		if screen -ls | grep -q "\.$$session"; then \
			screen -S "$$session" -X quit; \
			echo "✔ 已停止 $$session"; \
		fi; \
	done

logs:
	@mkdir -p "$(LOG_DIR)"
	@touch "$(LOG_DIR)/backend.log" "$(LOG_DIR)/frontend.log"
	@tail -f "$(LOG_DIR)/backend.log" "$(LOG_DIR)/frontend.log"

status:
	@echo "--- Docker ---"
	@$(COMPOSE) ps
	@echo ""
	@echo "--- Screen ---"
	@screen -ls | grep -E "demo-redis-patterns" || echo "  前后端未在 screen 中运行"

cli: up
	@$(COMPOSE) exec redis redis-cli

down: stop
	@$(COMPOSE) down -v
	@echo "✔ Redis 容器与数据卷已删除"

clean: down
	@rm -rf "$(FRONTEND_DIR)/node_modules" "$(LOG_DIR)"
	@echo "✔ node_modules / .logs 已清理"
