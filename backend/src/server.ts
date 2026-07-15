import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { supabase } from './utils/supabase';
import authRoutes from './routes/auth';
import requestRoutes from './routes/requests';
import departmentRoutes from './routes/departments';
import expenseRoutes from './routes/expenses';
import pettyCashRoutes from './routes/pettyCash';
import reportRoutes from './routes/reports';
// Force redeploy - duplicate Finance department deleted
import projectRoutes from './routes/projects';
import vendorRoutes from './routes/vendors';
import slaRoutes from './routes/sla';
import budgetAlertRoutes from './routes/budgetAlerts';
import notificationRoutes from './routes/notifications';
import budgetRoutes from './routes/budget';
import travelBookingRoutes from './routes/travelBookings';
import cashAdvanceRoutes from './routes/cashAdvances';
import uploadRoutes from './routes/upload';
import configRoutes from './routes/config';
import auditLogRoutes from './routes/auditLogs';
import documentUploadRoutes from './routes/documentUploads';
import fiscalYearRoutes from './routes/fiscalYear';
import costCenterRoutes from './routes/costCenters';
import costAllocationRoutes from './routes/costAllocations';

dotenv.config();

const app = express();

app.use(helmet());

const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'https://m88-bms.netlify.app',
  ...(process.env.ADDITIONAL_CORS_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean) || [])
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.startsWith('http://127.0.0.1:') || origin.startsWith('http://localhost:')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-BMS-Token']
}));
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/petty-cash', pettyCashRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/sla', slaRoutes);
app.use('/api/budget-alerts', budgetAlertRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/budget', budgetRoutes);
app.use('/api/travel-bookings', travelBookingRoutes);
app.use('/api/cash-advances', cashAdvanceRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/config', configRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/document-uploads', documentUploadRoutes);
app.use('/api/fiscal-year', fiscalYearRoutes);
app.use('/api/cost-centers', costCenterRoutes);
app.use('/api/cost-allocations', costAllocationRoutes);

// Health check endpoint
app.get('/api/system/health', (req, res) => {
  res.json({
    backend: {
      status: 'healthy',
      uptime: process.uptime()
    }
  });
});

// 404 handler - Route not found
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    message: `The requested endpoint ${req.method} ${req.path} does not exist.`,
    code: 'ROUTE_NOT_FOUND'
  });
});

// Global error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Global Error Handler:', err);

  // Determine error type and set appropriate status code
  let statusCode = 500;
  let errorCode = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected error occurred. Please try again later.';

  if (err.name === 'UnauthorizedError' || err.message?.includes('jwt')) {
    statusCode = 401;
    errorCode = 'UNAUTHORIZED';
    message = 'Authentication failed. Please log in again.';
  } else if (err instanceof SyntaxError && err.message?.includes('JSON')) {
    statusCode = 400;
    errorCode = 'BAD_REQUEST';
    message = 'Malformed JSON in request body.';
  } else if (err.name === 'ValidationError' || err.message?.includes('validation')) {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = err.message || 'Validation failed. Please check your input.';
  } else if (err.code === '23505') { // PostgreSQL unique violation
    statusCode = 409;
    errorCode = 'DUPLICATE_ERROR';
    message = 'A record with this information already exists.';
  } else if (err.code === '23503') { // PostgreSQL foreign key violation
    statusCode = 400;
    errorCode = 'REFERENCE_ERROR';
    message = 'Referenced record does not exist.';
  } else if (err.code === 'PGRST116') { // Supabase row not found
    statusCode = 404;
    errorCode = 'NOT_FOUND';
    message = 'The requested resource was not found.';
  }

  // Send structured error response
  res.status(statusCode).json({
    success: false,
    error: errorCode,
    message: message,
    details: process.env.NODE_ENV === 'development' ? err.message : undefined,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    timestamp: new Date().toISOString()
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Log to monitoring service if available
  if (process.env.NODE_ENV === 'production') {
    // In production, you might want to restart the process
    // or alert the monitoring service
    console.error('Critical unhandled rejection in production');
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught Exception:', error);
  // Log to monitoring service if available
  if (process.env.NODE_ENV === 'production') {
    // In production, exit the process and let PM2/Docker restart it
    console.error('Critical uncaught exception. Exiting process...');
    process.exit(1);
  }
});

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed. Process terminated.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed. Process terminated.');
    process.exit(0);
  });
});
