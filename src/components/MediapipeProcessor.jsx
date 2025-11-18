// src/components/MediapipeProcessor.jsx
import React, { useEffect, useRef, useState } from "react";
import * as tf from "@tensorflow/tfjs";
import "./MediapipeProcessor.css";

// ✅ Força o TensorFlow a usar a CPU
tf.setBackend("cpu");
tf.ready().then(() => console.log("✅ TensorFlow.js usando CPU backend"));

const MediapipeProcessor = ({
  videoStreamRef,
  isCameraOn,
  onTextRecognized,
  onMessageUpdate,
}) => {
  const canvasRef = useRef(null);
  const modelRef = useRef(null);
  const labelNamesRef = useRef([]);
  const lastPredictionRef = useRef({ label: "", time: 0 }); // Evita repetição rápida

  // Estados visuais
  const [status, setStatus] = useState("Aguardando câmera...");
  const [collectLabel, setCollectLabel] = useState("");
  const [isCollecting, setIsCollecting] = useState(false);
  const [samples, setSamples] = useState([]);
  const [labels, setLabels] = useState([]);
  const [labelCounts, setLabelCounts] = useState({});
  const [isTraining, setIsTraining] = useState(false);
  const [modelStatus, setModelStatus] = useState("Modelo: nenhum");
  const [showPanel, setShowPanel] = useState(false);

  // Overlay (contador + mensagem)
  const [countdown, setCountdown] = useState(0);
  const [handMessage, setHandMessage] = useState("");

  // ----------- Parâmetros do delay / movimento -----------
  const REQUIRED_DELAY_MS = 2000; // 2 segundos
  const COUNT_FROM = 2; // contador em segundos
  const CHANGE_THRESHOLD = 0.7; // sensibilidade para "mudança grande" da mão
  const CONFIDENCE_THRESHOLD = 0.93; // mantém seu thr atual
  const MIN_EMIT_INTERVAL_MS = 1500;

  // Refs mutáveis (não disparam re-render)
  const canPredictRef = useRef(false);
  const handPreviouslyDetectedRef = useRef(false);
  const delayIntervalRef = useRef(null);
  const delayTimeoutRef = useRef(null);
  const lastLandmarksRef = useRef(null);

  // ----------- Pré-processamento dos landmarks -----------
  const preprocessLandmarks = (landmarks) => {
    const wrist = landmarks[0];
    const centered = [];
    for (let i = 0; i < landmarks.length; i++) {
      centered.push(landmarks[i].x - wrist.x);
      centered.push(landmarks[i].y - wrist.y);
      centered.push(landmarks[i].z - wrist.z);
    }
    let maxDist = 0;
    for (let i = 0; i < landmarks.length; i++) {
      for (let j = i + 1; j < landmarks.length; j++) {
        const dx = landmarks[i].x - landmarks[j].x;
        const dy = landmarks[i].y - landmarks[j].y;
        const dz = landmarks[i].z - landmarks[j].z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > maxDist) maxDist = d;
      }
    }
    return centered.map((v) => v / (maxDist || 1));
  };

  // ----------- Funções do delay / contador / movimento -----------
  // limpa timers do delay
  const clearDelayTimers = () => {
    if (delayIntervalRef.current) {
      clearInterval(delayIntervalRef.current);
      delayIntervalRef.current = null;
    }
    if (delayTimeoutRef.current) {
      clearTimeout(delayTimeoutRef.current);
      delayTimeoutRef.current = null;
    }
  };

  const startDelay = () => {
    // trava predição
    canPredictRef.current = false;
    clearDelayTimers();

    // inicia contador visual (COUNT_FROM ... 1)
    setCountdown(COUNT_FROM);
    setHandMessage("Prepare a mão...");

    // intervalo de decremento visual a cada 1s
    delayIntervalRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          // fim do contador
          clearDelayTimers();
          setCountdown(0);
          canPredictRef.current = true;
          setHandMessage("");
          return 0;
        }
        return c - 1;
      });
    }, 1000);

    // fallback/segurança: garante que após REQUIRED_DELAY_MS a predição é liberada
    delayTimeoutRef.current = setTimeout(() => {
      clearDelayTimers();
      setCountdown(0);
      canPredictRef.current = true;
      setHandMessage("");
    }, REQUIRED_DELAY_MS + 200); // +200ms de folga
  };

  // calcula se a mão mudou muito em relação ao último frame/landmarks
  const hasHandMoved = (landmarks) => {
    if (!lastLandmarksRef.current) {
      // copia referencial (deep-ish) para comparação futura
      lastLandmarksRef.current = landmarks.map((l) => ({ x: l.x, y: l.y, z: l.z }));
      return false;
    }

    let total = 0;
    for (let i = 0; i < landmarks.length; i++) {
      const dx = landmarks[i].x - (lastLandmarksRef.current[i]?.x ?? 0);
      const dy = landmarks[i].y - (lastLandmarksRef.current[i]?.y ?? 0);
      const dz = landmarks[i].z - (lastLandmarksRef.current[i]?.z ?? 0);
      total += Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
    }

    // atualiza para próximo cálculo
    lastLandmarksRef.current = landmarks.map((l) => ({ x: l.x, y: l.y, z: l.z }));

    return total > CHANGE_THRESHOLD;
  };

  // ----------- Inicializa o MediaPipe -----------
  useEffect(() => {
    let hands = null;
    let camera = null;
    let active = true;

    const init = async () => {
      if (!isCameraOn) {
        setStatus("Câmera desligada.");
        return;
      }

      const waitFor = async () => {
        if (window.Hands && window.Camera && window.drawConnectors) return;
        await new Promise((r) => setTimeout(r, 300));
        return waitFor();
      };

      try {
        await waitFor();

        const HandsClass = window.Hands;
        const HAND_CONNECTIONS = window.HAND_CONNECTIONS;
        const Camera = window.Camera;
        const { drawConnectors, drawLandmarks } = window;

        const videoEl = videoStreamRef.current;
        if (!videoEl) return;

        // garante estado inicial
        canPredictRef.current = false;
        handPreviouslyDetectedRef.current = false;
        lastLandmarksRef.current = null;
        setCountdown(0);
        setHandMessage("");

        const onResults = (results) => {
          if (!active) return;
          const canvas = canvasRef.current;
          if (!canvas) return;
          const ctx = canvas.getContext("2d");
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

          // Se houver mão(s)
          if (results.multiHandLandmarks?.length) {
            // pega a primeira mão (maxNumHands = 1)
            const landmarks = results.multiHandLandmarks[0];

            // desenho
            drawConnectors(ctx, landmarks, HAND_CONNECTIONS, {
              color: "#00FF00",
              lineWidth: 3,
            });
            drawLandmarks(ctx, landmarks, {
              color: "#FF0000",
              lineWidth: 1,
            });

            setStatus("Mão detectada ✋");

            // Se mão apareceu agora (antes não estava detectada) --> iniciar delay
            if (!handPreviouslyDetectedRef.current) {
              console.log("👋 Mão apareceu — iniciando delay de reconhecimento");
              startDelay();
              handPreviouslyDetectedRef.current = true;
            } else {
              // mão já estava detectada: se mudou muito, reinicia delay (delay inteligente)
              if (hasHandMoved(landmarks)) {
                console.log("🔄 Mão mudou muito — reiniciando delay inteligente");
                startDelay();
              }
            }

            // coleta de amostras continua funcionando independente do canPredict
            if (isCollecting && collectLabel.trim()) {
              const processed = preprocessLandmarks(landmarks);
              setSamples((p) => [...p, processed]);
              setLabels((p) => [...p, collectLabel]);
              setLabelCounts((p) => ({
                ...p,
                [collectLabel]: (p[collectLabel] || 0) + 1,
              }));
            }

            // PREDIÇÃO: só quando canPredictRef.current for true e modelo carregado
            if (canPredictRef.current && modelRef.current && labelNamesRef.current.length > 0) {
              const processed = preprocessLandmarks(landmarks);
              const tensor = tf.tensor2d([processed]);
              const pred = modelRef.current.predict(tensor);
              const probs = pred.arraySync()[0];
              const maxProb = Math.max(...probs);
              const maxIdx = probs.indexOf(maxProb);
              const predicted = labelNamesRef.current[maxIdx];
              const now = Date.now();

              // Debug
              // console.log("🤖 Predição:", predicted, "| Confiança:", maxProb.toFixed(2));

              if (
                maxProb >= CONFIDENCE_THRESHOLD &&
                predicted &&
                now - lastPredictionRef.current.time > MIN_EMIT_INTERVAL_MS
              ) {
                lastPredictionRef.current = { label: predicted, time: now };
                onTextRecognized?.(predicted);
              }

              tf.dispose([tensor, pred]);
            }
          } else {
            // nenhuma mão detectada
            if (handPreviouslyDetectedRef.current) {
              console.log("🛑 Mão sumiu — resetando delay e estados relacionados");
            }

            handPreviouslyDetectedRef.current = false;
            canPredictRef.current = false;
            lastLandmarksRef.current = null;

            // limpa timers e visual
            clearDelayTimers();
            setCountdown(0);
            setHandMessage("Coloque a mão para iniciar");

            setStatus("Nenhuma mão detectada.");
          }
        };

        hands = new HandsClass({
          locateFile: (file) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
        });
        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: 0.6,
          minTrackingConfidence: 0.6,
        });
        hands.onResults(onResults);

        camera = new Camera(videoEl, {
          onFrame: async () => await hands.send({ image: videoEl }),
          width: 640,
          height: 480,
        });

        camera.start();
        setStatus("MediaPipe Hands iniciado com sucesso!");
        onMessageUpdate?.("MediaPipe Hands iniciado com sucesso!");
      } catch (err) {
        console.error("Erro ao iniciar MediaPipe:", err);
        setStatus("Erro ao iniciar MediaPipe.");
      }
    };

    init();

   return () => {
  active = false;
  clearDelayTimers();
  try {
    camera?.stop();
    hands?.close();
  } catch {}

  // Limpa canvas quando câmera é desligada
  const canvas = canvasRef.current;
  if (canvas) {
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  setStatus("Câmera desligada.");
};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCameraOn, isCollecting, collectLabel]);

  // ----------- Carrega modelo salvo automaticamente -----------
  useEffect(() => {
    const tryLoad = async () => {
      try {
        const models = await tf.io.listModels();
        if (models["indexeddb://libras-model"]) {
          const m = await tf.loadLayersModel("indexeddb://libras-model");
          modelRef.current = m;
          const lbls = localStorage.getItem("libras-labels");
          if (lbls) labelNamesRef.current = JSON.parse(lbls);
          setModelStatus("✅ Modelo carregado automaticamente (IndexedDB)");
          return;
        }

        const basePath = window.location.hostname.includes("github.io")
          ? "/dsign/model/libras-model.json"
          : "/model/libras-model.json";

        console.log("🔍 Tentando carregar modelo base em:", basePath);
        const m = await tf.loadLayersModel(basePath);
        modelRef.current = m;
        await m.save("indexeddb://libras-model");
        setModelStatus("✅ Modelo base carregado do servidor (pré-treinado)");

        const lbls = localStorage.getItem("libras-labels");
        if (lbls) labelNamesRef.current = JSON.parse(lbls);
      } catch (err) {
        console.error("❌ Erro ao carregar modelo:", err);
        setModelStatus("❌ Nenhum modelo encontrado. Treine ou carregue manualmente.");
      }
    };

    tryLoad();
  }, []);

  // ----------- Controla rolagem do body quando painel está aberto -----------
        useEffect(() => {
        if (showPanel) {
          // Libera rolagem para toda a página
          document.body.style.overflow = "auto";
          document.documentElement.style.overflow = "auto"; // html também
        } else {
          // Restaura overflow original
          document.body.style.overflow = "";
          document.documentElement.style.overflow = "";
        }

        // Cleanup caso o componente seja desmontado
        return () => {
          document.body.style.overflow = "";
          document.documentElement.style.overflow = "";
        };
      }, [showPanel]);



  // ----------- Funções de controle -----------
  const toggleCollect = () => {
    if (!collectLabel.trim()) return alert("Digite uma letra para coletar.");
    if (!isCameraOn) return alert("Ligue a câmera primeiro.");
    setIsCollecting((p) => !p);
  };

  const downloadDataset = () => {
    if (!samples.length) return alert("Nenhuma amostra coletada!");
    const unique = Array.from(new Set(labels));
    const map = {};
    unique.forEach((l, i) => (map[l] = i));
    const out = { samples, labels: labels.map((l) => map[l]), label_names: unique };
    const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "libras_dataset.json";
    a.click();
  };

  const loadDataset = (ev) => {
    const file = ev.target.files[0];
    if (!file) return alert("Selecione um arquivo JSON válido.");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.samples || !data.labels) {
          alert("Formato inválido de dataset.");
          return;
        }
        setSamples(data.samples);
        setLabels(data.labels.map((i) => data.label_names[i] || i));
        setModelStatus(`✅ Dataset carregado com ${data.samples.length} amostras!`);
      } catch (err) {
        console.error("Erro ao ler dataset:", err);
        alert("Erro ao ler arquivo JSON de dataset.");
      }
    };
    reader.readAsText(file);
  };

  const trainModel = async () => {
    if (!samples.length) {
      alert("Colete amostras de várias letras antes de treinar.");
      return;
    }

    setIsTraining(true);
    setModelStatus("🧠 Preparando dados e inicializando modelo (CPU)...");

    try {
      if (modelRef.current) {
        modelRef.current.dispose();
        tf.disposeVariables();
        tf.engine().reset();
        console.log("🧹 Modelo anterior descartado.");
      }

      const xs = tf.tensor2d(samples);
      const unique = Array.from(new Set(labels));
      const map = {};
      unique.forEach((l, i) => (map[l] = i));
      const ysIdx = labels.map((l) => map[l]);
      const ys = tf.oneHot(tf.tensor1d(ysIdx, "int32"), unique.length);

      const model = tf.sequential();
      model.add(tf.layers.dense({ inputShape: [63], units: 256, activation: "relu" }));
      model.add(tf.layers.dropout({ rate: 0.2 }));
      model.add(tf.layers.dense({ units: 128, activation: "relu" }));
      model.add(tf.layers.dropout({ rate: 0.2 }));
      model.add(tf.layers.dense({ units: 64, activation: "relu" }));
      model.add(tf.layers.dense({ units: unique.length, activation: "softmax" }));

      model.compile({
        optimizer: tf.train.adam(0.001),
        loss: "categoricalCrossentropy",
        metrics: ["accuracy"],
      });

      console.log(`🚀 Treinando modelo com ${unique.length} classes usando CPU...`);
      setModelStatus(`🚀 Treinando modelo com ${unique.length} classes (CPU)...`);

      await model.fit(xs, ys, {
        epochs: 50,
        batchSize: 32,
        shuffle: true,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            const l = logs.loss?.toFixed(3) ?? "N/A";
            const a = logs.acc?.toFixed(3) ?? logs.accuracy?.toFixed(3) ?? "N/A";
            setModelStatus(`📊 Época ${epoch + 1}/50 | Loss: ${l} | Acc: ${a}`);
            console.log(`📊 Época ${epoch + 1}/50 | Loss: ${l} | Acc: ${a}`);
          },
        },
      });

      await model.save("indexeddb://libras-model");
      await model.save("downloads://libras-model");
      localStorage.setItem("libras-labels", JSON.stringify(unique));

      modelRef.current = model;
      labelNamesRef.current = unique;

      setModelStatus("✅ Modelo treinado e salvo localmente (CPU)");
      console.log("✅ Modelo treinado com sucesso!");

      xs.dispose();
      ys.dispose();
    } catch (err) {
      console.error("❌ Erro no treinamento:", err);
      setModelStatus("❌ Erro no treinamento. Verifique o console.");
    } finally {
      setIsTraining(false);
    }
  };

  const loadModel = async (ev) => {
    const files = ev.target.files;
    if (!files?.length) return alert("Selecione os arquivos .json e .bin");
    try {
      const model = await tf.loadLayersModel(tf.io.browserFiles([...files]));
      modelRef.current = model;
      await model.save("indexeddb://libras-model");
      const lbls = localStorage.getItem("libras-labels");
      if (lbls) labelNamesRef.current = JSON.parse(lbls);
      setModelStatus("✅ Modelo carregado e salvo localmente!");
      alert("Modelo carregado com sucesso.");
    } catch (err) {
      console.error(err);
      alert("Erro ao carregar modelo. Selecione .json e .bin juntos.");
    }
  };

  // ----------- Interface -----------
  return (
    <div className="mediapipe-canvas-wrapper" style={{ position: "relative" }}>
      <canvas ref={canvasRef} width="640" height="480" />
      {/* Overlays */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          fontSize: 72,
          fontWeight: "700",
          color: "white",
          textShadow: "0 0 12px rgba(0,0,0,0.9)",
          zIndex: 9999,
          pointerEvents: "none",
        }}
      >
        {countdown > 0 ? countdown : ""}
      </div>

      <div
        style={{
          position: "absolute",
          top: 12,
          left: "50%",
          transform: "translateX(-50%)",
          fontSize: 18,
          color: "white",
          textShadow: "0 0 8px rgba(0,0,0,0.9)",
          zIndex: 9999,
          pointerEvents: "none",
        }}
      >
        {handMessage}
      </div>

      <p style={{ textAlign: "center", color: "#444" }}>{status}</p>

      <div className="mediapipe-panel">
        <button onClick={() => setShowPanel((p) => !p)} className="toggle-panel-btn">
          ⚙️ {showPanel ? "Ocultar Configurações" : "Mostrar Configurações de IA"}
        </button>

        {showPanel && (
          <div className="panel-content">
            <h3>Coleta</h3>
            <input
              type="text"
              placeholder="Letra (ex: A)"
              maxLength={2}
              value={collectLabel}
              onChange={(e) => setCollectLabel(e.target.value.toUpperCase())}
            />
            <button onClick={toggleCollect} style={{ marginLeft: 8 }}>
              {isCollecting ? "⏸️ Pausar" : "▶️ Coletar"}
            </button>
            <button
              onClick={downloadDataset}
              style={{ marginLeft: 8 }}
              disabled={!samples.length}
            >
              💾 Baixar Dataset
            </button>

            <input
              type="file"
              accept=".json"
              onChange={loadDataset}
              style={{ marginTop: 8 }}
            />
            <div style={{ marginTop: 8 }}>
              {Object.entries(labelCounts).map(([k, v]) => (
                <div key={k}>
                  {k}: {v}
                </div>
              ))}
            </div>

            <hr />
            <h3>Treinar Modelo</h3>
            <button onClick={trainModel} disabled={isTraining || !samples.length}>
              {isTraining ? "Treinando..." : "⚙️ Treinar TF.js"}
            </button>
            <p>{modelStatus}</p>

            <hr />
            <h3>Carregar Modelo</h3>
            <input type="file" accept=".json,.bin" multiple onChange={loadModel} />
          </div>
        )}
      </div>
    </div>
  );
};

export default MediapipeProcessor;
