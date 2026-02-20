import { Router } from 'express';
import { getProducts, getProteins, createProduct, getMenu } from '../controllers/productController';
import { upload } from '../config/cloudinary';
import { cacheHelpers } from '../utils/cache';

const router = Router();

router.get('/', getProducts);
router.get('/proteins', getProteins);
router.get('/menu', getMenu);
router.post('/', upload.single('image'), (req, res, next) => {
    // Invalidate cache when new product is created
    cacheHelpers.invalidateProducts();
    next();
}, createProduct);

export default router;
