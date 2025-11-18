// src/components/Card.jsx
import React from 'react';
import './Card.css'; // Vamos criar o CSS para o Card

const Card = ({ title, children }) => {
  return (
    <div className="card">
      <h3 className="card-title">{title}</h3>
      <div className="card-content">
        {children}
      </div>
    </div>
  );
};

export default Card;