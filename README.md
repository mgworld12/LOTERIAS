# Loterias CAIXA — Análise & Estratégias (versão 2)

Aplicativo web instalável (PWA), com gerador, painel estatístico, análises retrospectivas, conferência de jogos, importação/exportação e base local para nove modalidades: Mega-Sena, Lotofácil, Quina, Lotomania, Dupla Sena, Dia de Sorte, Timemania, Super Sete e +Milionária.

## Publicar no GitHub Pages (recomendado)

Esta versão foi preparada para ser um **site estático hospedado no GitHub Pages**, sem servidor local e sem instalação de programas no computador do visitante.

1. Crie um repositório no GitHub (por exemplo, `loterias-caixa`).
2. Envie todos os arquivos e pastas deste pacote para a raiz do repositório, preservando `.github/workflows`, `scripts`, `data` e `icons`.
3. Em **Settings → Pages**, selecione **GitHub Actions** como fonte de publicação.
4. Em **Actions**, habilite os workflows, se o GitHub solicitar. Execute manualmente `Atualizar resultados CAIXA` uma vez para gerar o primeiro espelho.
5. O workflow `Publicar site no GitHub Pages` publica o site após cada envio à branch `main`. O endereço será exibido na execução do workflow de publicação.

Não é necessário executar `python -m http.server` nem manter o computador ligado para que o site fique disponível.

## Atualização automática dos resultados

- O workflow `.github/workflows/update-results.yml` consulta o endpoint JSON usado pelo Portal Loterias CAIXA a cada seis horas e também pode ser executado manualmente em **Actions**.
- Os resultados validados são gravados em `data/results.json` e enviados ao repositório. O site lê esse arquivo quando é aberto ou quando o usuário solicita atualização.
- O workflow mantém um espelho incremental a partir da primeira execução. Se for necessário reconstruir o histórico desde o primeiro concurso, use no aplicativo **Carregar histórico completo das 9 modalidades**; essa carga inicial ainda é feita pelo navegador e pode levar bastante tempo.
- O histórico completo carregado pelo navegador é armazenado no IndexedDB daquele navegador/dispositivo. Não é sincronizado entre aparelhos. O espelho publicado pelo GitHub contém os resultados capturados pelo workflow desde sua primeira execução.
- GitHub Actions pode atrasar execuções agendadas, especialmente em períodos de alta demanda. O agendamento não é garantia de atualização no minuto do sorteio.

## Limitações da integração

A CAIXA não oferece uma API pública de resultados documentada e com garantia de estabilidade. O workflow consulta o endpoint JSON utilizado pelo Portal (`servicebus2.caixa.gov.br/portaldeloterias/api/{modalidade}`), que não é documentado e pode mudar. O processo valida modalidade, concurso, data e campos de resultado antes de gravar. Falhas são registradas no JSON como atualização parcial; dados não confirmados não devem ser tratados como resultados oficiais.

O site continua funcionando como aplicação estática. O GitHub Actions executa a consulta agendada e atualiza o arquivo público; não há backend próprio, login ou sincronização de jogos pessoais.

## Modalidades especiais

- Dupla Sena: os dois sorteios do concurso são armazenados e considerados nas frequências e na comparação retrospectiva.
- Dia de Sorte: inclui o mês da sorte.
- Timemania: exige o preenchimento do time do coração no jogo.
- Super Sete: sete colunas, com 1 dígito por coluna na aposta mínima; apostas múltiplas seguem os limites de 7 a 21 prognósticos e as restrições de quantidade por coluna.
- +Milionária: inclui dois trevos da sorte.
- Lotomania: o jogo contém 50 números entre 00 e 99; o resultado oficial tem 20 números.

## Dados e privacidade

Os concursos ficam no IndexedDB do navegador e os jogos salvos no armazenamento local. Não há conta, servidor próprio, sincronização entre dispositivos ou envio de dados pessoais. Use **Baixar backup completo** antes de limpar dados do navegador ou trocar de aparelho.

## Importação e exportação

O CSV simples cobre principalmente concurso, data e dezenas. Para dados especiais (segundo sorteio, trevos, mês, time e colunas), prefira a sincronização do Portal ou o backup JSON completo.

## Escopo desta versão

Esta entrega contempla as nove modalidades numéricas listadas e aprovadas na etapa anterior. Federal e Loteca não foram incluídas: possuem estruturas de resultado diferentes (extrações de bilhetes e palpites esportivos) e exigem módulos próprios.

## Limitação estatística

Frequência, atraso, equilíbrio e padrões são descrições de resultados passados. Nenhuma estratégia, filtro ou combinação aumenta a chance matemática de ganhar.

## Publicação e manutenção

- O arquivo `.nojekyll` evita processamento desnecessário do Jekyll.
- O Service Worker usa estratégia de rede primeiro para obter a versão mais recente do site e do espelho, mantendo cópia em cache para uso offline.
- Se o repositório usar uma branch diferente de `main`, ajuste `branches` em `.github/workflows/pages.yml`.

## Fontes

- Portal Loterias CAIXA: https://loterias.caixa.gov.br/
- Regras dos sorteios: https://loterias.caixa.gov.br/Paginas/regras-sorteios.aspx
- Regras do Super Sete: https://loterias.caixa.gov.br/Paginas/Super-sete.aspx
