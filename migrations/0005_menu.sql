create table if not exists desk_ledger (
  id serial primary key,
  code text,
  stake real not null,
  combo real,
  returned real,
  created_at timestamptz not null default now()
);

create table if not exists desk_allows (
  value text primary key
);

create table if not exists desk_pings (
  code text primary key,
  sent_at timestamptz not null default now()
);
