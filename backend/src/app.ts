import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { predictRouter } from './routes/predict';
import { startAutoSync } from './lib/sync';

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5400' }));
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true, tournament: 'World Cup 2026' }));

app.use('/api', predictRouter);

const PORT = process.env.PORT || 3400;
app.listen(PORT, () => {
  console.log(`World Cup Predictor running on :${PORT}`);
  startAutoSync();
});

export default app;
