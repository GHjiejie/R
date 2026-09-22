import logging
import time
from contextlib import asynccontextmanager

from confluent_kafka import KafkaException
from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse

from .config import settings
from .kafka_service import KafkaService, LabError
from .models import (
    ConsumerRequest,
    DelayRequest,
    ExpandRequest,
    ProduceRequest,
    ResetRequest,
    Topic,
)
from .store import Store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app):
    app.state.lab = KafkaService(settings, Store(settings.database_path))
    yield
    app.state.lab.close()


app = FastAPI(title="Kafka Architecture Lab", version="1.0.0", lifespan=lifespan)


@app.exception_handler(LabError)
async def lab_error(request, exc):
    return JSONResponse({"detail": str(exc)}, status_code=exc.status)


@app.exception_handler(KafkaException)
async def kafka_error(request, exc):
    logger.warning("Kafka request failed: %s", exc)
    return JSONResponse({"detail": f"Kafka 请求失败：{exc}"}, status_code=503)


@app.exception_handler(TimeoutError)
async def timeout_error(request, exc):
    return JSONResponse({"detail": "集群请求超时，请检查 Broker / ISR 状态后重试"}, status_code=504)


@app.middleware("http")
async def request_logging(request, call_next):
    start = time.monotonic()
    response = await call_next(request)
    response.headers["X-Process-Time-Ms"] = str(round((time.monotonic() - start) * 1000))
    if request.method != "GET":
        logger.info("%s %s → %s", request.method, request.url.path, response.status_code)
    return response


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/state")
def state(request: Request):
    return request.app.state.lab.overview()


@app.post("/api/initialize")
def initialize(request: Request):
    return request.app.state.lab.initialize()


@app.post("/api/messages")
def produce(body: ProduceRequest, request: Request):
    return request.app.state.lab.produce(body)


@app.post("/api/consumers", status_code=201)
def start_consumer(body: ConsumerRequest, request: Request):
    return request.app.state.lab.start_worker(body.group, body.delay_ms)


@app.delete("/api/consumers/{worker_id}")
def stop_consumer(worker_id: str, request: Request):
    return request.app.state.lab.stop_worker(worker_id)


@app.patch("/api/consumers/{worker_id}")
def delay_consumer(worker_id: str, body: DelayRequest, request: Request):
    return request.app.state.lab.set_delay(worker_id, body.delay_ms)


@app.post("/api/partitions")
def expand(body: ExpandRequest, request: Request):
    return request.app.state.lab.expand(body.topic, body.partitions)


@app.post("/api/offsets/reset")
def reset(body: ResetRequest, request: Request):
    return request.app.state.lab.reset(body.group, body.position)


@app.get("/api/messages/replay")
def replay(
    request: Request,
    topic: Topic = "orders",
    partition: int = Query(0, ge=0, le=23),
    start: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
):
    return request.app.state.lab.replay(topic, partition, start, limit)


@app.get("/api/storage")
def storage(request: Request):
    return request.app.state.lab.storage()
