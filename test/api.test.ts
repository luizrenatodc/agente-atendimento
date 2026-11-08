import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Atendimento } from "../src/agente.ts";
import { criarApp } from "../src/app.ts";
import { CONFIG_PADRAO } from "../src/config.ts";

let servidor: Server;
let base = "";

async function chamar(metodo: string, caminho: string, corpo?: unknown, token?: string) {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { "content-type": "application/json", ...(token ? { "x-token": token } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return { status: r.status, corpo: (await r.json()) as any };
}

describe("API HTTP", () => {
  before(async () => {
    const at = new Atendimento({ config: structuredClone(CONFIG_PADRAO), relogio: () => new Date("2026-11-09T15:00:00Z") });
    servidor = criarApp(at, { pastaPublica: fileURLToPath(new URL("../public", import.meta.url)), tokenAdmin: "segredo" });
    await new Promise<void>((ok) => servidor.listen(0, ok));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });
  after(() => servidor.close());

  it("fluxo completo: cliente pergunta, pede pessoa, equipe assume e responde", async () => {
    const c = await chamar("POST", "/api/conversas", { nome: "Marina Costa" });
    assert.equal(c.status, 201);
    const id = c.corpo.id;
    const p = await chamar("POST", `/api/conversas/${id}/mensagens`, { texto: "aceitam pix?" });
    assert.equal(p.corpo.mensagens.at(-1).de, "agente");
    const h = await chamar("POST", `/api/conversas/${id}/mensagens`, { texto: "quero falar com um atendente" });
    assert.equal(h.corpo.estado, "humano");

    const fila = await chamar("GET", "/api/admin/conversas", undefined, "segredo");
    assert.equal(fila.corpo[0].aguardandoHumano, true);
    assert.equal((await chamar("POST", `/api/admin/conversas/${id}/assumir`, { atendente: "Luiz" }, "segredo")).status, 200);
    assert.equal((await chamar("POST", `/api/admin/conversas/${id}/responder`, { texto: "Oi, Marina!" }, "segredo")).status, 201);

    const visaoCliente = await chamar("GET", `/api/conversas/${id}`);
    assert.equal(visaoCliente.corpo.mensagens.at(-1).texto, "Oi, Marina!");
    assert.ok(!visaoCliente.corpo.mensagens.some((m: any) => m.de === "sistema"), "cliente não vê notas do sistema");
  });

  it("protege o painel com token", async () => {
    assert.equal((await chamar("GET", "/api/admin/conversas")).status, 401);
    assert.equal((await chamar("GET", "/api/admin/config", undefined, "errado")).status, 401);
  });

  it("edita a base pelo painel e valida o que entra", async () => {
    const cfg = (await chamar("GET", "/api/admin/config", undefined, "segredo")).corpo;
    cfg.empresa.nome = "Floricultura Teste";
    assert.equal((await chamar("PUT", "/api/admin/config", cfg, "segredo")).status, 200);
    cfg.horario.semana.seg = ["20:00", "08:00"];
    const ruim = await chamar("PUT", "/api/admin/config", cfg, "segredo");
    assert.equal(ruim.status, 400);
    assert.match(ruim.corpo.erro, /horário inválido/);
  });

  it("testa uma pergunta sem criar conversa", async () => {
    const antes = (await chamar("GET", "/api/admin/conversas", undefined, "segredo")).corpo.length;
    const t = await chamar("POST", "/api/admin/testar", { texto: "onde fica a loja?" }, "segredo");
    assert.equal(t.corpo.responderia, true);
    assert.equal(t.corpo.candidatos[0].id, "endereco");
    assert.equal((await chamar("GET", "/api/admin/conversas", undefined, "segredo")).corpo.length, antes);
  });

  it("responde 404 e 400 com mensagem clara", async () => {
    assert.equal((await chamar("GET", "/api/conversas/nao-existe")).status, 404);
    const c = await chamar("POST", "/api/conversas", {});
    assert.equal((await chamar("POST", `/api/conversas/${c.corpo.id}/mensagens`, { texto: "" })).status, 400);
  });

  it("corpo que não é um objeto JSON vira 400, não 500", async () => {
    for (const corpo of ["null", "[1,2]", "42", '"texto"', "{quebrado"]) {
      const r = await fetch(base + "/api/conversas", { method: "POST", headers: { "content-type": "application/json" }, body: corpo });
      assert.equal(r.status, 400, `corpo ${corpo}`);
      assert.ok(((await r.json()) as { erro: string }).erro);
    }
  });

  it("caminho com escape inválido ou byte nulo vira 400, não 500", async () => {
    for (const caminho of ["/%E0%A4%A", "/%", "/index.html%00"]) {
      const r = await fetch(base + caminho);
      assert.equal(r.status, 400, caminho);
    }
  });

  it("serve as páginas do cliente e do painel", async () => {
    assert.equal((await fetch(base + "/")).status, 200);
    assert.equal((await fetch(base + "/admin")).status, 200);
    assert.equal((await fetch(base + "/../package.json")).status, 404);
  });
});
