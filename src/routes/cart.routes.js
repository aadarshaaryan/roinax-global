import express from 'express';
import {
    getCart,
    addCartItem,
    updateCartItemQty,
    removeCartItem,
    clearCart,
    submitBillingAndOrder
} from '../controllers/cart.controller.js';

const router = express.Router();

router.get('/', getCart);
router.post('/add', addCartItem);
router.post('/update-qty', updateCartItemQty);
router.delete('/item/:deviceId', removeCartItem);
router.delete('/clear', clearCart);
router.post('/submit-billing', submitBillingAndOrder);

export default router;