/**
 * Content Gating Service - Swarm Coordination Mastery Platform
 * Manages progressive content unlock based on user progress and subscription status
 */

const { Pool } = require('pg');
const redis = require('redis');
const { logger } = require('../utils/logger');

class ContentGatingService {
  constructor() {
    this.db = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    this.redis = redis.createClient({
      url: process.env.REDIS_URL
    });
    
    this.redis.on('error', (err) => {
      logger.error('Redis connection error:', err);
    });
  }

  /**
   * Check if user has access to specific content
   * @param {string} userId - User UUID
   * @param {string} contentId - Content UUID (course, module, or lesson)
   * @param {string} contentType - Type of content ('course', 'module', 'lesson')
   * @returns {Object} Access result with permissions and restrictions
   */
  async checkContentAccess(userId, contentId, contentType) {
    try {
      const cacheKey = `content_access:${userId}:${contentId}:${contentType}`;
      
      // Check cache first
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Get user information
      const user = await this.getUserWithSubscription(userId);
      if (!user) {
        return this.createAccessResult(false, 'USER_NOT_FOUND', 'User not found');
      }

      // Get content information
      const content = await this.getContentDetails(contentId, contentType);
      if (!content) {
        return this.createAccessResult(false, 'CONTENT_NOT_FOUND', 'Content not found');
      }

      // Perform access checks
      const accessResult = await this.performAccessChecks(user, content, contentType);
      
      // Cache the result for 5 minutes
      await this.redis.setex(cacheKey, 300, JSON.stringify(accessResult));
      
      return accessResult;
    } catch (error) {
      logger.error('Error checking content access:', error);
      return this.createAccessResult(false, 'SYSTEM_ERROR', 'System error occurred');
    }
  }

  /**
   * Get user details with subscription information
   * @param {string} userId - User UUID
   * @returns {Object} User object with subscription details
   */
  async getUserWithSubscription(userId) {
    const query = `
      SELECT 
        u.id,
        u.email,
        u.role,
        u.is_active,
        u.is_verified,
        s.plan,
        s.status as subscription_status,
        s.current_period_end,
        s.trial_end
      FROM users u
      LEFT JOIN subscriptions s ON u.id = s.user_id
      WHERE u.id = $1 AND u.is_active = true
    `;
    
    const result = await this.db.query(query, [userId]);
    return result.rows[0] || null;
  }

  /**
   * Get content details based on type
   * @param {string} contentId - Content UUID
   * @param {string} contentType - Type of content
   * @returns {Object} Content details
   */
  async getContentDetails(contentId, contentType) {
    let query, params;
    
    switch (contentType) {
      case 'course':
        query = `
          SELECT 
            id,
            title,
            level,
            is_published,
            is_free,
            requires_subscription,
            prerequisites
          FROM courses
          WHERE id = $1
        `;
        params = [contentId];
        break;
        
      case 'module':
        query = `
          SELECT 
            m.id,
            m.title,
            m.prerequisites,
            c.level,
            c.is_published,
            c.is_free,
            c.requires_subscription,
            c.id as course_id
          FROM modules m
          JOIN courses c ON m.course_id = c.id
          WHERE m.id = $1
        `;
        params = [contentId];
        break;
        
      case 'lesson':
        query = `
          SELECT 
            l.id,
            l.title,
            l.requires_assessment,
            c.level,
            c.is_published,
            c.is_free,
            c.requires_subscription,
            c.id as course_id,
            m.id as module_id
          FROM lessons l
          JOIN modules m ON l.module_id = m.id
          JOIN courses c ON m.course_id = c.id
          WHERE l.id = $1
        `;
        params = [contentId];
        break;
        
      default:
        return null;
    }
    
    const result = await this.db.query(query, params);
    return result.rows[0] || null;
  }

  /**
   * Perform comprehensive access checks
   * @param {Object} user - User object
   * @param {Object} content - Content object
   * @param {string} contentType - Type of content
   * @returns {Object} Access result
   */
  async performAccessChecks(user, content, contentType) {
    // Check if content is published
    if (!content.is_published) {
      return this.createAccessResult(false, 'CONTENT_NOT_PUBLISHED', 'Content is not published');
    }

    // Check user verification
    if (!user.is_verified) {
      return this.createAccessResult(false, 'USER_NOT_VERIFIED', 'Email verification required');
    }

    // Check subscription requirements
    const subscriptionCheck = await this.checkSubscriptionAccess(user, content);
    if (!subscriptionCheck.hasAccess) {
      return subscriptionCheck;
    }

    // Check level-based gating
    const levelCheck = await this.checkLevelAccess(user.id, content);
    if (!levelCheck.hasAccess) {
      return levelCheck;
    }

    // Check prerequisites
    const prerequisiteCheck = await this.checkPrerequisites(user.id, content, contentType);
    if (!prerequisiteCheck.hasAccess) {
      return prerequisiteCheck;
    }

    // Check enrollment for courses
    if (contentType === 'course') {
      const enrollmentCheck = await this.checkEnrollment(user.id, content.id);
      if (!enrollmentCheck.hasAccess) {
        return enrollmentCheck;
      }
    }

    // All checks passed
    return this.createAccessResult(true, 'ACCESS_GRANTED', 'Access granted');
  }

  /**
   * Check subscription-based access
   * @param {Object} user - User object
   * @param {Object} content - Content object
   * @returns {Object} Access result
   */
  async checkSubscriptionAccess(user, content) {
    // Free content is always accessible
    if (content.is_free) {
      return { hasAccess: true };
    }

    // Content requires subscription
    if (content.requires_subscription) {
      // Check if user has active subscription
      if (!user.subscription_status || user.subscription_status !== 'active') {
        // Check if user is in trial period
        if (user.trial_end && new Date(user.trial_end) > new Date()) {
          return { hasAccess: true };
        }
        
        return this.createAccessResult(false, 'SUBSCRIPTION_REQUIRED', 'Active subscription required');
      }
      
      // Check if subscription hasn't expired
      if (user.current_period_end && new Date(user.current_period_end) < new Date()) {
        return this.createAccessResult(false, 'SUBSCRIPTION_EXPIRED', 'Subscription has expired');
      }
    }

    return { hasAccess: true };
  }

  /**
   * Check level-based access (progressive unlock)
   * @param {string} userId - User UUID
   * @param {Object} content - Content object
   * @returns {Object} Access result
   */
  async checkLevelAccess(userId, content) {
    const level = content.level;
    
    // Beginner level is always accessible
    if (level === 'beginner') {
      return { hasAccess: true };
    }

    // Check intermediate level access
    if (level === 'intermediate') {
      const beginnerCompletion = await this.getLevelCompletion(userId, 'beginner');
      if (beginnerCompletion < 80) {
        return this.createAccessResult(
          false, 
          'PREREQUISITE_LEVEL_NOT_COMPLETED', 
          `Beginner level must be 80% complete. Current: ${beginnerCompletion}%`,
          { requiredCompletion: 80, currentCompletion: beginnerCompletion }
        );
      }
    }

    // Check advanced level access
    if (level === 'advanced') {
      const intermediateCompletion = await this.getLevelCompletion(userId, 'intermediate');
      if (intermediateCompletion < 80) {
        return this.createAccessResult(
          false, 
          'PREREQUISITE_LEVEL_NOT_COMPLETED', 
          `Intermediate level must be 80% complete. Current: ${intermediateCompletion}%`,
          { requiredCompletion: 80, currentCompletion: intermediateCompletion }
        );
      }
    }

    return { hasAccess: true };
  }

  /**
   * Get user completion percentage for a specific level
   * @param {string} userId - User UUID
   * @param {string} level - Content level
   * @returns {number} Completion percentage
   */
  async getLevelCompletion(userId, level) {
    const query = `
      SELECT 
        AVG(completion_percentage) as avg_completion
      FROM (
        SELECT 
          c.id,
          calculate_course_completion($1, c.id) as completion_percentage
        FROM courses c
        WHERE c.level = $2 AND c.is_published = true
      ) course_completions
    `;
    
    const result = await this.db.query(query, [userId, level]);
    return Math.round(result.rows[0].avg_completion || 0);
  }

  /**
   * Check content prerequisites
   * @param {string} userId - User UUID
   * @param {Object} content - Content object
   * @param {string} contentType - Type of content
   * @returns {Object} Access result
   */
  async checkPrerequisites(userId, content, contentType) {
    if (!content.prerequisites || content.prerequisites.length === 0) {
      return { hasAccess: true };
    }

    const prerequisiteIds = content.prerequisites;
    let checkQuery, checkParams;

    if (contentType === 'course') {
      // Check course prerequisites
      checkQuery = `
        SELECT 
          prerequisite_id,
          CASE 
            WHEN up.status = 'completed' THEN true
            ELSE false
          END as completed
        FROM unnest($1::uuid[]) as prerequisite_id
        LEFT JOIN user_progress up ON up.user_id = $2 
          AND up.course_id = prerequisite_id
          AND up.status = 'completed'
      `;
      checkParams = [prerequisiteIds, userId];
    } else {
      // Check module prerequisites
      checkQuery = `
        SELECT 
          prerequisite_id,
          CASE 
            WHEN up.status = 'completed' THEN true
            ELSE false
          END as completed
        FROM unnest($1::uuid[]) as prerequisite_id
        LEFT JOIN user_progress up ON up.user_id = $2 
          AND up.module_id = prerequisite_id
          AND up.status = 'completed'
      `;
      checkParams = [prerequisiteIds, userId];
    }

    const result = await this.db.query(checkQuery, checkParams);
    const incompletePrereqs = result.rows.filter(row => !row.completed);

    if (incompletePrereqs.length > 0) {
      return this.createAccessResult(
        false, 
        'PREREQUISITES_NOT_MET', 
        `${incompletePrereqs.length} prerequisite(s) not completed`,
        { incompletePrerequisites: incompletePrereqs.map(p => p.prerequisite_id) }
      );
    }

    return { hasAccess: true };
  }

  /**
   * Check course enrollment
   * @param {string} userId - User UUID
   * @param {string} courseId - Course UUID
   * @returns {Object} Access result
   */
  async checkEnrollment(userId, courseId) {
    const query = `
      SELECT 
        id,
        is_active,
        expires_at
      FROM enrollments
      WHERE user_id = $1 AND course_id = $2
    `;
    
    const result = await this.db.query(query, [userId, courseId]);
    const enrollment = result.rows[0];

    if (!enrollment) {
      return this.createAccessResult(false, 'NOT_ENROLLED', 'User not enrolled in course');
    }

    if (!enrollment.is_active) {
      return this.createAccessResult(false, 'ENROLLMENT_INACTIVE', 'Enrollment is inactive');
    }

    if (enrollment.expires_at && new Date(enrollment.expires_at) < new Date()) {
      return this.createAccessResult(false, 'ENROLLMENT_EXPIRED', 'Enrollment has expired');
    }

    return { hasAccess: true };
  }

  /**
   * Get user's accessible content for a specific level
   * @param {string} userId - User UUID
   * @param {string} level - Content level
   * @returns {Array} Array of accessible content IDs
   */
  async getAccessibleContent(userId, level) {
    const cacheKey = `accessible_content:${userId}:${level}`;
    
    // Check cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Get all published courses for the level
    const query = `
      SELECT id, title, requires_subscription, is_free
      FROM courses
      WHERE level = $1 AND is_published = true
      ORDER BY created_at
    `;
    
    const result = await this.db.query(query, [level]);
    const courses = result.rows;
    
    // Check access for each course
    const accessibleCourses = [];
    for (const course of courses) {
      const access = await this.checkContentAccess(userId, course.id, 'course');
      if (access.hasAccess) {
        accessibleCourses.push({
          id: course.id,
          title: course.title,
          requiresSubscription: course.requires_subscription,
          isFree: course.is_free
        });
      }
    }

    // Cache for 10 minutes
    await this.redis.setex(cacheKey, 600, JSON.stringify(accessibleCourses));
    
    return accessibleCourses;
  }

  /**
   * Create standardized access result
   * @param {boolean} hasAccess - Whether access is granted
   * @param {string} code - Error/success code
   * @param {string} message - Human-readable message
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Access result
   */
  createAccessResult(hasAccess, code, message, metadata = {}) {
    return {
      hasAccess,
      code,
      message,
      metadata,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Clear cache for user's content access
   * @param {string} userId - User UUID
   */
  async clearUserContentCache(userId) {
    const pattern = `content_access:${userId}:*`;
    const keys = await this.redis.keys(pattern);
    
    if (keys.length > 0) {
      await this.redis.del(keys);
    }
    
    // Also clear accessible content cache
    const accessiblePattern = `accessible_content:${userId}:*`;
    const accessibleKeys = await this.redis.keys(accessiblePattern);
    
    if (accessibleKeys.length > 0) {
      await this.redis.del(accessibleKeys);
    }
  }

  /**
   * Enroll user in a course
   * @param {string} userId - User UUID
   * @param {string} courseId - Course UUID
   * @returns {Object} Enrollment result
   */
  async enrollUser(userId, courseId) {
    try {
      // Check if user can access the course
      const access = await this.checkContentAccess(userId, courseId, 'course');
      if (!access.hasAccess) {
        return {
          success: false,
          message: access.message,
          code: access.code
        };
      }

      // Check if already enrolled
      const existingEnrollment = await this.db.query(
        'SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2',
        [userId, courseId]
      );

      if (existingEnrollment.rows.length > 0) {
        return {
          success: false,
          message: 'User already enrolled in course',
          code: 'ALREADY_ENROLLED'
        };
      }

      // Create enrollment
      const enrollmentQuery = `
        INSERT INTO enrollments (user_id, course_id, enrolled_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        RETURNING id
      `;
      
      const result = await this.db.query(enrollmentQuery, [userId, courseId]);
      
      // Clear cache
      await this.clearUserContentCache(userId);
      
      return {
        success: true,
        message: 'Successfully enrolled in course',
        enrollmentId: result.rows[0].id
      };
    } catch (error) {
      logger.error('Error enrolling user:', error);
      return {
        success: false,
        message: 'System error occurred',
        code: 'SYSTEM_ERROR'
      };
    }
  }

  /**
   * Close database connections
   */
  async close() {
    await this.db.end();
    await this.redis.quit();
  }
}

module.exports = ContentGatingService;