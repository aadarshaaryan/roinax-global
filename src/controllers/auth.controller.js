import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import prisma from '../lib/prisma.js';
import { sendOtpEmail } from '../lib/mailer.js';
import { uploadToCloudinary, extractPublicId, deleteFromCloudinary } from '../lib/cloudinary.js';

// Helper: Format a unified display name from firstName and lastName
const getDisplayName = (user) => {
  if (!user) return 'User';
  const full = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  return full || (user.email ? user.email.split('@')[0] : 'User');
};

// Helper: Dynamically get OAuth2Client configured for User Login/Signup
const getGoogleClient = (req) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  const dynamicCallbackUrl = `${protocol}://${host}/api/auth/google/callback`;

  const callbackUrl = process.env.GOOGLE_OAUTH_CALLBACK_URL || dynamicCallbackUrl;
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;

  const client = new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri: callbackUrl,
  });

  return { client, callbackUrl, clientId };
};

// Helper: 6-Digit Numeric OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Helper: Merge guest session items into Supabase user cart
const migrateGuestCart = async (userId, guestCart) => {
  if (!Array.isArray(guestCart) || guestCart.length === 0) return;

  const cart = await prisma.cart.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });

  for (const item of guestCart) {
    const devId = item.deviceId || item.id;
    if (!devId) continue;

    // Use findFirst or upsert without composite unique assumption
    const existingItem = await prisma.cartItem.findFirst({
      where: {
        cartId: cart.id,
        deviceId: String(devId),
      },
    });

    if (existingItem) {
      await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: {
          quantity: existingItem.quantity + Number(item.quantity || item.qty || 1),
        },
      });
    } else {
      await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          deviceId: String(devId),
          name: String(item.name || 'Hardware Device'),
          price: Number(item.price || 0),
          quantity: Number(item.quantity || item.qty || 1),
        },
      });
    }
  }
};

// ==========================================
// 1. STANDARD CREDENTIALS AUTHENTICATION
// ==========================================

// POST /api/auth/login
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required.',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !user.password) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    // Merge guest cart
    const guestItems = req.session.cart || [];
    await migrateGuestCart(user.id, guestItems);
    req.session.cart = [];

    const displayName = getDisplayName(user);

    req.session.userId = user.id;
    req.session.user = {
      id: user.id,
      name: displayName,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      avatarUrl: user.avatarUrl || null,
    };

    req.session.save((err) => {
      if (err) {
        console.error('Session save error on login:', err);
        return res.status(500).json({ success: false, message: 'Failed to establish session.' });
      }

      return res.status(200).json({
        success: true,
        message: 'Signed in successfully.',
        redirectUrl: '/',
      });
    });
  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during authentication.',
    });
  }
};

// POST /api/auth/logout
export const logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err);
      return res.redirect('/profile');
    }

    res.clearCookie('roinax_sid', { path: '/' });

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(200).json({ success: true, redirectUrl: '/login' });
    }

    return res.redirect('/login');
  });
};

// ==========================================
// 2. EMAIL OTP REGISTRATION FLOW
// ==========================================

// POST /api/auth/send-signup-otp
export const sendSignupOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.otp.deleteMany({ where: { email: normalizedEmail, type: 'SIGNUP' } });
    await prisma.otp.create({
      data: { email: normalizedEmail, code, type: 'SIGNUP', expiresAt },
    });

    await sendOtpEmail(normalizedEmail, code, 'Account Registration');
    return res.status(200).json({ success: true, message: 'Verification OTP sent to your email.' });
  } catch (error) {
    console.error('Send Signup OTP Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to dispatch verification code.' });
  }
};

// POST /api/auth/verify-signup-otp
export const verifySignupOtp = async (req, res) => {
  try {
    const { name, firstName, lastName, email, password, otp } = req.body;
    if (!email || !password || !otp) {
      return res.status(400).json({ success: false, message: 'All registration fields are required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const record = await prisma.otp.findFirst({
      where: {
        email: normalizedEmail,
        code: String(otp).trim(),
        type: 'SIGNUP',
        expiresAt: { gt: new Date() },
      },
    });

    if (!record) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP code.' });
    }

    // Parse single name string if separate first/last name were not provided
    let finalFirstName = firstName ? firstName.trim() : '';
    let finalLastName = lastName ? lastName.trim() : '';

    if (!finalFirstName && name) {
      const parts = name.trim().split(/\s+/);
      finalFirstName = parts[0] || 'User';
      finalLastName = parts.slice(1).join(' ') || '';
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        firstName: finalFirstName || 'User',
        lastName: finalLastName || null,
        email: normalizedEmail,
        password: passwordHash,
      },
    });

    await prisma.otp.deleteMany({ where: { email: normalizedEmail, type: 'SIGNUP' } });

    // Migrate session items
    const guestItems = req.session.cart || [];
    await migrateGuestCart(user.id, guestItems);
    req.session.cart = [];

    const displayName = getDisplayName(user);

    req.session.userId = user.id;
    req.session.user = {
      id: user.id,
      name: displayName,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      avatarUrl: null,
    };

    req.session.save(() => {
      res.status(201).json({
        success: true,
        message: 'Account registered and verified successfully.',
        redirectUrl: '/',
      });
    });
  } catch (error) {
    console.error('Verify Signup Error:', error);
    return res.status(500).json({ success: false, message: 'Account creation failed.' });
  }
};

// ==========================================
// 3. OTP FORGOT PASSWORD & RESET FLOW
// ==========================================

// POST /api/auth/forgot-password-otp
export const sendForgotOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });

    const normalizedEmail = email.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(200).json({ success: true, message: 'If registered, an OTP has been dispatched.' });
    }

    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.otp.deleteMany({ where: { email: normalizedEmail, type: 'FORGOT_PASSWORD' } });
    await prisma.otp.create({
      data: { email: normalizedEmail, code, type: 'FORGOT_PASSWORD', expiresAt },
    });

    await sendOtpEmail(normalizedEmail, code, 'Password Reset');
    return res.status(200).json({ success: true, message: 'Password reset code dispatched to email.' });
  } catch (error) {
    console.error('Send Forgot OTP Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to dispatch reset code.' });
  }
};

// POST /api/auth/reset-password
export const resetPasswordWithOtp = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Valid parameters required (min 8 chars).' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const record = await prisma.otp.findFirst({
      where: {
        email: normalizedEmail,
        code: String(otp).trim(),
        type: 'FORGOT_PASSWORD',
        expiresAt: { gt: new Date() },
      },
    });

    if (!record) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP code.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { email: normalizedEmail },
      data: { password: passwordHash },
    });

    await prisma.otp.deleteMany({ where: { email: normalizedEmail, type: 'FORGOT_PASSWORD' } });
    return res.status(200).json({ success: true, message: 'Password updated. Please sign in.' });
  } catch (error) {
    console.error('Reset Password Error:', error);
    return res.status(500).json({ success: false, message: 'Password reset failed.' });
  }
};

// ==========================================
// 4. IN-APP PASSWORD CHANGE (AUTHENTICATED)
// ==========================================

// POST /api/auth/change-password
export const changePassword = async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized session.' });

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Valid passwords required (min 8 chars).' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.password) {
      return res.status(400).json({ success: false, message: 'Account authenticated via Google OAuth.' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: userId },
      data: { password: passwordHash },
    });

    return res.status(200).json({ success: true, message: 'Password updated successfully.' });
  } catch (error) {
    console.error('Change Password Error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating password.' });
  }
};

// ==========================================
// 5. GOOGLE OAUTH PLATFORM INTEGRATION
// ==========================================

// GET /api/auth/google
export const googleAuthRedirect = (req, res) => {
  const mode = req.query.mode === 'signup' ? 'signup' : 'login';
  const { client, callbackUrl } = getGoogleClient(req);

  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['profile', 'email'],
    prompt: 'select_account',
    response_type: 'code',
    redirect_uri: callbackUrl,
    state: JSON.stringify({ mode }),
  });

  return res.redirect(url);
};

// GET /api/auth/google/callback
export const googleAuthCallback = async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.redirect('/login?error=oauth_missing_code');

    let mode = 'login';
    try {
      if (state) {
        const parsedState = JSON.parse(state);
        mode = parsedState.mode || 'login';
      }
    } catch {
      mode = 'login';
    }

    const { client, callbackUrl, clientId } = getGoogleClient(req);

    const { tokens } = await client.getToken({
      code,
      redirect_uri: callbackUrl,
    });
    client.setCredentials(tokens);

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: clientId,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, given_name, family_name, name, picture } = payload;
    const normalizedEmail = email.toLowerCase().trim();

    let user = await prisma.user.findFirst({
      where: {
        OR: [{ googleId }, { email: normalizedEmail }],
      },
    });

    if (!user && mode === 'login') {
      return res.redirect('/signup?error=account_not_found');
    }

    if (!user) {
      user = await prisma.user.create({
        data: {
          firstName: given_name || (name ? name.split(' ')[0] : 'User'),
          lastName: family_name || (name ? name.split(' ').slice(1).join(' ') : null),
          email: normalizedEmail,
          googleId,
          avatarUrl: picture || null,
        },
      });
    } else {
      const updates = {};
      if (!user.googleId) updates.googleId = googleId;
      if (!user.avatarUrl && picture) updates.avatarUrl = picture;
      if (!user.firstName && given_name) updates.firstName = given_name;
      if (!user.lastName && family_name) updates.lastName = family_name;

      if (Object.keys(updates).length > 0) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: updates,
        });
      }
    }

    const guestItems = req.session.cart || [];
    await migrateGuestCart(user.id, guestItems);
    req.session.cart = [];

    const displayName = getDisplayName(user);

    req.session.userId = user.id;
    req.session.user = {
      id: user.id,
      name: displayName,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      avatarUrl: user.avatarUrl || null,
    };

    req.session.save(() => {
      const target = req.session.returnTo || '/';
      delete req.session.returnTo;
      res.redirect(target);
    });
  } catch (error) {
    console.error('Google OAuth Callback Error:', error);
    res.redirect('/login?error=oauth_failed');
  }
};

// ==========================================
// 6. SESSION PROFILE & AVATAR UPDATES
// ==========================================

// PUT /api/auth/update-profile
export const updateProfile = async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized session.' });
    }

    const { name, firstName, lastName, phone, dob, gender } = req.body;

    let updatedFirstName = firstName ? firstName.trim() : undefined;
    let updatedLastName = lastName ? lastName.trim() : undefined;

    // Fallback if client sent single name/fullName string
    if (!updatedFirstName && name) {
      const parts = name.trim().split(/\s+/);
      updatedFirstName = parts[0];
      updatedLastName = parts.slice(1).join(' ') || null;
    }

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    });

    let avatarUrl = undefined;

    if (req.file) {
      if (existingUser?.avatarUrl) {
        const oldPublicId = extractPublicId(existingUser.avatarUrl);
        if (oldPublicId) {
          await deleteFromCloudinary(oldPublicId);
        }
      }

      const uploadResult = await uploadToCloudinary(req.file.buffer, 'roinax_avatars');
      avatarUrl = uploadResult.secure_url;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(updatedFirstName !== undefined && { firstName: updatedFirstName }),
        ...(updatedLastName !== undefined && { lastName: updatedLastName }),
        ...(phone !== undefined && { phone: phone ? phone.trim() : null }),
        ...(dob !== undefined && { dob: dob ? new Date(dob) : null }),
        ...(gender !== undefined && { gender: gender || null }),
        ...(avatarUrl && { avatarUrl }),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        dob: true,
        gender: true,
        avatarUrl: true,
      },
    });

    const displayName = getDisplayName(updatedUser);

    if (req.session.user) {
      req.session.user.name = displayName;
      req.session.user.firstName = updatedUser.firstName;
      req.session.user.lastName = updatedUser.lastName;
      if (updatedUser.avatarUrl) {
        req.session.user.avatarUrl = updatedUser.avatarUrl;
      }
    }

    req.session.save((err) => {
      if (err) console.error('Session update error:', err);
      return res.status(200).json({
        success: true,
        message: 'Profile updated successfully.',
        user: { ...updatedUser, name: displayName },
      });
    });
  } catch (error) {
    console.error('Update Profile Error:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'File too large. Maximum size is 2MB.' });
    }
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error updating profile.',
    });
  }
};

// GET /api/auth/me
export const getMe = async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(200).json({
        success: true,
        authenticated: false,
        user: null,
      });
    }

    // Explicitly selects valid schema fields (no unknown `name` field)
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        dob: true,
        gender: true,
        email: true,
        avatarUrl: true,
        createdAt: true,
      },
    });

    if (!user) {
      req.session.destroy();
      res.clearCookie('roinax_sid');
      return res.status(200).json({
        success: true,
        authenticated: false,
        user: null,
      });
    }

    // Synthesize `name` so any legacy frontend scripts receiving `user.name` continue to function
    const userResponse = {
      ...user,
      name: getDisplayName(user),
    };

    return res.status(200).json({
      success: true,
      authenticated: true,
      user: userResponse,
    });
  } catch (error) {
    console.error('Get Me Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error checking session.',
    });
  }
};