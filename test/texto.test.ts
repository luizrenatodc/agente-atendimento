import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONFIG_PADRAO } from "../src/config.ts";
import { aplicarTom, enfeitar } from "../src/tom.ts";
import { contemTermo, dinheiro, normalizar, preencher, radical, tokens } from "../src/texto.ts";
import type { Config } from "../src/tipos.ts";

function comTom(estilo: Config["tom"]["estilo"], emoji: boolean): Config {
  const c = structuredClone(CONFIG_PADRAO);
  c.tom = { ...c.tom, estilo, emoji };
  return c;
}

describe("normalizar", () => {
  it("tira acento, pontuação, caixa e espaços repetidos", () => {
    assert.equal(normalizar("  Ação!!  Ótima—ÇÃO  "), "acao otima cao");
  });
  it("texto vazio ou só pontuação vira vazio", () => {
    assert.equal(normalizar(""), "");
    assert.equal(normalizar("?!..."), "");
  });
  it("mantém dígitos", () => {
    assert.equal(normalizar("R$ 12,50 em 3x"), "r 12 50 em 3x");
  });
});

describe("radical", () => {
  it("corta plural e terminações comuns", () => {
    assert.equal(radical("flores"), "flor");
    assert.equal(radical("animais"), "animal");
    assert.equal(radical("casa"), "cas");
  });
  it("não deixa o radical com menos de 3 letras", () => {
    assert.equal(radical("ar"), "ar");
    assert.equal(radical("os"), "os");
  });
});

describe("tokens", () => {
  it("texto vazio ou só de palavras vazias não gera tokens", () => {
    assert.deepEqual(tokens(""), []);
    assert.deepEqual(tokens("o a de"), []);
    assert.deepEqual(tokens("Oi, bom dia! Tudo bem?"), []);
  });
  it("singular e plural chegam ao mesmo radical", () => {
    assert.deepEqual(tokens("rosas"), tokens("rosa"));
    assert.deepEqual(tokens("cartões"), tokens("cartão"));
  });
});

describe("contemTermo", () => {
  it("só casa palavra inteira e devolve o termo cadastrado", () => {
    assert.equal(contemTermo("quero falar com alguém", ["falar com alguém"]), "falar com alguém");
    assert.equal(contemTermo("o atendentes chegou", ["atendente"]), null);
  });
  it("ignora termos vazios e texto vazio", () => {
    assert.equal(contemTermo("abc", [""]), null);
    assert.equal(contemTermo("", ["a"]), null);
    assert.equal(contemTermo("qualquer coisa", []), null);
  });
  it("devolve o primeiro termo da lista que aparece", () => {
    assert.equal(contemTermo("procon e advogado", ["advogado", "procon"]), "advogado");
  });
});

describe("dinheiro e preencher", () => {
  it("formata em reais", () => {
    assert.match(dinheiro(1234.5), /^R\$\s1\.234,50$/);
    assert.match(dinheiro(0), /^R\$\s0,00$/);
  });
  it("preenche todas as ocorrências e esvazia chaves desconhecidas", () => {
    assert.equal(preencher("Oi {nome}, {nome}!", { nome: "Ana" }), "Oi Ana, Ana!");
    assert.equal(preencher("Volta {proximaAbertura}.", {}), "Volta .");
    assert.equal(preencher("sem chaves", { nome: "Ana" }), "sem chaves");
  });
});

describe("tom de voz", () => {
  it("emoji só aparece quando ligado e o estilo tem emoji", () => {
    assert.ok(aplicarTom("Texto.", comTom("cordial", true)).endsWith(" 😊"));
    assert.ok(aplicarTom("Texto.", comTom("descontraido", true)).endsWith(" 😄"));
    assert.equal(aplicarTom("Texto.", comTom("formal", true)).endsWith("Texto."), true);
    assert.doesNotMatch(aplicarTom("Texto.", comTom("cordial", false)), /😊/);
  });
  it("é determinístico: o mesmo texto sempre ganha a mesma abertura", () => {
    const c = comTom("cordial", false);
    assert.equal(aplicarTom("Entregamos hoje.", c), aplicarTom("Entregamos hoje.", c));
  });
  it("formal baixa a inicial quando a abertura é 'Informamos que'", () => {
    const formais = ["Aaa", "Bbbb"].map((t) => aplicarTom(t, comTom("formal", false)));
    assert.ok(formais.some((t) => t === "Informamos que aaa") && formais.some((t) => t === "Prezado(a), Bbbb"));
  });
  it("enfeitar só adiciona o emoji, sem abertura", () => {
    assert.equal(enfeitar("Olá!", comTom("cordial", true)), "Olá! 😊");
    assert.equal(enfeitar("Olá!", comTom("cordial", false)), "Olá!");
    assert.equal(enfeitar("Olá!", comTom("formal", true)), "Olá!");
  });
});
