export type Partition = {
  id: number;
  leader: number;
  replicas: number[];
  isrs: number[];
  low: number | null;
  high: number | null;
};
export type Topic = { name: string; partitions: Partition[] };
export type Worker = {
  id: string;
  group: string;
  delay_ms: number;
  state: string;
  assignment: { topic: string; partition: number }[];
  processed: number;
  duplicates: number;
  error?: string;
};
export type Group = {
  id: string;
  state: string;
  members: { client_id: string }[];
  lag: number | null;
  error?: string;
  offsets: {
    topic: string;
    partition: number;
    committed: number | null;
    high: number;
    lag: number | null;
  }[];
};
export type Quorum = {
  leader_id?: number;
  leader_epoch?: number;
  high_watermark?: number;
  max_follower_lag?: number;
  stale?: boolean;
  age_seconds?: number;
  raw?: string;
  error?: string;
  nodes?: { id: number; address: string; reachable: boolean }[];
  replication?: Record<string, string>[];
  replication_age_seconds?: number;
};
export type State = {
  status: string;
  cluster_id?: string;
  updated_at: string | null;
  brokers: { id: number; host: string; port: number }[];
  topics: Topic[];
  groups: Group[];
  quorum: Quorum;
  workers: Worker[];
  errors: string[];
  results: { group_id: string; unique_events: number; amount_minor: number }[];
  attempts: {
    id: number;
    group_id: string;
    consumer_id: string;
    event_id: string;
    topic: string;
    partition_id: number;
    offset_id: number;
    duplicate: boolean;
    created_at: string;
  }[];
  activity: { id: number; kind: string; message: string; created_at: string }[];
};
export type Receipt = {
  acknowledged: number;
  failed: number;
  pending: number;
  duration_ms: number;
  receipts: {
    event_id: string;
    topic: string;
    partition: number;
    offset: number;
    key: string;
  }[];
  failures: { event_id: string; error: string }[];
};
export type Replay = {
  low: number;
  high: number;
  next_offset: number;
  truncated_start: boolean;
  messages: {
    offset: number;
    partition: number;
    key: string;
    value: unknown;
    timestamp: number;
  }[];
};
export type Storage = {
  files: {
    broker: number;
    partition: string;
    name: string;
    bytes: number;
    modified_at: number;
  }[];
  unavailable_brokers: number[];
  total_files: number;
};

export type Act = <T>(
  work: () => Promise<T>,
  message?: string,
) => Promise<T | undefined>;
export type PageProps = { state: State | null; busy: boolean; act: Act };
