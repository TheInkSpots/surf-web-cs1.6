// src/main.ts
import './styles/sandbox.css';
import { SurfApp } from './app/SurfApp';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('viewport') as HTMLCanvasElement;
  const app = new SurfApp(canvas);
  app.start();
});
