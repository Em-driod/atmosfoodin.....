import { Request, Response } from 'express';
import Order from '../models/Order';
import Product from '../models/Product';
import Protein from '../models/Protein';
import { notifyNewOrder, notifyPaymentVerification } from '../services/telegram';
import { calculateFeeFromDistance } from '../config/locations';
import mongoose from 'mongoose';
import { createOrderSchema, updateOrderStatusSchema, CreateOrderInput } from '../validators/orderValidator';
import { AppError, asyncHandler } from '../utils/errorHandler';

export const createOrder = asyncHandler(async (req: Request, res: Response) => {
    console.log('=== ORDER CREATION START ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Request headers:', req.headers);
    
    // Validate input
    let validatedData: CreateOrderInput;
    try {
        validatedData = createOrderSchema.parse(req.body);
    } catch (validationError: any) {
        console.error('Validation error:', validationError);
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: validationError.errors || validationError.issues
        });
    }
    
    const { items, customerName, email, phoneNumber, address, deliveryMethod } = validatedData;

    console.log('Validated data:', {
        itemsCount: items?.length || 0,
        customerName,
        email,
        phoneNumber,
        address,
        deliveryMethod
    });

    if (!items || items.length === 0) {
        console.error('ERROR: No items provided');
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
            // Use verification code from frontend
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

        // Create order with manual payment status
        const orderReference = `ATMOS-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const paymentReference = `MANUAL-${orderReference}`;
        
        const newOrder = new Order({
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
            deliveryCode: deliveryCode || undefined,
            status: 'pending',
            paymentStatus: 'pending',
            orderReference,
            paymentReference,
            paymentMethod: 'manual'
        });

        const savedOrder = await newOrder.save();
        await Order.populate(savedOrder, 'items.product');
        await Order.populate(savedOrder, 'items.proteins');

        // Send notification to Telegram about new order with pending payment
        const notificationData = {
            orderReference: savedOrder.orderReference,
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
        notifyPaymentVerification(notificationData).catch(error => {
            console.error('Telegram notification failed:', error);
        });

        // Return order details for manual payment
        const responseData = {
            success: true,
            orderId: savedOrder._id,
            orderReference,
            totalAmount,
            paymentInstructions: {
                bankName: "Moniepoint",
                accountNumber: "5228829625",
                accountName: "ATMOS FOOD NG",
                whatsappNumber: "08075389127",
                message: `Please pay ₦${totalAmount.toLocaleString()} to the above account and share receipt screenshot on WhatsApp for verification.`
            }
        };

        console.log('Sending response:', JSON.stringify(responseData, null, 2));
        res.status(200).json(responseData);
        
    } catch (error: any) {
        console.error('Order creation error:', error);
        
        // Handle different types of errors
        if (error.name === 'ValidationError') {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: error.errors
            });
        }
        
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'Duplicate order reference'
            });
        }
        
        // Default error response
        res.status(500).json({
            success: false,
            message: error.message || 'Internal server error'
        });
    }
});

// Manual payment verification endpoint
export const verifyPayment = asyncHandler(async (req: Request, res: Response) => {
    const { orderId, receiptImage } = req.body;

    if (!orderId) {
        throw new AppError('Order ID is required', 400);
    }

    const order = await Order.findById(orderId)
        .populate('items.product')
        .populate('items.proteins');

    if (!order) {
        throw new AppError('Order not found', 404);
    }

    if (order.paymentStatus === 'success') {
        throw new AppError('Payment already verified', 400);
    }

    // Update order status to paid
    order.paymentStatus = 'success';
    order.status = 'preparing';
    order.paidAt = new Date();
    order.receiptImage = receiptImage;

    await order.save();

    // Send notification about payment verification
    const notificationData = {
        orderReference: order.orderReference,
        customerName: order.customerName,
        phoneNumber: order.phoneNumber,
        address: order.address,
        deliveryMethod: order.deliveryMethod,
        pickupCode: order.pickupCode,
        deliveryCode: order.deliveryCode,
        totalAmount: order.totalAmount,
        items: order.items.map((item: any) => ({
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

    res.json({
        success: true,
        message: 'Payment verified successfully',
        order
    });
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
