import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import { BotStatus } from "../../../shared/types";

type Props = {
  qrCode: string;
  status: BotStatus;
};

export function QrCodeBox({ qrCode, status }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!qrCode || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, qrCode, {
      width: 260,
      margin: 2,
      color: {
        dark: "#0d1117",
        light: "#ffffff"
      }
    });
  }, [qrCode]);

  return (
    <article className="panel qr-panel">
      <div className="panel-heading">
        <p className="panel-label">QR Code</p>
        <span className="mini-status">{status === "waiting_qr" ? "Aguardando leitura" : "Sem QR ativo"}</span>
      </div>
      <div className="qr-box">
        {qrCode ? (
          <canvas ref={canvasRef} aria-label="QR Code do WhatsApp" />
        ) : (
          <div className="qr-empty">O QR Code aparece aqui quando uma nova autenticação for necessária.</div>
        )}
      </div>
    </article>
  );
}
