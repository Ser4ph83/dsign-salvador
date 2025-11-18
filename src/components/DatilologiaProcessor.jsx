import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as tf from '@tensorflow/tfjs'; 
import * as tmImage from '@teachablemachine/image'; 

// Configurações e URLs dos Modelos
const CAPTURE_INTERVAL = 500;
const CONFIDENCE_THRESHOLD = 0.95;
const MAX_PREDICTIONS = 1;

// NOVO: Lista de URLs dos modelos (mantenha a última '/' no final)
const MODEL_URLS = [
    { url: 'https://teachablemachine.withgoogle.com/models/YBFEWlPng/', name: 'Grupo A-E' },
    // ADICIONE SEUS NOVOS MODELOS AQUI:
    // { url: 'https://teachablemachine.withgoogle.com/models/SEU_LINK_GRUPO2/', name: 'Grupo C-F' },
    // { url: 'https://teachablemachine.withgoogle.com/models/SEU_LINK_GRUPO3/', name: 'Grupo G-J' },
];


const DatilologiaProcessor = ({ videoStreamRef, onTextRecognized }) => {
  // O estado agora armazena um ARRAY de objetos de modelo carregados
  const [loadedModels, setLoadedModels] = useState([]);
  const [isReady, setIsReady] = useState(false);
  const [message, setMessage] = useState('Carregando modelos TensorFlow...');
  
  const [lastRecognizedChar, setLastRecognizedChar] = useState(null); 
  
  // Ref para manter os modelos carregados persistentes
  const modelsRef = useRef([]); 

  // --- EFEITO 1: Carregamento dos Múltiplos Modelos ---
  useEffect(() => {
    const loadAllModels = async () => {
      let successfulLoads = 0;
      let tempModels = [];

      for (const modelConfig of MODEL_URLS) {
        setMessage(`Carregando ${modelConfig.name}...`);
        try {
          const loadedModel = await tmImage.load(modelConfig.url + 'model.json', modelConfig.url + 'metadata.json');
          
          tempModels.push({ 
            model: loadedModel, 
            name: modelConfig.name 
          });
          successfulLoads++;

        } catch (error) {
          console.error(`Erro ao carregar o modelo ${modelConfig.name}:`, error);
          setMessage(`Falha ao carregar ${modelConfig.name}. Verifique o link.`);
        }
      }
      
      // Atualiza o estado e as refs após tentar carregar todos
      if (successfulLoads === MODEL_URLS.length) {
          setIsReady(true);
          setLoadedModels(tempModels);
          modelsRef.current = tempModels; // Atualiza a ref
          setMessage(`Todos os ${successfulLoads} modelos foram carregados com sucesso!`);
      } else if (successfulLoads > 0) {
          // Carregamento parcial
          setIsReady(true);
          setLoadedModels(tempModels);
          modelsRef.current = tempModels;
          setMessage(`Atenção: Apenas ${successfulLoads}/${MODEL_URLS.length} modelos foram carregados.`);
      } else {
          setMessage('Nenhum modelo pôde ser carregado. Verifique os links.');
      }
    };
    
    loadAllModels();

  }, []); // Roda apenas uma vez

  // --- Função PRINCIPAL para Previsão (Reconhecimento) ---
  const predictSign = useCallback(async () => {
    const video = videoStreamRef.current;
    
    if (modelsRef.current.length === 0 || !video || video.readyState !== 4) {
      return;
    }

    let bestPrediction = { className: '', probability: 0, modelName: '' };

    // 1. Tenta a previsão em CADA modelo carregado
    for (const modelItem of modelsRef.current) {
        try {
            const prediction = await modelItem.model.predict(video, MAX_PREDICTIONS);
            
            let currentHighest = { className: '', probability: 0 };
            prediction.forEach(p => {
                if (p.probability > currentHighest.probability) {
                    currentHighest = p;
                }
            });

            // 2. Compara com a melhor previsão global até agora
            if (currentHighest.probability > bestPrediction.probability) {
                bestPrediction = {
                    className: currentHighest.className.trim(),
                    probability: currentHighest.probability,
                    modelName: modelItem.name
                };
            }
        } catch (error) {
            console.error(`Erro de previsão no ${modelItem.name}:`, error);
        }
    }
    
    // 3. Lógica de Validação e Estabilização (Aplicada ao Melhor Resultado)
    
    // A. Atingiu o Limiar de Confiança?
    if (bestPrediction.probability > CONFIDENCE_THRESHOLD) {
        
        const recognized = bestPrediction.className; 
        const isBackground = recognized.toLowerCase().includes('background');

        // B. O caractere é diferente do último adicionado E não é background?
        if (recognized !== lastRecognizedChar && !isBackground) {
          
          onTextRecognized(recognized); 
          setLastRecognizedChar(recognized); 
          
          console.log(`NOVO Reconhecido [${bestPrediction.modelName}]: ${recognized} (${(bestPrediction.probability * 100).toFixed(2)}%)`);
        }

    } else {
        // Confiança baixa, resetando o estado de espera.
        if (lastRecognizedChar !== null) {
             setLastRecognizedChar(null);
        }
    }
  }, [videoStreamRef, onTextRecognized, lastRecognizedChar]);

  // ... (O EFEITO 2: Loop de Previsão permanece o mesmo) ...
  useEffect(() => {
    if (!isReady) return; 
    
    let intervalId;
    
    const checkVideoReady = () => {
        if (videoStreamRef.current && videoStreamRef.current.readyState >= 3) {
             intervalId = setInterval(predictSign, CAPTURE_INTERVAL);
        } else {
             setTimeout(checkVideoReady, 100); 
        }
    }
    
    checkVideoReady();

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isReady, predictSign, videoStreamRef]);
  
  // --- Renderização (Feedback de Status) ---
  return (
    <>
      <p style={{ 
        color: isReady ? '#4A90E2' : 'gray', 
        fontSize: '0.9em', 
        textAlign: 'center', 
        margin: '0', 
        padding: '10px 0' 
      }}>
        {message}
      </p>
    </>
  );
};

export default DatilologiaProcessor;