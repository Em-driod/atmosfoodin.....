import mongoose, { Schema, Document } from 'mongoose';

export interface IOrderItem {
    product: mongoose.Types.ObjectId;
    productName: string;
    quantity: number;
    price: number;
    proteins?: mongoose.Types.ObjectId[];
    proteinNames?: string[];
}

export interface IOrder extends Document {
    items: IOrderItem[];
    totalAmount: number;
    customerName: string;
    email: string;
    phoneNumber: string;
    address: string;
    deliveryMethod: 'delivery' | 'pickup';
    deliveryCoordinates?: {
        lat: number;
        lng: number;
    };
    deliveryDistance?: number;
    pickupCode?: string;
    deliveryCode?: string;
    isArchived: boolean;
    status: 'pending' | 'preparing' | 'delivered' | 'cancelled';
    paymentStatus: 'pending' | 'success' | 'failed';
    paymentReference: string;
    orderReference: string;
    paystackReference: string;
    paidAt?: Date;
    receiptImage?: string;
    paymentMethod?: string;
    paymentDetails?: {
        method: string;
        amount: number;
        customer?: any;
        paidAt?: Date;
        failedAt?: Date;
        metadata?: any;
        reason?: string;
    };
    createdAt: Date;
    updatedAt: Date;
}

const OrderSchema: Schema = new Schema({
    items: [{
        product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
        productName: { type: String, required: true },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
        proteins: [{ type: Schema.Types.ObjectId, ref: 'Protein' }],
        proteinNames: [{ type: String }]
    }],
    totalAmount: { type: Number, required: true },
    customerName: { type: String, required: true, index: true },
    email: { type: String, required: true, index: true },
    phoneNumber: { type: String, required: true },
    address: { type: String, required: true },
    deliveryMethod: { type: String, enum: ['delivery', 'pickup'], default: 'delivery' },
    deliveryCoordinates: {
        lat: { type: Number },
        lng: { type: Number }
    },
    deliveryDistance: { type: Number },
    pickupCode: { type: String },
    deliveryCode: { type: String },
    isArchived: { type: Boolean, default: false },
    status: { type: String, enum: ['pending', 'preparing', 'delivered', 'cancelled'], default: 'pending', index: true },
    paymentStatus: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
    paymentReference: { type: String, required: true },
    orderReference: { type: String, required: true, unique: true },
    paystackReference: { type: String },
    paidAt: { type: Date },
    receiptImage: { type: String },
    paymentMethod: { type: String },
    paymentDetails: {
        method: { type: String },
        amount: { type: Number },
        customer: { type: Schema.Types.Mixed },
        paidAt: { type: Date },
        failedAt: { type: Date },
        metadata: { type: Schema.Types.Mixed },
        reason: { type: String }
    }
}, { timestamps: true });

export default mongoose.model<IOrder>('Order', OrderSchema);
