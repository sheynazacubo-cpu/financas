-- Finanças da família: cole tudo isto no Supabase → SQL Editor → Run
create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type        text not null check (type in ('entrada', 'saida')),
  amount      numeric(14,2) not null check (amount > 0),
  category    text not null default 'Outros',
  description text,
  occurred_at date not null default current_date,
  created_by  text,
  created_at  timestamptz not null default now()
);

create index if not exists transactions_user_date on public.transactions (user_id, occurred_at desc);

alter table public.transactions enable row level security;

grant select, insert, update, delete on public.transactions to authenticated;
revoke all on public.transactions from anon;

drop policy if exists "own rows select" on public.transactions;
drop policy if exists "own rows insert" on public.transactions;
drop policy if exists "own rows update" on public.transactions;
drop policy if exists "own rows delete" on public.transactions;

create policy "own rows select" on public.transactions for select to authenticated using (user_id = auth.uid());
create policy "own rows insert" on public.transactions for insert to authenticated with check (user_id = auth.uid());
create policy "own rows update" on public.transactions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows delete" on public.transactions for delete to authenticated using (user_id = auth.uid());

-- Atualização em tempo real entre os telemóveis
do $$ begin
  alter publication supabase_realtime add table public.transactions;
exception when duplicate_object then null; end $$;
