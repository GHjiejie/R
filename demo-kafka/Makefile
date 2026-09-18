SHELL := /bin/bash
MAKEFLAGS += --no-print-directory

ROOT_DIR  := $(abspath $(CURDIR)/..)
COMPOSE   := docker compose -f "$(CURDIR)/docker-compose.yml"
UV        := uv --project "$(ROOT_DIR)"
PRODUCER  := $(CURDIR)/producer.py
CONSUMER  := $(CURDIR)/consumer.py
FRONTEND  := $(CURDIR)/frontend

TOPIC             ?= demo-events
GROUP             ?= demo-kafka-consumer
MESSAGE           ?= 你好，Kafka
BOOTSTRAP_SERVERS ?= localhost:9092
TIMEOUT_SECONDS   ?= 30
API_PORT          ?= 8000
FRONTEND_PORT     ?= 5173

.DEFAULT_GOAL := help
.PHONY: help sync up topic setup describe consume produce api frontend-install frontend-dev frontend-build ps logs stop down

help:
	@echo "Kafka 最小 Demo"
	@echo ""
	@echo "常用命令："
	@echo "  make setup                                      启动 Kafka、等待就绪并创建 Topic"
	@echo "  make consume                                   启动消费者并等待一条消息"
	@echo "  make produce                                   发送默认消息“$(MESSAGE)”"
	@echo "  make produce MESSAGE=\"hello kafka\"             发送自定义消息"
	@echo "  make api                                       启动 FastAPI HTTP 服务"
	@echo "  make frontend-install                          安装 React 前端依赖"
	@echo "  make frontend-dev                              启动 React 开发服务器"
	@echo "  make frontend-build                            构建 React 前端"
	@echo "  make describe                                  查看 Topic 信息"
	@echo "  make ps                                        查看 Kafka 容器状态"
	@echo "  make logs                                      查看 Kafka 日志"
	@echo "  make stop                                      停止 Kafka 容器但保留容器"
	@echo "  make down                                      停止并删除 Kafka 容器"
	@echo ""
	@echo "可覆盖变量：TOPIC、GROUP、MESSAGE、BOOTSTRAP_SERVERS、TIMEOUT_SECONDS、API_PORT、FRONTEND_PORT"

sync:
	@$(UV) sync

up:
	@$(COMPOSE) up -d --wait

topic: up
	@$(COMPOSE) exec kafka \
		/opt/kafka/bin/kafka-topics.sh \
		--create \
		--if-not-exists \
		--topic "$(TOPIC)" \
		--bootstrap-server localhost:9092 \
		--partitions 1 \
		--replication-factor 1

setup: topic sync
	@echo "Kafka 已就绪，Topic=$(TOPIC)"
	@echo "请在另一个终端执行 make consume，再执行 make produce"

describe: topic
	@$(COMPOSE) exec kafka \
		/opt/kafka/bin/kafka-topics.sh \
		--describe \
		--topic "$(TOPIC)" \
		--bootstrap-server localhost:9092

consume: topic sync
	@$(UV) run python "$(CONSUMER)" \
		--bootstrap-servers "$(BOOTSTRAP_SERVERS)" \
		--topic "$(TOPIC)" \
		--group "$(GROUP)" \
		--timeout-seconds "$(TIMEOUT_SECONDS)"

produce: topic sync
	@$(UV) run python "$(PRODUCER)" \
		--bootstrap-servers "$(BOOTSTRAP_SERVERS)" \
		--topic "$(TOPIC)" \
		--message "$(MESSAGE)"

api: setup
	@cd "$(CURDIR)" && $(UV) run uvicorn backend.main:app \
		--host 0.0.0.0 \
		--port "$(API_PORT)" \
		--reload

frontend-install:
	@cd "$(FRONTEND)" && npm install

frontend-dev:
	@cd "$(FRONTEND)" && VITE_API_PROXY_TARGET="http://localhost:$(API_PORT)" npm run dev -- --host 0.0.0.0 --port "$(FRONTEND_PORT)"

frontend-build:
	@cd "$(FRONTEND)" && npm run build

ps:
	@$(COMPOSE) ps

logs:
	@$(COMPOSE) logs -f kafka

stop:
	@$(COMPOSE) stop

down:
	@$(COMPOSE) down
