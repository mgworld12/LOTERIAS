# Loterias CAIXA — Análise & Estratégias

Aplicativo web instalável (PWA) com gerador de jogos, estatísticas, análises retrospectivas, conferência de jogos, importação/exportação e backup para nove modalidades: Mega-Sena, Lotofácil, Quina, Lotomania, Dupla Sena, Dia de Sorte, Timemania, Super Sete e +Milionária. Federal e Loteca não estão incluídas.

> Frequência, atraso e padrões descrevem concursos passados. Nenhuma estratégia aumenta a chance matemática de ganhar.

## Estrutura

```
index.html  style.css  script.js  conferir.js  service-worker.js  manifest.json
vendor/jsQR.js              leitor de QR Code (jsQR 1.4.0, licença Apache-2.0)
icons/                      ícones (SVG, PNG, maskable, apple-touch)
data/index.json             resumo pequeno lido primeiro pelo site
data/<modalidade>.json      um arquivo por modalidade (gerado pelo workflow)
scripts/update_caixa.py     atualizador incremental
.github/workflows/          pages.yml (publica) e update-results.yml (atualiza dados)
```

## Publicar

1. Envie todos os arquivos para a raiz do repositório (atenção a `.github/workflows`, `.gitignore` e `.nojekyll`, que começam com ponto).
2. **Settings → Pages → Source: GitHub Actions**.
3. **Actions → Atualizar resultados CAIXA → Run workflow**. O workflow trabalha em **rodadas de ~10 minutos**: ao fim de cada rodada ele grava, faz commit e republica o site. Os concursos são buscados **do mais recente para o mais antigo**, alternando as modalidades; por isso o app já fica utilizável na primeira rodada e o histórico antigo vai sendo completado nas seguintes (até ~5 h por execução, depois a cada 6 h).

## Uso no app

- Na primeira visita o app baixa a base publicada **uma única vez**, em segundo plano (você pode usar as abas enquanto isso).
- Depois disso o app **não consulta a rede sozinho**. Para buscar novidades, clique em **Atualizar resultados**: ele baixa só as modalidades que mudaram.
- Clicar em um jogo no Painel geral o seleciona (fundo claro na cor do jogo) e o usa no Gerador, Estatísticas e Análises.

## Como funciona a atualização

- `update_caixa.py` (uma rodada) consulta o endpoint JSON do Portal Loterias CAIXA (`servicebus2.caixa.gov.br/portaldeloterias/api/{modalidade}`), **não documentado e sujeito a mudanças**. Se a CAIXA bloquear os servidores do GitHub (HTTP 403/5xx seguidos), a modalidade é pausada e registrada em `errors` no `index.json`.
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

## Conferir bilhete (QR Code)

A aba **Conferir bilhete** confere jogos com o resultado salvo no dispositivo (por padrão, o último concurso).

- **Leitura do QR:** câmera (`getUserMedia`, exige HTTPS — o GitHub Pages atende), foto do QR, ou colar o texto lido por qualquer leitor. Usa `BarcodeDetector` quando o navegador tem e, caso contrário, o jsQR (`vendor/jsQR.js`).
- **Limitação importante:** a CAIXA **não documenta** o conteúdo do QR dos bilhetes. A leitura tenta extrair modalidade, concurso e dezenas de URLs com parâmetros, JSON, `chave=valor` ou texto com números separados. Se o QR for um código interno, o app mostra o conteúdo lido e o usuário digita as dezenas (um jogo por linha). Se o conteúdo vier em um formato que o app ainda não reconhece, o texto lido pode ser usado para ajustar `parseTicketQR()` em `conferir.js`.
- **Faixas:** a indicação de premiação segue as regras gerais de acertos de cada modalidade; valores e resgate seguem no App/Portal Loterias CAIXA. O comprovante da lotérica é o documento oficial.

## Outros recursos (v3)

Gráficos de frequência e atraso nas Estatísticas, compartilhar jogos (copiar/WhatsApp), próximo sorteio nos cartões (campo `next` do `index.json`), aviso de dados antigos, importar/exportar jogos salvos em JSON, estado da base (Base de dados), esqueleto de carregamento, fonte do título (Aparência) e atalhos do app instalado.
