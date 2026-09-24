create table if not exists recommendation_record (
  id text primary key,
  event_id text not null,
  market_id text not null,
  outcome_id text not null,
  specifier text not null default '',
  sport text not null,
  family text not null,
  market text not null,
  selection text not null,
  odds real not null,
  kickoff timestamptz not null,
  result text not null default 'pending',
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists recommendation_record_pending_idx
  on recommendation_record (kickoff) where result = 'pending';
create index if not exists recommendation_record_history_idx
  on recommendation_record (sport, family, odds, result);
