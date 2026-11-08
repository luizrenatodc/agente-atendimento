# Política de segurança

## Como reportar uma vulnerabilidade

Não abra uma issue pública. Use o relato privado do GitHub: aba **Security**, **Report a vulnerability**. Descreva o que acontece, como reproduzir e o impacto que você enxerga. A resposta inicial costuma sair em alguns dias.

## O que o projeto já faz

- Painel protegido por token (`ADMIN_TOKEN`, cabeçalho `x-token`), comparado em tempo constante.
- Cabeçalhos de segurança em todas as respostas, incluindo uma Content-Security-Policy estrita.
- Limite de 200 000 bytes no corpo das requisições e de 1000 caracteres por mensagem.
- Caminhos de arquivos estáticos validados contra `..` e escapes inválidos.
- A visão da conversa para o cliente não expõe notas internas nem dados do motor.
- Chave do modelo (`LLM_API_KEY`) só por variável de ambiente, nunca gravada em arquivo.

## Pontos de atenção para quem for publicar

- Sem `ADMIN_TOKEN` as rotas `/api/admin` ficam abertas. Defina o token e sirva atrás de HTTPS.
- As conversas do cliente são identificadas apenas pelo id aleatório da conversa; quem tem o id lê a conversa. Não há contas de usuário.
- Não há limite de requisições por IP. Em produção, coloque um proxy com rate limit na frente.
- `dados/` guarda nomes e telefones de clientes; está no `.gitignore` e não deve ser versionada.
