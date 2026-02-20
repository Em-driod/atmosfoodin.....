import { Router } from 'express';
import { createOrder, getOrders, updateOrderStatus, getOrderById } from '../controllers/orderController';
import { handlePaystackWebhook } from '../controllers/webhookController';
import { auth } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { createOrderSchema, updateOrderStatusSchema } from '../validators/orderValidator';

const router = Router();

// Public routes
router.post('/', validateBody(createOrderSchema), createOrder);
router.post('/webhook', handlePaystackWebhook);
router.get('/:id', getOrderById);

// Protected routes (Admin only)
router.get('/', auth, getOrders);
router.patch('/:id/status', auth, validateBody(updateOrderStatusSchema), updateOrderStatus);

export default router;
