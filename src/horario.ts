import { DIAS, NOMES_DIAS } from "./tipos.ts";
import type { Config, DiaSemana } from "./tipos.ts";

function partes(agora: Date, fuso: string): { dia: number; minutos: number } {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(agora);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "0";
  const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { dia, minutos: Number(get("hour")) * 60 + Number(get("minute")) };
}

function minutos(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export interface SituacaoHorario {
  aberto: boolean;
  /** texto pronto, ex.: "hoje às 09:00", "amanhã às 09:00" ou "segunda-feira às 09:00" */
  proximaAbertura: string;
  fechaAs?: string;
}

export function situacaoHorario(config: Config, agora: Date): SituacaoHorario {
  const { dia, minutos: min } = partes(agora, config.horario.fuso);
  const hoje = config.horario.semana[DIAS[dia]];
  if (hoje && min >= minutos(hoje[0]) && min < minutos(hoje[1])) {
    return { aberto: true, proximaAbertura: "agora", fechaAs: hoje[1] };
  }
  for (let i = 0; i <= 7; i++) {
    const d: DiaSemana = DIAS[(dia + i) % 7];
    const faixa = config.horario.semana[d];
    if (!faixa) continue;
    if (i === 0 && min >= minutos(faixa[0])) continue; // hoje, mas já passou do início
    const quando = i === 0 ? "hoje" : i === 1 ? "amanhã" : NOMES_DIAS[d];
    return { aberto: false, proximaAbertura: `${quando} às ${faixa[0]}` };
  }
  return { aberto: false, proximaAbertura: "em breve" };
}

/** Resumo legível da semana, agrupando dias seguidos com o mesmo horário. */
export function resumoSemana(config: Config): string {
  const ordem: DiaSemana[] = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];
  const curto: Record<DiaSemana, string> = { seg: "seg", ter: "ter", qua: "qua", qui: "qui", sex: "sex", sab: "sáb", dom: "dom" };
  const grupos: { de: DiaSemana; ate: DiaSemana; faixa: string }[] = [];
  for (const d of ordem) {
    const f = config.horario.semana[d];
    if (!f) continue;
    const faixa = `${f[0]} às ${f[1]}`;
    const ult = grupos[grupos.length - 1];
    const idx = (x: DiaSemana) => ordem.indexOf(x);
    if (ult && ult.faixa === faixa && idx(ult.ate) === idx(d) - 1) ult.ate = d;
    else grupos.push({ de: d, ate: d, faixa });
  }
  if (!grupos.length) return "sem horário de atendimento cadastrado";
  return grupos.map((g) => `${g.de === g.ate ? curto[g.de] : `${curto[g.de]} a ${curto[g.ate]}`}, das ${g.faixa}`).join("; ");
}
