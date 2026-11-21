import express from 'express';
import { createApiRouter } from '../src/server/app.ts';

const app = express();
app.disable('x-powered-by');
app.use('/api', createApiRouter());
app.use('/', createApiRouter());

export default app;
