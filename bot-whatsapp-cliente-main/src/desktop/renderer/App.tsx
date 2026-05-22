import { useEffect, useMemo, useState } from "react";
import { BotSnapshot } from "../../shared/types";
import { ControlButtons } from "./components/ControlButtons";
import { GroupConfig } from "./components/GroupConfig";
import { GroupTestConfig } from "./components/GroupTestConfig";
import { LogsPanel } from "./components/LogsPanel";
import { MessageConfig } from "./components/MessageConfig";
import { QrCodeBox } from "./components/QrCodeBox";
import { RealRouteConfig } from "./components/RealRouteConfig";
import { StatusCard } from "./components/StatusCard";
import "./styles.css";

type PendingConfirmation = {
  title: string;
  message: string;
  details: string[];
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
};

type OnboardingStep =
  | "warmup-group"
  | "warmup-message"
  | "warmup-clicks"
  | "target-test-group"
  | "target-test-message"
  | "target-test-start"
  | "target-test-finish"
  | "target-test-stop"
  | "real-message"
  | "real-group"
  | "real-warmup-clicks"
  | "real-start"
  | "completed";

type OnboardingState = {
  step: OnboardingStep;
  warmupClicks: number;
  realWarmupClicks: number;
  testTargetMessages: string[];
  targetTestGroupKey: string;
};

const ONBOARDING_STORAGE_KEY = "botOnboardingState";

const initialOnboardingState: OnboardingState = {
  step: "warmup-group",
  warmupClicks: 0,
  realWarmupClicks: 0,
  testTargetMessages: [],
  targetTestGroupKey: ""
};

const emptySnapshot: BotSnapshot = {
  status: "disconnected",
  groupState: "unknown",
  qrCode: "",
  config: {
    grupoAlvoJid: "",
    grupoAlvoNome: "",
    grupoTesteJid: "",
    grupoTesteNome: "",
    nomeEnvio: "Alan da Silva Alves",
    codigosMensagensAlvo: [],
    codigosMensagensTeste: []
  },
  groups: [],
  readinessChecks: [],
  logs: []
};

function normalizeMessages(senderName: string, codes: string[]) {
  return codes.map((code) => `${senderName.trim()} ${code.trim().toUpperCase()}`.trim()).filter(Boolean);
}

function loadOnboardingState(): OnboardingState {
  try {
    const saved = JSON.parse(window.localStorage.getItem(ONBOARDING_STORAGE_KEY) || "");
    if (saved?.step === "completed") return initialOnboardingState;

    return {
      ...initialOnboardingState,
      ...saved,
      warmupClicks: Number(saved?.warmupClicks || 0),
      realWarmupClicks: Number(saved?.realWarmupClicks || 0),
      testTargetMessages: Array.isArray(saved?.testTargetMessages) ? saved.testTargetMessages : [],
      targetTestGroupKey: typeof saved?.targetTestGroupKey === "string" ? saved.targetTestGroupKey : ""
    };
  } catch {
    return initialOnboardingState;
  }
}

export default function App() {
  const [snapshot, setSnapshot] = useState<BotSnapshot>(emptySnapshot);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<PendingConfirmation>();
  const [onboarding, setOnboarding] = useState<OnboardingState>(() => loadOnboardingState());
  const [onboardingError, setOnboardingError] = useState("");
  const isOnboardingReady = snapshot.status === "connected" && onboarding.step !== "completed";
  const isDev = window.location.protocol === "http:";

  useEffect(() => {
    window.botApi.getSnapshot().then(setSnapshot);
    return window.botApi.onSnapshot(setSnapshot);
  }, []);

  useEffect(() => {
    if (onboarding.step === "completed") {
      window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(onboarding));
  }, [onboarding]);

  useEffect(() => {
    if (!isOnboardingReady) return;

    const current = getCurrentTutorialTarget();
    const element = current?.targetId ? document.querySelector(`[data-tutorial-id="${current.targetId}"]`) : undefined;
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [isOnboardingReady, onboarding.step, onboarding.warmupClicks, onboarding.realWarmupClicks]);

  const groupLabel = useMemo(() => {
    return snapshot.config.grupoAlvoNome || snapshot.config.grupoAlvoJid || "Nenhum grupo configurado";
  }, [snapshot.config]);

  async function runAction(action: () => Promise<BotSnapshot>) {
    setBusy(true);
    try {
      const nextSnapshot = await action();
      setSnapshot(nextSnapshot);
      return nextSnapshot;
    } finally {
      setBusy(false);
    }
  }

  function buildMessagePreview(senderName = snapshot.config.nomeEnvio, codes = snapshot.config.codigosMensagensAlvo) {
    return normalizeMessages(senderName, codes || []);
  }

  function updateOnboarding(next: Partial<OnboardingState>) {
    setOnboarding((current) => ({ ...current, ...next }));
    setOnboardingError("");
  }

  function completeOnboarding() {
    updateOnboarding({ step: "completed" });
  }

  function resetOnboarding() {
    window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    setOnboarding(initialOnboardingState);
    setOnboardingError("");
  }

  function getCurrentTutorialTarget() {
    const map: Record<OnboardingStep, { targetId?: string; title: string; text: string; warning?: string; counter?: string }> = {
      "warmup-group": {
        targetId: "warmup-group-panel",
        title: "Etapa 1 de 12",
        text: "Primeiro passo: escolha e salve o grupo de aquecimento. Esse grupo será usado para preparar o bot antes de ir para as rotas reais."
      },
      "warmup-message": {
        targetId: "message-panel",
        title: "Etapa 2 de 12",
        text: "Agora crie a mensagem de aquecimento. Esse texto será enviado no grupo de aquecimento para preparar o envio antes do teste."
      },
      "warmup-clicks": {
        targetId: "warmup-button",
        title: "Etapa 3 de 12",
        text: "Clique no pré-aquecimento 3 vezes para preparar o bot. Isso é obrigatório antes de configurar o grupo alvo teste.",
        counter: `${onboarding.warmupClicks}/3`
      },
      "target-test-group": {
        targetId: "target-group-panel",
        title: "Etapa 4 de 12",
        text: "Agora escolha o grupo alvo TESTE. Atenção: esse ainda NÃO é o grupo alvo real. Use um grupo seguro para testar antes de enviar nas rotas reais.",
        warning: "ATENÇÃO: este ainda não é o grupo real."
      },
      "target-test-message": {
        targetId: "message-panel",
        title: "Etapa 5 de 12",
        text: "Agora escreva a mensagem que será enviada para o grupo alvo teste. Use uma mensagem de teste para confirmar se tudo está funcionando."
      },
      "target-test-start": {
        targetId: "start-monitoring",
        title: "Etapa 6 de 12",
        text: "Inicie o bot agora para testar o envio no grupo alvo teste. Quando terminar esse aquecimento, clique em 'Terminei o aquecimento alvo'."
      },
      "target-test-finish": {
        title: "Etapa 6 de 12",
        text: "Aguarde o teste no grupo alvo terminar. Depois clique em 'Terminei o aquecimento alvo' para continuar."
      },
      "target-test-stop": {
        targetId: "stop-monitoring",
        title: "Etapa 7 de 12",
        text: "Agora pare o bot antes de configurar as rotas reais. Isso evita envio errado no grupo errado."
      },
      "real-message": {
        targetId: "message-panel",
        title: "Etapa 8 de 12",
        text: "Agora escreva a mensagem REAL das rotas. Atenção: essa mensagem não pode ser igual à mensagem usada no teste."
      },
      "real-group": {
        targetId: "target-group-panel",
        title: "Etapa 9 de 12",
        text: "Agora escolha o GRUPO ALVO REAL. Tenha muita atenção nessa parte, porque agora é o grupo verdadeiro das rotas.",
        warning: "ATENÇÃO: este é o grupo real das rotas."
      },
      "real-warmup-clicks": {
        targetId: "warmup-button",
        title: "Etapa 10 de 12",
        text: "Antes de iniciar as rotas reais, faça mais um pré-aquecimento. Clique 3 vezes no pré-aquecimento para preparar o bot.",
        counter: `${onboarding.realWarmupClicks}/3`
      },
      "real-start": {
        targetId: "start-monitoring",
        title: "Etapa 11 de 12",
        text: "Agora sim. Inicie o bot. Ele está pronto para trabalhar com as rotas reais."
      },
      completed: {
        title: "Etapa 12 de 12",
        text: "Configuração concluída. Agora você pode usar o bot normalmente."
      }
    };

    return map[onboarding.step];
  }

  function canUsePanel(panel: "warmup-group" | "target-group" | "message" | "controls" | "warmup-button") {
    if (!isOnboardingReady) return true;
    if (panel === "warmup-group") return onboarding.step === "warmup-group";
    if (panel === "target-group") return onboarding.step === "target-test-group" || onboarding.step === "real-group";
    if (panel === "message") return onboarding.step === "warmup-message" || onboarding.step === "target-test-message" || onboarding.step === "real-message";
    if (panel === "warmup-button") return onboarding.step === "warmup-clicks" || onboarding.step === "real-warmup-clicks";
    if (panel === "controls") return onboarding.step === "target-test-start" || onboarding.step === "target-test-stop" || onboarding.step === "real-start";
    return false;
  }

  function confirmSaveGroup(group: string, groupId?: string, groupName?: string) {
    if (isOnboardingReady && onboarding.step === "target-test-group") {
      const targetTestGroupKey = groupId || groupName || group;
      void runAction(() => window.botApi.saveGroup({ group, groupId, groupName })).then(() => {
        updateOnboarding({ step: "target-test-message", targetTestGroupKey });
      });
      return;
    }

    if (isOnboardingReady && onboarding.step === "real-group") {
      const realGroupKey = groupId || groupName || group;
      if (onboarding.targetTestGroupKey && realGroupKey === onboarding.targetTestGroupKey) {
        setOnboardingError("O grupo alvo real não pode ser igual ao grupo alvo teste. Escolha o grupo verdadeiro das rotas.");
        return;
      }

      void runAction(() => window.botApi.saveGroup({ group, groupId, groupName })).then(() => {
        updateOnboarding({ step: "real-warmup-clicks", realWarmupClicks: 0 });
      });
      return;
    }

    const selectedGroupName = groupName || group;

    setConfirmation({
      title: "Confirmar grupo",
      message: `Deseja realmente enviar mensagens no grupo: ${selectedGroupName}?`,
      details: groupId ? [`ID do grupo: ${groupId}`] : ["Grupo informado manualmente."],
      confirmLabel: "Salvar grupo",
      onConfirm: async () => {
        await runAction(() => window.botApi.saveGroup({ group, groupId, groupName }));
      }
    });
  }

  function confirmSaveTestGroup(group: string, groupId?: string, groupName?: string) {
    if (isOnboardingReady && onboarding.step === "warmup-group") {
      void runAction(() => window.botApi.saveTestGroup({ group, groupId, groupName })).then(() => {
        updateOnboarding({ step: "warmup-message" });
      });
      return;
    }

    const selectedGroupName = groupName || group;

    setConfirmation({
      title: "Confirmar grupo de teste",
      message: `Deseja salvar este grupo apenas para aquecimento da sessão?`,
      details: groupId ? [`ID do grupo de teste: ${groupId}`] : ["Grupo de teste informado manualmente."],
      confirmLabel: "Salvar grupo de teste",
      onConfirm: async () => {
        await runAction(() => window.botApi.saveTestGroup({ group, groupId, groupName }));
      }
    });
  }

  function confirmSaveMessages(senderName: string, codes: string[]) {
    const messages = buildMessagePreview(senderName, codes);

    setConfirmation({
      title: "Confirmar mensagens",
      message: "Deseja salvar estas mensagens para envio?",
      details: messages.length ? messages : ["Nenhuma mensagem pronta."],
      confirmLabel: "Salvar mensagens",
      onConfirm: async () => {
        await runAction(() => window.botApi.saveMessageSettings({ senderName, codes }));
      }
    });
  }

  function confirmSaveWarmupMessages(senderName: string, codes: string[]) {
    if (isOnboardingReady && onboarding.step === "warmup-message") {
      if (!senderName.trim() || !codes.length) {
        setOnboardingError("Preencha e salve uma mensagem de aquecimento antes de continuar.");
        return;
      }

      void runAction(() => window.botApi.saveWarmupMessageSettings({ senderName, codes })).then(() => {
        updateOnboarding({ step: "warmup-clicks", warmupClicks: 0 });
      });
      return;
    }

    const messages = buildMessagePreview(senderName, codes);

    setConfirmation({
      title: "Salvar mensagens de aquecimento",
      message: "Deseja salvar estas mensagens para uso no aquecimento?",
      details: messages.length ? messages : ["Nenhuma mensagem pronta."],
      confirmLabel: "Salvar mensagens de aquecimento",
      onConfirm: async () => {
        await runAction(() => window.botApi.saveWarmupMessageSettings({ senderName, codes }));
      }
    });
  }

  function confirmSaveTargetMessages(senderName: string, codes: string[]) {
    if (isOnboardingReady && onboarding.step === "target-test-message") {
      const messages = normalizeMessages(senderName, codes);
      if (!messages.length) {
        setOnboardingError("Preencha e salve uma mensagem para o grupo alvo teste antes de continuar.");
        return;
      }

      void runAction(() => window.botApi.saveTargetMessageSettings({ senderName, codes })).then(() => {
        updateOnboarding({ step: "target-test-start", testTargetMessages: messages });
      });
      return;
    }

    if (isOnboardingReady && onboarding.step === "real-message") {
      const messages = normalizeMessages(senderName, codes);
      const repeatedMessage = messages.some((message) =>
        onboarding.testTargetMessages.map((item) => item.toLowerCase()).includes(message.toLowerCase())
      );

      if (!messages.length) {
        setOnboardingError("A mensagem real não pode ficar vazia.");
        return;
      }

      if (repeatedMessage) {
        setOnboardingError("A mensagem real não pode ser igual à mensagem do grupo alvo teste.");
        return;
      }

      void runAction(() => window.botApi.saveTargetMessageSettings({ senderName, codes })).then(() => {
        updateOnboarding({ step: "real-group" });
      });
      return;
    }

    const messages = buildMessagePreview(senderName, codes);

    setConfirmation({
      title: "Salvar mensagens do grupo alvo",
      message: "Deseja salvar estas mensagens para envio no grupo alvo?",
      details: messages.length ? messages : ["Nenhuma mensagem pronta."],
      confirmLabel: "Salvar mensagens do grupo alvo",
      onConfirm: async () => {
        await runAction(() => window.botApi.saveTargetMessageSettings({ senderName, codes }));
      }
    });
  }

  function confirmStartMonitoring() {
    if (isOnboardingReady && onboarding.step === "target-test-start") {
      void runAction(window.botApi.startMonitoring).then((nextSnapshot) => {
        if (nextSnapshot.monitoringEnabled) {
          updateOnboarding({ step: "target-test-finish" });
        } else {
          setOnboardingError("O bot não iniciou. Confira se o aquecimento foi concluído e tente de novo.");
        }
      });
      return;
    }

    if (isOnboardingReady && onboarding.step === "real-start") {
      void runAction(window.botApi.startMonitoring).then((nextSnapshot) => {
        if (nextSnapshot.monitoringEnabled) {
          completeOnboarding();
        } else {
          setOnboardingError("O bot não iniciou. Confira a checklist de prontidão e tente novamente.");
        }
      });
      return;
    }

    const messages = buildMessagePreview();
    const requiresWarmup = Boolean(snapshot.config.grupoTesteJid);
    const canStart = !requiresWarmup || snapshot.warmupCompleted;

    if (!canStart) {
      setConfirmation({
        title: "Aquecimento obrigatório",
        message: "Você precisa pré-aquecer o grupo de teste antes de iniciar o bot de envio real.",
        details: [
          `Grupo de teste: ${snapshot.config.grupoTesteNome || snapshot.config.grupoTesteJid}`,
          `Grupo alvo: ${groupLabel}`
        ],
        confirmLabel: "Entendi",
        onConfirm: async () => {}
      });
      return;
    }

    setConfirmation({
      title: "Iniciar bot",
      message: "Deseja iniciar o bot com estas configurações?",
      details: [
        `Grupo selecionado: ${groupLabel}`,
        messages.length
          ? `Mensagens a enviar: ${messages.join(" | ")}`
          : "Mensagens a enviar: nenhuma mensagem configurada."
      ],
      confirmLabel: "Iniciar bot",
      onConfirm: async () => {
        await runAction(window.botApi.startMonitoring);
      }
    });
  }

  function confirmWarmup() {
    if (isOnboardingReady && onboarding.step === "warmup-clicks") {
      void runAction(window.botApi.warmupGroups).then(() => {
        const nextClicks = Math.min(onboarding.warmupClicks + 1, 3);
        updateOnboarding({
          warmupClicks: nextClicks,
          step: nextClicks >= 3 ? "target-test-group" : "warmup-clicks"
        });
      });
      return;
    }

    if (isOnboardingReady && onboarding.step === "real-warmup-clicks") {
      void runAction(window.botApi.warmupGroups).then(() => {
        const nextClicks = Math.min(onboarding.realWarmupClicks + 1, 3);
        updateOnboarding({
          realWarmupClicks: nextClicks,
          step: nextClicks >= 3 ? "real-start" : "real-warmup-clicks"
        });
      });
      return;
    }

    const config = snapshot.config;
    setConfirmation({
      title: "Aquecimento de grupo",
      message: "Deseja pré-aquecer a sessão e preparar os grupos configurados?",
      details: [
        config.grupoTesteNome || config.grupoTesteJid
          ? `Grupo de teste: ${config.grupoTesteNome || config.grupoTesteJid}`
          : "Nenhum grupo de teste configurado.",
        groupLabel
      ],
      confirmLabel: "Pré-aquecer",
      onConfirm: async () => {
        await runAction(window.botApi.warmupGroups);
      }
    });
  }

  async function confirmPendingAction() {
    if (!confirmation) return;
    const action = confirmation.onConfirm;
    setConfirmation(undefined);
    await action();
  }

  function stopMonitoringForTutorial() {
    if (isOnboardingReady && onboarding.step === "target-test-stop") {
      void runAction(window.botApi.stopMonitoring).then((nextSnapshot) => {
        if (!nextSnapshot.monitoringEnabled) {
          updateOnboarding({ step: "real-message" });
        } else {
          setOnboardingError("O bot ainda está ativo. Clique em Parar bot novamente.");
        }
      });
      return;
    }

    void runAction(window.botApi.stopMonitoring);
  }

  function finishTargetTestWarmup() {
    void runAction(window.botApi.stopMonitoring).finally(() => {
      completeOnboarding();
    });
  }

  function saveRealRouteSettings(
    group: string,
    groupId: string | undefined,
    groupName: string | undefined,
    senderName: string,
    codes: string[]
  ) {
    void runAction(async () => {
      await window.botApi.saveGroup({ group, groupId, groupName });
      return window.botApi.saveTargetMessageSettings({ senderName, codes });
    });
  }

  const currentTutorial = getCurrentTutorialTarget();
  const forcedMessageMode =
    isOnboardingReady && onboarding.step === "warmup-message"
      ? "warmup"
      : isOnboardingReady && ["target-test-message", "real-message"].includes(onboarding.step)
      ? "target"
      : undefined;
  const tutorialControlMode =
    isOnboardingReady && (onboarding.step === "target-test-start" || onboarding.step === "real-start")
      ? "start-monitoring"
      : isOnboardingReady && onboarding.step === "target-test-stop"
      ? "stop-monitoring"
      : undefined;
  const onboardingCompleted = onboarding.step === "completed";

  return (
    <main
      className="app-shell"
      data-tutorial-active={isOnboardingReady ? "true" : "false"}
      data-tutorial-target={currentTutorial?.targetId || ""}
    >
      <section className="topbar">
        <div>
          <p className="eyebrow">Painel desktop</p>
          <h1>Bot WhatsApp</h1>
        </div>
        <div className="group-pill">
          <span>Grupo</span>
          <strong>{groupLabel}</strong>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="primary-column">
          <StatusCard
            status={snapshot.status}
            error={snapshot.error}
            groupState={snapshot.groupState}
            monitoringEnabled={snapshot.monitoringEnabled}
            readinessChecks={snapshot.readinessChecks}
          />
          <div
            className={canUsePanel("controls") ? "tutorial-panel-active" : undefined}
            data-tutorial-id="controls-panel"
          >
            <ControlButtons
              busy={busy}
              status={snapshot.status}
              onStart={() => runAction(window.botApi.startBot)}
              onStop={() => runAction(window.botApi.stopBot)}
              onStartMonitoring={confirmStartMonitoring}
              onStopMonitoring={stopMonitoringForTutorial}
              onRestart={() => runAction(window.botApi.restartBot)}
              onClearSession={() => runAction(window.botApi.clearSession)}
              monitoringEnabled={snapshot.monitoringEnabled}
              warmupCompleted={snapshot.warmupCompleted}
              warmupRequired={Boolean(snapshot.config.grupoTesteJid || snapshot.config.grupoTesteNome)}
              tutorialMode={tutorialControlMode}
            />
          </div>
          {onboardingCompleted ? (
            <RealRouteConfig
              config={snapshot.config}
              groups={snapshot.groups}
              busy={busy}
              onRefresh={() => runAction(window.botApi.refreshGroups)}
              onSave={saveRealRouteSettings}
            />
          ) : (
            <>
              <div
                className={canUsePanel("target-group") ? "tutorial-panel-active" : undefined}
                data-tutorial-id="target-group-panel"
              >
                <GroupConfig
                  config={snapshot.config}
                  groups={snapshot.groups}
                  busy={busy}
                  onRefresh={() => runAction(window.botApi.refreshGroups)}
                  onSave={confirmSaveGroup}
                  disabled={isOnboardingReady && !canUsePanel("target-group")}
                  tutorialNotice={
                    isOnboardingReady && onboarding.step === "target-test-group"
                      ? "ATENÇÃO: este ainda não é o grupo real."
                      : isOnboardingReady && onboarding.step === "real-group"
                      ? "ATENÇÃO: este é o grupo real das rotas. Confira com cuidado antes de salvar."
                      : undefined
                  }
                />
              </div>
              <div
                className={canUsePanel("warmup-group") || canUsePanel("warmup-button") ? "tutorial-panel-active" : undefined}
                data-tutorial-id="warmup-group-panel"
              >
                <GroupTestConfig
                  config={snapshot.config}
                  groups={snapshot.groups}
                  busy={busy}
                  warmupCompleted={snapshot.warmupCompleted}
                  onSave={confirmSaveTestGroup}
                  onWarmup={confirmWarmup}
                  disabled={isOnboardingReady && !canUsePanel("warmup-group") && !canUsePanel("warmup-button")}
                  disableGroupFields={isOnboardingReady && !canUsePanel("warmup-group")}
                  disableWarmup={isOnboardingReady && !canUsePanel("warmup-button")}
                  warmupCounter={
                    isOnboardingReady && onboarding.step === "warmup-clicks"
                      ? `${onboarding.warmupClicks}/3`
                      : isOnboardingReady && onboarding.step === "real-warmup-clicks"
                      ? `${onboarding.realWarmupClicks}/3`
                      : undefined
                  }
                />
              </div>
              <div
                className={canUsePanel("message") ? "tutorial-panel-active" : undefined}
                data-tutorial-id="message-panel"
              >
                <MessageConfig
                  config={snapshot.config}
                  busy={busy}
                  onSaveWarmup={confirmSaveWarmupMessages}
                  onSaveTarget={confirmSaveTargetMessages}
                  forcedMode={forcedMessageMode}
                  disabled={isOnboardingReady && !canUsePanel("message")}
                  validationError={onboardingError}
                  tutorialNotice={
                    isOnboardingReady && onboarding.step === "real-message"
                      ? "A mensagem real não pode ser igual à mensagem usada no grupo alvo teste."
                      : undefined
                  }
                />
              </div>
            </>
          )}
        </div>

        <div className="secondary-column">
          <QrCodeBox qrCode={snapshot.qrCode} status={snapshot.status} />
          <LogsPanel logs={snapshot.logs} />
        </div>
      </section>

      {isOnboardingReady ? (
        <>
          <div className="tutorial-overlay" />
          <section className="tutorial-balloon" role="dialog" aria-live="polite">
            <p className="panel-label">{currentTutorial.title}</p>
            <p>{currentTutorial.text}</p>
            {currentTutorial.warning ? <strong className="tutorial-warning">{currentTutorial.warning}</strong> : null}
            {currentTutorial.counter ? (
              <div className="tutorial-counter">
                <span>Progresso obrigatório</span>
                <strong>{currentTutorial.counter}</strong>
              </div>
            ) : null}
            {onboardingError ? <div className="form-error">{onboardingError}</div> : null}
            {onboarding.step === "target-test-finish" ? (
              <button className="button primary wide-button" type="button" onClick={finishTargetTestWarmup}>
                Terminei o aquecimento alvo
              </button>
            ) : null}
            {isDev ? (
              <button className="link-button" type="button" onClick={resetOnboarding}>
                Resetar tutorial dev
              </button>
            ) : null}
          </section>
        </>
      ) : null}

      {confirmation ? (
        <div className="modal-backdrop" role="presentation">
          <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <p className="panel-label">Confirmação</p>
            <h2 id="confirm-title">{confirmation.title}</h2>
            <p className="confirmation-message">{confirmation.message}</p>
            <div className="confirmation-details">
              {confirmation.details.map((detail, index) => (
                <span key={`${detail}-${index}`}>{detail}</span>
              ))}
            </div>
            <div className="confirmation-actions">
              <button className="button" disabled={busy} type="button" onClick={() => setConfirmation(undefined)}>
                Cancelar
              </button>
              <button className="button primary" disabled={busy} type="button" onClick={confirmPendingAction}>
                {confirmation.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
