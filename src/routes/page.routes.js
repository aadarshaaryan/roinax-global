import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import prisma from '../lib/prisma.js';
import { requireAuth, redirectIfAuth, ensureAuth } from '../middleware/auth.middleware.js';
import { uploadToCloudinary, extractPublicId, deleteFromCloudinary } from '../lib/cloudinary.js';

const router = Router();

// Multer memory storage configuration for 2MB avatar uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 }
});

// Public Views
router.get('/', (req, res) => {
    res.render('pages/index', {
        layout: 'layouts/base',
        title: 'ROINAX Global | End-to-End Business Solutions',
    });
});

router.get('/login', redirectIfAuth, (req, res) => {
    res.render('pages/login', {
        layout: 'layouts/auth-layout',
        title: 'Sign In | ROINAX Global',
    });
});

router.get('/signup', redirectIfAuth, (req, res) => {
    res.render('pages/signup', {
        layout: 'layouts/auth-layout',
        title: 'Create Account | ROINAX Global',
    });
});

router.get('/contact', (req, res) => {
    res.render('pages/contact', {
        layout: 'layouts/base',
        title: 'Contact Us | ROINAX GLOBAL',
        extraCss: '/css/contact.css'
    });
});

// Services Verticals
router.get('/services/logo-branding', (req, res) => {
    res.render('pages/logo-branding', {
        layout: 'layouts/base',
        title: 'Logo Design & Branding Solutions | ROINAX GLOBAL',
        extraCss: '/css/logo-branding.css'
    });
});

router.get('/services/web-ecommerce', (req, res) => {
    res.render('pages/web-ecommerce', {
        layout: 'layouts/base',
        title: 'Website Development & E-Commerce | ROINAX GLOBAL',
        extraCss: '/css/web-ecommerce.css'
    });
});

router.get('/services/domain-hosting', (req, res) => {
    res.render('pages/domain-hosting', {
        layout: 'layouts/base',
        title: 'Domain Registration & Hosting | ROINAX GLOBAL',
        extraCss: '/css/domain-hosting.css'
    });
});

router.get('/services/logistics-courier', (req, res) => {
    res.render('pages/logistics-courier', {
        layout: 'layouts/base',
        title: 'Global Logistics & Courier | ROINAX GLOBAL',
        extraCss: '/css/logistics-courier.css'
    });
});

router.get('/services/legal-compliance', (req, res) => {
    res.render('pages/legal-compliance', {
        layout: 'layouts/base',
        title: 'Legal & Compliance Documentation | ROINAX GLOBAL',
        extraCss: '/css/legal-compliance.css'
    });
});

router.get('/services/banking-insurance', (req, res) => {
    res.render('pages/banking-insurance', {
        layout: 'layouts/base',
        title: 'Business Banking & Insurance | ROINAX GLOBAL',
        extraCss: '/css/banking-insurance.css'
    });
});

router.get('/services/franchise-consulting', (req, res) => {
    res.render('pages/franchise-consulting', {
        layout: 'layouts/base',
        title: 'Franchise Strategy & Consulting | ROINAX GLOBAL',
        extraCss: '/css/franchise-consulting.css'
    });
});

router.get('/services/digital-marketing', (req, res) => {
    res.render('pages/digital-marketing', {
        layout: 'layouts/base',
        title: 'Digital Marketing & Growth | ROINAX GLOBAL',
        extraCss: '/css/digital-marketing.css'
    });
});

// Marketplace / Procurement
router.get('/buy-now', (req, res) => {
    res.render('pages/buy-now', {
        layout: 'layouts/base',
        title: 'Procure Enterprise Packages | ROINAX GLOBAL',
        extraCss: '/css/buy-now.css'
    });
});

// Authenticated User Profile (GET)
router.get('/profile', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId || req.session.user?.id;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                dob: true,
                gender: true,
                avatarUrl: true,
                password: true,
                createdAt: true,
                cart: {
                    include: { items: true }
                }
            }
        });

        if (!user) {
            req.session.destroy();
            return res.redirect('/login');
        }

        const cartCount = user.cart?.items?.reduce((sum, item) => sum + item.quantity, 0) || 0;

        res.render('pages/profile', {
            layout: 'layouts/base',
            title: 'User Profile | ROINAX GLOBAL',
            extraCss: '/css/profile.css',
            user,
            cartCount,
            success_msg: req.flash ? req.flash('success_msg') : null,
            error_msg: req.flash ? req.flash('error_msg') : null
        });
    } catch (err) {
        console.error('Profile route error:', err);
        res.redirect('/');
    }
});

// POST /profile/avatar - Cloudinary Avatar Upload
router.post('/profile/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
    try {
        const userId = req.session.userId || req.session.user?.id;

        if (!req.file) {
            if (req.flash) req.flash('error_msg', 'No file was chosen for upload.');
            return res.redirect('/profile');
        }

        const existingUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { avatarUrl: true }
        });

        if (existingUser?.avatarUrl) {
            const oldPublicId = extractPublicId(existingUser.avatarUrl);
            if (oldPublicId) {
                await deleteFromCloudinary(oldPublicId).catch(() => {});
            }
        }

        const uploadResult = await uploadToCloudinary(req.file.buffer, 'roinax_avatars');

        const updated = await prisma.user.update({
            where: { id: userId },
            data: { avatarUrl: uploadResult.secure_url }
        });

        if (req.session.user) {
            req.session.user.avatarUrl = updated.avatarUrl;
        }

        if (req.flash) req.flash('success_msg', 'Profile photo updated successfully.');
        res.redirect('/profile');
    } catch (err) {
        console.error('Avatar upload error:', err);
        if (req.flash) req.flash('error_msg', 'Failed to upload photo to Cloudinary.');
        res.redirect('/profile');
    }
});

// POST /profile/update - Update Personal Details
router.post('/profile/update', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId || req.session.user?.id;
        const { firstName, lastName, phone, dob, gender } = req.body;

        const updated = await prisma.user.update({
            where: { id: userId },
            data: {
                firstName: firstName ? firstName.trim() : null,
                lastName: lastName ? lastName.trim() : null,
                phone: phone ? phone.trim() : null,
                dob: dob ? new Date(dob) : null,
                gender: gender || null
            }
        });

        if (req.session.user) {
            req.session.user.firstName = updated.firstName;
            req.session.user.lastName = updated.lastName;
            req.session.user.name = `${updated.firstName || ''} ${updated.lastName || ''}`.trim() || updated.email;
        }

        if (req.flash) req.flash('success_msg', 'Personal details updated successfully.');
        res.redirect('/profile');
    } catch (err) {
        console.error('Update Profile Error:', err);
        if (req.flash) req.flash('error_msg', 'Failed to update personal details.');
        res.redirect('/profile');
    }
});

// POST /profile/update-password - Update Login Password
router.post('/profile/update-password', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId || req.session.user?.id;
        const { currentPassword, newPassword, confirmPassword } = req.body;

        if (!newPassword || newPassword.length < 8) {
            if (req.flash) req.flash('error_msg', 'Password must be at least 8 characters long.');
            return res.redirect('/profile');
        }

        if (newPassword !== confirmPassword) {
            if (req.flash) req.flash('error_msg', 'New passwords do not match.');
            return res.redirect('/profile');
        }

        const user = await prisma.user.findUnique({ where: { id: userId } });

        if (user.password) {
            if (!currentPassword) {
                if (req.flash) req.flash('error_msg', 'Current password is required.');
                return res.redirect('/profile');
            }
            const match = await bcrypt.compare(currentPassword, user.password);
            if (!match) {
                if (req.flash) req.flash('error_msg', 'Current password is incorrect.');
                return res.redirect('/profile');
            }
        }

        const hashedPassword = await bcrypt.hash(newPassword, 12);
        await prisma.user.update({
            where: { id: userId },
            data: { password: hashedPassword }
        });

        if (req.flash) req.flash('success_msg', 'Password updated successfully.');
        res.redirect('/profile');
    } catch (err) {
        console.error('Update Password Error:', err);
        if (req.flash) req.flash('error_msg', 'Failed to update password.');
        res.redirect('/profile');
    }
});

router.get('/cart', ensureAuth, (req, res) => {
    res.render('pages/cart', {
        title: 'Procurement Cart - ROINAX Global',
        user: req.session.user,
        layout: 'layouts/base',
        extraCss: '/css/cart.css'
    });
});

// Legal & Compliance Routes (Required by Razorpay)
router.get('/privacy-policy', (req, res) => {
    res.render('pages/privacy-policy', {
        title: 'Privacy Policy | ROINAX Global',
        extraCss: '/css/policies.css'
    });
});

router.get('/terms-and-conditions', (req, res) => {
    res.render('pages/terms-and-conditions', {
        title: 'Terms & Conditions | ROINAX Global',
        extraCss: '/css/policies.css'
    });
});

router.get('/refund-and-cancellation', (req, res) => {
    res.render('pages/refund-and-cancellation', {
        title: 'Refund & Cancellation Policy | ROINAX Global',
        extraCss: '/css/policies.css'
    });
});

router.get('/shipping-policy', (req, res) => {
    res.render('pages/shipping-policy', {
        title: 'Shipping & Delivery Policy | ROINAX Global',
        extraCss: '/css/policies.css'
    });
});

export default router;