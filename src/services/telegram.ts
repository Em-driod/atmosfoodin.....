import { Telegraf, Scenes, session, Markup } from 'telegraf';
import Product from '../models/Product';
import Protein from '../models/Protein';
import Order from '../models/Order';
import { cloudinary } from '../config/cloudinary';
import mongoose from 'mongoose';
import { cacheHelpers } from '../utils/cache';

/**
 * Interface for the wizard session state
 */
interface MyWizardSession extends Scenes.WizardSessionData {
    productData: {
        name?: string;
        description?: string;
        price?: number;
        category?: 'Grains' | 'Drinks';
        image?: string;
        proteins?: string[];
    };
    proteinData: {
        name?: string;
        price?: number;
    };
}

type MyContext = Scenes.WizardContext<MyWizardSession>;

const bot = new Telegraf<MyContext>(process.env.TELEGRAM_BOT_TOKEN as string);

// --- Product Wizard ---
const productWizard = new Scenes.WizardScene<MyContext>(
    'ADD_PRODUCT_WIZARD',
    // Step 1: Name
    async (ctx: MyContext) => {
        (ctx.wizard.state as any).productData = { proteins: [] };
        await ctx.reply('📝 Enter the product name:');
        return ctx.wizard.next();
    },
    // Step 2: Description
    async (ctx: MyContext) => {
        if (!ctx.message || !('text' in ctx.message)) return ctx.reply('Please enter a valid text.');
        (ctx.wizard.state as any).productData.name = ctx.message.text;
        await ctx.reply('📄 Enter the product description:');
        return ctx.wizard.next();
    },
    // Step 3: Price
    async (ctx: MyContext) => {
        if (!ctx.message || !('text' in ctx.message)) return ctx.reply('Please enter a valid text.');
        (ctx.wizard.state as any).productData.description = ctx.message.text;
        await ctx.reply('💰 Enter the price (number only):');
        return ctx.wizard.next();
    },
    // Step 4: Category
    async (ctx: MyContext) => {
        if (!ctx.message || !('text' in ctx.message)) return ctx.reply('Please enter a valid text.');
        const price = parseFloat(ctx.message.text);
        if (isNaN(price)) return ctx.reply('Please enter a valid number for price.');
        (ctx.wizard.state as any).productData.price = price;
        await ctx.reply('📁 Select Category:', Markup.keyboard([['Grains', 'Drinks']]).oneTime().resize());
        return ctx.wizard.next();
    },
    // Step 5: Protein Selection (if Grains) or jump to Image
    async (ctx: MyContext) => {
        if (!ctx.message || !('text' in ctx.message)) return ctx.reply('Please enter a valid text.');
        const category = ctx.message.text as any;
        if (category !== 'Grains' && category !== 'Drinks') return ctx.reply('Please choose either Grains or Drinks.');
        (ctx.wizard.state as any).productData.category = category;

        if (category === 'Grains') {
            const proteins = await Protein.find({ isAvailable: true });
            if (proteins.length === 0) {
                await ctx.reply('No proteins found. Skipping to image.');
                await ctx.reply('🖼️ Send a photo or a direct image URL:', Markup.removeKeyboard());
                return ctx.wizard.selectStep(5);
            }

            const keyboard = proteins.map(p => [Markup.button.callback(`➕ ${p.name}`, `toggle_wizard_prot_${p._id}`)]);
            keyboard.push([Markup.button.callback('✅ DONE', 'finish_proteins')]);

            await ctx.reply('🍗 Select available proteins (optional):', Markup.inlineKeyboard(keyboard));
            // We stay on this step to handle callbacks, but the wizard needs to know when to move.
            // Actually, we use an intermediate step or handle callback here.
            return ctx.wizard.next();
        } else {
            await ctx.reply('🖼️ Send a photo or a direct image URL:', Markup.removeKeyboard());
            return ctx.wizard.selectStep(5);
        }
    },
    // Step 6: Wait for Image (Jump target)
    async (ctx: MyContext) => {
        // This step is reached after protein selection or directly for Drinks
        if (ctx.callbackQuery && 'data' in ctx.callbackQuery) {
            const data = ctx.callbackQuery.data;
            if (data === 'finish_proteins') {
                await ctx.answerCbQuery();
                await ctx.reply('🖼️ Send a photo or a direct image URL:');
                return;
            }
            if (data.startsWith('toggle_wizard_prot_')) {
                const protId = data.replace('toggle_wizard_prot_', '');
                const state = (ctx.wizard.state as any).productData;
                if (state.proteins.includes(protId)) {
                    state.proteins = state.proteins.filter((id: string) => id !== protId);
                } else {
                    state.proteins.push(protId);
                }

                // Update keyboard to show selection
                const proteins = await Protein.find({ isAvailable: true });
                const keyboard = proteins.map(p => {
                    const isSelected = state.proteins.includes(p._id.toString());
                    return [Markup.button.callback(`${isSelected ? '✅' : '➕'} ${p.name}`, `toggle_wizard_prot_${p._id.toString()}`)];
                });
                keyboard.push([Markup.button.callback('✨ DONE', 'finish_proteins')]);

                await ctx.editMessageReplyMarkup(Markup.inlineKeyboard(keyboard).reply_markup);
                await ctx.answerCbQuery();
                return; // Stay here
            }
        }

        // If it's a message, and we are expecting an image
        if (ctx.message && ('photo' in ctx.message || 'text' in ctx.message)) {
            // This is the actual image upload logic
            try {
                let imageUrl = '';
                if ('photo' in ctx.message) {
                    const photo = ctx.message.photo[ctx.message.photo.length - 1];
                    const link = await ctx.telegram.getFileLink(photo.file_id);
                    const uploadRes = await cloudinary.uploader.upload(link.href, { folder: 'atmos_food' });
                    imageUrl = uploadRes.secure_url;
                } else if ('text' in ctx.message) {
                    imageUrl = ctx.message.text;
                }

                const { name, description, price, category, proteins } = (ctx.wizard.state as any).productData;
                const newProduct = new Product({
                    name,
                    description,
                    price,
                    category,
                    image: imageUrl,
                    isAvailable: true,
                    proteins: proteins.map((id: string) => new mongoose.Types.ObjectId(id))
                });

                await newProduct.save();
                
                // Invalidate cache when new product is added
                cacheHelpers.invalidateProducts();
                
                await ctx.reply(`✅ Product *${name}* added successfully!`, { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } });
                return ctx.scene.leave();
            } catch (error) {
                console.error('Error adding product:', error);
                await ctx.reply('❌ error adding product. Try again.');
                return ctx.scene.leave();
            }
        }

        return; // Wait for callback or message
    }
);

// --- Protein Wizard ---
const proteinWizard = new Scenes.WizardScene<MyContext>(
    'ADD_PROTEIN_WIZARD',
    // Step 1: Name
    async (ctx: MyContext) => {
        (ctx.wizard.state as any).proteinData = {};
        await ctx.reply('📝 Enter the protein name (e.g., Beef, Chicken):');
        return ctx.wizard.next();
    },
    // Step 2: Price
    async (ctx: MyContext) => {
        if (!ctx.message || !('text' in ctx.message)) return ctx.reply('Please enter a valid text.');
        (ctx.wizard.state as any).proteinData.name = ctx.message.text;
        await ctx.reply('💰 Enter the price:');
        return ctx.wizard.next();
    },
    // Step 3: Finalize
    async (ctx: MyContext) => {
        if (!ctx.message || !('text' in ctx.message)) return ctx.reply('Please enter a valid text.');
        const price = parseFloat(ctx.message.text);
        if (isNaN(price)) return ctx.reply('Please enter a valid number.');

        try {
            const newProtein = new Protein({
                name: (ctx.wizard.state as any).proteinData.name,
                price,
                isAvailable: true
            });
            await newProtein.save();
            
            // Invalidate cache when new protein is added
            cacheHelpers.invalidateProteins();
            
            await ctx.reply(`✅ Protein *${newProtein.name}* added!`, { parse_mode: 'Markdown' });
            return ctx.scene.leave();
        } catch (error) {
            await ctx.reply('❌ Error adding protein.');
            return ctx.scene.leave();
        }
    }
);

const stage = new Scenes.Stage<MyContext>([productWizard, proteinWizard]);
bot.use(session());
bot.use(stage.middleware());

// Basic Commands
bot.start((ctx) => {
    ctx.reply('👋 Welcome to Atmos Food Admin Bot!\n\nCommands:\n/menu - View/manage menu\n/orders - View recent orders\n/history - View order history\n/add_product - Add item\n/add_protein - Add protein\n/delete_product - Delete item\n/delete_protein - Delete protein\n/clear_orders - Archive today\'s orders');
});

bot.help((ctx) => {
    ctx.reply('👋 Welcome to Atmos Food Admin Bot!\n\nCommands:\n/menu - View current menu\n/orders - View recent orders\n/history - View order history\n/add_product - Add a new item\n/add_protein - Add a new protein\n/delete_product - Remove a product\n/delete_protein - Remove a protein\n/clear_orders - Archive today\'s orders');
});

bot.command('add_product', (ctx) => ctx.scene.enter('ADD_PRODUCT_WIZARD'));
bot.command('add_protein', (ctx) => ctx.scene.enter('ADD_PROTEIN_WIZARD'));

bot.command('delete_product', async (ctx) => {
    const products = await Product.find();
    if (products.length === 0) return ctx.reply('No products to delete.');
    const keyboard = products.map(p => [Markup.button.callback(`🗑️ ${p.name}`, `del_prod_${p._id.toString()}`)]);
    await ctx.reply('Select a product to DELETE PERMANENTLY:', Markup.inlineKeyboard(keyboard));
});

bot.command('delete_protein', async (ctx) => {
    const proteins = await Protein.find();
    if (proteins.length === 0) return ctx.reply('No proteins to delete.');
    const keyboard = proteins.map(p => [Markup.button.callback(`🗑️ ${p.name}`, `del_prot_${p._id.toString()}`)]);
    await ctx.reply('Select a protein to DELETE PERMANENTLY:', Markup.inlineKeyboard(keyboard));
});

bot.action(/^del_prod_(.+)/, async (ctx) => {
    const id = ctx.match[1];
    try {
        const product = await Product.findByIdAndDelete(id);
        await ctx.answerCbQuery();
        await ctx.editMessageText(`🗑️ Deleted product: *${product?.name}*`, { parse_mode: 'Markdown' });
    } catch (e) {
        await ctx.reply('Error deleting product');
    }
});

bot.action(/^del_prot_(.+)/, async (ctx) => {
    const id = ctx.match[1];
    try {
        const protein = await Protein.findByIdAndDelete(id);
        await ctx.answerCbQuery();
        await ctx.editMessageText(`🗑️ Deleted protein: *${protein?.name}*`, { parse_mode: 'Markdown' });
    } catch (e) {
        await ctx.reply('Error deleting protein');
    }
});

bot.command('orders', async (ctx) => {
    try {
        const orders = await Order.find({ isArchived: { $ne: true } }).sort({ createdAt: -1 }).limit(10)
            .populate('items.product')
            .populate('items.proteins');

        if (orders.length === 0) {
            ctx.reply('No active orders found.');
            return;
        }

        let message = '📋 *Active Orders (Today)*\n\n';
        orders.forEach((order, index) => {
            let methodTag = '';
            if (order.deliveryMethod === 'pickup') {
                methodTag = `[PICKUP - ${order.pickupCode}]`;
            } else {
                methodTag = `[DELIVERY - ${order.deliveryCode || 'N/A'}]`;
            }
            message += `${index + 1}. *${order.customerName}* ${methodTag} - ₦${order.totalAmount.toLocaleString()}\n`;
            message += `   Status: ${order.status} | ID: \`${order._id}\`\n`;
            order.items.forEach((item: any) => {
                const proteinInfo = item.proteins && item.proteins.length > 0
                    ? ` (${item.proteins.map((p: any) => p.name).join(', ')})`
                    : '';
                message += `   • ${item.product?.name || 'Item'}${proteinInfo} x${item.quantity}\n`;
            });
            message += '\n';
        });

        message += '💡 _Run /clear_orders to reset this list for tomorrow._';
        ctx.replyWithMarkdown(message);
    } catch (error) {
        ctx.reply('Error fetching orders.');
    }
});

bot.command('clear_orders', async (ctx) => {
    try {
        const result = await Order.updateMany(
            { isArchived: { $ne: true } },
            { isArchived: true }
        );
        ctx.reply(`✅ Success! ${result.modifiedCount} orders moved to archives. Starting a fresh list for you! 🌅`);
    } catch (error) {
        ctx.reply('❌ Error clearing orders.');
    }
});

bot.command('history', async (ctx) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 }).limit(15)
            .populate('items.product')
            .populate('items.proteins');

        if (orders.length === 0) {
            ctx.reply('No order history found.');
            return;
        }

        let message = '📚 *Recent Order History*\n\n';
        orders.forEach((order, index) => {
            const methodTag = order.deliveryMethod === 'pickup' ? `[PICKUP]` : '[DELIVERY]';
            const archiveTag = order.isArchived ? '_(Archived)_' : '_(Active)_';
            message += `${index + 1}. *${order.customerName}* ${methodTag} ${archiveTag}\n`;
            message += `   ₦${order.totalAmount.toLocaleString()} | ${new Date(order.createdAt).toLocaleDateString()}\n\n`;
        });

        ctx.replyWithMarkdown(message);
    } catch (error) {
        ctx.reply('Error fetching history.');
    }
});

bot.command('menu', async (ctx) => {
    try {
        const products = await Product.find();
        const proteins = await Protein.find();

        let message = '🍽️ *Current Menu*\n\n';
        message += '*Products:*\n';
        products.forEach(p => {
            message += `• ${p.name} - ₦${p.price} [${p.isAvailable ? '✅' : '❌'}] \`/toggle_product_${p._id}\`\n`;
        });

        message += '\n*Proteins:*\n';
        proteins.forEach(p => {
            message += `• ${p.name} - ₦${p.price} [${p.isAvailable ? '✅' : '❌'}] \`/toggle_protein_${p._id}\`\n`;
        });

        ctx.replyWithMarkdown(message);
    } catch (error) {
        ctx.reply('Error fetching menu.');
    }
});

bot.hears(/^\/toggle_product_(.+)/, async (ctx) => {
    const productId = ctx.match[1].trim();
    try {
        const product = await Product.findById(productId);
        if (product) {
            product.isAvailable = !product.isAvailable;
            await product.save();
            ctx.reply(`✅ Updated *${product.name}* to ${product.isAvailable ? 'Available' : 'Unavailable'}`, { parse_mode: 'Markdown' });
        }
    } catch (e) {
        ctx.reply('Error toggling product');
    }
});

bot.hears(/^\/toggle_protein_(.+)/, async (ctx) => {
    const proteinId = ctx.match[1].trim();
    try {
        const protein = await Protein.findById(proteinId);
        if (protein) {
            protein.isAvailable = !protein.isAvailable;
            await protein.save();
            ctx.reply(`✅ Updated *${protein.name}* to ${protein.isAvailable ? 'Available' : 'Unavailable'}`, { parse_mode: 'Markdown' });
        }
    } catch (e) {
        ctx.reply('Error toggling protein');
    }
});

/**
 * Notify admin of a new order
 */
export const notifyNewOrder = async (order: any) => {
    try {
        const adminId = process.env.TELEGRAM_ADMIN_CHAT_ID;
        if (!adminId) {
            console.log('⚠️ TELEGRAM_ADMIN_CHAT_ID not set in .env. Skipping notification.');
            return;
        }

        let orderMessage = `🔔 *New Order Received!* [${order.deliveryMethod === 'pickup' ? 'PICKUP' : 'DELIVERY'}]\n\n`;
        orderMessage += `👤 *Customer:* ${order.customerName}\n`;
        orderMessage += `📞 *Phone:* ${order.phoneNumber}\n`;

        if (order.deliveryMethod === 'pickup') {
            orderMessage += `🔑 *Verification Code:* \`${order.pickupCode}\`\n`;
            orderMessage += `📍 *Location:* PICKUP @ ATMOS KITCHEN\n\n`;
        } else {
            orderMessage += `🔑 *Verification Code:* \`${order.deliveryCode}\`\n`;
            orderMessage += `📍 *Address:* ${order.address}\n\n`;
        }

        orderMessage += `🛒 *Items:*\n`;

        for (const item of order.items) {
            if (item.product) {
                orderMessage += `• ${item.product.name} x ${item.quantity} (₦${item.price.toLocaleString()})\n`;
            }
            if (item.proteins && item.proteins.length > 0) {
                orderMessage += `  _Proteins: ${item.proteins.join(', ')}_\n`;
            }
        }

        orderMessage += `\n💰 *Total Amount: ₦${order.totalAmount}*`;

        await bot.telegram.sendMessage(adminId, orderMessage, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error sending Telegram notification:', error);
    }
};

export const initTelegramBot = () => {
    bot.launch()
        .then(() => {
            console.log('🤖 Telegram Bot is running...');
        })
        .catch((err) => {
            console.error('❌ Failed to launch Telegram Bot:', err);
        });
};

export default bot;
