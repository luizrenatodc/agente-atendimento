import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONFIG_PADRAO, validarConfig } from "../src/config.ts";

function variar(mexer: (c: any) => void): unknown {
  const c = structuredClone(CONFIG_PADRAO) as any;
  mexer(c);
  return c;
}

describe("validarConfig: bordas", () => {
  it("aceita a configuração padrão sem alterá-la", () => {
    assert.deepEqual(validarConfig(CONFIG_PADRAO), CONFIG_PADRAO);
  });

  it("recusa fuso horário que não existe, em vez de quebrar o atendimento depois", () => {
    assert.throws(() => validarConfig(variar((c) => (c.horario.fuso = "Marte/Olimpo"))), /fuso horário inválido/);
    assert.throws(() => validarConfig(variar((c) => (c.horario.fuso = ""))), /fuso horário inválido/);
    assert.throws(() => validarConfig(variar((c) => (c.horario.fuso = 3))), /fuso horário inválido/);
    assert.doesNotThrow(() => validarConfig(variar((c) => (c.horario.fuso = "America/Manaus"))));
  });

  it("recusa horas fora do relógio", () => {
    for (const faixa of [["25:00", "26:00"], ["09:60", "18:00"], ["09:00", "24:00"], ["9:00", "18:00"]]) {
      assert.throws(() => validarConfig(variar((c) => (c.horario.semana.ter = faixa))), /horário inválido em ter/, faixa.join("-"));
    }
    assert.doesNotThrow(() => validarConfig(variar((c) => (c.horario.semana.ter = ["00:00", "23:59"]))));
  });

  it("recusa início igual ao fim", () => {
    assert.throws(() => validarConfig(variar((c) => (c.horario.semana.qua = ["09:00", "09:00"]))), /horário inválido em qua/);
  });

  it("faq e catálogo precisam ser listas de objetos", () => {
    assert.throws(() => validarConfig(variar((c) => (c.faq = "texto"))), /faq deve ser uma lista/);
    assert.throws(() => validarConfig(variar((c) => (c.catalogo = {}))), /catalogo deve ser uma lista/);
    assert.throws(() => validarConfig(variar((c) => (c.faq = [null]))), /FAQ 1 inválida/);
    assert.throws(() => validarConfig(variar((c) => (c.catalogo = [42]))), /item 1 do catálogo inválido/);
  });

  it("recusa preço negativo ou não numérico e FAQ sem resposta", () => {
    assert.throws(() => validarConfig(variar((c) => (c.catalogo[0].preco = -1))), /precisa de nome e preço/);
    assert.throws(() => validarConfig(variar((c) => (c.catalogo[0].preco = "caro"))), /precisa de nome e preço/);
    assert.throws(() => validarConfig(variar((c) => (c.faq[0].resposta = "   "))), /precisa de pergunta e resposta/);
  });

  it("gera ids para itens sem id e apara espaços", () => {
    const c = validarConfig(variar((x) => (x.faq = [{ pergunta: "  Aceitam pix? ", resposta: " Sim. ", palavras: [" pix ", ""] }])));
    assert.deepEqual(c.faq, [{ id: "faq-1", pergunta: "Aceitam pix?", resposta: "Sim.", palavras: ["pix"] }]);
  });

  it("recusa entrada que não é objeto, nome vazio, estilo e limites inválidos", () => {
    for (const ruim of [null, undefined, "x", 1]) assert.throws(() => validarConfig(ruim), /configuração inválida/);
    assert.throws(() => validarConfig(variar((c) => (c.empresa.nome = ""))), /empresa.nome/);
    assert.throws(() => validarConfig(variar((c) => (c.tom.estilo = "gritado"))), /tom.estilo/);
    assert.throws(() => validarConfig(variar((c) => (c.transbordo.maxFalhas = 0))), /maxFalhas/);
    assert.throws(() => validarConfig(variar((c) => (c.transbordo.confiancaMinima = -0.1))), /entre 0 e 1/);
  });
});
