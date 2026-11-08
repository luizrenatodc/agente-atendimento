import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { ErroNegocio } from "./agente.ts";
import type { Atendimento } from "./agente.ts";
import { salvarConfig } from "./config.ts";

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export interface OpcoesApp {
  pastaPublica: string;
  arquivoConfig?: string;
  /** se definido, as rotas /api/admin exigem este token (cabeçalho x-token) */
  tokenAdmin?: string;
}

function json(res: ServerResponse, status: number, corpo: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(corpo));
}

async function lerCorpo(req: IncomingMessage): Promise<Record<string, unknown>> {
  const partes: Buffer[] = [];
  let tam = 0;
  for await (const p of req) {
    tam += (p as Buffer).length;
    if (tam > 200_000) throw new ErroNegocio("corpo grande demais", 413);
    partes.push(p as Buffer);
  }
  if (!partes.length) return {};
  let dados: unknown;
  try {
    dados = JSON.parse(Buffer.concat(partes).toString("utf-8"));
  } catch {
    throw new ErroNegocio("JSON inválido");
  }
  if (dados === null || typeof dados !== "object" || Array.isArray(dados)) throw new ErroNegocio("o corpo precisa ser um objeto JSON");
  return dados as Record<string, unknown>;
}

/** Visão da conversa para o cliente: sem notas internas, sem dados do motor. */
function visaoCliente(c: ReturnType<Atendimento["obter"]>) {
  return {
    id: c.id,
    estado: c.estado,
    responsavel: c.responsavel,
    mensagens: c.mensagens.filter((m) => m.de !== "sistema").map((m) => ({ id: m.id, de: m.de, texto: m.texto, em: m.em, atendente: m.meta?.atendente })),
  };
}

export function criarApp(at: Atendimento, opc: OpcoesApp): Server {
  async function api(req: IncomingMessage, res: ServerResponse, caminho: string): Promise<void> {
    const metodo = req.method ?? "GET";
    const partes = caminho.split("/").filter(Boolean); // ["api", ...]

    if (partes[1] === "publico") return json(res, 200, { nome: at.config.empresa.nome, assinatura: at.config.tom.assinatura });
    if (partes[1] === "saude") return json(res, 200, { ok: true, provedor: at.provedor.nome });

    // --- rotas do cliente ---
    if (partes[1] === "conversas") {
      if (metodo === "POST" && partes.length === 2) {
        const b = await lerCorpo(req);
        return json(res, 201, visaoCliente(at.criarConversa(String(b.nome ?? ""), String(b.telefone ?? ""))));
      }
      if (metodo === "GET" && partes.length === 3) return json(res, 200, visaoCliente(at.obter(partes[2])));
      if (metodo === "POST" && partes[3] === "mensagens") {
        const b = await lerCorpo(req);
        const r = await at.receber(partes[2], String(b.texto ?? ""));
        return json(res, 201, { ...visaoCliente(r.conversa), novas: r.novas.map((m) => m.id) });
      }
    }

    // --- rotas da equipe ---
    if (partes[1] === "admin") {
      if (opc.tokenAdmin && req.headers["x-token"] !== opc.tokenAdmin) return json(res, 401, { erro: "token inválido" });
      const [, , recurso, id, acao] = partes;
      if (recurso === "conversas") {
        if (metodo === "GET" && !id) {
          return json(res, 200, at.listar().map((c) => ({
            id: c.id, cliente: c.cliente, estado: c.estado, aguardandoHumano: c.aguardandoHumano, responsavel: c.responsavel,
            naoLida: c.naoLida, atualizadaEm: c.atualizadaEm, motivoTransbordo: c.motivoTransbordo,
            ultima: c.mensagens.filter((m) => m.de !== "sistema").at(-1)?.texto ?? "",
          })));
        }
        if (metodo === "GET" && id && !acao) {
          at.marcarLida(id);
          return json(res, 200, at.obter(id));
        }
        if (metodo === "POST" && id) {
          const b = await lerCorpo(req);
          if (acao === "assumir") return json(res, 200, at.assumir(id, String(b.atendente ?? "")));
          if (acao === "responder") return json(res, 201, at.responderHumano(id, String(b.texto ?? "")));
          if (acao === "devolver") return json(res, 200, at.devolver(id));
          if (acao === "encerrar") return json(res, 200, at.encerrar(id));
        }
      }
      if (recurso === "config") {
        if (metodo === "GET") return json(res, 200, at.config);
        if (metodo === "PUT") {
          try {
            const nova = at.atualizarConfig(await lerCorpo(req));
            if (opc.arquivoConfig) salvarConfig(opc.arquivoConfig, nova);
            return json(res, 200, nova);
          } catch (e) {
            if (e instanceof ErroNegocio) throw e;
            throw new ErroNegocio((e as Error).message);
          }
        }
      }
      if (recurso === "metricas" && metodo === "GET") return json(res, 200, at.metricas());
      if (recurso === "testar" && metodo === "POST") return json(res, 200, await at.testar(String((await lerCorpo(req)).texto ?? "")));
    }
    json(res, 404, { erro: "rota não encontrada" });
  }

  async function estatico(res: ServerResponse, caminho: string): Promise<void> {
    let rel = caminho === "/" ? "/index.html" : caminho === "/admin" ? "/admin.html" : caminho;
    rel = normalize(decodeURIComponent(rel));
    if (rel.includes("..")) return json(res, 400, { erro: "caminho inválido" });
    try {
      const dados = await readFile(join(opc.pastaPublica, rel));
      res.writeHead(200, { "content-type": TIPOS[extname(rel)] ?? "application/octet-stream", "cache-control": "no-cache" });
      res.end(dados);
    } catch {
      json(res, 404, { erro: "não encontrado" });
    }
  }

  return createServer(async (req, res) => {
    try {
      const caminho = new URL(req.url ?? "/", "http://x").pathname;
      if (caminho.startsWith("/api/")) await api(req, res, caminho);
      else await estatico(res, caminho);
    } catch (e) {
      if (e instanceof ErroNegocio) json(res, e.status, { erro: e.message });
      else {
        console.error(e);
        json(res, 500, { erro: "erro interno" });
      }
    }
  });
}
