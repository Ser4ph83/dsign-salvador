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

  // tenta recarregar o modelo salvo no indexedDB (se existir) — MediapipeProcessor também faz, mas mantemos status aqui
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

      {/* vídeo oculto (fonte para MediaPipe) */}
      <video
        ref={videoRef}
        width="640"
        height="480"
        autoPlay
        muted
        playsInline
        style={{ display: "none" }}
      />

      {/* Processador: só inicia quando a câmera estiver ligada */}
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
            onClick={() => 
              setRecognizedText("")
            } 
            disabled={!recognizedText}>
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
        </div>
      </main>
    </div>
  );
}

export default App;
