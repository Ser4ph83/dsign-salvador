// src/components/CameraStream.jsx
import React, { useEffect, forwardRef } from 'react';
import './CameraStream.css';

const CameraStream = forwardRef(({ isCameraOn, onStreamStarted }, ref) => {
  useEffect(() => {
    let currentStream = null;

    const startCamera = async () => {
      try {
        currentStream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (ref && ref.current) {
          ref.current.srcObject = currentStream;
          ref.current.play().catch(() => {});
        }
        if (typeof onStreamStarted === 'function') onStreamStarted(true);
      } catch (err) {
        console.error("Erro ao acessar a câmera:", err);
        if (typeof onStreamStarted === 'function') onStreamStarted(false);
      }
    };

    const stopCamera = () => {
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
        currentStream = null;
      }
      if (typeof onStreamStarted === 'function') onStreamStarted(false);
    };

    if (isCameraOn) {
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [isCameraOn, ref, onStreamStarted]);

  return (
    <div className="camera-container">
      <video
        ref={ref}
        className="video-element"
        playsInline
        muted
        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px' }}
      />
    </div>
  );
});

export default CameraStream;
