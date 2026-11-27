import express from 'express';
import {
    getCart,
    addCartItem,
    updateCartItemQty,
    removeCartItem,
    clearCart,
    createPaymentOrder,
    verifyPaymentAndNotify
} from '../controllers/cart.controller.js';

const router = express.Router();

// Cart management
router.get('/', getCart);
router.post('/add', addCartItem);
router.post('/update-qty', updateCartItemQty);
router.delete('/item/:deviceId', removeCartItem);
router.delete('/clear', clearCart);

// Gateway payment endpoints
router.post('/create-order', createPaymentOrder);
router.post('/verify-payment', verifyPaymentAndNotify);

export default router;