import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

interface AuthRequest extends Request {
  user?: any;
  headers: any;
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = (req.headers.authorization as string)?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Access denied' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    req.user = decoded;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', message: 'Your session has expired. Please log in again.' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token', message: 'Your authentication token is invalid. Please log in again.' });
    }
    if (err.name === 'NotBeforeError') {
      return res.status(401).json({ error: 'Token not yet valid', message: 'Your authentication token is not yet valid.' });
    }
    res.status(401).json({ error: 'Authentication failed', message: 'Unable to authenticate your request. Please log in again.' });
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
};