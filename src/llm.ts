import { resumoSemana } from "./horario.ts";
import { ProvedorLocal } from "./motor.ts";
import { dinheiro } from "./texto.ts";
import type { Contexto, Provedor, Resposta } from "./tipos.ts";

export const MARCA_HUMANO = "[[HUMANO]]";

/** Monta as instruções do modelo a partir do painel: o que está lá é tudo o que o agente pode afirmar. */
export function montarInstrucoes(ctx: Contexto): string {
  const { config } = ctx;
  const tons = { cordial: "cordial e simpático", formal: "formal e objetivo", descontraido: "descontraído e próximo" };
  const faq = config.faq.map((f) => `P: ${f.pergunta}\nR: ${f.resposta}`).join("\n\n");
  const catalogo = config.catalogo.map((p) => `- ${p.nome} (${dinheiro(p.preco)}): ${p.descricao}`).join("\n");
  return [
    `Você é o atendente virtual da empresa "${config.empresa.nome}" (${config.empresa.segmento}). Responda em português do Brasil, em tom ${tons[config.tom.estilo]}, em no máximo 3 frases curtas.`,
    config.tom.emoji ? "Pode usar no máximo um emoji." : "Não use emojis.",
    `Responda SOMENTE com base nas informações abaixo. Se a resposta não estiver nelas, não invente: responda exatamente ${MARCA_HUMANO}.`,
    `Se o cliente pedir uma pessoa, reclamar ou falar de cancelamento, reembolso ou questão jurídica, responda exatamente ${MARCA_HUMANO}.`,
    `Horário de atendimento: ${resumoSemana(config)}. Agora a loja está ${ctx.aberto ? "aberta" : `fechada (volta ${ctx.proximaAbertura})`}.`,
    `Telefone: ${config.empresa.telefone}. Endereço: ${config.empresa.endereco}.`,
    `PERGUNTAS FREQUENTES:\n${faq}`,
    `CATÁLOGO:\n${catalogo}`,
  ].join("\n\n");
}

export interface OpcoesLlm {
  chave: string;
  baseUrl?: string;
  modelo?: string;
  fetchFn?: typeof fetch;
}

/**
 * Provedor para qualquer API compatível com "chat completions" (OpenAI, OpenRouter, servidores locais...).
 * Se a chamada falhar, cai no motor local, então o atendimento não para por causa do provedor.
 */
export class ProvedorLlm implements Provedor {
  nome = "llm";
  private opc: Required<Omit<OpcoesLlm, "fetchFn">> & { fetchFn: typeof fetch };
  private reserva = new ProvedorLocal();

  constructor(opc: OpcoesLlm) {
    this.opc = {
      chave: opc.chave,
      baseUrl: (opc.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, ""),
      modelo: opc.modelo ?? "gpt-4o-mini",
      fetchFn: opc.fetchFn ?? fetch,
    };
  }

  async responder(ctx: Contexto): Promise<Resposta> {
    try {
      const historico = ctx.historico
        .filter((m) => m.de !== "sistema")
        .slice(-10)
        .map((m) => ({ role: m.de === "cliente" ? "user" : "assistant", content: m.texto }));
      const r = await this.opc.fetchFn(`${this.opc.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.opc.chave}` },
        body: JSON.stringify({
          model: this.opc.modelo,
          temperature: 0.2,
          messages: [{ role: "system", content: montarInstrucoes(ctx) }, ...historico, { role: "user", content: ctx.mensagem }],
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const dados = (await r.json()) as { choices?: { message?: { content?: string } }[] };
      const texto = dados.choices?.[0]?.message?.content?.trim();
      if (!texto) throw new Error("resposta vazia");
      if (texto.includes(MARCA_HUMANO)) {
        return { texto: "", confianca: 0, fonte: "llm", intencao: "fora-do-escopo", transbordar: true };
      }
      return { texto, confianca: 0.9, fonte: "llm", intencao: "llm" };
    } catch {
      return this.reserva.responder(ctx);
    }
  }
}

export function provedorDoAmbiente(env: Record<string, string | undefined> = process.env): Provedor {
  if (env.PROVEDOR === "llm") {
    if (!env.LLM_API_KEY) throw new Error("PROVEDOR=llm exige LLM_API_KEY");
    return new ProvedorLlm({ chave: env.LLM_API_KEY, baseUrl: env.LLM_BASE_URL, modelo: env.LLM_MODELO });
  }
  return new ProvedorLocal();
}
