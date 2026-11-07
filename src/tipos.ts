export type DiaSemana = "dom" | "seg" | "ter" | "qua" | "qui" | "sex" | "sab";
export const DIAS: DiaSemana[] = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
export const NOMES_DIAS: Record<DiaSemana, string> = {
  dom: "domingo",
  seg: "segunda-feira",
  ter: "terça-feira",
  qua: "quarta-feira",
  qui: "quinta-feira",
  sex: "sexta-feira",
  sab: "sábado",
};

export type Estilo = "cordial" | "formal" | "descontraido";

export interface ItemFaq {
  id: string;
  pergunta: string;
  resposta: string;
  /** palavras-chave extras que aproximam a pergunta do cliente desta resposta */
  palavras: string[];
}

export interface ItemCatalogo {
  id: string;
  nome: string;
  preco: number;
  descricao: string;
}

export interface Config {
  empresa: { nome: string; segmento: string; telefone: string; endereco: string };
  tom: { estilo: Estilo; emoji: boolean; assinatura: string };
  horario: { fuso: string; semana: Record<DiaSemana, [string, string] | null> };
  mensagens: { saudacao: string; foraDoHorario: string; transbordo: string; naoEntendi: string; despedida: string };
  transbordo: {
    /** pedidos explícitos de falar com uma pessoa */
    pedidoHumano: string[];
    /** termos que indicam reclamação, risco jurídico ou cliente irritado */
    palavrasSensiveis: string[];
    /** falhas seguidas em entender o cliente antes de chamar uma pessoa */
    maxFalhas: number;
    /** confiança mínima do motor para responder sozinho (0 a 1) */
    confiancaMinima: number;
  };
  faq: ItemFaq[];
  catalogo: ItemCatalogo[];
}

export type Autor = "cliente" | "agente" | "humano" | "sistema";

export interface Mensagem {
  id: string;
  de: Autor;
  texto: string;
  em: string;
  meta?: { fonte?: string; intencao?: string; confianca?: number; atendente?: string };
}

export type EstadoConversa = "agente" | "humano" | "encerrada";

export interface Conversa {
  id: string;
  cliente: { nome: string; telefone: string };
  estado: EstadoConversa;
  /** true quando o agente pediu ajuda de uma pessoa e ninguém assumiu ainda */
  aguardandoHumano: boolean;
  motivoTransbordo?: string;
  responsavel?: string;
  falhasSeguidas: number;
  transbordou: boolean;
  naoLida: boolean;
  criadaEm: string;
  atualizadaEm: string;
  mensagens: Mensagem[];
}

export interface Candidato {
  tipo: "faq" | "produto";
  id: string;
  confianca: number;
  texto: string;
  titulo: string;
}

export interface Contexto {
  config: Config;
  historico: Mensagem[];
  mensagem: string;
  agora: Date;
  candidatos: Candidato[];
  aberto: boolean;
  proximaAbertura: string;
  nomeCliente: string;
}

export interface Resposta {
  texto: string;
  confianca: number;
  fonte: string;
  intencao: string;
  transbordar?: boolean;
}

export interface Provedor {
  nome: string;
  responder(contexto: Contexto): Promise<Resposta>;
}
