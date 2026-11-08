const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const CORES = ["#0f8f7e", "#2563eb", "#c2410c", "#7c3aed", "#be185d", "#0e7490", "#4d7c0f", "#b45309"];
const DIAS = [["seg", "Segunda"], ["ter", "Terça"], ["qua", "Quarta"], ["qui", "Quinta"], ["sex", "Sexta"], ["sab", "Sábado"], ["dom", "Domingo"]];
const ROTULO_FONTE = { intencao: "saudação", horario: "horário", catalogo: "catálogo", transbordo: "transbordo", llm: "modelo" };
const TONS = { cordial: "Cordial", formal: "Formal", descontraido: "Descontraído" };

let token = sessionStorage.getItem("token") ?? "";
let config = null;
let salva = "";
let conversas = [];
let filtro = "todas";
let abertaId = null;
let assinatura = "";
let lacunas = [];

// --- util ---------------------------------------------------------------
async function api(caminho, opcoes = {}) {
  const r = await fetch(caminho, { ...opcoes, headers: { "content-type": "application/json", "x-token": token } });
  if (r.status === 401) {
    token = prompt("Token do painel (ADMIN_TOKEN):") ?? "";
    sessionStorage.setItem("token", token);
    return api(caminho, opcoes);
  }
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo.erro ?? "falha");
  return corpo;
}
const post = (c, corpo = {}) => api(c, { method: "POST", body: JSON.stringify(corpo) });

function aviso(texto, erro = false) {
  const el = $("#aviso");
  el.textContent = texto;
  el.className = "aviso" + (erro ? " erro" : "");
  el.hidden = false;
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => (el.hidden = true), 3200);
}
const lerCaminho = (o, c) => c.split(".").reduce((a, k) => a?.[k], o);
function gravarCaminho(o, c, v) {
  const ks = c.split(".");
  const ult = ks.pop();
  ks.reduce((a, k) => a[k], o)[ult] = v;
}
const hora = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
function quando(iso) {
  const d = new Date(iso);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return hora(iso);
  const ontem = new Date(hoje.getTime() - 86400000);
  if (d.toDateString() === ontem.toDateString()) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function dataHora(iso) {
  const q = quando(iso);
  return q === hora(iso) ? `hoje às ${q}` : `${q === "ontem" ? "ontem" : "em " + q} às ${hora(iso)}`;
}
const iniciais = (n) => n.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
const cor = (n) => CORES[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % CORES.length];

// --- abas -----------------------------------------------------------------
function irPara(aba) {
  $$(".abas [role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.aba === aba)));
  $$(".aba").forEach((s) => (s.hidden = s.id !== `aba-${aba}`));
  if (aba === "metricas") carregarMetricas();
  if (aba === "base") carregarLacunas();
  location.hash = aba;
}
$(".abas").addEventListener("click", (e) => {
  const b = e.target.closest("[role=tab]");
  if (b) irPara(b.dataset.aba);
});

// --- conversas ------------------------------------------------------------
function visivel(c) {
  if (filtro === "fila") return c.aguardandoHumano;
  if (filtro === "humano") return c.estado === "humano" && !c.aguardandoHumano;
  if (filtro === "agente") return c.estado === "agente";
  return true;
}
function rotuloEstado(c) {
  if (c.aguardandoHumano) return ["fila", "Aguardando"];
  if (c.estado === "humano") return ["humano", c.responsavel ?? "Com pessoa"];
  if (c.estado === "encerrada") return ["encerrada", "Encerrada"];
  return ["agente", "Agente"];
}
function desenharLista() {
  const fila = conversas.filter((c) => c.aguardandoHumano).length;
  const ct = $("#cont-fila");
  ct.hidden = !fila;
  ct.textContent = fila;
  $("#lista").innerHTML = conversas.filter(visivel).map((c) => {
    const [cls, txt] = rotuloEstado(c);
    return `<li class="${c.id === abertaId ? "ativo" : ""}"><button data-id="${c.id}">
      <span class="ini" style="background:${cor(c.cliente.nome)}">${esc(iniciais(c.cliente.nome))}</span>
      <span><span class="nome">${esc(c.cliente.nome)} ${c.naoLida ? '<i class="ponto" title="Não lida"></i>' : ""}</span><span class="ultima">${esc(c.ultima)}</span></span>
      <span class="meta"><span>${quando(c.atualizadaEm)}</span><span class="selo ${cls}">${esc(txt)}</span></span></button></li>`;
  }).join("") || '<li style="padding:16px;color:var(--suave)">Nenhuma conversa neste filtro.</li>';
}
async function carregarLista() {
  conversas = await api("/api/admin/conversas");
  desenharLista();
  if (abertaId) abrir(abertaId, true);
}
$("#filtros").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  filtro = b.dataset.f;
  $$("#filtros button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  desenharLista();
});
$("#lista").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-id]");
  if (b) abrir(b.dataset.id);
});

function nomeAtendente() {
  return localStorage.getItem("atendente") || "Luiz";
}
async function abrir(id, silencioso = false) {
  const c = await api(`/api/admin/conversas/${id}`);
  const sig = JSON.stringify([c.mensagens.length, c.estado, c.responsavel, c.aguardandoHumano]);
  if (silencioso && id === abertaId && sig === assinatura) return;
  abertaId = id;
  assinatura = sig;
  const campo = $("#resp-texto");
  const rascunho = campo?.value ?? "";
  const tinhaFoco = document.activeElement === campo;
  const [cls, txt] = rotuloEstado(c);
  const comigo = c.estado === "humano" && c.responsavel;
  const meuNome = nomeAtendente();
  $("#detalhe").innerHTML = `
    <div class="det-topo">
      <span class="ini" style="background:${cor(c.cliente.nome)}">${esc(iniciais(c.cliente.nome))}</span>
      <div><h2>${esc(c.cliente.nome)}</h2><small>${c.mensagens.length} mensagens · iniciada ${dataHora(c.criadaEm)}</small></div>
      <span class="selo ${cls}">${esc(txt)}</span>
      <div class="acoes">
        ${c.estado === "encerrada" ? "" : comigo
          ? `<button class="sec" data-acao="devolver">Devolver ao agente</button><button class="perigo" data-acao="encerrar">Encerrar</button>`
          : `<input id="meu-nome" value="${esc(meuNome)}" aria-label="Seu nome" style="width:110px"><button data-acao="assumir">Assumir conversa</button>`}
      </div>
    </div>
    ${c.motivoTransbordo && c.estado === "humano" ? `<div class="motivo"><b>Motivo do transbordo:</b> ${esc(c.motivoTransbordo)}</div>` : ""}
    <div class="msgs" id="msgs" tabindex="0" aria-label="Mensagens da conversa">${c.mensagens.map(bolha).join("")}</div>
    <div class="resp">${comigo && c.estado === "humano"
      ? `<label class="sr" for="resp-texto">Resposta</label><input id="resp-texto" placeholder="Responder como ${esc(c.responsavel)}…" autocomplete="off"><button data-acao="enviar">Enviar</button>`
      : `<p>${c.estado === "encerrada" ? "Conversa encerrada." : "O agente está respondendo. Assuma a conversa para escrever você mesmo."}</p>`}</div>`;
  const msgs = $("#msgs");
  msgs.scrollTop = msgs.scrollHeight;
  const novo = $("#resp-texto");
  if (novo) {
    novo.value = rascunho;
    if (tinhaFoco) novo.focus();
  }
  desenharLista();
}
function bolha(m) {
  if (m.de === "sistema") return `<div class="m sistema">${esc(m.texto)} · ${hora(m.em)}</div>`;
  let quem = "";
  let meta = hora(m.em);
  if (m.de === "agente") {
    quem = '<span class="quem">Agente</span>';
    const f = m.meta?.fonte;
    if (f && f !== "nenhuma") meta += ` · ${esc(ROTULO_FONTE[f] ?? f.replace(":", " · "))}`;
    if (typeof m.meta?.confianca === "number") meta += ` · ${Math.round(m.meta.confianca * 100)}%`;
  } else if (m.de === "humano") quem = `<span class="quem">${esc(m.meta?.atendente ?? "Equipe")}</span>`;
  return `<div class="m ${m.de}">${quem}${esc(m.texto)}<small>${meta}</small></div>`;
}
$("#detalhe").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-acao]");
  if (!b) return;
  try {
    const a = b.dataset.acao;
    if (a === "assumir") {
      const nome = $("#meu-nome").value.trim() || "Atendente";
      localStorage.setItem("atendente", nome);
      await post(`/api/admin/conversas/${abertaId}/assumir`, { atendente: nome });
    } else if (a === "devolver") await post(`/api/admin/conversas/${abertaId}/devolver`);
    else if (a === "encerrar") await post(`/api/admin/conversas/${abertaId}/encerrar`);
    else if (a === "enviar") return enviarResposta();
    assinatura = "";
    await carregarLista();
    await abrir(abertaId);
  } catch (err) {
    aviso(err.message, true);
  }
});
async function enviarResposta() {
  const campo = $("#resp-texto");
  const texto = campo.value.trim();
  if (!texto) return;
  try {
    await post(`/api/admin/conversas/${abertaId}/responder`, { texto });
    campo.value = "";
    assinatura = "";
    await carregarLista();
    await abrir(abertaId);
    $("#resp-texto")?.focus();
  } catch (err) {
    aviso(err.message, true);
  }
}
$("#detalhe").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "resp-texto") {
    e.preventDefault();
    enviarResposta();
  }
});

// --- configuração (base, tom, horário) -------------------------------------
function sujo() {
  return JSON.stringify(config) !== salva;
}
function marcar() {
  $("#salvar").hidden = !sujo();
  desenharPrevia();
  $("#valor-conf").textContent = Number(config.transbordo.confiancaMinima).toFixed(2);
}
async function carregarConfig() {
  config = await api("/api/admin/config");
  salva = JSON.stringify(config);
  $("#empresa-topo").textContent = config.empresa.nome;
  document.title = `Painel · ${config.empresa.nome}`;
  desenharConfig();
}
function desenharConfig() {
  $$("[data-c]").forEach((el) => {
    const v = lerCaminho(config, el.dataset.c);
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = v ?? "";
  });
  $$("[data-lista]").forEach((el) => (el.value = (lerCaminho(config, el.dataset.lista) ?? []).join(", ")));
  $("#fuso").textContent = config.horario.fuso;
  $("#tons").innerHTML = Object.entries(TONS).map(([k, v]) => `<button type="button" data-tom="${k}" aria-pressed="${config.tom.estilo === k}">${v}</button>`).join("");
  $("#semana").innerHTML = DIAS.map(([k, nome]) => {
    const f = config.horario.semana[k];
    return `<div class="dia-linha ${f ? "" : "fechado"}"><label class="check"><input type="checkbox" data-dia="${k}" ${f ? "checked" : ""}> ${nome}</label>
      <div class="horas">${f ? `<input type="time" data-hora="${k}:0" value="${f[0]}" aria-label="${nome}, abre"> às <input type="time" data-hora="${k}:1" value="${f[1]}" aria-label="${nome}, fecha">` : "<span>Sem atendimento</span>"}</div></div>`;
  }).join("");
  desenharFaq();
  desenharCatalogo();
  marcar();
}
function desenharPrevia() {
  const t = config.tom;
  const abertura = { cordial: "Claro! ", formal: "Prezado(a), ", descontraido: "Opa, essa eu sei! " }[t.estilo];
  const emoji = t.emoji ? { cordial: " 😊", formal: "", descontraido: " 😄" }[t.estilo] : "";
  const exemplo = config.faq[0]?.resposta ?? "Estamos à disposição.";
  $("#previa-tom").innerHTML = `<div>${esc(abertura + exemplo + emoji)}</div>`;
}
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.c) {
    gravarCaminho(config, el.dataset.c, el.type === "checkbox" ? el.checked : "num" in el.dataset ? Number(el.value) : el.value);
    marcar();
  } else if (el.dataset.lista) {
    gravarCaminho(config, el.dataset.lista, el.value.split(",").map((s) => s.trim()).filter(Boolean));
    marcar();
  } else if (el.dataset.hora) {
    const [d, i] = el.dataset.hora.split(":");
    config.horario.semana[d][Number(i)] = el.value;
    marcar();
  } else if (el.dataset.faq) {
    const [i, campo] = el.dataset.faq.split(":");
    config.faq[i][campo] = campo === "palavras" ? el.value.split(",").map((s) => s.trim()).filter(Boolean) : el.value;
    marcar();
  } else if (el.dataset.cat) {
    const [i, campo] = el.dataset.cat.split(":");
    config.catalogo[i][campo] = campo === "preco" ? Number(el.value) : el.value;
    marcar();
  }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.dia) {
    config.horario.semana[el.dataset.dia] = el.checked ? ["09:00", "18:00"] : null;
    desenharConfig();
  }
});
$("#tons").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tom]");
  if (!b) return;
  config.tom.estilo = b.dataset.tom;
  $$("#tons button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  marcar();
});

function desenharFaq(novaIdx = -1) {
  $("#faq").innerHTML = config.faq.map((f, i) => `<div class="item ${i === novaIdx ? "nova" : ""}"><div class="linha">
    <label>Pergunta<input data-faq="${i}:pergunta" value="${esc(f.pergunta)}"></label>
    <label>Resposta<textarea rows="2" data-faq="${i}:resposta">${esc(f.resposta)}</textarea></label>
    <label>Palavras-chave<input data-faq="${i}:palavras" value="${esc(f.palavras.join(", "))}" placeholder="entrega, frete, prazo"></label></div>
    <div class="rodape"><button type="button" class="perigo" data-del-faq="${i}">Remover</button></div></div>`).join("");
}
function desenharCatalogo() {
  $("#catalogo").innerHTML = config.catalogo.map((p, i) => `<div class="cat">
    <input data-cat="${i}:nome" value="${esc(p.nome)}" aria-label="Nome do item">
    <input data-cat="${i}:preco" type="number" min="0" step="0.01" value="${p.preco}" aria-label="Preço em reais">
    <input data-cat="${i}:descricao" value="${esc(p.descricao)}" aria-label="Descrição">
    <button type="button" class="perigo" data-del-cat="${i}" aria-label="Remover ${esc(p.nome)}">×</button></div>`).join("");
}
$("#faq").addEventListener("click", (e) => {
  const b = e.target.closest("[data-del-faq]");
  if (!b) return;
  config.faq.splice(Number(b.dataset.delFaq), 1);
  desenharFaq();
  marcar();
});
$("#catalogo").addEventListener("click", (e) => {
  const b = e.target.closest("[data-del-cat]");
  if (!b) return;
  config.catalogo.splice(Number(b.dataset.delCat), 1);
  desenharCatalogo();
  marcar();
});
function novaFaq(pergunta = "") {
  config.faq.unshift({ id: `faq-${Date.now()}`, pergunta, resposta: "", palavras: [] });
  desenharFaq(0);
  marcar();
  irPara("base");
  $("#faq input")?.focus();
}
$("#add-faq").addEventListener("click", () => novaFaq());
$("#add-item").addEventListener("click", () => {
  config.catalogo.push({ id: `item-${Date.now()}`, nome: "Novo item", preco: 0, descricao: "" });
  desenharCatalogo();
  marcar();
  $$("#catalogo input").at(-3)?.select();
});

$("#btn-salvar").addEventListener("click", async () => {
  try {
    config = await api("/api/admin/config", { method: "PUT", body: JSON.stringify(config) });
    salva = JSON.stringify(config);
    desenharConfig();
    $("#empresa-topo").textContent = config.empresa.nome;
    aviso("Alterações salvas. O agente já usa a nova base.");
  } catch (err) {
    aviso(err.message, true);
  }
});
$("#btn-descartar").addEventListener("click", () => {
  config = JSON.parse(salva);
  desenharConfig();
});

// --- teste e lacunas --------------------------------------------------------
$("#form-teste").addEventListener("submit", async (e) => {
  e.preventDefault();
  const texto = $("#teste").value.trim();
  if (!texto) return;
  try {
    // o teste usa a base salva; avisamos se há alterações pendentes
    const r = await post("/api/admin/testar", { texto });
    const c = r.resposta.confianca;
    const ok = r.responderia;
    $("#resultado-teste").innerHTML = `<div class="${ok ? "teste-ok" : "teste-nao"}">
      <b>${ok ? "O agente responderia:" : r.transbordaria ? `Chamaria uma pessoa (${esc(r.transbordaria)})` : "Não saberia responder"}</b>
      ${ok ? `<div>${esc(r.resposta.texto)}</div>` : ""}
      <div class="barra-conf" title="Confiança"><i style="width:${Math.round(c * 100)}%"></i></div>
      <small>Confiança ${Math.round(c * 100)}% (mínimo ${Math.round(config.transbordo.confiancaMinima * 100)}%)${sujo() ? " · teste usa a base já salva" : ""}</small>
      ${r.candidatos.length ? `<ul class="cands">${r.candidatos.map((k) => `<li>${esc(k.titulo)} · ${Math.round(k.confianca * 100)}%</li>`).join("")}</ul>` : ""}</div>`;
  } catch (err) {
    aviso(err.message, true);
  }
});
async function carregarLacunas() {
  const m = await api("/api/admin/metricas");
  lacunas = m.lacunas;
  $("#lacunas").innerHTML = lacunas.map((l, i) => `<li><span>“${esc(l.pergunta)}”${l.vezes > 1 ? ` <small>×${l.vezes}</small>` : ""}</span><button class="sec" data-lac="${i}">Criar FAQ</button></li>`).join("")
    || '<li style="background:none;color:var(--suave)">Nada por enquanto. Bom sinal.</li>';
}
$("#lacunas").addEventListener("click", (e) => {
  const b = e.target.closest("[data-lac]");
  if (b) novaFaq(lacunas[Number(b.dataset.lac)].pergunta);
});

// --- métricas -----------------------------------------------------------------
function barras(lista, chave, valor) {
  if (!lista.length) return '<p class="dica">Sem dados ainda.</p>';
  const max = Math.max(...lista.map((x) => x[valor]));
  return `<div class="barras">${lista.map((x) => `<div class="l"><div><span>${esc(x[chave])}</span><div class="trilho"><i style="width:${(x[valor] / max) * 100}%"></i></div></div><b>${x[valor]}</b></div>`).join("")}</div>`;
}
async function carregarMetricas() {
  const m = await api("/api/admin/metricas");
  const espera = m.esperaMediaHumanoMin === null ? "—" : `${String(m.esperaMediaHumanoMin).replace(".", ",")} min`;
  $("#kpis").innerHTML = [
    ["destaque", m.resolucaoAutomatica + "%", "Resolvidas só pelo agente"],
    ["", m.totalConversas, "Conversas"],
    ["", m.totalMensagens, "Mensagens trocadas"],
    ["", m.taxaTransbordo + "%", "Chamaram uma pessoa"],
    ["alerta", m.aguardandoHumano, "Aguardando atendente agora"],
    ["", espera, "Espera média por pessoa"],
  ].map(([c, v, t]) => `<div class="kpi ${c}"><b>${v}</b><span>${t}</span></div>`).join("");
  const max = Math.max(1, ...m.porDia.map((d) => d.conversas));
  $("#grafico-dias").innerHTML = `<div class="col">${m.porDia.map((d) => {
    const dt = new Date(d.dia + "T12:00:00");
    const rot = dt.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
    return `<div class="c"><b>${d.conversas}</b><i style="height:${(d.conversas / max) * 100}%"></i><span>${rot}</span></div>`;
  }).join("")}</div>`;
  $("#topicos").innerHTML = barras(m.topicos, "rotulo", "total");
  $("#motivos").innerHTML = barras(m.motivos, "motivo", "total");
  $("#lacunas-m").innerHTML = barras(m.lacunas.map((l) => ({ ...l, pergunta: `“${l.pergunta}”` })), "pergunta", "vezes");
}

// --- início ---------------------------------------------------------------------
async function iniciar() {
  const saude = await fetch("/api/saude").then((r) => r.json());
  $("#provedor").textContent = `provedor: ${saude.provedor === "llm" ? "modelo de linguagem" : "motor local de demonstração"}`;
  await carregarConfig();
  await carregarLista();
  const aba = location.hash.slice(1);
  if (["conversas", "base", "ajustes", "metricas"].includes(aba)) irPara(aba);
  const primeira = conversas.find((c) => c.aguardandoHumano) ?? conversas[0];
  if (primeira && !new URLSearchParams(location.search).has("vazio")) abrir(primeira.id);
  setInterval(() => {
    carregarLista().catch(() => {});
    if (!$("#aba-metricas").hidden) carregarMetricas().catch(() => {});
  }, 2500);
}
iniciar().catch((e) => aviso(e.message, true));
