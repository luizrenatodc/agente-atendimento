import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Atendimento } from "./agente.ts";
import { criarApp } from "./app.ts";
import { carregarConfig } from "./config.ts";
import { provedorDoAmbiente } from "./llm.ts";
import { semear } from "./semente.ts";

const raiz = fileURLToPath(new URL("..", import.meta.url));
const env = process.env;
const arquivoConfig = env.ARQUIVO_CONFIG ?? `${raiz}dados/config.json`;
const arquivoEstado = env.ARQUIVO_ESTADO ?? `${raiz}dados/estado.json`;
const primeiraVez = !existsSync(arquivoEstado);

const at = new Atendimento({
  config: carregarConfig(arquivoConfig),
  provedor: provedorDoAmbiente(env),
  arquivoEstado,
});
if (primeiraVez && env.SEMEAR !== "0") await semear(at);

const porta = Number(env.PORT ?? 3000);
criarApp(at, { pastaPublica: `${raiz}public`, arquivoConfig, tokenAdmin: env.ADMIN_TOKEN }).listen(porta, () => {
  console.log(`Agente de atendimento (${at.provedor.nome}) em http://localhost:${porta}`);
  console.log(`  cliente: http://localhost:${porta}/   painel: http://localhost:${porta}/admin`);
});
