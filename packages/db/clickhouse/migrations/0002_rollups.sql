-- Hourly rollups. Aggregate reads must never scan raw transactions.

CREATE TABLE IF NOT EXISTS mailbox_hourly
(
    hour        DateTime,
    mailbox_id  String,
    domain_id   LowCardinality(String),
    esp_family  LowCardinality(String),
    sent        UInt64,
    delivered   UInt64,
    deferred    UInt64,
    bounced     UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(hour)
ORDER BY (mailbox_id, esp_family, hour);

CREATE MATERIALIZED VIEW IF NOT EXISTS mailbox_hourly_mv TO mailbox_hourly AS
SELECT
    toStartOfHour(ts)                          AS hour,
    mailbox_id,
    domain_id,
    esp_family,
    count()                                    AS sent,
    countIf(status = 'sent')                   AS delivered,
    countIf(status = 'deferred')               AS deferred,
    countIf(status = 'bounced')                AS bounced
FROM smtp_transactions
GROUP BY hour, mailbox_id, domain_id, esp_family;

-- Per-ESP deferral rate in 15-minute buckets. This is the signal the adaptive
-- pacing bucket in @ems/router tunes itself from (E07-035).
CREATE TABLE IF NOT EXISTS esp_defer_15m
(
    bucket     DateTime,
    ip_id      LowCardinality(String),
    esp_family LowCardinality(String),
    attempts   UInt64,
    deferrals  UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(bucket)
ORDER BY (ip_id, esp_family, bucket);

CREATE MATERIALIZED VIEW IF NOT EXISTS esp_defer_15m_mv TO esp_defer_15m AS
SELECT
    toStartOfInterval(ts, INTERVAL 15 MINUTE) AS bucket,
    ip_id,
    esp_family,
    count()                                   AS attempts,
    countIf(status = 'deferred')              AS deferrals
FROM smtp_transactions
GROUP BY bucket, ip_id, esp_family;

CREATE TABLE IF NOT EXISTS campaign_funnel_daily
(
    day         Date,
    org_id      LowCardinality(String),
    campaign_id String,
    queued      UInt64,
    delivered   UInt64,
    bounced     UInt64,
    replied     UInt64,
    unsubscribed UInt64,
    complained  UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (org_id, campaign_id, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS campaign_funnel_daily_mv TO campaign_funnel_daily AS
SELECT
    toDate(ts)                        AS day,
    org_id,
    campaign_id,
    countIf(type = 'queued')          AS queued,
    countIf(type = 'delivered')       AS delivered,
    countIf(type = 'bounced')         AS bounced,
    countIf(type = 'replied')         AS replied,
    countIf(type = 'unsubscribed')    AS unsubscribed,
    countIf(type = 'complained')      AS complained
FROM email_events
GROUP BY day, org_id, campaign_id;
