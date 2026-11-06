# Loterias CAIXA — Análise & Estratégias

Aplicativo web instalável (PWA) com gerador de jogos, estatísticas, análises retrospectivas, conferência de jogos, importação/exportação e backup para nove modalidades: Mega-Sena, Lotofácil, Quina, Lotomania, Dupla Sena, Dia de Sorte, Timemania, Super Sete e +Milionária. Federal e Loteca não estão incluídas.

> Frequência, atraso e padrões descrevem concursos passados. Nenhuma estratégia aumenta a chance matemática de ganhar.

## Estrutura

```
index.html  style.css  script.js  service-worker.js  manifest.json
icons/                      ícones (SVG, PNG, maskable, apple-touch)
data/index.json             resumo pequeno lido primeiro pelo site
data/<modalidade>.json      um arquivo por modalidade (gerado pelo workflow)
scripts/update_caixa.py     atualizador incremental
.github/workflows/          pages.yml (publica) e update-results.yml (atualiza dados)
```

## Publicar

1. Envie todos os arquivos para a raiz do repositório (atenção a `.github/workflows`, `.gitignore` e `.nojekyll`, que começam com ponto).
2. **Settings → Pages → Source: GitHub Actions**.
3. **Actions → Atualizar resultados CAIXA → Run workflow**. A primeira carga busca ~23 mil concursos e leva horas; o script grava checkpoints, para sozinho antes do limite de 6 h e **continua de onde parou** na execução seguinte (a cada 6 h, ou manualmente).
4. Ao terminar, o workflow aciona o `pages.yml` para republicar o site com os dados novos.

## Como funciona a atualização

- `update_caixa.py` consulta o endpoint JSON do Portal Loterias CAIXA (`servicebus2.caixa.gov.br/portaldeloterias/api/{modalidade}`), **não documentado e sujeito a mudanças**. Se a CAIXA bloquear os servidores do GitHub (HTTP 403/5xx seguidos), a modalidade é pausada e registrada em `errors` no `index.json`.
- Concursos com problema são **pulados e registrados**, sem travar os demais; lacunas são preenchidas nas próximas execuções.
- Concursos sem algum campo extra (time, mês da sorte, trevos, 2º sorteio) ficam marcados com `"incomplete": true` e continuam nas estatísticas das dezenas principais.
- `index.json` informa, por modalidade, `count`, `latest`, `missing`, `updatedAt`. O site só baixa o arquivo da modalidade cujo `updatedAt` mudou.
- **Mega da Virada**: é um concurso especial da Mega-Sena (mesma numeração), então já vem no histórico dela. O atualizador marca essas edições com `specialDraw: "mega-da-virada"` (pelo nome do concurso especial na API ou pela data de 31/12). No site há um cartão próprio no Painel geral e, para a Mega-Sena, o seletor **Concursos considerados → Somente Mega da Virada** no Gerador, nas Estatísticas e nas Análises especiais.
- Commits feitos com `GITHUB_TOKEN` não disparam outros workflows; por isso o `update-results.yml` chama o `pages.yml` explicitamente.

## Dados e privacidade

Concursos ficam no IndexedDB do navegador e os jogos salvos no armazenamento local; nada é enviado a servidor. Não há sincronização entre aparelhos: use **Baixar backup completo**.

## Modalidades especiais

Dupla Sena (dois sorteios), Dia de Sorte (mês da sorte), Timemania (time do coração), Super Sete (7 colunas), +Milionária (dois trevos), Lotomania (aposta de 50 números; resultado de 20).

## Fontes

- https://loterias.caixa.gov.br/
- https://loterias.caixa.gov.br/Paginas/regras-sorteios.aspx
