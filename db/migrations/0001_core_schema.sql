-- Espelho local da migration "core_schema" aplicada via Supabase MCP em mjojuycrkxidpkzyzuuz.
-- Fonte de verdade é o banco remoto; este arquivo existe para versionamento e review.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

create table candidato (
  id                uuid primary key default gen_random_uuid(),
  nome_civil        text not null,
  nome_urna         text not null,
  cpf_hash          text,
  id_tse            text,
  id_camara         integer,
  id_senado         integer,
  partido_atual     text,
  uf                text,
  cargo_pretendido  text,
  foto_url          text,
  busca             tsvector generated always as (
                      to_tsvector('portuguese', coalesce(nome_civil,'') || ' ' || coalesce(nome_urna,''))
                    ) stored,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index candidato_id_tse_uk on candidato (id_tse) where id_tse is not null;
create unique index candidato_id_camara_uk on candidato (id_camara) where id_camara is not null;
create unique index candidato_id_senado_uk on candidato (id_senado) where id_senado is not null;
create index candidato_busca_idx on candidato using gin (busca);
create index candidato_nome_trgm_idx on candidato using gin (nome_civil extensions.gin_trgm_ops);

create table candidato_alias (
  id            uuid primary key default gen_random_uuid(),
  candidato_id  uuid not null references candidato(id) on delete cascade,
  alias         text not null,
  origem        text not null check (origem in ('tse','imprensa','social')),
  confianca     numeric not null check (confianca >= 0 and confianca <= 1),
  created_at    timestamptz not null default now()
);
create index candidato_alias_candidato_idx on candidato_alias (candidato_id);
create index candidato_alias_alias_trgm_idx on candidato_alias using gin (alias extensions.gin_trgm_ops);

create table perfil_social (
  id            uuid primary key default gen_random_uuid(),
  candidato_id  uuid not null references candidato(id) on delete cascade,
  plataforma    text not null check (plataforma in ('youtube','bluesky','instagram','x','threads','facebook')),
  handle        text not null,
  url           text not null,
  verificado    boolean not null default false,
  seguidores    integer,
  coletado_em   timestamptz,
  unique (candidato_id, plataforma)
);
create index perfil_social_candidato_idx on perfil_social (candidato_id);

create table raw_payload (
  id            uuid primary key default gen_random_uuid(),
  fonte         text not null,
  payload       jsonb not null,
  hash_conteudo text not null unique,
  coletado_em   timestamptz not null default now()
);
create index raw_payload_fonte_idx on raw_payload (fonte);

create table evento (
  id                uuid primary key default gen_random_uuid(),
  candidato_id      uuid not null references candidato(id) on delete cascade,
  tipo              text not null check (tipo in ('proposicao','voto','processo','sancao','despesa','nomeacao','post','anuncio')),
  categoria         text not null check (categoria in ('realizacao','controversia','neutro')),
  estagio_juridico  text check (
                      (tipo = 'processo' and estagio_juridico in (
                        'denuncia','investigacao_aberta','acao_recebida','condenacao_1a_instancia',
                        'condenacao_colegiado','transito_julgado','arquivado','absolvido'
                      ))
                      or (tipo <> 'processo' and estagio_juridico is null)
                    ),
  tema              text[] not null default '{}',
  titulo            text not null,
  resumo            text,
  data_evento       date not null,
  fonte_nome        text not null,
  fonte_url         text not null,
  fonte_confianca   smallint not null check (fonte_confianca in (1,2,3)),
  payload_raw_id    uuid references raw_payload(id),
  hash_conteudo     text not null unique,
  revisado_humano   boolean not null default false,
  created_at        timestamptz not null default now()
);
create index evento_candidato_idx on evento (candidato_id);
create index evento_tipo_idx on evento (tipo);
create index evento_categoria_idx on evento (categoria);
create index evento_data_idx on evento (data_evento desc);
create index evento_tema_idx on evento using gin (tema);

create table metrica (
  id            uuid primary key default gen_random_uuid(),
  candidato_id  uuid not null references candidato(id) on delete cascade,
  chave         text not null,
  valor         numeric not null,
  periodo       daterange,
  calculado_em  timestamptz not null default now()
);
create index metrica_candidato_chave_idx on metrica (candidato_id, chave);

alter table candidato enable row level security;
alter table candidato_alias enable row level security;
alter table perfil_social enable row level security;
alter table evento enable row level security;
alter table metrica enable row level security;
alter table raw_payload enable row level security;

-- Leitura pública: candidato, perfil_social, metrica sempre; evento só quando
-- não for controvérsia ou já tiver passado por revisão humana (ver seção 9 do projeto).
-- candidato_alias e raw_payload não têm policy pública: são internos, acessados via service_role.
create policy "public read candidato" on candidato for select using (true);
create policy "public read perfil_social" on perfil_social for select using (true);
create policy "public read evento" on evento for select using (
  revisado_humano = true or categoria <> 'controversia'
);
create policy "public read metrica" on metrica for select using (true);
