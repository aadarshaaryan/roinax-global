import { Router } from 'express';
import { getProfile, updateProfile, updatePassword } from '../controllers/profile.controller.js';

const router = Router();

// Middleware: ensure user is logged in
const isAuthenticated = (req, res, next) => {
  if (req.session?.userId || req.session?.user?.id) {
    return next();
  }
  return res.redirect('/login');
};

router.get('/profile', isAuthenticated, getProfile);
router.post('/profile/update', isAuthenticated, updateProfile);
router.post('/profile/update-password', isAuthenticated, updatePassword);

export default router;