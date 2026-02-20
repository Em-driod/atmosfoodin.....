import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

const paystack = axios.create({
    baseURL: 'https://api.paystack.co',
    headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
    },
});

export const initializePayment = async (email: string, amount: number, reference: string, metadata?: any) => {
    try {
        console.log('Paystack config:', {
            secretKey: PAYSTACK_SECRET_KEY ? 'Set' : 'Not set',
            frontendUrl: process.env.FRONTEND_URL ? 'Set' : 'Not set',
            email,
            amount,
            reference
        });

        const response = await paystack.post('/transaction/initialize', {
            email,
            amount: amount * 100, // Paystack amount is in kobo
            reference,
            callback_url: `${process.env.FRONTEND_URL}/payment-success`, // Redirect after payment
            metadata: metadata || {}
        });
        return response.data.data;
    } catch (error: any) {
        console.error('Paystack Initialize Error:', error.response?.data || error.message);
        console.error('Full error:', error);
        throw new Error(`Failed to initialize payment: ${error.response?.data?.message || error.message}`);
    }
};

export const verifyPayment = async (reference: string) => {
    try {
        const response = await paystack.get(`/transaction/verify/${reference}`);
        return response.data.data;
    } catch (error: any) {
        console.error('Paystack Verify Error:', error.response?.data || error.message);
        throw new Error('Failed to verify payment');
    }
};
