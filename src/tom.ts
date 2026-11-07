import type { Config } from "./tipos.ts";

const ABERTURAS: Record<Config["tom"]["estilo"], string[]> = {
  cordial: ["Claro! ", "Com prazer! "],
  formal: ["Prezado(a), ", "Informamos que "],
  descontraido: ["Opa, essa eu sei! ", "Bora lá! "],
};

const EMOJI: Record<Config["tom"]["estilo"], string> = { cordial: " 😊", formal: "", descontraido: " 😄" };

/** Aplica o estilo escolhido no painel a uma resposta já pronta. Determinístico, para os testes. */
export function aplicarTom(texto: string, config: Config): string {
  const { estilo, emoji } = config.tom;
  const aberturas = ABERTURAS[estilo];
  const abertura = aberturas[texto.length % aberturas.length];
  let t = texto;
  if (estilo === "formal") {
    t = abertura === "Informamos que " ? abertura + t.charAt(0).toLowerCase() + t.slice(1) : abertura + t;
  } else {
    t = abertura + t;
  }
  return t + (emoji ? EMOJI[estilo] : "");
}

/** Mensagens fixas (saudação, transbordo...) só ganham o emoji, sem abertura. */
export function enfeitar(texto: string, config: Config): string {
  return texto + (config.tom.emoji ? EMOJI[config.tom.estilo] : "");
}
