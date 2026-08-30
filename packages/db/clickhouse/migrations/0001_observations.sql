-- EMS observation store. Forward-only, checksummed by the runner.
-- Postgres holds decisions; this holds what actually happened.

CREATE TABLE IF NOT EXISTS smtp_transactions
(
    ts              DateTime64(3),
    node_id         LowCardinality(String),
    ip_id           LowCardinality(String),
    domain_id       LowCardinality(String),
    mailbox_id      String,
    intent_id       String,
    message_id      String,
    queue_id        String,
    recipient       String,
    recipient_domain LowCardinality(String),
    esp_family      LowCardinality(String),
    relay           String,
    -- 'sent' | 'deferred' | 'bounced' | 'expired'
    status          LowCardinality(String),
    smtp_code       UInt16,
    enhanced_code   String,
    -- The receiving MX's exact text. Never summarised at parse time (E08-006).
    response        String,
    delay_ms        UInt32,
    attempt         UInt8,
    bounce_class    LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (node_id, ts, message_id)
TTL toDateTime(ts) + INTERVAL 90 DAY;

CREATE TABLE IF NOT EXISTS email_events
(
    ts          DateTime64(3),
    org_id      LowCardinality(String),
    campaign_id String,
    step_id     String,
    variant_id  String,
    lead_id     String,
    message_id  String,
    mailbox_id  String,
    domain_id   LowCardinality(String),
    -- queued|submitted|delivered|deferred|bounced|opened|clicked|replied|unsubscribed|complained
    type        LowCardinality(String),
    esp_family  LowCardinality(String),
    meta        String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (org_id, campaign_id, ts)
TTL toDateTime(ts) + INTERVAL 400 DAY;

CREATE TABLE IF NOT EXISTS reputation_series
(
    ts         DateTime,
    subject    LowCardinality(String),   -- IP|DOMAIN|MAILBOX|CONTENT|ENGAGEMENT
    subject_id String,
    score      Float32,
    -- The decomposition. We never store a score we cannot explain (E11-021).
    factors    String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (subject, subject_id, ts);

CREATE TABLE IF NOT EXISTS placement_observations
(
    ts          DateTime,
    test_id     String,
    domain_id   LowCardinality(String),
    campaign_id String,
    provider    LowCardinality(String),
    -- PRIMARY|PROMOTIONS|UPDATES|SOCIAL|SPAM|MISSING|UNKNOWN
    folder      LowCardinality(String),
    latency_ms  UInt32,
    headers     String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (domain_id, provider, ts);

CREATE TABLE IF NOT EXISTS dmarc_rows
(
    ts             DateTime,
    domain         LowCardinality(String),
    reporter       LowCardinality(String),
    report_id      String,
    source_ip      String,
    count          UInt32,
    disposition    LowCardinality(String),
    dkim_result    LowCardinality(String),
    spf_result     LowCardinality(String),
    header_from    String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (domain, ts, source_ip);

CREATE TABLE IF NOT EXISTS ai_calls
(
    ts             DateTime64(3),
    org_id         LowCardinality(String),
    task_id        LowCardinality(String),
    prompt_version LowCardinality(String),
    model          LowCardinality(String),
    input_tokens   UInt32,
    output_tokens  UInt32,
    cost_usd       Float64,
    latency_ms     UInt32,
    cache_hit      UInt8,
    schema_valid   UInt8,
    degraded       UInt8,
    confidence     Float32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (task_id, ts);
