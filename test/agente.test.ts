import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Atendimento } from "../src/agente.ts";
import { fileURLToPath } from "node:url";
import { CONFIG_PADRAO, carregarConfig, validarConfig } from "../src/config.ts";
import { resumoSemana, situacaoHorario } from "../src/horario.ts";
import { MARCA_HUMANO, ProvedorLlm, montarInstrucoes } from "../src/llm.ts";
import { buscar } from "../src/motor.ts";
import { semear } from "../src/semente.ts";
import { contemTermo, tokens } from "../src/texto.ts";

// segunda-feira, 12h em São Paulo (UTC-3)
const SEG_MEIO_DIA = new Date("2026-11-09T15:00:00Z");
const SEG_23H = new Date("2026-11-10T02:00:00Z");
const SAB_14H = new Date("2026-11-14T17:00:00Z");
const DOM_10H = new Date("2026-11-15T13:00:00Z");

function novo(agora = SEG_MEIO_DIA) {
  return new Atendimento({ config: structuredClone(CONFIG_PADRAO), relogio: () => agora });
}

describe("texto", () => {
  it("ignora acento, caixa e plural", () => {
    assert.deepEqual(tokens("Vocês ENTREGAM Flores?"), tokens("entrega flor"));
  });
  it("encontra termos por palavra inteira", () => {
    assert.equal(contemTermo("Quero falar com o ATENDENTE", ["atendente"]), "atendente");
    assert.equal(contemTermo("meu cancelamento", ["cancelar"]), null);
    assert.equal(contemTermo("sem acentuação: reclamação", ["reclamacao"]), "reclamacao");
  });
});

describe("horário", () => {
  it("abre em dia útil dentro da faixa", () => {
    const h = situacaoHorario(CONFIG_PADRAO, SEG_MEIO_DIA);
    assert.equal(h.aberto, true);
    assert.equal(h.fechaAs, "18:00");
  });
  it("à noite informa abertura de amanhã", () => {
    const h = situacaoHorario(CONFIG_PADRAO, SEG_23H);
    assert.deepEqual([h.aberto, h.proximaAbertura], [false, "amanhã às 09:00"]);
  });
  it("sábado à tarde aponta para segunda e domingo para amanhã", () => {
    assert.equal(situacaoHorario(CONFIG_PADRAO, SAB_14H).proximaAbertura, "segunda-feira às 09:00");
    assert.equal(situacaoHorario(CONFIG_PADRAO, DOM_10H).proximaAbertura, "amanhã às 09:00");
  });
  it("resume a semana agrupando dias iguais", () => {
    assert.equal(resumoSemana(CONFIG_PADRAO), "seg a sex, das 09:00 às 18:00; sáb, das 09:00 às 13:00");
  });
});

describe("busca", () => {
  const casos: [string, string][] = [
    ["vocês entregam no domingo?", "faq:entrega"],
    ["aceita pix?", "faq:pagamento"],
    ["onde fica a loja?", "faq:endereco"],
    ["quanto tempo duram as rosas", "faq:duracao"],
    ["tem assinatura mensal", "faq:assinatura"],
    ["quanto custa a orquídea", "produto:orquidea"],
    ["girassol", "produto:girassois"],
  ];
  for (const [pergunta, esperado] of casos) {
    it(`"${pergunta}" -> ${esperado}`, () => {
      const [melhor] = buscar(CONFIG_PADRAO, pergunta);
      assert.equal(`${melhor.tipo}:${melhor.id}`, esperado);
    });
  }
  it("assunto fora da base fica abaixo do limiar", () => {
    const [melhor] = buscar(CONFIG_PADRAO, "qual a capital da frança");
    assert.ok(!melhor || melhor.confianca < CONFIG_PADRAO.transbordo.confiancaMinima);
  });
});

describe("conversa", () => {
  it("cumprimenta ao abrir, com o nome do cliente", () => {
    const at = novo();
    const c = at.criarConversa("Marina Costa");
    assert.match(c.mensagens[0].texto, /Olá, Marina!/);
    assert.match(c.mensagens[0].texto, /Casa Aurora/);
  });

  it("responde FAQ com a informação cadastrada", async () => {
    const at = novo();
    const c = at.criarConversa("Ana");
    const { novas } = await at.receber(c.id, "Vocês aceitam pix?");
    assert.equal(novas.length, 1);
    assert.match(novas[0].texto, /Pix, cartão de crédito em até 3x/);
    assert.equal(novas[0].meta?.fonte, "faq:pagamento");
  });

  it("não repete a saudação completa quando o cliente diz oi", async () => {
    const at = novo();
    const c = at.criarConversa("Ana");
    const { novas } = await at.receber(c.id, "oi");
    assert.equal(novas[0].texto, "Oi! Em que posso ajudar?");
  });

  it("pergunta de duração não vira lista de preços", async () => {
    const at = novo();
    const c = at.criarConversa("Ana");
    const { novas } = await at.receber(c.id, "quanto tempo duram as rosas?");
    assert.equal(novas[0].meta?.fonte, "faq:duracao");
  });

  it("informa preço do catálogo", async () => {
    const c = novo().criarConversa("Ana");
    const at = novo();
    const conv = at.criarConversa("Ana");
    const { novas } = await at.receber(conv.id, "quanto custa o buquê de girassóis?");
    assert.match(novas[0].texto, /R\$\s?119,00/);
    assert.ok(c);
  });

  it("responde horário e avisa quando está fechado", async () => {
    const at = novo(SEG_23H);
    const c = at.criarConversa("Ana");
    const { novas } = await at.receber(c.id, "qual o horário de vocês?");
    assert.match(novas[0].texto, /seg a sex, das 09:00 às 18:00/);
    assert.match(novas[0].texto, /fechados; voltamos amanhã às 09:00/);
  });

  it("transborda quando o cliente pede uma pessoa", async () => {
    const at = novo();
    const c = at.criarConversa("Ana");
    const { conversa, novas } = await at.receber(c.id, "quero falar com um atendente");
    assert.equal(conversa.estado, "humano");
    assert.equal(conversa.aguardandoHumano, true);
    assert.equal(conversa.motivoTransbordo, "Cliente pediu atendente");
    assert.match(novas[0].texto, /chamar uma pessoa/);
  });

  it("transborda direto em termo sensível, sem tentar responder", async () => {
    const at = novo();
    const c = at.criarConversa("Ana");
    const { conversa } = await at.receber(c.id, "vou chamar o Procon, isso é um absurdo");
    assert.match(conversa.motivoTransbordo ?? "", /Termo sensível/);
  });

  it("fora do horário, o transbordo diz quando a equipe volta", async () => {
    const at = novo(DOM_10H);
    const c = at.criarConversa("Ana");
    const { novas } = await at.receber(c.id, "preciso cancelar");
    assert.match(novas[0].texto, /amanhã às 09:00/);
  });

  it("pede para reformular uma vez e transborda na segunda falha seguida", async () => {
    const at = novo();
    const c = at.criarConversa("Ana");
    const a = await at.receber(c.id, "vocês vendem chocolate?");
    assert.equal(a.conversa.estado, "agente");
    assert.match(a.novas[0].texto, /Não tenho certeza/);
    const b = await at.receber(c.id, "e vinho?");
    assert.equal(b.conversa.estado, "humano");
    assert.match(b.conversa.motivoTransbordo ?? "", /sem resposta/);
  });

  it("uma resposta certa zera a contagem de falhas", async () => {
    const at = novo();
    const c = at.criarConversa("Ana");
    await at.receber(c.id, "vocês vendem chocolate?");
    await at.receber(c.id, "aceitam pix?");
    const { conversa } = await at.receber(c.id, "e vinho?");
    assert.equal(conversa.estado, "agente");
  });

  it("com a conversa nas mãos de uma pessoa, o agente fica em silêncio", async () => {
    const at = novo();
    const c = at.criarConversa("Ana");
    await at.receber(c.id, "quero um atendente");
    at.assumir(c.id, "Luiz");
    const { novas, conversa } = await at.receber(c.id, "aceitam pix?");
    assert.deepEqual(novas, []);
    assert.equal(conversa.mensagens.at(-1)?.de, "cliente");
  });

  it("só quem assumiu responde, e outra pessoa não rouba a conversa", async () => {
    const at = novo();
    const c = at.criarConversa("Ana");
    await at.receber(c.id, "quero um atendente");
    assert.throws(() => at.responderHumano(c.id, "oi"), /assuma a conversa/);
    at.assumir(c.id, "Luiz");
    assert.throws(() => at.assumir(c.id, "Camila"), /já assumiu/);
    at.responderHumano(c.id, "Oi, Ana!");
    assert.equal(at.obter(c.id).mensagens.at(-1)?.de, "humano");
  });

  it("devolver ao agente retoma as respostas automáticas", async () => {
    const at = novo();
    const c = at.criarConversa("Ana");
    await at.receber(c.id, "quero um atendente");
    at.assumir(c.id, "Luiz");
    at.devolver(c.id);
    const { novas } = await at.receber(c.id, "aceitam pix?");
    assert.equal(novas.length, 1);
  });

  it("rejeita mensagem vazia e conversa inexistente", async () => {
    const at = novo();
    const c = at.criarConversa("Ana");
    await assert.rejects(at.receber(c.id, "   "), /vazia/);
    await assert.rejects(at.receber("nao-existe", "oi"), /não encontrada/);
  });

  it("reabre conversa encerrada quando o cliente volta", async () => {
    const at = novo();
    const c = at.criarConversa("Ana");
    at.encerrar(c.id);
    const { conversa } = await at.receber(c.id, "aceitam pix?");
    assert.equal(conversa.estado, "agente");
  });
});

describe("tom de voz", () => {
  it("formal não usa emoji e muda a abertura", async () => {
    const config = structuredClone(CONFIG_PADRAO);
    config.tom = { estilo: "formal", emoji: true, assinatura: "" };
    const at = new Atendimento({ config, relogio: () => SEG_MEIO_DIA });
    const c = at.criarConversa("Ana");
    const { novas } = await at.receber(c.id, "aceitam pix?");
    assert.match(novas[0].texto, /^(Prezado\(a\), |Informamos que )/);
    assert.doesNotMatch(novas[0].texto, /😊|😄/);
  });
  it("descontraído com emoji desligado não coloca emoji", async () => {
    const config = structuredClone(CONFIG_PADRAO);
    config.tom = { estilo: "descontraido", emoji: false, assinatura: "" };
    const at = new Atendimento({ config, relogio: () => SEG_MEIO_DIA });
    const c = at.criarConversa("Ana");
    const { novas } = await at.receber(c.id, "aceitam pix?");
    assert.doesNotMatch(novas[0].texto, /😊|😄/);
    assert.match(novas[0].texto, /^(Opa|Bora)/);
  });
});

describe("configuração", () => {
  it("troca a base de conhecimento sem reiniciar", async () => {
    const at = novo();
    const config = structuredClone(at.config);
    config.faq.push({ id: "pet", pergunta: "Posso levar meu cachorro na loja?", resposta: "Pets são bem-vindos!", palavras: ["cachorro", "pet", "gato"] });
    at.atualizarConfig(config);
    const c = at.criarConversa("Ana");
    const { novas } = await at.receber(c.id, "posso levar meu cachorro?");
    assert.match(novas[0].texto, /Pets são bem-vindos/);
  });
  it("rejeita horário e limiar inválidos", () => {
    const ruim = structuredClone(CONFIG_PADRAO) as any;
    ruim.horario.semana.seg = ["18:00", "09:00"];
    assert.throws(() => validarConfig(ruim), /horário inválido/);
    const ruim2 = structuredClone(CONFIG_PADRAO) as any;
    ruim2.transbordo.confiancaMinima = 3;
    assert.throws(() => validarConfig(ruim2), /entre 0 e 1/);
  });
});

describe("outra empresa, só trocando o arquivo de configuração", () => {
  it("a clínica de exemplo responde com a própria base, sem tocar no código", async () => {
    const config = carregarConfig(fileURLToPath(new URL("../exemplos/clinica-odontologica.json", import.meta.url)));
    const at = new Atendimento({ config, relogio: () => SEG_MEIO_DIA });
    const c = at.criarConversa("Paulo");
    assert.match(c.mensagens[0].texto, /Clínica Sorriso Claro/);
    const { novas } = await at.receber(c.id, "vocês fazem clareamento?");
    assert.match(novas[0].texto, /clareamento de consultório/);
    assert.doesNotMatch(novas[0].texto, /😊/);
    const u = await at.receber(c.id, "estou com dor forte no dente");
    assert.equal(u.conversa.estado, "humano");
  });
});

describe("provedor de LLM", () => {
  const ctxBase = () => {
    const at = novo();
    return { config: at.config, historico: [], mensagem: "oi", agora: SEG_MEIO_DIA, candidatos: [], aberto: true, proximaAbertura: "agora", nomeCliente: "Ana" };
  };
  it("as instruções carregam FAQ, catálogo e a regra de não inventar", () => {
    const t = montarInstrucoes(ctxBase());
    assert.match(t, /Casa Aurora Floricultura/);
    assert.match(t, /Orquídea Phalaenopsis/);
    assert.ok(t.includes(MARCA_HUMANO));
  });
  it("usa a resposta do modelo e envia a chave", async () => {
    let cabecalho = "";
    const fetchFn = (async (_u: string, init: RequestInit) => {
      cabecalho = (init.headers as Record<string, string>).authorization;
      return new Response(JSON.stringify({ choices: [{ message: { content: "Resposta do modelo" } }] }));
    }) as unknown as typeof fetch;
    const r = await new ProvedorLlm({ chave: "segredo", fetchFn }).responder(ctxBase());
    assert.equal(r.texto, "Resposta do modelo");
    assert.equal(cabecalho, "Bearer segredo");
  });
  it("a marca de humano vira transbordo", async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ choices: [{ message: { content: MARCA_HUMANO } }] }))) as unknown as typeof fetch;
    const r = await new ProvedorLlm({ chave: "k", fetchFn }).responder(ctxBase());
    assert.equal(r.transbordar, true);
  });
  it("se a API cair, o motor local responde", async () => {
    const fetchFn = (async () => new Response("erro", { status: 500 })) as unknown as typeof fetch;
    const ctx = { ...ctxBase(), mensagem: "aceitam pix?" };
    const candidatos = buscar(ctx.config, ctx.mensagem);
    const r = await new ProvedorLlm({ chave: "k", fetchFn }).responder({ ...ctx, candidatos });
    assert.match(r.texto, /Pix/);
  });
});

describe("métricas e semente", () => {
  it("calcula resolução automática, transbordos e lacunas com as conversas de exemplo", async () => {
    const at = novo();
    await semear(at);
    const m = at.metricas();
    assert.equal(m.totalConversas, 10);
    assert.ok(m.aguardandoHumano >= 1);
    assert.ok(m.taxaTransbordo > 0 && m.taxaTransbordo < 60);
    assert.equal(m.resolucaoAutomatica + m.taxaTransbordo, 100);
    assert.ok(m.esperaMediaHumanoMin !== null && m.esperaMediaHumanoMin > 0);
    assert.ok(m.lacunas.some((l) => /chocolate/.test(l.pergunta)));
    assert.equal(m.porDia.length, 7);
    assert.ok(m.topicos.length > 0);
  });
});
