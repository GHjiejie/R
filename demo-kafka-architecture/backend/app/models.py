from typing import Literal

from pydantic import BaseModel, Field

Topic = Literal["orders", "payments"]
Group = Literal["lab-fulfillment", "lab-analytics"]


class ProduceRequest(BaseModel):
    topic: Topic = "orders"
    producer: Literal["producer-1", "producer-2", "producer-3"] = "producer-1"
    key: str = Field(default="order-1001", min_length=1, max_length=100)
    count: int = Field(default=1, ge=1, le=500)
    partition: int | None = Field(default=None, ge=0, le=23)
    amount_minor: int = Field(default=19900, ge=1, le=100_000_000)
    vary_keys: bool = False


class ConsumerRequest(BaseModel):
    group: Group
    delay_ms: int = Field(default=0, ge=0, le=3000)


class DelayRequest(BaseModel):
    delay_ms: int = Field(ge=0, le=3000)


class ExpandRequest(BaseModel):
    topic: Topic
    partitions: int = Field(ge=1, le=24)


class ResetRequest(BaseModel):
    group: Group
    position: Literal["earliest", "latest"] = "earliest"
