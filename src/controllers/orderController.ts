import { Request, Response } from 'express';
import Order from '../models/Order';
import Product from '../models/Product';
import Protein from '../models/Protein';
import { notifyNewOrder } from '../services/telegram';
import { initializePayment } from '../services/paystack';
import { calculateFeeFromDistance } from '../config/locations';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { createOrderSchema, updateOrderStatusSchema, CreateOrderInput } from '../validators/orderValidator';
import { AppError, asyncHandler } from '../utils/errorHandler';

export const createOrder = asyncHandler(async (req: Request, res: Response) => {
    // Validate input
    const validatedData: CreateOrderInput = createOrderSchema.parse(req.body);
    const { items, customerName, email, phoneNumber, address, deliveryMethod } = validatedData;

    if (!items || items.length === 0) {
        throw new AppError('Order items are required', 400);
    }

    try {
        let totalAmount = 0;
        const populatedItems = [];

        // Get all product IDs and protein IDs for bulk queries
        const productIds = items.map((item: CreateOrderInput['items'][0]) => item.product);
        const proteinIds = items.flatMap((item: CreateOrderInput['items'][0]) => item.proteins || []);
        
        // Bulk fetch products and proteins
        const [products, proteins] = await Promise.all([
            Product.find({ _id: { $in: productIds } }),
            Protein.find({ _id: { $in: proteinIds } })
        ]);
        
        // Create maps for quick lookup
        const productMap = new Map(products.map(p => [p._id.toString(), p]));
        const proteinMap = new Map(proteins.map(p => [p._id.toString(), p]));

        for (const item of items as CreateOrderInput['items']) {
            const product = productMap.get(item.product);
            
            if (!product) {
                throw new AppError(`Product ${item.product} not found`, 404);
            }

            let itemPrice = product.price;
            let proteinIds: string[] = [];
            let proteinNames: string[] = [];

            if (item.proteins && Array.isArray(item.proteins)) {
                for (const pId of item.proteins) {
                    const protein = proteinMap.get(pId);
                    if (protein) {
                        itemPrice += protein.price;
                        proteinIds.push(protein._id.toString());
                        proteinNames.push(protein.name);
                    }
                }
            }

            const quantity = item.quantity || 1;
            totalAmount += itemPrice * quantity;

            populatedItems.push({
                product: product._id,
                productName: product.name,
                quantity,
                price: itemPrice,
                proteins: proteinIds,
                proteinNames: proteinNames
            });
        }

        // Calculate delivery fee
        let deliveryFee = 0;
        if (deliveryMethod === 'delivery' && validatedData.deliveryDistance) {
            deliveryFee = calculateFeeFromDistance(validatedData.deliveryDistance);
            totalAmount += deliveryFee;
        }

        console.log('Order calculation:', {
            itemsCount: items.length,
            subtotal: totalAmount - deliveryFee,
            deliveryFee,
            totalAmount,
            deliveryMethod,
            deliveryDistance: validatedData.deliveryDistance
        });

        // Use verification code from frontend or generate one if not provided
        let pickupCode = '';
        let deliveryCode = '';

        if (validatedData.verificationCode) {
            // Use the verification code from frontend
            if (validatedData.deliveryMethod === 'pickup') {
                pickupCode = validatedData.verificationCode;
            } else {
                deliveryCode = validatedData.verificationCode;
            }
        } else {
            // Fallback: generate verification codes
            if (validatedData.deliveryMethod === 'pickup') {
                pickupCode = `ATMOS-P-${Math.floor(1000 + Math.random() * 9000)}`;
            } else {
                deliveryCode = `ATMOS-D-${Math.floor(1000 + Math.random() * 9000)}`;
            }
        }

        // Initialize Paystack Payment with order data as metadata
        const orderReference = `ATMOS-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const paymentData = await initializePayment(email, totalAmount, orderReference, {
            items: populatedItems,
            totalAmount,
            customerName,
            email,
            phoneNumber,
            address: deliveryMethod === 'pickup' ? 'PICKUP @ ATMOS KITCHEN' : address,
            deliveryMethod: deliveryMethod || 'delivery',
            deliveryCoordinates: validatedData.deliveryCoordinates,
            deliveryDistance: validatedData.deliveryDistance,
            pickupCode: pickupCode || undefined,
            deliveryCode: deliveryCode || undefined
        });

        // Only return payment URL, order will be created after payment confirmation
        res.status(200).json({
            authorization_url: paymentData.authorization_url,
            reference: paymentData.reference
        });
        
    } catch (error) {
        throw error;
    }
});

export const paystackWebhook = asyncHandler(async (req: Request, res: Response) => {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
        throw new AppError('Paystack secret key not configured', 500);
    }

    const hash = crypto.createHmac('sha512', secret).update(JSON.stringify(req.body)).digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
        throw new AppError('Invalid signature', 401);
    }

    const event = req.body;
    if (event.event === 'charge.success') {
        const orderData = JSON.parse(event.data.metadata);
        const paymentReference = event.data.reference;

        // Use transaction for order creation
        const session = await mongoose.startSession();
        session.startTransaction();
        
        try {
            // Create the order only after successful payment
            const newOrder = new Order({
                ...orderData,
                status: 'confirmed',
                paymentStatus: 'success',
                paystackReference: paymentReference
            });

            const savedOrder = await newOrder.save({ session });
            await Order.populate(savedOrder, 'items.product');
            await Order.populate(savedOrder, 'items.proteins');

            // Trigger Telegram notification (outside transaction)
            await session.commitTransaction();
            session.endSession();

            const notificationData = {
                customerName: savedOrder.customerName,
                phoneNumber: savedOrder.phoneNumber,
                address: savedOrder.address,
                deliveryMethod: savedOrder.deliveryMethod,
                pickupCode: savedOrder.pickupCode,
                deliveryCode: savedOrder.deliveryCode,
                totalAmount: savedOrder.totalAmount,
                items: savedOrder.items.map((item: any) => ({
                    product: { name: (item.product as any).name },
                    proteins: item.proteins ? item.proteinNames : [],
                    quantity: item.quantity,
                    price: item.price
                }))
            };

            // Fire and forget notification
            notifyNewOrder(notificationData).catch(error => {
                console.error('Telegram notification failed:', error);
            });
            
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            throw error;
        }
    }

    res.status(200).send('Webhook Received');
});

export const getOrders = asyncHandler(async (req: Request, res: Response) => {
    const orders = await Order.find().sort({ createdAt: -1 })
        .populate('items.product')
        .populate('items.proteins');
    res.json(orders);
});

export const updateOrderStatus = asyncHandler(async (req: Request, res: Response) => {
    const validatedData = updateOrderStatusSchema.parse(req.body);
    const { status } = validatedData;
    
    const order = await Order.findByIdAndUpdate(
        req.params.id,
        { status },
        { new: true }
    );
    
    if (!order) {
        throw new AppError('Order not found', 404);
    }
    
    res.json(order);
});

export const getOrderById = asyncHandler(async (req: Request, res: Response) => {
    const order = await Order.findById(req.params.id)
        .populate('items.product')
        .populate('items.proteins');

    if (!order) {
        throw new AppError('Order not found', 404);
    }
    
    res.json(order);
});
