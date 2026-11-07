const PARADAS = new Set(
  (
    "a o as os um uma uns umas de do da dos das em no na nos nas por para pra com sem e ou que se me te meu minha seu sua " +
    "eu voce voces vc vcs ai ola oi bom boa dia tarde noite tudo bem queria quero gostaria saber poderia pode podem favor " +
    "qual quais como quando onde quanto quantos ha tem tenho tem ter ser sao foi vai vou ao aos mais muito so la aqui " +
    "isso esse essa isto este esta gente ne ta"
  ).split(" "),
);

const SUFIXOS = ["mente", "coes", "cao", "oes", "aes", "ar", "er", "ir", "am", "em", "es", "as", "os", "a", "e", "o", "s"];

export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function radical(p: string): string {
  if (p.length >= 6 && /(ais|eis|ois)$/.test(p)) return p.slice(0, -2) + "l";
  for (const suf of SUFIXOS) {
    if (p.endsWith(suf) && p.length - suf.length >= 3) return p.slice(0, p.length - suf.length);
  }
  return p;
}

export function tokens(s: string): string[] {
  return normalizar(s)
    .split(" ")
    .filter((p) => p && !PARADAS.has(p))
    .map(radical);
}

/** Verdadeiro se algum dos termos (frases) aparece no texto, ignorando acento e caixa. */
export function contemTermo(texto: string, termos: string[]): string | null {
  const t = ` ${normalizar(texto)} `;
  for (const termo of termos) {
    const n = normalizar(termo);
    if (n && t.includes(` ${n} `)) return termo;
  }
  return null;
}

export function dinheiro(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function preencher(modelo: string, dados: Record<string, string>): string {
  return modelo.replace(/\{(\w+)\}/g, (_, k) => dados[k] ?? "");
}
