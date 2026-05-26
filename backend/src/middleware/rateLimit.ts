import { Request, Response, NextFunction } from 'express';

// No-op rate limiting middleware. Rate limiting has been disabled.
const rateLimiter = (req: Request, res: Response, next: NextFunction) => next();
const authRateLimiter = (req: Request, res: Response, next: NextFunction) => next();
const passwordResetRateLimiter = (req: Request, res: Response, next: NextFunction) => next();

export { rateLimiter, authRateLimiter, passwordResetRateLimiter };
