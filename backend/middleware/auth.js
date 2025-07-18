/**
 * Authentication Middleware - Swarm Coordination Mastery Platform
 * JWT token validation and role-based access control
 */

const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const redis = require('redis');
const { logger } = require('../utils/logger');

class AuthMiddleware {
  constructor() {
    this.db = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    this.redis = redis.createClient({
      url: process.env.REDIS_URL
    });
    
    this.jwtSecret = process.env.JWT_SECRET;
    this.jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
    
    if (!this.jwtSecret || !this.jwtRefreshSecret) {
      throw new Error('JWT secrets not configured');
    }
  }

  /**
   * Validate JWT token middleware
   * @param {Array} requiredPermissions - Required permissions for access
   * @returns {Function} Express middleware function
   */
  validateToken(requiredPermissions = []) {
    return async (req, res, next) => {
      try {
        const token = this.extractTokenFromHeader(req);
        
        if (!token) {
          return res.status(401).json({
            error: {
              code: 'TOKEN_MISSING',
              message: 'Authorization token is required'
            }
          });
        }

        // Check if token is blacklisted
        const isBlacklisted = await this.isTokenBlacklisted(token);
        if (isBlacklisted) {
          return res.status(401).json({
            error: {
              code: 'TOKEN_BLACKLISTED',
              message: 'Token has been revoked'
            }
          });
        }

        // Verify and decode token
        const decoded = jwt.verify(token, this.jwtSecret);
        
        // Check token expiration
        if (decoded.exp < Date.now() / 1000) {
          return res.status(401).json({
            error: {
              code: 'TOKEN_EXPIRED',
              message: 'Token has expired'
            }
          });
        }

        // Get user from database
        const user = await this.getUserById(decoded.sub);
        if (!user) {
          return res.status(401).json({
            error: {
              code: 'USER_NOT_FOUND',
              message: 'User not found'
            }
          });
        }

        // Check if user is active
        if (!user.is_active) {
          return res.status(401).json({
            error: {
              code: 'USER_INACTIVE',
              message: 'User account is inactive'
            }
          });
        }

        // Check permissions
        if (requiredPermissions.length > 0) {
          const hasPermission = await this.checkUserPermissions(user, requiredPermissions);
          if (!hasPermission.granted) {
            return res.status(403).json({
              error: {
                code: 'INSUFFICIENT_PERMISSIONS',
                message: 'Insufficient permissions for this action',
                required: requiredPermissions,
                missing: hasPermission.missing
              }
            });
          }
        }

        // Add user to request object
        req.user = {
          id: user.id,
          email: user.email,
          role: user.role,
          subscription: user.subscription,
          permissions: this.getUserPermissions(user)
        };

        // Log authentication event
        await this.logAuthEvent(user.id, 'token_validated', true, {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          endpoint: req.originalUrl
        });

        next();
      } catch (error) {
        if (error.name === 'JsonWebTokenError') {
          return res.status(401).json({
            error: {
              code: 'TOKEN_INVALID',
              message: 'Invalid token format'
            }
          });
        }
        
        if (error.name === 'TokenExpiredError') {
          return res.status(401).json({
            error: {
              code: 'TOKEN_EXPIRED',
              message: 'Token has expired'
            }
          });
        }

        logger.error('Token validation error:', error);
        return res.status(500).json({
          error: {
            code: 'AUTHENTICATION_ERROR',
            message: 'Authentication service error'
          }
        });
      }
    };
  }

  /**
   * Optional authentication middleware (doesn't fail if no token)
   */
  optionalAuth() {
    return async (req, res, next) => {
      try {
        const token = this.extractTokenFromHeader(req);
        
        if (!token) {
          req.user = null;
          return next();
        }

        const decoded = jwt.verify(token, this.jwtSecret);
        const user = await this.getUserById(decoded.sub);
        
        if (user && user.is_active) {
          req.user = {
            id: user.id,
            email: user.email,
            role: user.role,
            subscription: user.subscription,
            permissions: this.getUserPermissions(user)
          };
        } else {
          req.user = null;
        }

        next();
      } catch (error) {
        // Continue without authentication on error
        req.user = null;
        next();
      }
    };
  }

  /**
   * Role-based access control middleware
   * @param {Array} allowedRoles - Array of allowed roles
   * @returns {Function} Express middleware function
   */
  requireRole(allowedRoles = []) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required'
          }
        });
      }

      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          error: {
            code: 'ROLE_INSUFFICIENT',
            message: 'Insufficient role permissions',
            required: allowedRoles,
            current: req.user.role
          }
        });
      }

      next();
    };
  }

  /**
   * Subscription-based access control
   * @param {Array} requiredPlans - Required subscription plans
   * @returns {Function} Express middleware function
   */
  requireSubscription(requiredPlans = []) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required'
          }
        });
      }

      const userSubscription = req.user.subscription;
      
      if (!userSubscription || !requiredPlans.includes(userSubscription.plan)) {
        return res.status(402).json({
          error: {
            code: 'SUBSCRIPTION_REQUIRED',
            message: 'Valid subscription required',
            required: requiredPlans,
            current: userSubscription ? userSubscription.plan : null
          }
        });
      }

      if (userSubscription.status !== 'active') {
        return res.status(402).json({
          error: {
            code: 'SUBSCRIPTION_INACTIVE',
            message: 'Active subscription required',
            status: userSubscription.status
          }
        });
      }

      next();
    };
  }

  /**
   * Rate limiting middleware
   * @param {Object} options - Rate limiting options
   * @returns {Function} Express middleware function
   */
  rateLimit(options = {}) {
    const defaultOptions = {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // requests per window
      skipSuccessfulRequests: false,
      keyGenerator: (req) => req.user ? req.user.id : req.ip
    };

    const config = { ...defaultOptions, ...options };

    return async (req, res, next) => {
      try {
        const key = `rate_limit:${config.keyGenerator(req)}`;
        const current = await this.redis.get(key);
        
        if (current && parseInt(current) >= config.max) {
          return res.status(429).json({
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Too many requests',
              limit: config.max,
              window: config.windowMs / 1000,
              retryAfter: Math.ceil(config.windowMs / 1000)
            }
          });
        }

        // Increment counter
        const multi = this.redis.multi();
        multi.incr(key);
        multi.expire(key, Math.ceil(config.windowMs / 1000));
        await multi.exec();

        // Add rate limit headers
        res.set({
          'X-RateLimit-Limit': config.max,
          'X-RateLimit-Remaining': Math.max(0, config.max - (parseInt(current) || 0) - 1),
          'X-RateLimit-Reset': new Date(Date.now() + config.windowMs).toISOString()
        });

        next();
      } catch (error) {
        logger.error('Rate limiting error:', error);
        next(); // Continue on error
      }
    };
  }

  /**
   * Extract token from Authorization header
   * @param {Object} req - Express request object
   * @returns {string|null} JWT token or null
   */
  extractTokenFromHeader(req) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    return authHeader.substring(7); // Remove 'Bearer ' prefix
  }

  /**
   * Check if token is blacklisted
   * @param {string} token - JWT token
   * @returns {boolean} True if blacklisted
   */
  async isTokenBlacklisted(token) {
    try {
      const blacklisted = await this.redis.get(`blacklist:${token}`);
      return blacklisted !== null;
    } catch (error) {
      logger.error('Error checking token blacklist:', error);
      return false; // Assume not blacklisted on error
    }
  }

  /**
   * Blacklist a token
   * @param {string} token - JWT token to blacklist
   * @param {number} expiration - Token expiration time
   */
  async blacklistToken(token, expiration) {
    try {
      const ttl = Math.max(0, expiration - Math.floor(Date.now() / 1000));
      await this.redis.setex(`blacklist:${token}`, ttl, 'true');
    } catch (error) {
      logger.error('Error blacklisting token:', error);
    }
  }

  /**
   * Get user by ID from database
   * @param {string} userId - User UUID
   * @returns {Object|null} User object or null
   */
  async getUserById(userId) {
    try {
      const query = `
        SELECT 
          u.id,
          u.email,
          u.role,
          u.is_active,
          u.is_verified,
          s.plan,
          s.status as subscription_status,
          s.current_period_end
        FROM users u
        LEFT JOIN subscriptions s ON u.id = s.user_id
        WHERE u.id = $1
      `;
      
      const result = await this.db.query(query, [userId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const user = result.rows[0];
      
      // Format subscription data
      user.subscription = user.plan ? {
        plan: user.plan,
        status: user.subscription_status,
        currentPeriodEnd: user.current_period_end
      } : null;

      return user;
    } catch (error) {
      logger.error('Error fetching user:', error);
      return null;
    }
  }

  /**
   * Get user permissions based on role
   * @param {Object} user - User object
   * @returns {Array} Array of permissions
   */
  getUserPermissions(user) {
    const rolePermissions = {
      student: [
        'read:own_profile',
        'update:own_profile',
        'read:enrolled_courses',
        'read:unlocked_content',
        'write:own_progress',
        'submit:assessments'
      ],
      instructor: [
        'read:own_profile',
        'update:own_profile',
        'read:all_courses',
        'create:courses',
        'update:own_courses',
        'read:student_progress',
        'create:assessments',
        'grade:submissions'
      ],
      admin: [
        'read:all_profiles',
        'update:all_profiles',
        'delete:users',
        'read:all_courses',
        'create:courses',
        'update:all_courses',
        'delete:courses',
        'read:all_progress',
        'manage:subscriptions',
        'view:analytics'
      ],
      enterprise: [
        'read:organization_profiles',
        'update:organization_profiles',
        'read:organization_courses',
        'assign:courses',
        'read:organization_progress',
        'create:teams',
        'manage:team_members',
        'view:organization_analytics'
      ]
    };

    return rolePermissions[user.role] || [];
  }

  /**
   * Check if user has required permissions
   * @param {Object} user - User object
   * @param {Array} requiredPermissions - Required permissions
   * @returns {Object} Permission check result
   */
  async checkUserPermissions(user, requiredPermissions) {
    const userPermissions = this.getUserPermissions(user);
    const missing = requiredPermissions.filter(permission => 
      !userPermissions.includes(permission)
    );

    return {
      granted: missing.length === 0,
      missing,
      userPermissions
    };
  }

  /**
   * Log authentication event
   * @param {string} userId - User ID
   * @param {string} action - Action performed
   * @param {boolean} success - Whether action was successful
   * @param {Object} metadata - Additional metadata
   */
  async logAuthEvent(userId, action, success, metadata = {}) {
    try {
      const query = `
        INSERT INTO audit_logs (user_id, action, resource_type, metadata, ip_address, user_agent)
        VALUES ($1, $2, $3, $4, $5, $6)
      `;
      
      await this.db.query(query, [
        userId,
        action,
        'authentication',
        { success, ...metadata },
        metadata.ip,
        metadata.userAgent
      ]);
    } catch (error) {
      logger.error('Error logging auth event:', error);
    }
  }

  /**
   * Generate JWT token
   * @param {Object} payload - Token payload
   * @param {string} expiresIn - Token expiration
   * @returns {string} JWT token
   */
  generateToken(payload, expiresIn = '15m') {
    return jwt.sign(payload, this.jwtSecret, {
      expiresIn,
      issuer: 'swarm-learning-platform',
      subject: payload.sub
    });
  }

  /**
   * Generate refresh token
   * @param {Object} payload - Token payload
   * @returns {string} Refresh token
   */
  generateRefreshToken(payload) {
    return jwt.sign(payload, this.jwtRefreshSecret, {
      expiresIn: '7d',
      issuer: 'swarm-learning-platform',
      subject: payload.sub
    });
  }

  /**
   * Verify refresh token
   * @param {string} token - Refresh token
   * @returns {Object} Decoded token
   */
  verifyRefreshToken(token) {
    return jwt.verify(token, this.jwtRefreshSecret);
  }

  /**
   * Close database connections
   */
  async close() {
    await this.db.end();
    await this.redis.quit();
  }
}

module.exports = AuthMiddleware;