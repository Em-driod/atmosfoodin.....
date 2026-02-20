import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to protect routes using a secret API Key.
 * Checks for the 'x-api-key' header.
 */
export const auth = (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-api-key'];
    const validKey = process.env.ADMIN_API_KEY;

    if (!validKey) {
        console.error('⚠️ ADMIN_API_KEY is not set in .env');
        res.status(500).json({ message: 'Internal server error: Security not configured.' });
        return;
    }

    if (apiKey && apiKey === validKey) {
        next();
    } else {
        res.status(401).json({ message: 'Unauthorized: Invalid or missing API key.' });
    }
};
