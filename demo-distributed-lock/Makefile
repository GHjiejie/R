SHELL := /bin/bash
MAKEFLAGS += --no-print-directory

ROOT_DIR       := $(abspath $(CURDIR)/..)
REDIS_COMPOSE  := $(ROOT_DIR)/demo-install-redis/docker-compose.yml
DOCKER_COMPOSE := docker compose -f "$(REDIS_COMPOSE)"
UV             := uv --project "$(ROOT_DIR)"
SCRIPT         := $(CURDIR)/distributed_lock.py

# 可以通过 make run ARGS="--workers 8 ..." 透传脚本参数。
ARGS ?=

# 默认优先复用 REDIS_URL；连接失败时启动仓库自带的 Redis。
# 使用其他外部 Redis 时可执行：
# make run START_REDIS=0 REDIS_URL=redis://localhost:6380/0
START_REDIS ?= 1
REDIS_URL   ?= redis://localhost:6379/0
export REDIS_URL

.DEFAULT_GOAL := run
.PHONY: run demo help sync redis-up redis-ping redis-stop

run: sync
	@if [ "$(START_REDIS)" = "1" ]; then \
		if $(UV) run python -c 'import os, redis; redis.Redis.from_url(os.environ["REDIS_URL"]).ping()' >/dev/null 2>&1; then \
			echo "Redis 已可用，跳过启动仓库 Redis（REDIS_URL=$(REDIS_URL)）"; \
		else \
			$(MAKE) redis-up redis-ping; \
			if ! $(UV) run python -c 'import os, redis; redis.Redis.from_url(os.environ["REDIS_URL"]).ping()' >/dev/null 2>&1; then \
				echo "无法连接 REDIS_URL=$(REDIS_URL)，请检查 Redis 地址和容器状态"; \
				exit 1; \
			fi; \
		fi; \
	elif [ "$(START_REDIS)" = "0" ]; then \
		echo "跳过启动仓库 Redis，使用 REDIS_URL=$(REDIS_URL)"; \
	else \
		echo "START_REDIS 只能设置为 0 或 1"; \
		exit 1; \
	fi
	@$(UV) run python "$(SCRIPT)" $(ARGS)

demo: run

sync:
	@$(UV) sync

redis-up:
	@command -v docker >/dev/null 2>&1 || { \
		echo "未找到 docker，请安装 Docker Desktop，或使用 START_REDIS=0 连接已有 Redis"; \
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
	@echo "Redis 分布式锁 Demo"
	@echo ""
	@echo "常用命令："
	@echo "  make                                             启动 Redis 并运行 Demo"
	@echo "  make run                                         同上"
	@echo "  make run ARGS=\"--workers 8 --lock-ttl 5\"       传递脚本参数"
	@echo "  make run START_REDIS=0 REDIS_URL=...             使用已有 Redis"
	@echo "  make redis-stop                                  停止仓库启动的 Redis"
	@echo "  make help                                        查看帮助"
