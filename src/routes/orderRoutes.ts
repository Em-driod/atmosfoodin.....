import { Router } from 'express';
import { createOrder, getOrders, updateOrderStatus, getOrderById, verifyPayment } from '../controllers/orderController';
import { auth } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { createOrderSchema, updateOrderStatusSchema } from '../validators/orderValidator';

const router = Router();

// Public routes
router.post('/', validateBody(createOrderSchema), createOrder);
router.post('/verify-payment', verifyPayment);
router.get('/:id', getOrderById);

// Protected routes (Admin only)
router.get('/', auth, getOrders);
router.patch('/:id/status', auth, validateBody(updateOrderStatusSchema), updateOrderStatus);

export default router;
