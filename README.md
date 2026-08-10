# Monitor de Candidatos

Plataforma de agregação de dados públicos sobre candidatos à Presidência da
República. Ver [projeto-monitor-candidatos.md](./projeto-monitor-candidatos.md)
para a arquitetura completa e princípios de design (o app **não emite
veredito** — o usuário define os pesos, o score roda no cliente).

## Supabase

- Organização: **GLE TECH**
- Projeto: **monitor-candidatos** (`mjojuycrkxidpkzyzuuz`, região `sa-east-1`)
- Schema aplicado: `db/migrations/0001_core_schema.sql` (candidato,
  candidato_alias, perfil_social, raw_payload, evento, metrica) com RLS
  de leitura pública e a regra de `estagio_juridico` obrigatório só para
  `tipo = 'processo'`.

## Estrutura do monorepo

```
db/migrations/     migrations SQL (espelho do que foi aplicado no Supabase)
packages/api/       API REST — Node.js + Fastify
packages/workers/   Coletores por fonte oficial (framework + adaptadores)
apps/web/           Frontend — React + Vite + Tailwind
```

Cada pasta tem seu próprio `README.md` com instruções de setup e execução.

## Setup

1. Copie `.env.example` para `.env` em cada pacote que precisar (api,
   workers, apps/web) e preencha `SUPABASE_SERVICE_ROLE_KEY` (dashboard
   Supabase → Project Settings → API — necessário só para os workers
   gravarem dados, nunca usar no frontend).
2. `packages/api` e `packages/workers` leem o Postgres via Supabase.
3. `apps/web` consome a API em `VITE_API_URL`.

## Estado atual (Fase 0 → início da Fase 1)

- [x] Schema do banco no Supabase
- [ ] Framework de coletor + coletor da Câmara dos Deputados
- [ ] API REST (candidatos, eventos, métricas)
- [ ] Frontend: perfil + timeline + painel de pesos
- [ ] Seed de candidatos + validação end-to-end
