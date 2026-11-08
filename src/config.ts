import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DIAS } from "./tipos.ts";
import type { Config, Estilo } from "./tipos.ts";

export const CONFIG_PADRAO: Config = {
  empresa: {
    nome: "Casa Aurora Floricultura",
    segmento: "floricultura",
    telefone: "(11) 4002-8922",
    endereco: "Rua das Acácias, 120, Jardim Primavera",
  },
  tom: { estilo: "cordial", emoji: true, assinatura: "Equipe Casa Aurora" },
  horario: {
    fuso: "America/Sao_Paulo",
    semana: {
      dom: null,
      seg: ["09:00", "18:00"],
      ter: ["09:00", "18:00"],
      qua: ["09:00", "18:00"],
      qui: ["09:00", "18:00"],
      sex: ["09:00", "18:00"],
      sab: ["09:00", "13:00"],
    },
  },
  mensagens: {
    saudacao: "Olá, {nome}! Aqui é o assistente virtual da {empresa}. Como posso ajudar?",
    foraDoHorario: "Estamos fora do horário agora, mas eu continuo por aqui. Nossa equipe volta {proximaAbertura}.",
    transbordo: "Vou chamar uma pessoa da nossa equipe para continuar com você. Ela já vai ver tudo o que conversamos.",
    naoEntendi: "Não tenho certeza se entendi. Pode explicar de outro jeito? Se preferir, chamo uma pessoa da equipe.",
    despedida: "Por nada! Qualquer coisa é só chamar.",
  },
  transbordo: {
    pedidoHumano: ["atendente", "humano", "pessoa", "gerente", "falar com alguém", "responsável", "dono"],
    palavrasSensiveis: ["reclamação", "procon", "processo", "advogado", "cancelar", "reembolso", "estorno", "absurdo", "péssimo", "golpe", "enganado"],
    maxFalhas: 2,
    confiancaMinima: 0.42,
  },
  faq: [
    {
      id: "entrega",
      pergunta: "Vocês fazem entrega? Qual o prazo e a região?",
      resposta: "Entregamos em toda a cidade em até 3 horas para pedidos feitos até as 15h. A taxa é de R$ 12,00, e é grátis acima de R$ 150,00.",
      palavras: ["entrega", "entregam", "frete", "taxa", "prazo", "motoboy", "receber"],
    },
    {
      id: "pagamento",
      pergunta: "Quais formas de pagamento vocês aceitam?",
      resposta: "Aceitamos Pix, cartão de crédito em até 3x sem juros, débito e dinheiro na retirada.",
      palavras: ["pagamento", "pagar", "pix", "cartao", "credito", "debito", "parcelar", "parcela"],
    },
    {
      id: "endereco",
      pergunta: "Qual o endereço da loja? Dá para retirar lá?",
      resposta: "Estamos na Rua das Acácias, 120, Jardim Primavera. A retirada é gratuita e fica pronta em 40 minutos.",
      palavras: ["endereco", "localizacao", "onde fica", "retirar", "retirada", "buscar", "loja fisica", "estacionamento"],
    },
    {
      id: "cartao",
      pergunta: "Dá para mandar um cartão com mensagem?",
      resposta: "O cartão com a sua mensagem é gratuito. Basta me dizer o texto e o nome de quem vai receber.",
      palavras: ["cartao", "mensagem", "recado", "dedicatoria", "bilhete", "presente"],
    },
    {
      id: "duracao",
      pergunta: "Quanto tempo duram as flores? Como cuidar?",
      resposta: "Com água limpa trocada a cada dois dias e um corte de 2 cm nas hastes, as flores duram de 7 a 10 dias. Evite sol direto.",
      palavras: ["durar", "duram", "dura", "cuidar", "cuidado", "murchar", "vida", "conservar"],
    },
    {
      id: "assinatura",
      pergunta: "Vocês têm assinatura de flores semanal ou mensal?",
      resposta: "Temos o Clube Aurora: um arranjo novo por semana ou por mês, com 10% de desconto e entrega grátis. Posso passar os detalhes?",
      palavras: ["assinatura", "clube", "mensal", "semanal", "recorrente", "plano"],
    },
    {
      id: "empresas",
      pergunta: "Vocês atendem eventos e empresas com nota fiscal?",
      resposta: "Atendemos eventos, casamentos e empresas, com nota fiscal. Para orçamento, uma pessoa da equipe precisa falar com você.",
      palavras: ["evento", "casamento", "empresa", "corporativo", "nota fiscal", "cnpj", "orcamento", "decoracao"],
    },
  ],
  catalogo: [
    { id: "buque-rosas", nome: "Buquê de 12 rosas vermelhas", preco: 139.9, descricao: "Rosas colombianas com folhagem e embalagem kraft." },
    { id: "girassois", nome: "Buquê de girassóis", preco: 119.0, descricao: "Seis girassóis com gypsophila, bem alegre." },
    { id: "orquidea", nome: "Orquídea Phalaenopsis no vaso", preco: 159.0, descricao: "Orquídea branca com duas hastes, vaso de cerâmica incluso." },
    { id: "cesta", nome: "Cesta café da manhã com flores", preco: 189.9, descricao: "Cesta com pães, frutas, geleia e mini arranjo." },
    { id: "suculentas", nome: "Kit de suculentas", preco: 59.9, descricao: "Três suculentas em vasos de cimento." },
  ],
};

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function fusoValido(fuso: unknown): boolean {
  if (typeof fuso !== "string" || !fuso) return false;
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

/** Valida e completa uma configuração vinda de arquivo ou do painel. Lança Error se estiver quebrada. */
export function validarConfig(entrada: unknown): Config {
  if (!entrada || typeof entrada !== "object") throw new Error("configuração inválida");
  const c = entrada as Partial<Config>;
  const base = structuredClone(CONFIG_PADRAO);
  const e = c.empresa ?? base.empresa;
  if (!e.nome || typeof e.nome !== "string") throw new Error("empresa.nome é obrigatório");
  const estilo = (c.tom?.estilo ?? base.tom.estilo) as Estilo;
  if (!["cordial", "formal", "descontraido"].includes(estilo)) throw new Error("tom.estilo inválido");
  const semana = { ...base.horario.semana, ...(c.horario?.semana ?? {}) };
  for (const d of DIAS) {
    const f = semana[d];
    if (f && !(Array.isArray(f) && HORA.test(f[0]) && HORA.test(f[1]) && f[0] < f[1]))
      throw new Error(`horário inválido em ${d}`);
  }
  if (c.horario?.fuso !== undefined && !fusoValido(c.horario.fuso)) throw new Error(`fuso horário inválido: ${String(c.horario.fuso)}`);
  if (c.faq !== undefined && !Array.isArray(c.faq)) throw new Error("faq deve ser uma lista");
  if (c.catalogo !== undefined && !Array.isArray(c.catalogo)) throw new Error("catalogo deve ser uma lista");
  const t = { ...base.transbordo, ...(c.transbordo ?? {}) };
  if (!(t.confiancaMinima >= 0 && t.confiancaMinima <= 1)) throw new Error("transbordo.confiancaMinima deve ficar entre 0 e 1");
  if (!(t.maxFalhas >= 1)) throw new Error("transbordo.maxFalhas deve ser 1 ou mais");
  const faq = (c.faq ?? base.faq).map((f, i) => {
    if (!f || typeof f !== "object") throw new Error(`FAQ ${i + 1} inválida`);
    if (!f.pergunta?.trim() || !f.resposta?.trim()) throw new Error(`FAQ ${i + 1} precisa de pergunta e resposta`);
    return { id: f.id || `faq-${i + 1}`, pergunta: f.pergunta.trim(), resposta: f.resposta.trim(), palavras: (f.palavras ?? []).map((p) => String(p).trim()).filter(Boolean) };
  });
  const catalogo = (c.catalogo ?? base.catalogo).map((p, i) => {
    if (!p || typeof p !== "object") throw new Error(`item ${i + 1} do catálogo inválido`);
    if (!p.nome?.trim() || !(Number(p.preco) >= 0)) throw new Error(`item ${i + 1} do catálogo precisa de nome e preço`);
    return { id: p.id || `item-${i + 1}`, nome: p.nome.trim(), preco: Number(p.preco), descricao: (p.descricao ?? "").trim() };
  });
  return {
    empresa: { ...base.empresa, ...e },
    tom: { ...base.tom, ...(c.tom ?? {}), estilo },
    horario: { fuso: c.horario?.fuso ?? base.horario.fuso, semana },
    mensagens: { ...base.mensagens, ...(c.mensagens ?? {}) },
    transbordo: t,
    faq,
    catalogo,
  };
}

export function carregarConfig(arquivo?: string): Config {
  if (arquivo && existsSync(arquivo)) return validarConfig(JSON.parse(readFileSync(arquivo, "utf-8")));
  return structuredClone(CONFIG_PADRAO);
}

export function salvarConfig(arquivo: string, config: Config): void {
  mkdirSync(dirname(arquivo), { recursive: true });
  writeFileSync(arquivo, JSON.stringify(config, null, 2), "utf-8");
}
