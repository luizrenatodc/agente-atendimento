import type { Config, Conversa } from "./tipos.ts";

export interface Metricas {
  totalConversas: number;
  totalMensagens: number;
  aguardandoHumano: number;
  comHumano: number;
  /** conversas resolvidas sem precisar de uma pessoa, em % */
  resolucaoAutomatica: number;
  taxaTransbordo: number;
  /** minutos entre o pedido de ajuda e a primeira resposta humana */
  esperaMediaHumanoMin: number | null;
  mensagensPorConversa: number;
  porDia: { dia: string; conversas: number }[];
  topicos: { rotulo: string; total: number }[];
  motivos: { motivo: string; total: number }[];
  lacunas: { pergunta: string; vezes: number }[];
}

function diaLocal(iso: string, fuso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: fuso }).format(new Date(iso));
}

export function calcularMetricas(conversas: Conversa[], config: Config, agora: Date): Metricas {
  const fuso = config.horario.fuso;
  const total = conversas.length;
  const transbordadas = conversas.filter((c) => c.transbordou);
  const msgs = conversas.reduce((s, c) => s + c.mensagens.filter((m) => m.de !== "sistema").length, 0);

  const esperas: number[] = [];
  for (const c of conversas) {
    const pedido = c.mensagens.find((m) => m.meta?.intencao === "transbordo");
    const resp = c.mensagens.find((m) => m.de === "humano");
    if (pedido && resp) esperas.push((Date.parse(resp.em) - Date.parse(pedido.em)) / 60000);
  }

  const dias: string[] = [];
  for (let i = 6; i >= 0; i--) dias.push(diaLocal(new Date(agora.getTime() - i * 86400000).toISOString(), fuso));
  const porDia = dias.map((dia) => ({ dia, conversas: conversas.filter((c) => diaLocal(c.criadaEm, fuso) === dia).length }));

  const rotulos = new Map<string, string>();
  for (const f of config.faq) rotulos.set(`faq:${f.id}`, f.pergunta.replace(/\?.*$/, "").trim());
  for (const p of config.catalogo) rotulos.set(`produto:${p.id}`, p.nome);
  const nomesFixos: Record<string, string> = { horario: "Horário de funcionamento", catalogo: "Catálogo e preços" };
  const topicos = new Map<string, number>();
  const motivos = new Map<string, number>();
  const lacunas = new Map<string, number>();
  for (const c of conversas) {
    c.mensagens.forEach((m, i) => {
      if (m.de !== "agente" || !m.meta) return;
      const f = m.meta.fonte ?? "";
      const rotulo = rotulos.get(f) ?? nomesFixos[f];
      if (rotulo) topicos.set(rotulo, (topicos.get(rotulo) ?? 0) + 1);
      if (m.meta.intencao === "desconhecida") {
        const anterior = c.mensagens.slice(0, i).reverse().find((x) => x.de === "cliente");
        if (anterior) lacunas.set(anterior.texto, (lacunas.get(anterior.texto) ?? 0) + 1);
      }
    });
    if (c.motivoTransbordo) {
      const m = c.motivoTransbordo.replace(/“[^”]*”/, "").replace(/^\d+ /, "").trim().replace(/:$/, "");
      const rot = m.charAt(0).toUpperCase() + m.slice(1);
      motivos.set(rot, (motivos.get(rot) ?? 0) + 1);
    }
  }
  const ordenar = <T extends [string, number]>(mapa: Map<string, number>, n: number) =>
    ([...mapa.entries()] as T[]).sort((a, b) => b[1] - a[1]).slice(0, n);

  return {
    totalConversas: total,
    totalMensagens: msgs,
    aguardandoHumano: conversas.filter((c) => c.aguardandoHumano).length,
    comHumano: conversas.filter((c) => c.estado === "humano" && !c.aguardandoHumano).length,
    resolucaoAutomatica: total ? Math.round(((total - transbordadas.length) / total) * 100) : 0,
    taxaTransbordo: total ? Math.round((transbordadas.length / total) * 100) : 0,
    esperaMediaHumanoMin: esperas.length ? Math.round((esperas.reduce((a, b) => a + b, 0) / esperas.length) * 10) / 10 : null,
    mensagensPorConversa: total ? Math.round((msgs / total) * 10) / 10 : 0,
    porDia,
    topicos: ordenar(topicos, 6).map(([rotulo, t]) => ({ rotulo, total: t })),
    motivos: ordenar(motivos, 5).map(([motivo, t]) => ({ motivo, total: t })),
    lacunas: ordenar(lacunas, 6).map(([pergunta, vezes]) => ({ pergunta, vezes })),
  };
}
