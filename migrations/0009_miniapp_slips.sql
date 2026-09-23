create table if not exists miniapp_slips (
  id text primary key,
  telegram_user_id text not null,
  booking_code text not null,
  sport text not null,
  selection_count integer not null,
  combined_odds real,
  status text not null default 'created',
  picks_json text not null,
  created_at timestamptz not null default now()
);

create index if not exists miniapp_slips_user_created_idx
  on miniapp_slips (telegram_user_id, created_at desc);
