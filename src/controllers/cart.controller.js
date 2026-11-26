import prisma from '../lib/prisma.js';
import { sendOrderEmail } from '../lib/mailer.js';

// Helper: Dispatch Order & Billing Information Email via Gmail REST API
const sendOrderDetailsEmail = async ({ customerEmail, billingData, cartItems, grandTotal, subtotal, tax }) => {
    const itemsRows = cartItems.map((item, idx) => `
        <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #1f2937;">${idx + 1}. ${item.name}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: center; color: #1f2937;">${item.quantity || 1}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #1f2937;">₹${(Number(item.price) * (item.quantity || 1)).toLocaleString('en-IN')}</td>
        </tr>
    `).join('');

    const htmlContent = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 650px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff;">
            <div style="border-bottom: 2px solid #53a922; padding-bottom: 14px; margin-bottom: 20px;">
                <h2 style="color: #151918; margin: 0 0 4px 0;">ROINAX <span style="color: #53a922;">GLOBAL</span></h2>
                <p style="color: #4b5563; font-size: 0.95rem; margin: 0;">New Hardware Order & Billing Submission</p>
            </div>
            
            <h3 style="color: #111827; font-size: 1.05rem; margin-bottom: 10px;">Billing & Delivery Details</h3>
            <div style="background-color: #f9fafb; padding: 14px 18px; border-radius: 8px; margin-bottom: 20px; line-height: 1.6; font-size: 0.92rem; color: #374151;">
                <p style="margin: 0 0 6px 0;"><strong>Name / Enterprise:</strong> ${billingData.fullName}</p>
                <p style="margin: 0 0 6px 0;"><strong>Email:</strong> ${billingData.email}</p>
                <p style="margin: 0 0 6px 0;"><strong>Mobile:</strong> ${billingData.phone}</p>
                <p style="margin: 0 0 6px 0;"><strong>Delivery Address:</strong> ${billingData.address}, ${billingData.city}, ${billingData.state} - ${billingData.pincode}</p>
                ${billingData.gstin ? `<p style="margin: 0;"><strong>GSTIN:</strong> ${billingData.gstin}</p>` : ''}
            </div>

            <h3 style="color: #111827; font-size: 1.05rem; margin-bottom: 10px;">Order Summary</h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 0.92rem; margin-bottom: 20px;">
                <thead>
                    <tr style="background-color: #f3f4f6; text-align: left;">
                        <th style="padding: 10px; color: #374151;">Device / Package</th>
                        <th style="padding: 10px; text-align: center; color: #374151;">Qty</th>
                        <th style="padding: 10px; text-align: right; color: #374151;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsRows}
                </tbody>
            </table>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 12px; margin-bottom: 20px; text-align: right; font-size: 0.95rem; line-height: 1.7; color: #374151;">
                <div>Subtotal: <strong>₹${subtotal.toLocaleString('en-IN')}</strong></div>
                <div>Statutory GST (18%): <strong>₹${tax.toLocaleString('en-IN')}</strong></div>
                <div>Shipping: <strong style="color: #53a922;">FREE</strong></div>
                <div style="font-size: 1.2rem; color: #151918; margin-top: 6px;">Total Payable: <strong style="color: #53a922;">₹${grandTotal.toLocaleString('en-IN')}</strong></div>
            </div>

            <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 12px 16px; border-radius: 8px; font-size: 0.85rem; color: #166534;">
                Payment Method Selected: <strong>UPI QR Code (WASIM KARIM / rxw@pingpay)</strong>.<br/>
                UTR and payment receipt confirmation pending via WhatsApp dispatch desk.
            </div>
        </div>
    `;

    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.GMAIL_USER;
    const recipients = [adminEmail, customerEmail].filter(Boolean);

    await sendOrderEmail({
        to: recipients,
        replyTo: customerEmail,
        subject: `[Order Registered] Hardware Procurement - ${billingData.fullName}`,
        html: htmlContent,
    });
};

// GET /api/cart
export const getCart = async (req, res) => {
    try {
        const userId = req.session?.userId;

        if (userId) {
            const cart = await prisma.cart.findUnique({
                where: { userId },
                include: { items: true }
            });
            return res.status(200).json({ success: true, items: cart?.items || [] });
        }

        const guestItems = req.session.cart || [];
        return res.status(200).json({ success: true, items: guestItems });
    } catch (error) {
        console.error('Error fetching cart:', error);
        return res.status(500).json({ success: false, message: 'Server error retrieving cart.' });
    }
};

// POST /api/cart/add
export const addCartItem = async (req, res) => {
    try {
        const userId = req.session?.userId;
        const { deviceId, name, price, quantity = 1 } = req.body;

        if (!deviceId || !name || price === undefined) {
            return res.status(400).json({ success: false, message: 'Invalid product details.' });
        }

        const itemPrice = Number(price);
        const itemQty = Number(quantity);

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
                    data: { quantity: existingItem.quantity + itemQty }
                });
            } else {
                item = await prisma.cartItem.create({
                    data: {
                        cartId: cart.id,
                        deviceId: String(deviceId),
                        name: String(name),
                        price: itemPrice,
                        quantity: itemQty
                    }
                });
            }

            return res.status(200).json({ success: true, item });
        }

        if (!req.session.cart) req.session.cart = [];

        const existingIndex = req.session.cart.findIndex(i => i.deviceId === String(deviceId));
        if (existingIndex > -1) {
            req.session.cart[existingIndex].quantity += itemQty;
        } else {
            req.session.cart.push({
                deviceId: String(deviceId),
                name: String(name),
                price: itemPrice,
                quantity: itemQty
            });
        }

        req.session.save((err) => {
            if (err) return res.status(500).json({ success: false, message: 'Session save error.' });
            return res.status(200).json({ success: true, items: req.session.cart });
        });
    } catch (error) {
        console.error('Error adding item to cart:', error);
        return res.status(500).json({ success: false, message: 'Could not add item to basket.' });
    }
};

// POST /api/cart/update-qty
export const updateCartItemQty = async (req, res) => {
    try {
        const userId = req.session?.userId;
        const { deviceId, quantity } = req.body;
        const targetQty = Number(quantity);

        if (userId) {
            const cart = await prisma.cart.findUnique({ where: { userId } });
            if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });

            if (targetQty <= 0) {
                await prisma.cartItem.deleteMany({
                    where: { cartId: cart.id, deviceId: String(deviceId) }
                });
            } else {
                const existingItem = await prisma.cartItem.findFirst({
                    where: { cartId: cart.id, deviceId: String(deviceId) }
                });

                if (existingItem) {
                    await prisma.cartItem.update({
                        where: { id: existingItem.id },
                        data: { quantity: targetQty }
                    });
                }
            }
            return res.status(200).json({ success: true });
        }

        if (!req.session.cart) req.session.cart = [];

        if (targetQty <= 0) {
            req.session.cart = req.session.cart.filter(i => i.deviceId !== String(deviceId));
        } else {
            const item = req.session.cart.find(i => i.deviceId === String(deviceId));
            if (item) item.quantity = targetQty;
        }

        req.session.save(() => res.status(200).json({ success: true }));
    } catch (error) {
        console.error('Error updating cart quantity:', error);
        return res.status(500).json({ success: false, message: 'Update failed.' });
    }
};

// DELETE /api/cart/item/:deviceId
export const removeCartItem = async (req, res) => {
    try {
        const userId = req.session?.userId;
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

        if (req.session.cart) {
            req.session.cart = req.session.cart.filter(i => i.deviceId !== String(deviceId));
            req.session.save(() => res.status(200).json({ success: true }));
        } else {
            res.status(200).json({ success: true });
        }
    } catch (error) {
        console.error('Error removing cart item:', error);
        return res.status(500).json({ success: false, message: 'Item removal failed.' });
    }
};

// DELETE /api/cart/clear
export const clearCart = async (req, res) => {
    try {
        const userId = req.session?.userId;
        if (userId) {
            const cart = await prisma.cart.findUnique({ where: { userId } });
            if (cart) {
                await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
            }
        }
        req.session.cart = [];
        req.session.save(() => res.status(200).json({ success: true }));
    } catch (error) {
        console.error('Error clearing cart:', error);
        return res.status(500).json({ success: false, message: 'Failed to clear cart.' });
    }
};

// POST /api/cart/submit-billing
export const submitBillingAndOrder = async (req, res) => {
    try {
        const userId = req.session?.userId;
        const { fullName, email, phone, address, city, state, pincode, gstin } = req.body;

        if (!fullName || !email || !phone || !address || !city || !state || !pincode) {
            return res.status(400).json({ success: false, message: 'Please provide all required billing fields.' });
        }

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

        const subtotal = cartItems.reduce((acc, item) => acc + (Number(item.price) * (item.quantity || 1)), 0);
        const tax = Math.round(subtotal * 0.18);
        const grandTotal = subtotal + tax;

        await sendOrderDetailsEmail({
            customerEmail: email.trim().toLowerCase(),
            billingData: { fullName, email, phone, address, city, state, pincode, gstin },
            cartItems,
            grandTotal,
            subtotal,
            tax
        });

        return res.status(200).json({ success: true, message: 'Billing details received. Proceed to QR payment.' });
    } catch (error) {
        console.error('Error submitting billing details:', error);
        return res.status(500).json({ success: false, message: 'Failed to dispatch billing notification email.' });
    }
};