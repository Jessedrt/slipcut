create table if not exists tg_chats (
  chat_id text primary key,
  created_at timestamptz not null default now()
);

alter table study_slips add column if not exists hit integer;
alter table study_slips add column if not exists lost integer;
alter table study_slips add column if not exists won integer;
