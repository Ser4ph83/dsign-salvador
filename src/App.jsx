// src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import MediapipeProcessor from "./components/MediapipeProcessor";
import "./App.css";

function App() {
  const videoRef = useRef(null);
  const [recognizedText, setRecognizedText] = useState("");
  const [message, setMessage] = useState("Câmera desligada.");
  const [isCameraOn, setIsCameraOn] = useState(false);
  const streamRef = useRef(null);

  // ✅ referencia para la janela VLibras
  const popupRef = useRef(null);

  // ✅ función para abrir la janela y enviar texto
  const handleTranslate = () => {
    const largura = 650;
    const altura = 700;
    const esquerda = window.screen.width - largura - 20;
    const topo = (window.screen.height / 2) - (altura / 2);

    if (!popupRef.current || popupRef.current.closed) {
      popupRef.current = window.open(
        '/dsing/model/vlibras.html',
        'JanelaVLibras',
        `width=${largura},height=${altura},left=${esquerda},top=${topo},resizable=no,scrollbars=no`
      );

      setTimeout(() => {
        popupRef.current?.postMessage(
          { type: 'VLIBRAS_TEXT', text: recognizedText },
          '*'
        );
      }, 800);

    } else {
      popupRef.current.postMessage(
        { type: 'VLIBRAS_TEXT', text: recognizedText },
        '*'
      );
    }
  };

  // liga a câmera (cria stream)
  const startCamera = async () => {
    try {
      if (streamRef.current) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsCameraOn(true);
      setMessage("Câmera ligada.");
    } catch (err) {
      console.error("Erro ao iniciar câmera:", err);
      setMessage("Erro ao iniciar câmera. Verifique permissões.");
      setIsCameraOn(false);
    }
  };

  // desliga a câmera (para tracks)
  const stopCamera = () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      }
    } catch (err) {
      console.warn("Erro ao parar câmera:", err);
    } finally {
      setIsCameraOn(false);
      setMessage("Câmera desligada.");
    }
  };

  const toggleCamera = () => {
    if (isCameraOn) stopCamera();
    else startCamera();
  };

  useEffect(() => {
    setMessage(isCameraOn ? "Câmera ativa. Aguardando MediaPipe..." : "Câmera desligada.");
  }, [isCameraOn]);

  return (
    <div className="App">
      <header className="app-header">
        <h1>DSIGN</h1>
        <div className="controls-row">
          <button className="camera-toggle" onClick={toggleCamera}>
            {isCameraOn ? "🔴 Desligar Câmera" : "🟢 Ligar Câmera"}
          </button>
          <div className="status-inline">{message}</div>
        </div>
      </header>

      <video
        ref={videoRef}
        width="640"
        height="480"
        autoPlay
        muted
        playsInline
        style={{ display: "none" }}
      />

      <MediapipeProcessor
        videoStreamRef={videoRef}
        isCameraOn={isCameraOn}
        onTextRecognized={(txt) => setRecognizedText((prev) => prev + txt)}
        onMessageUpdate={setMessage}
      />
      
      <main className="recognized-area">
        <h2>📝 Texto reconhecido</h2>
        <div className="recognized-box">{recognizedText || "Aguardando gesto..."}</div>
        <div style={{ marginTop: 8 }}>
          <button className="Erase" 
            onClick={() => setRecognizedText("")}
            disabled={!recognizedText}
          >
            ✖ Limpar texto
          </button>

          <button className="Erese"
            onClick={() =>
              setRecognizedText((prev) => prev.slice(0, prev.length - 1))
            }
            disabled={!recognizedText}
            style={{ marginLeft: 8 }}
          >
            ⬅ Apagar letra
          </button>

          {/* ✅ botón que abre la janela VLibras */}
          <button 
            style={{ marginLeft: 12 }} 
            onClick={handleTranslate}
          >
            📤 Enviar ao VLibras
          </button>

        </div>
      </main>
    </div>
  );
}

export default App;
