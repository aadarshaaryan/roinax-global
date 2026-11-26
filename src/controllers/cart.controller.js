import prisma from '../lib/prisma.js';

// GET /api/cart
export const getCart = async (req, res) => {
    try {
        const userId = req.session?.userId;

        // 1. If signed in, pull from Supabase
        if (userId) {
            const cart = await prisma.cart.findUnique({
                where: { userId },
                include: { items: true }
            });
            return res.status(200).json({ success: true, items: cart?.items || [] });
        }

        // 2. If guest, pull directly from Server Session
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

        // Scenario A: User is Signed In -> Save directly in Supabase
        if (userId) {
            const cart = await prisma.cart.upsert({
                where: { userId },
                update: {},
                create: { userId }
            });

            // Look up existing item by cartId & deviceId
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
                        quantity: existingItem.quantity + itemQty
                    }
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

        // Scenario B: User is a Guest -> Save in Express Server Session Memory
        if (!req.session.cart) {
            req.session.cart = [];
        }

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
            if (err) {
                return res.status(500).json({ success: false, message: 'Session save error' });
            }
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

        // Scenario A: Signed-in User
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

        // Scenario B: Guest Session User
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
        return res.status(500).json({ success: false, message: 'Update failed' });
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