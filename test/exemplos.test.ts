import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { carregarConfig } from "../src/config.ts";

const pasta = fileURLToPath(new URL("../exemplos/", import.meta.url));
const arquivos = readdirSync(pasta).filter((f) => f.endsWith(".json"));

describe("configurações de exemplo", () => {
  it("a pasta tem pelo menos duas empresas", () => {
    assert.ok(arquivos.length >= 2);
  });

  for (const arquivo of arquivos) {
    it(`${arquivo} é uma configuração válida e completa`, () => {
      const config = carregarConfig(pasta + arquivo);
      assert.ok(config.empresa.nome.length > 0);
      assert.ok(config.faq.length >= 3, "FAQ com pelo menos 3 perguntas");
      assert.ok(config.catalogo.length >= 3, "catálogo com pelo menos 3 itens");
      for (const lista of [config.faq, config.catalogo]) {
        const ids = lista.map((x) => x.id);
        assert.equal(new Set(ids).size, ids.length, "ids repetidos na mesma lista");
      }
    });
  }
});
