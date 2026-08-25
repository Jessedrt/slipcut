create table if not exists study_slips (
  code text primary key,
  picks_json text not null,
  studied integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists study_lessons (
  id serial primary key,
  code text,
  family text not null,
  league text not null default '',
  selection text not null default '',
  sport text not null default '',
  result text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists study_lessons_family_idx on study_lessons (family);
create index if not exists study_slips_created_idx on study_slips (created_at desc);
