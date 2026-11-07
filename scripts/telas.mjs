// Gera as capturas do painel e os quadros do GIF da conversa, com o servidor de verdade rodando.
// Uso: node scripts/telas.mjs   (precisa de puppeteer-core e do Edge/Chrome; veja as variáveis abaixo)
//   PUPPETEER_DIR  pasta onde puppeteer-core está instalado (padrão: pasta atual)
//   NAVEGADOR      caminho do Edge/Chrome (padrão: Edge do Windows)
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire((process.env.PUPPETEER_DIR ?? process.cwd()).replace(/[\\/]?$/, "/"));
const puppeteer = require("puppeteer-core");
const NAVEGADOR = process.env.NAVEGADOR ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORTA = 3399;
const BASE = `http://localhost:${PORTA}`;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = mkdtempSync(join(tmpdir(), "agente-"));
const servidor = spawn(process.execPath, ["src/servidor.ts"], {
  env: { ...process.env, PORT: String(PORTA), ARQUIVO_ESTADO: join(tmp, "estado.json"), ARQUIVO_CONFIG: join(tmp, "config.json") },
  stdio: "ignore",
});
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(`${BASE}/api/saude`)).ok) break; } catch { /* aguardando */ }
  await dormir(150);
}

mkdirSync("docs", { recursive: true });
mkdirSync("tmp/quadros", { recursive: true });
const b = await puppeteer.launch({ executablePath: NAVEGADOR, headless: "new" });
try {
  // --- painel ---
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const erros = [];
  p.on("pageerror", (e) => erros.push(e.message));
  p.on("console", (m) => m.type() === "error" && erros.push(m.text()));
  await p.goto(`${BASE}/admin#conversas`, { waitUntil: "networkidle0" });
  await p.waitForSelector(".msgs");
  // abre a conversa que está aguardando atendente
  await p.click('#filtros button[data-f="fila"]');
  await p.click("#lista button");
  await dormir(500);
  await p.click('#filtros button[data-f="todas"]');
  await p.screenshot({ path: "docs/admin-conversas.png" });
  await p.click('[data-aba="base"]');
  await p.type("#teste", "vocês entregam no domingo?");
  await p.keyboard.press("Enter");
  await dormir(700);
  await p.screenshot({ path: "docs/admin-base.png" });
  await p.click('[data-aba="ajustes"]');
  await dormir(300);
  await p.screenshot({ path: "docs/admin-ajustes.png", fullPage: true });
  await p.click('[data-aba="metricas"]');
  await dormir(700);
  await p.screenshot({ path: "docs/admin-metricas.png" });
  if (erros.length) console.log("ERROS NO PAINEL", erros);
  await p.close();

  // --- GIF do celular: grava quadros reais enquanto alguém conversa ---
  const c = await b.newPage();
  await c.setViewport({ width: 640, height: 880, deviceScaleFactor: 1.5 });
  await c.goto(`${BASE}/?nome=Marina%20Costa&nova=1`, { waitUntil: "networkidle0" });
  const caixa = await (await c.$(".celular")).boundingBox();
  const clip = { x: caixa.x - 14, y: caixa.y - 14, width: caixa.width + 28, height: caixa.height + 28 };
  const tempos = [];
  let gravando = true;
  const t0 = Date.now();
  const laco = (async () => {
    let n = 0;
    while (gravando) {
      const t = Date.now() - t0;
      await c.screenshot({ path: `tmp/quadros/f${String(n).padStart(4, "0")}.png`, clip });
      tempos.push(t);
      n++;
    }
  })();
  const digitar = async (txt) => { await c.click("#texto"); await c.type("#texto", txt, { delay: 55 }); await dormir(350); await c.keyboard.press("Enter"); };
  const esperarResposta = async (qtd) => {
    await c.waitForFunction((q) => document.querySelectorAll(".bolha.agente, .bolha.humano").length >= q && !document.querySelector(".digitando"), { timeout: 15000 }, qtd);
    await dormir(1300);
  };
  await dormir(1800);
  await digitar("quanto custa o buquê de girassóis?");
  await esperarResposta(2);
  await digitar("vocês entregam hoje?");
  await esperarResposta(3);
  await digitar("quero falar com um atendente");
  await esperarResposta(4);
  const id = await c.evaluate(() => sessionStorage.getItem("conversa"));
  const pst = (u, corpo) => fetch(BASE + u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
  await pst(`/api/admin/conversas/${id}/assumir`, { atendente: "Luiz" });
  await dormir(600);
  await pst(`/api/admin/conversas/${id}/responder`, { texto: "Oi, Marina! Sou o Luiz. Pode mandar o endereço que eu confirmo o prazo para hoje." });
  await c.waitForFunction(() => document.querySelectorAll(".bolha.humano").length >= 1, { timeout: 8000 });
  await dormir(2600);
  gravando = false;
  await laco;
  writeFileSync("tmp/quadros/tempos.json", JSON.stringify(tempos));
  console.log("quadros:", tempos.length, "duração (s):", ((Date.now() - t0) / 1000).toFixed(1));
} finally {
  await b.close();
  servidor.kill();
  rmSync(tmp, { recursive: true, force: true });
}
