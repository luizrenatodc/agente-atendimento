# Arquitetura

Visão do código como ele está hoje. Tudo em `src/`, TypeScript rodado direto pelo Node 24, sem dependências.

## Módulos

| Arquivo | Responsabilidade |
|---|---|
| `servidor.ts` | Ponto de entrada. Lê variáveis de ambiente, carrega a configuração, cria o `Atendimento` e sobe o HTTP. Na primeira execução semeia conversas de exemplo (`SEMEAR=0` desliga). |
| `app.ts` | Servidor HTTP (`node:http`): rotas da API, arquivos estáticos de `public/`, limite de corpo, cabeçalhos de segurança e token do painel. |
| `agente.ts` | Classe `Atendimento`: conversas em memória, decisão de responder ou transbordar, ações da equipe, persistência em arquivo. Também define `ErroNegocio` (erro com status HTTP). |
| `motor.ts` | Busca na base (FAQ e catálogo), detecção de intenções simples e o `ProvedorLocal`, que responde sem rede nem chave. |
| `llm.ts` | `ProvedorLlm`: mesma interface, mas pergunta a um modelo (API no formato chat completions). Se a chamada falhar, cai no `ProvedorLocal`. |
| `config.ts` | Configuração padrão, `validarConfig` (valida e completa), `carregarConfig` e `salvarConfig`. |
| `horario.ts` | Está aberto agora? Quando abre de novo? Resumo legível da semana. Respeita o fuso da empresa. |
| `texto.ts` | Normalização (acento, caixa, pontuação), radicais, palavras vazias, formatação de dinheiro e preenchimento de `{chaves}`. |
| `tom.ts` | Aplica o tom de voz (cordial, formal, descontraído) e o emoji. |
| `metricas.ts` | Calcula os números do painel a partir das conversas. |
| `semente.ts` | Roteiros de conversas de exemplo, que passam pelo motor de verdade. |
| `tipos.ts` | Tipos compartilhados (`Config`, `Conversa`, `Mensagem`, `Provedor`...). |

## Caminho de uma mensagem do cliente

`Atendimento.receber(id, texto)`:

1. Corta o texto em 1000 caracteres e recusa mensagem vazia (`400`). Conversa encerrada é reaberta.
2. Grava a mensagem como `cliente` e marca a conversa como não lida.
3. Se a conversa está com uma pessoa (`estado = "humano"`), o agente fica em silêncio.
4. Termo sensível (`transbordo.palavrasSensiveis`) ou pedido de atendente (`pedidoHumano`): transbordo imediato, com o motivo registrado.
5. Senão, `buscar()` ordena até 3 candidatos da base e o provedor decide a resposta.
6. Se o provedor pede transbordo, a conversa passa para uma pessoa. Se a confiança fica abaixo de `confiancaMinima`, conta uma falha: a primeira vez pede para reformular (`naoEntendi`) e, ao atingir `maxFalhas`, transborda. Uma resposta boa zera a contagem.
7. Fora do horário, a mensagem de transbordo ganha o aviso de quando a equipe volta.

## Busca na base

`buscar()` monta um documento por item de FAQ e por produto. Cada documento guarda os radicais do texto com um peso: palavras-chave da FAQ valem 1,4, a pergunta vale 1, o nome do produto 1,4 e a descrição 0,6. A pontuação é a soma do IDF dos radicais da pergunta que aparecem no documento, dividida pelo total possível. Radicais que não existem em nenhum documento pesam 0,4 do IDF máximo, o que baixa a confiança de perguntas fora do assunto. Palavras que só indicam preço (`quanto`, `valor`, `custa`...) não entram na busca; servem para escolher o tipo de resposta.

## Provedores

A interface é `Provedor.responder(contexto): Promise<Resposta>`. O contexto traz a configuração, o histórico, os candidatos da busca e o estado do horário. O `ProvedorLlm` monta as instruções só com o que está no painel (FAQ, catálogo, horário) e manda o modelo responder `[[HUMANO]]` quando não souber, o que vira transbordo. Qualquer erro de rede, HTTP ou resposta vazia cai no motor local, então o atendimento não para.

## API HTTP

Cliente (sem autenticação; as conversas são identificadas por um id aleatório):

| Rota | O que faz |
|---|---|
| `GET /api/publico` | nome e assinatura da empresa |
| `GET /api/saude` | `{ ok, provedor }` |
| `POST /api/conversas` | cria conversa (`nome`, `telefone`) |
| `GET /api/conversas/:id` | conversa, sem notas internas |
| `POST /api/conversas/:id/mensagens` | envia mensagem (`texto`) |

Painel da equipe (exige o cabeçalho `x-token` quando `ADMIN_TOKEN` está definido):

| Rota | O que faz |
|---|---|
| `GET /api/admin/conversas` | lista, mais recentes primeiro |
| `GET /api/admin/conversas/:id` | detalhe (marca como lida) |
| `POST /api/admin/conversas/:id/assumir` | uma pessoa assume (`atendente`) |
| `POST /api/admin/conversas/:id/responder` | resposta humana (`texto`) |
| `POST /api/admin/conversas/:id/devolver` | devolve ao agente |
| `POST /api/admin/conversas/:id/encerrar` | encerra |
| `GET` e `PUT /api/admin/config` | lê e grava a configuração, já validada |
| `GET /api/admin/metricas` | números do painel |
| `POST /api/admin/testar` | simula uma pergunta sem criar conversa |

Erros têm sempre a forma `{ "erro": "mensagem" }`. `ErroNegocio` carrega o status (400, 404, 409, 413); qualquer outro erro vira `500 erro interno` e é registrado no console.

## Persistência

Conversas ficam em memória e são gravadas em `ARQUIVO_ESTADO` a cada alteração: escreve em `.tmp` e renomeia, para um desligamento no meio não deixar o arquivo pela metade. A configuração fica em `ARQUIVO_CONFIG`, gravada quando o painel salva. Se um dos arquivos estiver corrompido, o servidor não sobe e o erro cita o arquivo.

## Limites

- Texto de mensagem: 1000 caracteres. Corpo de requisição: 200 000 bytes (`413`).
- Nome do cliente: 60 caracteres; telefone: 20; nome do atendente: 40.
- Estado em um único processo: não há trava entre várias instâncias gravando o mesmo arquivo.
