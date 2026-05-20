Quero que voce me ensine linha por linha como funciona este projeto Electron + React + TypeScript de bot para WhatsApp.

Contexto do projeto:

- A tela principal do app fica em `src/desktop/renderer/App.tsx`.
- Os botoes de conectar, iniciar bot, parar bot, reiniciar e gerar novo QR ficam em `src/desktop/renderer/components/ControlButtons.tsx`.
- A parte de selecionar e salvar grupo fica em `src/desktop/renderer/components/GroupConfig.tsx`.
- A parte de configurar o nome e os codigos/mensagens fica em `src/desktop/renderer/components/MessageConfig.tsx`.
- O estilo visual da tela, incluindo a janela de confirmacao, fica em `src/desktop/renderer/styles.css`.
- A ponte entre a tela e o Electron fica em `src/desktop/preload.ts`.
- Os comandos IPC do Electron ficam em `src/desktop/main.ts`.
- A conexao com WhatsApp, monitoramento do grupo e envio das mensagens ficam em `src/bot/connection.ts`.
- Os tipos compartilhados da aplicacao ficam em `src/shared/types.ts`.

O que foi adicionado:

1. Em `src/desktop/renderer/App.tsx`, foi criada uma tela de confirmacao reutilizavel.
2. Quando clicar em "Salvar grupo", antes de salvar aparece:
   "Deseja realmente enviar mensagens no grupo: NOME_DO_GRUPO?"
3. Quando clicar em "Salvar mensagem", antes de salvar aparece uma confirmacao mostrando as mensagens que serao salvas.
4. Quando clicar em "Iniciar bot", antes de ativar o monitoramento aparece:
   "Deseja iniciar o bot com estas configuracoes?"
   A tela mostra o grupo selecionado e as mensagens que serao enviadas.
5. Em `src/desktop/renderer/styles.css`, foram adicionadas as classes `.modal-backdrop`, `.confirmation-dialog`, `.confirmation-message`, `.confirmation-details` e `.confirmation-actions`.
6. Em `src/desktop/main.ts`, o comando `bot:enableMonitoring` agora usa `await bot.enableMonitoring()` para esperar a ativacao terminar antes de devolver o estado para a tela.
7. Em `src/bot/connection.ts`, o metodo `getSnapshot()` foi apenas organizado na indentacao e o log foi corrigido para informar intervalo de 80ms, que e o intervalo real usado no envio.

Quero que voce explique:

1. O fluxo completo quando o usuario clica em "Salvar grupo":
   - `GroupConfig.tsx`
   - `App.tsx`
   - `window.botApi.saveGroup`
   - `preload.ts`
   - `main.ts`
   - `BotService.saveGroup` em `connection.ts`

2. O fluxo completo quando o usuario clica em "Salvar mensagem":
   - `MessageConfig.tsx`
   - `App.tsx`
   - `window.botApi.saveMessageSettings`
   - `preload.ts`
   - `main.ts`
   - `BotService.setMessageSettings` em `connection.ts`

3. O fluxo completo quando o usuario clica em "Iniciar bot":
   - `ControlButtons.tsx`
   - `App.tsx`
   - `window.botApi.startMonitoring`
   - `preload.ts`
   - `main.ts`
   - `BotService.enableMonitoring` em `connection.ts`

4. Como a janela de confirmacao funciona:
   - O tipo `PendingConfirmation`
   - O estado `confirmation`
   - As funcoes `confirmSaveGroup`, `confirmSaveMessages`, `confirmStartMonitoring` e `confirmPendingAction`
   - O JSX do modal no final de `App.tsx`
   - O CSS do modal em `styles.css`

5. Me ensine linha por linha, explicando de forma simples, como se eu estivesse aprendendo React, TypeScript e Electron agora.

6. Se encontrar algum nome confuso, me sugira nomes melhores, mas sem mudar o comportamento do bot.
