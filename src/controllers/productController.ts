import { Request, Response } from 'express';
import Product from '../models/Product';
import Protein from '../models/Protein';
import { cacheHelpers } from '../utils/cache';

export const getProducts = async (req: Request, res: Response) => {
    try {
        // Try to get from cache first
        const cachedProducts = cacheHelpers.getProducts();
        if (cachedProducts) {
            console.log('🎯 Cache HIT: products');
            return res.json(cachedProducts);
        }

        console.log('❌ Cache MISS: products - fetching from database');
        const products = await Product.find({ isAvailable: true }).populate('proteins');
        
        // Cache the result for 10 minutes
        cacheHelpers.cacheProducts(products);
        
        res.json(products);
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};

export const getProteins = async (req: Request, res: Response) => {
    try {
        // Try to get from cache first
        const cachedProteins = cacheHelpers.getProteins();
        if (cachedProteins) {
            console.log('🎯 Cache HIT: proteins');
            return res.json(cachedProteins);
        }

        console.log('❌ Cache MISS: proteins - fetching from database');
        const proteins = await Protein.find({ isAvailable: true });
        
        // Cache the result for 10 minutes
        cacheHelpers.cacheProteins(proteins);
        
        res.json(proteins);
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};

export const getMenu = async (req: Request, res: Response) => {
    try {
        // Try to get combined menu from cache
        const cachedMenu = cacheHelpers.getMenu();
        if (cachedMenu) {
            console.log('🎯 Cache HIT: combined menu');
            return res.json(cachedMenu);
        }

        console.log('❌ Cache MISS: combined menu - fetching from database');
        const [products, proteins] = await Promise.all([
            Product.find({ isAvailable: true }).populate('proteins'),
            Protein.find({ isAvailable: true })
        ]);
        
        const menu = { products, proteins };
        
        // Cache the combined menu for 5 minutes
        cacheHelpers.cacheMenu(menu);
        
        res.json(menu);
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};

export const createProduct = async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            res.status(400).json({ message: 'Product image is required' });
            return;
        }

        const productData = {
            ...req.body,
            image: req.file.path, // Cloudinary URL
            tags: req.body.tags ? (typeof req.body.tags === 'string' ? JSON.parse(req.body.tags) : req.body.tags) : []
        };

        const product = new Product(productData);
        const savedProduct = await product.save();
        res.status(201).json(savedProduct);
    } catch (error: any) {
        res.status(400).json({ message: error.message });
    }
};
