import type { Atendimento } from "./agente.ts";

type Passo = string | { humano: string } | { assumir: string } | { devolver: true };

interface Roteiro {
  nome: string;
  /** quanto tempo antes de "agora" a conversa começou */
  minutosAtras: number;
  passos: Passo[];
}

const MIN = 60_000;
const DIA = 24 * 60 * MIN;

const ROTEIROS: Roteiro[] = [
  { nome: "Marina Costa", minutosAtras: 6 * DIA / MIN + 190, passos: ["oi", "quanto custa o buquê de girassóis?", "vocês entregam hoje?", "obrigada!"] },
  { nome: "Rafael Lima", minutosAtras: 5 * DIA / MIN + 70, passos: ["boa tarde", "vocês aceitam pix?", "e dá pra parcelar no cartão?"] },
  { nome: "Beatriz Nunes", minutosAtras: 4 * DIA / MIN + 400, passos: ["que horas vocês abrem no sábado?", "dá pra retirar na loja?", "valeu"] },
  { nome: "Carlos Eduardo", minutosAtras: 3 * DIA / MIN + 150, passos: ["oi", "queria uma orquídea pra minha mãe", "vocês mandam cartão com mensagem?", "obrigado!"] },
  {
    nome: "Juliana Prado",
    minutosAtras: 2 * DIA / MIN + 300,
    passos: ["bom dia", "vocês fazem flores para casamento?", "quero falar com um atendente", { assumir: "Luiz" }, { humano: "Oi, Juliana! Sou o Luiz. Me conta a data e o número de convidados que eu monto o orçamento." }],
  },
  {
    nome: "Pedro Alves",
    minutosAtras: 2 * DIA / MIN + 90,
    passos: ["oi", "vocês vendem chocolate?", "e vinho?", { assumir: "Camila" }, { humano: "Oi, Pedro! Não temos vinho, mas fazemos kits com chocolate de parceiros. Quer ver?" }],
  },
  {
    nome: "Fernanda Souza",
    minutosAtras: DIA / MIN + 240,
    passos: ["meu pedido atrasou, isso é um absurdo", { assumir: "Luiz" }, { humano: "Fernanda, peço desculpas pelo atraso. Já estou vendo onde está o seu pedido." }],
  },
  { nome: "Ana Paula Ribeiro", minutosAtras: 190, passos: ["oi", "vocês têm assinatura de flores?", "quanto tempo duram as rosas?"] },
  { nome: "Thiago Martins", minutosAtras: 22, passos: ["preciso cancelar meu pedido de ontem"] },
  { nome: "Lara Mendes", minutosAtras: 6, passos: ["oi", "me mostra o catálogo"] },
];

/** Roda conversas de exemplo pelo motor de verdade, com o relógio voltado no tempo. */
export async function semear(at: Atendimento): Promise<void> {
  const real = at.relogio;
  const agora = real().getTime();
  try {
    for (const r of ROTEIROS) {
      let t = agora - r.minutosAtras * MIN;
      at.relogio = () => new Date(t);
      const c = at.criarConversa(r.nome);
      for (const p of r.passos) {
        t += 45_000;
        if (typeof p === "string") await at.receber(c.id, p);
        else if ("assumir" in p) {
          t += 4 * MIN;
          at.assumir(c.id, p.assumir);
        } else if ("humano" in p) at.responderHumano(c.id, p.humano);
        else at.devolver(c.id);
      }
      if (r.minutosAtras > 60) at.marcarLida(c.id);
    }
  } finally {
    at.relogio = real;
  }
}
