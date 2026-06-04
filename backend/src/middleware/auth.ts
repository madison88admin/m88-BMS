import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { hasActiveDelegationForRoles } from '../utils/delegations';

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

export const authorizeOrDelegate = (...roles: string[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (roles.includes(req.user.role)) {
      return next();
    }

    try {
      const delegated = await hasActiveDelegationForRoles(req.user.id, roles);
      if (delegated) {
        return next();
      }
    } catch (err: any) {
      return res.status(400).json({ error: err.message || 'Delegation check failed' });
    }

    return res.status(403).json({ error: 'Forbidden' });
  };
};

// Helper function to check if user has accounting access (including accounting_limited)
export const hasAccountingAccess = (role: string) => {
  return ['accounting', 'accounting_limited', 'admin', 'super_admin'].includes(role);
};

// Helper function to check if user has full accounting access (not limited)
export const hasFullAccountingAccess = (role: string) => {
  return ['accounting', 'admin', 'super_admin'].includes(role);
};