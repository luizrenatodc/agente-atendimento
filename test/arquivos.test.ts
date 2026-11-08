import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Atendimento } from "../src/agente.ts";
import { CONFIG_PADRAO, carregarConfig, salvarConfig } from "../src/config.ts";

const pasta = mkdtempSync(join(tmpdir(), "agente-"));
after(() => rmSync(pasta, { recursive: true, force: true }));

describe("arquivos de estado e de configuração", () => {
  it("estado corrompido gera erro que diz qual arquivo corrigir", () => {
    const arq = join(pasta, "estado-quebrado.json");
    writeFileSync(arq, '{"conversas": [');
    assert.throws(() => new Atendimento({ config: structuredClone(CONFIG_PADRAO), arquivoEstado: arq }), /não foi possível ler o estado em .*estado-quebrado\.json/);
  });

  it("estado sem a lista de conversas é recusado", () => {
    const arq = join(pasta, "estado-sem-lista.json");
    writeFileSync(arq, "{}");
    assert.throws(() => new Atendimento({ config: structuredClone(CONFIG_PADRAO), arquivoEstado: arq }), /sem a lista "conversas"/);
  });

  it("as conversas sobrevivem a um reinício e não sobra arquivo temporário", () => {
    const arq = join(pasta, "dados", "estado.json");
    const a = new Atendimento({ config: structuredClone(CONFIG_PADRAO), arquivoEstado: arq });
    const id = a.criarConversa("Ana Souza", "11999990000").id;
    const b = new Atendimento({ config: structuredClone(CONFIG_PADRAO), arquivoEstado: arq });
    assert.equal(b.obter(id).cliente.nome, "Ana Souza");
    assert.throws(() => readFileSync(`${arq}.tmp`), /ENOENT/);
  });

  it("config com JSON quebrado ou inválido cita o arquivo", () => {
    const quebrado = join(pasta, "config-quebrada.json");
    writeFileSync(quebrado, "{nao-e-json");
    assert.throws(() => carregarConfig(quebrado), /JSON inválido em .*config-quebrada\.json/);
    const invalido = join(pasta, "config-invalida.json");
    writeFileSync(invalido, JSON.stringify({ tom: { estilo: "gritado" } }));
    assert.throws(() => carregarConfig(invalido), /configuração em .*config-invalida\.json: tom\.estilo inválido/);
  });

  it("sem arquivo, usa o padrão; salvar e carregar devolve o mesmo conteúdo", () => {
    assert.deepEqual(carregarConfig(join(pasta, "nao-existe.json")), CONFIG_PADRAO);
    assert.deepEqual(carregarConfig(undefined), CONFIG_PADRAO);
    const arq = join(pasta, "novo", "config.json");
    salvarConfig(arq, CONFIG_PADRAO);
    assert.deepEqual(carregarConfig(arq), CONFIG_PADRAO);
  });
});
