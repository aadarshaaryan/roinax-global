import bcrypt from 'bcrypt';
import prisma from '../lib/prisma.js'; // Adjust path if your prisma client is in ../prisma.js or ../config/prisma.js

// GET /profile - Render profile page with user & cart data
export const getProfile = async (req, res) => {
  try {
    const userId = req.session.userId || req.session?.user?.id;
    if (!userId) {
      return res.redirect('/login');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        cart: {
          include: { items: true },
        },
      },
    });

    if (!user) {
      req.session.destroy();
      return res.redirect('/login');
    }

    // Compute cart badge count
    const cartCount = user.cart?.items?.reduce((sum, item) => sum + item.quantity, 0) || 0;

    res.render('profile', {
      user,
      cartCount,
      success_msg: req.flash ? req.flash('success_msg') : null,
      error_msg: req.flash ? req.flash('error_msg') : null,
    });
  } catch (error) {
    console.error('[ROINAX] Get Profile Error:', error);
    res.status(500).render('error', { message: 'Failed to load profile.' });
  }
};

// POST /profile/update - Update First Name, Last Name, DOB, Gender, Mobile No.
export const updateProfile = async (req, res) => {
  try {
    const userId = req.session.userId || req.session?.user?.id;
    if (!userId) return res.redirect('/login');

    const { firstName, lastName, phone, dob, gender } = req.body;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        firstName: firstName ? firstName.trim() : null,
        lastName: lastName ? lastName.trim() : null,
        phone: phone ? phone.trim() : null,
        dob: dob ? new Date(dob) : null,
        gender: gender || null,
      },
    });

    // Keep session user object fresh if used across middleware
    if (req.session.user) {
      req.session.user = { ...req.session.user, ...updatedUser };
    }

    if (req.flash) req.flash('success_msg', 'Personal details updated successfully.');
    res.redirect('/profile');
  } catch (error) {
    console.error('[ROINAX] Update Profile Error:', error);
    if (req.flash) req.flash('error_msg', 'Failed to update personal details.');
    res.redirect('/profile');
  }
};

// POST /profile/update-password - Secure password change under Session Security
export const updatePassword = async (req, res) => {
  try {
    const userId = req.session.userId || req.session?.user?.id;
    if (!userId) return res.redirect('/login');

    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      if (req.flash) req.flash('error_msg', 'New password must be at least 8 characters long.');
      return res.redirect('/profile');
    }

    if (newPassword !== confirmPassword) {
      if (req.flash) req.flash('error_msg', 'New passwords do not match.');
      return res.redirect('/profile');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    // If the account already has an active password, require verification of the current one
    if (user.password) {
      if (!currentPassword) {
        if (req.flash) req.flash('error_msg', 'Please enter your current password.');
        return res.redirect('/profile');
      }

      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        if (req.flash) req.flash('error_msg', 'Current password is incorrect.');
        return res.redirect('/profile');
      }
    }

    // Hash with 12 salt rounds
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    if (req.flash) req.flash('success_msg', 'Password updated successfully.');
    res.redirect('/profile');
  } catch (error) {
    console.error('[ROINAX] Update Password Error:', error);
    if (req.flash) req.flash('error_msg', 'Failed to update password.');
    res.redirect('/profile');
  }
};