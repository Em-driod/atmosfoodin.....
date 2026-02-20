import { Request, Response } from 'express';
import crypto from 'crypto';
import Order from '../models/Order';
import { notifyNewOrder } from '../services/telegram';

// Paystack webhook handler
export const handlePaystackWebhook = async (req: Request, res: Response) => {
    try {
        // Verify webhook signature
        const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY as string)
            .update(JSON.stringify(req.body))
            .digest('hex');

        if (hash !== req.headers['x-paystack-signature']) {
            console.log('❌ Invalid webhook signature');
            return res.status(401).json({ message: 'Invalid signature' });
        }

        const event = req.body.event;
        const data = req.body.data;

        console.log(`🔔 Paystack Webhook: ${event}`, data);

        switch (event) {
            case 'charge.success':
                await handleSuccessfulPayment(data);
                break;
            
            case 'charge.failed':
                await handleFailedPayment(data);
                break;
            
            case 'transfer.success':
                await handleTransferSuccess(data);
                break;
            
            case 'transfer.failed':
                await handleTransferFailed(data);
                break;
            
            default:
                console.log(`ℹ️ Unhandled webhook event: ${event}`);
        }

        res.status(200).json({ message: 'Webhook received' });
    } catch (error) {
        console.error('❌ Webhook error:', error);
        res.status(500).json({ message: 'Webhook processing failed' });
    }
};

// Handle successful payment
const handleSuccessfulPayment = async (paymentData: any) => {
    try {
        const { reference, customer, amount, paid_at, metadata } = paymentData;
        
        console.log(`💰 Payment successful: ${reference} - ₦${amount}`);

        // Find order by reference
        const order = await Order.findOne({ 
            $or: [
                { paystackReference: reference },
                { _id: reference }
            ]
        });

        if (!order) {
            console.log(`❌ Order not found for reference: ${reference}`);
            return;
        }

        if (order.paymentStatus === 'success') {
            console.log(`ℹ️ Order ${order._id} already marked as paid`);
            return;
        }

        // Update order status
        order.paymentStatus = 'success';
        order.paidAt = new Date(paid_at);
        order.paystackReference = reference;
        order.paymentDetails = {
            method: 'paystack',
            amount,
            customer,
            paidAt: new Date(paid_at),
            metadata
        };

        await order.save();

        console.log(`✅ Order ${order._id} marked as PAID`);

        // Send notification to Telegram
        await sendPaymentNotification(order, 'success');

        // Here you can add additional logic:
        // - Send SMS to customer
        // - Send email receipt
        // - Notify kitchen staff
        // - Update inventory

    } catch (error) {
        console.error('❌ Error handling successful payment:', error);
    }
};

// Handle failed payment
const handleFailedPayment = async (paymentData: any) => {
    try {
        const { reference, customer, amount, gateway_response } = paymentData;
        
        console.log(`❌ Payment failed: ${reference} - ₦${amount}`);

        // Find order by reference
        const order = await Order.findOne({ 
            $or: [
                { paystackReference: reference },
                { _id: reference }
            ]
        });

        if (!order) {
            console.log(`❌ Order not found for reference: ${reference}`);
            return;
        }

        // Update order status
        order.paymentStatus = 'failed';
        order.paymentDetails = {
            method: 'paystack',
            amount,
            customer,
            failedAt: new Date(),
            reason: gateway_response?.message || 'Payment failed'
        };

        await order.save();

        console.log(`❌ Order ${order._id} marked as PAYMENT_FAILED`);

        // Send notification to Telegram
        await sendPaymentNotification(order, 'failed');

    } catch (error) {
        console.error('❌ Error handling failed payment:', error);
    }
};

// Handle successful transfer (for payouts)
const handleTransferSuccess = async (transferData: any) => {
    try {
        const { reference, amount, recipient, reason } = transferData;
        
        console.log(`💸 Transfer successful: ${reference} - ₦${amount} to ${recipient.name}`);

        // You can add logic here to:
        // - Update payout records
        // - Notify finance team
        // - Update accounting

    } catch (error) {
        console.error('❌ Error handling transfer success:', error);
    }
};

// Handle failed transfer
const handleTransferFailed = async (transferData: any) => {
    try {
        const { reference, amount, recipient, reason } = transferData;
        
        console.log(`❌ Transfer failed: ${reference} - ₦${amount} to ${recipient.name}`);

        // You can add logic here to:
        // - Log failed transfers
        // - Notify finance team
        // - Retry transfer logic

    } catch (error) {
        console.error('❌ Error handling transfer failure:', error);
    }
};

// Send payment notification to Telegram
const sendPaymentNotification = async (order: any, status: 'success' | 'failed') => {
    try {
        let message = '';
        
        if (status === 'success') {
            message = `💰 *PAYMENT CONFIRMED!* 💳\n\n`;
            message += `👤 *Customer:* ${order.customerName}\n`;
            message += `📞 *Phone:* ${order.phoneNumber}\n`;
            message += `💳 *Amount:* ₦${order.totalAmount.toLocaleString()}\n`;
            message += `🔑 *Reference:* ${order.paystackReference}\n`;
            message += `✅ *Status:* PAID ✓\n\n`;
            message += `🍽️ *Order ready for processing!*`;
        } else {
            message = `❌ *PAYMENT FAILED!* 💳\n\n`;
            message += `👤 *Customer:* ${order.customerName}\n`;
            message += `📞 *Phone:* ${order.phoneNumber}\n`;
            message += `💳 *Amount:* ₦${order.totalAmount.toLocaleString()}\n`;
            message += `🔑 *Reference:* ${order.paystackReference}\n`;
            message += `❌ *Status:* PAYMENT FAILED ✗\n\n`;
            message += `🔄 *Customer needs to retry payment*`;
        }

        const adminId = process.env.TELEGRAM_ADMIN_CHAT_ID;
        if (adminId) {
            const bot = await import('../services/telegram').then(m => m.default);
            await bot.telegram.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }

    } catch (error) {
        console.error('❌ Error sending payment notification:', error);
    }
};
