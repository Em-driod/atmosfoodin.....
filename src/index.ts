import dotenv from 'dotenv';
dotenv.config();

import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import connectDB from './config/db';
import { initTelegramBot } from './services/telegram';

// Connect to Database
connectDB();

// Initialize Bot
initTelegramBot();

const app: Application = express();
const PORT = process.env.PORT || 5000;

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes).
    standardHeaders: 'draft-7', // Set `RateLimit` and `RateLimit-Policy` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: {
        message: 'Too many requests from this IP, please try again after 15 minutes'
    }
});

// Middleware
app.use(limiter);
app.use(compression());
app.use(cors());
app.use(morgan('dev'));

// JSON parsing middleware with error handling
app.use((req, res, next) => {
    res.setHeader('Content-Type', 'application/json');
    next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check routes
app.get('/', (req: Request, res: Response) => {
    res.json({ message: '🍽️ Atmos Food API is running!' });
});

app.get('/health', (req: Request, res: Response) => {
    res.json({ 
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Admin cache clear endpoint
app.post('/admin/clear-cache', (req: Request, res: Response) => {
    const { cacheHelpers } = require('./utils/cache');
    cacheHelpers.clearAll();
    res.json({ message: 'Cache cleared successfully' });
});

// Routes
import productRoutes from './routes/productRoutes';
import orderRoutes from './routes/orderRoutes';

app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);

// Error handling middleware (must be last)
app.use((err: any, req: Request, res: Response, next: any) => {
    console.error('Global error handler:', err);
    
    // Ensure JSON response with proper content type
    res.setHeader('Content-Type', 'application/json');
    
    const errorResponse = {
        success: false,
        message: err.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    };
    
    res.status(err.status || 500).json(errorResponse);
});

// Start server
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});

export default app;
