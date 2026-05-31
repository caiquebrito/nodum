import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/auth';

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const auth = verifyToken(token);
  if (!auth) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  (req as any).user = auth;
  next();
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
}
