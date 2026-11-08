import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { validarConfig } from "./config.ts";
import { situacaoHorario } from "./horario.ts";
import { buscar, ProvedorLocal } from "./motor.ts";
import { calcularMetricas } from "./metricas.ts";
import { contemTermo, preencher } from "./texto.ts";
import { enfeitar } from "./tom.ts";
import type { Autor, Candidato, Config, Conversa, Mensagem, Provedor, Resposta } from "./tipos.ts";

export class ErroNegocio extends Error {
  status: number;
  constructor(mensagem: string, status = 400) {
    super(mensagem);
    this.status = status;
  }
}

export interface OpcoesAtendimento {
  config: Config;
  provedor?: Provedor;
  arquivoEstado?: string;
  relogio?: () => Date;
}

const LIMITE_TEXTO = 1000;

export class Atendimento {
  config: Config;
  provedor: Provedor;
  conversas = new Map<string, Conversa>();
  private arquivoEstado?: string;
  relogio: () => Date;

  constructor(opc: OpcoesAtendimento) {
    this.config = opc.config;
    this.provedor = opc.provedor ?? new ProvedorLocal();
    this.arquivoEstado = opc.arquivoEstado;
    this.relogio = opc.relogio ?? (() => new Date());
    if (this.arquivoEstado && existsSync(this.arquivoEstado)) {
      let dados: { conversas?: Conversa[] };
      try {
        dados = JSON.parse(readFileSync(this.arquivoEstado, "utf-8"));
      } catch (e) {
        throw new Error(`não foi possível ler o estado em ${this.arquivoEstado} (${(e as Error).message}). Corrija ou mova o arquivo para começar do zero.`);
      }
      if (!dados || !Array.isArray(dados.conversas)) throw new Error(`estado em ${this.arquivoEstado} sem a lista "conversas". Corrija ou mova o arquivo.`);
      for (const c of dados.conversas) this.conversas.set(c.id, c);
    }
  }

  private salvar(): void {
    if (!this.arquivoEstado) return;
    mkdirSync(dirname(this.arquivoEstado), { recursive: true });
    const tmp = `${this.arquivoEstado}.tmp`;
    writeFileSync(tmp, JSON.stringify({ conversas: [...this.conversas.values()] }), "utf-8");
    renameSync(tmp, this.arquivoEstado);
  }

  private msg(c: Conversa, de: Autor, texto: string, meta?: Mensagem["meta"]): Mensagem {
    const m: Mensagem = { id: `m_${randomBytes(4).toString("hex")}`, de, texto, em: this.relogio().toISOString(), meta };
    c.mensagens.push(m);
    c.atualizadaEm = m.em;
    return m;
  }

  private dados(c: Conversa): Record<string, string> {
    const h = situacaoHorario(this.config, this.relogio());
    return { empresa: this.config.empresa.nome, nome: c.cliente.nome.split(" ")[0], proximaAbertura: h.proximaAbertura };
  }

  private obterOuFalhar(id: string): Conversa {
    const c = this.conversas.get(id);
    if (!c) throw new ErroNegocio("conversa não encontrada", 404);
    return c;
  }

  obter(id: string): Conversa {
    return this.obterOuFalhar(id);
  }

  listar(): Conversa[] {
    return [...this.conversas.values()].sort((a, b) => b.atualizadaEm.localeCompare(a.atualizadaEm));
  }

  criarConversa(nome = "", telefone = ""): Conversa {
    const agora = this.relogio().toISOString();
    const n = nome.trim().slice(0, 60) || "Cliente";
    const c: Conversa = {
      id: `c_${randomBytes(4).toString("hex")}`,
      cliente: { nome: n, telefone: telefone.trim().slice(0, 20) },
      estado: "agente",
      aguardandoHumano: false,
      falhasSeguidas: 0,
      transbordou: false,
      naoLida: false,
      criadaEm: agora,
      atualizadaEm: agora,
      mensagens: [],
    };
    this.conversas.set(c.id, c);
    this.msg(c, "agente", enfeitar(preencher(this.config.mensagens.saudacao, this.dados(c)), this.config), { fonte: "intencao", intencao: "saudacao", confianca: 1 });
    this.salvar();
    return c;
  }

  private transbordar(c: Conversa, motivo: string): Mensagem[] {
    const h = situacaoHorario(this.config, this.relogio());
    c.estado = "humano";
    c.aguardandoHumano = true;
    c.transbordou = true;
    c.motivoTransbordo = motivo;
    let texto = preencher(this.config.mensagens.transbordo, this.dados(c));
    if (!h.aberto) texto += " " + preencher(this.config.mensagens.foraDoHorario, this.dados(c));
    return [this.msg(c, "agente", enfeitar(texto, this.config), { fonte: "transbordo", intencao: "transbordo", confianca: 1 })];
  }

  /** Mensagem do cliente: decide se o agente responde ou se chama uma pessoa. */
  async receber(id: string, textoBruto: string): Promise<{ conversa: Conversa; novas: Mensagem[] }> {
    const c = this.obterOuFalhar(id);
    const texto = String(textoBruto ?? "").trim().slice(0, LIMITE_TEXTO);
    if (!texto) throw new ErroNegocio("mensagem vazia");
    if (c.estado === "encerrada") {
      c.estado = "agente";
      c.falhasSeguidas = 0;
    }
    this.msg(c, "cliente", texto);
    c.naoLida = true;
    if (c.estado === "humano") {
      this.salvar();
      return { conversa: c, novas: [] };
    }

    const cfg = this.config;
    const sensivel = contemTermo(texto, cfg.transbordo.palavrasSensiveis);
    const pediu = contemTermo(texto, cfg.transbordo.pedidoHumano);
    let novas: Mensagem[];
    if (sensivel) novas = this.transbordar(c, `Termo sensível: “${sensivel}”`);
    else if (pediu) novas = this.transbordar(c, "Cliente pediu atendente");
    else {
      const resposta = await this.gerarResposta(c, texto);
      if (resposta.transbordar) novas = this.transbordar(c, "Assunto fora da base de conhecimento");
      else if (resposta.confianca < cfg.transbordo.confiancaMinima) {
        c.falhasSeguidas++;
        if (c.falhasSeguidas >= cfg.transbordo.maxFalhas) novas = this.transbordar(c, `${c.falhasSeguidas} perguntas seguidas sem resposta`);
        else novas = [this.msg(c, "agente", enfeitar(preencher(cfg.mensagens.naoEntendi, this.dados(c)), cfg), { fonte: resposta.fonte, intencao: "desconhecida", confianca: resposta.confianca })];
      } else {
        c.falhasSeguidas = 0;
        novas = [this.msg(c, "agente", preencher(resposta.texto, this.dados(c)), { fonte: resposta.fonte, intencao: resposta.intencao, confianca: resposta.confianca })];
      }
    }
    this.salvar();
    return { conversa: c, novas };
  }

  private async gerarResposta(c: Conversa, texto: string): Promise<Resposta> {
    const agora = this.relogio();
    const h = situacaoHorario(this.config, agora);
    const candidatos: Candidato[] = buscar(this.config, texto);
    return this.provedor.responder({
      config: this.config,
      historico: c.mensagens.slice(0, -1),
      mensagem: texto,
      agora,
      candidatos,
      aberto: h.aberto,
      proximaAbertura: h.proximaAbertura,
      nomeCliente: c.cliente.nome,
    });
  }

  /** Simula uma pergunta sem gravar conversa: usado pelo painel para testar a base de conhecimento. */
  async testar(texto: string): Promise<{ resposta: Resposta; candidatos: Candidato[]; responderia: boolean; transbordaria?: string }> {
    const t = String(texto ?? "").trim();
    if (!t) throw new ErroNegocio("pergunta vazia");
    const cfg = this.config;
    const candidatos = buscar(cfg, t);
    const sensivel = contemTermo(t, cfg.transbordo.palavrasSensiveis);
    const pediu = contemTermo(t, cfg.transbordo.pedidoHumano);
    const fake = this.conversasFicticia();
    const resposta = await this.gerarResposta(fake, t);
    const transbordaria = sensivel ? `Termo sensível: ${sensivel}` : pediu ? "Cliente pediu atendente" : resposta.transbordar ? "Fora da base" : undefined;
    resposta.texto = preencher(resposta.texto, this.dados(fake));
    return { resposta, candidatos, responderia: !transbordaria && resposta.confianca >= cfg.transbordo.confiancaMinima, transbordaria };
  }

  private conversasFicticia(): Conversa {
    const agora = this.relogio().toISOString();
    return { id: "teste", cliente: { nome: "Cliente", telefone: "" }, estado: "agente", aguardandoHumano: false, falhasSeguidas: 0, transbordou: false, naoLida: false, criadaEm: agora, atualizadaEm: agora, mensagens: [{ id: "x", de: "cliente", texto: "", em: agora }] };
  }

  // --- ações da equipe -------------------------------------------------

  assumir(id: string, atendente: string): Conversa {
    const c = this.obterOuFalhar(id);
    const nome = atendente.trim().slice(0, 40) || "Atendente";
    if (c.estado === "humano" && c.responsavel && c.responsavel !== nome) throw new ErroNegocio(`${c.responsavel} já assumiu esta conversa`, 409);
    c.estado = "humano";
    c.aguardandoHumano = false;
    c.responsavel = nome;
    c.naoLida = false;
    this.msg(c, "sistema", `${nome} assumiu a conversa`);
    this.salvar();
    return c;
  }

  responderHumano(id: string, texto: string): Conversa {
    const c = this.obterOuFalhar(id);
    const t = String(texto ?? "").trim().slice(0, LIMITE_TEXTO);
    if (!t) throw new ErroNegocio("mensagem vazia");
    if (c.estado !== "humano" || !c.responsavel) throw new ErroNegocio("assuma a conversa antes de responder", 409);
    this.msg(c, "humano", t, { atendente: c.responsavel });
    c.naoLida = false;
    this.salvar();
    return c;
  }

  devolver(id: string): Conversa {
    const c = this.obterOuFalhar(id);
    if (c.estado !== "humano") throw new ErroNegocio("a conversa já está com o agente", 409);
    c.estado = "agente";
    c.aguardandoHumano = false;
    c.responsavel = undefined;
    c.falhasSeguidas = 0;
    this.msg(c, "sistema", "Conversa devolvida ao agente");
    this.salvar();
    return c;
  }

  encerrar(id: string): Conversa {
    const c = this.obterOuFalhar(id);
    c.estado = "encerrada";
    c.aguardandoHumano = false;
    c.naoLida = false;
    this.msg(c, "sistema", "Conversa encerrada");
    this.salvar();
    return c;
  }

  marcarLida(id: string): void {
    const c = this.obterOuFalhar(id);
    if (c.naoLida) {
      c.naoLida = false;
      this.salvar();
    }
  }

  atualizarConfig(nova: unknown): Config {
    this.config = validarConfig(nova);
    return this.config;
  }

  metricas() {
    return calcularMetricas([...this.conversas.values()], this.config, this.relogio());
  }
}
