import { resumoSemana } from "./horario.ts";
import { aplicarTom } from "./tom.ts";
import { dinheiro, normalizar, tokens } from "./texto.ts";
import type { Candidato, Config, Contexto, Provedor, Resposta } from "./tipos.ts";

/** Palavras de intenção de preço: não ajudam a achar o produto, só a decidir o tipo de resposta. */
const TOKENS_PRECO = new Set(["cust", "prec", "valor", "reai", "quant", "sai", "fica", "cobr"]);

interface Doc {
  tipo: "faq" | "produto";
  id: string;
  titulo: string;
  texto: string;
  /** token -> peso (palavras-chave e nomes valem mais que o resto do texto) */
  pesos: Map<string, number>;
}

function montarDocs(config: Config): Doc[] {
  const docs: Doc[] = [];
  const add = (pesos: Map<string, number>, ts: string[], peso: number) => {
    for (const t of ts) pesos.set(t, Math.max(pesos.get(t) ?? 0, peso));
  };
  for (const f of config.faq) {
    const pesos = new Map<string, number>();
    add(pesos, tokens(f.pergunta), 1);
    add(pesos, f.palavras.flatMap((p) => tokens(p)), 1.4);
    docs.push({ tipo: "faq", id: f.id, titulo: f.pergunta, texto: f.resposta, pesos });
  }
  for (const p of config.catalogo) {
    const pesos = new Map<string, number>();
    add(pesos, tokens(p.descricao), 0.6);
    add(pesos, tokens(p.nome), 1.4);
    docs.push({ tipo: "produto", id: p.id, titulo: p.nome, texto: `${p.nome} custa ${dinheiro(p.preco)}. ${p.descricao}`.trim(), pesos });
  }
  return docs;
}

/** Busca por sobreposição de radicais ponderada por IDF. Devolve até 3 candidatos, do melhor para o pior. */
export function buscar(config: Config, pergunta: string): Candidato[] {
  const docs = montarDocs(config);
  const n = docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.pesos.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + n / (df.get(t) ?? 0.5));
  const maxIdf = Math.log(1 + n / 0.5);

  const consulta = [...new Set(tokens(pergunta).filter((t) => !TOKENS_PRECO.has(t)))];
  if (!consulta.length) return [];
  const total = consulta.reduce((s, t) => s + (df.has(t) ? idf(t) : 0.4 * maxIdf), 0);

  const saida: Candidato[] = [];
  for (const d of docs) {
    let acerto = 0;
    let cobertura = 0;
    for (const t of consulta) {
      const peso = d.pesos.get(t);
      if (peso) {
        acerto += idf(t) * Math.min(1.3, 0.75 + peso * 0.35);
        cobertura++;
      }
    }
    if (!acerto) continue;
    const confianca = Math.min(1, acerto / total) * 0.95 + 0.05 * (cobertura / Math.max(1, d.pesos.size)) * 4;
    saida.push({ tipo: d.tipo, id: d.id, titulo: d.titulo, texto: d.texto, confianca: Math.min(1, Number(confianca.toFixed(3))) });
  }
  return saida.sort((a, b) => b.confianca - a.confianca).slice(0, 3);
}

const RE = {
  saudacao: /^(oi+|ola|opa|e ai|bom dia|boa tarde|boa noite|hello|hey|eae)\b/,
  despedida: /\b(obrigad[oa]|valeu|vlw|tchau|ate mais|ate logo|era so isso|so isso)\b/,
  horario: /\b(horario|horarios|abre|abrem|fecha|fecham|funciona|funcionam|aberto|aberta|expediente|sabado|domingo)\b/,
  catalogo: /\b(catalogo|cardapio|produtos|opcoes|o que (voces )?(vende|vendem|tem)|tabela de precos|lista de precos)\b/,
  preco: /\b(preco|precos|valor|valores|custa|custam|quanto)\b/,
};

function listaCatalogo(config: Config): string {
  return config.catalogo.map((p) => `• ${p.nome}: ${dinheiro(p.preco)}`).join("\n");
}

export function detectarIntencao(config: Config, mensagem: string): string | null {
  const n = normalizar(mensagem);
  const curta = n.split(" ").length <= 4;
  if (RE.saudacao.test(n) && curta) return "saudacao";
  if (RE.despedida.test(n) && n.split(" ").length <= 6) return "despedida";
  if (RE.horario.test(n) && !/\b(entrega|entregam|retirada|retirar)\b/.test(n)) return "horario";
  if (RE.catalogo.test(n)) return "catalogo";
  const melhor = buscar(config, mensagem)[0];
  if (RE.preco.test(n) && !(melhor && (melhor.tipo === "produto" || melhor.confianca >= 0.6))) return "preco-geral";
  return null;
}

/** Motor local de demonstração: intenções simples, FAQ e catálogo. Não usa rede nem chave nenhuma. */
export class ProvedorLocal implements Provedor {
  nome = "local";

  async responder(ctx: Contexto): Promise<Resposta> {
    const { config } = ctx;
    const intencao = detectarIntencao(config, ctx.mensagem);
    switch (intencao) {
      case "saudacao":
        // a conversa já começou com a saudação completa: aqui basta uma retomada curta
        return { texto: ctx.historico.length > 0 ? "Oi! Em que posso ajudar?" : config.mensagens.saudacao, confianca: 1, fonte: "intencao", intencao };
      case "despedida":
        return { texto: config.mensagens.despedida, confianca: 1, fonte: "intencao", intencao };
      case "horario": {
        const base = `Nosso atendimento é ${resumoSemana(config)}.`;
        const extra = ctx.aberto ? " Estamos abertos agora." : ` Agora estamos fechados; voltamos ${ctx.proximaAbertura}.`;
        return { texto: aplicarTom(base + extra, config), confianca: 0.98, fonte: "horario", intencao };
      }
      case "catalogo":
      case "preco-geral":
        if (!config.catalogo.length) break;
        return { texto: aplicarTom(`Estas são as nossas opções:\n${listaCatalogo(config)}\nQuer detalhes de alguma?`, config), confianca: 0.9, fonte: "catalogo", intencao };
    }
    const melhor = ctx.candidatos[0];
    if (melhor && melhor.confianca >= config.transbordo.confiancaMinima) {
      return {
        texto: aplicarTom(melhor.texto, config),
        confianca: melhor.confianca,
        fonte: `${melhor.tipo}:${melhor.id}`,
        intencao: melhor.tipo === "produto" ? "produto" : "faq",
      };
    }
    return { texto: config.mensagens.naoEntendi, confianca: melhor?.confianca ?? 0, fonte: "nenhuma", intencao: "desconhecida" };
  }
}
