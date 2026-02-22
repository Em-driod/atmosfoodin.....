import { Telegraf, Scenes, session, Markup, Context } from 'telegraf';
import Product from '../models/Product';
import Protein from '../models/Protein';
import Order from '../models/Order';
import { cloudinary } from '../config/cloudinary';
import mongoose from 'mongoose';
import { cacheHelpers } from '../utils/cache';
import * as https from 'https';

// Validate required environment variables
if (!process.env.TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
}

/**
 * Helper function to escape markdown special characters
 */
const escapeMarkdown = (text: string) => {
    return text.replace(/[*_`[\]()~>#+=|{}.!-]/g, '\\$&');
};

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

type MyContext = Context & {
    match: RegExpMatchArray;
    scene: Scenes.SceneContextScene<MyContext, MyWizardSession>;
    wizard: Scenes.WizardContextWizard<MyContext>;
};

type BotContext = Context & {
    match: RegExpMatchArray;
};

const bot = new Telegraf<MyContext>(process.env.TELEGRAM_BOT_TOKEN as string, {
    telegram: {
        apiRoot: 'https://api.telegram.org',
        agent: new https.Agent({
            keepAlive: true,
            keepAliveMsecs: 10000,
        })
    }
});

// --- Product Wizard ---
const productWizard = new Scenes.WizardScene<MyContext>(
    'ADD_PRODUCT_WIZARD',
    // Step 1: Name
    async (ctx: MyContext) => {
        (ctx.wizard.state as any).productData = { proteins: [] };
        await safeReply(ctx, '📝 Enter the product name:');
        return ctx.wizard.next();
    },
    // Step 2: Description
    async (ctx: MyContext) => {
        if (!ctx.message || !('text' in ctx.message)) return safeReply(ctx, 'Please enter a valid text.');
        (ctx.wizard.state as any).productData.name = ctx.message.text;
        await safeReply(ctx, '📄 Enter the product description:');
        return ctx.wizard.next();
    },
    // Step 3: Price
    async (ctx: MyContext) => {
        if (!ctx.message || !('text' in ctx.message)) return safeReply(ctx, 'Please enter a valid text.');
        (ctx.wizard.state as any).productData.description = ctx.message.text;
        await safeReply(ctx, '💰 Enter the price (number only):');
        return ctx.wizard.next();
    },
    // Step 4: Category
    async (ctx: MyContext) => {
        if (!ctx.message || !('text' in ctx.message)) return safeReply(ctx, 'Please enter a valid text.');
        const price = parseFloat(ctx.message.text);
        if (isNaN(price)) return safeReply(ctx, 'Please enter a valid number for price.');
        (ctx.wizard.state as any).productData.price = price;
        await safeReply(ctx, '📁 Select Category:', Markup.keyboard([['Grains', 'Drinks']]).oneTime().resize());
        return ctx.wizard.next();
    },
    // Step 5: Protein Selection (if Grains) or jump to Image
    async (ctx: MyContext) => {
        if (!ctx.message || !('text' in ctx.message)) return safeReply(ctx, 'Please enter a valid text.');
        const category = ctx.message.text as any;
        if (category !== 'Grains' && category !== 'Drinks') return safeReply(ctx, 'Please choose either Grains or Drinks.');
        (ctx.wizard.state as any).productData.category = category;

        if (category === 'Grains') {
            const proteins = await Protein.find({ isAvailable: true });
            if (proteins.length === 0) {
                await safeReply(ctx, 'No proteins found. Skipping to image.');
                await safeReply(ctx, '🖼️ Send a photo or a direct image URL:', Markup.removeKeyboard());
                return ctx.wizard.selectStep(5);
            }

            const keyboard = proteins.map(p => [Markup.button.callback(`➕ ${p.name}`, `toggle_wizard_prot_${p._id}`)]);
            keyboard.push([Markup.button.callback('✅ DONE', 'finish_proteins')]);

            await safeReply(ctx, '🍗 Select available proteins (optional):', Markup.inlineKeyboard(keyboard));
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
                await safeReply(ctx, '🖼️ Send a photo or a direct image URL:');
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
                
                await safeReply(ctx, `✅ Product *${escapeMarkdown(name)}* added successfully!`, { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } });
                return ctx.scene.leave();
            } catch (error) {
                console.error('Error adding product:', error);
                await safeReply(ctx, '❌ error adding product. Try again.');
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
        await safeReply(ctx, '📝 Enter the protein name (e.g., Beef, Chicken):');
        return ctx.wizard.next();
    },
    // Step 2: Price
    async (ctx: MyContext) => {
        if (!ctx.message || !('text' in ctx.message)) return safeReply(ctx, 'Please enter a valid text.');
        (ctx.wizard.state as any).proteinData.name = ctx.message.text;
        await safeReply(ctx, '💰 Enter the price:');
        return ctx.wizard.next();
    },
    // Step 3: Finalize
    async (ctx: MyContext) => {
        if (!ctx.message || !('text' in ctx.message)) return safeReply(ctx, 'Please enter a valid text.');
        const price = parseFloat(ctx.message.text);
        if (isNaN(price)) return safeReply(ctx, 'Please enter a valid number.');

        try {
            const newProtein = new Protein({
                name: (ctx.wizard.state as any).proteinData.name,
                price,
                isAvailable: true
            });
            await newProtein.save();
            
            // Invalidate cache when new protein is added
            cacheHelpers.invalidateProteins();
            
            await safeReply(ctx, `✅ Protein *${escapeMarkdown(newProtein.name)}* added!`, { parse_mode: 'Markdown' });
            return ctx.scene.leave();
        } catch (error) {
            await safeReply(ctx, '❌ Error adding protein.');
            return ctx.scene.leave();
        }
    }
);

const stage = new Scenes.Stage<MyContext>([productWizard, proteinWizard]);
bot.use(session());
bot.use(stage.middleware());

/**
 * Safe reply wrapper to handle Telegram API errors
 */
const safeReply = async (ctx: MyContext, text: string, extra?: any) => {
    try {
        await ctx.reply(text, extra);
    } catch (error: any) {
        console.log(`🤖 Telegram reply error: ${error.message}`);
        // Try without formatting if Markdown error
        if (error.message.includes('parse') && extra?.parse_mode) {
            try {
                await ctx.reply(text, { ...extra, parse_mode: undefined });
            } catch (fallbackError: any) {
                console.log(`🤖 Telegram fallback reply error: ${fallbackError.message}`);
            }
        }
    }
};

/**
 * Safe edit message wrapper to handle Telegram API errors
 */
const safeEditMessage = async (ctx: MyContext, text: string, extra?: any) => {
    try {
        await ctx.editMessageText(text, extra);
    } catch (error: any) {
        console.log(`🤖 Telegram edit message error: ${error.message}`);
        // Try without formatting if Markdown error
        if (error.message.includes('parse') && extra?.parse_mode) {
            try {
                await ctx.editMessageText(text, { ...extra, parse_mode: undefined });
            } catch (fallbackError: any) {
                console.log(`🤖 Telegram fallback edit error: ${fallbackError.message}`);
            }
        }
    }
};

/**
 * Wrapper for bot commands to handle errors gracefully
 */
const safeCommandHandler = (handler: (ctx: MyContext) => Promise<void> | void) => {
    return async (ctx: MyContext) => {
        try {
            await handler(ctx);
        } catch (error: any) {
            console.log(`🤖 Bot command error: ${error.message}`);
            // Try to send a simple error message without formatting
            try {
                await ctx.reply('❌ An error occurred. Please try again.');
            } catch (replyError: any) {
                console.log(`🤖 Failed to send error message: ${replyError.message}`);
            }
        }
    };
};

/**
 * Global bot error handler to prevent crashes
 */
bot.catch((err: any, ctx) => {
    console.log(`🤖 Global bot error: ${err.message}`);
    // Don't let bot errors crash the server
});

// Basic Commands
bot.start(safeCommandHandler(async (ctx) => {
    await safeReply(ctx, '👋 Welcome to Atmos Food Admin Bot!\n\nCommands:\n/menu - View/manage menu\n/orders - View recent orders\n/history - View order history\n/add_product - Add item\n/add_protein - Add protein\n/delete_product - Delete item\n/delete_protein - Delete protein\n/clear_orders - Archive today\'s orders');
}));

bot.help(safeCommandHandler(async (ctx) => {
    await safeReply(ctx, '👋 Welcome to Atmos Food Admin Bot!\n\nCommands:\n/menu - View current menu\n/orders - View recent orders\n/history - View order history\n/add_product - Add a new item\n/add_protein - Add a new protein\n/delete_product - Remove a product\n/delete_protein - Remove a protein\n/clear_orders - Archive today\'s orders\n/clearcache - Clear website cache instantly\n\n✨ Use /clearcache for instant updates!');
}));

bot.command('add_product', safeCommandHandler(async (ctx) => {
    await ctx.scene.enter('ADD_PRODUCT_WIZARD');
}));
bot.command('add_protein', safeCommandHandler(async (ctx) => {
    await ctx.scene.enter('ADD_PROTEIN_WIZARD');
}));

bot.command('delete_product', safeCommandHandler(async (ctx) => {
    const products = await Product.find();
    if (products.length === 0) {
        await safeReply(ctx, 'No products to delete.');
        return;
    }
    const keyboard = products.map(p => [Markup.button.callback(`🗑️ ${p.name}`, `del_prod_${p._id.toString()}`)]);
    await safeReply(ctx, 'Select a product to DELETE PERMANENTLY:', Markup.inlineKeyboard(keyboard));
}));

bot.command('delete_protein', safeCommandHandler(async (ctx) => {
    const proteins = await Protein.find();
    if (proteins.length === 0) {
        await safeReply(ctx, 'No proteins to delete.');
        return;
    }
    const keyboard = proteins.map(p => [Markup.button.callback(`🗑️ ${p.name}`, `del_prot_${p._id.toString()}`)]);
    await safeReply(ctx, 'Select a protein to DELETE PERMANENTLY:', Markup.inlineKeyboard(keyboard));
}));

bot.action(/^del_prod_(.+)/, safeCommandHandler(async (ctx) => {
    const id = ctx.match[1];
    const product = await Product.findByIdAndDelete(id);
    await ctx.answerCbQuery();
    await safeEditMessage(ctx, `🗑️ Deleted product: *${escapeMarkdown(product?.name || '')}*`, { parse_mode: 'Markdown' });
}));

bot.action(/^del_prot_(.+)/, safeCommandHandler(async (ctx) => {
    const id = ctx.match[1];
    const protein = await Protein.findByIdAndDelete(id);
    await ctx.answerCbQuery();
    await safeEditMessage(ctx, `🗑️ Deleted protein: *${escapeMarkdown(protein?.name || '')}*`, { parse_mode: 'Markdown' });
}));

bot.command('orders', safeCommandHandler(async (ctx) => {
    const orders = await Order.find({ isArchived: { $ne: true } }).sort({ createdAt: -1 }).limit(10)
        .populate('items.product')
        .populate('items.proteins');

    if (orders.length === 0) {
        await safeReply(ctx, 'No active orders found.');
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
    await safeReply(ctx, message, { parse_mode: 'Markdown' });
}));

bot.command('clear_orders', safeCommandHandler(async (ctx) => {
    const result = await Order.updateMany(
        { isArchived: { $ne: true } },
        { isArchived: true }
    );
    await safeReply(ctx, `✅ Success! ${result.modifiedCount} orders moved to archives. Starting a fresh list for you! 🌅`);
}));

bot.command('history', safeCommandHandler(async (ctx) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 }).limit(15)
            .populate('items.product')
            .populate('items.proteins');

        if (orders.length === 0) {
            await safeReply(ctx, 'No order history found.');
            return;
        }

        let message = '📚 *Recent Order History*\n\n';
        orders.forEach((order, index) => {
            const methodTag = order.deliveryMethod === 'pickup' ? '[PICKUP]' : '[DELIVERY]';
            const archiveTag = order.isArchived ? '_(Archived)_' : '_(Active)_';
            message += `${index + 1}. *${order.customerName}* ${methodTag} ${archiveTag}\n`;
            message += `   ₦${order.totalAmount.toLocaleString()} | ${new Date(order.createdAt).toLocaleDateString()}\n\n`;
        });

        await safeReply(ctx, message, { parse_mode: 'Markdown' });
    } catch (error) {
        await safeReply(ctx, 'Error fetching history.');
    }
}));

bot.command('clearcache', safeCommandHandler(async (ctx) => {
    cacheHelpers.clearAll();
    await safeReply(ctx, '🗑️ Cache cleared successfully!\n\n✨ All updates will appear instantly on the website!\n🔄 Tell users to refresh if needed.');
}));

bot.command('menu', safeCommandHandler(async (ctx) => {
    const products = await Product.find();
    const proteins = await Protein.find();

    let message = '🍽️ *Current Menu*\n\n';
    message += '*Products:*\n';
    products.forEach(p => {
        message += `• ${escapeMarkdown(p.name)} - ₦${p.price} [${p.isAvailable ? '✅' : '❌'}] \`/toggle_product_${p._id}\`\n`;
    });

    message += '\n*Proteins:*\n';
    proteins.forEach(p => {
        message += `• ${escapeMarkdown(p.name)} - ₦${p.price} [${p.isAvailable ? '✅' : '❌'}] \`/toggle_protein_${p._id}\`\n`;
    });

    await safeReply(ctx, message, { parse_mode: 'Markdown' });
}));

bot.hears(/^\/toggle_product_(.+)/, safeCommandHandler(async (ctx) => {
    const productId = ctx.match[1].trim();
    const product = await Product.findById(productId);
    if (product) {
        product.isAvailable = !product.isAvailable;
        await product.save();
        await safeReply(ctx, `✅ Updated *${escapeMarkdown(product.name)}* to ${product.isAvailable ? 'Available' : 'Unavailable'}`, { parse_mode: 'Markdown' });
    }
}));

bot.hears(/^\/toggle_protein_(.+)/, safeCommandHandler(async (ctx) => {
    const proteinId = ctx.match[1].trim();
    const protein = await Protein.findById(proteinId);
    if (protein) {
        protein.isAvailable = !protein.isAvailable;
        await protein.save();
        await safeReply(ctx, `✅ Updated *${escapeMarkdown(protein.name)}* to ${protein.isAvailable ? 'Available' : 'Unavailable'}`, { parse_mode: 'Markdown' });
    }
}));

/**
 * Retry wrapper for Telegram API calls with timeout and retry logic
 */
export const telegramApiCallWithRetry = async (
    apiCall: () => Promise<any>,
    maxRetries: number = 3,
    baseDelay: number = 1000
): Promise<any> => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Add timeout to the API call
            const result = await Promise.race([
                apiCall(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Telegram API timeout')), 25000)
                )
            ]);
            return result;
        } catch (error: any) {
            const isLastAttempt = attempt === maxRetries;
            const shouldRetry = error.code === 'ETIMEDOUT' || 
                              error.message.includes('timeout') ||
                              error.message.includes('ETIMEDOUT') ||
                              error.code === 'ECONNRESET' ||
                              error.code === 'ENOTFOUND' ||
                              error.message.includes('parse'); // Also retry on parse errors
            
            if (isLastAttempt || !shouldRetry) {
                // Log silently without crashing
                console.log(`🤖 Telegram API failed after ${attempt} attempt(s): ${error.message}`);
                // Return a safe default instead of throwing to prevent crashes
                return { ok: false, error: error.message };
            }
            
            // Exponential backoff
            const delay = baseDelay * Math.pow(2, attempt - 1);
            console.log(`🤖 Telegram API attempt ${attempt} failed, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
};

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
                orderMessage += `• ${escapeMarkdown(item.product.name)} x ${item.quantity} (₦${item.price.toLocaleString()})\n`;
            }
            if (item.proteins && item.proteins.length > 0) {
                orderMessage += `  _Proteins: ${item.proteins.map(p => escapeMarkdown(p.name || p)).join(', ')}_\n`;
            }
        }

        orderMessage += `\n💰 *Total Amount: ₦${order.totalAmount}*`;

        const result = await telegramApiCallWithRetry(
            () => bot.telegram.sendMessage(adminId, orderMessage, { parse_mode: 'Markdown' })
        );
        
        // If the API call failed, try without Markdown formatting
        if (!result.ok && result.error?.includes('parse')) {
            console.log('🤖 Retrying notification without Markdown formatting');
            await telegramApiCallWithRetry(
                () => bot.telegram.sendMessage(adminId, orderMessage.replace(/\*([^*]+)\*/g, '$1').replace(/_([^_]+)_/g, '$1'))
            );
        }
    } catch (error: any) {
        // Silent logging - never crash the server
        console.log(`🤖 Failed to send Telegram notification: ${error.message}`);
        // Optionally, you could add fallback notification method here
    }
};

export const initTelegramBot = () => {
    let retryCount = 0;
    const maxRetries = 10; // Stop after 10 failed attempts
    
    const startBot = async () => {
        try {
            // First validate the token by making a simple API call
            console.log('🤖 Validating Telegram bot token...');
            const botInfo = await bot.telegram.getMe();
            console.log(`✅ Bot validated: @${botInfo.username}`);
            
            const result = await telegramApiCallWithRetry(
                () => bot.launch(),
                5, // More retries for bot startup
                2000 // Longer base delay for startup
            );
            
            if (result.ok !== false) {
                console.log('🤖 Telegram Bot is running...');
            } else {
                console.log('🤖 Telegram Bot startup failed, retrying...');
                throw new Error(result.error || 'Bot startup failed');
            }
        } catch (error: any) {
            console.log(`🤖 Failed to start Telegram Bot: ${error.message}`);
            
            // Provide specific error guidance
            if (error.code === 'ENOTFOUND' || error.message.includes('getaddrinfo')) {
                console.log('❌ Network Error: Cannot resolve Telegram API. Check your internet connection.');
            } else if (error.code === 401 || error.message.includes('Unauthorized')) {
                console.log('❌ Auth Error: Invalid Telegram bot token. Check your TELEGRAM_BOT_TOKEN in .env');
            } else if (error.code === 'ETIMEDOUT') {
                console.log('❌ Timeout Error: Connection to Telegram API timed out. Try again later.');
            } else {
                console.log(`❌ Unknown Error: ${error.code || 'No code'} - ${error.message}`);
            }
            
            retryCount++;
            if (retryCount >= maxRetries) {
                console.log(`❌ Telegram Bot failed to start after ${maxRetries} attempts. Giving up.`);
                console.log('🔧 Check: 1) Internet connection 2) Bot token validity 3) Firewall settings');
                return; // Stop retrying
            }
            
            console.log('🔄 Will retry bot startup in 30 seconds...');
            // Retry bot startup after 30 seconds
            setTimeout(startBot, 30000);
        }
    };

    startBot();

    // Graceful shutdown
    process.once('SIGINT', () => {
        try {
            bot.stop('SIGINT');
            console.log('🤖 Telegram Bot stopped (SIGINT)');
        } catch (error: any) {
            console.log(`🤖 Error stopping bot: ${error.message}`);
        }
    });
    
    process.once('SIGTERM', () => {
        try {
            bot.stop('SIGTERM');
            console.log('🤖 Telegram Bot stopped (SIGTERM)');
        } catch (error: any) {
            console.log(`🤖 Error stopping bot: ${error.message}`);
        }
    });
};

export default bot;
