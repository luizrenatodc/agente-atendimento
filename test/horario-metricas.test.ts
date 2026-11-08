import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Atendimento } from "../src/agente.ts";
import { CONFIG_PADRAO } from "../src/config.ts";
import { resumoSemana, situacaoHorario } from "../src/horario.ts";
import { calcularMetricas } from "../src/metricas.ts";
import { DIAS } from "../src/tipos.ts";

// São Paulo é UTC-3 o ano todo desde 2019
const em = (iso: string) => new Date(iso);

describe("horário: limites", () => {
  it("abre exatamente na hora de início e fecha exatamente na hora de fim", () => {
    assert.equal(situacaoHorario(CONFIG_PADRAO, em("2026-11-09T12:00:00Z")).aberto, true); // seg 09:00
    assert.equal(situacaoHorario(CONFIG_PADRAO, em("2026-11-09T11:59:00Z")).aberto, false); // seg 08:59
    assert.equal(situacaoHorario(CONFIG_PADRAO, em("2026-11-09T20:59:00Z")).aberto, true); // seg 17:59
    assert.equal(situacaoHorario(CONFIG_PADRAO, em("2026-11-09T21:00:00Z")).aberto, false); // seg 18:00
  });

  it("antes da abertura, a próxima abertura é hoje", () => {
    const h = situacaoHorario(CONFIG_PADRAO, em("2026-11-09T10:00:00Z")); // seg 07:00
    assert.deepEqual([h.aberto, h.proximaAbertura], [false, "hoje às 09:00"]);
  });

  it("sábado fecha às 13h e sexta à noite aponta para sábado", () => {
    assert.equal(situacaoHorario(CONFIG_PADRAO, em("2026-11-14T15:59:00Z")).aberto, true); // sáb 12:59
    assert.equal(situacaoHorario(CONFIG_PADRAO, em("2026-11-14T16:00:00Z")).aberto, false); // sáb 13:00
    assert.equal(situacaoHorario(CONFIG_PADRAO, em("2026-11-14T01:00:00Z")).proximaAbertura, "amanhã às 09:00"); // sex 22:00 em SP
  });

  it("usa o fuso da empresa, não o do servidor", () => {
    const manaus = structuredClone(CONFIG_PADRAO);
    manaus.horario.fuso = "America/Manaus"; // UTC-4
    // 12:30Z = 08:30 em Manaus (fechado) e 09:30 em São Paulo (aberto)
    assert.equal(situacaoHorario(manaus, em("2026-11-09T12:30:00Z")).aberto, false);
    assert.equal(situacaoHorario(CONFIG_PADRAO, em("2026-11-09T12:30:00Z")).aberto, true);
  });

  it("sem nenhum dia aberto, nunca abre e diz 'em breve'", () => {
    const fechada = structuredClone(CONFIG_PADRAO);
    for (const d of DIAS) fechada.horario.semana[d] = null;
    assert.deepEqual(situacaoHorario(fechada, em("2026-11-09T15:00:00Z")), { aberto: false, proximaAbertura: "em breve" });
    assert.equal(resumoSemana(fechada), "sem horário de atendimento cadastrado");
  });

  it("um dia isolado no meio da semana aparece sozinho no resumo", () => {
    const c = structuredClone(CONFIG_PADRAO);
    for (const d of DIAS) c.horario.semana[d] = null;
    c.horario.semana.qua = ["10:00", "12:00"];
    assert.equal(resumoSemana(c), "qua, das 10:00 às 12:00");
    // quarta às 13h: a próxima abertura é a quarta seguinte
    assert.equal(situacaoHorario(c, em("2026-11-11T16:00:00Z")).proximaAbertura, "quarta-feira às 10:00");
  });
});

describe("métricas", () => {
  const AGORA = em("2026-11-09T15:00:00Z");
  const novo = () => new Atendimento({ config: structuredClone(CONFIG_PADRAO), relogio: () => AGORA });

  it("sem conversas, tudo zerado e sete dias na série, terminando hoje", () => {
    const m = calcularMetricas([], CONFIG_PADRAO, AGORA);
    assert.equal(m.totalConversas, 0);
    assert.equal(m.resolucaoAutomatica, 0);
    assert.equal(m.taxaTransbordo, 0);
    assert.equal(m.esperaMediaHumanoMin, null);
    assert.equal(m.porDia.length, 7);
    assert.equal(m.porDia.at(-1)?.dia, "2026-11-09");
    assert.equal(m.porDia[0].dia, "2026-11-03");
  });

  it("conta transbordo, resolução automática e o motivo", async () => {
    const at = novo();
    const a = at.criarConversa("Ana");
    await at.receber(a.id, "aceitam pix?");
    const b = at.criarConversa("Bia");
    await at.receber(b.id, "quero falar com o gerente");
    const m = at.metricas();
    assert.equal(m.totalConversas, 2);
    assert.equal(m.taxaTransbordo, 50);
    assert.equal(m.resolucaoAutomatica, 50);
    assert.equal(m.aguardandoHumano, 1);
    assert.equal(m.porDia.at(-1)?.conversas, 2);
    assert.deepEqual(m.motivos, [{ motivo: "Cliente pediu atendente", total: 1 }]);
    assert.ok(m.topicos.some((t) => /pagamento/i.test(t.rotulo)));
  });

  it("espera média usa a primeira resposta humana depois do pedido de ajuda", async () => {
    let agora = AGORA;
    const at = new Atendimento({ config: structuredClone(CONFIG_PADRAO), relogio: () => agora });
    const c = at.criarConversa("Caio");
    await at.receber(c.id, "preciso de um atendente");
    agora = new Date(AGORA.getTime() + 6 * 60_000);
    at.assumir(c.id, "Luiz");
    at.responderHumano(c.id, "Oi, Caio!");
    assert.equal(at.metricas().esperaMediaHumanoMin, 6);
  });

  it("perguntas sem resposta viram lacunas, contadas por texto igual", async () => {
    const at = novo();
    for (const nome of ["D1", "D2"]) {
      const c = at.criarConversa(nome);
      await at.receber(c.id, "vocês vendem chocolate?");
    }
    const m = at.metricas();
    assert.deepEqual(m.lacunas, [{ pergunta: "vocês vendem chocolate?", vezes: 2 }]);
  });
});
