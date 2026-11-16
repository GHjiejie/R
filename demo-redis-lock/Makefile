SHELL := /bin/bash
MAKEFLAGS += --no-print-directory

ROOT_DIR       := $(abspath $(CURDIR)/..)
REDIS_COMPOSE  := $(ROOT_DIR)/demo-install-redis/docker-compose.yml
DOCKER_COMPOSE := docker compose -f "$(REDIS_COMPOSE)"
UV             := uv --project "$(ROOT_DIR)"
SCRIPT         := $(CURDIR)/distributed_lock.py

REDIS_URL   ?= redis://localhost:6379/0
START_REDIS ?= 1
ARGS        ?=
export REDIS_URL

.DEFAULT_GOAL := run
.PHONY: run demo test help sync redis-up redis-ping redis-stop

run: sync
	@if [ "$(START_REDIS)" = "1" ]; then \
		if $(UV) run python -c 'import os, redis; redis.Redis.from_url(os.environ["REDIS_URL"]).ping()' >/dev/null 2>&1; then \
			echo "Redis 已可用，跳过启动仓库 Redis（REDIS_URL=$(REDIS_URL)）"; \
		else \
			$(MAKE) redis-up redis-ping; \
		fi; \
	elif [ "$(START_REDIS)" = "0" ]; then \
		echo "跳过启动仓库 Redis，使用 REDIS_URL=$(REDIS_URL)"; \
	else \
		echo "START_REDIS 只能设置为 0 或 1"; \
		exit 1; \
	fi
	@$(UV) run python "$(SCRIPT)" --redis-url "$(REDIS_URL)" $(ARGS)

demo: run

test: sync
	@$(UV) run python "$(CURDIR)/test_manual_release.py"

sync:
	@$(UV) sync

redis-up:
	@command -v docker >/dev/null 2>&1 || { \
		echo "未找到 docker，请安装 Docker，或使用 START_REDIS=0 连接已有 Redis"; \
		exit 1; \
	}
	@$(DOCKER_COMPOSE) up -d redis

redis-ping:
	@echo "等待 Redis 就绪..."
	@for attempt in $$(seq 1 30); do \
		if $(DOCKER_COMPOSE) exec -T redis redis-cli ping 2>/dev/null | grep -q '^PONG$$'; then \
			echo "Redis 已就绪"; \
			exit 0; \
		fi; \
		sleep 1; \
	done; \
	echo "Redis 在 30 秒内没有就绪，请检查 Docker 容器状态"; \
	exit 1

redis-stop:
	@$(DOCKER_COMPOSE) stop redis

help:
	@echo "服务 A、B、C 争抢 Redis 锁，通过 HTTP 接口人工释放"
	@echo ""
	@echo "常用命令："
	@echo "  make                                             启动服务，等待人工通过接口释放锁"
	@echo "  make run ARGS=\"--api-port 8011\"                 修改接口端口，默认 8010"
	@echo "  make run ARGS=\"--auto-release --wait-timeout 0\"  自动释放对照例子"
	@echo "  make test                                        验证 HTTP 释放、续期和锁交接（需 Redis）"
	@echo "  make run START_REDIS=0 REDIS_URL=...             使用已有 Redis"
	@echo "  make redis-stop                                  停止仓库启动的 Redis"
	@echo "  make help                                        查看帮助"
