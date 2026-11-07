const conversa = document.getElementById("conversa");
const form = document.getElementById("form");
const campo = document.getElementById("texto");
const subtitulo = document.getElementById("subtitulo");
const SUB_PADRAO = "assistente virtual · online";

const params = new URLSearchParams(location.search);
const mostradas = new Set();
let id = null;
let ocupado = false;
let fila = Promise.resolve();

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const hora = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

async function api(caminho, opcoes) {
  const r = await fetch(caminho, { ...opcoes, headers: { "content-type": "application/json" } });
  if (!r.ok) throw new Error((await r.json()).erro ?? "falha");
  return r.json();
}

function bolha(m) {
  const el = document.createElement("div");
  el.className = `bolha ${m.de}`;
  if (m.de === "humano") {
    const a = document.createElement("span");
    a.className = "autor";
    a.textContent = `${m.atendente ?? "Equipe"} · equipe`;
    el.append(a);
  }
  el.append(document.createTextNode(m.texto));
  const h = document.createElement("span");
  h.className = "hora";
  h.textContent = hora(m.em);
  if (m.de === "cliente") {
    const v = document.createElement("span");
    v.className = "lida";
    v.textContent = "✓✓";
    h.append(v);
  }
  el.append(h);
  return el;
}

function rolar() {
  conversa.scrollTop = conversa.scrollHeight;
}

function mostrar(m) {
  if (mostradas.has(m.id)) return;
  mostradas.add(m.id);
  conversa.append(bolha(m));
  rolar();
}

let digitandoEl = null;
function digitando(ligado) {
  if (ligado && !digitandoEl) {
    digitandoEl = document.createElement("div");
    digitandoEl.className = "digitando";
    digitandoEl.setAttribute("aria-label", "O atendente está digitando");
    digitandoEl.innerHTML = "<i></i><i></i><i></i>";
    conversa.append(digitandoEl);
    subtitulo.textContent = "digitando…";
    rolar();
  } else if (!ligado && digitandoEl) {
    digitandoEl.remove();
    digitandoEl = null;
    subtitulo.textContent = SUB_PADRAO;
  }
}

function legendaDoEstado(c) {
  if (c.estado === "humano") subtitulo.textContent = c.responsavel ? `${c.responsavel} · equipe` : "aguardando uma pessoa da equipe…";
  else if (!digitandoEl) subtitulo.textContent = SUB_PADRAO;
}

async function iniciar() {
  const pub = await api("/api/publico");
  document.getElementById("nome-empresa").textContent = pub.nome;
  document.title = `${pub.nome} · atendimento`;
  const salvo = sessionStorage.getItem("conversa");
  let c;
  if (salvo && !params.has("nova")) {
    try { c = await api(`/api/conversas/${salvo}`); } catch { c = null; }
  }
  if (!c) c = await api("/api/conversas", { method: "POST", body: JSON.stringify({ nome: params.get("nome") ?? "" }) });
  id = c.id;
  sessionStorage.setItem("conversa", id);
  const dia = document.createElement("div");
  dia.className = "dia";
  dia.textContent = "Hoje";
  conversa.append(dia);
  for (const m of c.mensagens) {
    if (c.mensagens.length === 1) await esperar(500);
    mostrar(m);
  }
  legendaDoEstado(c);
  setInterval(sincronizar, 2000);
}

/** Traz mensagens que chegaram de fora (resposta de uma pessoa da equipe). */
async function sincronizar() {
  if (ocupado || !id) return;
  try {
    const c = await api(`/api/conversas/${id}`);
    for (const m of c.mensagens) mostrar(m);
    legendaDoEstado(c);
  } catch { /* próxima volta */ }
}

async function enviar(texto) {
  texto = texto.trim();
  if (!texto || !id) return;
  fila = fila.then(async () => {
    ocupado = true;
    const agora = new Date().toISOString();
    const otimista = { id: `l_${Math.random()}`, de: "cliente", texto, em: agora };
    mostrar(otimista);
    await esperar(450);
    digitando(true);
    try {
      const c = await api(`/api/conversas/${id}/mensagens`, { method: "POST", body: JSON.stringify({ texto }) });
      // a bolha otimista já está na tela: marcamos o id real para a sincronização não duplicar
      const reais = c.mensagens;
      const novas = reais.filter((m) => c.novas.includes(m.id));
      const clienteReal = reais.filter((m) => m.de === "cliente").at(-1);
      if (clienteReal) mostradas.add(clienteReal.id);
      for (const m of novas) {
        await esperar(Math.min(2000, 650 + m.texto.length * 11));
        digitando(false);
        mostrar(m);
        if (m !== novas.at(-1)) { await esperar(350); digitando(true); }
      }
      digitando(false);
      legendaDoEstado(c);
    } catch (e) {
      digitando(false);
      const aviso = document.createElement("div");
      aviso.className = "sistema";
      aviso.textContent = `Não foi possível enviar: ${e.message}`;
      conversa.append(aviso);
    } finally {
      ocupado = false;
    }
  });
}

form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const t = campo.value;
  campo.value = "";
  enviar(t);
});
document.getElementById("atalhos").addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (b) enviar(b.textContent);
});

const relogio = document.getElementById("relogio");
const tique = () => (relogio.textContent = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
tique();
setInterval(tique, 20000);

iniciar().catch((e) => {
  conversa.textContent = `Não consegui conectar: ${e.message}`;
});
