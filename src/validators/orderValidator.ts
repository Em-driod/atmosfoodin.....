import { z } from 'zod';

export const createOrderSchema = z.object({
    items: z.array(z.object({
        product: z.string().min(1, "Product ID is required"),
        quantity: z.number().min(1, "Quantity must be at least 1"),
        proteins: z.array(z.string()).optional()
    })).min(1, "At least one item is required"),
    customerName: z.string().min(2, "Customer name must be at least 2 characters"),
    email: z.string().email("Invalid email address"),
    phoneNumber: z.string().min(10, "Phone number must be at least 10 characters"),
    address: z.string().min(5, "Address must be at least 5 characters"),
    deliveryMethod: z.enum(['delivery', 'pickup']),
    deliveryCoordinates: z.object({
        lat: z.number(),
        lng: z.number()
    }).optional(),
    deliveryDistance: z.number().optional(),
    deliveryFee: z.number().optional(),
    deliveryAreaId: z.string().optional(),
    deliveryLGA: z.string().optional(),
    verificationCode: z.string().optional()
});

export const updateOrderStatusSchema = z.object({
    status: z.enum(['pending', 'preparing', 'delivered', 'cancelled'])
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
