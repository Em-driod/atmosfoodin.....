import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from './models/Product';
import Protein from './models/Protein';

dotenv.config();

const FOOD_ITEMS = [
    {
        name: 'Jollof Rice',
        description: 'Authentic Nigerian long-grain rice parboiled in a rich, spicy tomato reduction.',
        price: 4500,
        category: 'Grains',
        image: '/jollof.jpeg',
        rating: 4.9,
        calories: 550,
        tags: ['Legendary', 'Spicy']
    },
    {
        name: 'Fried Rice',
        description: 'Savory seasoned rice stir-fried with sweet peas, carrots, and aromatic local spices.',
        price: 4500,
        category: 'Grains',
        image: '/fried.jpeg',
        rating: 4.8,
        calories: 520,
        tags: ['Signature']
    },
    {
        name: 'Mixed Rice',
        description: 'A perfect "sync" of both worlds. A half-and-half portion of our Jollof and Fried Rice.',
        price: 5500,
        category: 'Grains',
        image: '/jollofandfried.jpeg',
        rating: 5.0,
        calories: 540,
        tags: ['Best Value']
    }
];

const PROTEIN_OPTIONS = [
    { name: 'Grilled Chicken', price: 3500 },
    { name: 'Spicy Beef', price: 4000 },
    { name: 'Fried Fish', price: 6500 },
];

const seedDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI as string);
        console.log('Connected to DB for seeding...');

        await Product.deleteMany({});
        await Protein.deleteMany({});

        await Product.insertMany(FOOD_ITEMS);
        await Protein.insertMany(PROTEIN_OPTIONS);

        console.log('✅ Seeding complete!');
        process.exit();
    } catch (error) {
        console.error('❌ Seeding failed:', error);
        process.exit(1);
    }
};

seedDB();
