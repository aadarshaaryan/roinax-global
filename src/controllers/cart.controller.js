import crypto from 'crypto';
import Razorpay from 'razorpay';
import prisma from '../lib/prisma.js';
import { sendOrderEmail } from '../lib/mailer.js';
import { PRODUCTS_CATALOG } from '../config/products.js';

// Helper: Resolve userId across Google OAuth and Local Session formats
const getSessionUserId = (req) => {
    return req.session?.userId || req.session?.user?.id || null;
};

// Helper: Sanitize text before rendering into email HTML templates (XSS prevention)
const escapeHtml = (str) => {
    return String(str || '').replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
};

// Safe on-demand Razorpay instance with key sanitization
const getRazorpayClient = () => {
    const rawKeyId = process.env.RAZORPAY_KEY_ID;
    const rawSecret = process.env.RAZORPAY_KEY_SECRET;

    if (!rawKeyId || !rawSecret) {
        throw new Error('Razorpay credentials missing. Verify RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Render Environment.');
    }

    const key_id = String(rawKeyId).trim().replace(/^["']|["']$/g, '').replace(/[\r\n\t\s]/g, '');
    const key_secret = String(rawSecret).trim().replace(/^["']|["']$/g, '').replace(/[\r\n\t\s]/g, '');

    return {
        instance: new Razorpay({ key_id, key_secret }),
        key_id,
        key_secret
    };
};

// Helper: Format & dispatch twin emails via Gmail REST API
const dispatchOrderReceipts = async ({ customerEmail, shippingData, cartItems, grandTotal, subtotal, tax, paymentId, orderId }) => {
    const adminEmail = process.env.ADMIN_EMAIL || process.env.ADMIN_NOTIFICATION_EMAIL || process.env.GMAIL_USER;

    const safeFullName = escapeHtml(shippingData.fullName);
    const safeAddress = escapeHtml(shippingData.address);
    const safeCity = escapeHtml(shippingData.city);
    const safeState = escapeHtml(shippingData.state);
    const safePincode = escapeHtml(shippingData.pincode);
    const safePhone = escapeHtml(shippingData.phone);
    const safeGstin = shippingData.gstin ? escapeHtml(shippingData.gstin) : '';

    const itemsTableRows = cartItems.map((item, idx) => `
        <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #111827;">${idx + 1}. <strong>${escapeHtml(item.name)}</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: center; color: #374151;">${item.quantity || 1}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #111827;">₹${(Number(item.price) * (item.quantity || 1)).toLocaleString('en-IN')}</td>
        </tr>
    `).join('');

    const sharedSummaryHtml = `
        <table style="width: 100%; border-collapse: collapse; font-size: 0.92rem; margin: 16px 0;">
            <thead>
                <tr style="background-color: #f1f5f9; text-align: left;">
                    <th style="padding: 10px; color: #334155;">Product</th>
                    <th style="padding: 10px; text-align: center; color: #334155;">Qty</th>
                    <th style="padding: 10px; text-align: right; color: #334155;">Total</th>
                </tr>
            </thead>
            <tbody>${itemsTableRows}</tbody>
        </table>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 10px; text-align: right; font-size: 0.9rem; line-height: 1.6; color: #374151;">
            <div>Items Subtotal: <strong>₹${subtotal.toLocaleString('en-IN')}</strong></div>
            <div>GST (18% Statutory): <strong>₹${tax.toLocaleString('en-IN')}</strong></div>
            <div>Delivery / Shipping: <strong style="color: #53a922;">FREE</strong></div>
            <div style="font-size: 1.15rem; color: #151918; margin-top: 6px;">Total Paid: <strong style="color: #53a922;">₹${grandTotal.toLocaleString('en-IN')}</strong></div>
        </div>
    `;

    // 1. Customer Receipt Email
    const customerHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 650px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff;">
            <div style="border-bottom: 2px solid #53a922; padding-bottom: 12px; margin-bottom: 18px;">
                <h2 style="color: #151918; margin: 0;">ROINAX <span style="color: #53a922;">GLOBAL</span></h2>
                <p style="color: #4b5563; font-size: 0.95rem; margin: 4px 0 0;">Order & Payment Confirmation</p>
            </div>

            <p style="font-size: 0.95rem; color: #374151; line-height: 1.5;">
                Hello <strong>${safeFullName}</strong>,<br/>
                We have received your payment of <strong>₹${grandTotal.toLocaleString('en-IN')}</strong>. Your order is confirmed and will be dispatched to your shipping address.
            </p>

            <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px 16px; border-radius: 8px; margin: 16px 0; font-size: 0.88rem;">
                <p style="margin: 2px 0;"><strong>Payment ID:</strong> <code>${escapeHtml(paymentId)}</code></p>
                <p style="margin: 2px 0;"><strong>Order Reference:</strong> <code>${escapeHtml(orderId)}</code></p>
            </div>

            <h3 style="color: #111827; font-size: 1rem; margin-bottom: 6px;">Items Purchased:</h3>
            ${sharedSummaryHtml}

            <h3 style="color: #111827; font-size: 1rem; margin: 20px 0 6px;">Delivery Destination:</h3>
            <div style="background: #f9fafb; padding: 12px 16px; border-radius: 8px; font-size: 0.88rem; color: #374151; line-height: 1.5;">
                <strong>${safeFullName}</strong><br/>
                ${safeAddress}<br/>
                ${safeCity}, ${safeState} - ${safePincode}<br/>
                Contact: ${safePhone}
            </div>

            <p style="font-size: 0.8rem; color: #9ca3af; text-align: center; margin-top: 24px;">
                If you have questions regarding shipment dispatch, contact us at ${adminEmail || 'roinaxglobal@gmail.com'}.
            </p>
        </div>
    `;

    // 2. Store Owner / Admin Alert Email
    const adminHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 650px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff;">
            <div style="border-bottom: 2px solid #53a922; padding-bottom: 12px; margin-bottom: 18px;">
                <h2 style="color: #151918; margin: 0;">ROINAX <span style="color: #53a922;">GLOBAL</span></h2>
                <span style="background: #dcfce7; color: #15803d; padding: 4px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 700;">NEW PAID DISPATCH ORDER</span>
            </div>

            <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 0.9rem;">
                <p style="margin: 2px 0;"><strong>Paid Amount:</strong> <span style="color: #16a34a; font-weight: 800; font-size: 1.1rem;">₹${grandTotal.toLocaleString('en-IN')}</span></p>
                <p style="margin: 2px 0;"><strong>Customer Email:</strong> ${escapeHtml(customerEmail)}</p>
                <p style="margin: 2px 0;"><strong>Razorpay Payment ID:</strong> <code>${escapeHtml(paymentId)}</code></p>
            </div>

            <h3 style="color: #111827; font-size: 1rem; margin-bottom: 6px;">Customer & Shipping Address:</h3>
            <div style="background: #f9fafb; padding: 12px 16px; border-radius: 8px; font-size: 0.88rem; color: #374151; line-height: 1.5; margin-bottom: 16px;">
                <strong>Name:</strong> ${safeFullName}<br/>
                <strong>Phone:</strong> ${safePhone}<br/>
                <strong>Email:</strong> ${escapeHtml(customerEmail)}<br/>
                <strong>Full Address:</strong> ${safeAddress}, ${safeCity}, ${safeState} - ${safePincode}<br/>
                ${safeGstin ? `<strong>GSTIN:</strong> ${safeGstin}<br/>` : ''}
            </div>

            <h3 style="color: #111827; font-size: 1rem; margin-bottom: 6px;">Products to Dispatch:</h3>
            ${sharedSummaryHtml}
        </div>
    `;

    await sendOrderEmail({
        to: customerEmail,
        replyTo: adminEmail,
        subject: `Order Confirmed: ₹${grandTotal.toLocaleString('en-IN')} - ROINAX Global`,
        html: customerHtml,
    });

    if (adminEmail) {
        await sendOrderEmail({
            to: adminEmail,
            replyTo: customerEmail,
            subject: `[NEW ORDER] ₹${grandTotal.toLocaleString('en-IN')} from ${safeFullName}`,
            html: adminHtml,
        });
    }
};

// GET /api/cart
export const getCart = async (req, res) => {
    try {
        const userId = getSessionUserId(req);

        if (userId) {
            let cart = await prisma.cart.findUnique({
                where: { userId },
                include: { items: true }
            });

            if (!cart) {
                cart = await prisma.cart.create({
                    data: { userId },
                    include: { items: true }
                });
            }

            return res.status(200).json({
                success: true,
                items: cart.items || []
            });
        }

        const guestItems = Array.isArray(req.session?.cart) ? req.session.cart : [];
        return res.status(200).json({
            success: true,
            items: guestItems
        });
    } catch (error) {
        console.error('[CART_GET_ERROR]:', error);
        return res.status(500).json({ success: false, message: 'Server error retrieving cart.' });
    }
};

// POST /api/cart/add
export const addCartItem = async (req, res) => {
    try {
        const userId = getSessionUserId(req);
        const { deviceId, quantity = 1 } = req.body;

        if (!deviceId) {
            return res.status(400).json({ success: false, message: 'Product ID is required.' });
        }

        // Authoritative server lookup (ignores client prices and names completely)
        const product = PRODUCTS_CATALOG[String(deviceId)];
        if (!product) {
            return res.status(400).json({ success: false, message: 'Invalid or unknown product.' });
        }

        const itemPrice = Number(product.price);
        const itemName = product.name;
        const itemQty = Math.max(1, parseInt(quantity, 10) || 1);

        // A. Logged-in User (Supabase Postgres)
        if (userId) {
            const cart = await prisma.cart.upsert({
                where: { userId },
                update: {},
                create: { userId }
            });

            const existingItem = await prisma.cartItem.findFirst({
                where: {
                    cartId: cart.id,
                    deviceId: String(deviceId)
                }
            });

            let item;
            if (existingItem) {
                item = await prisma.cartItem.update({
                    where: { id: existingItem.id },
                    data: {
                        quantity: existingItem.quantity + itemQty,
                        price: itemPrice,
                        name: itemName
                    }
                });
            } else {
                item = await prisma.cartItem.create({
                    data: {
                        cartId: cart.id,
                        deviceId: String(deviceId),
                        productId: String(deviceId),
                        name: itemName,
                        price: itemPrice,
                        quantity: itemQty
                    }
                });
            }

            const updatedCart = await prisma.cart.findUnique({
                where: { id: cart.id },
                include: { items: true }
            });

            return res.status(200).json({
                success: true,
                items: updatedCart?.items || [item]
            });
        }

        // B. Guest User (PrismaSessionStore)
        if (!Array.isArray(req.session.cart)) {
            req.session.cart = [];
        }

        const existingIndex = req.session.cart.findIndex(i => i.deviceId === String(deviceId));
        if (existingIndex > -1) {
            req.session.cart[existingIndex].quantity += itemQty;
            req.session.cart[existingIndex].price = itemPrice;
            req.session.cart[existingIndex].name = itemName;
        } else {
            req.session.cart.push({
                deviceId: String(deviceId),
                name: itemName,
                price: itemPrice,
                quantity: itemQty
            });
        }

        req.session.save((err) => {
            if (err) {
                console.error('[GUEST_SESSION_SAVE_ERROR]:', err);
                return res.status(500).json({ success: false, message: 'Could not persist basket.' });
            }
            return res.status(200).json({ success: true, items: req.session.cart });
        });

    } catch (error) {
        console.error('[CART_ADD_ERROR]:', error);
        return res.status(500).json({ success: false, message: 'Failed to add item to basket.' });
    }
};

// POST /api/cart/update-qty
export const updateCartItemQty = async (req, res) => {
    try {
        const userId = getSessionUserId(req);
        const { deviceId, quantity } = req.body;
        const targetQty = parseInt(quantity, 10);

        if (userId) {
            const cart = await prisma.cart.findUnique({ where: { userId } });
            if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });

            if (targetQty <= 0) {
                await prisma.cartItem.deleteMany({
                    where: { cartId: cart.id, deviceId: String(deviceId) }
                });
            } else {
                const existing = await prisma.cartItem.findFirst({
                    where: { cartId: cart.id, deviceId: String(deviceId) }
                });
                if (existing) {
                    await prisma.cartItem.update({
                        where: { id: existing.id },
                        data: { quantity: targetQty }
                    });
                }
            }
            return res.status(200).json({ success: true });
        }

        if (!Array.isArray(req.session.cart)) req.session.cart = [];

        if (targetQty <= 0) {
            req.session.cart = req.session.cart.filter(i => i.deviceId !== String(deviceId));
        } else {
            const item = req.session.cart.find(i => i.deviceId === String(deviceId));
            if (item) item.quantity = targetQty;
        }

        req.session.save((err) => {
            if (err) return res.status(500).json({ success: false });
            return res.status(200).json({ success: true });
        });
    } catch (error) {
        console.error('[CART_UPDATE_QTY_ERROR]:', error);
        return res.status(500).json({ success: false, message: 'Update failed.' });
    }
};

// DELETE /api/cart/item/:deviceId
export const removeCartItem = async (req, res) => {
    try {
        const userId = getSessionUserId(req);
        const { deviceId } = req.params;

        if (userId) {
            const cart = await prisma.cart.findUnique({ where: { userId } });
            if (cart) {
                await prisma.cartItem.deleteMany({
                    where: { cartId: cart.id, deviceId: String(deviceId) }
                });
            }
            return res.status(200).json({ success: true });
        }

        if (Array.isArray(req.session?.cart)) {
            req.session.cart = req.session.cart.filter(i => i.deviceId !== String(deviceId));
            req.session.save((err) => {
                if (err) return res.status(500).json({ success: false });
                return res.status(200).json({ success: true });
            });
        } else {
            return res.status(200).json({ success: true });
        }
    } catch (error) {
        console.error('[CART_REMOVE_ERROR]:', error);
        return res.status(500).json({ success: false, message: 'Item removal failed.' });
    }
};

// DELETE /api/cart/clear
export const clearCart = async (req, res) => {
    try {
        const userId = getSessionUserId(req);

        if (userId) {
            const cart = await prisma.cart.findUnique({ where: { userId } });
            if (cart) {
                await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
            }
        }

        req.session.cart = [];
        req.session.save((err) => {
            if (err) return res.status(500).json({ success: false });
            return res.status(200).json({ success: true });
        });
    } catch (error) {
        console.error('[CART_CLEAR_ERROR]:', error);
        return res.status(500).json({ success: false, message: 'Failed to clear basket.' });
    }
};

// POST /api/cart/create-order
export const createPaymentOrder = async (req, res) => {
    try {
        const userId = getSessionUserId(req);
        let cartItems = [];

        if (userId) {
            const cart = await prisma.cart.findUnique({
                where: { userId },
                include: { items: true }
            });
            cartItems = cart?.items || [];
        } else {
            cartItems = req.session.cart || [];
        }

        if (cartItems.length === 0) {
            return res.status(400).json({ success: false, message: 'Your basket is currently empty.' });
        }

        // Always calculate subtotal against the authoritative server catalog
        const subtotal = cartItems.reduce((acc, item) => {
            const catalogItem = PRODUCTS_CATALOG[item.deviceId];
            const verifiedPrice = catalogItem ? catalogItem.price : Number(item.price);
            return acc + (verifiedPrice * (item.quantity || 1));
        }, 0);

        const tax = Math.round(subtotal * 0.18);
        const grandTotal = subtotal + tax;

        // Razorpay amounts must strictly be an integer in paise
        const totalPaise = Math.round(grandTotal * 100);

        if (totalPaise <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid payment amount.' });
        }

        const { instance: razorpay, key_id } = getRazorpayClient();

        const razorpayOrder = await razorpay.orders.create({
            amount: totalPaise,
            currency: 'INR',
            receipt: `rcpt_${Date.now().toString().slice(-8)}`,
        });

        return res.status(200).json({
            success: true,
            orderId: razorpayOrder.id,
            amount: razorpayOrder.amount,
            currency: razorpayOrder.currency,
            key: key_id
        });
    } catch (error) {
        console.error('[RAZORPAY_CREATE_ORDER_ERROR]:', {
            statusCode: error.statusCode,
            error: error.error,
            message: error.message
        });

        const clientMessage = error.statusCode === 401
            ? 'Gateway Authentication Failed: Please verify RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET.'
            : (error.error?.description || 'Could not initialize payment gateway.');

        return res.status(error.statusCode || 500).json({
            success: false,
            message: clientMessage
        });
    }
};

// POST /api/cart/verify-payment
export const verifyPaymentAndNotify = async (req, res) => {
    try {
        const userId = getSessionUserId(req);
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            shippingData
        } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !shippingData) {
            return res.status(400).json({ success: false, message: 'Missing payment verification parameters.' });
        }

        const { key_secret } = getRazorpayClient();

        // 1. Authenticate HMAC SHA256 Signature using constant-time comparison (prevents timing attacks)
        const body = `${razorpay_order_id}|${razorpay_payment_id}`;
        const expectedSignature = crypto
            .createHmac('sha256', key_secret)
            .update(body)
            .digest('hex');

        const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
        const clientBuffer = Buffer.from(razorpay_signature, 'utf8');

        if (expectedBuffer.length !== clientBuffer.length || !crypto.timingSafeEqual(expectedBuffer, clientBuffer)) {
            console.error('[SECURITY_ALERT] Invalid signature detected for payment:', razorpay_payment_id);
            return res.status(400).json({ success: false, message: 'Payment verification failed: invalid signature.' });
        }

        // 2. Retrieve Items and guarantee accurate names and prices
        let cartItems = [];
        if (userId) {
            const cart = await prisma.cart.findUnique({
                where: { userId },
                include: { items: true }
            });
            cartItems = cart?.items || [];
        } else {
            cartItems = req.session.cart || [];
        }

        // Ensure email displays verified catalog details
        const verifiedItems = cartItems.map(item => {
            const cat = PRODUCTS_CATALOG[item.deviceId];
            return {
                ...item,
                name: cat ? cat.name : item.name,
                price: cat ? cat.price : item.price
            };
        });

        const subtotal = verifiedItems.reduce((acc, item) => acc + (Number(item.price) * (item.quantity || 1)), 0);
        const tax = Math.round(subtotal * 0.18);
        const grandTotal = subtotal + tax;

        // 3. Dispatch separate notifications to customer and ADMIN_EMAIL
        await dispatchOrderReceipts({
            customerEmail: shippingData.email.trim().toLowerCase(),
            shippingData,
            cartItems: verifiedItems,
            grandTotal,
            subtotal,
            tax,
            paymentId: razorpay_payment_id,
            orderId: razorpay_order_id
        });

        // 4. Wipe Basket After Confirmed Payment
        if (userId) {
            const userCart = await prisma.cart.findUnique({ where: { userId } });
            if (userCart) {
                await prisma.cartItem.deleteMany({ where: { cartId: userCart.id } });
            }
        }

        req.session.cart = [];
        req.session.save((err) => {
            if (err) console.error('[POST_PAY_SESSION_SAVE_ERROR]:', err);
            return res.status(200).json({
                success: true,
                message: 'Payment verified and receipts dispatched.'
            });
        });

    } catch (error) {
        console.error('[PAYMENT_VERIFY_ERROR]:', error);
        return res.status(500).json({ success: false, message: 'Server error processing payment verification.' });
    }
};